import db from '../db/knex.js'
import { canAccessEmpresa } from '../middlewares/auth.js'

// GET /nominas - scoped: empresa ve solo las suyas; admin ve todas o filtra por ?empresa_id
export async function list(req, res) {
  const empresaId = req.user.role === 'admin'
    ? req.query.empresa_id
    : req.user.empresa_id

  if (req.user.role !== 'admin' && !empresaId) {
    return res.status(400).json({ error: 'empresa_id requerido' })
  }

  const { status, page = 1, per_page = 25 } = req.query

  const query = db('nominas')
    .leftJoin('empresas', 'nominas.empresa_id', 'empresas.id')
    .select('nominas.*', 'empresas.razon_social as empresa_nombre',
      db.raw(`(SELECT COALESCE(SUM(nd.salario_base * nd.dias_laborados / 30), 0)
        FROM nomina_detalles nd WHERE nd.nomina_id = nominas.id) as salario_dias`))
    .orderBy('nominas.id', 'desc')

  if (empresaId) query.where('nominas.empresa_id', empresaId)
  if (status) query.where('nominas.status', status)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /nominas/:id - nomina con su detalle por empleado
export async function show(req, res) {
  const nomina = await db('nominas')
    .leftJoin('empresas', 'nominas.empresa_id', 'empresas.id')
    .select('nominas.*', 'empresas.razon_social as empresa_nombre')
    .where('nominas.id', req.params.id)
    .first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }

  const detalles = await db('nomina_detalles')
    .leftJoin('empleados', 'nomina_detalles.empleado_id', 'empleados.id')
    .select(
      'nomina_detalles.*',
      'empleados.primer_nombre',
      'empleados.primer_apellido',
      'empleados.numero_documento'
    )
    .where('nomina_id', nomina.id)

  res.json({ nomina, detalles })
}

// POST /nominas - admin crea la cabecera (borrador) para una empresa/periodo
export async function create(req, res) {
  const { empresa_id, nombre_periodo } = req.body
  if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' })

  const [id] = await db('nominas').insert({
    empresa_id,
    nombre_periodo: nombre_periodo || null,
    status: 'borrador',
  })
  res.status(201).json({ nomina: await db('nominas').where('id', id).first() })
}

// ── Liquidacion ──────────────────────────────────────────────────────────────
// Formulas de seguridad social/prestaciones (Colombia) sobre el IBC.
// IBC = devengado constitutivo (salario proporcional + h.extras + otros ingresos)
// ingreso_noc NO hace parte del IBC (no constitutivo de salario).
const TASAS_ARL = { I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696 }
const AUX_TRANSPORTE_MES = Number(process.env.AUX_TRANSPORTE || 200000)

function liquidarEmpleado(empleado, input) {
  const dias = Math.min(Math.max(Number(input.dias_laborados) || 30, 0), 30)
  const salario = Number(empleado.salario_base) || 0
  const salarioProp = (salario / 30) * dias
  const aux = empleado.subsidio_transporte ? (AUX_TRANSPORTE_MES / 30) * dias : 0
  const horas = Number(input.horas_extras) || 0
  const otros = Number(input.otros_ingresos) || 0
  const ingresoNoc = Number(input.ingreso_noc) || 0
  const deducciones = Number(input.deducciones) || 0

  const ibc = salarioProp + horas + otros
  const salud = ibc * 0.085
  const pension = ibc * 0.12
  const arl = ibc * (TASAS_ARL[empleado.riesgo] ?? TASAS_ARL.I)
  const ccf = ibc * 0.04
  const sena = ibc * 0.02
  const icbf = ibc * 0.03

  const basePrest = salarioProp + aux
  const cesantias = basePrest * 0.0833
  const intereses = cesantias * 0.01      // 12% anual -> ~1% mensual
  const vacaciones = salarioProp * 0.0417
  const ibl = ibc                          // base prestaciones por ley

  const totalNomina = salarioProp + aux + horas + otros + ingresoNoc - deducciones
  const totalPlanilla = salud + pension + arl + ccf + sena + icbf

  return {
    dias_laborados: dias,
    salario_base: salario,
    aux_transporte: round2(aux),
    horas_extras: horas,
    otros_ingresos: otros,
    ingreso_noc: ingresoNoc,
    deducciones,
    ibc: round2(ibc), ibl: round2(ibl),
    salud: round2(salud), pension: round2(pension), arl: round2(arl),
    ccf: round2(ccf), sena: round2(sena), icbf: round2(icbf),
    riesgo: round2(arl),
    cesantias: round2(cesantias), intereses: round2(intereses),
    vacaciones: round2(vacaciones),
    indemnizacion: Number(input.indemnizacion) || 0,
    total_nomina: round2(totalNomina),
    total_planilla: round2(totalPlanilla),
    neto: round2(totalNomina),
  }
}

function round2(n) { return Math.round(n * 100) / 100 }

// PUT /nominas/:id/liquidar - recalcula todo el detalle y los totales.
// body: { empleados: [{ empleado_id, dias_laborados?, horas_extras?,
//   otros_ingresos?, ingreso_noc?, deducciones?, indemnizacion? }] }
export async function liquidar(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }

  const items = Array.isArray(req.body.empleados) ? req.body.empleados : []
  if (!items.length) return res.status(400).json({ error: 'empleados requerido' })

  const empleados = await db('empleados')
    .where('empresa_id', nomina.empresa_id)
    .whereIn('id', items.map(i => i.empleado_id))

  await db('nomina_detalles').where('nomina_id', nomina.id).delete()

  const T = { valor: 0, ss: 0, horas: 0, otros: 0, ded: 0 }
  for (const emp of empleados) {
    const input = items.find(i => i.empleado_id === emp.id) || {}
    const det = liquidarEmpleado(emp, input)
    await db('nomina_detalles').insert({
      nomina_id: nomina.id,
      empleado_id: emp.id,
      ...det,
    })
    T.valor += det.total_nomina
    T.ss += det.total_planilla
    T.horas += det.horas_extras
    T.otros += det.otros_ingresos + det.ingreso_noc
    T.ded += det.deducciones
  }

  await db('nominas').where('id', nomina.id).update({
    nombre_periodo: req.body.nombre_periodo || nomina.nombre_periodo,
    num_empleados: empleados.length,
    valor_total: round2(T.valor),
    total_seguridad_social: round2(T.ss),
    total_horas_extras: round2(T.horas),
    total_otros_pagos: round2(T.otros),
    total_deducciones: round2(T.ded),
    status: 'liquidada',
  })

  const actualizada = await db('nominas').where('id', nomina.id).first()
  const detalles = await db('nomina_detalles').where('nomina_id', nomina.id)
  res.json({ nomina: actualizada, detalles })
}

// POST /nominas/:id/planilla - genera la planilla PILA desde la nomina liquidada
export async function generarPlanilla(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }
  if (nomina.status !== 'liquidada' && nomina.status !== 'pagada') {
    return res.status(400).json({ error: 'La nomina debe estar liquidada' })
  }

  // Reutilizar planilla existente para la misma nomina (idempotente)
  const existente = await db('planillas').where('nomina_id', nomina.id).first()
  if (existente) {
    return res.json({ planilla: existente, existente: true })
  }

  const [id] = await db('planillas').insert({
    empresa_id: nomina.empresa_id,
    nomina_id: nomina.id,
    periodo: nomina.nombre_periodo,
    valor_total: nomina.total_seguridad_social || 0,
    status: 'generada',
  })
  const planilla = await db('planillas').where('id', id).first()
  res.status(201).json({ planilla })
}

// DELETE /nominas/:id - admin elimina (cascade detalles)
export async function remove(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  await db('nominas').where('id', nomina.id).delete()
  res.json({ message: 'Nomina eliminada' })
}

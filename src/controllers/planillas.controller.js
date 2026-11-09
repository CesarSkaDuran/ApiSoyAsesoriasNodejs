import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { notificarAdmins, notificarCambioEstado } from '../services/notificaciones.js'

const ESTADOS = ['solicitada', 'generada', 'pagada', 'verificada']

function validarIngresos(body) {
  const mensual = Number(body.ingreso_mensual)
  const adicional = body.ingreso_adicional === undefined || body.ingreso_adicional === null || body.ingreso_adicional === ''
    ? 0
    : Number(body.ingreso_adicional)
  if (!Number.isFinite(mensual) || mensual < 0 || !Number.isFinite(adicional) || adicional < 0 || mensual + adicional <= 0) {
    return null
  }
  return { ingreso_mensual: mensual, ingreso_adicional: adicional, ingreso_total: mensual + adicional }
}

// Planillas PILA de seguridad social.
// GET /planillas?empresa_id=&periodo=&status=&page=&per_page=
export async function list(req, res) {
  const { periodo, status, page = 1, per_page = 25 } = req.query
  const empresaId = esStaff(req.user) ? req.query.empresa_id : req.user.empresa_id
  const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null
  if (req.query.sucursal_id && (!Number.isInteger(sucursalId) || sucursalId < 1)) {
    return res.status(400).json({ error: 'sucursal_id no válido' })
  }
  if (sucursalId) {
    const sucursal = await db('sucursales').where('id', sucursalId).first('id', 'empresa_id')
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' })
    if (empresaId && Number(sucursal.empresa_id) !== Number(empresaId)) {
      return res.status(400).json({ error: 'La sucursal no pertenece a la empresa filtrada' })
    }
    if (!esStaff(req.user) && Number(sucursal.empresa_id) !== Number(req.user.empresa_id)) {
      return res.status(403).json({ error: 'Sin acceso a esta sucursal' })
    }
  }

  const query = db('planillas')
    .leftJoin('empresas', 'planillas.empresa_id', 'empresas.id')
    .leftJoin('personas', 'planillas.persona_id', 'personas.id')
    .leftJoin('nominas', 'planillas.nomina_id', 'nominas.id')
    .leftJoin('sucursales as s', 'planillas.sucursal_id', 's.id')
    .select('planillas.*', 'empresas.razon_social as empresa_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.segundo_nombre, personas.primer_apellido, personas.segundo_apellido) as persona_nombre"),
      db.raw('COALESCE(planillas.nombre_periodo, nominas.nombre_periodo, planillas.periodo) as nombre_periodo'),
      db.raw(`COALESCE(nominas.num_empleados,
        (SELECT COALESCE(SUM(n2.num_empleados), 0) FROM planilla_nominas pn
          JOIN nominas n2 ON n2.id=pn.nomina_id WHERE pn.planilla_id=planillas.id), 0) as num_empleados`),
      'nominas.total_otros_pagos',
      db.raw('COALESCE(planillas.sucursal_nombre, s.nombre) as sucursal_nombre'),
      db.raw('(SELECT COUNT(*) FROM planilla_nominas pn WHERE pn.planilla_id=planillas.id) as nominas_incluidas'),
      db.raw(`(SELECT COALESCE(SUM(nd.salario_base * nd.dias_laborados / 30), 0)
        FROM planilla_nominas pn2
        JOIN nomina_detalles nd ON nd.nomina_id=pn2.nomina_id
        WHERE pn2.planilla_id=planillas.id) as salario_dias`))

  if (!esStaff(req.user)) {
    if (req.user.role === 'independiente') query.where('planillas.persona_id', req.user.persona_id || -1)
    else query.where('planillas.empresa_id', req.user.empresa_id || -1)
  } else if (empresaId) {
    query.where('planillas.empresa_id', empresaId)
  }
  if (periodo) query.where('planillas.periodo', periodo)
  if (status) query.where('planillas.status', status)
  if (sucursalId) query.where('planillas.sucursal_id', sucursalId)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('planillas.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

export async function ingresos(req, res) {
  if (req.user.role !== 'independiente' || !req.user.persona_id) {
    return res.status(403).json({ error: 'Solo disponible para el independiente asociado' })
  }
  const persona = await db('personas').where('id', req.user.persona_id)
    .first('salario_base as ingreso_mensual', 'ingresos_adicionales as ingreso_adicional')
  if (!persona) return res.status(404).json({ error: 'Ficha de independiente no encontrada' })
  res.json(persona)
}

// GET /planillas/:id
export async function show(req, res) {
  const planilla = await db('planillas').where('id', req.params.id).first()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })
  const autorizado = esStaff(req.user)
    || (planilla.persona_id && req.user.role === 'independiente' && planilla.persona_id === req.user.persona_id)
    || (planilla.empresa_id && canAccessEmpresa(req.user, planilla.empresa_id))
  if (!autorizado) return res.status(403).json({ error: 'Sin acceso' })
  const [documentos, nominas] = await Promise.all([
    db('documentos').where('planilla_id', planilla.id),
    db('planilla_nominas as pn')
      .join('nominas as n', 'n.id', 'pn.nomina_id')
      .where('pn.planilla_id', planilla.id)
      .select('n.id', 'n.nombre_periodo', 'n.sucursal_id', 'n.sucursal_nombre', 'n.num_empleados', 'n.total_costo_empresa'),
  ])
  res.json({ planilla, documentos, nominas })
}

// POST /planillas - admin registra planilla generada/pagada
export async function create(req, res) {
  if (req.user.role === 'independiente') {
    const personaId = req.user.persona_id
    const periodo = String(req.body.periodo || '')
    const ingresos = validarIngresos(req.body)
    if (!personaId) return res.status(403).json({ error: 'Usuario independiente sin persona asociada' })
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return res.status(400).json({ error: 'Periodo requerido con formato AAAA-MM' })
    if (!ingresos) return res.status(400).json({ error: 'Ingrese valores válidos y un ingreso total mayor a cero' })

    let result
    try {
      result = await db.transaction(async trx => {
        const existente = await trx('planillas').where({ persona_id: personaId, periodo }).first('id')
        if (existente) return { conflict: true }
        const [id] = await trx('planillas').insert({
          empresa_id: null,
          persona_id: personaId,
          nomina_id: null,
          periodo,
          ...ingresos,
          valor_total: 0,
          status: 'solicitada',
        })
        await trx('personas').where('id', personaId).update({
          salario_base: ingresos.ingreso_mensual,
          ingresos_adicionales: ingresos.ingreso_adicional,
        })
        return { planilla: await trx('planillas').where('id', id).first() }
      })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una planilla diligenciada para este periodo' })
      throw err
    }
    if (result.conflict) return res.status(409).json({ error: 'Ya existe una planilla diligenciada para este periodo' })

    res.status(201).json({ planilla: result.planilla })
    notificarAdmins({
      entidad: 'planilla', entidadId: result.planilla.id,
      titulo: 'Nueva planilla de independiente',
      mensaje: `Planilla del periodo ${periodo} recibida. Ingreso base diligenciado: $${ingresos.ingreso_total}.`,
      url: '/admin/planillas', userId: req.user.id,
    })
    return
  }

  if (!esStaff(req.user)) return res.status(403).json({ error: 'Sin permiso para esta accion' })
  const { empresa_id, nomina_id, sucursal_id, numero_planilla, periodo, valor_total, fecha_pago } = req.body
  if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' })
  if (nomina_id) {
    const nomina = await db('nominas').where({ id: nomina_id, empresa_id }).first('id')
    if (!nomina) return res.status(400).json({ error: 'La nómina no pertenece a la empresa indicada' })
  }
  if (sucursal_id) {
    const sucursal = await db('sucursales').where({ id: sucursal_id, empresa_id, activo: true }).first('id')
    if (!sucursal) return res.status(400).json({ error: 'La sucursal no pertenece a la empresa o está inactiva' })
  }

  const [id] = await db('planillas').insert({
    empresa_id,
    nomina_id: nomina_id || null,
    sucursal_id: sucursal_id || null,
    numero_planilla: numero_planilla || null,
    periodo: periodo || null,
    valor_total: valor_total ?? 0,
    fecha_pago: fecha_pago || null,
    status: 'generada',
  })
  if (nomina_id) {
    await db('planilla_nominas').insert({ planilla_id: id, nomina_id })
  }
  const planilla = await db('planillas').where('id', id).first()
  res.status(201).json({ planilla })
}

// PUT /planillas/:id - admin actualiza estado (pagada/verificada)
export async function update(req, res) {
  const planilla = await db('planillas').where('id', req.params.id).first()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })

  if (!esStaff(req.user)) {
    if (req.user.role !== 'independiente' || planilla.persona_id !== req.user.persona_id) {
      return res.status(403).json({ error: 'Sin acceso' })
    }
    if (planilla.status !== 'solicitada') {
      return res.status(409).json({ error: 'Solo puedes editar una planilla en estado solicitada' })
    }
    const periodo = String(req.body.periodo ?? planilla.periodo ?? '')
    const ingresos = validarIngresos({
      ingreso_mensual: req.body.ingreso_mensual ?? planilla.ingreso_mensual,
      ingreso_adicional: req.body.ingreso_adicional ?? planilla.ingreso_adicional,
    })
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return res.status(400).json({ error: 'Periodo requerido con formato AAAA-MM' })
    if (!ingresos) return res.status(400).json({ error: 'Ingrese valores válidos y un ingreso total mayor a cero' })
    const duplicada = await db('planillas').where({ persona_id: planilla.persona_id, periodo }).whereNot('id', planilla.id).first('id')
    if (duplicada) return res.status(409).json({ error: 'Ya existe una planilla diligenciada para este periodo' })
    try {
      await db.transaction(async trx => {
        await trx('planillas').where('id', planilla.id).update({ periodo, ...ingresos })
        await trx('personas').where('id', planilla.persona_id).update({
          salario_base: ingresos.ingreso_mensual,
          ingresos_adicionales: ingresos.ingreso_adicional,
        })
      })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una planilla diligenciada para este periodo' })
      throw err
    }
    return res.json({ planilla: await db('planillas').where('id', planilla.id).first() })
  }

  const CAMPOS = ['numero_planilla', 'periodo', 'valor_total', 'fecha_pago', 'status', 'nomina_id']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (data.status && !ESTADOS.includes(data.status)) return res.status(400).json({ error: 'Estado de planilla no válido' })
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('planillas').where('id', planilla.id).update(data)
  const updated = await db('planillas').where('id', planilla.id).first()
  if (planilla.persona_id && data.status && data.status !== planilla.status) {
    notificarCambioEstado({
      entidad: 'planilla', entidadId: planilla.id,
      titulo: `Planilla ${planilla.periodo || ''}`.trim(),
      estadoAnterior: planilla.status, estadoNuevo: data.status,
      personaId: planilla.persona_id, url: '/admin/planillas',
    })
  }
  res.json({ planilla: updated })
}

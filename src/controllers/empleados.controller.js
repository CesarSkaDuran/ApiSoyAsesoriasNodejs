import db from '../db/knex.js'
import { canAccessEmpresa } from '../middlewares/auth.js'

const CAMPOS = [
  'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido',
  'tipo_documento', 'numero_documento', 'direccion', 'movil', 'email',
  'fecha_ingreso', 'fecha_retiro', 'salario_base', 'subsidio_transporte', 'auxilio_transporte_mode',
  'tipo_contrato', 'periodo_pago', 'riesgo', 'tipo_vinculacion',
  'observaciones', 'status', 'sucursal_id', 'cargo_id', 'eps_id',
  'arl_id', 'pension_id', 'caja_cf_id', 'ciudad_id',
  // Datos PILA (Res. 2388/2016) — solo alimentan el archivo plano
  'tipo_cotizante', 'subtipo_cotizante', 'tipo_trabajador', 'subtipo_trabajador',
  'salario_integral', 'extranjero_sin_pension', 'colombiano_exterior', 'salario_variable',
  'salario_menor_motivo',
]

// SMMLV de la última vigencia configurada (para la regla de salario bajo mínimo)
async function smmlvVigente() {
  const p = await db('nomina_parametros').orderBy('vigencia', 'desc').first()
  return Number(p?.salario_minimo) || 0
}

// Salario bajo el SMMLV exige motivo en la ficha (CST art. 143)
async function validarSalarioMinimo(res, salario, motivo) {
  const minimo = await smmlvVigente()
  if (minimo && Number(salario) < minimo && !String(motivo || '').trim()) {
    res.status(400).json({
      error: 'Salario inferior al SMMLV vigente requiere salario_menor_motivo (ej. medio tiempo, contrato especial)',
    })
    return false
  }
  return true
}

// Salario integral (CST art. 132): piso = 10 SMMLV × (1 + factor
// prestacional de la empresa; mínimo legal 30% → piso default 13 SMMLV).
// Bloqueante: un integral por debajo del piso es jurídicamente inválido.
async function validarSalarioIntegral(res, empresaId, integral, salario) {
  const esIntegral = integral === true || integral === 1 || integral === '1' || integral === 'true'
  if (!esIntegral) return true
  const minimo = await smmlvVigente()
  const empresa = await db('empresas').where('id', empresaId).first()
  const factor = Number(empresa?.factor_prestacional_pct ?? 30)
  const piso = Math.round(minimo * 10 * (1 + factor / 100))
  if (minimo && Number(salario) < piso) {
    res.status(400).json({
      error: `El salario integral debe ser ≥ $${piso.toLocaleString('es-CO')} (10 SMMLV × (1 + ${factor}% factor prestacional, CST art. 132). Recibido: $${Number(salario || 0).toLocaleString('es-CO')}`,
    })
    return false
  }
  return true
}

const NOMBRE_CAMPOS = ['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido']

// Consistencia de datos: nombres en mayúsculas, sin espacios sobrantes
// (PILA y certificados esperan MAYÚSCULAS). Vacíos quedan en null para
// que la validación de requeridos siga funcionando.
function normalizarNombres(data) {
  for (const campo of NOMBRE_CAMPOS) {
    if (typeof data[campo] === 'string') {
      const v = data[campo].trim().replace(/\s+/g, ' ').toUpperCase()
      data[campo] = v || null
    }
  }
  return data
}

// GET /empleados - scoped: empresa ve solo los suyos; admin filtra por ?empresa_id
export async function list(req, res) {
  const empresaId = req.user.role === 'admin'
    ? req.query.empresa_id
    : req.user.empresa_id

  if (req.user.role !== 'admin' && !empresaId) {
    return res.status(400).json({ error: 'empresa_id requerido' })
  }

  const { search, status = 'activo', desde, hasta, page = 1, per_page = 25 } = req.query

  const query = db('empleados')
    .leftJoin('empresas', 'empleados.empresa_id', 'empresas.id')
    .leftJoin('cargos', 'empleados.cargo_id', 'cargos.id')
    .leftJoin('eps', 'empleados.eps_id', 'eps.id')
    .select('empleados.*', 'empresas.razon_social as empresa_nombre',
      'cargos.nombre as cargo_nombre', 'eps.nombre as eps_nombre')

  if (empresaId) query.where('empleados.empresa_id', empresaId)

  if (search) {
    query.where(q =>
      q.where('empleados.primer_nombre', 'like', `%${search}%`)
       .orWhere('empleados.primer_apellido', 'like', `%${search}%`)
       .orWhere('empleados.numero_documento', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
    )
  }
  if (status && status !== 'todos') query.where('empleados.status', status)
  if (desde) query.where('empleados.fecha_ingreso', '>=', desde)
  if (hasta) query.where('empleados.fecha_ingreso', '<=', hasta)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('empleados.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /empleados/:id
export async function show(req, res) {
  const empleado = await db('empleados').where('id', req.params.id).first()
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' })
  if (!canAccessEmpresa(req.user, empleado.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a este empleado' })
  }

  // Nombres de los catálogos para la ficha (la tabla solo guarda ids)
  const [beneficiarios, documentos, incapacidades, joins] = await Promise.all([
    db('beneficiados').where('empleado_id', empleado.id),
    db('documentos').where('empleado_id', empleado.id).orderBy('id', 'desc'),
    db('incapacidades').where('empleado_id', empleado.id).orderBy('id', 'desc'),
    db('empleados')
      .leftJoin('empresas', 'empleados.empresa_id', 'empresas.id')
      .leftJoin('cargos', 'empleados.cargo_id', 'cargos.id')
      .leftJoin('eps', 'empleados.eps_id', 'eps.id')
      .leftJoin('arl', 'empleados.arl_id', 'arl.id')
      .leftJoin('pensiones', 'empleados.pension_id', 'pensiones.id')
      .leftJoin('cajas_compensacion', 'empleados.caja_cf_id', 'cajas_compensacion.id')
      .where('empleados.id', empleado.id)
      .select(
        'empresas.razon_social as empresa_nombre',
        'cargos.nombre as cargo_nombre',
        'eps.nombre as eps_nombre',
        'arl.nombre as arl_nombre',
        'pensiones.nombre as pension_nombre',
        'cajas_compensacion.nombre as caja_cf_nombre',
      )
      .first(),
  ])

  res.json({ empleado: { ...empleado, ...joins }, beneficiarios, documentos, incapacidades })
}

// POST /empleados - empresa_id: admin lo elige; empresa usa el suyo siempre
export async function create(req, res) {
  const empresaId = req.user.role === 'admin'
    ? req.body.empresa_id
    : req.user.empresa_id

  if (!empresaId) return res.status(400).json({ error: 'empresa_id requerido' })

  const data = { empresa_id: empresaId }
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  normalizarNombres(data)
  if (!data.primer_nombre || !data.numero_documento) {
    return res.status(400).json({ error: 'primer_nombre y numero_documento son requeridos' })
  }
  if (!await validarSalarioMinimo(res, data.salario_base, data.salario_menor_motivo)) return
  if (!await validarSalarioIntegral(res, empresaId, data.salario_integral, data.salario_base)) return

  try {
    const [id] = await db('empleados').insert(data)
    const empleado = await db('empleados').where('id', id).first()
    res.status(201).json({ empleado })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un empleado con ese documento en esta empresa' })
    }
    throw err
  }
}

// PUT /empleados/:id
export async function update(req, res) {
  const empleado = await db('empleados').where('id', req.params.id).first()
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' })
  if (!canAccessEmpresa(req.user, empleado.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a este empleado' })
  }

  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  normalizarNombres(data)
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' })
  }
  const salario = data.salario_base ?? empleado.salario_base
  const motivo = data.salario_menor_motivo ?? empleado.salario_menor_motivo
  if (!await validarSalarioMinimo(res, salario, motivo)) return
  const integral = data.salario_integral ?? empleado.salario_integral
  if (!await validarSalarioIntegral(res, empleado.empresa_id, integral, salario)) return

  await db('empleados').where('id', empleado.id).update(data)
  const actualizado = await db('empleados').where('id', empleado.id).first()
  res.json({ empleado: actualizado })
}

// DELETE /empleados/:id - soft delete: marca retirado
export async function remove(req, res) {
  const empleado = await db('empleados').where('id', req.params.id).first()
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' })
  if (!canAccessEmpresa(req.user, empleado.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a este empleado' })
  }

  await db('empleados').where('id', empleado.id).update({
    status: 'retirado',
    fecha_retiro: new Date(),
  })
  res.json({ message: 'Empleado retirado' })
}

// ── Subrecursos del empleado ─────────────────────────────────────────────────

async function empleadoAcceso(req, res) {
  const empleado = await db('empleados').where('id', req.params.id).first()
  if (!empleado) { res.status(404).json({ error: 'Empleado no encontrado' }); return null }
  if (!canAccessEmpresa(req.user, empleado.empresa_id)) {
    res.status(403).json({ error: 'Sin acceso a este empleado' }); return null
  }
  return empleado
}

const INCAPACIDAD_TIPOS = new Set([
  'comun', 'laboral', 'maternidad', 'paternidad', 'no_remunerada', 'vacaciones', 'otra',
])

function fechaUtc(fecha) {
  const valor = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null
  const ms = Date.parse(`${valor}T00:00:00Z`)
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== valor ? null : ms
}

function diasIncluidos(inicio, fin) {
  const desde = fechaUtc(inicio)
  const hasta = fechaUtc(fin)
  return desde === null || hasta === null || hasta < desde
    ? null
    : Math.floor((hasta - desde) / 86_400_000) + 1
}

async function datosNuevaIncapacidad(empleado, body) {
  const tipo = INCAPACIDAD_TIPOS.has(body.tipo) ? body.tipo : 'comun'
  if (!INCAPACIDAD_TIPOS.has(body.tipo || 'comun')) {
    return { error: 'Tipo de incapacidad o licencia no válido' }
  }
  const dias = diasIncluidos(body.fecha_inicio, body.fecha_fin)
  if (dias === null) return { error: 'Indica fechas válidas y una fecha fin igual o posterior al inicio' }
  const requiereCertificado = ['comun', 'laboral', 'maternidad', 'paternidad'].includes(tipo)
  if (requiereCertificado && !body.fecha_expedicion) {
    return { error: 'La fecha de expedición del certificado es obligatoria para incapacidades y licencias médicas' }
  }
  if (body.fecha_expedicion && fechaUtc(body.fecha_expedicion) === null) {
    return { error: 'La fecha de expedición del certificado no es válida' }
  }

  const origen = tipo === 'comun' || tipo === 'laboral' ? tipo : null
  let diasAcumulado = 0
  const prorrogaDeId = Number(body.prorroga_de_id) || null
  if (prorrogaDeId) {
    if (!['comun', 'laboral'].includes(tipo)) {
      return { error: 'Solo una incapacidad común o laboral puede registrarse como prórroga' }
    }
    const anterior = await db('incapacidades')
      .where({ id: prorrogaDeId, empleado_id: empleado.id }).first()
    if (!anterior || anterior.tipo !== tipo || !anterior.fecha_fin) {
      return { error: 'La incapacidad anterior no existe, no corresponde al mismo empleado/origen o no tiene fecha fin' }
    }
    const finAnterior = fechaUtc(anterior.fecha_fin)
    const inicioActual = fechaUtc(body.fecha_inicio)
    const interrupcion = finAnterior === null || inicioActual === null
      ? Infinity
      : Math.floor((inicioActual - finAnterior) / 86_400_000) - 1
    if (interrupcion < 0 || interrupcion > 30) {
      return { error: 'La prórroga debe iniciar después de la incapacidad anterior y con máximo 30 días calendario de interrupción' }
    }
    const diasAnteriores = Number(anterior.dias) || diasIncluidos(anterior.fecha_inicio, anterior.fecha_fin) || 0
    diasAcumulado = Number(anterior.dias_acumulado || 0) + diasAnteriores
  }

  return {
    empleado_id: empleado.id,
    eps_id: ['comun', 'maternidad', 'paternidad'].includes(tipo)
      ? (Number(body.eps_id) || empleado.eps_id || null)
      : null,
    arl_id: tipo === 'laboral' ? (Number(body.arl_id) || empleado.arl_id || null) : null,
    fecha_inicio: body.fecha_inicio,
    fecha_fin: body.fecha_fin,
    fecha_expedicion: body.fecha_expedicion || null,
    dias,
    dias_acumulado: diasAcumulado,
    prorroga_de_id: prorrogaDeId,
    origen,
    retroactiva: body.retroactiva === true || body.retroactiva === 1 || body.retroactiva === '1',
    numero_certificado: String(body.numero_certificado || '').trim() || null,
    tipo,
    valor: Number(body.valor) > 0 ? Number(body.valor) : null,
    status: 'reportada',
  }
}

// POST /empleados/:id/beneficiarios
export async function addBeneficiario(req, res) {
  const empleado = await empleadoAcceso(req, res)
  if (!empleado) return
  const { nombre, parentesco, num_documento, fecha_nacimiento } = req.body
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' })

  const [id] = await db('beneficiados').insert({
    empleado_id: empleado.id,
    nombre,
    parentesco: parentesco || null,
    num_documento: num_documento || null,
    fecha_nacimiento: fecha_nacimiento || null,
  })
  res.status(201).json({ beneficiario: await db('beneficiados').where('id', id).first() })
}

// DELETE /empleados/:id/beneficiarios/:bid
export async function removeBeneficiario(req, res) {
  const empleado = await empleadoAcceso(req, res)
  if (!empleado) return
  const b = await db('beneficiados')
    .where({ id: req.params.bid, empleado_id: empleado.id }).first()
  if (!b) return res.status(404).json({ error: 'Beneficiario no encontrado' })
  await db('beneficiados').where('id', b.id).delete()
  res.json({ message: 'Beneficiario eliminado' })
}

// POST /empleados/:id/incapacidades
export async function addIncapacidad(req, res) {
  const empleado = await empleadoAcceso(req, res)
  if (!empleado) return
  const data = await datosNuevaIncapacidad(empleado, req.body || {})
  if (data.error) return res.status(400).json({ error: data.error })

  const [id] = await db('incapacidades').insert(data)
  res.status(201).json({ incapacidad: await db('incapacidades').where('id', id).first() })
}

// PUT /empleados/:id/incapacidades/:iid - admin o empresa: estado/datos
export async function updateIncapacidad(req, res) {
  const empleado = await empleadoAcceso(req, res)
  if (!empleado) return
  const inc = await db('incapacidades')
    .where({ id: req.params.iid, empleado_id: empleado.id }).first()
  if (!inc) return res.status(404).json({ error: 'Incapacidad no encontrada' })

  const data = {}
  for (const c of ['eps_id', 'arl_id', 'fecha_expedicion', 'numero_certificado', 'retroactiva', 'valor', 'status']) {
    if (req.body[c] !== undefined) data[c] = req.body[c]
  }
  await db('incapacidades').where('id', inc.id).update(data)
  res.json({ incapacidad: await db('incapacidades').where('id', inc.id).first() })
}

// DELETE /empleados/:id/incapacidades/:iid
export async function removeIncapacidad(req, res) {
  const empleado = await empleadoAcceso(req, res)
  if (!empleado) return
  const inc = await db('incapacidades')
    .where({ id: req.params.iid, empleado_id: empleado.id }).first()
  if (!inc) return res.status(404).json({ error: 'Incapacidad no encontrada' })
  await db('incapacidades').where('id', inc.id).delete()
  res.json({ message: 'Incapacidad eliminada' })
}

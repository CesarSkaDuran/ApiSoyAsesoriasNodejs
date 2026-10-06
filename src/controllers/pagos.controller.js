import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { notificarCambioEstado } from '../services/notificaciones.js'

// Cuentas de cobro (viejo cuenta_cobro). status: 1=Pagado 2=Pendiente
// 3=En tramite 4=Activo 5=Rechazado
const ESTADO_LABEL = { 1: 'Pagada', 2: 'Pendiente', 3: 'En trámite', 4: 'Activa', 5: 'Rechazada' }
const labelEstado = (s) => ESTADO_LABEL[Number(s)] || `Estado ${s}`

// GET /pagos?empresa_id=&status=&search=&page=&per_page=
export async function list(req, res) {
  const { search, status, concepto, sucursal_id, desde, hasta, page = 1, per_page = 25 } = req.query
  const empresaId = esStaff(req.user) ? req.query.empresa_id : req.user.empresa_id

  const query = db('cuentas_cobro')
    .leftJoin('empresas', 'cuentas_cobro.empresa_id', 'empresas.id')
    .leftJoin('personas', 'cuentas_cobro.persona_id', 'personas.id')
    .leftJoin('terceros', 'cuentas_cobro.tercero_id', 'terceros.id')
    .leftJoin('sucursales', 'cuentas_cobro.sucursal_id', 'sucursales.id')
    .select(
      'cuentas_cobro.*',
      'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'empresas.dv as empresa_dv',
      'personas.num_documento as persona_nit',
      'terceros.nombre as tercero_nombre',
      'terceros.num_documento as tercero_nit',
      'sucursales.nombre as sucursal_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido),
        terceros.nombre) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento, terceros.num_documento) as cliente_nit`),
    )

  if (!esStaff(req.user)) {
    query.where(q => {
      if (req.user.empresa_id) q.where('cuentas_cobro.empresa_id', req.user.empresa_id)
      if (req.user.persona_id) q.orWhere('cuentas_cobro.persona_id', req.user.persona_id)
      if (!req.user.empresa_id && !req.user.persona_id) q.whereRaw('1=0')
    })
  } else if (empresaId) {
    query.where('cuentas_cobro.empresa_id', empresaId)
  }

  if (status) query.where('cuentas_cobro.status', status)
  if (concepto) query.where('cuentas_cobro.nombre', 'like', `%${concepto}%`)
  if (sucursal_id) query.where('cuentas_cobro.sucursal_id', sucursal_id)
  if (desde) query.where('cuentas_cobro.fecha', '>=', desde)
  if (hasta) query.where('cuentas_cobro.fecha', '<=', hasta)
  if (search) {
    query.where(q =>
      q.where('cuentas_cobro.nombre', 'like', `%${search}%`)
       .orWhere('cuentas_cobro.numero', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
       .orWhere('empresas.num_documento', 'like', `%${search}%`)
       .orWhere('personas.num_documento', 'like', `%${search}%`)
       .orWhere('terceros.nombre', 'like', `%${search}%`)
       .orWhere('terceros.num_documento', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('cuentas_cobro.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /pagos/:id
export async function show(req, res) {
  const cuenta = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!cuenta) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  if (!canAccessEmpresa(req.user, cuenta.empresa_id) && cuenta.persona_id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  const detalle = await db('detalle_cobro').where('cuenta_cobro_id', cuenta.id)
  res.json({ cuenta, detalle })
}

// POST /pagos - admin crea cuenta de cobro
export async function create(req, res) {
  const { empresa_id, persona_id, tercero_id, sucursal_id, tipo, nombre, banco,
          meses, fecha, valor_total, iva, cuatroxmil, obs } = req.body
  if (!empresa_id && !persona_id && !tercero_id) {
    return res.status(400).json({ error: 'empresa_id, persona_id o tercero_id requerido' })
  }

  const [id] = await db('cuentas_cobro').insert({
    empresa_id: empresa_id || null,
    persona_id: persona_id || null,
    tercero_id: tercero_id || null,
    sucursal_id: sucursal_id || null,
    tipo: tipo ?? 1,
    nombre: nombre || null,
    banco: banco || null,
    meses: meses || null,
    fecha: fecha || new Date(),
    valor_total: valor_total ?? 0,
    iva: iva ?? 0,
    cuatroxmil: cuatroxmil ?? 0,
    obs: obs || null,
    status: 2, // pendiente
  })
  const cuenta = await db('cuentas_cobro').where('id', id).first()
  res.status(201).json({ cuenta })
}

// PUT /pagos/:id - admin: cambiar estado o datos
export async function update(req, res) {
  const cuenta = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!cuenta) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })

  const CAMPOS = ['empresa_id', 'persona_id', 'tercero_id', 'sucursal_id', 'tipo',
    'nombre', 'banco', 'meses', 'fecha', 'valor_total', 'iva', 'cuatroxmil', 'obs', 'status']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('cuentas_cobro').where('id', cuenta.id).update(data)
  res.json({ cuenta: await db('cuentas_cobro').where('id', cuenta.id).first() })

  if (data.status !== undefined && Number(data.status) !== Number(cuenta.status)) {
    notificarCambioEstado({
      entidad: 'pago', entidadId: cuenta.id,
      titulo: `Cuenta de cobro ${cuenta.numero ? '#' + cuenta.numero : '#' + cuenta.id}`,
      estadoAnterior: labelEstado(cuenta.status), estadoNuevo: labelEstado(data.status),
      url: '/admin/pagos',
      empresaId: cuenta.empresa_id, personaId: cuenta.persona_id,
      detalle: `<b>Estado anterior:</b> ${labelEstado(cuenta.status)}<br><b>Estado nuevo:</b> ${labelEstado(data.status)}<br><b>Valor:</b> $${Number(cuenta.valor_total || 0).toLocaleString('es-CO')}`,
    })
  }
}

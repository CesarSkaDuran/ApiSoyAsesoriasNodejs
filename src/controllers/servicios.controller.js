import db from '../db/knex.js'
import { canAccessEmpresa } from '../middlewares/auth.js'

// Registros de servicios prestados (viejo detalle_servicios).
// status: 1=Pendiente 2=Finalizado 3=Verificado 4=En tramite 5=Cancelado
// status_pago: 1=Pagado 2=Pendiente 3=Cancelado

// GET /servicio-registros?empresa_id=&nombre=&status=&status_pago=&search=&page=&per_page=
export async function listRegistros(req, res) {
  const { search, nombre, status, status_pago, desde, hasta, page = 1, per_page = 25 } = req.query

  const empresaId = req.user.role === 'admin' ? req.query.empresa_id : req.user.empresa_id

  const query = db('servicio_registros')
    .leftJoin('empresas', 'servicio_registros.empresa_id', 'empresas.id')
    .leftJoin('personas', 'servicio_registros.persona_id', 'personas.id')
    .leftJoin('empleados', 'servicio_registros.empleado_id', 'empleados.id')
    .leftJoin('sucursales', 'servicio_registros.sucursal_id', 'sucursales.id')
    .select(
      'servicio_registros.*',
      'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'empresas.dv as empresa_dv',
      'empresas.representante_legal',
      'empresas.telefono_contacto',
      'personas.num_documento as persona_nit',
      'personas.telefono as persona_telefono',
      'sucursales.nombre as sucursal_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw("CONCAT_WS(' ', empleados.primer_nombre, empleados.primer_apellido) as empleado_nombre"),
      db.raw(`CASE WHEN servicio_registros.persona_id IS NOT NULL THEN 'Independiente' ELSE 'Empresa' END as tipo_cliente`),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido)) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento) as cliente_nit`),
      db.raw(`COALESCE(empresas.representante_legal,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido)) as representante`),
      db.raw(`COALESCE(empresas.telefono_contacto, personas.telefono) as telefono`),
    )

  if (req.user.role !== 'admin') {
    // empresa/independiente: solo lo suyo
    query.where(q => {
      if (req.user.empresa_id) q.where('servicio_registros.empresa_id', req.user.empresa_id)
      if (req.user.persona_id) q.orWhere('servicio_registros.persona_id', req.user.persona_id)
      if (!req.user.empresa_id && !req.user.persona_id) q.whereRaw('1=0')
    })
  } else if (empresaId) {
    query.where('servicio_registros.empresa_id', empresaId)
  }

  if (nombre) query.where('servicio_registros.nombre', 'like', `%${nombre}%`)
  if (status) query.where('servicio_registros.status', status)
  if (status_pago) query.where('servicio_registros.status_pago', status_pago)
  if (desde) query.where('servicio_registros.fecha', '>=', desde)
  if (hasta) query.where('servicio_registros.fecha', '<=', hasta)
  if (search) {
    query.where(q =>
      q.where('servicio_registros.nombre', 'like', `%${search}%`)
       .orWhere('servicio_registros.paquete', 'like', `%${search}%`)
       .orWhere('servicio_registros.obs', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('servicio_registros.fecha', 'desc')
    .orderBy('servicio_registros.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /servicio-registros/:id
export async function showRegistro(req, res) {
  const registro = await db('servicio_registros').where('id', req.params.id).first()
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' })
  if (!canAccessEmpresa(req.user, registro.empresa_id) && registro.persona_id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  res.json({ registro })
}

// POST /servicio-registros - admin o cliente solicita un servicio
export async function createRegistro(req, res) {
  const empresaId = req.user.role === 'admin' ? req.body.empresa_id : req.user.empresa_id
  const personaId = req.user.role === 'admin' ? req.body.persona_id : req.user.persona_id
  if (!empresaId && !personaId) return res.status(400).json({ error: 'empresa_id o persona_id requerido' })

  const data = {
    empresa_id: empresaId || null,
    persona_id: personaId || null,
    empleado_id: req.body.empleado_id || null,
    servicio_id: req.body.servicio_id || null,
    nombre: req.body.nombre || null,
    tipo: req.body.tipo ?? 1,
    fecha: req.body.fecha || new Date(),
    cantidad: req.body.cantidad ?? 1,
    valor: req.body.valor || null,
    paquete: req.body.paquete || null,
    unidad: req.body.unidad || null,
    numero_empleados: req.body.numero_empleados ?? 0,
    obs: req.body.obs || null,
    status: 1,          // pendiente
    status_pago: 2,     // pendiente
  }
  const [id] = await db('servicio_registros').insert(data)
  const registro = await db('servicio_registros').where('id', id).first()
  res.status(201).json({ registro })
}

// PUT /servicio-registros/:id - admin actualiza estado / estado de pago / datos
export async function updateRegistro(req, res) {
  const registro = await db('servicio_registros').where('id', req.params.id).first()
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' })

  const CAMPOS = ['nombre', 'fecha', 'cantidad', 'valor', 'paquete', 'unidad',
    'numero_empleados', 'obs', 'status', 'status_pago', 'empleado_id', 'servicio_id']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  // El cliente solo puede pedir; cambiar estados es del admin
  if (req.user.role !== 'admin') {
    delete data.status
    delete data.status_pago
    delete data.valor
    if (!canAccessEmpresa(req.user, registro.empresa_id) && registro.persona_id !== req.user.persona_id) {
      return res.status(403).json({ error: 'Sin acceso' })
    }
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('servicio_registros').where('id', registro.id).update(data)
  res.json({ registro: await db('servicio_registros').where('id', registro.id).first() })
}

// GET /servicios-catalogo - catalogo de servicios/planes (tipo=servicio|plan)
export async function listCatalogo(req, res) {
  const data = await db('servicios').where('activo', true).orderBy('nombre')
  res.json({ data })
}

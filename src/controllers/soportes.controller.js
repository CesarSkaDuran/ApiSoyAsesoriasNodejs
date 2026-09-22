import db from '../db/knex.js'

// Tickets de soporte (viejo soporte). status numerico: 1=Pendiente
// 2=En proceso 3=Resuelto 4=Cerrado 5=Rechazado

// GET /soportes?status=&page=&per_page= - admin ve todos; cliente solo los suyos
export async function list(req, res) {
  const { search, status, desde, hasta, page = 1, per_page = 25 } = req.query

  const query = db('soportes')
    .leftJoin('users', 'soportes.user_id', 'users.id')
    .leftJoin('empresas', 'users.id', 'empresas.user_id')
    .select('soportes.*', 'users.name as user_name', 'users.lastname as user_lastname',
      'empresas.razon_social as empresa_nombre')

  if (req.user.role !== 'admin') query.where('soportes.user_id', req.user.id)
  if (status) query.where('soportes.status', status)
  if (desde) query.where('soportes.created_at', '>=', `${desde} 00:00:00`)
  if (hasta) query.where('soportes.created_at', '<=', `${hasta} 23:59:59`)
  if (search) {
    query.where(q =>
      q.where('soportes.nombre', 'like', `%${search}%`)
       .orWhere('soportes.email', 'like', `%${search}%`)
       .orWhere('soportes.telefono', 'like', `%${search}%`)
       .orWhere('soportes.asunto', 'like', `%${search}%`)
       .orWhere('soportes.tipo_servicio', 'like', `%${search}%`)
       .orWhere('soportes.mensaje', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('soportes.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// POST /soportes - cualquier usuario autenticado crea ticket
export async function create(req, res) {
  const { asunto, mensaje, tipo_solicitud, tipo_servicio, nombre, email, telefono } = req.body
  if (!asunto && !tipo_servicio) return res.status(400).json({ error: 'asunto o tipo_servicio requerido' })

  const [id] = await db('soportes').insert({
    user_id: req.user.id,
    asunto: asunto || tipo_servicio,
    mensaje: mensaje || null,
    tipo_solicitud: tipo_solicitud || null,
    tipo_servicio: tipo_servicio || null,
    nombre: nombre || null,
    email: email || req.user.email,
    telefono: telefono || null,
    status: 1,
  })
  const soporte = await db('soportes').where('id', id).first()
  res.status(201).json({ soporte })
}

// PUT /soportes/:id - admin gestiona el ticket
export async function update(req, res) {
  const soporte = await db('soportes').where('id', req.params.id).first()
  if (!soporte) return res.status(404).json({ error: 'Ticket no encontrado' })
  if (req.user.role !== 'admin' && soporte.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }

  const CAMPOS = req.user.role === 'admin'
    ? ['asunto', 'mensaje', 'status', 'tipo_servicio']
    : ['mensaje']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('soportes').where('id', soporte.id).update(data)
  res.json({ soporte: await db('soportes').where('id', soporte.id).first() })
}

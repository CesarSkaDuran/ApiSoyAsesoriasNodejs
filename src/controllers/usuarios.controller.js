import db from '../db/knex.js'

// Usuarios del sistema (solo admin lista/gestiona).
// GET /usuarios?search=&role=&page=&per_page=
export async function list(req, res) {
  const { search, role, desde, hasta, page = 1, per_page = 25 } = req.query

  const query = db('users')
    .leftJoin('empresas', 'users.id', 'empresas.user_id')
    .leftJoin('personas', 'users.id', 'personas.user_id')
    .leftJoin('user_modulos', 'users.id', 'user_modulos.user_id')
    .select('users.id', 'users.name', 'users.lastname', 'users.email', 'users.role',
      'users.is_active', 'users.created_at',
      'empresas.id as empresa_id', 'empresas.razon_social as empresa_nombre',
      'personas.id as persona_id',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      'user_modulos.id as modulos_id')

  if (role) query.where('users.role', role)
  if (desde) query.where('users.created_at', '>=', `${desde} 00:00:00`)
  if (hasta) query.where('users.created_at', '<=', `${hasta} 23:59:59`)
  if (search) {
    query.where(q =>
      q.where('users.name', 'like', `%${search}%`)
       .orWhere('users.email', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('users.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /usuarios/:id - con empresa/persona/modulos asociados
export async function show(req, res) {
  const user = await db('users')
    .where('users.id', req.params.id)
    .select('users.id', 'users.name', 'users.lastname', 'users.email', 'users.role',
      'users.is_active', 'users.created_at')
    .first()
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  const [empresa, persona, modulos] = await Promise.all([
    db('empresas').where('user_id', user.id).first(),
    db('personas').where('user_id', user.id).first(),
    db('user_modulos').where('user_id', user.id).first(),
  ])
  res.json({ user, empresa, persona, modulos })
}

// PUT /usuarios/:id - activar/desactivar, cambiar modulos
export async function update(req, res) {
  const user = await db('users').where('id', req.params.id).first()
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  const { is_active, name, lastname, modulos } = req.body
  const data = {}
  if (is_active !== undefined) data.is_active = is_active
  if (name !== undefined) data.name = name
  if (lastname !== undefined) data.lastname = lastname
  if (Object.keys(data).length) {
    await db('users').where('id', user.id).update(data)
  }

  if (modulos && typeof modulos === 'object') {
    const exists = await db('user_modulos').where('user_id', user.id).first()
    const MODULOS = ['home','empresas','independientes','pagos','gastos','informes',
      'soportes','solicitudes','documentos','empleados','nominas','planillas','servicios','diagnosticos']
    const modData = {}
    for (const m of MODULOS) if (modulos[m] !== undefined) modData[m] = !!modulos[m]
    if (exists) await db('user_modulos').where('user_id', user.id).update(modData)
    else await db('user_modulos').insert({ user_id: user.id, ...modData })
  }

  const actualizado = await db('users')
    .where('id', user.id)
    .select('id', 'name', 'lastname', 'email', 'role', 'is_active').first()
  res.json({ user: actualizado })
}

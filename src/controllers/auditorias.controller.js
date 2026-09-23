import db from '../db/knex.js'

function parseJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function list(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1)
  const perPage = Math.min(Math.max(Number(req.query.per_page) || 25, 1), 100)
  const { search, accion, recurso, desde, hasta } = req.query

  const query = db('auditorias')
  if (accion) query.where('accion', accion)
  if (recurso) query.where('recurso', recurso)
  if (desde) query.where('created_at', '>=', `${desde} 00:00:00`)
  if (hasta) query.where('created_at', '<=', `${hasta} 23:59:59`)
  if (search) {
    query.where(q => q
      .where('actor_email', 'like', `%${search}%`)
      .orWhere('recurso', 'like', `%${search}%`)
      .orWhere('recurso_id', 'like', `%${search}%`)
      .orWhere('ruta', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .select('id', 'user_id', 'actor_email', 'actor_role', 'accion', 'recurso', 'recurso_id',
      'metodo', 'ruta', 'codigo_respuesta', 'ip', 'user_agent', 'campos', 'detalle', 'created_at')
    .orderBy('id', 'desc')
    .limit(perPage)
    .offset((page - 1) * perPage)

  res.json({
    data: data.map(item => ({ ...item, campos: parseJson(item.campos), detalle: parseJson(item.detalle) })),
    total: Number(total),
    page,
    per_page: perPage,
  })
}

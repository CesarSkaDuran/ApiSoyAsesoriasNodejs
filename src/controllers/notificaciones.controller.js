import db from '../db/knex.js'

export async function list(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
  const [data, unread] = await Promise.all([
    db('notificaciones')
      .select('id', 'titulo', 'mensaje', 'leida', 'tipo', 'solicitud_id', 'url', 'created_at')
      .where('user_id', req.user.id)
      .orderBy('created_at', 'desc')
      .limit(limit),
    db('notificaciones').where('user_id', req.user.id).where('leida', false).count('* as total').first(),
  ])

  res.json({
    data: data.map(notification => ({ ...notification, leida: !!notification.leida })),
    unread_count: Number(unread.total) || 0,
  })
}

export async function markRead(req, res) {
  const notification = await db('notificaciones')
    .where({ id: req.params.id, user_id: req.user.id })
    .first()
  if (!notification) return res.status(404).json({ error: 'Notificación no encontrada' })

  if (!notification.leida) {
    await db('notificaciones').where('id', notification.id).update({ leida: true })
  }
  res.json({ ok: true })
}

export async function markAllRead(req, res) {
  await db('notificaciones').where('user_id', req.user.id).where('leida', false).update({ leida: true })
  res.json({ ok: true })
}

import { publishNotification } from './socket.js'

export async function createNotifications(trx, userIds, { titulo, mensaje, tipo = 'solicitud', solicitudId, url }) {
  const recipients = [...new Set(userIds.filter(Number.isInteger))]
  const notifications = []

  for (const userId of recipients) {
    const [id] = await trx('notificaciones').insert({
      user_id: userId,
      titulo,
      mensaje,
      leida: false,
      tipo,
      solicitud_id: solicitudId ?? null,
      url: url ?? null,
    })
    const notification = await trx('notificaciones').where('id', id).first()
    notifications.push({ ...notification, leida: !!notification.leida })
  }

  return notifications
}

export function publishNotifications(notifications) {
  for (const notification of notifications) publishNotification(notification)
}

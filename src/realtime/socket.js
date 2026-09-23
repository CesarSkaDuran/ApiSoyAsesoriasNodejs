import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import db from '../db/knex.js'

let io

export function attachSocketServer(server) {
  const configuredOrigins = process.env.CORS_ORIGIN || 'http://localhost:3873,http://localhost:4200'
  io = new Server(server, {
    cors: {
      origin: configuredOrigins.trim() === '*' ? true : configuredOrigins.split(',').map(origin => origin.trim()),
      methods: ['GET', 'POST'],
    },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (typeof token !== 'string' || !token) return next(new Error('Token requerido'))

      const payload = jwt.verify(token, process.env.JWT_SECRET)
      const user = await db('users')
        .select('id', 'role', 'is_active')
        .where('id', payload.id)
        .first()

      if (!user || !user.is_active) return next(new Error('Usuario no disponible'))
      socket.data.userId = user.id
      socket.data.role = user.role
      socket.data.expiresAt = payload.exp ? payload.exp * 1000 : null
      next()
    } catch {
      next(new Error('Token invalido o expirado'))
    }
  })

  io.on('connection', socket => {
    socket.join(`user:${socket.data.userId}`)
    if (socket.data.expiresAt) {
      const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()))
      expiry.unref?.()
      socket.on('disconnect', () => clearTimeout(expiry))
    }
  })

  return io
}

export function publishNotification(notification) {
  io?.to(`user:${notification.user_id}`).emit('notification:new', notification)
}

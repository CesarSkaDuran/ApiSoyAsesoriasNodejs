import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { io as createClient } from 'socket.io-client'
import app from '../src/app.js'
import { attachSocketServer } from '../src/realtime/socket.js'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let solicitudId
let socketServer
let clientSockets = []

test('Socket.IO notifica a administradores y al cliente vinculado en tiempo real', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const server = createServer(app)
  socketServer = attachSocketServer(server)
  server.listen(0)
  await once(server, 'listening')
  const socketUrl = `http://127.0.0.1:${server.address().port}`

  const connect = token => new Promise((resolve, reject) => {
    const socket = createClient(socketUrl, { auth: token ? { token } : {}, reconnection: false })
    clientSockets.push(socket)
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })

  const [adminSocket, clientSocket] = await Promise.all([connect(admin.token), connect(empresa.token)])
  const adminEvent = once(adminSocket, 'notification:new')
  const created = await api.post('/solicitudes', {
    descripcion: 'Solicitud realtime test',
    servicio_id: 1,
  }, { token: empresa.token })
  assert.equal(created.status, 201)
  solicitudId = created.data.solicitud.id

  const adminNotification = (await adminEvent)[0]
  assert.equal(adminNotification.solicitud_id, solicitudId)

  const clientEvent = once(clientSocket, 'notification:new')
  const approved = await api.put(`/solicitudes/${solicitudId}`, { status: 'aprobada' }, { token: admin.token })
  assert.equal(approved.status, 200)
  const clientNotification = (await clientEvent)[0]
  assert.equal(clientNotification.solicitud_id, solicitudId)
  assert.match(clientNotification.mensaje, /aprobada/)
})

test.after(async () => {
  for (const socket of clientSockets) socket.disconnect()
  if (socketServer) await new Promise(resolve => socketServer.close(resolve))
  if (solicitudId) {
    await db('notificaciones').where('solicitud_id', solicitudId).delete()
    await db('servicio_registros').where('solicitud_id', solicitudId).delete()
    await db('solicitudes').where('id', solicitudId).delete()
  }
  await stopApp()
})

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
let servicioNotificationId
let documentoId
let documentoNotificationId
let documentoDeleteNotificationId
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

  const service = await db('servicio_registros').where('solicitud_id', solicitudId).first()
  assert.ok(service)
  const serviceEvent = once(clientSocket, 'notification:new')
  const serviceUpdate = await api.put(`/servicio-registros/${service.id}`, {
    status_pago: 1,
  }, { token: admin.token })
  assert.equal(serviceUpdate.status, 200)
  const serviceNotification = (await serviceEvent)[0]
  servicioNotificationId = serviceNotification.id
  assert.equal(serviceNotification.tipo, 'servicio')
  assert.match(serviceNotification.mensaje, /Pagado/)

  const [id] = await db('documentos').insert({
    empresa_id: empresa.user.empresa.id,
    uploaded_by: empresa.user.id,
    nombre: 'Archivo privado de prueba.pdf',
    path: 'realtime-document-status-test.pdf',
    mime: 'application/pdf',
    size: 1,
    estatus: 'recibido',
  })
  documentoId = id

  const documentEvent = once(clientSocket, 'notification:new')
  const statusResponse = await api.put(`/documentos/${id}`, {
    estatus: 'en_revision',
  }, { token: admin.token })
  assert.equal(statusResponse.status, 200)

  const documentNotification = (await documentEvent)[0]
  documentoNotificationId = documentNotification.id
  assert.equal(documentNotification.tipo, 'documento')
  assert.match(documentNotification.mensaje, /En revisión/)
  assert.ok(!documentNotification.mensaje.includes('Archivo privado'))

  const persisted = await api.get('/notificaciones', { token: empresa.token })
  assert.ok(persisted.data.data.some(n => n.id === documentoNotificationId))

  const unchanged = await api.put(`/documentos/${id}`, {
    estatus: 'en_revision',
  }, { token: admin.token })
  assert.equal(unchanged.status, 200)
  const [{ total }] = await db('notificaciones')
    .where('user_id', empresa.user.id)
    .where('tipo', 'documento')
    .where('mensaje', 'like', `El estado del documento #${id} cambió a:%`)
    .count('id as total')
  assert.equal(Number(total), 1, 'no debe duplicarse si el estatus no cambió')

  const adminDeleteEvent = once(adminSocket, 'notification:new')
  const deleted = await api.delete(`/documentos/${id}`, { token: empresa.token })
  assert.equal(deleted.status, 200)
  const deletionNotification = (await adminDeleteEvent)[0]
  documentoDeleteNotificationId = deletionNotification.id
  assert.equal(deletionNotification.titulo, 'Documento eliminado por un cliente')
  assert.match(deletionNotification.mensaje, new RegExp(`#${id}\\.`))
  assert.ok(!deletionNotification.mensaje.includes('Archivo privado'))
  assert.equal(await db('documentos').where('id', id).first(), undefined)
})

test.after(async () => {
  for (const socket of clientSockets) socket.disconnect()
  if (socketServer) await new Promise(resolve => socketServer.close(resolve))
  for (const id of [servicioNotificationId, documentoNotificationId, documentoDeleteNotificationId].filter(Boolean)) {
    await db('notificaciones').where('id', id).delete()
  }
  if (documentoId) await db('documentos').where('id', documentoId).delete()
  if (solicitudId) {
    await db('notificaciones').where('solicitud_id', solicitudId).delete()
    await db('servicio_registros').where('solicitud_id', solicitudId).delete()
    await db('solicitudes').where('id', solicitudId).delete()
  }
  await stopApp()
})

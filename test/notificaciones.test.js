import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

const solicitudIds = []
const servicioRegistroIds = []
const servicioNotificacionIds = []
let personaId
let independentUserId

test('solicitud aprobada y gestionada notifica al cliente y sincroniza el servicio', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const directRegistration = await api.post('/servicio-registros', {
    empresa_id: 2,
    nombre: 'No debe registrarse directamente',
  }, { token: empresa.token })
  assert.equal(directRegistration.status, 403)

  const created = await api.post('/solicitudes', {
    descripcion: 'Solicitud de prueba de notificaciones',
    servicio_id: 1,
  }, { token: empresa.token })
  assert.equal(created.status, 201)
  const id = created.data.solicitud.id
  solicitudIds.push(id)
  assert.equal(created.data.solicitud.status, 'pendiente')

  const adminNotifications = await api.get('/notificaciones', { token: admin.token })
  assert.ok(adminNotifications.data.data.some(n => n.solicitud_id === id))

  const approved = await api.put(`/solicitudes/${id}`, { status: 'aprobada' }, { token: admin.token })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.solicitud.status, 'aprobada')

  const service = await db('servicio_registros').where('solicitud_id', id).first()
  assert.ok(service, 'aprobar una solicitud debe abrir su registro de gestión')
  assert.equal(Number(service.status), 1)

  const clientNotifications = await api.get('/notificaciones', { token: empresa.token })
  const update = clientNotifications.data.data.find(n => n.solicitud_id === id && n.titulo === 'Actualización de tu solicitud')
  assert.ok(update)
  assert.ok(update.mensaje.includes('aprobada'))

  const clientMarkAdminNotification = await api.put(`/notificaciones/${adminNotifications.data.data.find(n => n.solicitud_id === id).id}/leida`, {}, { token: empresa.token })
  assert.equal(clientMarkAdminNotification.status, 404)

  const serviceUpdated = await api.put(`/servicio-registros/${service.id}`, { status: 4 }, { token: admin.token })
  assert.equal(serviceUpdated.status, 200)
  const inProgress = await api.get(`/solicitudes/${id}`, { token: empresa.token })
  assert.equal(inProgress.data.solicitud.status, 'en_proceso')

  const completed = await api.put(`/servicio-registros/${service.id}`, { status: 2 }, { token: admin.token })
  assert.equal(completed.status, 200)
  const finalRequest = await api.get(`/solicitudes/${id}`, { token: empresa.token })
  assert.equal(finalRequest.data.solicitud.status, 'completada')
})

test('notificacion de un servicio de contratos abre la categoria contratos', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const contrato = await db('servicios').whereRaw('UPPER(nombre) = ?', ['CONTRATOS']).first('id')
  assert.ok(contrato, 'el catalogo debe contener el servicio Contratos')

  const created = await api.post('/servicio-registros', {
    empresa_id: 2,
    servicio_id: contrato.id,
    nombre: 'CONTRATOS',
  }, { token: admin.token })
  assert.equal(created.status, 201)
  const serviceId = created.data.registro.id
  servicioRegistroIds.push(serviceId)

  const updated = await api.put(`/servicio-registros/${serviceId}`, { status: 4 }, { token: admin.token })
  assert.equal(updated.status, 200)

  const notifications = await api.get('/notificaciones', { token: empresa.token })
  const notification = notifications.data.data.find(n =>
    n.tipo === 'servicio' && n.mensaje?.includes('CONTRATOS — Servicio: En trámite')
  )
  assert.ok(notification, 'el cliente debe recibir la notificacion del servicio')
  assert.equal(notification.url, '/admin/servicios/contratos')
  servicioNotificacionIds.push(notification.id)
})

test('solicitudes de independientes se notifican a su usuario y conservan el scope', async () => {
  const { token: adminToken } = await loginAs(ADMIN)
  const suffix = randomUUID()
  const createdPersona = await api.post('/personas', {
    primer_nombre: 'Prueba realtime',
    primer_apellido: suffix,
    num_documento: suffix.slice(0, 20),
  }, { token: adminToken })
  assert.equal(createdPersona.status, 201)
  personaId = createdPersona.data.persona.id

  const email = `notificaciones-${suffix}@example.test`
  const createdUser = await api.post('/auth/users', {
    name: 'Prueba realtime',
    email,
    password: `Test-${suffix}!`,
    role: 'independiente',
    persona_id: personaId,
  }, { token: adminToken })
  assert.equal(createdUser.status, 201)
  independentUserId = createdUser.data.user.id

  const login = await api.post('/auth/login', { email, password: `Test-${suffix}!` })
  assert.equal(login.status, 200)
  const createdRequest = await api.post('/solicitudes', {
    servicio_id: 1,
    descripcion: 'Solicitud del independiente',
  }, { token: login.data.token })
  assert.equal(createdRequest.status, 201)
  const id = createdRequest.data.solicitud.id
  solicitudIds.push(id)

  const approved = await api.put(`/solicitudes/${id}`, { status: 'aprobada' }, { token: adminToken })
  assert.equal(approved.status, 200)
  const notifications = await api.get('/notificaciones', { token: login.data.token })
  assert.ok(notifications.data.data.some(notification => notification.solicitud_id === id))
})

test.after(async () => {
  for (const id of solicitudIds) {
    await db('notificaciones').where('solicitud_id', id).delete()
    await db('servicio_registros').where('solicitud_id', id).delete()
    await db('solicitudes').where('id', id).delete()
  }
  if (independentUserId) {
    await db('refresh_tokens').where('user_id', independentUserId).delete()
    await db('user_modulos').where('user_id', independentUserId).delete()
    await db('users').where('id', independentUserId).delete()
  }
  if (personaId) await db('personas').where('id', personaId).delete()
  if (servicioNotificacionIds.length) {
    await db('notificaciones').whereIn('id', servicioNotificacionIds).delete()
  }
  if (servicioRegistroIds.length) {
    await db('servicio_registros').whereIn('id', servicioRegistroIds).delete()
  }
  await stopApp()
})

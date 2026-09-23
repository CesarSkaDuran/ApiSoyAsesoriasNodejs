import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let solicitudId
const auditIds = []

test('auditoría registra actor y movimiento sin guardar el contenido sensible', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const privateDescription = 'Texto privado que no debe guardarse en auditoría'
  const created = await api.post('/solicitudes', {
    servicio_id: 1,
    descripcion: privateDescription,
  }, { token: empresa.token, headers: { 'x-audit-test': 'true' } })
  assert.equal(created.status, 201)
  solicitudId = created.data.solicitud.id

  const audit = await api.get(`/auditorias?recurso=solicitudes&search=${solicitudId}`, { token: admin.token })
  assert.equal(audit.status, 200)
  const entry = audit.data.data.find(item => item.recurso_id === String(solicitudId) && item.accion === 'crear')
  assert.ok(entry)
  auditIds.push(entry.id)
  assert.equal(entry.actor_email, EMPRESA.email)
  assert.ok(entry.campos.includes('descripcion'))
  assert.ok(!JSON.stringify(entry).includes(privateDescription))

  const logout = await api.post('/auth/logout', { refresh_token: empresa.refresh_token }, {
    token: empresa.token,
    headers: { 'x-audit-test': 'true' },
  })
  assert.equal(logout.status, 200)
  const logoutAudit = await api.get(`/auditorias?recurso=logout&search=${EMPRESA.email}`, { token: admin.token })
  const logoutEntry = logoutAudit.data.data.find(item => item.accion === 'cerrar_sesion')
  assert.ok(logoutEntry)
  auditIds.push(logoutEntry.id)
  assert.ok(!logoutEntry.campos.includes('refresh_token'))
  assert.ok(!JSON.stringify(logoutEntry).includes(empresa.refresh_token))

  const denied = await api.get('/auditorias', { token: empresa.token })
  assert.equal(denied.status, 403)
})

test.after(async () => {
  if (auditIds.length) await db('auditorias').whereIn('id', auditIds).delete()
  if (solicitudId) {
    await db('notificaciones').where('solicitud_id', solicitudId).delete()
    await db('solicitudes').where('id', solicitudId).delete()
  }
  await stopApp()
})

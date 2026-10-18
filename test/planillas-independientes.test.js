import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let personaId
let userId
let planillaId
let notificationPeriod

 test('el independiente diligencia su planilla con ingresos sumados y scope propio', async () => {
  const { token: adminToken } = await loginAs(ADMIN)
  const suffix = randomUUID()
  const createdPersona = await api.post('/personas', {
    primer_nombre: 'Planilla',
    primer_apellido: suffix,
    num_documento: suffix,
  }, { token: adminToken })
  assert.equal(createdPersona.status, 201)
  personaId = createdPersona.data.persona.id

  const email = `planilla-indep-${suffix}@example.test`
  const password = `Test-${suffix}!`
  const createdUser = await api.post('/auth/users', {
    name: 'Planilla Independiente',
    email,
    password,
    role: 'independiente',
    persona_id: personaId,
    modulos: { planillas: true },
  }, { token: adminToken })
  assert.equal(createdUser.status, 201)
  userId = createdUser.data.user.id
  const loggedIn = await api.post('/auth/login', { email, password })
  assert.equal(loggedIn.status, 200)
  const token = loggedIn.data.token

  const period = '2098-11'
  notificationPeriod = period
  const submitted = await api.post('/planillas', {
    periodo: period,
    ingreso_mensual: 1200000,
    ingreso_adicional: 300000,
  }, { token })
  assert.equal(submitted.status, 201)
  planillaId = submitted.data.planilla.id
  assert.equal(submitted.data.planilla.persona_id, personaId)
  assert.equal(submitted.data.planilla.empresa_id, null)
  assert.equal(submitted.data.planilla.ingreso_total, '1500000.00')
  assert.equal(submitted.data.planilla.status, 'solicitada')

  const ownPlanillas = await api.get('/planillas', { token })
  assert.ok(ownPlanillas.data.data.some(p => p.id === planillaId))
  const incomes = await api.get('/planillas/ingresos', { token })
  assert.equal(Number(incomes.data.ingreso_mensual), 1200000)
  assert.equal(Number(incomes.data.ingreso_adicional), 300000)

  const edited = await api.put(`/planillas/${planillaId}`, {
    ingreso_mensual: 1300000,
    ingreso_adicional: 200000,
  }, { token })
  assert.equal(edited.status, 200)
  assert.equal(edited.data.planilla.ingreso_total, '1500000.00')

  const invalid = await api.post('/planillas', {
    periodo: '2098-13', ingreso_mensual: 0, ingreso_adicional: 0,
  }, { token })
  assert.equal(invalid.status, 400)

  const managed = await api.put(`/planillas/${planillaId}`, { status: 'generada' }, { token: adminToken })
  assert.equal(managed.status, 200)
  const locked = await api.put(`/planillas/${planillaId}`, { ingreso_mensual: 1400000 }, { token })
  assert.equal(locked.status, 409)
})

test.after(async () => {
  if (planillaId) await db('documentos').where('planilla_id', planillaId).delete()
  if (notificationPeriod) {
    await db('notificaciones').where('tipo', 'planilla')
      .where('mensaje', 'like', `%Planilla del periodo ${notificationPeriod} recibida.%`).delete()
  }
  if (planillaId) await db('planillas').where('id', planillaId).delete()
  if (userId) {
    await db('refresh_tokens').where('user_id', userId).delete()
    await db('user_modulos').where('user_id', userId).delete()
    await db('consentimientos').where('user_id', userId).delete()
    await db('users').where('id', userId).delete()
  }
  if (personaId) await db('personas').where('id', personaId).delete()
  await stopApp()
})

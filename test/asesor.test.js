// Rol 'asesor': staff interno multi-empresa limitado por user_modulos.
// Sin scope de cliente; el middleware requireModulo lo restringe por
// endpoint mientras que admin queda irrestricto y los clientes por tenant.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, startApp, stopApp, ADMIN, EMPRESA } from './helpers.js'
import db from '../src/db/knex.js'

const ASESOR = { email: 'asesor.test@soyasesorias.local', password: 'Asesor1234' }

let adminToken, asesorId

before(async () => {
  await startApp()
  const admin = await loginAs(ADMIN)
  adminToken = admin.token

  await db('users').where('email', ASESOR.email).delete().catch(() => {})
  const res = await api.post('/auth/users', {
    name: 'ASESOR', lastname: 'TEST', email: ASESOR.email,
    password: ASESOR.password, role: 'asesor',
    modulos: { empleados: true, empresas: false, nominas: false, gastos: false },
  }, { token: adminToken })
  assert.equal(res.status, 201, JSON.stringify(res.data))
  asesorId = res.data.user.id
})

after(async () => {
  if (asesorId) {
    await db('user_modulos').where('user_id', asesorId).delete()
    await db('refresh_tokens').where('user_id', asesorId).delete().catch(() => {})
    await db('users').where('id', asesorId).delete()
  }
  await stopApp()
})

test('admin puede crear un usuario con role asesor', async () => {
  assert.ok(asesorId)
  const row = await db('users').where('id', asesorId).first()
  assert.equal(row.role, 'asesor')
})

test('asesor no recibe scope de cliente (empresa_id/persona_id)', async () => {
  const { token } = await loginAs(ASESOR)
  const res = await api.get('/auth/me', { token })
  assert.equal(res.status, 200)
  assert.equal(res.data.user.role, 'asesor')
  assert.ok(!res.data.user.empresa_id)
  assert.ok(!res.data.user.persona_id)
})

test('asesor accede al modulo habilitado (empleados, multi-empresa)', async () => {
  const { token } = await loginAs(ASESOR)
  const res = await api.get('/empleados', { token })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.data.data))
})

test('asesor recibe 403 en modulos no habilitados', async () => {
  const { token } = await loginAs(ASESOR)
  const nominas = await api.get('/nominas', { token })
  assert.equal(nominas.status, 403)
  assert.equal(nominas.data.code, 'MODULO_NO_HABILITADO')

  const gastos = await api.get('/gastos', { token })
  assert.equal(gastos.status, 403)
})

test('asesor no pasa las rutas solo-admin aunque tenga otros modulos', async () => {
  const { token } = await loginAs(ASESOR)
  assert.equal((await api.get('/usuarios', { token })).status, 403)
  assert.equal((await api.get('/configuracion', { token })).status, 403)
  assert.equal((await api.get('/auditorias', { token })).status, 403)
})

test('habilitar un modulo despues surte efecto en el siguiente request', async () => {
  const { token } = await loginAs(ASESOR)
  assert.equal((await api.get('/empresas', { token })).status, 403)

  const upd = await api.put(`/usuarios/${asesorId}`, {
    modulos: { empresas: true },
  }, { token: adminToken })
  assert.equal(upd.status, 200)

  const res = await api.get('/empresas', { token })
  assert.equal(res.status, 200)

  // revertir para no contaminar otros casos
  await api.put(`/usuarios/${asesorId}`, { modulos: { empresas: false } }, { token: adminToken })
  assert.equal((await api.get('/empresas', { token })).status, 403)
})

test('admin sigue irrestricto y empresa conserva su scope', async () => {
  const admin = await api.get('/gastos', { token: adminToken })
  assert.equal(admin.status, 200)

  // La usuaria empresa tiene todos los endpoints disponibles (el checkbox
  // no aplica a clientes) pero el controller la limita a su empresa_id.
  const empresa = await loginAs(EMPRESA)
  const res = await api.get('/empleados', { token: empresa.token })
  assert.equal(res.status, 200)
})

test('role invalido sigue rechazado al crear usuarios', async () => {
  const res = await api.post('/auth/users', {
    name: 'X', email: 'rol-invalido@test.local', password: '1234567', role: 'supervisor',
  }, { token: adminToken })
  assert.equal(res.status, 400)
})

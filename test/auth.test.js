import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let passwordUserId
let resetUserId

test('login admin devuelve access + refresh token y usuario', async () => {
  const res = await loginAs(ADMIN)
  assert.ok(res.token, 'sin access token')
  assert.ok(res.refresh_token, 'sin refresh token')
  assert.equal(res.user.role, 'admin')
})

test('login con password incorrecto → 401', async () => {
  const res = await api.post('/auth/login', { email: ADMIN.email, password: 'mala' })
  assert.equal(res.status, 401)
})

test('/auth/me sin token → 401', async () => {
  const res = await api.get('/auth/me')
  assert.equal(res.status, 401)
})

test('/auth/me con token → usuario', async () => {
  const { token } = await loginAs(ADMIN)
  const res = await api.get('/auth/me', { token })
  assert.equal(res.status, 200)
  assert.equal(res.data.user.role, 'admin')
})

test('refresh rota tokens y el viejo queda revocado', async () => {
  const { refresh_token } = await loginAs({ email: ADMIN.email, password: ADMIN.password })
  // loginAs cachea — hacemos login directo para un refresh único
  const loginRes = await api.post('/auth/login', ADMIN)
  const rt = loginRes.data.refresh_token

  const r1 = await api.post('/auth/refresh', { refresh_token: rt })
  assert.equal(r1.status, 200)
  assert.ok(r1.data.token)
  assert.ok(r1.data.refresh_token)
  assert.notEqual(r1.data.refresh_token, rt, 'el refresh no rotó')

  // reusar el viejo debe fallar (rotación)
  const r2 = await api.post('/auth/refresh', { refresh_token: rt })
  assert.equal(r2.status, 401)
})

test('refresh con token inválido → 401', async () => {
  const res = await api.post('/auth/refresh', { refresh_token: 'no-existe' })
  assert.equal(res.status, 401)
})

test('logout revoca el refresh token', async () => {
  const loginRes = await api.post('/auth/login', ADMIN)
  const { token, refresh_token } = loginRes.data

  const out = await api.post('/auth/logout', { refresh_token }, { token })
  assert.equal(out.status, 200)

  const r = await api.post('/auth/refresh', { refresh_token })
  assert.equal(r.status, 401)
})

test('un usuario cambia su propia contraseña y se revocan los refresh anteriores', async () => {
  const admin = await loginAs(ADMIN)
  const email = `cambio-password-${randomUUID()}@example.test`
  const oldPassword = 'Old-Password-2026!'
  const newPassword = 'New-Password-2026!'
  const created = await api.post('/auth/users', {
    name: 'Prueba cambio contraseña',
    email,
    password: oldPassword,
    role: 'admin',
  }, { token: admin.token })
  assert.equal(created.status, 201)
  passwordUserId = created.data.user.id

  const login = await api.post('/auth/login', { email, password: oldPassword })
  assert.equal(login.status, 200)

  const unauthorized = await api.put('/auth/change-password', {
    current_password: oldPassword,
    new_password: newPassword,
  })
  assert.equal(unauthorized.status, 401)

  const wrongCurrent = await api.put('/auth/change-password', {
    current_password: 'Wrong-Password!',
    new_password: newPassword,
  }, { token: login.data.token })
  assert.equal(wrongCurrent.status, 400)

  const tooShort = await api.put('/auth/change-password', {
    current_password: oldPassword,
    new_password: 'short',
  }, { token: login.data.token })
  assert.equal(tooShort.status, 400)

  const changed = await api.put('/auth/change-password', {
    current_password: oldPassword,
    new_password: newPassword,
  }, { token: login.data.token })
  assert.equal(changed.status, 200)
  assert.ok(changed.data.token)
  assert.ok(changed.data.refresh_token)
  assert.equal(changed.data.user.id, passwordUserId)

  const revoked = await api.post('/auth/refresh', {
    refresh_token: login.data.refresh_token,
  })
  assert.equal(revoked.status, 401)

  const oldLogin = await api.post('/auth/login', { email, password: oldPassword })
  assert.equal(oldLogin.status, 401)
  const newLogin = await api.post('/auth/login', { email, password: newPassword })
  assert.equal(newLogin.status, 200)

  const currentSessionRefresh = await api.post('/auth/refresh', {
    refresh_token: changed.data.refresh_token,
  })
  assert.equal(currentSessionRefresh.status, 200)
})

test('admin puede restablecer contraseña de cliente e invalida sus refresh tokens', async () => {
  const admin = await loginAs(ADMIN)
  const email = `reset-cliente-${randomUUID()}@example.test`
  const oldPassword = 'Old-Client-Password-2026!'
  const newPassword = 'New-Client-Password-2026!'
  const created = await api.post('/auth/users', {
    name: 'Cliente prueba de restablecimiento',
    email,
    password: oldPassword,
    role: 'empresa',
  }, { token: admin.token })
  assert.equal(created.status, 201)
  resetUserId = created.data.user.id

  const client = await api.post('/auth/login', { email, password: oldPassword })
  assert.equal(client.status, 200)

  const forbidden = await api.put(`/usuarios/${resetUserId}/password`, {
    new_password: newPassword,
  }, { token: client.data.token })
  assert.equal(forbidden.status, 403)

  const invalid = await api.put(`/usuarios/${resetUserId}/password`, {
    new_password: 'short',
  }, { token: admin.token })
  assert.equal(invalid.status, 400)

  const reset = await api.put(`/usuarios/${resetUserId}/password`, {
    new_password: newPassword,
  }, { token: admin.token })
  assert.equal(reset.status, 200)

  const revoked = await api.post('/auth/refresh', {
    refresh_token: client.data.refresh_token,
  })
  assert.equal(revoked.status, 401)
  const oldLogin = await api.post('/auth/login', { email, password: oldPassword })
  assert.equal(oldLogin.status, 401)
  const newLogin = await api.post('/auth/login', { email, password: newPassword })
  assert.equal(newLogin.status, 200)

  const forbiddenAdminReset = await api.put(`/usuarios/${passwordUserId}/password`, {
    new_password: newPassword,
  }, { token: admin.token })
  assert.equal(forbiddenAdminReset.status, 403)
})

test.after(async () => {
  if (resetUserId) {
    await db('refresh_tokens').where('user_id', resetUserId).delete()
    await db('user_modulos').where('user_id', resetUserId).delete()
    await db('users').where('id', resetUserId).delete()
  }
  if (passwordUserId) {
    await db('refresh_tokens').where('user_id', passwordUserId).delete()
    await db('user_modulos').where('user_id', passwordUserId).delete()
    await db('users').where('id', passwordUserId).delete()
  }
  await stopApp()
})

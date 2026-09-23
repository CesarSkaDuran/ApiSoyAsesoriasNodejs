import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'

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

test.after(() => stopApp())

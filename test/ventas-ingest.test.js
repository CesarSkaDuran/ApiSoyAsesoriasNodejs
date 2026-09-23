import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'

// Seguridad del endpoint público /ventas/ingest
const TOKEN = process.env.SOY_LEADS_TOKEN || ''

test('ingest sin token → 401/503', async () => {
  const res = await api.post('/ventas/ingest', {
    nombre_emprendedor: 'Test',
    nombre_emprendimiento: 'Test SA',
  })
  assert.ok([401, 503].includes(res.status), `esperaba 401/503, fue ${res.status}`)
})

test('ingest con token incorrecto → 401', async (t) => {
  if (!TOKEN) return t.skip('SOY_LEADS_TOKEN no configurado')
  const res = await api.post('/ventas/ingest', {
    token: 'incorrecto',
    nombre_emprendedor: 'Test',
    nombre_emprendimiento: 'Test SA',
  })
  assert.equal(res.status, 401)
})

test('ingest honeypot → 201 sin crear lead', async (t) => {
  if (!TOKEN) return t.skip('SOY_LEADS_TOKEN no configurado')
  const res = await api.post('/ventas/ingest', {
    token: TOKEN,
    website: 'http://spam.com', // honeypot llenado = bot
    nombre_emprendedor: 'Bot',
    nombre_emprendimiento: 'Bot SA',
  })
  assert.equal(res.status, 201)
  assert.equal(res.data.lead_id, undefined, 'el honeypot no debe crear lead')
})

test('ingest con datos válidos → 201 crea lead', async (t) => {
  if (!TOKEN) return t.skip('SOY_LEADS_TOKEN no configurado')
  const admin = await loginAs(ADMIN)
  const email = `test-${Date.now()}@example.com`
  const res = await api.post('/ventas/ingest', {
    token: TOKEN,
    nombre_emprendedor: 'Test Integración',
    nombre_emprendimiento: 'Empresa Test Integración',
    email,
    funnel: 'suscriptores',
  })
  assert.equal(res.status, 201)
  assert.ok(res.data.lead_id)

  // limpieza: borrar el lead creado
  const del = await api.delete(`/ventas/leads/${res.data.lead_id}`, { token: admin.token })
  assert.equal(del.status, 200)
})

test('ingest duplicado reciente → deduplicado', async (t) => {
  if (!TOKEN) return t.skip('SOY_LEADS_TOKEN no configurado')
  const admin = await loginAs(ADMIN)
  const email = `dup-${Date.now()}@example.com`
  const payload = {
    token: TOKEN,
    nombre_emprendedor: 'Dup',
    nombre_emprendimiento: 'Dup SA',
    email,
  }
  const r1 = await api.post('/ventas/ingest', payload)
  const r2 = await api.post('/ventas/ingest', payload)
  assert.equal(r1.status, 201)
  assert.equal(r2.status, 200)
  assert.ok(r2.data.deduplicated)

  await api.delete(`/ventas/leads/${r1.data.lead_id}`, { token: admin.token })
})

test.after(() => stopApp())

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'

test('parámetros anuales de nómina son legibles solo por administradores', async () => {
  const admin = await loginAs(ADMIN)
  const client = await loginAs(EMPRESA)

  const adminResponse = await api.get('/nominas/parametros/2026', { token: admin.token })
  assert.equal(adminResponse.status, 200)
  assert.equal(Number(adminResponse.data.parametros.salario_minimo), 1750905)
  assert.equal(Number(adminResponse.data.parametros.auxilio_transporte), 249095)

  const clientResponse = await api.get('/nominas/parametros/2026', { token: client.token })
  assert.equal(clientResponse.status, 403)

  const forbiddenUpdate = await api.put('/nominas/parametros/2026', { salario_minimo: 1 }, { token: client.token })
  assert.equal(forbiddenUpdate.status, 403)
})

test.after(async () => stopApp())

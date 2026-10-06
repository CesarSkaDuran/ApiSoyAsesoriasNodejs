import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

const creados = []

test('retiro en lote: admin retira empleados y el cliente empresa no puede', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const doc = () => `RET-${Date.now()}-${randomUUID().slice(0, 6)}`

  const ids = []
  for (let i = 0; i < 2; i++) {
    const created = await api.post('/empleados', {
      empresa_id: 2,
      primer_nombre: 'RETIRO LOTE',
      numero_documento: doc(),
      salario_base: 1750905,
      riesgo: 'I',
    }, { token: admin.token })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    ids.push(created.data.empleado.id)
    creados.push(created.data.empleado.id)
  }

  // Cliente empresa no puede usar el endpoint de lote
  const forbidden = await api.post('/empleados/retirar-lote', {
    empleado_ids: ids,
  }, { token: empresa.token })
  assert.equal(forbidden.status, 403)

  // Admin retira ambos con fecha
  const retirados = await api.post('/empleados/retirar-lote', {
    empleado_ids: ids,
    fecha_retiro: '2026-10-01',
  }, { token: admin.token })
  assert.equal(retirados.status, 200, JSON.stringify(retirados.data))
  assert.equal(retirados.data.retirados, 2)
  assert.equal(retirados.data.no_afectados, 0)

  const filas = await db('empleados').whereIn('id', ids)
  assert.ok(filas.every((f) => f.status === 'retirado'))
  const fechaRetiro = (f) =>
    f.fecha_retiro instanceof Date
      ? f.fecha_retiro.toISOString().slice(0, 10)
      : String(f.fecha_retiro).slice(0, 10)
  assert.ok(filas.every((f) => fechaRetiro(f) === '2026-10-01'))

  // Repetir el lote no cuenta de nuevo (ya retirados)
  const repetido = await api.post('/empleados/retirar-lote', {
    empleado_ids: ids,
  }, { token: admin.token })
  assert.equal(repetido.status, 200)
  assert.equal(repetido.data.retirados, 0)
  assert.equal(repetido.data.no_afectados, 2)
})

test('retiro en lote sin ids devuelve 400', async () => {
  const admin = await loginAs(ADMIN)
  const res = await api.post('/empleados/retirar-lote', {
    empleado_ids: [],
  }, { token: admin.token })
  assert.equal(res.status, 400)
})

test.after(async () => {
  if (creados.length) await db('empleados').whereIn('id', creados).delete()
  await stopApp()
})

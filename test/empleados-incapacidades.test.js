import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'

const ids = []

test('incapacidades guardan fechas, origen y acumulado de prorroga por empleado', async () => {
  const admin = await loginAs(ADMIN)
  const primera = await api.post('/empleados/916/incapacidades', {
    tipo: 'comun',
    fecha_inicio: '2020-01-01',
    fecha_fin: '2020-01-03',
    fecha_expedicion: '2020-01-01',
    numero_certificado: 'CERT-TEST-1',
  }, { token: admin.token })

  assert.equal(primera.status, 201)
  ids.push(primera.data.incapacidad.id)
  assert.equal(primera.data.incapacidad.dias, 3)
  assert.equal(primera.data.incapacidad.origen, 'comun')
  assert.equal(Number(primera.data.incapacidad.dias_acumulado), 0)

  const prorroga = await api.post('/empleados/916/incapacidades', {
    tipo: 'comun',
    fecha_inicio: '2020-01-04',
    fecha_fin: '2020-01-05',
    fecha_expedicion: '2020-01-04',
    numero_certificado: 'CERT-TEST-2',
    prorroga_de_id: primera.data.incapacidad.id,
  }, { token: admin.token })

  assert.equal(prorroga.status, 201, JSON.stringify(prorroga.data))
  ids.push(prorroga.data.incapacidad.id)
  assert.equal(prorroga.data.incapacidad.dias, 2)
  assert.equal(Number(prorroga.data.incapacidad.dias_acumulado), 3)
  assert.equal(Number(prorroga.data.incapacidad.prorroga_de_id), primera.data.incapacidad.id)

  const vacaciones = await api.post('/empleados/916/incapacidades', {
    tipo: 'vacaciones',
    fecha_inicio: '2020-02-01',
    fecha_fin: '2020-02-05',
  }, { token: admin.token })
  assert.equal(vacaciones.status, 201, JSON.stringify(vacaciones.data))
  ids.push(vacaciones.data.incapacidad.id)
  assert.equal(vacaciones.data.incapacidad.origen, null)
  assert.equal(vacaciones.data.incapacidad.dias, 5)

  const continuidadInvalida = await api.post('/empleados/916/incapacidades', {
    tipo: 'comun',
    fecha_inicio: '2020-02-06',
    fecha_fin: '2020-02-07',
    prorroga_de_id: prorroga.data.incapacidad.id,
  }, { token: admin.token })
  assert.equal(continuidadInvalida.status, 400)
})

test.after(async () => {
  if (ids.length) {
    await (await import('../src/db/knex.js')).default('incapacidades').whereIn('id', ids).delete()
  }
  await stopApp()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let empresaId
let token

test.before(async () => {
  token = (await loginAs(ADMIN)).token
  const [id] = await db('empresas').insert({
    razon_social: `Empresa centros de trabajo ${Date.now()}`,
    status: 'activo',
  })
  empresaId = id
})

test('admin administra centros de trabajo y la contratación hereda el riesgo seleccionado', async () => {
  const invalid = await api.post(`/empresas/${empresaId}/centros-trabajo`, {
    nombre: 'Centro inválido',
    riesgo: 'VI',
  }, { token })
  assert.equal(invalid.status, 400)

  const created = await api.post(`/empresas/${empresaId}/centros-trabajo`, {
    nombre: 'Conductores',
    riesgo: 'V',
  }, { token })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const centro = created.data.centro_trabajo
  assert.equal(centro.nombre, 'Conductores')
  assert.equal(centro.riesgo, 'V')

  const duplicate = await api.post(`/empresas/${empresaId}/centros-trabajo`, {
    nombre: 'conductores',
    riesgo: 'IV',
  }, { token })
  assert.equal(duplicate.status, 409)

  const updated = await api.put(`/empresas/${empresaId}/centros-trabajo/${centro.id}`, {
    nombre: 'Conductores de carretera',
    riesgo: 'IV',
  }, { token })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.centro_trabajo.riesgo, 'IV')

  const documento = `CENTRO-${Date.now()}`
  const hired = await api.post('/empleados/contratar', {
    empresa_id: empresaId,
    documento,
    primer_nombre: 'PERSONA',
    primer_apellido: 'CONDUCTORA',
    fecha_nacimiento: '1990-06-15',
    fecha_ingreso: '2026-11-01',
    tipo_contrato: 'indefinido',
    salario_base: 4000000,
    centro_trabajo_id: centro.id,
  }, { token })
  assert.equal(hired.status, 201, JSON.stringify(hired.data))

  const empleado = await db('empleados').where('id', hired.data.empleado.id).first()
  assert.equal(Number(empleado.centro_trabajo_id), Number(centro.id))
  assert.equal(empleado.riesgo, 'IV')

  const show = await api.get(`/empresas/${empresaId}`, { token })
  assert.equal(show.status, 200)
  assert.ok(show.data.centros_trabajo.some(item => item.id === centro.id))

  const deactivated = await api.delete(`/empresas/${empresaId}/centros-trabajo/${centro.id}`, { token })
  assert.equal(deactivated.status, 200)
  const list = await api.get(`/empresas/${empresaId}/centros-trabajo`, { token })
  assert.equal(list.status, 200)
  assert.equal(list.data.data.find(item => item.id === centro.id).activo, 0)

  await db('empleados').where('id', empleado.id).delete()
  await db('personas').where('num_documento', documento).delete()
})

test.after(async () => {
  if (empresaId) await db('empresas').where('id', empresaId).delete()
  await stopApp()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

const solicitudIds = []
const rango = '2037-01-01'

test('informe de solicitudes filtra por empresa, independiente, estado y fechas', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await db('empresas').first('id')
  const persona = await db('personas').where('es_independiente', true).first('id')
  assert.ok(empresa, 'requiere al menos una empresa de prueba')
  assert.ok(persona, 'requiere al menos una persona de prueba')
  const clientes = await api.get('/informes/solicitudes/clientes', { token: admin.token })
  assert.equal(clientes.status, 200)
  assert.ok(clientes.data.data.some(cliente => cliente.id === `e:${empresa.id}`))
  assert.ok(clientes.data.data.some(cliente => cliente.id === `p:${persona.id}`))

  const fixtures = [
    { empresa_id: empresa.id, persona_id: null, status: 'pendiente', tipo_solicitud: 'general' },
    { empresa_id: empresa.id, persona_id: null, status: 'completada', tipo_solicitud: 'gestor_paquete' },
    { empresa_id: null, persona_id: persona.id, status: 'en_proceso', tipo_solicitud: 'gestor_documento' },
  ]
  for (const row of fixtures) {
    const [id] = await db('solicitudes').insert({
      ...row,
      descripcion: 'Fixture de informe de solicitudes',
      created_at: `${rango} 12:00:00`,
      updated_at: `${rango} 12:00:00`,
    })
    solicitudIds.push(id)
  }

  const all = await api.get(`/informes/solicitudes?desde=${rango}&hasta=${rango}`, { token: admin.token })
  assert.equal(all.status, 200)
  assert.equal(Number(all.data.resumen.total), 3)
  assert.equal(Number(all.data.resumen.empresas), 2)
  assert.equal(Number(all.data.resumen.independientes), 1)
  assert.equal(Number(all.data.resumen.pendientes), 1)
  assert.equal(Number(all.data.resumen.completadas), 1)
  assert.equal(Number(all.data.resumen.en_proceso), 1)
  assert.equal(all.data.por_dia.length, 1)
  assert.equal(Number(all.data.por_dia[0].registros), 3)

  const empresas = await api.get(`/informes/solicitudes?desde=${rango}&hasta=${rango}&tipo_cliente=empresa`, { token: admin.token })
  assert.equal(Number(empresas.data.resumen.total), 2)
  const empresaEspecifica = await api.get(`/informes/solicitudes?desde=${rango}&hasta=${rango}&empresa_id=${empresa.id}`, { token: admin.token })
  assert.equal(Number(empresaEspecifica.data.resumen.total), 2)

  const independientes = await api.get(`/informes/solicitudes?desde=${rango}&hasta=${rango}&tipo_cliente=independiente`, { token: admin.token })
  assert.equal(Number(independientes.data.resumen.total), 1)
  const independienteEspecifico = await api.get(`/informes/solicitudes?desde=${rango}&hasta=${rango}&persona_id=${persona.id}`, { token: admin.token })
  assert.equal(Number(independienteEspecifico.data.resumen.total), 1)
  assert.ok(independientes.data.por_tipo.some(row => row.grupo === 'gestor_documento'))

  const invalidType = await api.get('/informes/solicitudes?tipo_cliente=desconocido', { token: admin.token })
  assert.equal(invalidType.status, 400)
})

test.after(async () => {
  if (solicitudIds.length) await db('solicitudes').whereIn('id', solicitudIds).delete()
  await stopApp()
})

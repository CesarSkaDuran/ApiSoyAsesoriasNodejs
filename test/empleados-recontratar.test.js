import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

const empleados = []
const documentos = []
const nominas = []

async function crearRetirado(token) {
  const parametros = await db('nomina_parametros').orderBy('vigencia', 'desc').first()
  const salario = Number(parametros.salario_minimo)
  const res = await api.post('/empleados', {
    empresa_id: 2, primer_nombre: 'PRUEBA RECONTRATAR',
    numero_documento: randomUUID(), salario_base: salario,
    fecha_ingreso: '2020-01-01', fecha_retiro: '2020-06-30',
    tipo_contrato: 'indefinido', periodo_pago: 'mensual', status: 'retirado',
  }, { token })
  assert.equal(res.status, 201, JSON.stringify(res.data))
  empleados.push(res.data.empleado.id)
  return { empleado: res.data.empleado, salario }
}

const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

test('recontratar conserva identidad, documentos y cada periodo anterior; solo admin', async () => {
  const admin = await loginAs(ADMIN)
  const cliente = await loginAs(EMPRESA)
  const { empleado, salario } = await crearRetirado(admin.token)
  const [documentoId] = await db('documentos').insert({
    empleado_id: empleado.id, nombre: 'Documento anterior', path: 'rehire-test-no-file.pdf',
  })
  documentos.push(documentoId)
  const [nominaId] = await db('nominas').insert({ empresa_id: 2, nombre_periodo: 'Vínculo anterior de prueba', status: 'liquidada' })
  nominas.push(nominaId)
  const [detalleId] = await db('nomina_detalles').insert({ nomina_id: nominaId, empleado_id: empleado.id, salario_base: salario, neto: salario })
  const payload = { fecha_ingreso: '2020-07-01', tipo_contrato: 'fijo', fecha_terminacion: '2021-07-01', salario_base: salario + 100000, periodo_pago: 'quincenal' }

  const prohibido = await api.post(`/empleados/${empleado.id}/recontratar`, payload, { token: cliente.token })
  assert.equal(prohibido.status, 403)
  const bypass = await api.put(`/empleados/${empleado.id}`, { status: 'activo', fecha_retiro: null, fecha_ingreso: '2020-07-01' }, { token: cliente.token })
  assert.equal(bypass.status, 403)
  const retiroCliente = await api.delete(`/empleados/${empleado.id}`, { token: cliente.token })
  assert.equal(retiroCliente.status, 403)
  const nueva = await api.post(`/empleados/${empleado.id}/recontratar`, payload, { token: admin.token })
  assert.equal(nueva.status, 201, JSON.stringify(nueva.data))
  assert.equal(nueva.data.empleado.id, empleado.id)
  assert.equal(nueva.data.empleado.numero_documento, empleado.numero_documento)
  assert.equal(nueva.data.empleado.status, 'activo')
  assert.equal(nueva.data.empleado.fecha_retiro, null)
  assert.equal(iso(nueva.data.empleado.fecha_ingreso), '2020-07-01')
  assert.equal(Number(nueva.data.empleado.salario_base), salario + 100000)
  assert.equal((await db('documentos').where('id', documentoId).first()).empleado_id, empleado.id)
  const historicoNomina = await db('nomina_detalles').where('id', detalleId).first()
  assert.equal(historicoNomina.empleado_id, empleado.id)
  assert.equal(Number(historicoNomina.salario_base), salario)
  assert.equal(Number(historicoNomina.neto), salario)

  const detalle = await api.get(`/empleados/${empleado.id}`, { token: admin.token })
  assert.equal(detalle.data.periodos.length, 1)
  assert.equal(iso(detalle.data.periodos[0].fecha_ingreso), '2020-01-01')
  assert.equal(iso(detalle.data.periodos[0].fecha_retiro), '2020-06-30')
  assert.equal(Number(detalle.data.periodos[0].salario_base), salario)

  const repetido = await api.post(`/empleados/${empleado.id}/recontratar`, payload, { token: admin.token })
  assert.equal(repetido.status, 409)
  await api.post('/empleados/retirar-lote', { empleado_ids: [empleado.id], fecha_retiro: '2020-09-30' }, { token: admin.token })
  const segunda = await api.post(`/empleados/${empleado.id}/recontratar`, { ...payload, fecha_ingreso: '2020-10-01' }, { token: admin.token })
  assert.equal(segunda.status, 201)
  const periodos = await db('empleado_periodos').where('empleado_id', empleado.id).orderBy('id')
  assert.equal(periodos.length, 2)
  assert.equal(iso(periodos[1].fecha_ingreso), '2020-07-01')
  assert.equal(Number(periodos[1].salario_base), salario + 100000)
})

test('recontratar valida fechas, contrato y salario sin alterar el empleado', async () => {
  const { token } = await loginAs(ADMIN)
  const { empleado, salario } = await crearRetirado(token)
  const payload = { fecha_ingreso: '2020-07-01', tipo_contrato: 'indefinido', salario_base: salario }
  for (const cambio of [
    { fecha_ingreso: '2020-06-30' }, { fecha_ingreso: '2020-02-30' },
    { tipo_contrato: 'invalido' }, { salario_base: 0 },
    { salario_base: salario / 2 }, { salario_integral: true },
    { salario_base: true }, { salario_base: [salario] }, { salario_menor_motivo: {} },
  ]) {
    const res = await api.post(`/empleados/${empleado.id}/recontratar`, { ...payload, ...cambio }, { token })
    assert.equal(res.status, 400, JSON.stringify(res.data))
  }
  const actual = await db('empleados').where('id', empleado.id).first()
  assert.equal(actual.status, 'retirado')
  assert.equal(iso(actual.fecha_ingreso), '2020-01-01')
  if (await db.schema.hasTable('empleado_periodos')) {
    assert.equal((await db('empleado_periodos').where('empleado_id', empleado.id)).length, 0)
  }
})

test('dos recontrataciones simultaneas solo crean un periodo anterior', async () => {
  const { token } = await loginAs(ADMIN)
  const { empleado, salario } = await crearRetirado(token)
  const payload = { fecha_ingreso: '2020-07-01', tipo_contrato: 'indefinido', salario_base: salario }
  const resultados = await Promise.all([
    api.post(`/empleados/${empleado.id}/recontratar`, payload, { token }),
    api.post(`/empleados/${empleado.id}/recontratar`, payload, { token }),
  ])
  assert.deepEqual(resultados.map(r => r.status).sort(), [201, 409])
  assert.equal((await db('empleado_periodos').where('empleado_id', empleado.id)).length, 1)
})

test.after(async () => {
  if (nominas.length) {
    await db('nomina_detalles').whereIn('nomina_id', nominas).delete()
    await db('nominas').whereIn('id', nominas).delete()
  }
  if (documentos.length) await db('documentos').whereIn('id', documentos).delete()
  if (empleados.length) {
    if (await db.schema.hasTable('empleado_periodos')) await db('empleado_periodos').whereIn('empleado_id', empleados).delete()
    await db('empleados').whereIn('id', empleados).delete()
  }
  await stopApp()
})

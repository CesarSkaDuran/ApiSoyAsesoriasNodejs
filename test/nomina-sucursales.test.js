import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let token
let empresaId
let sucursalA
let sucursalB
let centroTrabajoId
const empleadoIds = []
const documentoIds = []
const nominaIds = []

test.before(async () => {
  token = (await loginAs(ADMIN)).token
  const empresa = await api.post('/empresas', {
    razon_social: `Empresa obras nómina ${Date.now()}`,
    tipo_documento: 'NIT',
    num_documento: `900${Date.now()}`,
    status: 'activo',
    pila_modalidad: 'consolidada',
  }, { token })
  assert.equal(empresa.status, 201, JSON.stringify(empresa.data))
  empresaId = empresa.data.empresa.id

  const a = await api.post(`/empresas/${empresaId}/sucursales`, {
    nombre: 'Obra Cúcuta',
  }, { token })
  const b = await api.post(`/empresas/${empresaId}/sucursales`, {
    nombre: 'Obra Pamplona',
  }, { token })
  assert.equal(a.status, 201, JSON.stringify(a.data))
  assert.equal(b.status, 201, JSON.stringify(b.data))
  sucursalA = a.data.sucursal
  sucursalB = b.data.sucursal

  const centro = await api.post(`/empresas/${empresaId}/centros-trabajo`, {
    nombre: 'Conductores - riesgo V',
    riesgo: 'V',
  }, { token })
  assert.equal(centro.status, 201, JSON.stringify(centro.data))
  centroTrabajoId = centro.data.centro_trabajo.id
})

async function contratar(sucursal, sufijo, centroId = null) {
  const documento = `OBRA-${Date.now()}-${sufijo}`
  documentoIds.push(documento)
  const response = await api.post('/empleados/contratar', {
    empresa_id: empresaId,
    documento,
    primer_nombre: 'TRABAJADOR',
    primer_apellido: sufijo.toUpperCase(),
    fecha_nacimiento: '1990-01-15',
    fecha_ingreso: '2026-01-01',
    salario_base: 5000000,
    tipo_contrato: 'indefinido',
    riesgo: 'I',
    sucursal_id: sucursal.id,
    centro_trabajo_id: centroId,
  }, { token })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  empleadoIds.push(response.data.empleado.id)
  return response.data.empleado
}

async function crearNomina(sucursal, periodo, inicio, fin) {
  const response = await api.post('/nominas', {
    empresa_id: empresaId,
    sucursal_id: sucursal?.id ?? null,
    nombre_periodo: periodo,
    vigencia: 2026,
    dias_periodo: 15,
    fecha_inicio: inicio,
    fecha_fin: fin,
  }, { token })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  nominaIds.push(response.data.nomina.id)
  return response.data.nomina
}

async function liquidar(nomina, empleado) {
  return api.put(`/nominas/${nomina.id}/liquidar`, {
    empleados: [{ empleado_id: empleado.id }],
  }, { token })
}

test('separa la nómina por obra, consolida el reporte y respeta la modalidad PILA', async () => {
  const empleadoA = await contratar(sucursalA, 'CUCUTA', centroTrabajoId)
  const empleadoB = await contratar(sucursalB, 'PAMPLONA')
  const empleadoConRiesgoIndependiente = await db('empleados').where('id', empleadoA.id).first()
  assert.equal(Number(empleadoConRiesgoIndependiente.sucursal_id), Number(sucursalA.id))
  assert.equal(Number(empleadoConRiesgoIndependiente.centro_trabajo_id), Number(centroTrabajoId))
  assert.equal(empleadoConRiesgoIndependiente.riesgo, 'V')

  const listaA = await api.get(`/empleados?empresa_id=${empresaId}&sucursal_id=${sucursalA.id}`, { token })
  assert.equal(listaA.status, 200)
  assert.deepEqual(listaA.data.data.map(e => e.id), [empleadoA.id])

  const periodo = `Obras noviembre ${Date.now()}`
  const nominaA = await crearNomina(sucursalA, periodo, '2026-11-01', '2026-11-15')
  const nominaB = await crearNomina(sucursalB, periodo, '2026-11-01', '2026-11-15')
  assert.equal(nominaA.sucursal_id, sucursalA.id)
  assert.equal(nominaB.sucursal_id, sucursalB.id)

  const mezclaInvalida = await liquidar(nominaA, empleadoB)
  assert.equal(mezclaInvalida.status, 400)
  assert.match(mezclaInvalida.data.error, /otra sucursal/)

  const liquidadaA = await liquidar(nominaA, empleadoA)
  assert.equal(liquidadaA.status, 200, JSON.stringify(liquidadaA.data))
  assert.equal(Number(liquidadaA.data.detalles[0].sucursal_id), Number(sucursalA.id))
  assert.equal(liquidadaA.data.detalles[0].sucursal_nombre, sucursalA.nombre)
  const liquidadaB = await liquidar(nominaB, empleadoB)
  assert.equal(liquidadaB.status, 200, JSON.stringify(liquidadaB.data))

  const nominasFiltradas = await api.get(`/nominas?empresa_id=${empresaId}&sucursal_id=${sucursalA.id}`, { token })
  assert.equal(nominasFiltradas.status, 200)
  assert.deepEqual(nominasFiltradas.data.data.map(n => n.id), [nominaA.id])

  const reporte = await api.get(`/informes/nominas-sucursales?empresa_id=${empresaId}`, { token })
  assert.equal(reporte.status, 200, JSON.stringify(reporte.data))
  assert.equal(reporte.data.data.length, 2)
  assert.equal(reporte.data.consolidado.nominas, 2)
  assert.equal(reporte.data.consolidado.empleados, 2)
  assert.equal(
    Number(reporte.data.consolidado.costo_nomina),
    Number(reporte.data.data[0].costo_nomina) + Number(reporte.data.data[1].costo_nomina),
  )

  const consolidada = await api.post(`/nominas/${nominaA.id}/planilla`, {}, { token })
  assert.equal(consolidada.status, 201, JSON.stringify(consolidada.data))
  assert.equal(consolidada.data.modalidad, 'consolidada')
  assert.equal(consolidada.data.nominas_incluidas, 2)
  assert.equal(consolidada.data.planilla.sucursal_id, null)
  const asociados = await db('planilla_nominas').where('planilla_id', consolidada.data.planilla.id)
  assert.equal(asociados.length, 2)

  for (const sucursal of [sucursalA, sucursalB]) {
    const code = sucursal.id === sucursalA.id ? '12345' : '54321'
    const updated = await api.put(`/empresas/${empresaId}/sucursales/${sucursal.id}`, {
      codigo_pila: code,
    }, { token })
    assert.equal(updated.status, 200, JSON.stringify(updated.data))
  }
  const mode = await api.put(`/empresas/${empresaId}`, { pila_modalidad: 'por_sucursal' }, { token })
  assert.equal(mode.status, 200, JSON.stringify(mode.data))

  const nominaSeparada = await crearNomina(
    sucursalA,
    `Obras diciembre ${Date.now()}`,
    '2026-12-01',
    '2026-12-15',
  )
  const liquidacionSeparada = await liquidar(nominaSeparada, empleadoA)
  assert.equal(liquidacionSeparada.status, 200, JSON.stringify(liquidacionSeparada.data))
  const planillaSeparada = await api.post(`/nominas/${nominaSeparada.id}/planilla`, {}, { token })
  assert.equal(planillaSeparada.status, 201, JSON.stringify(planillaSeparada.data))
  assert.equal(planillaSeparada.data.modalidad, 'por_sucursal')
  assert.equal(Number(planillaSeparada.data.planilla.sucursal_id), Number(sucursalA.id))
})

test.after(async () => {
  if (empresaId) {
    const plans = await db('planillas').where('empresa_id', empresaId).select('id')
    const planIds = plans.map(p => p.id)
    if (planIds.length) await db('planilla_nominas').whereIn('planilla_id', planIds).delete()
    await db('planillas').where('empresa_id', empresaId).delete()
  }
  if (nominaIds.length) {
    await db('planilla_nominas').whereIn('nomina_id', nominaIds).delete()
    await db('nomina_detalles').whereIn('nomina_id', nominaIds).delete()
    await db('horas_extras').whereIn('nomina_id', nominaIds).delete()
    await db('nominas').whereIn('id', nominaIds).delete()
  }
  if (empleadoIds.length) await db('empleados').whereIn('id', empleadoIds).delete()
  if (documentoIds.length) await db('personas').whereIn('num_documento', documentoIds).delete()
  if (empresaId) {
    await db('sucursales').where('empresa_id', empresaId).delete()
    await db('empresas').where('id', empresaId).delete()
  }
  await stopApp()
})

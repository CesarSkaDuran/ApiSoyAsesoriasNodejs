import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, EMPRESA, stopApp, ensurePersona } from './helpers.js'
import db from '../src/db/knex.js'

// Multi-empleo con identidad global: /empleados/contratar + /personas/buscar.
// Empresa A = la real (2). Empresa B se crea como fixture y se limpia al final.
const EMPRESA_A = 2
let empresaB
let token
let tokenEmpresa
const docsCreados = []
let empleadosB = []

const doc = () => {
  const d = `CT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  docsCreados.push(d)
  return d
}
const laborales = (extra = {}) => ({
  fecha_ingreso: '2026-10-01', salario_base: 2500000,
  tipo_contrato: 'indefinido', riesgo: 'I', ...extra,
})

test.before(async () => {
  ;({ token } = await loginAs(ADMIN))
  ;({ token: tokenEmpresa } = await loginAs(EMPRESA))
  const [id] = await db('empresas').insert({ razon_social: 'EMPRESA B PRUEBAS', status: 'activo' })
  empresaB = id
})

test('contratar: empresa A crea persona + empleado nuevos', async () => {
  const documento = doc()
  const r = await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, documento, primer_nombre: 'ANA', primer_apellido: 'NUEVA',
    fecha_nacimiento: '1990-05-15', ...laborales(),
  }, { token })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.equal(r.data.persona_existente, false)
  const empleado = await db('empleados').where('id', r.data.empleado.id).first()
  const persona = await db('personas').where('num_documento', documento).first()
  assert.ok(persona, 'debe existir la identidad global')
  assert.equal(empleado.persona_id, persona.id)
  assert.equal(empleado.empresa_id, EMPRESA_A)
  assert.equal(empleado.status, 'activo')
  // La respuesta segura de la persona no trae datos del vínculo
  assert.ok(!('empresa_id' in r.data.persona))
  assert.ok(!('salario_base' in r.data.persona))
  await db('empleados').where('id', empleado.id).delete()
})

test('contratar: empresa B reutiliza la misma persona sin duplicarla', async () => {
  const documento = doc()
  const a = await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, documento, primer_nombre: 'LUIS', primer_apellido: 'DOBLE',
    fecha_nacimiento: '1988-01-20', ...laborales({ arl_id: 1 }),
  }, { token })
  assert.equal(a.status, 201, JSON.stringify(a.data))

  const b = await api.post('/empleados/contratar', {
    empresa_id: empresaB, documento, primer_nombre: 'LUIS', primer_apellido: 'DOBLE',
    ...laborales({ salario_base: 3000000, cargo_id: null }),
  }, { token })
  assert.equal(b.status, 201, JSON.stringify(b.data))
  assert.equal(b.data.persona_existente, true)

  const personas = await db('personas').where('num_documento', documento)
  assert.equal(personas.length, 1, 'no debe duplicar la identidad')
  const [eA, eB] = await Promise.all([
    db('empleados').where('id', a.data.empleado.id).first(),
    db('empleados').where('id', b.data.empleado.id).first(),
  ])
  assert.equal(eA.persona_id, eB.persona_id, 'mismo persona_id')
  assert.equal(eA.empresa_id, EMPRESA_A)
  assert.equal(eB.empresa_id, empresaB)
  assert.equal(eA.status, 'activo')
  assert.equal(eB.status, 'activo')
  // Los datos laborales de B son propios: no hereda salario ni ARL de A
  assert.equal(Number(eB.salario_base), 3000000)
  assert.notEqual(eB.salario_base, eA.salario_base)
  empleadosB.push(eB.id)
  await db('empleados').where('id', eA.id).delete()
})

test('personas/buscar: solo expone identidad, nunca datos del tenant', async () => {
  const documento = doc()
  await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, documento, primer_nombre: 'MARA', primer_apellido: 'CIEGA',
    fecha_nacimiento: '1992-03-03', ...laborales(),
  }, { token })

  const r = await api.get(`/personas/buscar?documento=${documento}`, { token: tokenEmpresa })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.existe, true)
  const p = r.data.persona
  assert.ok(p.id && p.nombre && p.documento)
  assert.equal(p.fecha_nacimiento, '1992-03-03')
  // No revela empresa, vínculo ni datos sensibles
  const crudo = JSON.stringify(r.data)
  for (const prohibido of ['empresa_id', 'salario', 'cargo', 'documentos', 'observaciones', 'eps_id', 'arl_id', 'empresas']) {
    assert.ok(!crudo.includes(prohibido), `la respuesta no debe contener ${prohibido}`)
  }
  await db('empleados').where({ empresa_id: EMPRESA_A, numero_documento: documento }).delete()
})

test('personas/buscar: documento inexistente y malformado', async () => {
  const r = await api.get(`/personas/buscar?documento=${doc()}`, { token })
  assert.equal(r.status, 200)
  assert.equal(r.data.existe, false)
  assert.ok(!('persona' in r.data))

  const vacio = await api.get('/personas/buscar?documento=%20', { token })
  assert.equal(vacio.status, 400)
  const sin = await api.get('/personas/buscar', { token })
  assert.equal(sin.status, 400)
})

test('contratar: duplicado activo en la misma empresa → 409', async () => {
  const documento = doc()
  const primero = await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, documento, primer_nombre: 'DUP', primer_apellido: 'ACTIVO',
    ...laborales(),
  }, { token })
  assert.equal(primero.status, 201, JSON.stringify(primero.data))

  const segundo = await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, documento, primer_nombre: 'DUP', primer_apellido: 'ACTIVO',
    ...laborales(),
  }, { token })
  assert.equal(segundo.status, 409, JSON.stringify(segundo.data))
  assert.match(segundo.data.error, /activo/i)

  const filas = await db('empleados').where({ empresa_id: EMPRESA_A, numero_documento: documento })
  assert.equal(filas.length, 1, 'solo un vínculo activo por empresa')
  await db('empleados').where({ empresa_id: EMPRESA_A, numero_documento: documento }).delete()
})

test('contratar: retirado en A puede contratarse en B con registros independientes', async () => {
  const documento = doc()
  const personaId = await ensurePersona(documento, { primer_nombre: 'RET', primer_apellido: 'EMPRESA' })
  const [empA] = await db('empleados').insert({
    empresa_id: EMPRESA_A, persona_id: personaId, primer_nombre: 'RET', primer_apellido: 'EMPRESA',
    numero_documento: documento, tipo_documento: 'CC', fecha_ingreso: '2024-01-01',
    salario_base: 2000000, tipo_contrato: 'fijo', status: 'retirado', fecha_retiro: '2025-12-31',
    created_at: new Date(), updated_at: new Date(),
  })

  const b = await api.post('/empleados/contratar', {
    empresa_id: empresaB, documento, primer_nombre: 'RET', primer_apellido: 'EMPRESA',
    ...laborales({ salario_base: 2800000 }),
  }, { token })
  assert.equal(b.status, 201, JSON.stringify(b.data))
  assert.equal(b.data.persona_existente, true)

  const [a, eB] = await Promise.all([
    db('empleados').where('id', empA).first(),
    db('empleados').where('id', b.data.empleado.id).first(),
  ])
  assert.equal(a.status, 'retirado', 'el vínculo de A no se altera')
  assert.equal(eB.status, 'activo')
  assert.equal(a.persona_id, eB.persona_id)
  assert.notEqual(a.id, eB.id)
  empleadosB.push(eB.id)
  await db('empleados').where('id', empA).delete()
})

test('contratar: usuario empresa no puede forzar otra empresa_id', async () => {
  const documento = doc()
  const r = await api.post('/empleados/contratar', {
    empresa_id: empresaB, documento, primer_nombre: 'SCOPE', primer_apellido: 'TEST',
    ...laborales(),
  }, { token: tokenEmpresa })
  // El scope ignora empresa_id del body y usa la empresa del token (2)
  if (r.status === 201) {
    const e = await db('empleados').where('id', r.data.empleado.id).first()
    assert.equal(e.empresa_id, EMPRESA_A, 'debe usar la empresa del usuario, no la del body')
    await db('empleados').where('id', e.id).delete()
  } else {
    assert.equal(r.status, 403)
  }
})

test('contratar: concurrencia de la misma cédula en dos empresas no duplica persona', async () => {
  const documento = doc()
  const [a, b] = await Promise.all([
    api.post('/empleados/contratar', {
      empresa_id: EMPRESA_A, documento, primer_nombre: 'CON', primer_apellido: 'CURRENTE',
      ...laborales(),
    }, { token }),
    api.post('/empleados/contratar', {
      empresa_id: empresaB, documento, primer_nombre: 'CON', primer_apellido: 'CURRENTE',
      ...laborales(),
    }, { token }),
  ])
  assert.equal(a.status, 201, JSON.stringify(a.data))
  assert.equal(b.status, 201, JSON.stringify(b.data))
  const personas = await db('personas').where('num_documento', documento)
  assert.equal(personas.length, 1, 'una sola identidad global')
  const empleados = await db('empleados').where('numero_documento', documento)
  assert.equal(empleados.length, 2)
  assert.equal(new Set(empleados.map(e => e.persona_id)).size, 1)
  assert.equal(new Set(empleados.map(e => e.empresa_id)).size, 2)
  for (const e of empleados) {
    if (e.empresa_id === empresaB) empleadosB.push(e.id)
    else await db('empleados').where('id', e.id).delete()
  }
})

test('contratar: concurrencia misma persona misma empresa → una sola activa', async () => {
  const documento = doc()
  const [a, b] = await Promise.all([
    api.post('/empleados/contratar', {
      empresa_id: EMPRESA_A, documento, primer_nombre: 'RACE', primer_apellido: 'MISMA',
      ...laborales(),
    }, { token }),
    api.post('/empleados/contratar', {
      empresa_id: EMPRESA_A, documento, primer_nombre: 'RACE', primer_apellido: 'MISMA',
      ...laborales(),
    }, { token }),
  ])
  const estados = [a.status, b.status].sort()
  assert.deepEqual(estados, [201, 409], JSON.stringify([a.data, b.data]))
  const filas = await db('empleados').where({ empresa_id: EMPRESA_A, numero_documento: documento })
  assert.equal(filas.length, 1)
  await db('empleados').where({ empresa_id: EMPRESA_A, numero_documento: documento }).delete()
})

test('contratar: documento faltante o inválido → 400', async () => {
  const r = await api.post('/empleados/contratar', {
    empresa_id: EMPRESA_A, primer_nombre: 'SIN', primer_apellido: 'DOC', ...laborales(),
  }, { token })
  assert.equal(r.status, 400)
})

test.after(async () => {
  if (empleadosB.length) await db('empleados').whereIn('id', empleadosB).delete()
  if (empresaB) await db('empresas').where('id', empresaB).delete()
  if (docsCreados.length) await db('personas').whereIn('num_documento', docsCreados).delete()
  await stopApp()
})

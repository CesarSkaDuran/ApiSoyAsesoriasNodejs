import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

// Elegibilidad del salario integral (CST art. 132):
// piso = 10 SMMLV × (1 + factor_prestacional/100) por empresa.
let smmlv
const creados = []
const nominasCreadas = []

async function piso(factor = 30) {
  return Math.round(smmlv * 10 * (1 + factor / 100))
}

test('salario integral: validación en ficha, en liquidación y factor de empresa', async () => {
  const { token } = await loginAs(ADMIN)
  const p = await db('nomina_parametros').orderBy('vigencia', 'desc').first()
  smmlv = Number(p.salario_minimo)
  const empresaId = 1
  const doc = () => `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // ── Ficha: create bajo el piso → 400; >= piso → 201 ─────────────────────
  const bad = await api.post('/empleados', {
    empresa_id: empresaId, primer_nombre: 'TEST INTEGRAL', numero_documento: doc(),
    salario_base: await piso() - 100000, salario_integral: true,
  }, { token })
  assert.equal(bad.status, 400)
  assert.match(bad.data.error, /salario integral/i)
  assert.match(bad.data.error, /30%/)

  const ok = await api.post('/empleados', {
    empresa_id: empresaId, primer_nombre: 'TEST INTEGRAL', numero_documento: doc(),
    salario_base: await piso() + 100000, salario_integral: true, riesgo: 'I',
  }, { token })
  assert.equal(ok.status, 201, JSON.stringify(ok.data))
  const empId = ok.data.empleado.id
  creados.push(empId)

  // Update bajo el piso → 400 (la ficha no puede quedar inválida)
  const badUp = await api.put(`/empleados/${empId}`, { salario_base: await piso() - 1 }, { token })
  assert.equal(badUp.status, 400)
  assert.match(badUp.data.error, /salario integral/i)

  // ── Factor de empresa: rango legal 30–100 ───────────────────────────────
  for (const f of [25, 101]) {
    const r = await api.put(`/empresas/${empresaId}`, { factor_prestacional_pct: f }, { token })
    assert.equal(r.status, 400, `factor ${f} debió rechazarse`)
    assert.match(r.data.error, /30%|CST/)
  }

  // ── Factor al alza que invalida integrales → 409 + forzar ───────────────
  const [intId] = await db('empleados').insert({
    empresa_id: empresaId, primer_nombre: 'TEST INT 40', numero_documento: doc(),
    salario_base: Math.round(smmlv * 13.5), salario_integral: true,
    riesgo: 'I', status: 'activo', created_at: new Date(), updated_at: new Date(),
  })
  creados.push(intId)
  const f40 = await api.put(`/empresas/${empresaId}`, { factor_prestacional_pct: 40 }, { token })
  assert.equal(f40.status, 409)
  assert.match(f40.data.error, /invalida/)
  assert.ok(f40.data.empleados_invalidos.some(e => e.id === intId))
  const forzado = await api.put(`/empresas/${empresaId}`, {
    factor_prestacional_pct: 40, forzar_cambio_factor: true,
  }, { token })
  assert.equal(forzado.status, 200)
  // Restaura el default para no afectar otros tests
  await api.put(`/empresas/${empresaId}`, {
    factor_prestacional_pct: 30, forzar_cambio_factor: true,
  }, { token })

  // ── Liquidación: integral bajo el piso → 400 estructurado ───────────────
  const [bajoId] = await db('empleados').insert({
    empresa_id: empresaId, primer_nombre: 'TEST BAJO', numero_documento: doc(),
    salario_base: await piso() - 100000, salario_integral: true,
    riesgo: 'I', status: 'activo', created_at: new Date(), updated_at: new Date(),
  })
  creados.push(bajoId)
  const created = await api.post('/nominas', {
    empresa_id: empresaId, nombre_periodo: `Test Integral ${Date.now()}`,
    vigencia: 2026, dias_periodo: 15,
  }, { token })
  assert.equal(created.status, 201)
  const nId = created.data.nomina.id
  nominasCreadas.push(nId)

  const liq = await api.put(`/nominas/${nId}/liquidar`, {
    empleados: [{ empleado_id: bajoId }],
  }, { token })
  assert.equal(liq.status, 400, JSON.stringify(liq.data))
  const inv = liq.data.empleados_integral_invalidos?.find(e => e.id === bajoId)
  assert.ok(inv, 'empleados_integral_invalidos debe listar al empleado')
  assert.ok(inv.minimo_requerido >= await piso())
})

test.after(async () => {
  for (const id of nominasCreadas) {
    await db('nomina_detalles').where('nomina_id', id).delete()
    await db('horas_extras').where('nomina_id', id).delete()
    await db('planillas').where('nomina_id', id).delete()
    await db('nominas').where('id', id).delete()
  }
  if (creados.length) {
    await db('incapacidades').whereIn('empleado_id', creados).delete()
    await db('empleados').whereIn('id', creados).delete()
  }
  await stopApp()
})

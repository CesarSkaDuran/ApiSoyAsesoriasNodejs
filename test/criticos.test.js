import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'

// Smoke de endpoints críticos: responden 200 con estructura esperada.
const CRITICOS = [
  ['/empresas', (d) => Array.isArray(d.data)],
  ['/empleados', (d) => Array.isArray(d.data)],
  ['/nominas', (d) => Array.isArray(d.data)],
  ['/planillas', (d) => Array.isArray(d.data)],
  ['/pagos', (d) => Array.isArray(d.data)],
  ['/personas', (d) => Array.isArray(d.data)],
  ['/servicio-registros', (d) => Array.isArray(d.data)],
  ['/solicitudes', (d) => Array.isArray(d.data)],
  ['/soportes', (d) => Array.isArray(d.data)],
  ['/documentos?empresa_id=1', (d) => Array.isArray(d.data)],
  ['/catalogos', (d) => typeof d === 'object'],
  ['/ventas', (d) => Array.isArray(d)],
  ['/diagnosticos', (d) => Array.isArray(d.data) && !!d.stats],
]

test('endpoints críticos responden 200 con datos', async () => {
  const { token } = await loginAs(ADMIN)
  for (const [path, check] of CRITICOS) {
    const res = await api.get(path, { token })
    assert.equal(res.status, 200, `${path} → ${res.status}`)
    assert.ok(check(res.data), `${path} estructura inesperada`)
  }
})

test('diagnosticos stats incluye por_estado', async () => {
  const { token } = await loginAs(ADMIN)
  const res = await api.get('/diagnosticos', { token })
  assert.ok(Array.isArray(res.data.stats.por_estado), 'falta por_estado')
})

test('leads: crear, mover y eliminar (ciclo de vida)', async () => {
  const { token } = await loginAs(ADMIN)

  // resolver embudo "clientes" → embudo_id
  const embudo = await api.get('/ventas/embudo/clientes', { token })
  const etapas = embudo.data.etapas
  assert.ok(etapas.length >= 2)
  const embudoId = embudo.data.embudo.id

  const create = await api.post('/ventas/leads', {
    nombre: 'Lead Test Ciclo',
    nombre_emprendedor: 'Tester',
    embudo_id: embudoId,
  }, { token })
  assert.equal(create.status, 201)
  const leadId = create.data.lead.id

  // mover a 2da etapa del embudo
  const move = await api.put(`/ventas/leads/${leadId}/etapa`, { etapa_id: etapas[1].id }, { token })
  assert.equal(move.status, 200)

  // historial registra el movimiento
  const show = await api.get(`/ventas/leads/${leadId}`, { token })
  assert.ok(show.data.historial.length >= 2, 'el historial no registró los movimientos')

  const del = await api.delete(`/ventas/leads/${leadId}`, { token })
  assert.equal(del.status, 200)
})

test.after(() => stopApp())

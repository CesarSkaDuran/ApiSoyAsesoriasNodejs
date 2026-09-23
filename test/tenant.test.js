import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'

// Aislamiento de tenant: la empresa solo ve sus propios datos.
test('empresa solo ve sus propios diagnósticos', async (t) => {
  let empresa, admin
  try {
    empresa = await loginAs(EMPRESA)
  } catch {
    return t.skip('usuario empresa de prueba no disponible')
  }
  admin = await loginAs(ADMIN)

  const resEmp = await api.get('/diagnosticos', { token: empresa.token })
  const resAdm = await api.get('/diagnosticos', { token: admin.token })
  assert.equal(resEmp.status, 200)
  assert.equal(resAdm.status, 200)

  const empresaId = empresa.user.empresa?.id
  assert.ok(empresaId, 'el usuario empresa no tiene empresa vinculada')

  // todo diagnóstico visible para la empresa debe ser de SU empresa
  for (const d of resEmp.data.data) {
    assert.equal(d.empresa_id, empresaId, `diagnóstico ${d.id} no pertenece a la empresa`)
  }
  // la empresa no ve más diagnósticos que el total
  assert.ok(resEmp.data.total <= resAdm.data.total)
})

test('empresa no puede ver diagnóstico ajeno por id', async (t) => {
  let empresa, admin
  try {
    empresa = await loginAs(EMPRESA)
  } catch {
    return t.skip('usuario empresa de prueba no disponible')
  }
  admin = await loginAs(ADMIN)

  // buscar un diagnóstico que NO sea de esta empresa
  const resAdm = await api.get('/diagnosticos', { token: admin.token })
  const ajeno = resAdm.data.data.find((d) => d.empresa_id !== empresa.user.empresa?.id)
  if (!ajeno) return t.skip('no hay diagnósticos ajenos para probar')

  const res = await api.get(`/diagnosticos/${ajeno.id}`, { token: empresa.token })
  assert.ok(res.status === 403 || res.status === 404, `esperaba 403/404, fue ${res.status}`)
})

test('empresa solo ve sus propias cuentas de cobro', async (t) => {
  let empresa
  try {
    empresa = await loginAs(EMPRESA)
  } catch {
    return t.skip('usuario empresa de prueba no disponible')
  }
  const res = await api.get('/pagos', { token: empresa.token })
  assert.equal(res.status, 200)
  for (const p of res.data.data) {
    assert.equal(p.empresa_id, empresa.user.empresa?.id, `cuenta ${p.id} no es de la empresa`)
  }
})

test.after(() => stopApp())

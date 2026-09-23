import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, EMPRESA, stopApp } from './helpers.js'

// Permisos por rol: admin pasa a todo; empresa queda en 403 en endpoints admin-only.
test('empresa no puede acceder a endpoints admin-only', async () => {
  let empresa
  try {
    empresa = await loginAs(EMPRESA)
  } catch {
    return test.skip('usuario empresa de prueba no disponible')
  }
  const { token } = empresa
  for (const path of ['/usuarios', '/gastos', '/maestros', '/informes/resumen']) {
    const res = await api.get(path, { token })
    assert.equal(res.status, 403, `${path} debería ser 403 para empresa, fue ${res.status}`)
  }
})

test('admin sí accede a endpoints admin-only', async () => {
  const { token } = await loginAs(ADMIN)
  for (const path of ['/usuarios', '/gastos', '/maestros', '/informes/resumen']) {
    const res = await api.get(path, { token })
    assert.equal(res.status, 200, `${path} debería ser 200 para admin, fue ${res.status}`)
  }
})

test('empresa no puede crear diagnóstico (admin-only)', async () => {
  let empresa
  try {
    empresa = await loginAs(EMPRESA)
  } catch {
    return test.skip('usuario empresa de prueba no disponible')
  }
  const res = await api.post('/diagnosticos', { nombre: 'x' }, { token: empresa.token })
  assert.equal(res.status, 403)
})

test('sin token todo endpoint protegido → 401', async () => {
  for (const path of ['/empresas', '/empleados', '/nominas', '/pagos', '/ventas', '/diagnosticos']) {
    const res = await api.get(path)
    assert.equal(res.status, 401, `${path} debería ser 401 sin token, fue ${res.status}`)
  }
})

test.after(() => stopApp())

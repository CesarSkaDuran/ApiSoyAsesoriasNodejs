import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import app from '../src/app.js'

let server

test('Swagger expone la especificación OpenAPI y la interfaz web', async (t) => {
  server = createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const specResponse = await fetch(`${baseUrl}/swagger.json`)
  assert.equal(specResponse.status, 200)

  const spec = await specResponse.json()
  assert.equal(spec.openapi, '3.0.3')
  assert.ok(spec.paths['/api/auth/login']?.post)
  assert.ok(spec.paths['/api/nominas/{id}/liquidar']?.put)
  assert.ok(spec.components.securitySchemes.bearerAuth)

  const uiResponse = await fetch(`${baseUrl}/swagger/`)
  assert.equal(uiResponse.status, 200)
  assert.match(await uiResponse.text(), /swagger-ui/)
})

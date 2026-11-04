import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import { requireModulo } from '../src/middlewares/auth.js'
import db from '../src/db/knex.js'

const sessionIds = []
const temporaryUsers = []

test('Asistente IA requiere permiso explícito para usuarios no administradores', () => {
  let status
  let responseBody
  let passed = false
  const res = {
    status(code) {
      status = code
      return this
    },
    json(body) {
      responseBody = body
      return this
    },
  }
  requireModulo('ia')({ user: { id: 77, role: 'empresa', modulos: {} } }, res, () => { passed = true })
  assert.equal(passed, false)
  assert.equal(status, 403)
  assert.equal(responseBody.code, 'MODULO_NO_HABILITADO')
})

test('API informa que el proveedor IA necesita configuración sin exponer secretos', async () => {
  const admin = await loginAs(ADMIN)
  const old = {
    provider: process.env.AI_PROVIDER,
    geminiKey: process.env.AI_GEMINI_API_KEY,
    openaiKey: process.env.AI_API_KEY,
  }
  process.env.AI_PROVIDER = 'gemini'
  delete process.env.AI_GEMINI_API_KEY
  delete process.env.AI_API_KEY
  try {
    const response = await api.post('/ia/chat', {
      messages: [{ role: 'user', content: 'Ayúdame con un informe' }],
    }, { token: admin.token })
    assert.equal(response.status, 503)
    assert.equal(response.data.code, 'IA_NO_CONFIGURADA')
  } finally {
    if (old.provider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = old.provider
    if (old.geminiKey === undefined) delete process.env.AI_GEMINI_API_KEY
    else process.env.AI_GEMINI_API_KEY = old.geminiKey
    if (old.openaiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = old.openaiKey
  }
})

test('un 404 del proveedor muestra una pista de configuración sin revelar la clave', async () => {
  const admin = await loginAs(ADMIN)
  const oldEnv = {
    provider: process.env.AI_PROVIDER,
    geminiKey: process.env.AI_GEMINI_API_KEY,
    key: process.env.AI_API_KEY,
    geminiBase: process.env.AI_GEMINI_BASE_URL,
    base: process.env.AI_API_BASE_URL,
    model: process.env.AI_MODEL,
  }
  const oldFetch = globalThis.fetch
  process.env.AI_PROVIDER = 'gemini'
  process.env.AI_GEMINI_API_KEY = 'test-key-not-real'
  process.env.AI_GEMINI_BASE_URL = 'https://example.invalid/v1beta/openai'
  process.env.AI_MODEL = 'gemini-test-model'
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return oldFetch(input, init)
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { status: 'NOT_FOUND', message: 'Model not found' } }),
    }
  }
  try {
    const response = await api.post('/ia/chat', {
      messages: [{ role: 'user', content: 'Ayúdame con un informe' }],
    }, { token: admin.token })
    assert.equal(response.status, 502)
    assert.equal(response.data.provider_status, 404)
    assert.equal(response.data.provider_code, 'NOT_FOUND')
    assert.equal(response.data.provider_message, 'Model not found')
    assert.match(response.data.error, /AI_MODEL/)
    assert.doesNotMatch(JSON.stringify(response.data), /test-key-not-real/)
  } finally {
    globalThis.fetch = oldFetch
    if (oldEnv.provider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = oldEnv.provider
    if (oldEnv.geminiKey === undefined) delete process.env.AI_GEMINI_API_KEY
    else process.env.AI_GEMINI_API_KEY = oldEnv.geminiKey
    if (oldEnv.key === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = oldEnv.key
    if (oldEnv.geminiBase === undefined) delete process.env.AI_GEMINI_BASE_URL
    else process.env.AI_GEMINI_BASE_URL = oldEnv.geminiBase
    if (oldEnv.base === undefined) delete process.env.AI_API_BASE_URL
    else process.env.AI_API_BASE_URL = oldEnv.base
    if (oldEnv.model === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = oldEnv.model
  }
})

test('IA consulta el informe de solicitudes con datos agregados antes de responder', async () => {
  const admin = await loginAs(ADMIN)
  const [solicitudId] = await db('solicitudes').insert({
    empresa_id: (await db('empresas').first('id')).id,
    tipo_solicitud: 'general',
    descripcion: 'Fixture temporal de resumen IA',
    status: 'pendiente',
    created_at: new Date(),
    updated_at: new Date(),
  })
  const oldEnv = {
    provider: process.env.AI_PROVIDER,
    geminiKey: process.env.AI_GEMINI_API_KEY,
    apiKey: process.env.AI_API_KEY,
    base: process.env.AI_GEMINI_BASE_URL,
    model: process.env.AI_MODEL,
  }
  const oldFetch = globalThis.fetch
  let requestToModel
  process.env.AI_PROVIDER = 'gemini'
  process.env.AI_GEMINI_API_KEY = 'test-key-not-real'
  process.env.AI_GEMINI_BASE_URL = 'https://example.invalid/v1beta/openai'
  process.env.AI_MODEL = 'gemini-test-model'
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return oldFetch(input, init)
    requestToModel = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'El informe muestra solicitudes pendientes.' } }] }),
    }
  }
  try {
    const response = await api.post('/ia/chat', {
      contexto: 'informes',
      messages: [{ role: 'user', content: 'Genera el informe de solicitudes de este mes' }],
    }, { token: admin.token })
    assert.equal(response.status, 200)
    assert.match(response.data.respuesta, /solicitudes pendientes/)
    const systemPrompt = requestToModel.messages.find(message => message.role === 'system')?.content || ''
    assert.match(systemPrompt, /Informe agregado autorizado/)
    assert.match(systemPrompt, /resumen/)
    assert.doesNotMatch(systemPrompt, /Fixture temporal de resumen IA/)
    assert.doesNotMatch(JSON.stringify(requestToModel), /test-key-not-real/)
  } finally {
    globalThis.fetch = oldFetch
    if (oldEnv.provider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = oldEnv.provider
    if (oldEnv.geminiKey === undefined) delete process.env.AI_GEMINI_API_KEY
    else process.env.AI_GEMINI_API_KEY = oldEnv.geminiKey
    if (oldEnv.apiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = oldEnv.apiKey
    if (oldEnv.base === undefined) delete process.env.AI_GEMINI_BASE_URL
    else process.env.AI_GEMINI_BASE_URL = oldEnv.base
    if (oldEnv.model === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = oldEnv.model
    await db('solicitudes').where('id', solicitudId).delete()
  }
})

test('un informe de solicitudes autorizado se envía a Gemini solo como datos agregados', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await db('empresas').first('id')
  const marcaPrivada = `PRIVADO-${Date.now()}`
  const [solicitudId] = await db('solicitudes').insert({
    empresa_id: empresa.id,
    tipo_solicitud: 'general',
    descripcion: marcaPrivada,
    status: 'pendiente',
    created_at: new Date(),
    updated_at: new Date(),
  })
  const oldEnv = {
    provider: process.env.AI_PROVIDER,
    geminiKey: process.env.AI_GEMINI_API_KEY,
    apiKey: process.env.AI_API_KEY,
    geminiBase: process.env.AI_GEMINI_BASE_URL,
    base: process.env.AI_API_BASE_URL,
    model: process.env.AI_MODEL,
  }
  const oldFetch = globalThis.fetch
  let requestToModel
  process.env.AI_PROVIDER = 'gemini'
  process.env.AI_GEMINI_API_KEY = 'test-key-not-real'
  process.env.AI_GEMINI_BASE_URL = 'https://example.invalid/v1beta/openai'
  process.env.AI_MODEL = 'gemini-test-model'
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return oldFetch(input, init)
    requestToModel = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Resumen generado.' } }] }),
    }
  }
  try {
    const response = await api.post('/ia/chat', {
      contexto: 'informe_solicitudes',
      messages: [{ role: 'user', content: 'Genera el informe de solicitudes de este mes' }],
    }, { token: admin.token })
    assert.equal(response.status, 200)
    const systemPrompt = requestToModel.messages.find(message => message.role === 'system')?.content || ''
    assert.match(systemPrompt, /Informe agregado autorizado/)
    assert.match(systemPrompt, /pendientes/)
    assert.doesNotMatch(systemPrompt, new RegExp(marcaPrivada))
    assert.doesNotMatch(JSON.stringify(requestToModel), /test-key-not-real/)
  } finally {
    globalThis.fetch = oldFetch
    if (oldEnv.provider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = oldEnv.provider
    if (oldEnv.geminiKey === undefined) delete process.env.AI_GEMINI_API_KEY
    else process.env.AI_GEMINI_API_KEY = oldEnv.geminiKey
    if (oldEnv.apiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = oldEnv.apiKey
    if (oldEnv.geminiBase === undefined) delete process.env.AI_GEMINI_BASE_URL
    else process.env.AI_GEMINI_BASE_URL = oldEnv.geminiBase
    if (oldEnv.base === undefined) delete process.env.AI_API_BASE_URL
    else process.env.AI_API_BASE_URL = oldEnv.base
    if (oldEnv.model === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = oldEnv.model
    await db('solicitudes').where('id', solicitudId).delete()
  }
})

test('las conversaciones IA guardan y recuperan mensajes dentro de la sesión propia', async () => {
  const admin = await loginAs(ADMIN)
  const session = await api.post('/ia/sesiones', { contexto: 'general' }, { token: admin.token })
  assert.equal(session.status, 201)
  const sessionId = session.data.sesion.id
  sessionIds.push(sessionId)

  const oldEnv = {
    provider: process.env.AI_PROVIDER,
    geminiKey: process.env.AI_GEMINI_API_KEY,
    apiKey: process.env.AI_API_KEY,
    geminiBase: process.env.AI_GEMINI_BASE_URL,
    base: process.env.AI_API_BASE_URL,
    model: process.env.AI_MODEL,
  }
  const oldFetch = globalThis.fetch
  process.env.AI_PROVIDER = 'gemini'
  process.env.AI_GEMINI_API_KEY = 'test-key-not-real'
  process.env.AI_GEMINI_BASE_URL = 'https://example.invalid/v1beta/openai'
  process.env.AI_MODEL = 'gemini-test-model'
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return oldFetch(input, init)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Respuesta guardada.' } }] }),
    }
  }
  try {
    const answer = await api.post('/ia/chat', {
      session_id: sessionId,
      message: '¿Cómo uso informes?',
    }, { token: admin.token })
    assert.equal(answer.status, 200)
    assert.equal(answer.data.titulo, '¿Cómo uso informes?')

    const history = await api.get(`/ia/sesiones/${sessionId}`, { token: admin.token })
    assert.equal(history.status, 200)
    assert.equal(history.data.mensajes.length, 2)
    assert.equal(history.data.mensajes[0].rol, 'user')
    assert.equal(history.data.mensajes[0].contenido, '¿Cómo uso informes?')
    assert.equal(history.data.mensajes[1].contenido, 'Respuesta guardada.')
    assert.ok((await api.get('/ia/sesiones', { token: admin.token })).data.data.some(s => s.id === sessionId))

    const email = `ia-sesion-privada-${Date.now()}@prueba.local`
    const secondUser = await api.post('/auth/users', {
      name: 'Asesor prueba IA',
      email,
      password: 'AsesorSeguro123',
      role: 'asesor',
      modulos: { ia: true },
    }, { token: admin.token })
    assert.equal(secondUser.status, 201)
    temporaryUsers.push(secondUser.data.user.id)
    const secondLogin = await api.post('/auth/login', { email, password: 'AsesorSeguro123' })
    assert.equal(secondLogin.status, 200)
    const privateSession = await api.get(`/ia/sesiones/${sessionId}`, { token: secondLogin.data.token })
    assert.equal(privateSession.status, 404)

    const deleted = await api.delete(`/ia/sesiones/${sessionId}`, { token: admin.token })
    assert.equal(deleted.status, 200)
    sessionIds.pop()
    assert.equal((await api.get(`/ia/sesiones/${sessionId}`, { token: admin.token })).status, 404)
  } finally {
    globalThis.fetch = oldFetch
    if (oldEnv.provider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = oldEnv.provider
    if (oldEnv.geminiKey === undefined) delete process.env.AI_GEMINI_API_KEY
    else process.env.AI_GEMINI_API_KEY = oldEnv.geminiKey
    if (oldEnv.apiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = oldEnv.apiKey
    if (oldEnv.geminiBase === undefined) delete process.env.AI_GEMINI_BASE_URL
    else process.env.AI_GEMINI_BASE_URL = oldEnv.geminiBase
    if (oldEnv.base === undefined) delete process.env.AI_API_BASE_URL
    else process.env.AI_API_BASE_URL = oldEnv.base
    if (oldEnv.model === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = oldEnv.model
  }
})

test.after(async () => {
  for (const id of sessionIds) {
    await db('ia_chat_mensajes').where('sesion_id', id).delete()
    await db('ia_chat_sesiones').where('id', id).delete()
  }
  for (const id of temporaryUsers) {
    await db('refresh_tokens').where('user_id', id).delete()
    await db('user_modulos').where('user_id', id).delete()
    await db('user_modulo_permisos').where('user_id', id).delete()
    await db('users').where('id', id).delete()
  }
  await stopApp()
})

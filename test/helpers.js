// Helpers para tests de integración contra la app Express real.
// Levanta la app en un puerto efímero y expone helpers de login/fetch.
// Requiere la BD de desarrollo (misma .env) — los tests son mayormente
// de lectura; las escrituras se crean y eliminan dentro del test.
import { once } from 'node:events'
import app from '../src/app.js'
import db from '../src/db/knex.js'

process.env.NODE_ENV = 'test'

export const ADMIN = { email: 'admin@soyasesorias.com', password: '1234567' }
export const EMPRESA = { email: 'soyasesorias@prueba.com', password: '12345678' }

let server, baseUrl, startPromise

export async function startApp() {
  if (baseUrl) return baseUrl
  if (startPromise) return startPromise
  server = app.listen(0)
  startPromise = once(server, 'listening').then(() => {
    baseUrl = `http://127.0.0.1:${server.address().port}/api`
    return baseUrl
  })
  return startPromise
}

export async function stopApp() {
  if (server?.listening) {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections?.()
    await closed
  }
  server = undefined
  baseUrl = undefined
  startPromise = undefined
  await db.destroy() // cierra el pool para que el proceso del test pueda salir
}

async function request(method, path, { token, body, headers } = {}) {
  const base = await startApp()
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* body vacío */ }
  return { status: res.status, data }
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  delete: (path, opts) => request('DELETE', path, opts),
}

const tokenCache = new Map()

export async function loginAs({ email, password }) {
  if (tokenCache.has(email)) return tokenCache.get(email)
  const res = await api.post('/auth/login', { email, password })
  if (res.status !== 200) {
    throw new Error(`Login falló para ${email}: ${res.status} ${JSON.stringify(res.data)}`)
  }
  tokenCache.set(email, res.data)
  return res.data // { token, refresh_token, user }
}

// Identidad global de prueba: crea la persona si no existe (los tests
// insertan empleados directamente y ahora empleados.persona_id es NOT NULL).
export async function ensurePersona(num_documento, datos = {}) {
  const existente = await db('personas').where({ num_documento }).first()
  if (existente) return existente.id
  const [id] = await db('personas').insert({
    primer_nombre: datos.primer_nombre || 'PRUEBA',
    primer_apellido: datos.primer_apellido || 'IDENTIDAD',
    tipo_documento: datos.tipo_documento || 'CC',
    num_documento,
    fecha_nacimiento: datos.fecha_nacimiento || null,
    status: 'activo',
    es_independiente: false,
  })
  return id
}

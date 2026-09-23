import { pino } from 'pino'
import db from '../db/knex.js'

const logger = pino({ name: 'audit' })
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SENSITIVE_FIELD = /password|token|secret|authorization|cookie|credential/i
const DETAIL_FIELDS = new Set(['status', 'status_pago', 'role', 'is_active', 'estado'])
const AUDIT_EXCLUDED = ['/auth/login', '/auth/refresh', '/notificaciones', '/auditorias']

function auditTarget(path) {
  const segments = path.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  if (segments[0] === 'auth' && segments[1]) segments.splice(0, 1)
  const source = segments[0] || 'sistema'
  const resource = source === 'users' ? 'usuarios' : source
  const resourceId = segments.slice(1).find(segment => /^\d+$/.test(segment))
  return { resource, resourceId: resourceId || null }
}

function responseId(body) {
  const record = body?.solicitud || body?.empresa || body?.persona || body?.empleado ||
    body?.registro || body?.nomina || body?.planilla || body?.cuenta || body?.user || body?.documento
  return record?.id ?? body?.id ?? null
}

function requestDetails(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const fields = Object.keys(source).filter(key => !SENSITIVE_FIELD.test(key))
  const details = {}

  for (const [key, value] of Object.entries(source)) {
    if (DETAIL_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      details[key] = value
    }
  }
  if (source.modulos && typeof source.modulos === 'object' && !Array.isArray(source.modulos)) {
    details.modulos = Object.fromEntries(Object.entries(source.modulos).map(([key, value]) => [key, !!value]))
  }
  if (Object.keys(source).some(key => /password|token|secret|credential/i.test(key))) {
    details.credenciales_actualizadas = true
  }

  return { fields, details }
}

export function auditMutation(req, res, next) {
  if (process.env.NODE_ENV === 'test' && req.headers['x-audit-test'] !== 'true') return next()
  if (!MUTATING_METHODS.has(req.method)) return next()

  const path = req.path
  if (AUDIT_EXCLUDED.some(excluded => path.includes(excluded))) return next()

  const originalJson = res.json.bind(res)
  let auditStarted = false

  res.json = body => {
    if (!req.user || auditStarted) return originalJson(body)
    auditStarted = true

    const { resource, resourceId } = auditTarget(path)
    const { fields, details } = requestDetails(req.body)
    const action = path.endsWith('/logout') ? 'cerrar_sesion' : {
      POST: 'crear',
      PUT: 'actualizar',
      PATCH: 'actualizar',
      DELETE: 'eliminar',
    }[req.method]
    const recordId = resourceId || responseId(body)
    const entry = {
      user_id: req.user.id,
      actor_email: req.user.email || null,
      actor_role: req.user.role || null,
      accion: action,
      recurso: resource,
      recurso_id: recordId ? String(recordId).slice(0, 80) : null,
      metodo: req.method,
      ruta: path.slice(0, 255),
      codigo_respuesta: res.statusCode,
      ip: String(req.ip || '').slice(0, 45) || null,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 255) || null,
      campos: JSON.stringify(fields),
      detalle: JSON.stringify(details),
    }

    db('auditorias').insert(entry)
      .catch(err => logger.error({ err, resource, action }, 'No se pudo guardar movimiento de auditoría'))
      .finally(() => originalJson(body))
    return res
  }

  next()
}

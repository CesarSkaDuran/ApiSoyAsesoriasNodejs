import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

// Access token: corto (renovado por /auth/refresh).
// Refresh token: opaco, aleatorio, guardado como SHA-256 en refresh_tokens,
// con rotación en cada uso (un refresh robado y reusado queda revocado).
const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '30m'
const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 7

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

function signAccess(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  })
}

async function issueRefreshToken(userId, req, connection = db) {
  const token = crypto.randomBytes(48).toString('hex')
  await connection('refresh_tokens').insert({
    user_id: userId,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + REFRESH_DAYS * 86_400_000),
    ip: req.ip || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 255),
  })
  return token
}

// Payload completo que consume el frontend (usuario + scope + permisos)
async function buildUserPayload(user) {
  let empresa = null
  let persona = null
  if (user.role === 'empresa') {
    empresa = await db('empresas').where('user_id', user.id).first()
  } else if (user.role === 'independiente') {
    persona = await db('personas').where('user_id', user.id).first()
  }
  const modulos = await db('user_modulos').where('user_id', user.id).first() || {}
  const { password: _, ...userSafe } = user
  return { ...userSafe, empresa, persona, modulos }
}

export async function login(req, res) {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y password requeridos' })
  }

  const user = await db('users')
    .select('id', 'name', 'lastname', 'email', 'password', 'role', 'is_active')
    .where('email', email)
    .first()

  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' })
  if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' })

  await db('users').where('id', user.id).update({ last_seen_at: new Date() })

  const [token, refreshToken] = await Promise.all([
    Promise.resolve(signAccess(user)),
    issueRefreshToken(user.id, req),
  ])

  res.json({
    token,
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL,
    user: await buildUserPayload(user),
  })
}

// POST /auth/refresh — rotación: revoca el usado y emite par nuevo
export async function refresh(req, res) {
  const { refresh_token } = req.body || {}
  if (!refresh_token) {
    return res.status(400).json({ error: 'refresh_token requerido' })
  }

  const row = await db('refresh_tokens')
    .where('token_hash', sha256(String(refresh_token)))
    .whereNull('revoked_at')
    .where('expires_at', '>', new Date())
    .first()

  if (!row) {
    return res.status(401).json({ error: 'Refresh token inválido o expirado' })
  }

  const user = await db('users')
    .select('id', 'name', 'lastname', 'email', 'password', 'role', 'is_active')
    .where('id', row.user_id)
    .first()

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Usuario no disponible' })
  }

  await db('refresh_tokens').where('id', row.id).update({ revoked_at: new Date() })
  const newRefresh = await issueRefreshToken(user.id, req)

  res.json({
    token: signAccess(user),
    refresh_token: newRefresh,
    expires_in: ACCESS_TTL,
    user: await buildUserPayload(user),
  })
}

export async function me(req, res) {
  res.json({ user: req.user })
}

export async function logout(req, res) {
  // Revoca el refresh token de la sesión (si viene en el body)
  const { refresh_token } = req.body || {}
  if (refresh_token) {
    await db('refresh_tokens')
      .where('token_hash', sha256(String(refresh_token)))
      .update({ revoked_at: new Date() })
  }
  res.json({ message: 'Sesion cerrada' })
}

export async function changePassword(req, res) {
  const { current_password, new_password } = req.body || {}
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'La contraseña actual y la nueva son requeridas' })
  }
  if (new_password.length < 8 || Buffer.byteLength(new_password, 'utf8') > 72) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres y no superar 72 bytes' })
  }

  const user = await db('users')
    .select('id', 'name', 'lastname', 'email', 'password', 'role', 'is_active')
    .where('id', req.user.id)
    .first()
  if (!user || !user.is_active) return res.status(403).json({ error: 'Usuario no disponible' })
  if (!await bcrypt.compare(current_password, user.password)) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta' })
  }
  if (await bcrypt.compare(new_password, user.password)) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' })
  }

  const password = await bcrypt.hash(new_password, 10)
  let refreshToken
  await db.transaction(async trx => {
    await trx('users').where('id', user.id).update({ password })
    await trx('refresh_tokens')
      .where('user_id', user.id)
      .whereNull('revoked_at')
      .update({ revoked_at: new Date() })
    refreshToken = await issueRefreshToken(user.id, req, trx)
  })

  const updatedUser = { ...user, password }
  res.json({
    token: signAccess(updatedUser),
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL,
    user: await buildUserPayload(updatedUser),
  })
}

// Crea el usuario de una empresa o independiente + su fila de permisos.
// Solo admin. Reemplaza el UserMutation inseguro del sistema viejo.
export async function createUser(req, res) {
  const { name, lastname, email, password, role, empresa_id, persona_id, modulos } = req.body

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password y role son requeridos' })
  }
  if (!['empresa', 'independiente', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role invalido' })
  }

  const exists = await db('users').where('email', email).first()
  if (exists) return res.status(409).json({ error: 'El email ya esta registrado' })

  const [userId] = await db('users').insert({
    name,
    lastname: lastname || null,
    email,
    password: bcrypt.hashSync(password, 10),
    role,
    is_active: true,
  })

  // Vincular a empresa/persona y permisos por defecto
  if (role === 'empresa' && empresa_id) {
    await db('empresas').where('id', empresa_id).update({ user_id: userId })
    await db('user_modulos').insert({
      user_id: userId,
      home: true, empresas: true, documentos: true, empleados: true,
      nominas: true, servicios: true, pagos: true, solicitudes: true,
      ...(modulos || {}),
    })
  } else if (role === 'independiente' && persona_id) {
    await db('personas').where('id', persona_id).update({ user_id: userId })
    await db('user_modulos').insert({
      user_id: userId,
      home: true, documentos: true, pagos: true, planillas: true,
      servicios: true, independientes: true, solicitudes: true,
      ...(modulos || {}),
    })
  } else {
    await db('user_modulos').insert({ user_id: userId, ...(modulos || {}) })
  }

  const user = await db('users').where('id', userId).first()
  const { password: _, ...userSafe } = user
  res.status(201).json({ user: userSafe })
}

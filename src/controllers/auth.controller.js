import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

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

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  )

  // Datos de scope para el frontend (empresa/persona + permisos)
  let empresa = null
  let persona = null
  if (user.role === 'empresa') {
    empresa = await db('empresas').where('user_id', user.id).first()
  } else if (user.role === 'independiente') {
    persona = await db('personas').where('user_id', user.id).first()
  }
  const modulos = await db('user_modulos').where('user_id', user.id).first() || {}

  const { password: _, ...userSafe } = user
  res.json({ token, user: { ...userSafe, empresa, persona, modulos } })
}

export async function me(req, res) {
  res.json({ user: req.user })
}

export async function logout(req, res) {
  // JWT stateless: el cliente borra el token. Para revocacion real usar blacklist.
  res.json({ message: 'Sesion cerrada' })
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
      nominas: true, servicios: true, pagos: true,
      ...(modulos || {}),
    })
  } else if (role === 'independiente' && persona_id) {
    await db('personas').where('id', persona_id).update({ user_id: userId })
    await db('user_modulos').insert({
      user_id: userId,
      home: true, documentos: true, pagos: true, planillas: true,
      servicios: true, independientes: true,
      ...(modulos || {}),
    })
  } else {
    await db('user_modulos').insert({ user_id: userId, ...(modulos || {}) })
  }

  const user = await db('users').where('id', userId).first()
  const { password: _, ...userSafe } = user
  res.status(201).json({ user: userSafe })
}

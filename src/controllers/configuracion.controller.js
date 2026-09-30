import db from '../db/knex.js'
import { getSmtpConfig, probarConexion } from '../services/mailer.js'

// Configuracion general del sistema (por ahora: correo SMTP).
// Solo admin — ver routes.

// GET /configuracion/correo
// Devuelve la config efectiva SIN la contraseña; solo indica si hay una
// guardada (password_configurada) para que el front muestre el placeholder.
export async function getCorreo(req, res) {
  const cfg = await getSmtpConfig()
  res.json({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    username: cfg.user,
    remitente: cfg.from,
    correos_admin: cfg.correos_admin || '',
    password_configurada: !!cfg.pass,
    origen: cfg.origen, // 'bd' = tabla smtp_config, 'env' = variables de entorno
  })
}

// PUT /configuracion/correo
// Valida y guarda la config en smtp_config (upsert de la fila unica).
// La contraseña es opcional: si llega vacia se conserva la existente.
export async function putCorreo(req, res) {
  const { host, port, secure, username, password, remitente, correos_admin } = req.body || {}

  if (!host || !String(host).trim()) {
    return res.status(400).json({ error: 'El servidor (host) es obligatorio' })
  }
  const portNum = Number(port)
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'Puerto inválido' })
  }
  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'El usuario es obligatorio' })
  }

  const actual = await db('smtp_config').orderBy('id').first()
  const passFinal =
    password !== undefined && password !== null && String(password) !== ''
      ? String(password)
      : (actual?.password ?? process.env.SMTP_PASS ?? null)

  const data = {
    host: String(host).trim(),
    port: portNum,
    secure: !!secure,
    username: String(username).trim(),
    password: passFinal,
    remitente: remitente ? String(remitente).trim() : null,
    correos_admin: correos_admin !== undefined
      ? String(correos_admin || '').trim() || null
      : (actual?.correos_admin ?? null),
    updated_by: req.user?.id ?? null,
  }

  if (actual) {
    await db('smtp_config').where('id', actual.id).update(data)
  } else {
    await db('smtp_config').insert(data)
  }

  res.json({ ok: true })
}

// POST /configuracion/correo/probar
// Prueba la conexion SMTP con los valores enviados (o los guardados si
// llegan vacios). No guarda nada — es solo verificacion.
export async function probarCorreo(req, res) {
  const { host, port, secure, username, password } = req.body || {}
  const guardada = await getSmtpConfig()

  const cfg = {
    host: host ? String(host).trim() : guardada.host,
    port: Number(port) || guardada.port,
    secure: secure !== undefined ? !!secure : guardada.secure,
    user: username ? String(username).trim() : guardada.user,
    pass: password ? String(password) : guardada.pass,
  }

  const r = await probarConexion(cfg)
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error })
  res.json({ ok: true })
}

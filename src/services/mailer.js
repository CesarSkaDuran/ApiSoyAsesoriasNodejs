import nodemailer from 'nodemailer'
import db from '../db/knex.js'

// Servicio de correo central. Fail-soft por diseño: un correo nunca debe
// tumbar el request de negocio que lo disparo; los errores quedan en
// email_log para auditoria.
//
// Config con doble fuente:
//   1. smtp_config (BD) — editable desde Configuracion > Correo
//   2. Variables de entorno (respaldo si la tabla esta vacia)
//      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM

let transporter = null
let transporterKey = ''

// Config efectiva: la fila de smtp_config si existe; si no, las env.
export async function getSmtpConfig() {
  const row = await db('smtp_config').orderBy('id').first().catch(() => null)
  if (row && row.host) {
    return {
      host: row.host,
      port: Number(row.port) || 465,
      secure: !!row.secure,
      user: row.username,
      pass: row.password,
      from: row.remitente,
      correos_admin: row.correos_admin || '',
      origen: 'bd',
    }
  }
  const port = Number(process.env.SMTP_PORT) || 465
  return {
    host: process.env.SMTP_HOST || '',
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    correos_admin: process.env.ADMIN_NOTIFY_EMAILS || '',
    origen: 'env',
  }
}

function crearTransporte(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
}

function getTransporter(cfg) {
  const key = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.pass}`
  if (!transporter || transporterKey !== key) {
    transporter = crearTransporte(cfg)
    transporterKey = key
  }
  return transporter
}

function remitente(cfg) {
  return cfg.from || `Soy Asesorías <${cfg.user}>`
}

// Verifica la conexion SMTP sin enviar correo. Acepta una config ad-hoc
// (formulario previo a guardar) o usa la guardada. Nunca lanza.
export async function probarConexion(cfgOverride = null) {
  const cfg = cfgOverride || (await getSmtpConfig())
  if (!cfg.host || !cfg.user) {
    return { ok: false, error: 'Faltan datos: host y usuario son obligatorios' }
  }
  try {
    await crearTransporte(cfg).verify()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.response || e.message }
  }
}

// Plantilla responsive con degradado corporativo y marca del actor:
// el staff usa Soy Asesorias; las acciones del cliente usan su imagen/logo.
export function plantillaCorreo({ titulo, mensaje, detalle, url, marca = {} }) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const base = (process.env.PORTAL_URL || 'http://localhost:3873').replace(/\/$/, '')
  const link = !url ? base : url.startsWith('http') ? url : `${base}${url}`
  const color = /^#[\da-f]{6}$/i.test(marca.color || '') ? marca.color : '#075cf5'
  const gradient = `linear-gradient(120deg, #172554 0%, ${color} 100%)`
  const brandName = esc(marca.nombre || 'Soy Asesorias')
  const logoUrl = marca.logoUrl && /^https:\/\//i.test(marca.logoUrl) ? marca.logoUrl : ''
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${brandName}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;border-radius:12px;background:#ffffff;padding:5px;border:1px solid rgba(255,255,255,.55)">`
    : `<div style="width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,.18);color:#ffffff;font-size:20px;font-weight:bold;line-height:56px;text-align:center">${brandName.slice(0, 1)}</div>`
  const firma = marca.tipo === 'cliente' ? 'Notificación de tu cuenta' : 'Soy Asesorías · Notificación del sistema'
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 12px 35px rgba(15,23,42,.12)">
    <div style="background:${gradient};background-color:${color};padding:24px 28px;color:#ffffff">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td width="72" valign="middle">${logo}</td>
        <td valign="middle" style="padding-left:14px"><div style="font-size:19px;line-height:1.3;font-weight:700">${brandName}</div><div style="margin-top:4px;font-size:12px;color:#e2eaff">${firma}</div></td>
      </tr></table>
    </div>
    <div style="padding:30px 28px 26px">
      <div style="margin-bottom:8px;color:${color};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Actualización de actividad</div>
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.35;color:#111827">${esc(titulo)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65">${esc(mensaje)}</p>
      ${detalle ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:10px;padding:15px 17px;font-size:13px;color:#334155;line-height:1.7">${detalle}</div>` : ''}
      <p style="margin:24px 0 4px">
        <a href="${esc(link)}" style="display:inline-block;background:${gradient};background-color:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:9px;font-size:14px;font-weight:700">Ver en la plataforma</a>
      </p>
    </div>
    <div style="padding:17px 28px;background:#f8fafc;font-size:11px;color:#64748b;line-height:1.6;border-top:1px solid #e2e8f0">
      ${marca.tipo === 'cliente' ? `Notificación relacionada con ${brandName}.` : 'Recibiste este correo de Soy Asesorías por una actualización de tu cuenta.'}
      <br>Para dejar de recibir notificaciones, escribe a contacto@soyasesorias.co.
    </div>
  </div></body></html>`
}

async function logEmail({ userId = null, destinatario, entidad = null, entidadId = null, asunto, status, detalle }) {
  try {
    await db('email_log').insert({
      user_id: userId, destinatario, entidad, entidad_id: entidadId,
      asunto: String(asunto || '').slice(0, 255), status,
      detalle: detalle ? String(detalle).slice(0, 4000) : null,
    })
  } catch { /* el log nunca tumba el flujo */ }
}

// Envia un correo. Retorna { ok, skipped?, error? } — jamas lanza.
export async function enviarCorreo({ to, subject, html, text, entidad, entidadId, userId }) {
  if (process.env.NODE_ENV === 'test') return { ok: false, skipped: true }
  const destinatario = Array.isArray(to) ? to.join(',') : String(to || '')
  if (!destinatario) {
    await logEmail({ userId, destinatario, entidad, entidadId, asunto: subject, status: 'omitido', detalle: 'sin destinatario' })
    return { ok: false, skipped: true }
  }
  const cfg = await getSmtpConfig().catch(() => null)
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
    await logEmail({ userId, destinatario, entidad, entidadId, asunto: subject, status: 'omitido', detalle: 'SMTP no configurado' })
    return { ok: false, skipped: true }
  }
  const mail = {
    from: remitente(cfg),
    to: destinatario,
    subject,
    text: text || undefined,
    html: html || undefined,
  }
  // Errores transitorios de red/SMTP ameritan un reintento: el servidor
  // correo suele cortar conexiones ociosas o limitar ráfagas.
  const esTransitorio = (e) =>
    /ECONNRESET|ECONNECTION|ETIMEDOUT|ESOCKET|421|450|451|452/i.test(
      `${e.code || ''} ${e.responseCode || ''} ${e.message || ''}`
    )
  let ultimo = null
  for (let intento = 1; intento <= 2; intento++) {
    try {
      await getTransporter(cfg).sendMail(mail)
      await logEmail({ userId, destinatario, entidad, entidadId, asunto: subject, status: 'enviado' })
      return { ok: true }
    } catch (e) {
      ultimo = e
      if (!esTransitorio(e) || intento === 2) break
      transporter = null
      transporterKey = ''
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  await logEmail({ userId, destinatario, entidad, entidadId, asunto: subject, status: 'error', detalle: ultimo?.message })
  return { ok: false, error: ultimo?.message }
}

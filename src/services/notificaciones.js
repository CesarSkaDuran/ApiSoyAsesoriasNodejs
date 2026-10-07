import db from '../db/knex.js'
import { enviarCorreo, getSmtpConfig, plantillaCorreo } from './mailer.js'
import { TERMINOS_VERSION } from '../config/terminos.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'

// Motor de notificaciones de cambios de estado.
//
// Canales:
//   - In-app (tabla notificaciones + socket): siempre — es parte de la
//     plataforma. Se puede omitir con crearInApp:false cuando el caller
//     ya genero la notificacion in-app (ej. solicitudes).
//   - Correo electronico: SOLO si el usuario acepto los terminos en la
//     version vigente (consentimiento legal explicito). Si no acepto o
//     tiene una version vieja, el intento queda en email_log como
//     'omitido' — trazabilidad de por que no se notifico.
//
// WhatsApp y demas canales futuros enganchan aqui con la misma regla
// de consentimiento.

// Resuelve los usuarios cliente afectados por una entidad, con el correo
// de destino por usuario: se prefiere el correo registrado en la empresa
// (email + email_contacto) o en la persona (email) — el correo del usuario
// login queda como respaldo si la ficha no tiene.
async function usuariosDestino({ empresaId, personaId, userId }) {
  const users = []
  const destinosPorUser = {} // user_id -> [emails del registro empresa/persona]
  const agregar = (uid, correos) => {
    if (!uid) return
    users.push(uid)
    destinosPorUser[uid] = [
      ...new Set([...(destinosPorUser[uid] || []), ...correos.filter(Boolean)]),
    ]
  }
  if (empresaId) {
    const empresa = await db('empresas')
      .where('id', empresaId)
      .first('user_id', 'email', 'email_contacto')
    if (empresa?.user_id) {
      agregar(empresa.user_id, [empresa.email, empresa.email_contacto])
    }
  }
  if (personaId) {
    const persona = await db('personas')
      .where('id', personaId)
      .first('user_id', 'email')
    if (persona?.user_id) {
      agregar(persona.user_id, [persona.email])
    }
  }
  if (userId) agregar(userId, [])
  const ids = [...new Set(users)].filter(Boolean)
  if (!ids.length) return []
  const usuarios = await db('users')
    .whereIn('id', ids)
    .where('is_active', true)
    .select('id', 'name', 'email', 'terminos_aceptados_en', 'terminos_version')
  return usuarios.map(u => ({
    ...u,
    destinos: destinosPorUser[u.id]?.length ? destinosPorUser[u.id] : [u.email],
  }))
}

const aceptoVigente = (u) =>
  !!u.terminos_aceptados_en && u.terminos_version === TERMINOS_VERSION

const esAuditoria = (entidad) => ['auditoria', 'auditorias'].includes(String(entidad).toLowerCase())

function marcaAdmin() {
  const base = (process.env.PORTAL_URL || 'http://localhost:3873').replace(/\/$/, '')
  return {
    tipo: 'admin',
    nombre: 'Soy Asesorías',
    logoUrl: `${base}/images/logo/logo-blue.png`,
    color: '#075cf5',
  }
}

async function marcaCliente(userId) {
  if (userId) {
    const empresa = await db('empresas').where('user_id', userId)
      .first('razon_social', 'imagen')
    if (empresa) {
      return {
        tipo: 'cliente',
        nombre: empresa.razon_social || 'Empresa cliente',
        logoUrl: empresa.imagen || null,
        color: '#075cf5',
      }
    }
    const persona = await db('personas').where('user_id', userId)
      .first('primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido', 'imagen')
    if (persona) {
      return {
        tipo: 'cliente',
        nombre: [persona.primer_nombre, persona.segundo_nombre, persona.primer_apellido, persona.segundo_apellido]
          .filter(Boolean).join(' ') || 'Cliente independiente',
        logoUrl: persona.imagen || null,
        color: '#075cf5',
      }
    }
  }
  return { tipo: 'cliente', nombre: 'Cliente Soy Asesorías', logoUrl: null, color: '#075cf5' }
}

// Notifica un cambio de estado. Nunca lanza — los errores internos se
// registran pero no afectan el request del negocio.
export async function notificarCambioEstado({
  entidad,        // 'solicitud' | 'soporte' | 'diagnostico' | 'pago'
  entidadId,
  titulo,         // ej. "Solicitud #42"
  estadoAnterior,
  estadoNuevo,
  url,            // ruta del portal, ej. '/admin/solicitudes'
  empresaId = null,
  personaId = null,
  userId = null,  // para soportes (el dueño del ticket)
  detalle = null, // html extra del correo
  crearInApp = true,
}) {
  try {
    const usuarios = await usuariosDestino({ empresaId, personaId, userId })
    if (!usuarios.length) return

    const mensaje = `${titulo}: cambió de "${estadoAnterior}" a "${estadoNuevo}".`

    // In-app + push por socket (mismo canal que el resto del sistema)
    if (crearInApp) {
      const rows = await createNotifications(db, usuarios.map(u => u.id), {
        titulo: 'Cambio de estado',
        mensaje,
        tipo: entidad,
        url: url || null,
      })
      publishNotifications(rows)
    }

    // Las auditorias se conservan dentro del sistema, nunca por correo.
    if (esAuditoria(entidad)) return

    for (const u of usuarios) {
      // Correo: solo con consentimiento vigente
      if (!aceptoVigente(u)) {
        await db('email_log').insert({
          user_id: u.id,
          destinatario: u.destinos.join(','),
          entidad, entidad_id: entidadId,
          asunto: `Soy Asesorías — ${titulo}`,
          status: 'omitido',
          detalle: u.terminos_aceptados_en
            ? `sin re-aceptacion v${TERMINOS_VERSION} (tiene v${u.terminos_version})`
            : 'sin aceptacion de terminos',
        }).catch(() => {})
        continue
      }

      await enviarCorreo({
        to: u.destinos,
        userId: u.id,
        entidad, entidadId,
        subject: `Soy Asesorías — ${titulo}`,
        text: `${mensaje} Ingresa a la plataforma para más detalle.`,
        html: plantillaCorreo({
          titulo: 'Cambio de estado',
          mensaje,
          detalle: detalle || `<b>Estado anterior:</b> ${estadoAnterior}<br><b>Estado nuevo:</b> ${estadoNuevo}`,
          url,
          marca: marcaAdmin(),
        }),
      })
    }
  } catch (e) {
    console.error('[notificaciones] error:', e.message)
  }
}

// Notifica al/los usuarios cliente de una entidad con mensaje libre
// (ej. "te entregamos un documento corregido"). Misma regla que
// notificarCambioEstado: in-app siempre, correo solo con consentimiento.
export async function notificarCliente({
  entidad,
  entidadId = null,
  titulo,
  mensaje,
  url = null,
  empresaId = null,
  personaId = null,
  userId = null,
  detalle = null,
}) {
  try {
    const usuarios = await usuariosDestino({ empresaId, personaId, userId })
    if (!usuarios.length) return

    const rows = await createNotifications(db, usuarios.map(u => u.id), {
      titulo, mensaje, tipo: entidad, url,
    })
    publishNotifications(rows)

    if (esAuditoria(entidad)) return

    for (const u of usuarios) {
      if (!aceptoVigente(u)) {
        await db('email_log').insert({
          user_id: u.id,
          destinatario: u.destinos.join(','),
          entidad, entidad_id: entidadId,
          asunto: `Soy Asesorías — ${titulo}`,
          status: 'omitido',
          detalle: u.terminos_aceptados_en
            ? `sin re-aceptacion v${TERMINOS_VERSION} (tiene v${u.terminos_version})`
            : 'sin aceptacion de terminos',
        }).catch(() => {})
        continue
      }
      await enviarCorreo({
        to: u.destinos,
        userId: u.id,
        entidad, entidadId,
        subject: `Soy Asesorías — ${titulo}`,
        text: `${mensaje} Ingresa a la plataforma para más detalle.`,
        html: plantillaCorreo({ titulo, mensaje, detalle, url, marca: marcaAdmin() }),
      })
    }
  } catch (e) {
    console.error('[notificaciones] error cliente:', e.message)
  }
}

// Notifica al equipo interno (admins) por acciones del CLIENTE:
// nueva solicitud, nuevo ticket, respuesta, documento cargado, etc.
// El staff no requiere consentimiento — el correo va siempre.
// crearInApp:false cuando el caller ya genero la notificacion in-app.
export async function notificarAdmins({
  entidad,        // 'solicitud' | 'soporte' | 'diagnostico' | 'documento' | ...
  entidadId = null,
  titulo,         // ej. "Nueva solicitud recibida"
  mensaje,
  url = null,
  detalle = null, // html extra del correo
  crearInApp = true,
  excluir = [],   // ids de admin a excluir (ej. quien hizo la accion)
  userId = null,  // usuario cliente que origino la accion; resuelve empresa/persona
}) {
  try {
    const admins = await db('users')
      .where('role', 'admin')
      .where('is_active', true)
      .select('id', 'email')
    const destinos = admins.filter(a => !excluir.includes(a.id))
    if (!destinos.length) return

    if (crearInApp) {
      const rows = await createNotifications(db, destinos.map(a => a.id), {
        titulo, mensaje, tipo: entidad, url,
      })
      publishNotifications(rows)
    }

    // Las auditorias se conservan dentro del sistema, nunca por correo.
    if (esAuditoria(entidad)) return

    // Correo: si smtp_config.correos_admin tiene correos configurados van
    // a esas casillas (los emails de los usuarios admin suelen ser cuentas
    // de solo-sistema); si esta vacio va al email de cada admin.
    const cfg = await getSmtpConfig().catch(() => null)
    const configurados = (cfg?.correos_admin || '')
      .split(/[;,\s]+/)
      .map(s => s.trim())
      .filter(s => s.includes('@'))
    const correos = configurados.length
      ? configurados
      : destinos.map(a => a.email).filter(Boolean)
    const marca = await marcaCliente(userId)

    for (const correo of correos) {
      await enviarCorreo({
        to: correo,
        userId: configurados.length ? null : (destinos.find(a => a.email === correo)?.id ?? null),
        entidad, entidadId,
        subject: `Soy Asesorías — ${titulo}`,
        text: `${mensaje} Ingresa a la plataforma para gestionarlo.`,
        html: plantillaCorreo({ titulo, mensaje, detalle, url, marca }),
      })
    }
  } catch (e) {
    console.error('[notificaciones] error admins:', e.message)
  }
}

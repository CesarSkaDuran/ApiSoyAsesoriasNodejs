import db from '../db/knex.js'
import { consultarInformeSolicitudes } from '../services/informe-solicitudes.js'

const LIMITE_POR_MINUTO = 20
const VENTANAS_USUARIO = new Map()
const CONTEXTOS_VALIDOS = new Set([
  'general',
  'informes',
  'informe_solicitudes',
  'gestor_documental',
  'nominas',
  'solicitudes',
])

const CONTEXTOS = {
  general: 'El usuario pregunta sobre el uso general de SoyAsesorías.',
  informes: 'El usuario está trabajando en Informes. Explica filtros por fecha, ingresos, egresos, servicios y solicitudes por empresa o independiente. No inventes cifras; usa solo los datos agregados que se adjunten o que escriba el usuario.',
  informe_solicitudes: 'El usuario está consultando el informe agregado de solicitudes autorizado para su cuenta.',
  gestor_documental: 'El usuario está trabajando en Gestor Documental. El catálogo contiene categorías, modelos generales, solicitudes de elaboración y archivos entregados por documento.',
  nominas: 'El usuario está trabajando en Nóminas, Planillas o Normativa. Explica el uso de la aplicación, pero no presentes estimaciones legales o tributarias como asesoría profesional.',
  solicitudes: 'El usuario está trabajando en Solicitudes. Explica estados, seguimiento y entrega de documentos.',
}

const INSTRUCCIONES = `Eres el asistente de ayuda de SoyAsesorías, una aplicación de gestión empresarial colombiana.
Responde siempre en español claro y amable. Ayuda a navegar y entender módulos como Empresas, Empleados, Documentos, Nóminas, Planillas, Pagos, Solicitudes, Diagnósticos, Informes, Gestor Documental y el perfil de Asistente IA.
Puedes redactar borradores de comunicaciones, políticas, listas de verificación e informes para que el usuario los revise y edite.
No tienes acceso directo a la base de datos, archivos ni acciones de la aplicación. Si recibes un bloque de "Informe agregado autorizado", usa solamente esos conteos y filtros; no inventes ni infieras datos que no aparecen allí.
No afirmes que guardaste, enviaste o cambiaste algo. Para reportes distintos a los que se adjuntan como contexto, explica al usuario cómo consultarlos en Informes.
Los textos laborales, legales, contables y tributarios son borradores de apoyo; recomienda validarlos con un profesional antes de usarlos.
Cuando falte contexto, haz una pregunta breve.`

function rateLimit(userId) {
  const now = Date.now()
  const current = VENTANAS_USUARIO.get(userId)
  if (!current || now - current.start >= 60_000) {
    VENTANAS_USUARIO.set(userId, { start: now, count: 1 })
    return false
  }
  current.count += 1
  return current.count > LIMITE_POR_MINUTO
}

function validarMensajes(mensajes) {
  if (!Array.isArray(mensajes) || !mensajes.length || mensajes.length > 12) return null
  const normalizados = []
  let total = 0
  for (const item of mensajes) {
    if (!['user', 'assistant'].includes(item?.role) || typeof item?.content !== 'string') return null
    const content = item.content.trim()
    if (!content || content.length > 4000) return null
    total += content.length
    if (total > 16_000) return null
    normalizados.push({ role: item.role, content })
  }
  if (normalizados.at(-1)?.role !== 'user') return null
  return normalizados
}

export async function listSessions(req, res) {
  const data = await db('ia_chat_sesiones')
    .where('user_id', req.user.id)
    .select('id', 'titulo', 'contexto', 'created_at', 'updated_at')
    .orderBy('updated_at', 'desc')
    .limit(50)
  res.json({ data })
}

export async function createSession(req, res) {
  const contexto = CONTEXTOS_VALIDOS.has(req.body?.contexto) ? req.body.contexto : 'general'
  const [id] = await db('ia_chat_sesiones').insert({
    user_id: req.user.id,
    titulo: 'Nueva conversación',
    contexto,
  })
  res.status(201).json({
    sesion: await db('ia_chat_sesiones')
      .where({ id, user_id: req.user.id })
      .select('id', 'titulo', 'contexto', 'created_at', 'updated_at')
      .first(),
  })
}

export async function showSession(req, res) {
  const sesion = await db('ia_chat_sesiones')
    .where({ id: req.params.id, user_id: req.user.id })
    .select('id', 'titulo', 'contexto', 'created_at', 'updated_at')
    .first()
  if (!sesion) return res.status(404).json({ error: 'Conversación no encontrada' })
  const mensajes = await db('ia_chat_mensajes')
    .where('sesion_id', sesion.id)
    .orderBy('id', 'desc')
    .limit(100)
  res.json({ sesion, mensajes: mensajes.reverse() })
}

export async function deleteSession(req, res) {
  const sesion = await db('ia_chat_sesiones')
    .where({ id: req.params.id, user_id: req.user.id })
    .first('id')
  if (!sesion) return res.status(404).json({ error: 'Conversación no encontrada' })
  await db.transaction(async trx => {
    await trx('ia_chat_mensajes').where('sesion_id', sesion.id).delete()
    await trx('ia_chat_sesiones').where({ id: sesion.id, user_id: req.user.id }).delete()
  })
  res.json({ ok: true })
}

function fechaIsoBogota(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function rangoDesdePregunta(text) {
  const value = text.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const today = fechaIsoBogota(new Date())
  const [year, month, day] = today.split('-').map(Number)
  if (/\bmes pasado\b|\bmes anterior\b/.test(value)) {
    const firstPrevious = new Date(Date.UTC(year, month - 2, 1))
    const lastPrevious = new Date(Date.UTC(year, month - 1, 0))
    return { desde: fechaIsoBogota(firstPrevious), hasta: fechaIsoBogota(lastPrevious), periodo: 'mes pasado' }
  }
  if (/\besta semana\b|\bsemana actual\b/.test(value)) {
    const current = new Date(Date.UTC(year, month - 1, day))
    const weekday = current.getUTCDay() || 7
    current.setUTCDate(current.getUTCDate() - weekday + 1)
    return { desde: fechaIsoBogota(current), hasta: today, periodo: 'esta semana' }
  }
  if (/\beste ano\b|\banual\b/.test(value)) {
    return { desde: `${year}-01-01`, hasta: today, periodo: 'este año' }
  }
  const dates = [...value.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(match => match[1])
  if (dates.length >= 2) {
    return { desde: dates[0], hasta: dates[1], periodo: `${dates[0]} a ${dates[1]}` }
  }
  return {
    desde: `${year}-${String(month).padStart(2, '0')}-01`,
    hasta: today,
    periodo: 'mes actual hasta hoy',
  }
}

function solicitudClienteDesdePregunta(text) {
  const value = text.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const pideEmpresa = /\bempresa(s)?\b/.test(value)
  const pideIndependiente = /\bindependiente(s)?\b/.test(value)
  if (pideEmpresa && !pideIndependiente) return 'empresa'
  if (pideIndependiente && !pideEmpresa) return 'independiente'
  return 'todos'
}

function solicitaInformeSolicitudes(text, contexto) {
  if (contexto === 'informe_solicitudes') return true
  const value = text.toLocaleLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return /\bsolicitud(es)?\b/.test(value)
    && /\b(informe|reporte|resumen|genera(r)?|cuanta(s)?|cuanto(s)?|analiza(r)?|estadistica(s)?)\b/.test(value)
}

async function contextoInformeAutorizado(req, messages, contexto) {
  const userMessage = messages.at(-1)?.content || ''
  const promptInforme = [...messages]
    .reverse()
    .find(message => message.role === 'user' && solicitaInformeSolicitudes(message.content, ''))
  if (contexto !== 'informes' && !promptInforme) return ''

  const permitted = req.user.role === 'admin' || !!req.user.modulos?.informes
  if (!permitted) {
    return 'El usuario pidió un informe de solicitudes, pero no tiene asignado el módulo Informes. Indícale que el administrador debe habilitar ese permiso. No inventes cifras.'
  }

  const promptFiltros = promptInforme?.content || userMessage
  const range = rangoDesdePregunta(promptFiltros)
  const tipoCliente = solicitudClienteDesdePregunta(promptFiltros)
  const scope = { desde: range.desde, hasta: range.hasta, tipoCliente }
  if (req.user.role === 'empresa') {
    if (!req.user.empresa_id) return 'No se pudo resolver la empresa autenticada; no se consultó ningún dato. Indícale que contacte al administrador.'
    scope.tipoCliente = 'empresa'
    scope.empresaId = req.user.empresa_id
  } else if (req.user.role === 'independiente') {
    if (!req.user.persona_id) return 'No se pudo resolver el independiente autenticado; no se consultó ningún dato. Indícale que contacte al administrador.'
    scope.tipoCliente = 'independiente'
    scope.personaId = req.user.persona_id
  }

  const report = await consultarInformeSolicitudes({ ...scope, incluirClientes: false })
  const snapshot = {
    periodo: range.periodo,
    desde: range.desde,
    hasta: range.hasta,
    tipo_cliente: scope.tipoCliente,
    resumen: report.resumen,
    por_estado: report.por_estado.map(row => ({
      estado: row.grupo,
      solicitudes: Number(row.registros) || 0,
    })),
    por_tipo: report.por_tipo.map(row => ({
      tipo: row.grupo,
      solicitudes: Number(row.registros) || 0,
    })),
    por_dia: report.por_dia.slice(-31).map(row => ({
      fecha: row.grupo,
      solicitudes: Number(row.registros) || 0,
    })),
  }
  return `Informe agregado autorizado (solo conteos; sin nombres, documentos ni contenido): ${JSON.stringify(snapshot)}. Presenta el rango y los filtros, resume estados y tipos, y no inventes datos.`
}

export async function chat(req, res) {
  const provider = String(
    process.env.AI_PROVIDER
      || (process.env.AI_GEMINI_API_KEY
        || process.env.AI_API_BASE_URL?.includes('generativelanguage.googleapis.com')
        ? 'gemini'
        : 'openai')
  ).toLowerCase()
  if (!['gemini', 'openai'].includes(provider)) {
    return res.status(503).json({ error: 'AI_PROVIDER debe ser gemini u openai.', code: 'IA_PROVEEDOR_INVALIDO' })
  }
  const apiKey = provider === 'gemini'
    ? (process.env.AI_GEMINI_API_KEY || process.env.AI_API_KEY)
    : process.env.AI_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'El asistente IA todavía no está configurado. Contacta al administrador.',
      code: 'IA_NO_CONFIGURADA',
    })
  }

  let session = null
  let newUserMessage = null
  let messages
  if (req.body?.session_id !== undefined) {
    const sessionId = Number(req.body.session_id)
    newUserMessage = typeof req.body.message === 'string' ? req.body.message.trim() : ''
    if (!Number.isInteger(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: 'session_id no es válido' })
    }
    if (!newUserMessage || newUserMessage.length > 4000) {
      return res.status(400).json({ error: 'El mensaje es obligatorio y debe tener máximo 4.000 caracteres' })
    }
    session = await db('ia_chat_sesiones')
      .where({ id: sessionId, user_id: req.user.id })
      .first()
    if (!session) return res.status(404).json({ error: 'Conversación no encontrada' })
    const history = await db('ia_chat_mensajes')
      .where('sesion_id', session.id)
      .orderBy('id', 'desc')
      .limit(11)
    messages = [
      ...history.reverse().map(item => ({ role: item.rol, content: item.contenido })),
      { role: 'user', content: newUserMessage },
    ]
  } else {
    messages = validarMensajes(req.body?.messages)
    if (!messages) {
      return res.status(400).json({
        error: 'Envía entre 1 y 12 mensajes válidos; cada mensaje debe tener máximo 4.000 caracteres.',
      })
    }
  }
  if (rateLimit(req.user.id)) {
    return res.status(429).json({ error: 'Llegaste al límite de consultas. Espera un minuto y vuelve a intentar.' })
  }

  const contexto = CONTEXTOS[session?.contexto || req.body?.contexto] || CONTEXTOS.general
  let contextoInforme = ''
  try {
    contextoInforme = await contextoInformeAutorizado(req, messages, session?.contexto || req.body?.contexto)
  } catch (error) {
    console.error('Error consultando el informe autorizado para IA:', error?.message || error)
    return res.status(500).json({ error: 'No se pudo preparar el informe solicitado.' })
  }
  const geminiBase = process.env.AI_GEMINI_BASE_URL
    || (process.env.AI_API_BASE_URL?.includes('generativelanguage.googleapis.com')
      ? process.env.AI_API_BASE_URL
      : 'https://generativelanguage.googleapis.com/v1beta/openai')
  const baseUrl = (
    provider === 'gemini'
      ? geminiBase
      : process.env.AI_API_BASE_URL || 'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
  const model = process.env.AI_MODEL || (provider === 'gemini' ? 'gemini-3.6-flash' : 'gpt-4o-mini')

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${INSTRUCCIONES}\n\nContexto actual: ${contexto}${contextoInforme ? `\n\n${contextoInforme}` : ''}`,
          },
          ...messages,
        ],
        temperature: 0.35,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      const providerBody = await response.json().catch(() => ({}))
      const providerError = providerBody?.error || {}
      const providerCode = providerError.status || providerError.code || null
      const providerMessage = typeof providerError.message === 'string'
        ? providerError.message.replaceAll(apiKey, '[redacted]').slice(0, 400)
        : null
      console.error(
        `Proveedor IA (${provider}) respondió HTTP ${response.status}; modelo=${model}; ` +
        `código=${providerCode || 'sin código'}; detalle=${providerMessage || 'sin detalle'}`,
      )
      const detail = response.status === 404
        ? `${provider === 'gemini' ? 'Gemini' : 'El proveedor IA'} respondió 404. Revisa la URL y que AI_MODEL exista y esté habilitado en tu proyecto.`
        : [401, 403].includes(response.status)
          ? `${provider === 'gemini' ? 'Gemini' : 'El proveedor IA'} rechazó la clave o esta no tiene acceso al modelo configurado.`
          : response.status === 429
            ? `Se alcanzó el límite o la cuota del proveedor ${provider}.`
            : 'No se pudo obtener respuesta del proveedor IA. Revisa la configuración e intenta de nuevo.'
      return res.status(502).json({
        error: detail,
        provider_status: response.status,
        ...(providerCode ? { provider_code: providerCode } : {}),
        ...(providerMessage ? { provider_message: providerMessage } : {}),
      })
    }
    const payload = await response.json()
    const answer = payload?.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(502).json({ error: 'El asistente devolvió una respuesta vacía. Intenta de nuevo.' })
    }
    let titulo = null
    if (session) {
      titulo = session.titulo
      if (titulo === 'Nueva conversación') {
        const flat = newUserMessage.replace(/\s+/g, ' ').trim()
        titulo = flat.length > 77 ? `${flat.slice(0, 77)}...` : flat
      }
      await db.transaction(async trx => {
        await trx('ia_chat_mensajes').insert([
          { sesion_id: session.id, rol: 'user', contenido: newUserMessage },
          { sesion_id: session.id, rol: 'assistant', contenido: answer.trim() },
        ])
        await trx('ia_chat_sesiones').where({ id: session.id, user_id: req.user.id }).update({
          titulo,
          updated_at: trx.fn.now(),
        })
      })
    }
    res.json({
      respuesta: answer.trim(),
      modelo: model,
      ...(session ? { session_id: session.id, titulo } : {}),
    })
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    if (!timeout) console.error('Error conectando con el proveedor IA:', error?.message || error)
    res.status(timeout ? 504 : 502).json({
      error: timeout ? 'El asistente tardó demasiado en responder. Intenta de nuevo.' : 'No se pudo conectar con el asistente.',
    })
  }
}

import db from '../db/knex.js'
import { createReadStream, existsSync } from 'fs'
import { resolve } from 'path'
import { notificarAdmins, notificarCambioEstado } from '../services/notificaciones.js'

// ════════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICOS — entrevista + documentos requeridos + informe
// Replica producto_* del sistema anterior. Admin: acceso total.
// empresa/independiente: solo sus propios diagnósticos.
// ════════════════════════════════════════════════════════════════════════════

const ESTADOS = ['pendiente', 'en_progreso', 'logrado', 'cancelado']
const DOC_ESTADOS = ['pendiente', 'revisar', 'aprobado', 'rechazado', 'renovar']
const TIPOS_RESPUESTA = ['texto', 'textarea', 'numero', 'fecha', 'opciones', 'multiple', 'booleano', 'cumplimiento']

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

function puedeVer(user, d) {
  if (user.role === 'admin') return true
  if (user.role === 'empresa') return d.empresa_id && d.empresa_id === user.empresa_id
  if (user.role === 'independiente') return d.persona_id && d.persona_id === user.persona_id
  return false
}

async function findDiagnostico(req, res) {
  const d = await db('diagnosticos').where('id', req.params.id).first()
  if (!d) {
    res.status(404).json({ message: 'Diagnóstico no encontrado' })
    return null
  }
  if (!puedeVer(req.user, d)) {
    res.status(403).json({ message: 'Sin acceso a este diagnóstico' })
    return null
  }
  return d
}

// GET /diagnosticos — lista + stats + filtros
export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const perPage = 25

  let q = db('diagnosticos as d')
    .leftJoin('empresas as e', 'e.id', 'd.empresa_id')
    .leftJoin('personas as p', 'p.id', 'd.persona_id')
    .leftJoin('users as u', 'u.id', 'd.responsable_id')
    .select(
      'd.*',
      'e.razon_social as empresa_nombre',
      db.raw("CONCAT_WS(' ', p.primer_nombre, p.primer_apellido) as persona_nombre"),
      'u.name as responsable_nombre'
    )

  // Aislamiento por tenant
  if (req.user.role === 'empresa') {
    q.where('d.empresa_id', req.user.empresa_id || -1)
  } else if (req.user.role === 'independiente') {
    q.where('d.persona_id', req.user.persona_id || -1)
  }

  const { empresa_id, responsable_id, estado, desde, hasta, search } = req.query
  if (empresa_id) q.where('d.empresa_id', empresa_id)
  if (responsable_id) q.where('d.responsable_id', responsable_id)
  if (estado && ESTADOS.includes(estado)) q.where('d.estado', estado)
  if (desde) q.where('d.fecha_inicio', '>=', desde)
  if (hasta) q.where('d.fecha_inicio', '<=', hasta)
  if (search) {
    q.where(b =>
      b.where('d.nombre', 'like', `%${search}%`)
        .orWhere('e.razon_social', 'like', `%${search}%`)
        .orWhereRaw("CONCAT_WS(' ', p.primer_nombre, p.primer_apellido) like ?", [`%${search}%`])
    )
  }

  const [{ total }] = await q.clone().clearSelect().clearOrder().count('* as total')
  const rows = await q.orderBy('d.created_at', 'desc').limit(perPage).offset((page - 1) * perPage)

  // Stats (mismo alcance, sin filtros de página)
  const baseStats = db('diagnosticos as d')
    .modify(b => {
      if (req.user.role === 'empresa') b.where('d.empresa_id', req.user.empresa_id || -1)
      else if (req.user.role === 'independiente') b.where('d.persona_id', req.user.persona_id || -1)
    })
  const [{ en_progreso }] = await baseStats.clone().where('estado', 'en_progreso').count('* as en_progreso')
  const [{ logrados }] = await baseStats.clone().where('estado', 'logrado').count('* as logrados')
  const [{ totalTodos }] = await baseStats.clone().count('* as totalTodos')
  const porEstado = await baseStats.clone().select('estado').count('* as total').groupBy('estado')

  res.json({
    data: rows,
    total: Number(total),
    page,
    per_page: perPage,
    stats: {
      total: Number(totalTodos),
      en_progreso: Number(en_progreso),
      logrados: Number(logrados),
      por_estado: porEstado.map(r => ({ estado: r.estado, total: Number(r.total) })),
    },
  })
}

// GET /diagnosticos/:id — detalle con métricas de avance
export async function show(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return

  const [empresa, persona, responsable] = await Promise.all([
    d.empresa_id ? db('empresas').where('id', d.empresa_id).first() : null,
    d.persona_id ? db('personas').where('id', d.persona_id).first() : null,
    d.responsable_id ? db('users').select('id', 'name', 'lastname', 'email').where('id', d.responsable_id).first() : null,
  ])

  // Métricas: preguntas respondidas + docs obligatorios cargados
  const [{ preguntas_total }] = await db('diagnostico_preguntas').where('activo', true).count('* as preguntas_total')
  const [{ respondidas }] = await db('diagnostico_respuestas')
    .where('diagnostico_id', d.id)
    .whereNotNull('valor').where('valor', '!=', '')
    .count('* as respondidas')

  const [{ docs_obligatorios }] = await db('diagnostico_doc_config')
    .where('activo', true).where('es_obligatorio', true).count('* as docs_obligatorios')
  const [{ docs_total }] = await db('diagnostico_doc_config').where('activo', true).count('* as docs_total')
  const [{ docs_cargados }] = await db('diagnostico_documentos')
    .where('diagnostico_id', d.id).whereNotNull('ruta_archivo')
    .count('* as docs_cargados')

  res.json({
    ...d,
    empresa_nombre: empresa?.razon_social || null,
    empresa_nit: empresa?.nit || null,
    persona_nombre: persona ? [persona.primer_nombre, persona.primer_apellido].filter(Boolean).join(' ') : null,
    responsable_nombre: responsable ? [responsable.name, responsable.lastname].filter(Boolean).join(' ') : null,
    metricas: {
      preguntas_total: Number(preguntas_total),
      respondidas: Number(respondidas),
      preguntas_pct: Number(preguntas_total) ? Math.round((Number(respondidas) / Number(preguntas_total)) * 100) : 0,
      docs_obligatorios: Number(docs_obligatorios),
      docs_total: Number(docs_total),
      docs_cargados: Number(docs_cargados),
      docs_pct: Number(docs_total) ? Math.round((Number(docs_cargados) / Number(docs_total)) * 100) : 0,
    },
  })
}

const CAMPOS = ['nombre', 'empresa_id', 'persona_id', 'responsable_id', 'fecha_inicio', 'fecha_fin', 'estado']

// POST /diagnosticos
export async function create(req, res) {
  const data = {}
  for (const k of CAMPOS) if (req.body[k] !== undefined) data[k] = req.body[k] === '' ? null : req.body[k]
  if (!data.nombre) return res.status(400).json({ message: 'El nombre es obligatorio' })
  if (!data.empresa_id && !data.persona_id) return res.status(400).json({ message: 'Debe asociar una empresa o un independiente' })
  if (!data.fecha_inicio || !data.fecha_fin) return res.status(400).json({ message: 'Las fechas son obligatorias' })
  if (!ESTADOS.includes(data.estado)) data.estado = 'pendiente'

  const [id] = await db('diagnosticos').insert(data)
  res.status(201).json(await db('diagnosticos').where('id', id).first())
}

// PUT /diagnosticos/:id
export async function update(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  const data = {}
  for (const k of CAMPOS) if (req.body[k] !== undefined) data[k] = req.body[k] === '' ? null : req.body[k]
  if (data.estado && !ESTADOS.includes(data.estado)) delete data.estado
  await db('diagnosticos').where('id', d.id).update(data)
  res.json(await db('diagnosticos').where('id', d.id).first())

  if (data.estado && data.estado !== d.estado) {
    notificarCambioEstado({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: `Diagnóstico "${d.nombre}"`,
      estadoAnterior: d.estado, estadoNuevo: data.estado,
      url: '/admin/diagnosticos',
      empresaId: d.empresa_id, personaId: d.persona_id,
    })
  }
}

// PUT /diagnosticos/:id/estado — cambio rápido desde el menú
export async function updateEstado(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  const estado = req.body.estado
  if (!ESTADOS.includes(estado)) return res.status(400).json({ message: 'Estado no válido' })
  await db('diagnosticos').where('id', d.id).update({ estado })
  res.json({ ok: true })

  if (estado !== d.estado) {
    notificarCambioEstado({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: `Diagnóstico "${d.nombre}"`,
      estadoAnterior: d.estado, estadoNuevo: estado,
      url: '/admin/diagnosticos',
      empresaId: d.empresa_id, personaId: d.persona_id,
    })
  }
}

// DELETE /diagnosticos/:id
export async function remove(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  await db('diagnosticos').where('id', d.id).del()
  res.json({ ok: true })
}

// ════════════════════════════════════════════════════════════════════════════
// ENTREVISTA
// ════════════════════════════════════════════════════════════════════════════

// GET /diagnosticos/:id/entrevista — preguntas activas con respuestas
export async function entrevista(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return

  const preguntas = await db('diagnostico_preguntas').where('activo', true).orderBy('orden')
  const respuestas = await db('diagnostico_respuestas').where('diagnostico_id', d.id)
  const map = Object.fromEntries(respuestas.map(r => [r.pregunta_id, r]))

  res.json({
    preguntas: preguntas.map(p => ({
      ...p,
      opciones: p.opciones ? JSON.parse(p.opciones) : null,
      respuesta: map[p.id]?.valor ?? null,
      respuesta_json: map[p.id]?.valor_json ? JSON.parse(map[p.id].valor_json) : null,
    })),
  })
}

// PUT /diagnosticos/:id/respuestas — guardar respuestas { pregunta_id: valor }
export async function saveRespuestas(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return

  const respuestas = req.body.respuestas || {}
  const preguntas = await db('diagnostico_preguntas').where('activo', true)
  const validIds = new Set(preguntas.map(p => p.id))

  await db.transaction(async trx => {
    for (const [pid, valor] of Object.entries(respuestas)) {
      const preguntaId = Number(pid)
      if (!validIds.has(preguntaId)) continue
      const esJson = typeof valor !== 'string'
      await trx('diagnostico_respuestas')
        .insert({
          diagnostico_id: d.id,
          pregunta_id: preguntaId,
          valor: esJson ? null : String(valor ?? ''),
          valor_json: esJson ? JSON.stringify(valor) : null,
        })
        .onConflict(['diagnostico_id', 'pregunta_id'])
        .merge()
    }
  })

  res.json({ ok: true })

  // Cliente diligencia la entrevista -> avisar a los admins
  if (req.user.role !== 'admin') {
    notificarAdmins({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: 'Respuestas de diagnóstico recibidas',
      mensaje: `Diagnóstico #${d.id}: el cliente guardó ${Object.keys(respuestas).length} respuesta(s) — ${req.user.email}`,
      url: '/admin/diagnosticos',
      userId: req.user.id,
    })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENTOS REQUERIDOS
// ════════════════════════════════════════════════════════════════════════════

// GET /diagnosticos/:id/documentos — config + estado de cada documento
export async function documentos(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return

  const configs = await db('diagnostico_doc_config').where('activo', true).orderBy('orden')
  const docs = await db('diagnostico_documentos as doc')
    .leftJoin('users as u', 'u.id', 'doc.revisado_por')
    .where('doc.diagnostico_id', d.id)
    .select('doc.*', 'u.name as revisado_por_nombre')
  const map = Object.fromEntries(docs.map(x => [x.doc_config_id, x]))

  res.json({
    documentos: configs.map(c => ({
      config: c,
      documento: map[c.id] || null,
    })),
  })
}

// POST /diagnosticos/:id/documentos/:configId — subir archivo
export async function uploadDocumento(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (!req.file) return res.status(400).json({ message: 'Archivo requerido' })

  const config = await db('diagnostico_doc_config').where('id', req.params.configId).where('activo', true).first()
  if (!config) return res.status(404).json({ message: 'Documento no configurado' })

  // Validar extensión contra la config
  if (config.tipo_archivo) {
    const ext = req.file.originalname.split('.').pop().toLowerCase()
    const permitidos = config.tipo_archivo.split(',').map(s => s.trim().toLowerCase())
    if (!permitidos.includes(ext)) {
      return res.status(422).json({ message: `Formato no permitido. Usa: ${config.tipo_archivo}` })
    }
  }

  const payload = {
    diagnostico_id: d.id,
    doc_config_id: config.id,
    ruta_archivo: req.file.filename,
    nombre_original: req.file.originalname,
    mime_type: req.file.mimetype,
    tamano_bytes: req.file.size,
    // Al subir, el cliente lo deja "en revisión"; el staff lo aprueba/rechaza
    estado: req.user.role === 'admin' ? (req.body.estado || 'revisar') : 'revisar',
    comentarios_revision: req.body.comentarios || null,
  }
  if (req.user.role === 'admin' && DOC_ESTADOS.includes(req.body.estado)) {
    payload.fecha_revision = db.fn.now()
    payload.revisado_por = req.user.id
  }

  await db('diagnostico_documentos')
    .insert(payload)
    .onConflict(['diagnostico_id', 'doc_config_id'])
    .merge()

  res.status(201).json({ ok: true })

  // Cliente sube documento requerido -> avisar a los admins
  if (req.user.role !== 'admin') {
    notificarAdmins({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: 'Documento de diagnóstico cargado',
      mensaje: `Diagnóstico #${d.id}: el cliente subió "${req.file.originalname}" (${config.nombre}) — ${req.user.email}`,
      url: '/admin/diagnosticos',
      userId: req.user.id,
    })
  }
}

// PUT /diagnosticos/documentos/:docId — revisión del staff (estado + comentarios)
export async function revisarDocumento(req, res) {
  const doc = await db('diagnostico_documentos').where('id', req.params.docId).first()
  if (!doc) return res.status(404).json({ message: 'Documento no encontrado' })
  const d = await db('diagnosticos').where('id', doc.diagnostico_id).first()
  if (!puedeVer(req.user, d)) return res.status(403).json({ message: 'Sin acceso' })

  const estado = req.body.estado
  if (estado && !DOC_ESTADOS.includes(estado)) return res.status(400).json({ message: 'Estado no válido' })

  await db('diagnostico_documentos').where('id', doc.id).update({
    estado: estado || doc.estado,
    comentarios_revision: req.body.comentarios !== undefined ? req.body.comentarios : doc.comentarios_revision,
    fecha_revision: db.fn.now(),
    revisado_por: req.user.id,
  })
  res.json({ ok: true })
}

// GET /diagnosticos/documentos/:docId/download
export async function downloadDocumento(req, res) {
  const doc = await db('diagnostico_documentos').where('id', req.params.docId).first()
  if (!doc) return res.status(404).json({ message: 'Documento no encontrado' })
  const d = await db('diagnosticos').where('id', doc.diagnostico_id).first()
  if (!puedeVer(req.user, d)) return res.status(403).json({ message: 'Sin acceso' })

  const filePath = resolve(STORAGE_DIR, doc.ruta_archivo)
  if (!doc.ruta_archivo || !existsSync(filePath)) {
    return res.status(404).json({ message: 'Archivo no disponible' })
  }
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nombre_original || 'documento')}"`)
  createReadStream(filePath).pipe(res)
}

// ════════════════════════════════════════════════════════════════════════════
// INFORME
// ════════════════════════════════════════════════════════════════════════════

export async function getInforme(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  const informe = await db('diagnostico_informes').where('diagnostico_id', d.id).first()
  res.json({ contenido_html: informe?.contenido_html || '' })
}

export async function saveInforme(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  await db('diagnostico_informes')
    .insert({ diagnostico_id: d.id, contenido_html: req.body.contenido_html || '' })
    .onConflict('diagnostico_id')
    .merge()
  res.json({ ok: true })
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN (admin): preguntas y documentos requeridos
// ════════════════════════════════════════════════════════════════════════════

export async function listPreguntas(req, res) {
  const rows = await db('diagnostico_preguntas').orderBy('orden')
  res.json({ data: rows.map(p => ({ ...p, opciones: p.opciones ? JSON.parse(p.opciones) : null })) })
}

export async function createPregunta(req, res) {
  const { titulo, slug, descripcion, tipo_respuesta, opciones, es_obligatoria, ayuda_contextual, orden, activo } = req.body
  if (!titulo || !TIPOS_RESPUESTA.includes(tipo_respuesta)) {
    return res.status(400).json({ message: 'Título y tipo de respuesta válidos son obligatorios' })
  }
  const [id] = await db('diagnostico_preguntas').insert({
    slug: slug || titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-').slice(0, 100),
    titulo, descripcion: descripcion || null, tipo_respuesta,
    opciones: opciones ? JSON.stringify(opciones) : null,
    es_obligatoria: !!es_obligatoria,
    ayuda_contextual: ayuda_contextual || null,
    orden: Number(orden) || 99, activo: activo !== undefined ? !!activo : true,
  })
  res.status(201).json({ id })
}

export async function updatePregunta(req, res) {
  const p = await db('diagnostico_preguntas').where('id', req.params.id).first()
  if (!p) return res.status(404).json({ message: 'Pregunta no encontrada' })
  const { titulo, descripcion, tipo_respuesta, opciones, es_obligatoria, ayuda_contextual, orden, activo } = req.body
  await db('diagnostico_preguntas').where('id', p.id).update({
    titulo: titulo ?? p.titulo,
    descripcion: descripcion !== undefined ? descripcion : p.descripcion,
    tipo_respuesta: TIPOS_RESPUESTA.includes(tipo_respuesta) ? tipo_respuesta : p.tipo_respuesta,
    opciones: opciones !== undefined ? JSON.stringify(opciones) : p.opciones,
    es_obligatoria: es_obligatoria !== undefined ? !!es_obligatoria : p.es_obligatoria,
    ayuda_contextual: ayuda_contextual !== undefined ? ayuda_contextual : p.ayuda_contextual,
    orden: orden !== undefined ? Number(orden) : p.orden,
    activo: activo !== undefined ? !!activo : p.activo,
  })
  res.json({ ok: true })
}

export async function deletePregunta(req, res) {
  await db('diagnostico_preguntas').where('id', req.params.id).del()
  res.json({ ok: true })
}

export async function listDocConfigs(req, res) {
  res.json({ data: await db('diagnostico_doc_config').orderBy('orden') })
}

export async function createDocConfig(req, res) {
  const { titulo, slug, descripcion, es_obligatorio, tipo_archivo, maximo_archivos, orden, activo } = req.body
  if (!titulo) return res.status(400).json({ message: 'El título es obligatorio' })
  const [id] = await db('diagnostico_doc_config').insert({
    slug: slug || titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-').slice(0, 100),
    titulo, descripcion: descripcion || null,
    es_obligatorio: !!es_obligatorio,
    tipo_archivo: tipo_archivo || null,
    maximo_archivos: maximo_archivos ? Number(maximo_archivos) : null,
    orden: Number(orden) || 99, activo: activo !== undefined ? !!activo : true,
  })
  res.status(201).json({ id })
}

export async function updateDocConfig(req, res) {
  const c = await db('diagnostico_doc_config').where('id', req.params.id).first()
  if (!c) return res.status(404).json({ message: 'Configuración no encontrada' })
  const { titulo, descripcion, es_obligatorio, tipo_archivo, maximo_archivos, orden, activo } = req.body
  await db('diagnostico_doc_config').where('id', c.id).update({
    titulo: titulo ?? c.titulo,
    descripcion: descripcion !== undefined ? descripcion : c.descripcion,
    es_obligatorio: es_obligatorio !== undefined ? !!es_obligatorio : c.es_obligatorio,
    tipo_archivo: tipo_archivo !== undefined ? tipo_archivo : c.tipo_archivo,
    maximo_archivos: maximo_archivos !== undefined ? (maximo_archivos ? Number(maximo_archivos) : null) : c.maximo_archivos,
    orden: orden !== undefined ? Number(orden) : c.orden,
    activo: activo !== undefined ? !!activo : c.activo,
  })
  res.json({ ok: true })
}

export async function deleteDocConfig(req, res) {
  const [{ n }] = await db('diagnostico_documentos').where('doc_config_id', req.params.id).count('id as n')
  if (Number(n) > 0) {
    return res.status(409).json({ message: `No se puede eliminar: ${n} documentos cargados usan esta configuración. Desactívala.` })
  }
  await db('diagnostico_doc_config').where('id', req.params.id).del()
  res.json({ ok: true })
}

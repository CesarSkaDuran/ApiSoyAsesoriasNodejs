import db from '../db/knex.js'
import { esStaff } from '../middlewares/auth.js'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { resolve } from 'path'
import { notificarAdmins, notificarCambioEstado, notificarCliente } from '../services/notificaciones.js'

// ════════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICOS — entrevista + documentos requeridos + informe
// Replica producto_* del sistema anterior. Admin: acceso total.
// empresa/independiente: solo sus propios diagnósticos.
// ════════════════════════════════════════════════════════════════════════════

const ESTADOS = ['pendiente', 'en_progreso', 'logrado', 'suspendido', 'cancelado']
// Fallback si la tabla de estados aún no se ha migrado
const DOC_ESTADOS = ['pendiente', 'revisar', 'aprobado', 'rechazado', 'renovar']

async function docEstadosActivos() {
  try {
    const rows = await db('diagnostico_doc_estados').where('activo', true).orderBy('orden')
    return rows.length ? rows : DOC_ESTADOS.map(v => ({ value: v, requiere_comentario: 0 }))
  } catch {
    return DOC_ESTADOS.map(v => ({ value: v, requiere_comentario: 0 }))
  }
}
const TIPOS_RESPUESTA = ['texto', 'textarea', 'numero', 'fecha', 'opciones', 'multiple', 'booleano', 'cumplimiento']

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

function puedeVer(user, d) {
  if (esStaff(user)) return true
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
    .countDistinct('doc_config_id as docs_cargados')

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

// DELETE /diagnosticos/:id — no se eliminan diagnósticos: se suspenden
// para conservar el registro histórico (entrevista, documentos, informe).
export async function remove(req, res) {
  res.status(400).json({ message: 'Los diagnósticos no se eliminan. Suspende el diagnóstico para conservar el registro.' })
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
      comentario: map[p.id]?.comentario ?? null,
    })),
  })
}

// PUT /diagnosticos/:id/respuestas — guardar respuestas { pregunta_id: valor }
export async function saveRespuestas(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return

  const respuestas = req.body.respuestas || {}
  const comentarios = req.body.comentarios || {}
  const preguntas = await db('diagnostico_preguntas').where('activo', true)
  const validIds = new Set(preguntas.map(p => p.id))

  const tareasCliente = []
  await db.transaction(async trx => {
    // Respuesta y comentario se guardan por separado: enviar solo uno no borra el otro
    const ids = new Set([...Object.keys(respuestas), ...Object.keys(comentarios)].map(Number))
    for (const preguntaId of ids) {
      if (!validIds.has(preguntaId)) continue
      const cambios = {}
      if (Object.prototype.hasOwnProperty.call(respuestas, preguntaId)) {
        const valor = respuestas[preguntaId]
        const esJson = typeof valor !== 'string'
        cambios.valor = esJson ? null : String(valor ?? '')
        cambios.valor_json = esJson ? JSON.stringify(valor) : null
      }
      if (Object.prototype.hasOwnProperty.call(comentarios, preguntaId)) {
        cambios.comentario = String(comentarios[preguntaId] ?? '').trim() || null
      }
      if (!Object.keys(cambios).length) continue
      await trx('diagnostico_respuestas')
        .insert({ diagnostico_id: d.id, pregunta_id: preguntaId, ...cambios })
        .onConflict(['diagnostico_id', 'pregunta_id'])
        .merge(Object.keys(cambios))
    }

    // Preguntas enlazadas: si el padre no coincide con mostrar_si, la hija
    // queda oculta y se borra su respuesta para no dejar datos huérfanos
    const actuales = await trx('diagnostico_respuestas').where('diagnostico_id', d.id)
    const mapa = Object.fromEntries(actuales.map(r => [r.pregunta_id, r]))
    for (const h of preguntas.filter(x => x.pregunta_padre_id)) {
      const padre = mapa[h.pregunta_padre_id]
      if (!padre || !coincideRespuesta(padre, h.mostrar_si)) {
        await trx('diagnostico_respuestas').where({ diagnostico_id: d.id, pregunta_id: h.id }).del()
      }
    }

    // Pregunta con documento asociado -> tarea pendiente con el nombre del
    // documento. "Sí" (cumple) la asigna al cliente, que debe entregarla;
    // "No" (no cumple) la asigna al equipo, que debe prepararla. Solo se
    // tocan las pendientes: los archivos ya entregados no cambian.
    for (const p of preguntas.filter(x => x.documento_nombre && ![undefined, null, ''].includes(respuestas[x.id]))) {
      const asignado = asignadoDeRespuesta(respuestas[p.id])
      const pendiente = { diagnostico_id: d.id, titulo: p.documento_nombre, estado: 'pendiente' }
      await trx('diagnostico_entregables').where(pendiente).whereNot('asignado_a', asignado).del()
      const existe = await trx('diagnostico_entregables').where({ ...pendiente, asignado_a: asignado }).first()
      if (!existe) {
        await trx('diagnostico_entregables').insert({ ...pendiente, asignado_a: asignado, ruta_archivo: null })
        if (asignado === 'cliente') tareasCliente.push(p.documento_nombre)
      }
    }
  })

  for (const nombre of tareasCliente) {
    notificarCliente({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: `Documento requerido — diagnóstico "${d.nombre}"`,
      mensaje: `Debes entregar "${nombre}". Súbelo desde la pestaña Entregables.`,
      url: '/admin/diagnosticos',
      empresaId: d.empresa_id, personaId: d.persona_id,
    })
  }

  res.json({ ok: true })

  // Cliente diligencia la entrevista -> avisar a los admins
  if (!esStaff(req.user)) {
    notificarAdmins({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: 'Respuestas de diagnóstico recibidas',
      mensaje: `Diagnóstico #${d.id}: el cliente guardó ${Object.keys(respuestas).length} respuesta(s) — ${req.user.email}`,
      url: '/admin/diagnosticos',
      userId: req.user.id,
    })
  }
}

// GET /diagnosticos/:id/entrevista/export — CSV de preguntas/respuestas
// para análisis (solo staff).
export async function exportEntrevista(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (!esStaff(req.user)) return res.status(403).json({ message: 'Solo el equipo interno puede exportar' })

  const preguntas = await db('diagnostico_preguntas').where('activo', true).orderBy('orden')
  const respuestas = await db('diagnostico_respuestas').where('diagnostico_id', d.id)
  const map = Object.fromEntries(respuestas.map(r => [r.pregunta_id, r]))

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const filas = [['N°', 'Pregunta', 'Tipo', 'Obligatoria', 'Respuesta', 'Comentario', 'Fecha'].join(';')]
  preguntas.forEach((p, i) => {
    const r = map[p.id]
    const valor = r?.valor ?? (r?.valor_json ? JSON.parse(r.valor_json) : '')
    filas.push([
      i + 1,
      esc(p.titulo),
      esc(p.tipo_respuesta),
      p.es_obligatoria ? 'Sí' : 'No',
      esc(Array.isArray(valor) ? valor.join(', ') : valor),
      esc(r?.comentario ?? ''),
      esc(r?.updated_at ? new Date(r.updated_at).toLocaleString('es-CO') : ''),
    ].join(';'))
  })

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="entrevista-diagnostico-${d.id}.csv"`)
  // BOM para que Excel abra los acentos bien
  res.send('\uFEFF' + filas.join('\r\n'))
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
    .orderBy('doc.id')

  res.json({
    documentos: configs.map(c => ({
      config: c,
      archivos: docs.filter(x => x.doc_config_id === c.id),
    })),
  })
}

// POST /diagnosticos/:id/documentos/:configId — subir archivo
// Multi-archivo: hasta maximo_archivos de la config (tope global 5).
const MAX_ARCHIVOS = 5
export async function uploadDocumento(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (!req.file) return res.status(400).json({ message: 'Archivo requerido' })

  const config = await db('diagnostico_doc_config').where('id', req.params.configId).where('activo', true).first()
  if (!config) return res.status(404).json({ message: 'Documento no configurado' })

  const max = Math.min(Math.max(Number(config.maximo_archivos) || MAX_ARCHIVOS, 1), MAX_ARCHIVOS)
  const [{ total }] = await db('diagnostico_documentos')
    .where({ diagnostico_id: d.id, doc_config_id: config.id })
    .count('* as total')
  if (Number(total) >= max) {
    return res.status(422).json({ message: `Máximo ${max} archivo(s) por documento. Elimina uno para cargar otro.` })
  }

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
    estado: esStaff(req.user) ? (req.body.estado || 'revisar') : 'revisar',
    comentarios_revision: req.body.comentarios || null,
  }
  if (esStaff(req.user)) {
    const activos = await docEstadosActivos()
    if (activos.some(e => e.value === req.body.estado)) {
      payload.fecha_revision = db.fn.now()
      payload.revisado_por = req.user.id
    }
  }

  await db('diagnostico_documentos').insert(payload)

  res.status(201).json({ ok: true })

  // Cliente sube documento requerido -> avisar a los admins
  if (!esStaff(req.user)) {
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
  const activos = await docEstadosActivos()
  const estadoCfg = activos.find(e => e.value === estado)
  if (estado && !estadoCfg) return res.status(400).json({ message: 'Estado no válido' })
  if (estadoCfg?.requiere_comentario && !(req.body.comentarios || '').trim()) {
    return res.status(400).json({ message: `Indica el motivo de "${estadoCfg.label}"` })
  }

  await db('diagnostico_documentos').where('id', doc.id).update({
    estado: estado || doc.estado,
    comentarios_revision: req.body.comentarios !== undefined ? req.body.comentarios : doc.comentarios_revision,
    fecha_revision: db.fn.now(),
    revisado_por: req.user.id,
  })
  res.json({ ok: true })

  // Staff revisa un documento requerido -> avisar al cliente (in-app + correo)
  if (estado && estado !== doc.estado) {
    const config = await db('diagnostico_doc_config').where('id', doc.doc_config_id).first()
    notificarCambioEstado({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: `Documento "${config?.titulo || 'requerido'}"${doc.nombre_original ? ` (${doc.nombre_original})` : ''} del diagnóstico "${d.nombre}"`,
      estadoAnterior: doc.estado, estadoNuevo: estado,
      url: '/admin/diagnosticos',
      empresaId: d.empresa_id, personaId: d.persona_id,
    })
  }
}

// DELETE /diagnosticos/documentos/:docId — quitar un archivo cargado
export async function removeDocumento(req, res) {
  const doc = await db('diagnostico_documentos').where('id', req.params.docId).first()
  if (!doc) return res.status(404).json({ message: 'Documento no encontrado' })
  const d = await db('diagnosticos').where('id', doc.diagnostico_id).first()
  if (!puedeVer(req.user, d)) return res.status(403).json({ message: 'Sin acceso' })

  if (doc.ruta_archivo) {
    const { unlink } = await import('fs/promises')
    await unlink(resolve(STORAGE_DIR, doc.ruta_archivo)).catch(() => {})
  }
  await db('diagnostico_documentos').where('id', doc.id).del()
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
// ENTREGABLES — documentos corregidos/finales que el staff publica para
// que el cliente los descargue (dirección inversa a los requeridos).
// ════════════════════════════════════════════════════════════════════════════

// ¿La respuesta guardada activa la pregunta hija? Para selección múltiple basta
// con que incluya el valor configurado en mostrar_si.
const coincideRespuesta = (row, mostrarSi) => {
  if (mostrarSi === null || mostrarSi === undefined) return false
  if (row.valor_json) {
    const arr = JSON.parse(row.valor_json)
    return Array.isArray(arr) ? arr.map(String).includes(String(mostrarSi)) : String(arr) === String(mostrarSi)
  }
  return row.valor !== null && String(row.valor) === String(mostrarSi)
}

// Responsable de la tarea pendiente según la respuesta: No / no cumple -> equipo
const asignadoDeRespuesta = (valor) =>
  ['0', 'false', 'no', 'no cumple'].includes(String(valor).trim().toLowerCase()) ? 'admin' : 'cliente'

async function findEntregable(req, res) {
  const e = await db('diagnostico_entregables').where('id', req.params.eid).first()
  if (!e) {
    res.status(404).json({ message: 'Entregable no encontrado' })
    return null
  }
  const d = await db('diagnosticos').where('id', e.diagnostico_id).first()
  if (!puedeVer(req.user, d)) {
    res.status(403).json({ message: 'Sin acceso' })
    return null
  }
  return { entregable: e, diagnostico: d }
}

// GET /diagnosticos/:id/entregables
export async function listEntregables(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  const rows = await db('diagnostico_entregables as e')
    .leftJoin('users as u', 'u.id', 'e.subido_por')
    .where('e.diagnostico_id', d.id)
    .select('e.*', 'u.name as subido_por_nombre')
    .orderBy('e.id', 'desc')
  const subtotal = round2(rows.filter(e => e.asignado_a === 'admin').reduce((s, e) => s + Number(e.valor || 0), 0))
  const descuentos = Math.min(round2(d.descuento_total || 0), subtotal)
  res.json({
    data: rows,
    subtotal,
    descuentos,
    total: round2(subtotal - descuentos),
    cuenta_cobro_id: d.cuenta_cobro_id ?? null,
  })
}

const round2 = (n) => Math.round(Number(n) * 100) / 100
const netoDe = (e) => round2(e.valor || 0)

async function getTarifaHora() {
  const row = await db('diagnostico_parametros').where('clave', 'tarifa_hora').first()
  return Number(row?.valor || 0)
}

// PUT /diagnosticos/:id/descuento { descuento } — descuento sobre el total
// de los entregables cotizados. Se bloquea cuando ya existe el cobro.
export async function setDescuentoTotal(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (d.cuenta_cobro_id) return res.status(409).json({ message: 'El cobro ya fue generado; no se puede cambiar el descuento' })
  const descuento = Number(req.body.descuento)
  if (!Number.isFinite(descuento) || descuento < 0) return res.status(400).json({ message: 'El descuento debe ser un número mayor o igual a 0' })

  const subtotal = round2((await db('diagnostico_entregables')
    .where({ diagnostico_id: d.id, asignado_a: 'admin', estado: 'entregado' }))
    .reduce((s, e) => s + Number(e.valor || 0), 0))
  if (descuento > subtotal) return res.status(400).json({ message: `El descuento no puede superar el subtotal (${subtotal.toLocaleString('es-CO')})` })

  await db('diagnosticos').where('id', d.id).update({ descuento_total: round2(descuento) })
  res.json({ descuento_total: round2(descuento), subtotal })
}

// GET /diagnostico-config/tarifa
export async function getTarifa(req, res) {
  res.json({ tarifa_hora: await getTarifaHora() })
}

// PUT /diagnostico-config/tarifa { tarifa_hora }
export async function putTarifa(req, res) {
  const tarifa = Number(req.body.tarifa_hora)
  if (!Number.isFinite(tarifa) || tarifa < 0) return res.status(400).json({ message: 'La tarifa debe ser un número mayor o igual a 0' })
  await db('diagnostico_parametros').where('clave', 'tarifa_hora').update({ valor: String(round2(tarifa)), updated_at: db.fn.now() })
  res.json({ tarifa_hora: round2(tarifa) })
}

// PUT /diagnosticos/entregables/:eid/cotizacion { horas } — solo entregables
// del equipo ya entregados. Guarda la tarifa vigente como snapshot.
export async function cotizarEntregable(req, res) {
  const found = await findEntregable(req, res)
  if (!found) return
  const { entregable, diagnostico } = found
  if (diagnostico.cuenta_cobro_id) return res.status(409).json({ message: 'El cobro ya fue generado; no se pueden cambiar las horas' })
  if (entregable.asignado_a !== 'admin' || entregable.estado !== 'entregado') {
    return res.status(400).json({ message: 'Solo se cotizan entregables del equipo ya entregados' })
  }
  const horas = req.body.horas !== undefined ? Number(req.body.horas) : Number(entregable.horas || 0)
  if (!Number.isFinite(horas) || horas < 0) return res.status(400).json({ message: 'Las horas deben ser un número mayor o igual a 0' })
  // Al cambiar horas se usa la tarifa vigente; si solo cambia el descuento se conserva la ya cotizada
  const valorHora = req.body.horas !== undefined || entregable.valor_hora === null
    ? await getTarifaHora()
    : Number(entregable.valor_hora)
  const valor = round2(horas * valorHora)
  await db('diagnostico_entregables').where('id', entregable.id).update({
    horas: round2(horas), valor_hora: round2(valorHora), valor,
  })
  res.json({ entregable: await db('diagnostico_entregables').where('id', entregable.id).first() })
}

// POST /diagnosticos/:id/cobro — genera una cuenta de cobro pendiente en
// Pagos con una línea por entregable cotizado. Una sola vez por diagnóstico.
export async function generarCobro(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (d.cuenta_cobro_id) return res.status(409).json({ message: 'El cobro ya fue generado' })

  const items = await db('diagnostico_entregables')
    .where({ diagnostico_id: d.id, asignado_a: 'admin', estado: 'entregado' })
    .whereNotNull('valor').where('valor', '>', 0)
    .orderBy('id')
  if (!items.length) return res.status(400).json({ message: 'No hay entregables cotizados para cobrar' })

  const subtotal = round2(items.reduce((s, e) => s + netoDe(e), 0))
  const descuento = Math.min(round2(d.descuento_total || 0), subtotal)
  const total = round2(subtotal - descuento)
  if (total <= 0) return res.status(400).json({ message: 'El total a cobrar es 0; revisa el descuento' })

  const credito = req.body.forma_pago === 'credito'
  if (credito && !req.body.fecha_vencimiento) return res.status(400).json({ message: 'Indica la fecha de vencimiento del crédito' })

  let cuentaId
  await db.transaction(async trx => {
    ;[cuentaId] = await trx('cuentas_cobro').insert({
      forma_pago: credito ? 'credito' : 'contado',
      fecha_vencimiento: credito ? req.body.fecha_vencimiento : null,
      empresa_id: d.empresa_id || null,
      persona_id: d.persona_id || null,
      tipo: 1,
      nombre: `Diagnóstico #${d.id} — ${d.nombre}`,
      fecha: new Date(),
      valor_total: total,
      iva: 0,
      cuatroxmil: 0,
      obs: 'Generado desde el módulo de diagnósticos',
      status: 2,
    })
    const lineas = items.map(e => ({
      cuenta_cobro_id: cuentaId,
      descripcion: e.titulo || e.nombre_original || `Entregable #${e.id}`,
      cantidad: Number(e.horas),
      valor: netoDe(e),
    }))
    if (descuento > 0) {
      lineas.push({ cuenta_cobro_id: cuentaId, descripcion: 'Descuento', cantidad: 1, valor: -descuento })
    }
    await trx('detalle_cobro').insert(lineas)
    await trx('diagnosticos').where('id', d.id).update({ cuenta_cobro_id: cuentaId })
  })

  res.status(201).json({ cuenta_cobro_id: cuentaId, total })

  notificarCliente({
    entidad: 'diagnostico', entidadId: d.id,
    titulo: `Cobro generado — diagnóstico "${d.nombre}"`,
    mensaje: `Se generó una cuenta de cobro por $${total.toLocaleString('es-CO')}. Revísala en Pagos.`,
    url: '/admin/pagos',
    empresaId: d.empresa_id, personaId: d.persona_id,
  })
}

// POST /diagnosticos/:id/entregables — solo staff
export async function uploadEntregable(req, res) {
  const d = await findDiagnostico(req, res)
  if (!d) return
  if (!req.file) return res.status(400).json({ message: 'Archivo requerido' })

  const archivo = {
    ruta_archivo: req.file.filename,
    nombre_original: req.file.originalname,
    mime_type: req.file.mimetype,
    tamano_bytes: req.file.size,
    subido_por: req.user.id,
    estado: 'entregado',
  }
  const staff = esStaff(req.user)
  const pendienteId = Number(req.body.pendiente_id)
  const pendiente = pendienteId
    ? await db('diagnostico_entregables').where({ id: pendienteId, diagnostico_id: d.id, estado: 'pendiente' }).first()
    : null
  // El cliente solo entrega las tareas asignadas a él; el equipo publica libremente
  if (!staff && pendiente?.asignado_a !== 'cliente') {
    unlinkSync(req.file.path)
    return res.status(403).json({ message: 'Solo el equipo puede publicar entregables' })
  }
  if (pendienteId && !pendiente) {
    unlinkSync(req.file.path)
    return res.status(404).json({ message: 'Tarea pendiente no encontrada' })
  }

  let id
  if (pendiente) {
    await db('diagnostico_entregables').where('id', pendiente.id).update(archivo)
    id = pendiente.id
  } else {
    ;[id] = await db('diagnostico_entregables').insert({
      diagnostico_id: d.id,
      titulo: (req.body.titulo || '').trim() || req.file.originalname,
      asignado_a: 'admin',
      ...archivo,
    })
  }
  res.status(201).json({ id })

  const titulo = pendiente?.titulo || (req.body.titulo || '').trim() || req.file.originalname
  if (staff) {
    notificarCliente({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: `Documento entregado — diagnóstico "${d.nombre}"`,
      mensaje: `El equipo te entregó "${titulo}". Ya puedes descargarlo.`,
      url: '/admin/diagnosticos',
      empresaId: d.empresa_id, personaId: d.persona_id,
    })
  } else {
    notificarAdmins({
      entidad: 'diagnostico', entidadId: d.id,
      titulo: 'Documento entregado por el cliente',
      mensaje: `Diagnóstico "${d.nombre}": el cliente entregó "${titulo}".`,
      url: '/admin/diagnosticos',
      userId: req.user.id,
    })
  }
}

// GET /diagnosticos/entregables/:eid/download
export async function downloadEntregable(req, res) {
  const found = await findEntregable(req, res)
  if (!found) return
  const { entregable } = found
  const filePath = entregable.ruta_archivo ? resolve(STORAGE_DIR, entregable.ruta_archivo) : null
  if (!filePath || !existsSync(filePath)) {
    return res.status(404).json({ message: 'Archivo no disponible' })
  }
  res.setHeader('Content-Type', entregable.mime_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entregable.nombre_original || 'documento')}"`)
  createReadStream(filePath).pipe(res)
}

// DELETE /diagnosticos/entregables/:eid — solo staff
export async function removeEntregable(req, res) {
  const found = await findEntregable(req, res)
  if (!found) return
  const { entregable } = found
  if (entregable.ruta_archivo) {
    const { unlink } = await import('fs/promises')
    await unlink(resolve(STORAGE_DIR, entregable.ruta_archivo)).catch(() => {})
  }
  await db('diagnostico_entregables').where('id', entregable.id).del()
  res.json({ ok: true })
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

// GET /diagnosticos/doc-estados — estados activos para la revisión
export async function listDocEstados(req, res) {
  res.json({ data: await docEstadosActivos() })
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN (admin): preguntas y documentos requeridos
// ════════════════════════════════════════════════════════════════════════════

export async function listDocEstadosAll(req, res) {
  res.json({ data: await db('diagnostico_doc_estados').orderBy('orden') })
}

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

export async function createDocEstado(req, res) {
  const { value, label, requiere_comentario, orden } = req.body
  if (!label?.trim()) return res.status(400).json({ message: 'El nombre del estado es obligatorio' })
  const val = (value || slugify(label)).trim()
  if (!val) return res.status(400).json({ message: 'Identificador inválido' })
  const existe = await db('diagnostico_doc_estados').where('value', val).first()
  if (existe) return res.status(409).json({ message: 'Ya existe un estado con ese identificador' })
  const [id] = await db('diagnostico_doc_estados').insert({
    value: val, label: label.trim(),
    requiere_comentario: !!requiere_comentario,
    orden: Number(orden) || 99, activo: true, es_sistema: false,
  })
  res.status(201).json({ id })
}

export async function updateDocEstado(req, res) {
  const e = await db('diagnostico_doc_estados').where('id', req.params.id).first()
  if (!e) return res.status(404).json({ message: 'Estado no encontrado' })
  const { label, requiere_comentario, activo, orden } = req.body
  await db('diagnostico_doc_estados').where('id', e.id).update({
    label: label ?? e.label,
    requiere_comentario: requiere_comentario !== undefined ? !!requiere_comentario : e.requiere_comentario,
    activo: activo !== undefined ? !!activo : e.activo,
    orden: orden !== undefined ? Number(orden) : e.orden,
  })
  res.json({ ok: true })
}

export async function deleteDocEstado(req, res) {
  const e = await db('diagnostico_doc_estados').where('id', req.params.id).first()
  if (!e) return res.status(404).json({ message: 'Estado no encontrado' })
  // Los de sistema sostienen el flujo (pendiente/revisar/aprobado/rechazado/renovar):
  // se pueden desactivar, no borrar. Los personalizados sí se eliminan.
  if (e.es_sistema) return res.status(400).json({ message: 'Los estados base no se pueden eliminar; desactívalo si no lo quieres ofrecer' })
  await db('diagnostico_doc_estados').where('id', e.id).del()
  res.json({ ok: true })
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN (admin): preguntas y documentos requeridos
// ════════════════════════════════════════════════════════════════════════════

export async function listPreguntas(req, res) {
  const rows = await db('diagnostico_preguntas').orderBy('orden')
  res.json({ data: rows.map(p => ({ ...p, opciones: p.opciones ? JSON.parse(p.opciones) : null })) })
}

// Dependencia de una pregunta: pregunta_padre_id + mostrar_si (un solo nivel)
async function vinculoPregunta(body, actualId) {
  const padreId = body.pregunta_padre_id ? Number(body.pregunta_padre_id) : null
  if (!padreId) return { pregunta_padre_id: null, mostrar_si: null }
  if (padreId === actualId) return { error: 'Una pregunta no puede depender de sí misma' }
  const padre = await db('diagnostico_preguntas').where('id', padreId).first()
  if (!padre) return { error: 'La pregunta padre no existe' }
  if (padre.pregunta_padre_id) return { error: 'Solo se permite un nivel de dependencia' }
  const mostrarSi = body.mostrar_si === undefined || body.mostrar_si === null || body.mostrar_si === '' ? null : String(body.mostrar_si)
  if (mostrarSi === null) return { error: 'Indica la respuesta que activa la pregunta' }
  return { pregunta_padre_id: padreId, mostrar_si: mostrarSi }
}

export async function createPregunta(req, res) {
  const { titulo, slug, descripcion, tipo_respuesta, opciones, es_obligatoria, ayuda_contextual, orden, activo } = req.body
  if (!titulo || !TIPOS_RESPUESTA.includes(tipo_respuesta)) {
    return res.status(400).json({ message: 'Título y tipo de respuesta válidos son obligatorios' })
  }
  const vinculo = await vinculoPregunta(req.body, null)
  if (vinculo.error) return res.status(400).json({ message: vinculo.error })
  const [id] = await db('diagnostico_preguntas').insert({
    slug: slug || titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-').slice(0, 100),
    titulo, descripcion: descripcion || null, tipo_respuesta,
    opciones: opciones ? JSON.stringify(opciones) : null,
    es_obligatoria: !!es_obligatoria,
    ayuda_contextual: ayuda_contextual || null,
    orden: Number(orden) || 99, activo: activo !== undefined ? !!activo : true,
    ...vinculo,
  })
  res.status(201).json({ id })
}

export async function updatePregunta(req, res) {
  const p = await db('diagnostico_preguntas').where('id', req.params.id).first()
  if (!p) return res.status(404).json({ message: 'Pregunta no encontrada' })
  const { titulo, descripcion, tipo_respuesta, opciones, es_obligatoria, ayuda_contextual, orden, activo } = req.body
  const vinculo = req.body.pregunta_padre_id !== undefined || req.body.mostrar_si !== undefined
    ? await vinculoPregunta(req.body, p.id)
    : {}
  if (vinculo.error) return res.status(400).json({ message: vinculo.error })
  await db('diagnostico_preguntas').where('id', p.id).update({
    ...vinculo,
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

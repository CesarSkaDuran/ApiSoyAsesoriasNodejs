import crypto from 'crypto'
import db from '../db/knex.js'

// ════════════════════════════════════════════════════════════════════════════
// COMERCIAL / VENTAS — embudos, etapas y leads (replica marketing_* anterior)
// ════════════════════════════════════════════════════════════════════════════

const LEAD_CAMPOS = [
  'nombre', 'nombre_emprendedor', 'empresa', 'email', 'telefono',
  'fuente', 'campania', 'usuario_asignado_id', 'notas', 'empresa_id', 'persona_id',
]

function leadData(body) {
  const data = {}
  for (const k of LEAD_CAMPOS) {
    if (body[k] !== undefined) data[k] = body[k] === '' ? null : body[k]
  }
  return data
}

async function registrarHistorial(trx, leadId, embudoId, etapaId, usuarioId, nota) {
  await trx('lead_historial').insert({
    lead_id: leadId, embudo_id: embudoId, etapa_id: etapaId,
    usuario_id: usuarioId || null, nota: nota || null,
  })
}

// GET /ventas — resumen de embudos con KPIs
export async function index(req, res) {
  const embudos = await db('embudos').where('activo', true).orderBy('id')
  const month = new Date()
  const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`

  const result = []
  for (const e of embudos) {
    const etapas = await db('embudo_etapas').where('embudo_id', e.id).orderBy('posicion')
    const leads = await db('leads').where('embudo_id', e.id).select('id', 'etapa_id', 'created_at')

    const countByEtapa = {}
    let delMes = 0
    for (const l of leads) {
      countByEtapa[l.etapa_id] = (countByEtapa[l.etapa_id] || 0) + 1
      if (l.created_at && new Date(l.created_at) >= new Date(monthStart)) delMes++
    }

    const cierreIds = etapas.filter(s => s.es_cierre && !s.es_perdido).map(s => s.id)
    const perdidoIds = etapas.filter(s => s.es_perdido).map(s => s.id)

    result.push({
      ...e,
      total: leads.length,
      del_mes: delMes,
      ganados: cierreIds.reduce((a, id) => a + (countByEtapa[id] || 0), 0),
      perdidos: perdidoIds.reduce((a, id) => a + (countByEtapa[id] || 0), 0),
      etapas: etapas.map(s => ({ ...s, total: countByEtapa[s.id] || 0 })),
    })
  }

  res.json(result)
}

// GET /ventas/embudo/:slug — embudo completo con etapas y leads
export async function embudo(req, res) {
  const e = await db('embudos').where('slug', req.params.slug).orWhere('id', Number(req.params.slug) || 0).first()
  if (!e) return res.status(404).json({ message: 'Embudo no encontrado' })

  const etapas = await db('embudo_etapas').where('embudo_id', e.id).orderBy('posicion')

  let leadsQ = db('leads as l')
    .leftJoin('users as u', 'u.id', 'l.usuario_asignado_id')
    .leftJoin('empresas as emp', 'emp.id', 'l.empresa_id')
    .leftJoin('personas as p', 'p.id', 'l.persona_id')
    .where('l.embudo_id', e.id)
    .select(
      'l.*',
      'u.name as asignado_nombre',
      'emp.razon_social as empresa_convertida_nombre',
      db.raw("CONCAT_WS(' ', p.primer_nombre, p.primer_apellido) as persona_convertida_nombre")
    )
    .orderBy([{ column: 'l.orden_pos' }, { column: 'l.id' }])

  const search = (req.query.search || '').trim()
  if (search) {
    leadsQ.where(b => {
      b.where('l.nombre', 'like', `%${search}%`)
        .orWhere('l.empresa', 'like', `%${search}%`)
        .orWhere('l.email', 'like', `%${search}%`)
        .orWhere('l.telefono', 'like', `%${search}%`)
        .orWhere('l.campania', 'like', `%${search}%`)
    })
  }

  const leads = await leadsQ
  const month = new Date()
  const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`

  res.json({
    embudo: e,
    etapas: etapas.map(s => ({
      ...s,
      leads: leads.filter(l => l.etapa_id === s.id),
      total: leads.filter(l => l.etapa_id === s.id).length,
    })),
    totales: {
      leads: leads.length,
      del_mes: leads.filter(l => l.created_at && new Date(l.created_at) >= new Date(monthStart)).length,
      ganados: leads.filter(l => etapas.find(s => s.id === l.etapa_id && s.es_cierre && !s.es_perdido)).length,
      perdidos: leads.filter(l => etapas.find(s => s.id === l.etapa_id && s.es_perdido)).length,
    },
  })
}

// GET /ventas/leads/:id — detalle con historial
export async function showLead(req, res) {
  const lead = await db('leads').where('id', req.params.id).first()
  if (!lead) return res.status(404).json({ message: 'Lead no encontrado' })
  const historial = await db('lead_historial as h')
    .leftJoin('users as u', 'u.id', 'h.usuario_id')
    .leftJoin('embudo_etapas as e', 'e.id', 'h.etapa_id')
    .where('h.lead_id', lead.id)
    .select('h.*', 'u.name as usuario_nombre', 'e.nombre as etapa_nombre')
    .orderBy('h.created_at', 'desc')
  res.json({ lead, historial })
}

// POST /ventas/leads — crear lead (panel interno)
export async function createLead(req, res) {
  const { embudo_id, etapa_id } = req.body
  const embudo = await db('embudos').where('id', embudo_id).first()
  if (!embudo) return res.status(400).json({ message: 'Embudo no válido' })

  let etapaId = Number(etapa_id) || null
  if (!etapaId) {
    const primera = await db('embudo_etapas').where('embudo_id', embudo.id).orderBy('posicion').first()
    etapaId = primera?.id
  }
  const etapa = await db('embudo_etapas').where('id', etapaId).where('embudo_id', embudo.id).first()
  if (!etapa) return res.status(400).json({ message: 'Etapa no válida para este embudo' })

  const data = leadData(req.body)
  if (!data.nombre) return res.status(400).json({ message: 'El nombre es obligatorio' })

  const id = await db.transaction(async trx => {
    const [lid] = await trx('leads').insert({
      ...data, embudo_id: embudo.id, etapa_id: etapa.id,
      etapa_cambiada_en: trx.fn.now(),
    })
    await registrarHistorial(trx, lid, embudo.id, etapa.id, req.user?.id, 'Lead creado desde el panel.')
    return lid
  })

  const lead = await db('leads').where('id', id).first()
  res.status(201).json({ lead })
}

// PUT /ventas/leads/:id — actualizar datos y notas
export async function updateLead(req, res) {
  const lead = await db('leads').where('id', req.params.id).first()
  if (!lead) return res.status(404).json({ message: 'Lead no encontrado' })

  const data = leadData(req.body)
  data.ultimo_contacto_en = db.fn.now()
  await db('leads').where('id', lead.id).update(data)
  res.json({ lead: await db('leads').where('id', lead.id).first() })
}

// PUT /ventas/leads/:id/etapa — mover de etapa (drag & drop)
export async function moveLead(req, res) {
  const lead = await db('leads').where('id', req.params.id).first()
  if (!lead) return res.status(404).json({ message: 'Lead no encontrado' })

  const etapaId = Number(req.body.etapa_id)
  const etapa = await db('embudo_etapas').where('id', etapaId).where('embudo_id', lead.embudo_id).first()
  if (!etapa) return res.status(400).json({ message: 'Etapa no válida para este embudo' })

  await db.transaction(async trx => {
    await trx('leads').where('id', lead.id).update({
      etapa_id: etapa.id,
      orden_pos: Number(req.body.orden_pos) || 0,
      etapa_cambiada_en: trx.fn.now(),
      ultimo_contacto_en: trx.fn.now(),
    })
    if (lead.etapa_id !== etapa.id) {
      await registrarHistorial(trx, lead.id, lead.embudo_id, etapa.id, req.user?.id, `Movido a "${etapa.nombre}"`)
    }
  })

  res.json({ ok: true })
}

// POST /ventas/leads/:id/convertir — convertir a empresa o independiente
export async function convertirLead(req, res) {
  const lead = await db('leads').where('id', req.params.id).first()
  if (!lead) return res.status(404).json({ message: 'Lead no encontrado' })

  const tipo = req.body.tipo === 'independiente' ? 'independiente' : 'empresa'
  let update = {}

  if (tipo === 'empresa') {
    if (lead.empresa_id) return res.status(400).json({ message: 'El lead ya está vinculado a una empresa' })
    const [empresaId] = await db('empresas').insert({
      razon_social: req.body.razon_social || lead.empresa || lead.nombre,
      email: lead.email,
      telefono_movil: lead.telefono,
      status: 'activo',
    })
    update.empresa_id = empresaId
  } else {
    if (lead.persona_id) return res.status(400).json({ message: 'El lead ya está vinculado a un independiente' })
    const nombre = (lead.nombre_emprendedor || lead.nombre || '').trim().split(/\s+/)
    const [personaId] = await db('personas').insert({
      primer_nombre: nombre[0] || lead.nombre,
      primer_apellido: nombre.slice(1).join(' ') || null,
      email: lead.email,
      telefono: lead.telefono,
      status: 'activo',
    })
    update.persona_id = personaId
  }

  await db.transaction(async trx => {
    await trx('leads').where('id', lead.id).update({ ...update, ultimo_contacto_en: trx.fn.now() })
    await registrarHistorial(trx, lead.id, lead.embudo_id, lead.etapa_id, req.user?.id,
      `Convertido a ${tipo === 'empresa' ? 'empresa' : 'independiente'}`)
  })

  res.json({ lead: await db('leads').where('id', lead.id).first(), ...update })
}

// DELETE /ventas/leads/:id
export async function deleteLead(req, res) {
  const n = await db('leads').where('id', req.params.id).del()
  if (!n) return res.status(404).json({ message: 'Lead no encontrado' })
  res.json({ ok: true })
}

// ════════════════════════════════════════════════════════════════════════════
// Endpoint público: POST /ventas/ingest — formularios web (sin JWT, con token)
// Protecciones:
//   - rate limit por IP (middleware en ventas.routes.js)
//   - token obligatorio con comparación timing-safe (fail closed si no está configurado)
//   - honeypot "website": los bots lo llenan → se descarta en silencio
//   - sanitización de longitudes + email básico
//   - deduplicación: mismo email/teléfono en los últimos 10 min → no duplica
// ════════════════════════════════════════════════════════════════════════════
export async function ingestLead(req, res) {
  const expected = process.env.SOY_LEADS_TOKEN || ''
  const token = String(req.body.token || req.headers['x-marketing-token'] || '')

  // Fail closed: sin token configurado el endpoint queda deshabilitado
  if (!expected) {
    return res.status(503).json({ message: 'Endpoint de captación no habilitado' })
  }
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'Token inválido' })
  }

  // Honeypot: un humano nunca llena este campo oculto
  if (req.body.website || req.body.empresa_hp) {
    return res.status(201).json({ status: 'ok' })
  }

  const slug = String(req.body.funnel || req.body.fuente || 'suscriptores').slice(0, 60)
  const embudo = await db('embudos').where('slug', slug).orWhere('tipo', req.body.tipo || 'suscriptor').first()
  if (!embudo) return res.status(400).json({ message: 'Embudo no configurado' })

  const etapa = await db('embudo_etapas').where('embudo_id', embudo.id).orderBy('posicion').first()
  if (!etapa) return res.status(400).json({ message: 'El embudo no tiene etapas' })

  const nombre = String(req.body.nombre_emprendimiento || req.body.nombre || '').trim().slice(0, 150)
  const emprendedor = String(req.body.nombre_emprendedor || '').trim().slice(0, 150)
  if (!nombre || !emprendedor) {
    return res.status(422).json({ message: 'Nombre del emprendedor y del emprendimiento son obligatorios' })
  }

  const email = String(req.body.email || '').trim().slice(0, 150)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ message: 'Email inválido' })
  }
  const telefono = String(req.body.telefono || '').trim().slice(0, 30)

  // Deduplicación: mismo email o teléfono en los últimos 10 min
  if (email || telefono) {
    const dup = await db('leads')
      .where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 10 MINUTE)'))
      .where(b => {
        if (email) b.orWhere('email', email)
        if (telefono) b.orWhere('telefono', telefono)
      })
      .first()
    if (dup) {
      return res.status(200).json({ status: 'ok', lead_id: dup.id, deduplicated: true })
    }
  }

  const id = await db.transaction(async trx => {
    const [lid] = await trx('leads').insert({
      embudo_id: embudo.id, etapa_id: etapa.id,
      nombre, nombre_emprendedor: emprendedor,
      empresa: req.body.nombre_emprendimiento || null,
      email: email || null,
      telefono: telefono || null,
      fuente: String(req.body.fuente || 'web-publica').slice(0, 60),
      campania: String(req.body.campania || '').slice(0, 100) || null,
      notas: String(req.body.mensaje || '').slice(0, 2000) || null,
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata).slice(0, 4000) : null,
      etapa_cambiada_en: trx.fn.now(),
    })
    await registrarHistorial(trx, lid, embudo.id, etapa.id, null, 'Lead creado desde formulario público.')
    return lid
  })

  res.status(201).json({ status: 'ok', lead_id: id })
}

// ════════════════════════════════════════════════════════════════════════════
// Administración de embudos y etapas
// ════════════════════════════════════════════════════════════════════════════

export async function createEmbudo(req, res) {
  const { slug, nombre, descripcion, tipo } = req.body
  if (!slug || !nombre) return res.status(400).json({ message: 'Slug y nombre son obligatorios' })
  const existe = await db('embudos').where('slug', slug).first()
  if (existe) return res.status(409).json({ message: 'Ya existe un embudo con ese slug' })
  const [id] = await db('embudos').insert({
    slug, nombre, descripcion: descripcion || null,
    tipo: ['cliente', 'suscriptor'].includes(tipo) ? tipo : 'cliente',
  })
  res.status(201).json({ id })
}

export async function updateEmbudo(req, res) {
  const e = await db('embudos').where('id', req.params.id).first()
  if (!e) return res.status(404).json({ message: 'Embudo no encontrado' })
  const { nombre, descripcion, tipo, activo } = req.body
  await db('embudos').where('id', e.id).update({
    nombre: nombre ?? e.nombre,
    descripcion: descripcion !== undefined ? descripcion : e.descripcion,
    tipo: ['cliente', 'suscriptor'].includes(tipo) ? tipo : e.tipo,
    activo: activo !== undefined ? !!activo : e.activo,
  })
  res.json({ ok: true })
}

export async function createEtapa(req, res) {
  const embudo = await db('embudos').where('id', req.params.id).first()
  if (!embudo) return res.status(404).json({ message: 'Embudo no encontrado' })
  const { slug, nombre, descripcion, es_cierre, es_perdido } = req.body
  if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio' })
  const max = await db('embudo_etapas').where('embudo_id', embudo.id).max('posicion as m').first()
  const [id] = await db('embudo_etapas').insert({
    embudo_id: embudo.id,
    slug: slug || nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
    nombre, descripcion: descripcion || null,
    posicion: (Number(max?.m) || 0) + 1,
    es_cierre: !!es_cierre, es_perdido: !!es_perdido,
  })
  res.status(201).json({ id })
}

export async function updateEtapa(req, res) {
  const etapa = await db('embudo_etapas').where('id', req.params.id).first()
  if (!etapa) return res.status(404).json({ message: 'Etapa no encontrada' })
  const { nombre, descripcion, posicion, es_cierre, es_perdido } = req.body
  await db('embudo_etapas').where('id', etapa.id).update({
    nombre: nombre ?? etapa.nombre,
    descripcion: descripcion !== undefined ? descripcion : etapa.descripcion,
    posicion: posicion !== undefined ? Number(posicion) : etapa.posicion,
    es_cierre: es_cierre !== undefined ? !!es_cierre : etapa.es_cierre,
    es_perdido: es_perdido !== undefined ? !!es_perdido : etapa.es_perdido,
  })
  res.json({ ok: true })
}

export async function deleteEtapa(req, res) {
  const etapa = await db('embudo_etapas').where('id', req.params.id).first()
  if (!etapa) return res.status(404).json({ message: 'Etapa no encontrada' })
  const [{ n }] = await db('leads').where('etapa_id', etapa.id).count('id as n')
  if (Number(n) > 0) {
    return res.status(409).json({ message: `No se puede eliminar: tiene ${n} leads. Muévelos a otra etapa primero.` })
  }
  await db('embudo_etapas').where('id', etapa.id).del()
  res.json({ ok: true })
}

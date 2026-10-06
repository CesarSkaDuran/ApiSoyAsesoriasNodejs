import db from '../db/knex.js'
import { resolve, sep } from 'path'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'
import { notificarAdmins } from '../services/notificaciones.js'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

// Tipos de owner permitidos (una sola FK llena por documento)
const OWNERS = ['empresa_id', 'empleado_id', 'persona_id', 'beneficiado_id', 'planilla_id', 'nomina_id']

const DOC_ESTATUS = ['recibido', 'en_revision', 'aprobado', 'rechazado']

// Resuelve la empresa dueña de un documento segun el owner
async function empresaDeOwner(ownerCol, ownerId) {
  if (ownerCol === 'empresa_id') return Number(ownerId)
  if (ownerCol === 'empleado_id') {
    const e = await db('empleados').where('id', ownerId).first()
    return e ? e.empresa_id : null
  }
  if (ownerCol === 'nomina_id') {
    const n = await db('nominas').where('id', ownerId).first()
    return n ? n.empresa_id : null
  }
  if (ownerCol === 'planilla_id') {
    const p = await db('planillas').where('id', ownerId).first()
    return p ? p.empresa_id : null
  }
  if (ownerCol === 'beneficiado_id') {
    const row = await db('beneficiados')
      .join('empleados', 'beneficiados.empleado_id', 'empleados.id')
      .select('empleados.empresa_id')
      .where('beneficiados.id', ownerId).first()
    return row ? row.empresa_id : null
  }
  return null // persona_id: independientes no tienen empresa_id
}

// Dueño efectivo del documento: empresa o persona (independiente)
async function duenoDeDoc(ownerCol, ownerId) {
  if (ownerCol === 'persona_id') {
    return { empresaId: null, personaId: Number(ownerId) }
  }
  return { empresaId: await empresaDeOwner(ownerCol, ownerId), personaId: null }
}

// Fail closed: si el owner no resuelve a empresa ni persona, se niega el acceso
function canAccessDoc(user, empresaId, personaId) {
  if (esStaff(user)) return true
  if (empresaId !== null) return canAccessEmpresa(user, empresaId)
  if (personaId !== null) return user.persona_id === personaId
  return false
}

// GET /documentos/tipos - catalogo de items de documento (admin ve todos)
export async function listTipos(req, res) {
  const q = db('documento_tipos').orderBy([{ column: 'orden' }, { column: 'nombre' }])
  if (!esStaff(req.user)) q.where('activo', true)
  res.json({ data: await q })
}

// POST /documentos - sube archivo al storage privado (auth requerido)
export async function uploadDoc(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })

  const { nombre, descripcion, servicio_id, tipo_id, version, fecha_emision } = req.body
  const ownerCol = OWNERS.find(o => req.body[o])

  if (!ownerCol) {
    unlinkSync(req.file.path)
    return res.status(400).json({ error: `Indique el owner: ${OWNERS.join(', ')}` })
  }

  if (tipo_id) {
    const tipo = await db('documento_tipos').where('id', tipo_id).where('activo', true).first()
    if (!tipo) {
      unlinkSync(req.file.path)
      return res.status(400).json({ error: 'Tipo de documento no válido' })
    }
  }

  // Verificar que el usuario pueda subir a ese owner
  const { empresaId, personaId } = await duenoDeDoc(ownerCol, req.body[ownerCol])
  if (!canAccessDoc(req.user, empresaId, personaId)) {
    unlinkSync(req.file.path)
    return res.status(403).json({ error: 'Sin acceso a este recurso' })
  }

  let notificationRows = []
  const documento = await db.transaction(async trx => {
    const [id] = await trx('documentos').insert({
      [ownerCol]: Number(req.body[ownerCol]),
      servicio_id: servicio_id || null,
      tipo_id: tipo_id || null,
      version: version || null,
      fecha_emision: fecha_emision || null,
      estatus: 'recibido',
      uploaded_by: req.user.id,
      nombre: nombre || req.file.originalname,
      descripcion: descripcion || null,
      path: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
    })

    // Cuando el cliente carga un documento, se notifica a los administradores
    if (!esStaff(req.user)) {
      const admins = await trx('users').select('id').where('role', 'admin').where('is_active', true)
      notificationRows = await createNotifications(trx, admins.map(a => a.id), {
        titulo: 'Documento cargado por un cliente',
        mensaje: `Documento #${id}: ${nombre || req.file.originalname}`,
        tipo: 'documento',
        url: '/admin/documentos',
      })
    }

    return trx('documentos').where('id', id).first()
  })

  publishNotifications(notificationRows)
  res.status(201).json({ documento })

  // Cliente carga documento -> correo a los admins (in-app ya creada arriba)
  if (!esStaff(req.user)) {
    notificarAdmins({
      entidad: 'documento', entidadId: documento.id,
      titulo: 'Documento cargado por un cliente',
      mensaje: `Documento #${documento.id}: ${documento.nombre} — ${req.user.email}`,
      url: '/admin/documentos',
      crearInApp: false,
      userId: req.user.id,
    })
  }
}

// PUT /documentos/:id - metadata del documento; el estatus solo lo cambia el admin
export async function update(req, res) {
  const doc = await db('documentos').where('id', req.params.id).first()
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  const ownerCol = OWNERS.find(o => doc[o])
  const { empresaId, personaId } = ownerCol
    ? await duenoDeDoc(ownerCol, doc[ownerCol])
    : { empresaId: null, personaId: null }
  if (!canAccessDoc(req.user, empresaId, personaId)) {
    return res.status(403).json({ error: 'Sin acceso a este documento' })
  }

  const data = {}
  for (const campo of ['nombre', 'descripcion', 'version', 'fecha_emision', 'tipo_id']) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (data.tipo_id) {
    const tipo = await db('documento_tipos').where('id', data.tipo_id).where('activo', true).first()
    if (!tipo) return res.status(400).json({ error: 'Tipo de documento no válido' })
  }
  if (esStaff(req.user) && req.body.estatus !== undefined) {
    if (!DOC_ESTATUS.includes(req.body.estatus)) {
      return res.status(400).json({ error: 'Estatus no válido' })
    }
    data.estatus = req.body.estatus
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' })
  }

  let notificationRows = []
  const documento = await db.transaction(async trx => {
    await trx('documentos').where('id', doc.id).update(data)

    if (esStaff(req.user) && data.estatus && data.estatus !== doc.estatus) {
      const userId = empresaId
        ? (await trx('empresas').select('user_id').where('id', empresaId).first())?.user_id
        : personaId
          ? (await trx('personas').select('user_id').where('id', personaId).first())?.user_id
          : null
      const labels = {
        recibido: 'Recibido',
        en_revision: 'En revisión',
        aprobado: 'Aprobado',
        rechazado: 'Rechazado',
      }
      notificationRows = await createNotifications(trx, userId ? [userId] : [], {
        titulo: 'Estado de documento actualizado',
        mensaje: `El estado del documento #${doc.id} cambió a: ${labels[data.estatus]}.`,
        tipo: 'documento',
        url: '/admin/documentos',
      })
    }

    return trx('documentos').where('id', doc.id).first()
  })

  publishNotifications(notificationRows)
  res.json({ documento })
}

// GET /documentos?empresa_id= | ?empleado_id= | ?nomina_id= ... | ?all=1 (admin)
export async function list(req, res) {
  const ownerCol = OWNERS.find(o => req.query[o])
  const wantAll = esStaff(req.user) && ['1', 'true'].includes(String(req.query.all))
  if (!ownerCol && !wantAll) {
    return res.status(400).json({ error: `Indique filtro: ${OWNERS.join(', ')}` })
  }

  if (ownerCol) {
    const { empresaId, personaId } = await duenoDeDoc(ownerCol, req.query[ownerCol])
    if (!canAccessDoc(req.user, empresaId, personaId)) {
      return res.status(403).json({ error: 'Sin acceso a este recurso' })
    }
  }

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 25))
  const base = db('documentos')
    .leftJoin('documento_tipos', 'documentos.tipo_id', 'documento_tipos.id')
    .leftJoin('empresas as e', 'documentos.empresa_id', 'e.id')
    .leftJoin('personas as p', 'documentos.persona_id', 'p.id')
    .leftJoin('empleados as em', 'documentos.empleado_id', 'em.id')
    .leftJoin('empresas as e2', 'em.empresa_id', 'e2.id')
    .leftJoin('nominas as n', 'documentos.nomina_id', 'n.id')
    .leftJoin('empresas as e3', 'n.empresa_id', 'e3.id')
    .leftJoin('planillas as pl', 'documentos.planilla_id', 'pl.id')
    .leftJoin('empresas as e4', 'pl.empresa_id', 'e4.id')
  if (ownerCol) base.where(`documentos.${ownerCol}`, req.query[ownerCol])
  if (req.query.tipo_id) base.where('documentos.tipo_id', req.query.tipo_id)
  if (req.query.search) {
    const term = `%${String(req.query.search).trim()}%`
    base.where(q => q
      .where('documentos.nombre', 'like', term)
      .orWhere('documento_tipos.nombre', 'like', term)
      .orWhere('e.razon_social', 'like', term)
      .orWhere('e2.razon_social', 'like', term)
      .orWhere('e3.razon_social', 'like', term)
      .orWhere('e4.razon_social', 'like', term)
      .orWhereRaw("CONCAT_WS(' ', p.primer_nombre, p.primer_apellido) LIKE ?", [term]))
  }

  const [{ total }] = await base.clone().countDistinct({ total: 'documentos.id' })
  const data = await base.clone()
    .select('documentos.*', 'documento_tipos.nombre as tipo_nombre',
      db.raw(`COALESCE(
        e.razon_social, e2.razon_social, e3.razon_social, e4.razon_social,
        CONCAT_WS(' ', p.primer_nombre, p.primer_apellido)
      ) as cliente_nombre`))
    .orderBy('documentos.id', 'desc')
    .limit(perPage)
    .offset((page - 1) * perPage)

  res.json({ data, total: Number(total), page, per_page: perPage })
}

// GET /documentos/:id/download - descarga autenticada y autorizada
export async function download(req, res) {
  const doc = await db('documentos').where('id', req.params.id).first()
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  const ownerCol = OWNERS.find(o => doc[o])
  const { empresaId, personaId } = ownerCol
    ? await duenoDeDoc(ownerCol, doc[ownerCol])
    : { empresaId: null, personaId: null }
  if (!canAccessDoc(req.user, empresaId, personaId)) {
    return res.status(403).json({ error: 'Sin acceso a este documento' })
  }

  const fullPath = resolve(STORAGE_DIR, doc.path)
  if (!fullPath.startsWith(STORAGE_DIR) || !existsSync(fullPath)) {
    return res.status(404).json({ error: 'Archivo no disponible' })
  }

  res.setHeader('Content-Type', doc.mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${doc.nombre}"`)
  createReadStream(fullPath).pipe(res)
}

// DELETE /documentos/:id
export async function remove(req, res) {
  const doc = await db('documentos').where('id', req.params.id).first()
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  const ownerCol = OWNERS.find(o => doc[o])
  const { empresaId, personaId } = ownerCol
    ? await duenoDeDoc(ownerCol, doc[ownerCol])
    : { empresaId: null, personaId: null }
  if (!canAccessDoc(req.user, empresaId, personaId)) {
    return res.status(403).json({ error: 'Sin acceso a este documento' })
  }

  let notificationRows = []
  await db.transaction(async trx => {
    await trx('documentos').where('id', doc.id).delete()

    if (!esStaff(req.user)) {
      const admins = await trx('users').select('id').where('role', 'admin').where('is_active', true)
      notificationRows = await createNotifications(trx, admins.map(a => a.id), {
        titulo: 'Documento eliminado por un cliente',
        mensaje: `Un cliente eliminó el documento #${doc.id}.`,
        tipo: 'documento',
        url: '/admin/documentos',
      })
    }
  })

  const fullPath = resolve(STORAGE_DIR, doc.path)
  if (fullPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(fullPath)) {
    unlinkSync(fullPath)
  }

  publishNotifications(notificationRows)
  res.json({ message: 'Documento eliminado' })
}

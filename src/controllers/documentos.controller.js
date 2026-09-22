import db from '../db/knex.js'
import { resolve } from 'path'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { canAccessEmpresa } from '../middlewares/auth.js'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

// Tipos de owner permitidos (una sola FK llena por documento)
const OWNERS = ['empresa_id', 'empleado_id', 'persona_id', 'beneficiado_id', 'planilla_id', 'nomina_id']

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

// POST /documentos - sube archivo al storage privado (auth requerido)
export async function uploadDoc(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })

  const { nombre, descripcion, servicio_id } = req.body
  const ownerCol = OWNERS.find(o => req.body[o])

  if (!ownerCol) {
    unlinkSync(req.file.path)
    return res.status(400).json({ error: `Indique el owner: ${OWNERS.join(', ')}` })
  }

  // Verificar que el usuario pueda subir a ese owner
  const empresaId = await empresaDeOwner(ownerCol, req.body[ownerCol])
  if (empresaId !== null && !canAccessEmpresa(req.user, empresaId)) {
    unlinkSync(req.file.path)
    return res.status(403).json({ error: 'Sin acceso a este recurso' })
  }

  const [id] = await db('documentos').insert({
    [ownerCol]: Number(req.body[ownerCol]),
    servicio_id: servicio_id || null,
    uploaded_by: req.user.id,
    nombre: nombre || req.file.originalname,
    descripcion: descripcion || null,
    path: req.file.filename,
    mime: req.file.mimetype,
    size: req.file.size,
  })

  const documento = await db('documentos').where('id', id).first()
  res.status(201).json({ documento })
}

// GET /documentos?empresa_id= | ?empleado_id= | ?nomina_id= ...
export async function list(req, res) {
  const ownerCol = OWNERS.find(o => req.query[o])
  if (!ownerCol) {
    return res.status(400).json({ error: `Indique filtro: ${OWNERS.join(', ')}` })
  }

  const empresaId = await empresaDeOwner(ownerCol, req.query[ownerCol])
  if (empresaId !== null && !canAccessEmpresa(req.user, empresaId)) {
    return res.status(403).json({ error: 'Sin acceso a este recurso' })
  }

  const data = await db('documentos')
    .where(ownerCol, req.query[ownerCol])
    .orderBy('id', 'desc')

  res.json({ data })
}

// GET /documentos/:id/download - descarga autenticada y autorizada
export async function download(req, res) {
  const doc = await db('documentos').where('id', req.params.id).first()
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  const ownerCol = OWNERS.find(o => doc[o])
  const empresaId = ownerCol ? await empresaDeOwner(ownerCol, doc[ownerCol]) : null
  if (empresaId !== null && !canAccessEmpresa(req.user, empresaId)) {
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
  const empresaId = ownerCol ? await empresaDeOwner(ownerCol, doc[ownerCol]) : null
  if (empresaId !== null && !canAccessEmpresa(req.user, empresaId)) {
    return res.status(403).json({ error: 'Sin acceso a este documento' })
  }

  await db('documentos').where('id', doc.id).delete()
  const fullPath = resolve(STORAGE_DIR, doc.path)
  if (existsSync(fullPath)) unlinkSync(fullPath)

  res.json({ message: 'Documento eliminado' })
}

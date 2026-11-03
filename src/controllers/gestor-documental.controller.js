import db from '../db/knex.js'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync, createReadStream } from 'fs'
import { resolve, sep } from 'path'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

function empresaIdPermitida(req, requestedId) {
  if (req.user.role === 'empresa') {
    return req.user.empresa_id ? Number(req.user.empresa_id) : null
  }
  if (esStaff(req.user)) {
    const id = Number(requestedId)
    return Number.isInteger(id) && id > 0 ? id : null
  }
  return null
}

async function validarEmpresa(req, res, requestedId) {
  const empresaId = empresaIdPermitida(req, requestedId)
  if (!empresaId) {
    res.status(400).json({ error: 'Indique una empresa válida' })
    return null
  }
  if (!canAccessEmpresa(req.user, empresaId)) {
    res.status(403).json({ error: 'Sin acceso a esta empresa' })
    return null
  }
  const empresa = await db('empresas').where('id', empresaId).first('id')
  if (!empresa) {
    res.status(404).json({ error: 'Empresa no encontrada' })
    return null
  }
  return empresaId
}

async function carpetaDeEmpresa(carpetaId, empresaId) {
  if (!carpetaId) return null
  return db('gestor_documental_carpetas')
    .where({ id: carpetaId, empresa_id: empresaId })
    .first()
}

export async function listTypes(req, res) {
  const data = await db('documento_tipos')
    .where('activo', true)
    .orderBy([{ column: 'orden' }, { column: 'nombre' }])
  res.json({ data })
}

export async function listFolders(req, res) {
  const empresaId = await validarEmpresa(req, res, req.query.empresa_id)
  if (!empresaId) return
  const query = db('gestor_documental_carpetas as f')
    .leftJoin('documentos as d', function () {
      this.on('d.gestor_carpeta_id', '=', 'f.id')
        .andOn('d.es_gestor_documental', '=', db.raw('?', [1]))
    })
    .where('f.empresa_id', empresaId)
    .select('f.id', 'f.empresa_id', 'f.parent_id', 'f.nombre', 'f.created_at')
    .countDistinct({ documentos_count: 'd.id' })
    .groupBy('f.id')
    .orderBy('f.nombre')
  res.json({ data: await query })
}

export async function createFolder(req, res) {
  const empresaId = await validarEmpresa(req, res, req.body.empresa_id)
  if (!empresaId) return
  const nombre = String(req.body.nombre || '').trim()
  if (!nombre || nombre.length > 120) {
    return res.status(400).json({ error: 'El nombre de la carpeta es obligatorio (máximo 120 caracteres)' })
  }
  const rawParentId = req.body.parent_id
  const parentId = rawParentId === undefined || rawParentId === null || rawParentId === ''
    ? null
    : Number(rawParentId)
  if (parentId !== null && (!Number.isInteger(parentId) || parentId < 1)) {
    return res.status(400).json({ error: 'La categoría principal no es válida' })
  }
  if (parentId && !await carpetaDeEmpresa(parentId, empresaId)) {
    return res.status(400).json({ error: 'La carpeta superior no pertenece a esta empresa' })
  }
  const duplicate = await db('gestor_documental_carpetas')
    .where({ empresa_id: empresaId, parent_id: parentId })
    .whereRaw('LOWER(nombre) = LOWER(?)', [nombre])
    .first()
  if (duplicate) return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en esta ubicación' })

  const [id] = await db('gestor_documental_carpetas').insert({
    empresa_id: empresaId,
    parent_id: parentId,
    nombre,
    created_by: req.user.id,
  })
  res.status(201).json({
    carpeta: await db('gestor_documental_carpetas').where('id', id).first(),
  })
}

export async function updateFolder(req, res) {
  const carpeta = await db('gestor_documental_carpetas').where('id', req.params.id).first()
  if (!carpeta) return res.status(404).json({ error: 'Carpeta no encontrada' })
  if (!canAccessEmpresa(req.user, carpeta.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta carpeta' })
  }

  const data = {}
  if (req.body.nombre !== undefined) {
    const nombre = String(req.body.nombre).trim()
    if (!nombre || nombre.length > 120) {
      return res.status(400).json({ error: 'El nombre debe tener entre 1 y 120 caracteres' })
    }
    data.nombre = nombre
  }
  if (req.body.parent_id !== undefined) {
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null
    if (parentId === Number(carpeta.id)) {
      return res.status(400).json({ error: 'Una carpeta no puede ser su propia carpeta superior' })
    }
    if (parentId && !await carpetaDeEmpresa(parentId, carpeta.empresa_id)) {
      return res.status(400).json({ error: 'La carpeta superior no pertenece a esta empresa' })
    }
    if (parentId) {
      const descendants = await db('gestor_documental_carpetas')
        .where({ empresa_id: carpeta.empresa_id })
        .select('id', 'parent_id')
      const descendantsByParent = new Map()
      for (const row of descendants) {
        const key = row.parent_id ?? 0
        descendantsByParent.set(key, [...(descendantsByParent.get(key) || []), Number(row.id)])
      }
      const pending = [Number(carpeta.id)]
      const visited = new Set(pending)
      while (pending.length) {
        const current = pending.pop()
        for (const child of descendantsByParent.get(current) || []) {
          if (!visited.has(child)) {
            visited.add(child)
            pending.push(child)
          }
        }
      }
      if (visited.has(parentId)) {
        return res.status(400).json({ error: 'No se puede mover la carpeta dentro de una subcarpeta propia' })
      }
    }
    data.parent_id = parentId
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })

  if (data.nombre !== undefined || data.parent_id !== undefined) {
    const duplicate = await db('gestor_documental_carpetas')
      .where({
        empresa_id: carpeta.empresa_id,
        parent_id: data.parent_id !== undefined ? data.parent_id : carpeta.parent_id,
      })
      .whereNot('id', carpeta.id)
      .whereRaw('LOWER(nombre) = LOWER(?)', [data.nombre ?? carpeta.nombre])
      .first()
    if (duplicate) return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en esta ubicación' })
  }

  await db('gestor_documental_carpetas').where('id', carpeta.id).update(data)
  res.json({ carpeta: await db('gestor_documental_carpetas').where('id', carpeta.id).first() })
}

export async function deleteFolder(req, res) {
  const carpeta = await db('gestor_documental_carpetas').where('id', req.params.id).first()
  if (!carpeta) return res.status(404).json({ error: 'Carpeta no encontrada' })
  if (!canAccessEmpresa(req.user, carpeta.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta carpeta' })
  }
  const [child, documento] = await Promise.all([
    db('gestor_documental_carpetas').where('parent_id', carpeta.id).first('id'),
    db('documentos').where({ gestor_carpeta_id: carpeta.id, es_gestor_documental: true }).first('id'),
  ])
  if (child || documento) {
    return res.status(409).json({ error: 'La carpeta debe estar vacía antes de eliminarla' })
  }
  await db('gestor_documental_carpetas').where('id', carpeta.id).delete()
  res.json({ message: 'Carpeta eliminada' })
}

export async function listDocuments(req, res) {
  const empresaId = await validarEmpresa(req, res, req.query.empresa_id)
  if (!empresaId) return
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 25))
  const query = db('documentos')
    .leftJoin('documento_tipos as t', 'documentos.tipo_id', 't.id')
    .leftJoin('gestor_documental_carpetas as c', 'documentos.gestor_carpeta_id', 'c.id')
    .where('documentos.empresa_id', empresaId)
    .where('documentos.es_gestor_documental', true)
  if (req.query.carpeta_id === 'root') query.whereNull('documentos.gestor_carpeta_id')
  else if (req.query.carpeta_id) query.where('documentos.gestor_carpeta_id', Number(req.query.carpeta_id))
  if (req.query.tipo_id) query.where('documentos.tipo_id', Number(req.query.tipo_id))
  if (req.query.search) {
    const term = `%${String(req.query.search).trim()}%`
    query.where(q => q.where('documentos.nombre', 'like', term)
      .orWhere('documentos.descripcion', 'like', term)
      .orWhere('t.nombre', 'like', term))
  }
  if (req.query.desde) query.where('documentos.created_at', '>=', `${req.query.desde} 00:00:00`)
  if (req.query.hasta) query.where('documentos.created_at', '<=', `${req.query.hasta} 23:59:59`)

  const [{ total }] = await query.clone().countDistinct({ total: 'documentos.id' })
  const data = await query.clone()
    .select('documentos.*', 't.nombre as tipo_nombre', 'c.nombre as carpeta_nombre')
    .orderBy('documentos.created_at', 'desc')
    .limit(perPage)
    .offset((page - 1) * perPage)
  res.json({ data, total: Number(total), page, per_page: perPage })
}

export async function uploadDocument(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })
  const empresaId = await validarEmpresa(req, res, req.body.empresa_id)
  if (!empresaId) {
    unlinkSync(req.file.path)
    return
  }
  const carpetaId = req.body.carpeta_id ? Number(req.body.carpeta_id) : null
  if (carpetaId && !await carpetaDeEmpresa(carpetaId, empresaId)) {
    unlinkSync(req.file.path)
    return res.status(400).json({ error: 'La carpeta no pertenece a esta empresa' })
  }
  const tipoId = req.body.tipo_id ? Number(req.body.tipo_id) : null
  if (tipoId && !await db('documento_tipos').where({ id: tipoId, activo: true }).first('id')) {
    unlinkSync(req.file.path)
    return res.status(400).json({ error: 'Tipo de documento no válido' })
  }
  const nombre = String(req.body.nombre || req.file.originalname).trim().slice(0, 255)
  let id
  try {
    const insertedIds = await db('documentos').insert({
      empresa_id: empresaId,
      gestor_carpeta_id: carpetaId,
      es_gestor_documental: true,
      tipo_id: tipoId,
      version: req.body.version ? String(req.body.version).slice(0, 30) : null,
      fecha_emision: req.body.fecha_emision || null,
      estatus: 'recibido',
      uploaded_by: req.user.id,
      nombre,
      descripcion: req.body.descripcion ? String(req.body.descripcion).slice(0, 255) : null,
      path: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
    })
    id = insertedIds[0]
  } catch (error) {
    if (existsSync(req.file.path)) unlinkSync(req.file.path)
    throw error
  }
  res.status(201).json({
    documento: await db('documentos')
      .leftJoin('documento_tipos as t', 'documentos.tipo_id', 't.id')
      .select('documentos.*', 't.nombre as tipo_nombre')
      .where('documentos.id', id).first(),
  })
}

async function getOwnedDocument(req, res) {
  const documento = await db('documentos')
    .where({ id: req.params.id, es_gestor_documental: true })
    .first()
  if (!documento) {
    res.status(404).json({ error: 'Documento no encontrado' })
    return null
  }
  if (!canAccessEmpresa(req.user, documento.empresa_id)) {
    res.status(403).json({ error: 'Sin acceso a este documento' })
    return null
  }
  return documento
}

export async function downloadDocument(req, res) {
  const documento = await getOwnedDocument(req, res)
  if (!documento) return
  const fullPath = resolve(STORAGE_DIR, documento.path)
  if (!fullPath.startsWith(`${STORAGE_DIR}${sep}`) || !existsSync(fullPath)) {
    return res.status(404).json({ error: 'Archivo no disponible' })
  }
  res.setHeader('Content-Type', documento.mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(documento.nombre)}`)
  createReadStream(fullPath).pipe(res)
}

export async function updateDocument(req, res) {
  const documento = await getOwnedDocument(req, res)
  if (!documento) return
  const data = {}
  for (const field of ['nombre', 'descripcion', 'version', 'fecha_emision', 'tipo_id']) {
    if (req.body[field] !== undefined) data[field] = req.body[field] || null
  }
  if (data.nombre !== undefined) {
    data.nombre = String(data.nombre).trim().slice(0, 255)
    if (!data.nombre) return res.status(400).json({ error: 'El nombre es obligatorio' })
  }
  if (data.descripcion !== undefined) data.descripcion = String(data.descripcion).slice(0, 255)
  if (data.tipo_id) {
    const tipo = await db('documento_tipos').where({ id: data.tipo_id, activo: true }).first('id')
    if (!tipo) return res.status(400).json({ error: 'Tipo de documento no válido' })
    data.tipo_id = Number(data.tipo_id)
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })
  await db('documentos').where('id', documento.id).update(data)
  res.json({ documento: await db('documentos').where('id', documento.id).first() })
}

export async function deleteDocument(req, res) {
  const documento = await getOwnedDocument(req, res)
  if (!documento) return
  await db('documentos').where('id', documento.id).delete()
  const fullPath = resolve(STORAGE_DIR, documento.path)
  if (fullPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(fullPath)) unlinkSync(fullPath)
  res.json({ message: 'Documento eliminado' })
}

export async function listCatalog(req, res) {
  const empresaId = await validarEmpresa(req, res, req.query.empresa_id)
  if (!empresaId) return
  const [categorias, catalogo, archivos] = await Promise.all([
    db('gestor_documental_categorias').where('activo', true).orderBy('orden'),
    db('gestor_documental_catalogo as c')
      .join('gestor_documental_categorias as k', 'k.id', 'c.categoria_id')
      .where('c.activo', true)
      .where('k.activo', true)
      .select(
        'c.id', 'c.categoria_id', 'c.nombre', 'c.orden',
        'c.borrador_nombre', 'c.borrador_publicado',
        db.raw('CASE WHEN c.borrador_path IS NULL THEN 0 ELSE 1 END as tiene_borrador')
      )
      .orderBy([{ column: 'k.orden' }, { column: 'c.orden' }]),
    db('gestor_documental_archivos')
      .where('empresa_id', empresaId)
      .select('id', 'catalogo_id', 'nombre', 'created_at')
      .orderBy('id', 'desc'),
  ])
  const ultimoArchivo = new Map()
  for (const archivo of archivos) {
    if (!ultimoArchivo.has(Number(archivo.catalogo_id))) {
      ultimoArchivo.set(Number(archivo.catalogo_id), archivo)
    }
  }
  res.json({
    empresa_id: empresaId,
    categorias,
    documentos: catalogo.map(documento => {
      const archivo = ultimoArchivo.get(Number(documento.id))
      const draftVisible = esStaff(req.user) || !!documento.borrador_publicado
      return {
        ...documento,
        tiene_borrador: !!documento.tiene_borrador && draftVisible,
        borrador_nombre: draftVisible ? documento.borrador_nombre : null,
        borrador_publicado: !!documento.borrador_publicado,
        archivo_id: archivo?.id ?? null,
        archivo_nombre: archivo?.nombre ?? null,
        archivo_fecha: archivo?.created_at ?? null,
        cargado: !!archivo,
      }
    }),
  })
}

export async function listAdminCatalog(req, res) {
  const [categorias, documentos] = await Promise.all([
    db('gestor_documental_categorias').orderBy('orden'),
    db('gestor_documental_catalogo')
      .select(
        'id', 'source_code', 'categoria_id', 'nombre', 'orden', 'activo',
        'borrador_nombre', 'borrador_mime', 'borrador_size', 'borrador_publicado',
        db.raw('CASE WHEN borrador_path IS NULL THEN 0 ELSE 1 END as tiene_borrador')
      )
      .orderBy([{ column: 'categoria_id' }, { column: 'orden' }]),
  ])
  res.json({
    categorias,
    documentos: documentos.map(d => ({
      ...d,
      activo: !!d.activo,
      borrador_publicado: !!d.borrador_publicado,
      tiene_borrador: !!d.tiene_borrador,
    })),
  })
}

export async function createCatalogCategory(req, res) {
  const nombre = String(req.body.nombre || '').trim()
  if (!nombre || nombre.length > 255) {
    return res.status(400).json({ error: 'El nombre debe tener entre 1 y 255 caracteres' })
  }
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null
  if (parentId) {
    const parent = await db('gestor_documental_categorias')
      .where({ id: parentId, activo: true })
      .first('id', 'parent_id')
    if (!parent) return res.status(404).json({ error: 'Categoría principal no encontrada' })
    if (parent.parent_id !== null) {
      return res.status(400).json({ error: 'Las subcategorías deben depender de una categoría principal' })
    }
  }
  const duplicateQuery = db('gestor_documental_categorias')
    .where('activo', true)
    .whereRaw('LOWER(nombre) = LOWER(?)', [nombre])
  if (parentId) duplicateQuery.where('parent_id', parentId)
  else duplicateQuery.whereNull('parent_id')
  if (await duplicateQuery.first('id')) {
    return res.status(409).json({ error: 'Ya existe una categoría con ese nombre en esta ubicación' })
  }

  const orderQuery = db('gestor_documental_categorias').max({ max: 'orden' })
  if (parentId) orderQuery.where('parent_id', parentId)
  else orderQuery.whereNull('parent_id')
  const { max } = await orderQuery.first()
  const [id] = await db('gestor_documental_categorias').insert({
    codigo: `manual-${randomUUID()}`,
    numero: null,
    parent_id: parentId,
    nombre,
    orden: Number(max || 0) + 1,
    activo: true,
  })
  res.status(201).json({
    categoria: await db('gestor_documental_categorias').where('id', id).first(),
  })
}

export async function updateCatalogDocument(req, res) {
  const documento = await db('gestor_documental_catalogo').where('id', req.params.id).first()
  if (!documento) return res.status(404).json({ error: 'Documento del catálogo no encontrado' })
  const data = {}
  if (req.body.nombre !== undefined) {
    const nombre = String(req.body.nombre).trim()
    if (!nombre || nombre.length > 255) {
      return res.status(400).json({ error: 'El nombre debe tener entre 1 y 255 caracteres' })
    }
    data.nombre = nombre
  }
  if (req.body.activo !== undefined) data.activo = ['1', 'true', 'on'].includes(String(req.body.activo))
  if (req.body.borrador_publicado !== undefined) {
    if (!documento.borrador_path) {
      return res.status(409).json({ error: 'Carga primero el borrador para poder publicarlo' })
    }
    data.borrador_publicado = ['1', 'true', 'on'].includes(String(req.body.borrador_publicado))
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada que actualizar' })
  data.updated_at = db.fn.now()
  await db('gestor_documental_catalogo').where('id', documento.id).update(data)
  res.json({ documento: await db('gestor_documental_catalogo').where('id', documento.id)
    .select('id', 'categoria_id', 'nombre', 'activo', 'borrador_nombre', 'borrador_publicado').first() })
}

export async function uploadDraft(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Archivo borrador requerido' })
  const documento = await db('gestor_documental_catalogo').where('id', req.params.id).first()
  if (!documento) {
    unlinkSync(req.file.path)
    return res.status(404).json({ error: 'Documento del catálogo no encontrado' })
  }
  const publicado = req.body.borrador_publicado === undefined
    ? !!documento.borrador_publicado
    : ['1', 'true', 'on'].includes(String(req.body.borrador_publicado))
  const anterior = documento.borrador_path
  try {
    await db('gestor_documental_catalogo').where('id', documento.id).update({
      borrador_path: req.file.filename,
      borrador_nombre: req.file.originalname.slice(0, 255),
      borrador_mime: req.file.mimetype,
      borrador_size: req.file.size,
      borrador_publicado: publicado,
      actualizado_por: req.user.id,
      updated_at: db.fn.now(),
    })
  } catch (error) {
    if (existsSync(req.file.path)) unlinkSync(req.file.path)
    throw error
  }
  if (anterior) {
    const previousPath = resolve(STORAGE_DIR, anterior)
    if (previousPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(previousPath)) unlinkSync(previousPath)
  }
  res.json({ message: 'Borrador actualizado' })
}

async function getDraft(req, res) {
  const documento = await db('gestor_documental_catalogo').where('id', req.params.id).first()
  if (!documento?.borrador_path) {
    res.status(404).json({ error: 'No hay borrador disponible' })
    return null
  }
  if (req.user.role === 'empresa' && !documento.borrador_publicado) {
    res.status(403).json({ error: 'Este borrador todavía no está disponible para clientes' })
    return null
  }
  return documento
}

export async function downloadDraft(req, res) {
  const documento = await getDraft(req, res)
  if (!documento) return
  const fullPath = resolve(STORAGE_DIR, documento.borrador_path)
  if (!fullPath.startsWith(`${STORAGE_DIR}${sep}`) || !existsSync(fullPath)) {
    return res.status(404).json({ error: 'Archivo borrador no disponible' })
  }
  res.setHeader('Content-Type', documento.borrador_mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(documento.borrador_nombre || 'borrador')}`)
  createReadStream(fullPath).pipe(res)
}

export async function uploadCatalogDocument(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })
  const empresaId = await validarEmpresa(req, res, req.body.empresa_id)
  if (!empresaId) {
    unlinkSync(req.file.path)
    return
  }
  const item = await db('gestor_documental_catalogo')
    .where({ id: req.params.id, activo: true })
    .first('id')
  if (!item) {
    unlinkSync(req.file.path)
    return res.status(404).json({ error: 'Documento del catálogo no disponible' })
  }
  let id
  try {
    const inserted = await db('gestor_documental_archivos').insert({
      empresa_id: empresaId,
      catalogo_id: item.id,
      uploaded_by: req.user.id,
      nombre: String(req.body.nombre || req.file.originalname).trim().slice(0, 255),
      path: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
    })
    id = inserted[0]
  } catch (error) {
    if (existsSync(req.file.path)) unlinkSync(req.file.path)
    throw error
  }
  res.status(201).json({
    archivo: await db('gestor_documental_archivos')
      .where('id', id)
      .select('id', 'empresa_id', 'catalogo_id', 'nombre', 'created_at')
      .first(),
  })
}

async function getCompanyFile(req, res) {
  const archivo = await db('gestor_documental_archivos').where('id', req.params.id).first()
  if (!archivo) {
    res.status(404).json({ error: 'Archivo no encontrado' })
    return null
  }
  if (!canAccessEmpresa(req.user, archivo.empresa_id)) {
    res.status(403).json({ error: 'Sin acceso a este archivo' })
    return null
  }
  return archivo
}

export async function downloadCatalogDocument(req, res) {
  const archivo = await getCompanyFile(req, res)
  if (!archivo) return
  const fullPath = resolve(STORAGE_DIR, archivo.path)
  if (!fullPath.startsWith(`${STORAGE_DIR}${sep}`) || !existsSync(fullPath)) {
    return res.status(404).json({ error: 'Archivo no disponible' })
  }
  res.setHeader('Content-Type', archivo.mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`)
  createReadStream(fullPath).pipe(res)
}

export async function createCatalogRequest(req, res) {
  const empresaId = await validarEmpresa(req, res, req.body.empresa_id)
  if (!empresaId) return
  const tipo = req.body.tipo_solicitud
  if (!['gestor_paquete', 'gestor_documento'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de solicitud documental inválido' })
  }
  let categoriaId
  let catalogoId = null
  let descripcion
  if (tipo === 'gestor_paquete') {
    const categoria = await db('gestor_documental_categorias')
      .where({ id: req.body.categoria_id, activo: true }).first()
    if (!categoria) return res.status(404).json({ error: 'Categoría no encontrada' })
    categoriaId = categoria.id
    const categorias = await db('gestor_documental_categorias').where('activo', true).select('id', 'parent_id')
    const children = new Map()
    for (const row of categorias) {
      const parent = Number(row.parent_id) || 0
      children.set(parent, [...(children.get(parent) || []), Number(row.id)])
    }
    const ids = new Set([Number(categoria.id)])
    const pending = [Number(categoria.id)]
    while (pending.length) {
      for (const child of children.get(pending.pop()) || []) {
        if (!ids.has(child)) {
          ids.add(child)
          pending.push(child)
        }
      }
    }
    const total = await db('gestor_documental_catalogo')
      .whereIn('categoria_id', [...ids])
      .where('activo', true)
      .count({ total: '*' }).first()
    descripcion = `Gestor Documental - Elaboración solicitada: paquete ${categoria.nombre} (${total.total} documentos)`
  } else {
    const documento = await db('gestor_documental_catalogo as d')
      .join('gestor_documental_categorias as c', 'c.id', 'd.categoria_id')
      .where('d.id', req.body.catalogo_id)
      .where('d.activo', true)
      .where('c.activo', true)
      .select('d.id', 'd.categoria_id', 'd.nombre', 'c.nombre as categoria_nombre')
      .first()
    if (!documento) return res.status(404).json({ error: 'Documento no encontrado' })
    categoriaId = documento.categoria_id
    catalogoId = documento.id
    descripcion = `Gestor Documental - Elaboración solicitada: ${documento.nombre} (${documento.categoria_nombre})`
  }

  let notificationRows = []
  const solicitud = await db.transaction(async trx => {
    const [id] = await trx('solicitudes').insert({
      empresa_id: empresaId,
      tipo_solicitud: tipo,
      gestor_categoria_id: categoriaId,
      gestor_catalogo_id: catalogoId,
      solicitado_por: req.user.id,
      descripcion,
      status: 'pendiente',
    })
    const admins = await trx('users').select('id').where('role', 'admin').where('is_active', true)
    notificationRows = await createNotifications(trx, admins.map(admin => admin.id), {
      titulo: 'Solicitud de elaboración documental',
      mensaje: `${descripcion} — ${req.user.email}`,
      tipo: 'solicitud',
      solicitudId: id,
      url: '/admin/solicitudes',
    })
    return trx('solicitudes').where('id', id).first()
  })
  publishNotifications(notificationRows)
  res.status(201).json({ solicitud })
}

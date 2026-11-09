import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { api, loginAs, startApp, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'
import { requireModulo } from '../src/middlewares/auth.js'

const folderIds = []
const categoryIds = []
const documentIds = []
const uploadedPaths = []
const userIds = []
const solicitudIds = []
const archivoIds = []
const uploadedDrafts = []
let companyLinkSnapshot

async function uploadDocument(token, fields) {
  const base = await startApp()
  const form = new FormData()
  form.append('file', new Blob(['documento de gestor de prueba'], { type: 'application/pdf' }), 'gestor-prueba.pdf')
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
  const response = await fetch(`${base}/gestor-documental/documentos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}

async function uploadSolicitudGestor(token, solicitudId, catalogoId) {
  const base = await startApp()
  const form = new FormData()
  form.append('file', new Blob(['documento entregado por SoyAsesorias'], { type: 'application/pdf' }), 'entrega-paquete.pdf')
  const response = await fetch(`${base}/solicitudes/${solicitudId}/gestor-documentos/${catalogoId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}

test('admin organiza carpetas y archivos del gestor documental con validacion de carpeta', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await db('empresas').first('id')
  assert.ok(empresa, 'debe existir una empresa para probar')

  const created = await api.post('/gestor-documental/carpetas', {
    empresa_id: empresa.id,
    nombre: `Carpeta prueba ${Date.now()}`,
  }, { token: admin.token })
  assert.equal(created.status, 201)
  const folderId = created.data.carpeta.id
  folderIds.push(folderId)

  const duplicate = await api.post('/gestor-documental/carpetas', {
    empresa_id: empresa.id,
    nombre: created.data.carpeta.nombre,
  }, { token: admin.token })
  assert.equal(duplicate.status, 409)

  const listedFolders = await api.get(`/gestor-documental/carpetas?empresa_id=${empresa.id}`, { token: admin.token })
  assert.equal(listedFolders.status, 200)
  assert.ok(listedFolders.data.data.some(folder => folder.id === folderId))

  const uploaded = await uploadDocument(admin.token, {
    empresa_id: empresa.id,
    carpeta_id: folderId,
    nombre: 'Circular de prueba',
    version: '1.0',
  })
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data))
  const document = uploaded.data.documento
  documentIds.push(document.id)
  const fullPath = resolve(process.env.STORAGE_DIR || 'storage/documentos', document.path)
  uploadedPaths.push(fullPath)
  assert.equal(document.es_gestor_documental, 1)

  const listedDocs = await api.get(
    `/gestor-documental/documentos?empresa_id=${empresa.id}&carpeta_id=${folderId}`,
    { token: admin.token }
  )
  assert.equal(listedDocs.status, 200)
  assert.equal(listedDocs.data.data[0].id, document.id)

  const renamed = await api.put(`/gestor-documental/documentos/${document.id}`, {
    nombre: 'Circular archivada',
  }, { token: admin.token })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.data.documento.nombre, 'Circular archivada')

  const cannotDeleteNonEmpty = await api.delete(`/gestor-documental/carpetas/${folderId}`, { token: admin.token })
  assert.equal(cannotDeleteNonEmpty.status, 409)

  const download = await fetch(`${await startApp()}/gestor-documental/documentos/${document.id}/download`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  })
  assert.equal(download.status, 200)
  assert.equal(await download.text(), 'documento de gestor de prueba')

  const removed = await api.delete(`/gestor-documental/documentos/${document.id}`, { token: admin.token })
  assert.equal(removed.status, 200)
  documentIds.pop()
  assert.equal(existsSync(fullPath), false)

  const deletedFolder = await api.delete(`/gestor-documental/carpetas/${folderId}`, { token: admin.token })
  assert.equal(deletedFolder.status, 200)
  folderIds.pop()
})

test('los permisos de módulos nuevos se guardan de forma dinámica y los aplica la API', async () => {
  const admin = await loginAs(ADMIN)
  const email = `gestor.modulos.${Date.now()}@prueba.local`
  const created = await api.post('/auth/users', {
    name: 'Asesor prueba Gestor',
    email,
    password: 'PruebaSegura123',
    role: 'asesor',
    modulos: {
      gestor_documental: false,
      modulo_futuro_prueba: true,
    },
  }, { token: admin.token })
  assert.equal(created.status, 201)
  const userId = created.data.user.id
  userIds.push(userId)

  const saved = await api.get(`/usuarios/${userId}`, { token: admin.token })
  assert.equal(!!saved.data.modulos.gestor_documental, false)
  assert.equal(saved.data.modulos.modulo_futuro_prueba, true)

  const login = await api.post('/auth/login', { email, password: 'PruebaSegura123' })
  assert.equal(login.status, 200)
  const empresa = await db('empresas').first('id')
  const denied = await api.get(`/gestor-documental/carpetas?empresa_id=${empresa.id}`, { token: login.data.token })
  assert.equal(denied.status, 403)

  const enabled = await api.put(`/usuarios/${userId}`, {
    modulos: { gestor_documental: true },
  }, { token: admin.token })
  assert.equal(enabled.status, 200)
  const allowed = await api.get(`/gestor-documental/carpetas?empresa_id=${empresa.id}`, { token: login.data.token })
  assert.equal(allowed.status, 200)
})

test('Gestor Documental exige permiso explícito a cuentas antiguas sin configuración', () => {
  let status
  let payload
  let passed = false
  const response = {
    status(code) {
      status = code
      return this
    },
    json(body) {
      payload = body
      return this
    },
  }
  requireModulo('gestor_documental')({
    user: { id: 9999, role: 'empresa', modulos: {} },
  }, response, () => { passed = true })

  assert.equal(passed, false)
  assert.equal(status, 403)
  assert.equal(payload.code, 'MODULO_NO_HABILITADO')
})

test('el administrador puede agregar categorías y varias subcategorías a una categoría existente', async () => {
  const admin = await loginAs(ADMIN)
  const suffix = Date.now()
  const root = await api.post('/gestor-documental/admin/categorias', {
    nombre: `Categoría adicional ${suffix}`,
  }, { token: admin.token })
  assert.equal(root.status, 201)
  assert.equal(root.data.categoria.parent_id, null)
  categoryIds.push(root.data.categoria.id)

  const firstSubcategory = await api.post('/gestor-documental/admin/categorias', {
    nombre: `Subcategoría A ${suffix}`,
    parent_id: root.data.categoria.id,
  }, { token: admin.token })
  assert.equal(firstSubcategory.status, 201)
  assert.equal(Number(firstSubcategory.data.categoria.parent_id), Number(root.data.categoria.id))
  categoryIds.push(firstSubcategory.data.categoria.id)

  const secondSubcategory = await api.post('/gestor-documental/admin/categorias', {
    nombre: `Subcategoría B ${suffix}`,
    parent_id: root.data.categoria.id,
  }, { token: admin.token })
  assert.equal(secondSubcategory.status, 201)
  assert.equal(Number(secondSubcategory.data.categoria.parent_id), Number(root.data.categoria.id))
  categoryIds.push(secondSubcategory.data.categoria.id)

  const duplicate = await api.post('/gestor-documental/admin/categorias', {
    nombre: `Subcategoría A ${suffix}`,
    parent_id: root.data.categoria.id,
  }, { token: admin.token })
  assert.equal(duplicate.status, 409)

  const nestedLevelNotSupported = await api.post('/gestor-documental/admin/categorias', {
    nombre: `Nivel no permitido ${suffix}`,
    parent_id: firstSubcategory.data.categoria.id,
  }, { token: admin.token })
  assert.equal(nestedLevelNotSupported.status, 400)

  const addedDocument = await api.post('/gestor-documental/admin/catalogo', {
    categoria_id: firstSubcategory.data.categoria.id,
    nombre: `Documento de subcategoría ${suffix}`,
  }, { token: admin.token })
  assert.equal(addedDocument.status, 201, JSON.stringify(addedDocument.data))
  const removed = await api.delete(
    `/gestor-documental/admin/categorias/${firstSubcategory.data.categoria.id}`,
    { token: admin.token }
  )
  assert.equal(removed.status, 200)
  assert.equal(removed.data.categorias_retiradas, 1)
  const archivedCategory = await db('gestor_documental_categorias')
    .where('id', firstSubcategory.data.categoria.id)
    .first()
  const archivedDocument = await db('gestor_documental_catalogo')
    .where('id', addedDocument.data.documento.id)
    .first()
  assert.equal(!!archivedCategory.activo, false)
  assert.equal(!!archivedDocument.activo, false)
  const visibleCatalog = await api.get('/gestor-documental/admin/catalogo', { token: admin.token })
  assert.equal(visibleCatalog.data.categorias.some(c => c.id === firstSubcategory.data.categoria.id), false)

  const secondDocument = await api.post('/gestor-documental/admin/catalogo', {
    categoria_id: secondSubcategory.data.categoria.id,
    nombre: `Documento para retirar ${suffix}`,
  }, { token: admin.token })
  assert.equal(secondDocument.status, 201)
  const retiredDocument = await api.put(
    `/gestor-documental/admin/catalogo/${secondDocument.data.documento.id}`,
    { activo: false },
    { token: admin.token }
  )
  assert.equal(retiredDocument.status, 200)
  const documentStillStored = await db('gestor_documental_catalogo')
    .where('id', secondDocument.data.documento.id)
    .first()
  assert.equal(!!documentStillStored.activo, false)
  const visibleAfterRetire = await api.get('/gestor-documental/admin/catalogo', { token: admin.token })
  assert.equal(visibleAfterRetire.data.documentos.some(d => d.id === secondDocument.data.documento.id), false)

  for (const id of [...categoryIds].reverse()) {
    await db('gestor_documental_categorias').where('id', id).delete()
  }
  categoryIds.length = 0
})

test('importa categorías del Excel y habilita un usuario aislado de Gestor Documental', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await db('empresas').first('id', 'user_id')
  assert.ok(empresa, 'debe existir una empresa para probar')
  companyLinkSnapshot = { id: empresa.id, user_id: empresa.user_id }

  const catalog = await api.get('/gestor-documental/admin/catalogo', { token: admin.token })
  assert.equal(catalog.status, 200)
  assert.equal(catalog.data.categorias.length, 23)
  assert.equal(catalog.data.documentos.length, 242)
  assert.equal(catalog.data.categorias.some(c => c.codigo === '0'), false)

  const adicionalesAdmin = await api.get('/gestor-documental/admin/catalogo?seccion=adicionales', { token: admin.token })
  assert.equal(adicionalesAdmin.status, 200)
  assert.equal(adicionalesAdmin.data.categorias.length, 1)
  assert.equal(adicionalesAdmin.data.documentos.length, 3)

  const email = `gestor.empresa.${Date.now()}@prueba.local`
  const created = await api.post('/auth/users', {
    name: 'Usuario Gestor Documental',
    email,
    password: 'GestorSeguro123',
    role: 'gestor_documental',
    empresa_id: empresa.id,
  }, { token: admin.token })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const userId = created.data.user.id
  userIds.push(userId)

  const linkedUser = await api.get(`/usuarios/${userId}`, { token: admin.token })
  assert.equal(linkedUser.data.user.perfil_acceso, 'gestor_documental')
  assert.equal(linkedUser.data.empresa.id, empresa.id)
  assert.equal(linkedUser.data.modulos.gestor_documental, 1)
  assert.equal(linkedUser.data.modulos.solicitudes, 1)
  assert.equal(!!linkedUser.data.modulos.home, false)
  assert.equal(!!linkedUser.data.modulos.nominas, false)
  assert.equal((await db('empresas').where('id', empresa.id).first()).user_id, companyLinkSnapshot.user_id)

  const login = await api.post('/auth/login', { email, password: 'GestorSeguro123' })
  assert.equal(login.status, 200)
  assert.equal(login.data.user.perfil_acceso, 'gestor_documental')
  assert.equal(login.data.user.empresa.id, empresa.id)
  const moduleData = await api.get(`/gestor-documental/catalogo?empresa_id=999999`, { token: login.data.token })
  assert.equal(moduleData.status, 200)
  assert.equal(moduleData.data.empresa_id, empresa.id, 'el tenant se fuerza a la empresa vinculada')
  assert.equal(moduleData.data.categorias.length, 23)
  assert.equal(moduleData.data.documentos.length, 242)

  const adicionalesCliente = await api.get('/gestor-documental/catalogo?seccion=adicionales', { token: login.data.token })
  assert.equal(adicionalesCliente.status, 200)
  assert.equal(adicionalesCliente.data.categorias.length, 1)
  assert.equal(adicionalesCliente.data.documentos.length, 3)
  const deniedPayroll = await api.get(`/nominas?empresa_id=${empresa.id}`, { token: login.data.token })
  assert.equal(deniedPayroll.status, 403)
  assert.equal((await api.get('/solicitudes', { token: login.data.token })).status, 200)

  const item = catalog.data.documentos.find(document => !document.tiene_borrador)
  assert.ok(item, 'debe haber un elemento sin borrador para la prueba')
  const oldDraft = await db('gestor_documental_catalogo').where('id', item.id)
    .select('borrador_path', 'borrador_nombre', 'borrador_mime', 'borrador_size', 'borrador_publicado')
    .first()
  const draftForm = new FormData()
  draftForm.append('file', new Blob(['borrador de referencia'], { type: 'application/pdf' }), 'borrador.pdf')
  const base = await startApp()
  const draftResponse = await fetch(`${base}/gestor-documental/admin/catalogo/${item.id}/borrador`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
    body: draftForm,
  })
  assert.equal(draftResponse.status, 200)
  const draftRow = await db('gestor_documental_catalogo').where('id', item.id).first()
  uploadedDrafts.push({ id: item.id, old: oldDraft, path: draftRow.borrador_path })

  const hiddenDraft = await fetch(`${base}/gestor-documental/catalogo/${item.id}/borrador`, {
    headers: { Authorization: `Bearer ${login.data.token}` },
  })
  assert.equal(hiddenDraft.status, 403)
  const publish = await api.put(`/gestor-documental/admin/catalogo/${item.id}`, {
    borrador_publicado: true,
  }, { token: admin.token })
  assert.equal(publish.status, 200)
  const publishedDraft = await fetch(`${base}/gestor-documental/catalogo/${item.id}/borrador`, {
    headers: { Authorization: `Bearer ${login.data.token}` },
  })
  assert.equal(publishedDraft.status, 200)
  assert.equal(await publishedDraft.text(), 'borrador de referencia')

  const uploadForm = new FormData()
  uploadForm.append('file', new Blob(['archivo empresa'], { type: 'application/pdf' }), 'empresa.pdf')
  uploadForm.append('empresa_id', '999999')
  const uploadResponse = await fetch(`${base}/gestor-documental/catalogo/${item.id}/archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.data.token}` },
    body: uploadForm,
  })
  assert.equal(uploadResponse.status, 201)
  const uploaded = await uploadResponse.json()
  archivoIds.push(uploaded.archivo.id)
  const uploadedFile = await db('gestor_documental_archivos').where('id', uploaded.archivo.id).first()
  uploadedPaths.push(resolve(process.env.STORAGE_DIR || 'storage/documentos', uploadedFile.path))
  assert.equal(Number(uploaded.archivo.empresa_id), Number(empresa.id))

  const status = await api.get(`/gestor-documental/catalogo?empresa_id=${empresa.id}`, { token: login.data.token })
  const withFile = status.data.documentos.find(d => d.id === item.id)
  assert.equal(withFile.cargado, true)
  assert.equal(withFile.borrador_publicado, true)

  const packageRequest = await api.post('/gestor-documental/solicitudes', {
    tipo_solicitud: 'gestor_paquete',
    categoria_id: catalog.data.categorias[0].id,
  }, { token: login.data.token })
  assert.equal(packageRequest.status, 201)
  solicitudIds.push(packageRequest.data.solicitud.id)
  const packageItems = await api.get(
    `/solicitudes/${packageRequest.data.solicitud.id}/gestor-documentos`,
    { token: login.data.token }
  )
  assert.equal(packageItems.status, 200)
  assert.ok(packageItems.data.data.length > 1, 'el paquete debe mostrar los documentos de la categoría')
  assert.equal(packageItems.data.entregados, 0)

  const firstRequestedItem = packageItems.data.data[0]
  const delivered = await uploadSolicitudGestor(admin.token, packageRequest.data.solicitud.id, firstRequestedItem.catalogo_id)
  assert.equal(delivered.status, 201, JSON.stringify(delivered.data))
  const deliveryRow = await db('gestor_documental_entregas').where('id', delivered.data.entrega.id).first()
  uploadedPaths.push(resolve(process.env.STORAGE_DIR || 'storage/documentos', deliveryRow.path))

  const packageAfterDelivery = await api.get(
    `/solicitudes/${packageRequest.data.solicitud.id}/gestor-documentos`,
    { token: login.data.token }
  )
  assert.equal(packageAfterDelivery.data.entregados, 1)
  const deliveredDocument = packageAfterDelivery.data.data.find(item => item.catalogo_id === firstRequestedItem.catalogo_id)
  assert.equal(deliveredDocument.entregado, true)
  const catalogAfterDelivery = await api.get(`/gestor-documental/catalogo?empresa_id=${empresa.id}`, { token: login.data.token })
  const deliveredInCatalog = catalogAfterDelivery.data.documentos.find(d => d.id === firstRequestedItem.catalogo_id)
  assert.equal(deliveredInCatalog.cargado, true)
  assert.equal(deliveredInCatalog.entrega_solicitud_id, packageRequest.data.solicitud.id)

  const deliveredBlob = await fetch(
    `${await startApp()}/solicitudes/${packageRequest.data.solicitud.id}/gestor-documentos/${firstRequestedItem.catalogo_id}/download`,
    { headers: { Authorization: `Bearer ${login.data.token}` } }
  )
  assert.equal(deliveredBlob.status, 200)
  assert.equal(await deliveredBlob.text(), 'documento entregado por SoyAsesorias')

  const itemRequest = await api.post('/gestor-documental/solicitudes', {
    tipo_solicitud: 'gestor_documento',
    catalogo_id: item.id,
  }, { token: login.data.token })
  assert.equal(itemRequest.status, 201)
  solicitudIds.push(itemRequest.data.solicitud.id)
  const individualItems = await api.get(
    `/solicitudes/${itemRequest.data.solicitud.id}/gestor-documentos`,
    { token: login.data.token }
  )
  assert.equal(individualItems.status, 200)
  assert.equal(individualItems.data.total, 1)
  assert.equal(individualItems.data.data[0].catalogo_id, item.id)
  const visibleRequests = await api.get('/solicitudes', { token: login.data.token })
  assert.ok(visibleRequests.data.data.some(s => s.id === packageRequest.data.solicitud.id))
  assert.ok(visibleRequests.data.data.some(s => s.id === itemRequest.data.solicitud.id))
})

test.after(async () => {
  if (documentIds.length) await db('documentos').whereIn('id', documentIds).delete()
  if (folderIds.length) await db('gestor_documental_carpetas').whereIn('id', folderIds).delete()
  for (const id of [...categoryIds].reverse()) {
    await db('gestor_documental_categorias').where('id', id).delete()
  }
  for (const id of solicitudIds) {
    await db('notificaciones').where('solicitud_id', id).delete()
    await db('servicio_registros').where('solicitud_id', id).delete()
    await db('gestor_documental_entregas').where('solicitud_id', id).delete()
    await db('gestor_documental_solicitud_items').where('solicitud_id', id).delete()
    await db('solicitudes').where('id', id).delete()
  }
  if (archivoIds.length) await db('gestor_documental_archivos').whereIn('id', archivoIds).delete()
  for (const draft of uploadedDrafts) {
    await db('gestor_documental_catalogo').where('id', draft.id).update({
      borrador_path: draft.old?.borrador_path ?? null,
      borrador_nombre: draft.old?.borrador_nombre ?? null,
      borrador_mime: draft.old?.borrador_mime ?? null,
      borrador_size: draft.old?.borrador_size ?? null,
      borrador_publicado: draft.old?.borrador_publicado ?? false,
    })
    const file = resolve(process.env.STORAGE_DIR || 'storage/documentos', draft.path)
    if (existsSync(file)) unlinkSync(file)
  }
  for (const id of userIds) {
    await db('refresh_tokens').where('user_id', id).delete()
    await db('notificaciones').where('user_id', id).delete()
    await db('user_modulos').where('user_id', id).delete()
    await db('user_modulo_permisos').where('user_id', id).delete()
    await db('empresa_usuarios').where('user_id', id).delete()
    await db('users').where('id', id).delete()
  }
  if (companyLinkSnapshot) {
    await db('empresas').where('id', companyLinkSnapshot.id).update({ user_id: companyLinkSnapshot.user_id })
  }
  for (const file of uploadedPaths) if (existsSync(file)) unlinkSync(file)
  await stopApp()
})

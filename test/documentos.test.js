import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { api, loginAs, startApp, ADMIN, EMPRESA, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

const docIds = []
const uploadedPaths = []
const notificationIds = []
const solicitudIds = []

// sube un archivo real via multipart/form-data
async function uploadDoc(token, fields) {
  const base = await startApp()
  const form = new FormData()
  form.append('file', new Blob(['contenido de prueba'], { type: 'application/pdf' }), 'prueba.pdf')
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v))
  const res = await fetch(`${base}/documentos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

test('catalogo de tipos de documento es visible para clientes y admin', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)

  const asAdmin = await api.get('/documentos/tipos', { token: admin.token })
  assert.equal(asAdmin.status, 200)
  assert.ok(asAdmin.data.data.length >= 5, 'el seed crea los tipos base')

  const asClient = await api.get('/documentos/tipos', { token: empresa.token })
  assert.equal(asClient.status, 200)
  assert.ok(asClient.data.data.every(t => t.activo))
})

test('listado de documentos pagina en servidor y restringe el modo todos a admin', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)

  const first = await api.get('/documentos?all=1&page=1&per_page=1', { token: admin.token })
  assert.equal(first.status, 200)
  assert.equal(first.data.page, 1)
  assert.equal(first.data.per_page, 1)
  assert.ok(first.data.data.length <= 1)
  assert.ok(Number.isFinite(first.data.total))

  if (first.data.total > 1) {
    const second = await api.get('/documentos?all=1&page=2&per_page=1', { token: admin.token })
    assert.equal(second.status, 200)
    assert.notEqual(second.data.data[0].id, first.data.data[0].id)
  }

  const clientAll = await api.get('/documentos?all=1&page=1&per_page=1', { token: empresa.token })
  assert.equal(clientAll.status, 400)
})

test('cliente sube documento con tipo/version/fecha y el admin recibe notificacion', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const empresaId = empresa.user.empresa.id
  const tipo = (await db('documento_tipos').where('activo', true).first())

  const up = await uploadDoc(empresa.token, {
    empresa_id: empresaId,
    tipo_id: tipo.id,
    version: '1.0',
    fecha_emision: '2026-09-24',
    nombre: 'Reglamento interno 2026',
  })
  assert.equal(up.status, 201)
  const doc = up.data.documento
  docIds.push(doc.id)
  assert.equal(doc.estatus, 'recibido')
  assert.equal(Number(doc.tipo_id), Number(tipo.id))

  const list = await api.get(`/documentos?empresa_id=${empresaId}`, { token: empresa.token })
  const listed = list.data.data.find(d => d.id === doc.id)
  assert.equal(listed.tipo_nombre, tipo.nombre)

  const adminNotifs = await api.get('/notificaciones', { token: admin.token })
  const notif = adminNotifs.data.data.find(n => n.tipo === 'documento' && n.mensaje?.includes(`#${doc.id}`))
  assert.ok(notif, 'el admin debe recibir notificación cuando el cliente carga un documento')

  // el cliente no puede cambiar el estatus; solo el admin
  const clientEdit = await api.put(`/documentos/${doc.id}`, { estatus: 'en_revision' }, { token: empresa.token })
  assert.equal(clientEdit.status, 400)

  const adminEdit = await api.put(`/documentos/${doc.id}`, { estatus: 'en_revision' }, { token: admin.token })
  assert.equal(adminEdit.status, 200)
  assert.equal(adminEdit.data.documento.estatus, 'en_revision')

  const rejected = await api.put(`/documentos/${doc.id}`, { estatus: 'inexistente' }, { token: admin.token })
  assert.equal(rejected.status, 400)
})

test('al borrar un documento del cliente se elimina archivo y registro y se notifica al admin', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)
  const uploaded = await uploadDoc(empresa.token, {
    empresa_id: empresa.user.empresa.id,
    nombre: 'Documento eliminado de prueba',
  })
  assert.equal(uploaded.status, 201)

  const doc = uploaded.data.documento
  docIds.push(doc.id)
  const fullPath = resolve(process.env.STORAGE_DIR || 'storage/documentos', doc.path)
  uploadedPaths.push(fullPath)
  assert.ok(existsSync(fullPath), 'el archivo subido debe existir antes de borrar')

  const deleted = await api.delete(`/documentos/${doc.id}`, { token: empresa.token })
  assert.equal(deleted.status, 200)
  assert.equal(await db('documentos').where('id', doc.id).first(), undefined)
  assert.equal(existsSync(fullPath), false, 'el archivo físico también debe borrarse')

  const notifications = await api.get('/notificaciones', { token: admin.token })
  const notification = notifications.data.data.find(n =>
    n.titulo === 'Documento eliminado por un cliente' &&
    n.mensaje === `Un cliente eliminó el documento #${doc.id}.`
  )
  assert.ok(notification)
  notificationIds.push(notification.id)
})

test('admin define fecha de entrega y observaciones; el cliente no puede', async () => {
  const admin = await loginAs(ADMIN)
  const empresa = await loginAs(EMPRESA)

  const created = await api.post('/solicitudes', {
    descripcion: 'Solicitud para fecha de entrega',
    servicio_id: 1,
  }, { token: empresa.token })
  assert.equal(created.status, 201)
  const id = created.data.solicitud.id
  solicitudIds.push(id)

  const denied = await api.put(`/solicitudes/${id}`, { fecha_entrega: '2026-10-01' }, { token: empresa.token })
  assert.notEqual(denied.status, 200)

  const ok = await api.put(`/solicitudes/${id}`, {
    fecha_entrega: '2026-10-15',
    observaciones: 'Entrega estimada segun carga',
  }, { token: admin.token })
  assert.equal(ok.status, 200)

  const check = await api.get(`/solicitudes/${id}`, { token: empresa.token })
  assert.equal(String(check.data.solicitud.fecha_entrega).slice(0, 10), '2026-10-15')
  assert.equal(check.data.solicitud.observaciones, 'Entrega estimada segun carga')

  const notifs = await api.get('/notificaciones', { token: empresa.token })
  assert.ok(notifs.data.data.some(n => n.solicitud_id === id && n.titulo === 'Fecha de entrega de tu solicitud'))

  const invalid = await api.put(`/solicitudes/${id}`, { fecha_entrega: 'no-es-fecha' }, { token: admin.token })
  assert.equal(invalid.status, 400)
})

test.after(async () => {
  for (const id of docIds) {
    await db('documentos').where('id', id).delete()
  }
  for (const filePath of uploadedPaths) {
    if (existsSync(filePath)) unlinkSync(filePath)
  }
  for (const id of notificationIds) {
    await db('notificaciones').where('id', id).delete()
  }
  for (const id of solicitudIds) {
    await db('notificaciones').where('solicitud_id', id).delete()
    await db('servicio_registros').where('solicitud_id', id).delete()
    await db('solicitudes').where('id', id).delete()
  }
  await stopApp()
})

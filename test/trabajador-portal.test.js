import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ADMIN, api, ensurePersona, loginAs, startApp, stopApp } from './helpers.js'
import db from '../src/db/knex.js'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { STORAGE_DIR, rutaStorage } from '../src/services/branding.js'

let adminToken
let empleadoId
let personaId
let userId
const solicitudIds = []
let certificadoId
let otherSolicitudId
const email = `trabajador.${randomUUID()}@test.local`
const password = 'Trabajador123!'

before(async () => {
  await startApp()
  adminToken = (await loginAs(ADMIN)).token
  const documento = `TRAB-${randomUUID()}`
  personaId = await ensurePersona(documento, {
    primer_nombre: 'TRABAJADOR',
    primer_apellido: 'PORTAL TEST',
  })
  const [id] = await db('empleados').insert({
    empresa_id: 2,
    persona_id: personaId,
    primer_nombre: 'TRABAJADOR',
    primer_apellido: 'PORTAL TEST',
    tipo_documento: 'CC',
    numero_documento: documento,
    status: 'activo',
    email,
  })
  empleadoId = id
})

after(async () => {
  if (solicitudIds.length) await db('solicitudes').whereIn('id', solicitudIds).del()
  if (otherSolicitudId) await db('solicitudes').where('id', otherSolicitudId).del()
  if (certificadoId) await db('plantillas_rrhh').where({ empresa_id: 2, tipo: 'certificado_laboral' }).del()
  if (empleadoId) await db('empleados').where('id', empleadoId).del()
  if (personaId) await db('personas').where('id', personaId).del()
  if (userId) {
    await db('user_modulos').where('user_id', userId).del()
    await db('refresh_tokens').where('user_id', userId).del().catch(() => {})
    await db('users').where('id', userId).del()
  }
  await stopApp()
})

test('admin crea una cuenta Trabajador vinculada a un solo empleado', async () => {
  const created = await api.post(`/empleados/${empleadoId}/portal-user`, {
    email,
    password,
  }, { token: adminToken })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  userId = created.data.user.id
  assert.equal(created.data.user.role, 'trabajador')

  const duplicate = await api.post(`/empleados/${empleadoId}/portal-user`, {
    email: `otro.${email}`,
    password,
  }, { token: adminToken })
  assert.equal(duplicate.status, 409)
})

test('trabajador solo accede a sus solicitudes de RR. HH. y no a módulos de empresa', async () => {
  const worker = await loginAs({ email, password })
  assert.equal(worker.user.role, 'trabajador')
  assert.equal(worker.user.trabajador.id, empleadoId)
  assert.equal(worker.user.empresa_id, 2)

  const missingDates = await api.post('/solicitudes', {
    tipo_solicitud: 'vacaciones',
    descripcion: 'Solicito vacaciones',
  }, { token: worker.token })
  assert.equal(missingDates.status, 400)

  const created = await api.post('/solicitudes', {
    tipo_solicitud: 'vacaciones',
    fecha_inicio: '2026-11-02',
    fecha_fin: '2026-11-06',
    descripcion: 'Solicito vacaciones familiares',
  }, { token: worker.token })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const solicitudId = created.data.solicitud.id
  solicitudIds.push(solicitudId)
  assert.equal(created.data.solicitud.empleado_id, empleadoId)
  assert.equal(created.data.solicitud.empresa_id, 2)

  const [otherId] = await db('solicitudes').insert({
    empresa_id: 2,
    tipo_solicitud: 'general',
    descripcion: 'Solicitud de la empresa, no del trabajador',
    status: 'pendiente',
  })
  otherSolicitudId = otherId

  const list = await api.get('/solicitudes', { token: worker.token })
  assert.equal(list.status, 200)
  assert.equal(list.data.total, 1)
  assert.equal(list.data.data[0].tipo_solicitud, 'vacaciones')
  assert.equal((await api.get(`/solicitudes/${otherSolicitudId}`, { token: worker.token })).status, 403)

  const otherModule = await api.get('/empleados', { token: worker.token })
  assert.equal(otherModule.status, 403)
  assert.equal((await api.get('/catalogos', { token: worker.token })).status, 403)
  assert.equal((await api.get('/informes/mi-resumen', { token: worker.token })).status, 403)

  const admin = await api.get(`/solicitudes/${solicitudId}`, { token: adminToken })
  assert.equal(admin.status, 200)
  assert.equal(admin.data.solicitud.empleado_id, empleadoId)

  const certificate = await api.post('/solicitudes', {
    tipo_solicitud: 'certificado_laboral',
    descripcion: 'Necesito un certificado laboral',
  }, { token: worker.token })
  assert.equal(certificate.status, 201, JSON.stringify(certificate.data))
  certificadoId = certificate.data.solicitud.id
  solicitudIds.push(certificadoId)
})

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test('membrete y firma de la empresa se usan en el documento; la fecha de ingreso se muestra bien', async () => {
  // La prueba reemplaza logo y firma de la empresa real: respalda los archivos
  // originales y los restaura al final, y borra solo los archivos de prueba.
  const before = await db('empresas').where('id', 2).first(['logo_path', 'logo_mime', 'firma_path', 'firma_mime', 'firma_nombre', 'firma_cargo'])
  const respaldo = {}
  for (const col of ['logo_path', 'firma_path']) {
    const ruta = rutaStorage(before[col])
    if (ruta) respaldo[before[col]] = readFileSync(ruta)
  }
  let creados = []
  try {
    const base = await startApp()
    const form = new FormData()
    form.append('logo', new Blob([PNG_1X1], { type: 'image/png' }), 'logo.png')
    form.append('firma', new Blob([PNG_1X1], { type: 'image/png' }), 'firma.png')
    form.append('firma_nombre', 'Javier Díaz Toloza')
    form.append('firma_cargo', 'Representante legal')
    const saved = await fetch(`${base}/empresas/2/branding`, { method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` }, body: form })
    assert.equal(saved.status, 200, await saved.text())
    const durante = await db('empresas').where('id', 2).first(['logo_path', 'firma_path'])
    creados = [durante.logo_path, durante.firma_path].filter(f => f && !respaldo[f] && f !== before.logo_path && f !== before.firma_path)

    const logo = await fetch(`${base}/empresas/2/branding/logo`, { headers: { Authorization: `Bearer ${adminToken}` } })
    assert.equal(logo.status, 200)
    assert.equal(logo.headers.get('content-type'), 'image/png')

    const txtForm = new FormData()
    txtForm.append('archivo', new Blob(['no imagen'], { type: 'text/plain' }), 'x.txt')
    const bad = await fetch(`${base}/empresas/2/branding`, { method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` }, body: (() => { const f = new FormData(); f.append('firma', new Blob(['x'], { type: 'text/plain' }), 'x.txt'); return f })() })
    assert.equal(bad.status, 400)

    const approved = await api.put(`/solicitudes/${certificadoId}`, { status: 'aprobada' }, { token: adminToken })
    assert.equal(approved.status, 200)
    const generated = await api.post(`/solicitudes/${certificadoId}/generar-documento-rrhh`, {}, { token: adminToken })
    assert.equal(generated.status, 200, JSON.stringify(generated.data))
    const html = await (await fetch(`${base}/solicitudes/${certificadoId}/respuesta`, { headers: { Authorization: `Bearer ${adminToken}` } })).text()
    assert.match(html, /data:image\/png;base64,/)
    assert.match(html, /Javier Díaz Toloza/)
    assert.match(html, /\.contacto\{[^}]*color:#fff/)
    assert.match(html, /font:600 13px\/1\.5 Arial,Helvetica,sans-serif/)
    assert.doesNotMatch(html, /Sun |Mon |Tue |Wed |Thu |Fri |Sat /)
    assert.doesNotMatch(html, /\{\{/)
  } finally {
    await db('empresas').where('id', 2).update(before)
    for (const [file, buf] of Object.entries(respaldo)) {
      const ruta = resolve(STORAGE_DIR, file)
      if (!existsSync(ruta)) writeFileSync(ruta, buf)
    }
    for (const file of creados) {
      const ruta = rutaStorage(file)
      if (ruta) unlinkSync(ruta)
    }
  }
})

test('el equipo administra la solicitud del trabajador desde el módulo de RR. HH.', async () => {
  const vacationId = solicitudIds[0]
  const company = await api.put(`/solicitudes/${vacationId}`, {
    status: 'aprobada',
    observaciones: 'Aprobada por Recursos Humanos',
  }, { token: adminToken })
  assert.equal(company.status, 200)
  assert.equal(company.data.solicitud.status, 'aprobada')

  const worker = await loginAs({ email, password })
  const updated = await api.get(`/solicitudes/${vacationId}`, { token: worker.token })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.solicitud.observaciones, 'Aprobada por Recursos Humanos')

  const templates = await api.get('/solicitudes/plantillas-rrhh?empresa_id=2', { token: adminToken })
  assert.equal(templates.status, 200)
  assert.ok(templates.data.data.some(t => t.tipo === 'certificado_laboral' && !t.personalizada))
  const custom = await api.put('/solicitudes/plantillas-rrhh', {
    empresa_id: 2,
    tipo: 'certificado_laboral',
    titulo: 'Certificado laboral personalizado',
    contenido: 'CERTIFICA: {{trabajador.nombre}} trabaja en {{empresa.nombre}} desde {{trabajador.fecha_ingreso}}.',
  }, { token: adminToken })
  assert.equal(custom.status, 200)

  const generated = await api.post(`/solicitudes/${certificadoId}/generar-documento-rrhh`, {}, { token: adminToken })
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.match(generated.data.nombre, /\.html$/)

  const base = await startApp()
  const download = await fetch(`${base}/solicitudes/${certificadoId}/respuesta`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-type'), /text\/html/)
  const html = await download.text()
  assert.match(html, /TRABAJADOR PORTAL TEST/)
  assert.match(html, /CERTIFICA:/)

  const requests = await api.get('/solicitudes', { token: worker.token })
  const certificate = requests.data.data.find(s => s.id === certificadoId)
  assert.match(certificate.respuesta_nombre, /\.html$/)
  await api.delete(`/solicitudes/${certificadoId}/respuesta`, { token: adminToken })
})

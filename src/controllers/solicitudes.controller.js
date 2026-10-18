import db from '../db/knex.js'
import { resolve, sep } from 'path'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'
import { notificarAdmins, notificarCambioEstado } from '../services/notificaciones.js'
import { imagenDataUri } from '../services/branding.js'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

// Acceso a la solicitud: admin o el cliente dueño (empresa o independiente)
function canAccessSolicitud(user, solicitud) {
  if (esStaff(user)) return true
  if (user.role === 'trabajador') return Number(user.empleado_id) === Number(solicitud.empleado_id)
  return canAccessEmpresa(user, solicitud.empresa_id) || solicitud.persona_id === user.persona_id
}

async function clientUserId(trx, solicitud) {
  if (solicitud.empleado_id) {
    return (await trx('empleados').select('user_id').where('id', solicitud.empleado_id).first())?.user_id
  }
  return solicitud.empresa_id
    ? (await trx('empresas').select('user_id').where('id', solicitud.empresa_id).first())?.user_id
    : (await trx('personas').select('user_id').where('id', solicitud.persona_id).first())?.user_id
}

const TIPOS_PLANTILLA_RRHH = ['certificado_laboral', 'vacaciones']

function empresaPlantillasId(req, rawId) {
  if (req.user.role === 'empresa') return Number(req.user.empresa_id) || null
  if (esStaff(req.user)) return Number(rawId) || null
  return null
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function fechaDocumento(value) {
  if (!value) return '—'
  // Las columnas DATE llegan como Date a medianoche UTC (timezone 'Z' del driver)
  if (value instanceof Date) {
    return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`
  }
  const text = String(value).slice(0, 10)
  const [year, month, day] = text.split('-')
  return year && month && day ? `${day}/${month}/${year}` : text
}

// GET /solicitudes/plantillas-rrhh?empresa_id= — estándares + personalizaciones
export async function listPlantillasRRHH(req, res) {
  const empresaId = empresaPlantillasId(req, req.query.empresa_id)
  if (!empresaId) return res.status(400).json({ error: 'Empresa requerida' })
  if (req.user.role === 'empresa' && !canAccessEmpresa(req.user, empresaId)) {
    return res.status(403).json({ error: 'Sin acceso a la empresa' })
  }
  const [base, custom] = await Promise.all([
    db('plantillas_rrhh').whereNull('empresa_id').whereIn('tipo', TIPOS_PLANTILLA_RRHH),
    db('plantillas_rrhh').where('empresa_id', empresaId).whereIn('tipo', TIPOS_PLANTILLA_RRHH),
  ])
  const customByType = Object.fromEntries(custom.map(p => [p.tipo, p]))
  res.json({
    empresa_id: empresaId,
    data: base.map(p => ({
      tipo: p.tipo,
      titulo: customByType[p.tipo]?.titulo || p.titulo,
      contenido: customByType[p.tipo]?.contenido || p.contenido,
      personalizada: !!customByType[p.tipo],
      estandar_titulo: p.titulo,
      estandar_contenido: p.contenido,
    })),
  })
}

// PUT /solicitudes/plantillas-rrhh — guarda una copia editable por empresa.
export async function savePlantillaRRHH(req, res) {
  const empresaId = empresaPlantillasId(req, req.body.empresa_id)
  if (!empresaId) return res.status(400).json({ error: 'Empresa requerida' })
  if (req.user.role === 'empresa' && !canAccessEmpresa(req.user, empresaId)) {
    return res.status(403).json({ error: 'Sin acceso a la empresa' })
  }
  const { tipo } = req.body
  const titulo = String(req.body.titulo || '').trim()
  const contenido = String(req.body.contenido || '').trim()
  if (!TIPOS_PLANTILLA_RRHH.includes(tipo)) return res.status(400).json({ error: 'Tipo de plantilla no válido' })
  if (!titulo || !contenido) return res.status(400).json({ error: 'Título y contenido son obligatorios' })
  if (contenido.length > 12000) return res.status(400).json({ error: 'La plantilla no puede superar 12.000 caracteres' })

  const existing = await db('plantillas_rrhh').where({ empresa_id: empresaId, tipo }).first()
  if (existing) {
    await db('plantillas_rrhh').where('id', existing.id).update({
      titulo, contenido, actualizado_por: req.user.id, updated_at: db.fn.now(),
    })
  } else {
    await db('plantillas_rrhh').insert({
      empresa_id: empresaId, tipo, titulo, contenido, actualizado_por: req.user.id,
    })
  }
  res.json({ ok: true })
}

// Genera un documento HTML imprimible usando los datos actuales de empresa,
// trabajador y solicitud, lo adjunta a la solicitud y notifica al trabajador.
export async function generarDocumentoRRHH(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (!puedeGestionar(req.user, solicitud)) return res.status(403).json({ error: 'Sin permiso para generar este documento' })
  if (!solicitud.empleado_id || !TIPOS_PLANTILLA_RRHH.includes(solicitud.tipo_solicitud)) {
    return res.status(400).json({ error: 'La solicitud no tiene un tipo de documento generado' })
  }
  if (solicitud.status === 'pendiente' || solicitud.status === 'rechazada' || solicitud.status === 'cancelada') {
    return res.status(409).json({ error: 'Aprueba o gestiona la solicitud antes de generar el documento' })
  }

  const [empleado, empresa, base, custom] = await Promise.all([
    db('empleados as e')
      .leftJoin('cargos as c', 'c.id', 'e.cargo_id')
      .where('e.id', solicitud.empleado_id)
      .select('e.*', 'c.nombre as cargo_nombre')
      .first(),
    db('empresas').where('id', solicitud.empresa_id).first(),
    db('plantillas_rrhh').whereNull('empresa_id').where('tipo', solicitud.tipo_solicitud).first(),
    db('plantillas_rrhh').where({ empresa_id: solicitud.empresa_id, tipo: solicitud.tipo_solicitud }).first(),
  ])
  if (!empleado || !empresa || !base) return res.status(404).json({ error: 'Faltan datos para generar el documento' })

  const titulo = custom?.titulo || base.titulo
  const plantilla = custom?.contenido || base.contenido
  const firmaNombre = empresa.firma_nombre || empresa.representante_legal || 'Representante legal'
  const firmaCargo = empresa.firma_cargo || 'Representante legal'
  const nit = `${empresa.num_documento || ''}${empresa.dv ? `-${empresa.dv}` : ''}`
  const vars = {
    'empresa.nombre': empresa.razon_social,
    'empresa.nit': nit,
    'empresa.direccion': empresa.direccion,
    'empresa.telefono': empresa.telefono_contacto,
    'empresa.firma_nombre': firmaNombre,
    'empresa.firma_cargo': firmaCargo,
    'trabajador.nombre': [
      empleado.primer_nombre, empleado.segundo_nombre,
      empleado.primer_apellido, empleado.segundo_apellido,
    ].filter(Boolean).join(' '),
    'trabajador.tipo_documento': empleado.tipo_documento,
    'trabajador.documento': empleado.numero_documento,
    'trabajador.cargo': empleado.cargo_nombre || '—',
    'trabajador.fecha_ingreso': fechaDocumento(empleado.fecha_ingreso),
    'trabajador.tipo_contrato': empleado.tipo_contrato || '—',
    'fecha_emision': new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
    'solicitud.fecha_inicio': fechaDocumento(solicitud.fecha_inicio),
    'solicitud.fecha_fin': fechaDocumento(solicitud.fecha_fin),
    'solicitud.estado': solicitud.status === 'aprobada' || solicitud.status === 'completada' ? 'aprobada' : 'en revisión',
    'solicitud.observaciones': solicitud.observaciones || '',
  }
  // Firma guardada por la empresa: se inserta donde esté {{firma}} o al final
  const firmaSrc = imagenDataUri(empresa.firma_path, empresa.firma_mime)
  const firmaHtml = `<div class="firma">${firmaSrc ? `<img src="${firmaSrc}" alt="Firma">` : '<div class="sin-firma"></div>'}`
    + `<div class="linea"></div><strong>${escapeHtml(firmaNombre)}</strong><br>${escapeHtml(firmaCargo)}<br>${escapeHtml(empresa.razon_social)}</div>`
  const render = (texto) => escapeHtml(texto)
    .replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, key) => escapeHtml(vars[key] ?? ''))
    .replace(/\r?\n/g, '<br>\n')
  const partes = plantilla.split(/\{\{\s*firma\s*\}\}/i)
  const cuerpo = partes.length > 1 ? partes.map(render).join(firmaHtml) : `${render(plantilla)}${firmaHtml}`

  // Membrete: banda de color con el logo de la empresa; pie con datos de contacto
  const logoSrc = imagenDataUri(empresa.logo_path, empresa.logo_mime)
  const membrete = `<header class="membrete"><svg class="onda" viewBox="0 0 794 180" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="M0 0H430C330 40 200 120 0 170Z" fill="#1f4f9e"/><path d="M0 0H360C280 40 170 100 0 130Z" fill="#8cc0ec"/></svg>`
    + (logoSrc
      ? `<img class="logo" src="${logoSrc}" alt="${escapeHtml(empresa.razon_social)}">`
      : `<div class="marca">${escapeHtml(empresa.razon_social)}</div>`)
    + `</header>`
  const contacto = [
    empresa.direccion,
    [empresa.telefono_contacto, empresa.telefono_movil, empresa.telefono_fijo].filter(Boolean).join(' · '),
    empresa.email_contacto || empresa.email,
  ].filter(Boolean).map(escapeHtml).join('&nbsp;&nbsp;|&nbsp;&nbsp;')
  const pie = `<footer class="pie"><svg class="onda-inf" viewBox="0 0 794 150" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="M0 60C220 0 420 120 794 40V150H0Z" fill="#1f4f9e"/><path d="M0 84C240 30 440 140 794 66V150H0Z" fill="#8cc0ec"/></svg>`
    + (contacto ? `<div class="contacto">${contacto}</div>` : '')
    + `</footer>`

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title><style>
    @page{size:A4;margin:0}
    body{font:14px/1.7 Georgia,'Times New Roman',serif;color:#1d2530;margin:0;background:#e9edf2}
    main{position:relative;box-sizing:border-box;width:794px;min-height:1123px;margin:24px auto;background:#fff;box-shadow:0 8px 32px #16202a25;overflow:hidden}
    .membrete{position:absolute;top:0;left:0;right:0;height:180px}
    .membrete .onda,.pie .onda-inf{position:absolute;left:0;width:100%;height:100%}
    .membrete .onda{top:0}
    .pie{position:absolute;bottom:0;left:0;right:0;height:150px}
    .pie .onda-inf{bottom:0;top:auto;height:150px}
    .membrete .logo{position:absolute;top:34px;right:64px;max-height:86px;max-width:240px;object-fit:contain}
    .membrete .marca{position:absolute;top:58px;right:64px;max-width:260px;font:700 17px/1.25 Arial,sans-serif;color:#1f4f9e;text-align:right}
    .contacto{position:absolute;left:48px;right:48px;bottom:42px;box-sizing:border-box;padding:9px 14px;border-radius:6px;background:#173a73;box-shadow:0 1px 4px #16202a30;font:600 13px/1.5 Arial,Helvetica,sans-serif;letter-spacing:.02em;text-align:center;word-break:break-word;color:#fff;text-shadow:0 1px 1px #102b56;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cuerpo{padding:200px 80px 190px}
    h1{font:600 20px/1.3 Arial,sans-serif;letter-spacing:.04em;text-align:center;color:#1f4f9e;margin:0 0 34px}
    article{white-space:normal}
    .firma{margin-top:46px;width:300px}
    .firma img{display:block;max-height:90px;max-width:260px;margin:0 0 4px}
    .firma .sin-firma{height:70px}
    .firma .linea{border-top:1px solid #1d2530;margin:0 0 6px;width:260px}
    .barra{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;padding:10px 24px;background:#1f4f9e}
    .barra button{font:600 14px Arial,sans-serif;padding:8px 18px;border:0;border-radius:6px;background:#fff;color:#1f4f9e;cursor:pointer}
    @media print{body{background:#fff}main{margin:0;box-shadow:none}.barra{display:none}}
  </style></head><body><div class="barra"><button type="button" onclick="window.print()">Imprimir</button></div><main>${membrete}<section class="cuerpo"><h1>${escapeHtml(titulo)}</h1><article>${cuerpo}</article></section>${pie}</main></body></html>`

  const filename = `${randomUUID()}.html`
  const fullPath = resolve(STORAGE_DIR, filename)
  await mkdir(STORAGE_DIR, { recursive: true })
  await writeFile(fullPath, html, { flag: 'wx' })
  const previousPath = solicitud.respuesta_path
  let notificationRows = []
  try {
    await db.transaction(async trx => {
      await trx('solicitudes').where('id', solicitud.id).update({
        respuesta_path: filename,
        respuesta_nombre: `${titulo.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '')}.html`,
        respuesta_mime: 'text/html; charset=utf-8',
        respuesta_size: Buffer.byteLength(html),
        respuesta_at: trx.fn.now(),
      })
      const recipient = await clientUserId(trx, solicitud)
      notificationRows = await createNotifications(trx, recipient ? [recipient] : [], {
        titulo: `Documento generado: ${titulo}`,
        mensaje: `El documento de tu solicitud #${solicitud.id} ya está disponible para descargar.`,
        solicitudId: solicitud.id,
        url: '/admin/solicitudes',
      })
    })
  } catch (err) {
    unlinkSync(fullPath)
    throw err
  }

  if (previousPath && previousPath !== filename) {
    const oldPath = resolve(STORAGE_DIR, previousPath)
    if (oldPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(oldPath)) unlinkSync(oldPath)
  }
  publishNotifications(notificationRows)
  res.json({ ok: true, nombre: `${titulo}.html` })
}

function empresaPuedeGestionar(user, solicitud) {
  return user.role === 'empresa' && !!solicitud.empleado_id
    && Number(user.empresa_id) === Number(solicitud.empresa_id)
}

function puedeGestionar(user, solicitud) {
  return esStaff(user) || empresaPuedeGestionar(user, solicitud)
}

// Solicitudes de servicio: el cliente pide algo (afiliacion, asesoria...),
// el admin lo gestiona. status: pendiente/en_proceso/completada/rechazada

// GET /solicitudes?empresa_id=&status=&page=&per_page=
export async function list(req, res) {
  const { search, status, desde, hasta, page = 1, per_page = 25 } = req.query
  const empresaId = esStaff(req.user) ? req.query.empresa_id : req.user.empresa_id

  const query = db('solicitudes')
    .leftJoin('empresas', 'solicitudes.empresa_id', 'empresas.id')
    .leftJoin('personas', 'solicitudes.persona_id', 'personas.id')
    .leftJoin('empleados', 'solicitudes.empleado_id', 'empleados.id')
    .leftJoin('servicios', 'solicitudes.servicio_id', 'servicios.id')
    .select('solicitudes.*', 'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'empresas.telefono_contacto as empresa_telefono',
      'personas.num_documento as persona_nit',
      'personas.telefono as persona_telefono',
      'empleados.primer_nombre as empleado_primer_nombre',
      'empleados.primer_apellido as empleado_primer_apellido',
      'empleados.numero_documento as empleado_documento',
      'servicios.nombre as servicio_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido)) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento) as cliente_nit`),
      db.raw(`COALESCE(empresas.telefono_contacto, personas.telefono) as telefono`))

  if (req.user.role === 'trabajador') {
    query.where('solicitudes.empleado_id', req.user.empleado_id)
  } else if (!esStaff(req.user)) {
    query.where(q => {
      if (req.user.empresa_id) q.where('solicitudes.empresa_id', req.user.empresa_id)
      if (req.user.persona_id) q.orWhere('solicitudes.persona_id', req.user.persona_id)
      if (!req.user.empresa_id && !req.user.persona_id) q.whereRaw('1=0')
    })
  } else if (empresaId) {
    query.where('solicitudes.empresa_id', empresaId)
  }
  if (status) query.where('solicitudes.status', status)
  if (desde) query.where('solicitudes.created_at', '>=', `${desde} 00:00:00`)
  if (hasta) query.where('solicitudes.created_at', '<=', `${hasta} 23:59:59`)
  if (search) {
    query.where(q =>
      q.where('solicitudes.descripcion', 'like', `%${search}%`)
       .orWhere('solicitudes.id', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
       .orWhere('personas.primer_nombre', 'like', `%${search}%`)
       .orWhere('empleados.primer_nombre', 'like', `%${search}%`)
       .orWhere('empleados.numero_documento', 'like', `%${search}%`)
       .orWhere('servicios.nombre', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('solicitudes.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /solicitudes/:id
export async function show(req, res) {
  const solicitud = await db('solicitudes')
    .leftJoin('empresas', 'solicitudes.empresa_id', 'empresas.id')
    .leftJoin('personas', 'solicitudes.persona_id', 'personas.id')
    .leftJoin('empleados', 'solicitudes.empleado_id', 'empleados.id')
    .leftJoin('servicios', 'solicitudes.servicio_id', 'servicios.id')
    .select('solicitudes.*', 'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'personas.num_documento as persona_nit',
      'personas.telefono as persona_telefono',
      'empleados.primer_nombre as empleado_primer_nombre',
      'empleados.primer_apellido as empleado_primer_apellido',
      'empleados.numero_documento as empleado_documento',
      'servicios.nombre as servicio_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido)) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento) as cliente_nit`),
      db.raw(`COALESCE(empresas.telefono_contacto, personas.telefono) as telefono`))
    .where('solicitudes.id', req.params.id)
    .first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (!canAccessSolicitud(req.user, solicitud)) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  res.json({ solicitud })
}

// POST /solicitudes - cliente crea solicitud; admin puede crear para cualquiera
export async function create(req, res) {
  const tiposEmpleado = ['certificado_laboral', 'vacaciones', 'otra']
  const tiposValidos = req.user.role === 'trabajador'
    ? tiposEmpleado
    : ['general', ...tiposEmpleado]
  const tipo = tiposValidos.includes(req.body.tipo_solicitud) ? req.body.tipo_solicitud : 'general'
  if (req.user.role === 'trabajador' && tipo === 'general') {
    return res.status(400).json({ error: 'Selecciona el tipo de solicitud de Recursos Humanos' })
  }
  let empleado = null
  if (req.user.role === 'trabajador') {
    empleado = await db('empleados').where({ id: req.user.empleado_id, status: 'activo' }).first()
    if (!empleado) return res.status(403).json({ error: 'No hay un vínculo laboral activo' })
  } else if (req.body.empleado_id) {
    empleado = await db('empleados').where('id', req.body.empleado_id).first()
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' })
    if (!esStaff(req.user) && !canAccessEmpresa(req.user, empleado.empresa_id)) {
      return res.status(403).json({ error: 'El empleado no pertenece a tu empresa' })
    }
  }

  const empresaId = empleado?.empresa_id ?? (esStaff(req.user) ? req.body.empresa_id : req.user.empresa_id)
  const personaId = empleado ? null : (esStaff(req.user) ? req.body.persona_id : req.user.persona_id)
  if (!empresaId && !personaId && !esStaff(req.user)) {
    return res.status(400).json({ error: 'empresa_id o persona_id requerido' })
  }
  if (tipo === 'vacaciones') {
    const inicio = req.body.fecha_inicio
    const fin = req.body.fecha_fin
    if (!inicio || !fin || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fin)) || fin < inicio) {
      return res.status(400).json({ error: 'Indica un rango de fechas de vacaciones válido' })
    }
    if (!empleado && !esStaff(req.user)) {
      return res.status(400).json({ error: 'La solicitud de vacaciones debe asociarse a un trabajador' })
    }
  }

  let notificationRows = []
  const solicitud = await db.transaction(async trx => {
    const [id] = await trx('solicitudes').insert({
      empresa_id: empresaId || null,
      persona_id: personaId || null,
      empleado_id: empleado?.id || null,
      tipo_solicitud: tipo,
      fecha_inicio: tipo === 'vacaciones' ? req.body.fecha_inicio : null,
      fecha_fin: tipo === 'vacaciones' ? req.body.fecha_fin : null,
      servicio_id: req.body.servicio_id || null,
      descripcion: req.body.descripcion || null,
      status: 'pendiente',
    })
    const created = await trx('solicitudes').where('id', id).first()
    let recipients
    if (esStaff(req.user)) {
      const target = await clientUserId(trx, created)
      recipients = target ? [target] : []
    } else {
      recipients = (await trx('users').select('id').where('role', 'admin').where('is_active', true)).map(user => user.id)
      if (req.user.role === 'trabajador') {
        const companyUserId = (await trx('empresas').select('user_id').where('id', empresaId).first())?.user_id
        if (companyUserId) recipients.push(companyUserId)
      } else if (created.empleado_id) {
        const employeeUserId = (await trx('empleados').select('user_id').where('id', created.empleado_id).first())?.user_id
        if (employeeUserId) recipients.push(employeeUserId)
      }
    }

    notificationRows = await createNotifications(trx, Array.isArray(recipients) ? recipients : recipients ? [recipients] : [], {
      titulo: esStaff(req.user) || req.user.role === 'empresa' ? 'Nueva solicitud de trabajador' : 'Nueva solicitud recibida',
      mensaje: `Solicitud #${id} (${tipo.replace('_', ' ')}): ${created.descripcion || 'Solicitud recibida'}`,
      solicitudId: id,
      url: '/admin/solicitudes',
    })
    return created
  })

  publishNotifications(notificationRows)
  res.status(201).json({ solicitud })

  // Cliente crea -> correo a los admins (la notificacion in-app ya se creo arriba)
  if (!esStaff(req.user) && req.user.role !== 'empresa') {
    notificarAdmins({
      entidad: 'solicitud', entidadId: solicitud.id,
      titulo: 'Nueva solicitud recibida',
      mensaje: `Solicitud #${solicitud.id}: ${solicitud.descripcion || 'Servicio solicitado'} — enviada por ${req.user.email}`,
      url: '/admin/solicitudes',
      crearInApp: false,
      userId: req.user.id,
    })
  }
}

// PUT /solicitudes/:id - admin gestiona estados; el cliente solo puede actualizar su descripción
export async function update(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })

  const data = {}
  const notifications = []
  const manager = puedeGestionar(req.user, solicitud)
  if (manager) {
    for (const campo of ['descripcion', 'servicio_id', 'observaciones']) {
      if (req.body[campo] !== undefined) data[campo] = req.body[campo]
    }
    if (req.body.fecha_entrega !== undefined) {
      const f = req.body.fecha_entrega
      if (f !== null && f !== '' && Number.isNaN(Date.parse(f))) {
        return res.status(400).json({ error: 'fecha_entrega no es una fecha válida' })
      }
      data.fecha_entrega = f || null
    }
    if (req.body.status !== undefined && req.body.status !== solicitud.status) {
      const transitions = {
        pendiente: ['aprobada', 'rechazada', 'cancelada'],
        aprobada: ['en_proceso', 'completada', 'rechazada', 'cancelada'],
        en_proceso: ['completada', 'cancelada'],
      }
      if (!transitions[solicitud.status]?.includes(req.body.status)) {
        return res.status(409).json({ error: `No se puede cambiar de ${solicitud.status} a ${req.body.status}` })
      }
      data.status = req.body.status
    }
  } else {
    if (!canAccessSolicitud(req.user, solicitud)) {
      return res.status(403).json({ error: 'Sin acceso' })
    }
    if (req.body.descripcion !== undefined && solicitud.status === 'pendiente') {
      data.descripcion = req.body.descripcion
    }
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  const updated = await db.transaction(async trx => {
    await trx('solicitudes').where('id', solicitud.id).update(data)

    if (data.status) {
      const serviceStatus = {
        aprobada: 1,
        en_proceso: 4,
        completada: 2,
        rechazada: 5,
        cancelada: 5,
      }[data.status]
      let serviceRecord = await trx('servicio_registros').where('solicitud_id', solicitud.id).first()
      if (!serviceRecord && data.status === 'aprobada' && !solicitud.empleado_id
          && (!solicitud.tipo_solicitud || solicitud.tipo_solicitud === 'general')) {
        const servicio = solicitud.servicio_id
          ? await trx('servicios').where('id', solicitud.servicio_id).first()
          : null
        const [serviceId] = await trx('servicio_registros').insert({
          solicitud_id: solicitud.id,
          empresa_id: solicitud.empresa_id,
          persona_id: solicitud.persona_id,
          servicio_id: solicitud.servicio_id,
          nombre: servicio?.nombre || 'Solicitud aprobada',
          fecha: new Date(),
          cantidad: 1,
          status: serviceStatus,
          status_pago: 2,
          obs: solicitud.descripcion,
        })
        serviceRecord = { id: serviceId }
      } else if (serviceRecord) {
        await trx('servicio_registros').where('id', serviceRecord.id).update({ status: serviceStatus })
      }

      const clientUserId = solicitud.empresa_id
        ? (await trx('empresas').select('user_id').where('id', solicitud.empresa_id).first())?.user_id
        : (await trx('personas').select('user_id').where('id', solicitud.persona_id).first())?.user_id
      notifications.push(...await createNotifications(trx, clientUserId ? [clientUserId] : [], {
        titulo: 'Actualización de tu solicitud',
        mensaje: `La solicitud #${solicitud.id} cambió a: ${data.status.replace('_', ' ')}.`,
        solicitudId: solicitud.id,
        url: '/admin/solicitudes',
      }))
    }

    if (data.fecha_entrega !== undefined && data.fecha_entrega !== solicitud.fecha_entrega) {
      const clientUserId = solicitud.empresa_id
        ? (await trx('empresas').select('user_id').where('id', solicitud.empresa_id).first())?.user_id
        : (await trx('personas').select('user_id').where('id', solicitud.persona_id).first())?.user_id
      const fechaTxt = data.fecha_entrega
        ? new Date(`${data.fecha_entrega}T00:00:00`).toLocaleDateString('es-CO')
        : null
      notifications.push(...await createNotifications(trx, clientUserId ? [clientUserId] : [], {
        titulo: 'Fecha de entrega de tu solicitud',
        mensaje: data.fecha_entrega
          ? `La solicitud #${solicitud.id} tiene fecha de entrega: ${fechaTxt}.`
          : `Se retiró la fecha de entrega de la solicitud #${solicitud.id}.`,
        solicitudId: solicitud.id,
        url: '/admin/solicitudes',
      }))
    }

    return trx('solicitudes').where('id', solicitud.id).first()
  })

  publishNotifications(notifications)
  res.json({ solicitud: updated })

  // Correo al cliente por cambio de estado (respeta consentimiento de terminos)
  if (data.status) {
    notificarCambioEstado({
      entidad: 'solicitud', entidadId: solicitud.id,
      titulo: `Solicitud #${solicitud.id}`,
      estadoAnterior: solicitud.status, estadoNuevo: data.status,
      url: '/admin/solicitudes',
      empresaId: solicitud.empresa_id, personaId: solicitud.persona_id,
      crearInApp: false, // la in-app ya se publico arriba
    })
  }
}

// PUT /solicitudes/:id/respuesta - el admin adjunta el documento/respuesta de la solicitud
export async function uploadRespuesta(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) {
    if (req.file) unlinkSync(req.file.path)
    return res.status(404).json({ error: 'Solicitud no encontrada' })
  }
  if (!puedeGestionar(req.user, solicitud)) {
    if (req.file) unlinkSync(req.file.path)
    return res.status(403).json({ error: 'Solo el equipo responsable puede adjuntar la respuesta' })
  }
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })

  const previousPath = solicitud.respuesta_path
  let notificationRows = []
  const updated = await db.transaction(async trx => {
    await trx('solicitudes').where('id', solicitud.id).update({
      respuesta_path: req.file.filename,
      respuesta_nombre: req.file.originalname,
      respuesta_mime: req.file.mimetype,
      respuesta_size: req.file.size,
      respuesta_at: new Date(),
    })

    const userId = await clientUserId(trx, solicitud)
    notificationRows = await createNotifications(trx, userId ? [userId] : [], {
      titulo: 'Respuesta disponible en tu solicitud',
      mensaje: `La solicitud #${solicitud.id} tiene un documento de respuesta: ${req.file.originalname}.`,
      solicitudId: solicitud.id,
      url: '/admin/solicitudes',
    })

    return trx('solicitudes').where('id', solicitud.id).first()
  })

  // Reemplazo: borra el archivo anterior fuera de la transaccion
  if (previousPath && previousPath !== req.file.filename) {
    const oldFullPath = resolve(STORAGE_DIR, previousPath)
    if (oldFullPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(oldFullPath)) {
      unlinkSync(oldFullPath)
    }
  }

  publishNotifications(notificationRows)
  res.json({ solicitud: updated })
}

// GET /solicitudes/:id/respuesta - descarga autenticada (admin o cliente dueño)
export async function downloadRespuesta(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud || !solicitud.respuesta_path) {
    return res.status(404).json({ error: 'La solicitud no tiene respuesta' })
  }
  if (!canAccessSolicitud(req.user, solicitud)) {
    return res.status(403).json({ error: 'Sin acceso a esta solicitud' })
  }

  const fullPath = resolve(STORAGE_DIR, solicitud.respuesta_path)
  if (!fullPath.startsWith(`${STORAGE_DIR}${sep}`) || !existsSync(fullPath)) {
    return res.status(404).json({ error: 'Archivo no disponible' })
  }

  res.setHeader('Content-Type', solicitud.respuesta_mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${solicitud.respuesta_nombre}"`)
  createReadStream(fullPath).pipe(res)
}

// DELETE /solicitudes/:id/respuesta - el admin retira el documento de respuesta
export async function deleteRespuesta(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (!puedeGestionar(req.user, solicitud)) {
    return res.status(403).json({ error: 'Solo el equipo responsable puede quitar la respuesta' })
  }
  if (!solicitud.respuesta_path) {
    return res.status(400).json({ error: 'La solicitud no tiene respuesta' })
  }

  const previousPath = solicitud.respuesta_path
  const updated = await db.transaction(async trx => {
    await trx('solicitudes').where('id', solicitud.id).update({
      respuesta_path: null,
      respuesta_nombre: null,
      respuesta_mime: null,
      respuesta_size: null,
      respuesta_at: null,
    })
    return trx('solicitudes').where('id', solicitud.id).first()
  })

  const fullPath = resolve(STORAGE_DIR, previousPath)
  if (fullPath.startsWith(`${STORAGE_DIR}${sep}`) && existsSync(fullPath)) {
    unlinkSync(fullPath)
  }

  res.json({ solicitud: updated })
}

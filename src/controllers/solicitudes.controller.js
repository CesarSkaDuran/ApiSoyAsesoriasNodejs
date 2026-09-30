import db from '../db/knex.js'
import { resolve, sep } from 'path'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { canAccessEmpresa } from '../middlewares/auth.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'
import { notificarAdmins, notificarCambioEstado } from '../services/notificaciones.js'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

// Acceso a la solicitud: admin o el cliente dueño (empresa o independiente)
function canAccessSolicitud(user, solicitud) {
  if (user.role === 'admin') return true
  return canAccessEmpresa(user, solicitud.empresa_id) || solicitud.persona_id === user.persona_id
}

async function clientUserId(trx, solicitud) {
  return solicitud.empresa_id
    ? (await trx('empresas').select('user_id').where('id', solicitud.empresa_id).first())?.user_id
    : (await trx('personas').select('user_id').where('id', solicitud.persona_id).first())?.user_id
}

// Solicitudes de servicio: el cliente pide algo (afiliacion, asesoria...),
// el admin lo gestiona. status: pendiente/en_proceso/completada/rechazada

// GET /solicitudes?empresa_id=&status=&page=&per_page=
export async function list(req, res) {
  const { search, status, desde, hasta, page = 1, per_page = 25 } = req.query
  const empresaId = req.user.role === 'admin' ? req.query.empresa_id : req.user.empresa_id

  const query = db('solicitudes')
    .leftJoin('empresas', 'solicitudes.empresa_id', 'empresas.id')
    .leftJoin('personas', 'solicitudes.persona_id', 'personas.id')
    .leftJoin('servicios', 'solicitudes.servicio_id', 'servicios.id')
    .select('solicitudes.*', 'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'empresas.telefono_contacto as empresa_telefono',
      'personas.num_documento as persona_nit',
      'personas.telefono as persona_telefono',
      'servicios.nombre as servicio_nombre',
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido)) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento) as cliente_nit`),
      db.raw(`COALESCE(empresas.telefono_contacto, personas.telefono) as telefono`))

  if (req.user.role !== 'admin') {
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
    .leftJoin('servicios', 'solicitudes.servicio_id', 'servicios.id')
    .select('solicitudes.*', 'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'personas.num_documento as persona_nit',
      'personas.telefono as persona_telefono',
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
  if (req.user.role !== 'admin' &&
      !canAccessEmpresa(req.user, solicitud.empresa_id) &&
      solicitud.persona_id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  res.json({ solicitud })
}

// POST /solicitudes - cliente crea solicitud; admin puede crear para cualquiera
export async function create(req, res) {
  const empresaId = req.user.role === 'admin' ? req.body.empresa_id : req.user.empresa_id
  const personaId = req.user.role === 'admin' ? req.body.persona_id : req.user.persona_id
  if (!empresaId && !personaId && req.user.role !== 'admin') {
    return res.status(400).json({ error: 'empresa_id o persona_id requerido' })
  }

  let notificationRows = []
  const solicitud = await db.transaction(async trx => {
    const [id] = await trx('solicitudes').insert({
      empresa_id: empresaId || null,
      persona_id: personaId || null,
      servicio_id: req.body.servicio_id || null,
      descripcion: req.body.descripcion || null,
      status: 'pendiente',
    })
    const created = await trx('solicitudes').where('id', id).first()
    const recipients = req.user.role === 'admin'
      ? empresaId
        ? (await trx('empresas').select('user_id').where('id', empresaId).first())?.user_id
        : personaId
          ? (await trx('personas').select('user_id').where('id', personaId).first())?.user_id
          : null
      : (await trx('users').select('id').where('role', 'admin').where('is_active', true)).map(user => user.id)

    notificationRows = await createNotifications(trx, Array.isArray(recipients) ? recipients : recipients ? [recipients] : [], {
      titulo: req.user.role === 'admin' ? 'Nueva solicitud de servicio' : 'Nueva solicitud recibida',
      mensaje: `Solicitud #${id}: ${created.descripcion || 'Servicio solicitado'}`,
      solicitudId: id,
      url: '/admin/solicitudes',
    })
    return created
  })

  publishNotifications(notificationRows)
  res.status(201).json({ solicitud })

  // Cliente crea -> correo a los admins (la notificacion in-app ya se creo arriba)
  if (req.user.role !== 'admin') {
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
  if (req.user.role === 'admin') {
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
    if (!canAccessEmpresa(req.user, solicitud.empresa_id) && solicitud.persona_id !== req.user.persona_id) {
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
      if (!serviceRecord && data.status === 'aprobada') {
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
  if (req.user.role !== 'admin') {
    if (req.file) unlinkSync(req.file.path)
    return res.status(403).json({ error: 'Solo el administrador puede adjuntar la respuesta' })
  }
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) {
    if (req.file) unlinkSync(req.file.path)
    return res.status(404).json({ error: 'Solicitud no encontrada' })
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
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede eliminar la respuesta' })
  }
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })
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

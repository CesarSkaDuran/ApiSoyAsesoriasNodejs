import db from '../db/knex.js'
import { canAccessEmpresa } from '../middlewares/auth.js'
import { createNotifications, publishNotifications } from '../realtime/notifications.js'

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
}

// PUT /solicitudes/:id - admin gestiona estados; el cliente solo puede actualizar su descripción
export async function update(req, res) {
  const solicitud = await db('solicitudes').where('id', req.params.id).first()
  if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' })

  const data = {}
  const notifications = []
  if (req.user.role === 'admin') {
    for (const campo of ['descripcion', 'servicio_id']) {
      if (req.body[campo] !== undefined) data[campo] = req.body[campo]
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

    return trx('solicitudes').where('id', solicitud.id).first()
  })

  publishNotifications(notifications)
  res.json({ solicitud: updated })
}

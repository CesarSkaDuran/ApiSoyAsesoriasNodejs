import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { notificarAdmins, notificarCambioEstado, notificarCliente } from '../services/notificaciones.js'
import { createReadStream, existsSync, unlinkSync } from 'fs'
import { resolve } from 'path'

const STORAGE_DIR = resolve(process.env.STORAGE_DIR || 'storage/documentos')

// Cuentas de cobro (viejo cuenta_cobro). status: 1=Pagado 2=Pendiente
// 3=En tramite 4=Activo 5=Rechazado
const ESTADO_LABEL = { 1: 'Pagada', 2: 'Pendiente', 3: 'En trámite', 4: 'Activa', 5: 'Rechazada' }
const labelEstado = (s) => ESTADO_LABEL[Number(s)] || `Estado ${s}`

// GET /pagos?empresa_id=&status=&search=&page=&per_page=
export async function list(req, res) {
  const { search, status, concepto, sucursal_id, desde, hasta, page = 1, per_page = 25 } = req.query
  const empresaId = esStaff(req.user) ? req.query.empresa_id : req.user.empresa_id

  const query = db('cuentas_cobro')
    .leftJoin('empresas', 'cuentas_cobro.empresa_id', 'empresas.id')
    .leftJoin('personas', 'cuentas_cobro.persona_id', 'personas.id')
    .leftJoin('terceros', 'cuentas_cobro.tercero_id', 'terceros.id')
    .leftJoin('sucursales', 'cuentas_cobro.sucursal_id', 'sucursales.id')
    .leftJoin('medios_pago', 'cuentas_cobro.medio_pago_id', 'medios_pago.id')
    .select(
      'cuentas_cobro.*',
      'empresas.razon_social as empresa_nombre',
      'empresas.num_documento as empresa_nit',
      'empresas.dv as empresa_dv',
      'personas.num_documento as persona_nit',
      'terceros.nombre as tercero_nombre',
      'terceros.num_documento as tercero_nit',
      'sucursales.nombre as sucursal_nombre',
      'medios_pago.nombre as medio_pago_nombre',
      db.raw('(SELECT COALESCE(SUM(a.valor), 0) FROM cuenta_cobro_abonos a WHERE a.cuenta_cobro_id = cuentas_cobro.id AND a.anulado = 0) AS abonado'),
      db.raw("CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido) as persona_nombre"),
      db.raw(`COALESCE(empresas.razon_social,
        CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido),
        terceros.nombre) as cliente_nombre`),
      db.raw(`COALESCE(CONCAT(empresas.num_documento, IF(empresas.dv, CONCAT('-', empresas.dv), '')),
        personas.num_documento, terceros.num_documento) as cliente_nit`),
    )

  if (!esStaff(req.user)) {
    query.where(q => {
      if (req.user.empresa_id) q.where('cuentas_cobro.empresa_id', req.user.empresa_id)
      if (req.user.persona_id) q.orWhere('cuentas_cobro.persona_id', req.user.persona_id)
      if (!req.user.empresa_id && !req.user.persona_id) q.whereRaw('1=0')
    })
  } else if (empresaId) {
    query.where('cuentas_cobro.empresa_id', empresaId)
  }

  if (status) query.where('cuentas_cobro.status', status)
  if (concepto) query.where('cuentas_cobro.nombre', 'like', `%${concepto}%`)
  if (sucursal_id) query.where('cuentas_cobro.sucursal_id', sucursal_id)
  if (desde) query.where('cuentas_cobro.fecha', '>=', desde)
  if (hasta) query.where('cuentas_cobro.fecha', '<=', hasta)
  if (search) {
    query.where(q =>
      q.where('cuentas_cobro.nombre', 'like', `%${search}%`)
       .orWhere('cuentas_cobro.numero', 'like', `%${search}%`)
       .orWhere('empresas.razon_social', 'like', `%${search}%`)
       .orWhere('empresas.num_documento', 'like', `%${search}%`)
       .orWhere('personas.num_documento', 'like', `%${search}%`)
       .orWhere('terceros.nombre', 'like', `%${search}%`)
       .orWhere('terceros.num_documento', 'like', `%${search}%`)
    )
  }

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .orderBy('cuentas_cobro.id', 'desc')
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data: data.map(conSaldo), total, page: Number(page), per_page: Number(per_page) })
}

const medioActivo = (id) => db('medios_pago').where({ id, activo: true }).first()

const r2 = (n) => Math.round(Number(n) * 100) / 100
const conSaldo = (c) => ({ ...c, abonado: r2(c.abonado || 0), saldo: r2(Number(c.valor_total || 0) - Number(c.abonado || 0)) })

// Saldo = valor total − abonos activos
async function saldoDe(cuentaId, trx = db) {
  const c = await trx('cuentas_cobro').where('id', cuentaId).first()
  const row = await trx('cuenta_cobro_abonos').where({ cuenta_cobro_id: cuentaId, anulado: false }).sum({ total: 'valor' }).first()
  return r2(Number(c?.valor_total || 0) - Number(row?.total || 0))
}

const hoy = () => new Date().toISOString().slice(0, 10)

function insertarAbono(trx, cuentaId, { valor, medioId, usuarioId, obs, fecha }) {
  return trx('cuenta_cobro_abonos').insert({
    cuenta_cobro_id: cuentaId, valor: r2(valor), fecha: fecha || hoy(),
    medio_pago_id: medioId || null, obs: obs || null, registrado_por: usuarioId || null,
  })
}

const puedeVerCuenta = (user, c) => {
  if (esStaff(user)) return true
  if (user.role === 'empresa') return !!c.empresa_id && c.empresa_id === user.empresa_id
  if (user.role === 'independiente') return !!c.persona_id && c.persona_id === user.persona_id
  return false
}

// GET /pagos/:id/comprobantes
export async function listComprobantes(req, res) {
  const c = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!c) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  if (!puedeVerCuenta(req.user, c)) return res.status(403).json({ error: 'Sin acceso' })
  const data = await db('cuenta_cobro_comprobantes as cc')
    .leftJoin('users as u', 'u.id', 'cc.subido_por')
    .where('cc.cuenta_cobro_id', c.id)
    .select('cc.*', 'u.name as subido_por_nombre')
    .orderBy('cc.id', 'desc')
  res.json({ data, cuenta_estado: Number(c.status) })
}

// POST /pagos/:id/comprobantes — comprobante de pago (archivo privado)
export async function uploadComprobante(req, res) {
  const descartar = (status, error) => {
    if (req.file) unlinkSync(req.file.path)
    return res.status(status).json({ error })
  }
  const c = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!c) return descartar(404, 'Cuenta de cobro no encontrada')
  if (!puedeVerCuenta(req.user, c)) return descartar(403, 'Sin acceso')
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })
  if (Number(c.status) === 1) return descartar(409, 'Esta cuenta ya está pagada')
  const pendiente = await db('cuenta_cobro_comprobantes').where({ cuenta_cobro_id: c.id, estado: 'pendiente' }).first()
  if (pendiente) return descartar(409, 'Ya hay un comprobante pendiente de verificación')

  const [id] = await db('cuenta_cobro_comprobantes').insert({
    cuenta_cobro_id: c.id,
    ruta_archivo: req.file.filename,
    nombre_original: req.file.originalname,
    mime_type: req.file.mimetype,
    tamano_bytes: req.file.size,
    estado: 'pendiente',
    subido_por: req.user.id,
  })
  res.status(201).json({ id })

  if (!esStaff(req.user)) {
    notificarAdmins({
      entidad: 'pago', entidadId: c.id,
      titulo: 'Comprobante de pago recibido',
      mensaje: `Cuenta #${c.numero || c.id}: el cliente subió "${req.file.originalname}" para verificar el pago.`,
      url: '/admin/pagos',
      userId: req.user.id,
    })
  }
}

// GET /pagos/comprobantes/:cid/download
export async function downloadComprobante(req, res) {
  const cc = await db('cuenta_cobro_comprobantes').where('id', req.params.cid).first()
  if (!cc) return res.status(404).json({ error: 'Comprobante no encontrado' })
  const c = await db('cuentas_cobro').where('id', cc.cuenta_cobro_id).first()
  if (!c || !puedeVerCuenta(req.user, c)) return res.status(403).json({ error: 'Sin acceso' })
  const filePath = resolve(STORAGE_DIR, cc.ruta_archivo)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Archivo no disponible' })
  res.setHeader('Content-Type', cc.mime_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cc.nombre_original || 'comprobante')}"`)
  createReadStream(filePath).pipe(res)
}

// PUT /pagos/comprobantes/:cid/verificar { accion, motivo?, medio_pago_id? }
// Aprobar: comprobante verificado + cuenta Pagada con el medio elegido.
// Rechazar: exige motivo; el cliente puede subir otro.
export async function verificarComprobante(req, res) {
  const cc = await db('cuenta_cobro_comprobantes').where('id', req.params.cid).first()
  if (!cc) return res.status(404).json({ error: 'Comprobante no encontrado' })
  if (cc.estado !== 'pendiente') return res.status(409).json({ error: 'Este comprobante ya fue revisado' })
  const c = await db('cuentas_cobro').where('id', cc.cuenta_cobro_id).first()

  const accion = req.body.accion
  if (accion !== 'aprobar' && accion !== 'rechazar') return res.status(400).json({ error: 'Acción no válida' })
  const aprobar = accion === 'aprobar'
  const motivo = (req.body.motivo || '').trim()
  if (!aprobar && !motivo) return res.status(400).json({ error: 'Indica el motivo del rechazo' })
  const medioId = Number(req.body.medio_pago_id)
  if (aprobar && (!medioId || !await medioActivo(medioId))) {
    return res.status(400).json({ error: 'Selecciona el medio de pago para aprobar' })
  }

  await db.transaction(async trx => {
    await trx('cuenta_cobro_comprobantes').where('id', cc.id).update({
      estado: aprobar ? 'verificado' : 'rechazado',
      motivo: aprobar ? null : motivo,
      verificado_por: req.user.id,
      verificado_at: trx.fn.now(),
    })
    if (aprobar) {
      const saldo = await saldoDe(c.id, trx)
      if (saldo > 0) await insertarAbono(trx, c.id, { valor: saldo, medioId, usuarioId: req.user.id, obs: 'Pago verificado por comprobante' })
      await trx('cuentas_cobro').where('id', c.id).update({ status: 1, medio_pago_id: medioId })
    }
  })

  res.json({ estado: aprobar ? 'verificado' : 'rechazado' })

  notificarCliente({
    entidad: 'pago', entidadId: c.id,
    titulo: aprobar ? `Pago verificado — cuenta #${c.numero || c.id}` : `Comprobante rechazado — cuenta #${c.numero || c.id}`,
    mensaje: aprobar ? 'Verificamos tu comprobante de pago. La cuenta quedó como pagada.' : `Tu comprobante fue rechazado: ${motivo}. Puedes subir uno nuevo.`,
    url: '/admin/pagos',
    empresaId: c.empresa_id, personaId: c.persona_id,
  })
}

// GET /pagos/:id/abonos — historial de abonos (incluye anulados para auditoría)
export async function listAbonos(req, res) {
  const c = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!c) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  if (!puedeVerCuenta(req.user, c)) return res.status(403).json({ error: 'Sin acceso' })
  const data = await db('cuenta_cobro_abonos as a')
    .leftJoin('medios_pago as m', 'm.id', 'a.medio_pago_id')
    .leftJoin('users as u', 'u.id', 'a.registrado_por')
    .where('a.cuenta_cobro_id', c.id)
    .select('a.*', 'm.nombre as medio_pago_nombre', 'u.name as registrado_por_nombre')
    .orderBy('a.id', 'desc')
  res.json({ data, saldo: await saldoDe(c.id), valor_total: r2(c.valor_total), status: Number(c.status) })
}

// POST /pagos/:id/abonos { valor, medio_pago_id, fecha?, obs? } — solo staff.
// Si el saldo llega a 0, la cuenta queda Pagada con ese medio.
export async function registrarAbono(req, res) {
  const c = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!c) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  if (Number(c.status) === 1) return res.status(409).json({ error: 'La cuenta ya está pagada' })
  if (Number(c.status) === 5) return res.status(409).json({ error: 'La cuenta está rechazada' })

  const valor = r2(req.body.valor)
  if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'El abono debe ser mayor a 0' })
  const medioId = Number(req.body.medio_pago_id)
  if (!medioId || !await medioActivo(medioId)) return res.status(400).json({ error: 'Selecciona un medio de pago válido' })

  let saldoRestante
  let errorNegocio
  await db.transaction(async trx => {
    const saldo = await saldoDe(c.id, trx)
    if (valor > saldo) throw Object.assign(new Error(`El abono no puede superar el saldo (${saldo})`), { status: 400 })
    await insertarAbono(trx, c.id, { valor, medioId, usuarioId: req.user.id, obs: req.body.obs, fecha: req.body.fecha })
    saldoRestante = r2(saldo - valor)
    if (saldoRestante <= 0) await trx('cuentas_cobro').where('id', c.id).update({ status: 1, medio_pago_id: medioId })
  }).catch(err => {
    if (err.status !== 400) throw err
    errorNegocio = err.message
  })
  if (errorNegocio) return res.status(400).json({ error: errorNegocio })

  res.status(201).json({ saldo: saldoRestante, pagada: saldoRestante <= 0 })
  notificarCliente({
    entidad: 'pago', entidadId: c.id,
    titulo: saldoRestante <= 0 ? `Cuenta pagada — #${c.numero || c.id}` : `Abono registrado — #${c.numero || c.id}`,
    mensaje: saldoRestante <= 0
      ? `Registramos el último pago de la cuenta. Quedó saldada.`
      : `Registramos un abono de $${valor.toLocaleString('es-CO')}. Saldo pendiente: $${saldoRestante.toLocaleString('es-CO')}.`,
    url: '/admin/pagos',
    empresaId: c.empresa_id, personaId: c.persona_id,
  })
}

// PUT /pagos/abonos/:aid/anular { motivo } — anula (no borra) un abono.
// Si la cuenta estaba pagada, vuelve a pendiente con el saldo que quede.
export async function anularAbono(req, res) {
  const a = await db('cuenta_cobro_abonos').where('id', req.params.aid).first()
  if (!a) return res.status(404).json({ error: 'Abono no encontrado' })
  if (a.anulado) return res.status(409).json({ error: 'El abono ya está anulado' })
  const motivo = (req.body.motivo || '').trim()
  if (!motivo) return res.status(400).json({ error: 'Indica el motivo de la anulación' })

  await db.transaction(async trx => {
    await trx('cuenta_cobro_abonos').where('id', a.id).update({ anulado: true, anulado_motivo: motivo })
    const saldo = await saldoDe(a.cuenta_cobro_id, trx)
    const c = await trx('cuentas_cobro').where('id', a.cuenta_cobro_id).first()
    if (saldo > 0 && Number(c.status) === 1) {
      await trx('cuentas_cobro').where('id', c.id).update({ status: 2, medio_pago_id: null })
    }
  })
  res.json({ ok: true, saldo: await saldoDe(a.cuenta_cobro_id) })
}

// GET /pagos/cartera?empresa_id= — cuentas con saldo pendiente, con vencimiento y antigüedad
export async function cartera(req, res) {
  const query = db('cuentas_cobro')
    .leftJoin('empresas', 'cuentas_cobro.empresa_id', 'empresas.id')
    .leftJoin('personas', 'cuentas_cobro.persona_id', 'personas.id')
    .leftJoin('terceros', 'cuentas_cobro.tercero_id', 'terceros.id')
    .whereNotIn('cuentas_cobro.status', [1, 5])
    .select(
      'cuentas_cobro.id', 'cuentas_cobro.numero', 'cuentas_cobro.nombre', 'cuentas_cobro.valor_total',
      'cuentas_cobro.status', 'cuentas_cobro.forma_pago', 'cuentas_cobro.fecha_vencimiento', 'cuentas_cobro.fecha',
      'cuentas_cobro.empresa_id', 'cuentas_cobro.persona_id',
      db.raw(`COALESCE(empresas.razon_social, CONCAT_WS(' ', personas.primer_nombre, personas.primer_apellido), terceros.nombre) AS cliente_nombre`),
      db.raw('(SELECT COALESCE(SUM(a.valor), 0) FROM cuenta_cobro_abonos a WHERE a.cuenta_cobro_id = cuentas_cobro.id AND a.anulado = 0) AS abonado'),
      db.raw('DATEDIFF(CURDATE(), cuentas_cobro.fecha_vencimiento) AS dias_vencido'),
    )
    .orderBy('cuentas_cobro.fecha_vencimiento', 'asc')
  if (!esStaff(req.user)) query.whereRaw('1=0')
  if (req.query.empresa_id) query.where('cuentas_cobro.empresa_id', req.query.empresa_id)

  const filas = (await query).map(c => {
    const saldo = r2(Number(c.valor_total || 0) - Number(c.abonado || 0))
    const dias = c.dias_vencido === null ? null : Number(c.dias_vencido)
    const estado = dias === null ? 'sin_vencimiento' : dias > 0 ? 'vencida' : dias >= -30 ? 'por_vencer' : 'vigente'
    const tramo = estado !== 'vencida' ? estado : dias <= 30 ? '1-30' : dias <= 60 ? '31-60' : dias <= 90 ? '61-90' : '+90'
    return { ...c, saldo, abonado: r2(c.abonado), dias_vencido: dias, estado, tramo }
  }).filter(c => c.saldo > 0)

  const sum = (arr) => r2(arr.reduce((s, c) => s + c.saldo, 0))
  const tramos = {}
  for (const c of filas) tramos[c.tramo] = r2((tramos[c.tramo] || 0) + c.saldo)
  res.json({
    data: filas,
    totales: {
      saldo: sum(filas),
      vencido: sum(filas.filter(c => c.estado === 'vencida')),
      por_vencer: sum(filas.filter(c => c.estado === 'por_vencer')),
      vigente: sum(filas.filter(c => c.estado === 'vigente' || c.estado === 'sin_vencimiento')),
    },
    tramos,
  })
}

// GET /pagos/:id
export async function show(req, res) {
  const cuenta = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!cuenta) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })
  if (!canAccessEmpresa(req.user, cuenta.empresa_id) && cuenta.persona_id !== req.user.persona_id) {
    return res.status(403).json({ error: 'Sin acceso' })
  }
  const detalle = await db('detalle_cobro').where('cuenta_cobro_id', cuenta.id)
  res.json({ cuenta, detalle })
}

// POST /pagos - admin crea cuenta de cobro
export async function create(req, res) {
  const { empresa_id, persona_id, tercero_id, sucursal_id, tipo, nombre, banco,
          meses, fecha, valor_total, iva, cuatroxmil, obs } = req.body
  if (!empresa_id && !persona_id && !tercero_id) {
    return res.status(400).json({ error: 'empresa_id, persona_id o tercero_id requerido' })
  }

  if (req.body.forma_pago === 'credito' && !req.body.fecha_vencimiento) {
    return res.status(400).json({ error: 'Indica la fecha de vencimiento del crédito' })
  }
  const [id] = await db('cuentas_cobro').insert({
    empresa_id: empresa_id || null,
    persona_id: persona_id || null,
    tercero_id: tercero_id || null,
    sucursal_id: sucursal_id || null,
    tipo: tipo ?? 1,
    nombre: nombre || null,
    banco: banco || null,
    meses: meses || null,
    fecha: fecha || new Date(),
    valor_total: valor_total ?? 0,
    iva: iva ?? 0,
    cuatroxmil: cuatroxmil ?? 0,
    obs: obs || null,
    status: 2, // pendiente
    forma_pago: req.body.forma_pago === 'credito' ? 'credito' : 'contado',
    fecha_vencimiento: req.body.forma_pago === 'credito' ? (req.body.fecha_vencimiento || null) : null,
  })
  const cuenta = await db('cuentas_cobro').where('id', id).first()
  res.status(201).json({ cuenta })
}

// PUT /pagos/:id - admin: cambiar estado o datos
export async function update(req, res) {
  const cuenta = await db('cuentas_cobro').where('id', req.params.id).first()
  if (!cuenta) return res.status(404).json({ error: 'Cuenta de cobro no encontrada' })

  const CAMPOS = ['empresa_id', 'persona_id', 'tercero_id', 'sucursal_id', 'tipo',
    'nombre', 'banco', 'meses', 'fecha', 'valor_total', 'iva', 'cuatroxmil', 'obs', 'status',
    'forma_pago', 'fecha_vencimiento']
  const data = {}
  for (const campo of CAMPOS) {
    if (req.body[campo] !== undefined) data[campo] = req.body[campo]
  }
  if (data.status !== undefined && Number(data.status) === 1 && Number(cuenta.status) !== 1) {
    const medioId = req.body.medio_pago_id
    if (!medioId || !await medioActivo(medioId)) return res.status(400).json({ error: 'Indica un medio de pago válido para marcar la cuenta como pagada' })
    const saldo = await saldoDe(cuenta.id)
    if (saldo > 0) await insertarAbono(db, cuenta.id, { valor: saldo, medioId, usuarioId: req.user.id, obs: 'Pago total registrado manualmente' })
    data.medio_pago_id = Number(medioId)
  } else if (data.status !== undefined && Number(data.status) !== 1) {
    if (Number(cuenta.status) === 1) {
      await db('cuenta_cobro_abonos').where({ cuenta_cobro_id: cuenta.id, anulado: false })
        .update({ anulado: true, anulado_motivo: 'Cuenta reabierta' })
    }
    data.medio_pago_id = null
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  await db('cuentas_cobro').where('id', cuenta.id).update(data)
  res.json({ cuenta: await db('cuentas_cobro').where('id', cuenta.id).first() })

  if (data.status !== undefined && Number(data.status) !== Number(cuenta.status)) {
    notificarCambioEstado({
      entidad: 'pago', entidadId: cuenta.id,
      titulo: `Cuenta de cobro ${cuenta.numero ? '#' + cuenta.numero : '#' + cuenta.id}`,
      estadoAnterior: labelEstado(cuenta.status), estadoNuevo: labelEstado(data.status),
      url: '/admin/pagos',
      empresaId: cuenta.empresa_id, personaId: cuenta.persona_id,
      detalle: `<b>Estado anterior:</b> ${labelEstado(cuenta.status)}<br><b>Estado nuevo:</b> ${labelEstado(data.status)}<br><b>Valor:</b> $${Number(cuenta.valor_total || 0).toLocaleString('es-CO')}`,
    })
  }
}

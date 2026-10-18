import db from '../db/knex.js'
import { notificarAdmins, notificarCliente } from './notificaciones.js'

// Aviso de terminación de contrato a término fijo.
//
// 30 días antes del vencimiento se notifica al equipo interno y a la
// empresa cliente (in-app + correo con consentimiento). La marca
// aviso_terminacion_at evita duplicados; si la fecha de terminación se
// prorroga/cambia, el update la reinicia a NULL y se vuelve a avisar.
//
// Se ejecuta al arranque del API y cada 24h desde index.js.

const DIAS_AVISO = 30

export function formatearFechaContrato(fecha) {
  if (!fecha) return '—'
  if (fecha instanceof Date) {
    return `${String(fecha.getUTCDate()).padStart(2, '0')}/${String(fecha.getUTCMonth() + 1).padStart(2, '0')}/${fecha.getUTCFullYear()}`
  }
  const text = String(fecha).slice(0, 10)
  const [year, month, day] = text.split('-')
  return year && month && day ? `${day}/${month}/${year}` : text
}

export function textoVencimientoContrato(dias) {
  const restantes = Number(dias)
  if (restantes === 0) return 'vence hoy'
  if (restantes === 1) return 'vence mañana'
  return `vence en ${restantes} días`
}

export async function avisarTerminaciones() {
  const pendientes = await db('empleados')
    .leftJoin('empresas', 'empresas.id', 'empleados.empresa_id')
    .where('empleados.tipo_contrato', 'fijo')
    .where('empleados.status', 'activo')
    .whereNotNull('empleados.fecha_terminacion')
    .whereNull('empleados.aviso_terminacion_at')
    .whereRaw('empleados.fecha_terminacion >= CURDATE()')
    .whereRaw('empleados.fecha_terminacion <= DATE_ADD(CURDATE(), INTERVAL ? DAY)', [DIAS_AVISO])
    .select(
      'empleados.id', 'empleados.empresa_id',
      'empleados.primer_nombre', 'empleados.segundo_nombre',
      'empleados.primer_apellido', 'empleados.segundo_apellido',
      'empleados.numero_documento', 'empleados.fecha_terminacion',
      'empresas.razon_social',
      db.raw('DATEDIFF(empleados.fecha_terminacion, CURDATE()) as dias')
    )

  for (const e of pendientes) {
    const nombre = [e.primer_nombre, e.segundo_nombre, e.primer_apellido, e.segundo_apellido]
      .filter(Boolean).join(' ')
    const dias = Number(e.dias)
    const cuando = textoVencimientoContrato(dias)
    const titulo = `Contrato a término fijo por vencer — ${nombre}`
    const fecha = formatearFechaContrato(e.fecha_terminacion)
    const mensaje = `El contrato de ${nombre} (${e.numero_documento || 's/d'})${e.razon_social ? ` — ${e.razon_social}` : ''} ${cuando}, el ${fecha}.`
    const detalle = `<b>Empleado:</b> ${nombre}<br><b>Documento:</b> ${e.numero_documento || '—'}<br><b>Empresa:</b> ${e.razon_social || '—'}<br><b>Fecha de terminación:</b> ${fecha}<br><b>Días restantes:</b> ${dias}`
    const url = `/admin/empleados/${e.id}`

    // El aviso primero, la marca después: si falla la notificación, el
    // siguiente ciclo lo reintenta en vez de perder el aviso.
    await notificarAdmins({ entidad: 'empleado', entidadId: e.id, titulo, mensaje, url, detalle })
    await notificarCliente({
      entidad: 'empleado', entidadId: e.id, titulo, mensaje, url, detalle,
      empresaId: e.empresa_id,
    })
    await db('empleados').where('id', e.id).update({ aviso_terminacion_at: db.fn.now() })
  }

  if (pendientes.length) {
    console.log(`[avisos] ${pendientes.length} contrato(s) por vencer notificado(s)`)
  }
  return pendientes.length
}

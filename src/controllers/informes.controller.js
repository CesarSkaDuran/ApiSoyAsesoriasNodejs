import db from '../db/knex.js'

// Informes administrativos (solo admin):
//  GET /informes/ingresos?desde=&hasta=&agrupar=dia|cliente
//  GET /informes/egresos?desde=&hasta=&agrupar=dia|cliente
//  GET /informes/servicios?desde=&hasta=

function rango(req) {
  const { desde, hasta } = req.query
  return { desde, hasta }
}

// Ingresos = cuentas_cobro cobradas/generadas (status != 5 rechazado)
// agrupar: dia | cliente | sucursal
export async function ingresos(req, res) {
  const { desde, hasta } = rango(req)
  const agrupar = ['cliente', 'sucursal'].includes(req.query.agrupar)
    ? req.query.agrupar
    : 'dia'

  const query = db('cuentas_cobro')
    .leftJoin('empresas', 'cuentas_cobro.empresa_id', 'empresas.id')
    .leftJoin('sucursales', 'cuentas_cobro.sucursal_id', 'sucursales.id')
    .whereNot('cuentas_cobro.status', 5)

  if (desde) query.where('cuentas_cobro.fecha', '>=', desde)
  if (hasta) query.where('cuentas_cobro.fecha', '<=', hasta)

  if (agrupar === 'sucursal') {
    const data = await query
      .select(
        db.raw("COALESCE(sucursales.nombre, 'Sin sucursal') as grupo"),
        db.raw('COUNT(*) as registros'),
        db.raw('SUM(cuentas_cobro.valor_total) as total'),
        db.raw("SUM(CASE WHEN cuentas_cobro.status = 1 THEN cuentas_cobro.valor_total ELSE 0 END) as pagado"),
        db.raw("SUM(CASE WHEN cuentas_cobro.status != 1 THEN cuentas_cobro.valor_total ELSE 0 END) as pendiente"),
      )
      .groupBy('cuentas_cobro.sucursal_id', 'sucursales.nombre')
      .orderBy('total', 'desc')
    return res.json({ data })
  }

  if (agrupar === 'cliente') {
    const data = await query
      .select(
        'empresas.razon_social as grupo',
        db.raw('COUNT(*) as registros'),
        db.raw('SUM(cuentas_cobro.valor_total) as total'),
        db.raw("SUM(CASE WHEN cuentas_cobro.status = 1 THEN cuentas_cobro.valor_total ELSE 0 END) as pagado"),
        db.raw("SUM(CASE WHEN cuentas_cobro.status != 1 THEN cuentas_cobro.valor_total ELSE 0 END) as pendiente"),
      )
      .groupBy('cuentas_cobro.empresa_id', 'empresas.razon_social')
      .orderBy('total', 'desc')
    return res.json({ data })
  }

  const data = await query
    .select(
      db.raw('DATE(cuentas_cobro.fecha) as grupo'),
      db.raw('COUNT(*) as registros'),
      db.raw('SUM(cuentas_cobro.valor_total) as total'),
    )
    .groupByRaw('DATE(cuentas_cobro.fecha)')
    .orderBy('grupo', 'desc')
  res.json({ data })
}

// Egresos = gastos
// agrupar: dia | cliente | sucursal
export async function egresos(req, res) {
  const { desde, hasta } = rango(req)
  const agrupar = ['cliente', 'sucursal'].includes(req.query.agrupar)
    ? req.query.agrupar
    : 'dia'

  const query = db('gastos')
    .leftJoin('empresas', 'gastos.empresa_id', 'empresas.id')
    .leftJoin('lista_gastos', 'gastos.lista_gasto_id', 'lista_gastos.id')
    .leftJoin('sucursales', 'gastos.sucursal_id', 'sucursales.id')

  if (desde) query.where('gastos.fecha', '>=', desde)
  if (hasta) query.where('gastos.fecha', '<=', hasta)

  if (agrupar === 'sucursal') {
    const data = await query
      .select(
        db.raw("COALESCE(sucursales.nombre, 'Sin sucursal') as grupo"),
        db.raw('COUNT(*) as registros'),
        db.raw('SUM(gastos.valor) as total'),
      )
      .groupBy('gastos.sucursal_id', 'sucursales.nombre')
      .orderBy('total', 'desc')
    return res.json({ data })
  }

  if (agrupar === 'cliente') {
    const data = await query
      .select(
        db.raw("COALESCE(empresas.razon_social, lista_gastos.nombre, 'General') as grupo"),
        db.raw('COUNT(*) as registros'),
        db.raw('SUM(gastos.valor) as total'),
      )
      .groupBy('gastos.empresa_id', 'empresas.razon_social', 'lista_gastos.nombre')
      .orderBy('total', 'desc')
    return res.json({ data })
  }

  const data = await query
    .select(
      db.raw('DATE(gastos.fecha) as grupo'),
      db.raw('COUNT(*) as registros'),
      db.raw('SUM(gastos.valor) as total'),
    )
    .groupByRaw('DATE(gastos.fecha)')
    .orderBy('grupo', 'desc')
  res.json({ data })
}

// Resumen de servicios prestados por categoria
export async function servicios(req, res) {
  const { desde, hasta } = rango(req)

  const query = db('servicio_registros')
  if (desde) query.where('servicio_registros.fecha', '>=', desde)
  if (hasta) query.where('servicio_registros.fecha', '<=', hasta)

  const data = await query
    .select(
      db.raw("COALESCE(servicio_registros.nombre, 'SIN CATEGORIA') as grupo"),
      db.raw('COUNT(*) as registros'),
      db.raw('SUM(servicio_registros.valor) as total'),
      db.raw("SUM(CASE WHEN status_pago = 1 THEN valor ELSE 0 END) as pagado"),
      db.raw("SUM(CASE WHEN status_pago = 2 THEN valor ELSE 0 END) as pendiente"),
    )
    .groupBy('servicio_registros.nombre')
    .orderBy('registros', 'desc')

  res.json({ data })
}

// Resumen general para dashboard admin
export async function resumen(req, res) {
  const [empresas, empleados, pendiente, serviciosPend, ticketsAbiertos] =
    await Promise.all([
      db('empresas').count('* as n').first(),
      db('empleados').count('* as n').first(),
      db('cuentas_cobro').whereIn('status', [2, 3]).sum('valor_total as n').first(),
      db('servicio_registros').where('status', 1).count('* as n').first(),
      db('soportes').whereIn('status', [1, 2]).count('* as n').first(),
    ])

  res.json({
    empresas: empresas.n,
    empleados: empleados.n,
    cartera_pendiente: pendiente.n || 0,
    servicios_pendientes: serviciosPend.n,
    tickets_abiertos: ticketsAbiertos.n,
  })
}

// Dashboard chart data
export async function dashboard(req, res) {
  const [
    serviciosPorEstado,
    ingresosMensuales,
    serviciosPorTipo,
    solicitudesRecientes,
    empresasRecientes,
    independientes,
  ] = await Promise.all([
    // Services by status
    db('servicio_registros')
      .select('status')
      .count('* as total')
      .groupBy('status'),
    // Monthly income (last 6 months)
    db('cuentas_cobro')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as mes"))
      .sum('valor_total as total')
      .whereRaw("fecha >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)")
      .whereNot('status', 5)
      .groupByRaw("DATE_FORMAT(fecha, '%Y-%m')")
      .orderBy('mes'),
    // Services by type (top 6)
    db('servicio_registros')
      .select('nombre')
      .count('* as total')
      .groupBy('nombre')
      .orderBy('total', 'desc')
      .limit(6),
    // Recent solicitudes (last 5)
    db('solicitudes')
      .select('solicitudes.*')
      .orderBy('solicitudes.created_at', 'desc')
      .limit(5),
    // Recent empresas (last 5)
    db('empresas')
      .select('id', 'razon_social', 'status', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5),
    // Independent count
    db('personas').count('* as n').first(),
  ])

  const statusLabels = { 1: 'Pendiente', 2: 'Finalizado', 3: 'Verificado', 4: 'En trámite' }

  res.json({
    servicios_por_estado: serviciosPorEstado.map(r => ({
      estado: statusLabels[r.status] || `Estado ${r.status}`,
      total: r.total,
    })),
    ingresos_mensuales: ingresosMensuales.map(r => ({
      mes: r.mes,
      total: parseFloat(r.total) || 0,
    })),
    servicios_por_tipo: serviciosPorTipo.map(r => ({
      nombre: r.nombre,
      total: r.total,
    })),
    solicitudes_recientes: solicitudesRecientes,
    empresas_recientes: empresasRecientes,
    independientes: independientes?.n || 0,
  })
}

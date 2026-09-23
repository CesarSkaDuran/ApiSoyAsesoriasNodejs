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

// Resumen del cliente logueado (empresa o independiente) para su home.
// Todos los conteos quedan aislados al tenant del usuario.
export async function miResumen(req, res) {
  const empresaId = req.user.empresa_id || null
  const personaId = req.user.persona_id || null

  // Filtra tablas con columna empresa_id/persona_id al scope del cliente
  const scopeCliente = (q, table) => q.where(b => {
    if (empresaId) b.where(`${table}.empresa_id`, empresaId)
    if (personaId) b.orWhere(`${table}.persona_id`, personaId)
    if (!empresaId && !personaId) b.whereRaw('1=0')
  })

  const scopeEmpresa = (q, table) => empresaId
    ? q.where(`${table}.empresa_id`, empresaId)
    : q.whereRaw('1=0')

  const [
    empleadosActivos, cuentasPorEstado, carteraPendiente, pagosMensuales,
    serviciosPorEstado, serviciosPorTipo, nominas, planillas, documentos,
    solicitudesPorEstado, soportesPorEstado, diagnosticosPorEstado,
    solicitudesRecientes, ultimaNomina,
  ] = await Promise.all([
    db('empleados').where('empresa_id', empresaId || -1).where('status', 'activo').count('* as n').first(),
    scopeCliente(db('cuentas_cobro'), 'cuentas_cobro').select('status').count('* as total').groupBy('status'),
    scopeCliente(db('cuentas_cobro'), 'cuentas_cobro').whereIn('status', [2, 3]).sum('valor_total as n').first(),
    scopeCliente(db('cuentas_cobro'), 'cuentas_cobro')
      .select(
        db.raw("DATE_FORMAT(fecha, '%Y-%m') as mes"),
        db.raw('SUM(valor_total) as total'),
        db.raw('SUM(CASE WHEN status = 1 THEN valor_total ELSE 0 END) as pagado')
      )
      .whereRaw("fecha >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)")
      .whereNot('status', 5)
      .groupByRaw("DATE_FORMAT(fecha, '%Y-%m')")
      .orderBy('mes'),
    scopeCliente(db('servicio_registros'), 'servicio_registros').select('status').count('* as total').groupBy('status'),
    scopeCliente(db('servicio_registros'), 'servicio_registros')
      .select('nombre').count('* as total').groupBy('nombre').orderBy('total', 'desc').limit(6),
    scopeEmpresa(db('nominas'), 'nominas').count('* as n').first(),
    scopeEmpresa(db('planillas'), 'planillas').count('* as n').first(),
    scopeCliente(db('documentos'), 'documentos').count('* as n').first(),
    scopeCliente(db('solicitudes'), 'solicitudes').select('status').count('* as total').groupBy('status'),
    db('soportes').where('user_id', req.user.id).select('status').count('* as total').groupBy('status'),
    scopeCliente(db('diagnosticos'), 'diagnosticos').select('estado').count('* as total').groupBy('estado'),
    scopeCliente(db('solicitudes'), 'solicitudes')
      .select('solicitudes.id', 'solicitudes.descripcion', 'solicitudes.status', 'solicitudes.created_at')
      .orderBy('solicitudes.id', 'desc').limit(5),
    scopeEmpresa(db('nominas'), 'nominas').orderBy('id', 'desc').first(),
  ])

  const SERVICIO_ESTADOS = { 1: 'Pendiente', 2: 'Finalizado', 3: 'Verificado', 4: 'En trámite', 5: 'Cancelado' }
  const CUENTA_ESTADOS = { 1: 'Pagada', 2: 'Pendiente', 3: 'En trámite', 4: 'Activa', 5: 'Rechazada' }
  const SOPORTE_ESTADOS = { 1: 'Pendiente', 2: 'En proceso', 3: 'Resuelto', 4: 'Cerrado', 5: 'Rechazado' }

  res.json({
    empleados_activos: Number(empleadosActivos?.n) || 0,
    nominas_total: Number(nominas?.n) || 0,
    planillas_total: Number(planillas?.n) || 0,
    documentos_total: Number(documentos?.n) || 0,
    ultima_nomina: ultimaNomina || null,
    cartera_pendiente: parseFloat(carteraPendiente?.n) || 0,
    cuentas_por_estado: cuentasPorEstado.map(r => ({
      estado: CUENTA_ESTADOS[r.status] || `Estado ${r.status}`, total: Number(r.total),
    })),
    pagos_mensuales: pagosMensuales.map(r => ({
      mes: r.mes, total: parseFloat(r.total) || 0, pagado: parseFloat(r.pagado) || 0,
    })),
    servicios_por_estado: serviciosPorEstado.map(r => ({
      estado: SERVICIO_ESTADOS[r.status] || `Estado ${r.status}`, total: Number(r.total),
    })),
    servicios_por_tipo: serviciosPorTipo.map(r => ({ nombre: r.nombre, total: Number(r.total) })),
    solicitudes_por_estado: solicitudesPorEstado.map(r => ({ estado: r.status, total: Number(r.total) })),
    soportes_por_estado: soportesPorEstado.map(r => ({
      estado: SOPORTE_ESTADOS[r.status] || `Estado ${r.status}`, total: Number(r.total),
    })),
    diagnosticos_por_estado: diagnosticosPorEstado.map(r => ({ estado: r.estado, total: Number(r.total) })),
    solicitudes_recientes: solicitudesRecientes,
  })
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

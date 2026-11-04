import db from '../db/knex.js'

export async function consultarInformeSolicitudes({
  desde,
  hasta,
  tipoCliente = 'todos',
  empresaId = null,
  personaId = null,
  incluirClientes = true,
}) {
  const crearConsulta = () => {
    const query = db('solicitudes as s')
      .leftJoin('empresas as e', 's.empresa_id', 'e.id')
      .leftJoin('personas as p', 's.persona_id', 'p.id')
    if (desde) query.where('s.created_at', '>=', `${desde} 00:00:00`)
    if (hasta) query.where('s.created_at', '<=', `${hasta} 23:59:59`)
    if (tipoCliente === 'empresa') query.whereNotNull('s.empresa_id')
    if (tipoCliente === 'independiente') query.whereNotNull('s.persona_id')
    if (empresaId) query.where('s.empresa_id', empresaId)
    if (personaId) query.where('s.persona_id', personaId)
    return query
  }

  const [resumen, porEstado, porDia, porTipo, porCliente] = await Promise.all([
    crearConsulta()
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("SUM(CASE WHEN s.status = 'pendiente' THEN 1 ELSE 0 END) as pendientes"),
        db.raw("SUM(CASE WHEN s.status = 'aprobada' THEN 1 ELSE 0 END) as aprobadas"),
        db.raw("SUM(CASE WHEN s.status = 'en_proceso' THEN 1 ELSE 0 END) as en_proceso"),
        db.raw("SUM(CASE WHEN s.status = 'completada' THEN 1 ELSE 0 END) as completadas"),
        db.raw("SUM(CASE WHEN s.status = 'rechazada' THEN 1 ELSE 0 END) as rechazadas"),
        db.raw("SUM(CASE WHEN s.status = 'cancelada' THEN 1 ELSE 0 END) as canceladas"),
        db.raw('SUM(CASE WHEN s.empresa_id IS NOT NULL THEN 1 ELSE 0 END) as empresas'),
        db.raw('SUM(CASE WHEN s.persona_id IS NOT NULL THEN 1 ELSE 0 END) as independientes'),
      )
      .first(),
    crearConsulta()
      .select('s.status as grupo')
      .count('* as registros')
      .groupBy('s.status')
      .orderBy('registros', 'desc'),
    crearConsulta()
      .select(db.raw("DATE_FORMAT(s.created_at, '%Y-%m-%d') as grupo"))
      .count('* as registros')
      .groupByRaw('DATE(s.created_at)')
      .orderBy('grupo'),
    crearConsulta()
      .select(db.raw("COALESCE(s.tipo_solicitud, 'general') as grupo"))
      .count('* as registros')
      .groupBy('s.tipo_solicitud')
      .orderBy('registros', 'desc'),
    incluirClientes
      ? crearConsulta()
          .select(
            db.raw("COALESCE(e.razon_social, CONCAT_WS(' ', p.primer_nombre, p.primer_apellido), 'Sin cliente') as grupo"),
            db.raw("CASE WHEN s.empresa_id IS NOT NULL THEN 'empresa' ELSE 'independiente' END as tipo_cliente"),
          )
          .count('* as registros')
          .groupBy('s.empresa_id', 's.persona_id', 'e.razon_social', 'p.primer_nombre', 'p.primer_apellido')
          .orderBy('registros', 'desc')
          .limit(30)
      : Promise.resolve([]),
  ])

  const numero = value => Number(value) || 0
  return {
    resumen: Object.fromEntries(Object.entries(resumen).map(([key, value]) => [key, numero(value)])),
    por_estado: porEstado,
    por_dia: porDia,
    por_tipo: porTipo,
    por_cliente: porCliente,
  }
}

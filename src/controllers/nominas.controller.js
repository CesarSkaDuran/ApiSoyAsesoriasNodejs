import db from '../db/knex.js'
import { canAccessEmpresa, esStaff } from '../middlewares/auth.js'
import { liquidarEmpleado as calcularEmpleado, corteVigente } from '../nomina-calculator.js'
import { planoNomina, planoConceptos } from '../nomina-plano.js'
import { NOMINA_PARAMETER_FIELDS, NOMINA_JSON_FIELDS } from '../nomina-parameters.js'
import { festivosDelAnio, noLaboralInfo } from '../festivos.js'

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100

const MESES_PERIODO = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const isoDate = value => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value || '').slice(0, 10)
const diffDias = (desde, hasta) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)

// Resuelve [inicio, fin] del período: columnas explícitas o el nombre
// ("Enero 2026 - 1a quincena"). Null si no se puede deducir.
function periodoFechas(nomina) {
  if (nomina.fecha_inicio && nomina.fecha_fin) {
    return [isoDate(nomina.fecha_inicio), isoDate(nomina.fecha_fin)]
  }
  const label = String(nomina.nombre_periodo || '').toLowerCase()
  const mesNombre = Object.keys(MESES_PERIODO).find(m => label.includes(m))
  const year = Number(label.match(/\b(20\d{2})\b/)?.[1] || nomina.vigencia)
  if (!mesNombre || !year) return null
  const mes = MESES_PERIODO[mesNombre]
  const ultimoDia = new Date(Date.UTC(year, mes, 0)).getUTCDate()
  const segunda = /2\s*a?\s*quincena|segunda\s+quincena/.test(label)
  const primera = /1\s*a?\s*quincena|primera\s+quincena/.test(label)
  const pad = n => String(n).padStart(2, '0')
  const inicio = segunda ? 16 : 1
  const fin = segunda ? ultimoDia : primera ? 15 : ultimoDia
  return [`${year}-${pad(mes)}-${pad(inicio)}`, `${year}-${pad(mes)}-${pad(fin)}`]
}

// Festivos del año como Map fecha → nombre. Si la tabla no tiene filas
// para el año (fuera del rango sembrado por la migración) se calculan por
// calendario — nunca queda vacío.
async function festivosDeAnio(anio) {
  try {
    const rows = await db('festivos')
      .select('nombre', db.raw("DATE_FORMAT(fecha, '%Y-%m-%d') as fecha"))
      .whereRaw('YEAR(fecha) = ?', [anio])
      .orderBy('fecha')
    if (rows.length) return new Map(rows.map(r => [r.fecha, r.nombre]))
  } catch { /* tabla aún no migrada: se calcula por calendario */ }
  return new Map(festivosDelAnio(anio).map(f => [f.fecha, f.nombre]))
}

// Parámetros de la vigencia pedida, o la más cercana anterior disponible
// (consulta amable: una fecha de un año no configurado usa la última
// vigencia que sí existe).
async function parametrosDeVigencia(anio) {
  return await db('nomina_parametros').where('vigencia', anio).first()
    || await db('nomina_parametros').where('vigencia', '<=', anio).orderBy('vigencia', 'desc').first()
    || await db('nomina_parametros').orderBy('vigencia', 'desc').first()
}

export async function getParametros(req, res) {
  const vigencia = Number(req.params.vigencia)
  if (!Number.isInteger(vigencia) || vigencia < 2000 || vigencia > 2100) {
    return res.status(400).json({ error: 'Vigencia no válida' })
  }
  const parametros = await db('nomina_parametros').where('vigencia', vigencia).first()
  if (!parametros) return res.status(404).json({ error: `No hay parámetros para ${vigencia}` })
  res.json({ parametros })
}

export async function updateParametros(req, res) {
  const vigencia = Number(req.params.vigencia)
  if (!Number.isInteger(vigencia) || vigencia < 2000 || vigencia > 2100) {
    return res.status(400).json({ error: 'Vigencia no válida' })
  }

  const data = {}
  for (const key of NOMINA_JSON_FIELDS) {
    if (req.body[key] === undefined) continue
    const value = req.body[key]
    if (!Array.isArray(value) || !value.length) {
      return res.status(400).json({ error: `${key} debe ser una lista no vacía` })
    }
    const valida = value.every(item => item && typeof item === 'object' &&
      (key === 'retencion_tabla'
        ? Number.isFinite(Number(item.desde)) && Number.isFinite(Number(item.tarifa))
        : FECHA_RE.test(String(item.desde)) &&
          (Number.isFinite(Number(item.horas_semanales)) || Number.isFinite(Number(item.pct)))))
    if (!valida) return res.status(400).json({ error: `${key} tiene un formato no válido` })
    data[key] = JSON.stringify(value)
  }
  for (const key of NOMINA_PARAMETER_FIELDS) {
    if (req.body[key] === undefined) continue
    const value = Number(req.body[key])
    if (!Number.isFinite(value) || value < 0 || (key.includes('_pct') && value > 100)) {
      return res.status(400).json({ error: `${key} tiene un valor no válido` })
    }
    if (['salario_minimo', 'uvt', 'auxilio_tope_smmlv', 'max_ibc_smmlv'].includes(key) && value === 0) {
      return res.status(400).json({ error: `${key} debe ser mayor que cero` })
    }
    data[key] = value
  }
  if (req.body.fuente_normativa !== undefined) {
    data.fuente_normativa = String(req.body.fuente_normativa).slice(0, 500)
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'No hay parámetros para actualizar' })

  const existing = await db('nomina_parametros').where('vigencia', vigencia).first()
  if (!existing) return res.status(404).json({ error: `No hay parámetros para ${vigencia}` })
  await db('nomina_parametros').where('vigencia', vigencia).update({ ...data, updated_at: new Date() })
  res.json({ parametros: await db('nomina_parametros').where('vigencia', vigencia).first() })
}

// GET /nominas/festivos?anio=AAAA - calendario de días no laborables.
export async function listFestivos(req, res) {
  const anio = Number(req.query.anio) || new Date().getFullYear()
  if (anio < 2000 || anio > 2100) return res.status(400).json({ error: 'Año no válido' })
  const festivos = [...await festivosDeAnio(anio)].map(([fecha, nombre]) => ({ fecha, nombre }))
  res.json({ data: festivos })
}

// GET /nominas/normativa?vigencia=AAAA - consulta de solo lectura de los
// valores y porcentajes que rigen la liquidación (los mismos que edita el
// diálogo de parámetros), con el calendario de festivos del año.
const NORMATIVA_CAMPOS = [
  'vigencia', 'salario_minimo', 'auxilio_transporte', 'auxilio_tope_smmlv',
  'uvt', 'jornada_cortes', 'dominical_cortes',
  'extra_diurna_pct', 'extra_nocturna_pct', 'recargo_nocturno_pct',
  'extras_max_diarias', 'extras_max_semanales', 'fuente_normativa',
]
export async function normativa(req, res) {
  const hoy = new Date().toISOString().slice(0, 10)
  const anio = Number(req.query.vigencia) || Number(hoy.slice(0, 4))
  const parametros = await parametrosDeVigencia(anio)
  if (!parametros) return res.status(404).json({ error: 'No hay parámetros de nómina configurados' })
  const jornada = corteVigente(parametros.jornada_cortes, 'horas_semanales', hoy) ?? 48
  const dominical = corteVigente(parametros.dominical_cortes, 'pct', hoy) ?? 75
  const vigencias = (await db('nomina_parametros').select('vigencia').orderBy('vigencia', 'desc'))
    .map(r => r.vigencia)
  const festivos = [...await festivosDeAnio(anio)].map(([fecha, nombre]) => ({ fecha, nombre }))
  const campos = Object.fromEntries(NORMATIVA_CAMPOS.map(k => [k, parametros[k]]))
  res.json({
    normativa: { ...campos, jornada_semanal: jornada, horas_mes: jornada * 5, dominical_pct: dominical },
    vigencias,
    festivos,
  })
}

// GET /nominas/valor-hora?salario=&fecha=AAAA-MM-DD - valor de la hora
// ordinaria y la tabla de recargos/extras vigentes en esa fecha.
export async function valorHora(req, res) {
  const salario = Number(req.query.salario)
  if (!Number.isFinite(salario) || salario <= 0) {
    return res.status(400).json({ error: 'salario debe ser mayor que cero' })
  }
  const fecha = FECHA_RE.test(String(req.query.fecha || ''))
    ? String(req.query.fecha).slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const parametros = await parametrosDeVigencia(Number(fecha.slice(0, 4)))
  if (!parametros) return res.status(404).json({ error: 'No hay parámetros de nómina configurados' })

  const jornada = corteVigente(parametros.jornada_cortes, 'horas_semanales', fecha) ?? 48
  const dominical = corteVigente(parametros.dominical_cortes, 'pct', fecha) ?? 75
  const extD = Number(parametros.extra_diurna_pct ?? 25)
  const extN = Number(parametros.extra_nocturna_pct ?? 75)
  const recN = Number(parametros.recargo_nocturno_pct ?? 35)
  const valorOrdinaria = salario / (jornada * 5)
  const fila = (concepto, recargoPct, factor) => ({
    concepto,
    recargo_pct: recargoPct === null ? null : round2(recargoPct),
    factor: round2(factor),
    valor: round2(valorOrdinaria * factor),
  })
  const conceptos = [
    fila('Hora ordinaria diurna', null, 1),
    fila('Recargo nocturno (ordinario)', recN, 1 + recN / 100),
    fila('Hora extra diurna', extD, 1 + extD / 100),
    fila('Hora extra nocturna', extN, 1 + extN / 100),
    fila('Dominical/festivo diurna', dominical, 1 + dominical / 100),
    fila('Dominical/festivo nocturna', dominical + recN, 1 + dominical / 100 + recN / 100),
    fila('Extra diurna dominical/festivo', extD + dominical, 1 + extD / 100 + dominical / 100),
    fila('Extra nocturna dominical/festivo', extN + dominical, 1 + extN / 100 + dominical / 100),
  ]
  const noLaboral = noLaboralInfo(fecha, await festivosDeAnio(Number(fecha.slice(0, 4))))
  res.json({
    salario, fecha,
    vigencia: parametros.vigencia,
    jornada_semanal: jornada,
    horas_mes: jornada * 5,
    dominical_pct: dominical,
    valor_hora: round2(valorOrdinaria),
    es_no_laboral: noLaboral.es_no_laboral,
    motivo_no_laboral: noLaboral.motivo,
    conceptos,
  })
}

// GET /nominas/conceptos - catálogo de conceptos (filtros server-side:
// activos=1|0|all, tratamiento=gravable|incr, salarial=1|0, pendiente=1, q)
export async function listConceptos(req, res) {
  const query = db('conceptos_nomina').orderBy('nombre')
  if (req.query.activos !== 'all') query.where('activo', req.query.activos === '0' ? 0 : 1)
  if (['gravable', 'incr'].includes(req.query.tratamiento)) {
    query.where('tratamiento_fiscal', req.query.tratamiento)
  }
  if (['0', '1'].includes(req.query.salarial)) {
    query.where('constitutivo_salario', Number(req.query.salarial))
  }
  if (req.query.pendiente === '1') query.where('activo_pendiente_verificacion', 1)
  const q = String(req.query.q || '').trim()
  if (q) query.where('nombre', 'like', `%${q}%`)
  res.json({ data: await query })
}

export async function createConcepto(req, res) {
  const nombre = String(req.body.nombre || '').trim()
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' })
  const [id] = await db('conceptos_nomina').insert({
    nombre: nombre.slice(0, 120),
    constitutivo_salario: req.body.constitutivo_salario !== false && req.body.constitutivo_salario !== 0,
    tratamiento_fiscal: req.body.tratamiento_fiscal === 'incr' ? 'incr' : 'gravable',
    limite_incr_uvt: Number(req.body.limite_incr_uvt) > 0 ? Number(req.body.limite_incr_uvt) : null,
    condicion_salario_uvt: Number(req.body.condicion_salario_uvt) > 0 ? Number(req.body.condicion_salario_uvt) : null,
    activo_pendiente_verificacion: req.body.activo_pendiente_verificacion === true || req.body.activo_pendiente_verificacion === 1,
    fuente_normativa: req.body.fuente_normativa ? String(req.body.fuente_normativa).slice(0, 300) : null,
    activo: 1,
  })
  res.status(201).json({ concepto: await db('conceptos_nomina').where('id', id).first() })
}

export async function updateConcepto(req, res) {
  const concepto = await db('conceptos_nomina').where('id', req.params.id).first()
  if (!concepto) return res.status(404).json({ error: 'Concepto no encontrado' })
  const data = { updated_at: new Date() }
  if (req.body.nombre !== undefined) {
    const nombre = String(req.body.nombre || '').trim()
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' })
    data.nombre = nombre.slice(0, 120)
  }
  if (req.body.constitutivo_salario !== undefined) {
    data.constitutivo_salario = req.body.constitutivo_salario === true || req.body.constitutivo_salario === 1
  }
  if (req.body.tratamiento_fiscal !== undefined) {
    if (!['gravable', 'incr'].includes(req.body.tratamiento_fiscal)) {
      return res.status(400).json({ error: 'tratamiento_fiscal debe ser gravable o incr' })
    }
    data.tratamiento_fiscal = req.body.tratamiento_fiscal
  }
  for (const campo of ['limite_incr_uvt', 'condicion_salario_uvt']) {
    if (req.body[campo] !== undefined) {
      data[campo] = Number(req.body[campo]) > 0 ? Number(req.body[campo]) : null
    }
  }
  if (req.body.fuente_normativa !== undefined) {
    data.fuente_normativa = req.body.fuente_normativa ? String(req.body.fuente_normativa).slice(0, 300) : null
  }
  if (req.body.activo !== undefined) {
    data.activo = req.body.activo === true || req.body.activo === 1
  }
  if (req.body.activo_pendiente_verificacion !== undefined) {
    data.activo_pendiente_verificacion = req.body.activo_pendiente_verificacion === true || req.body.activo_pendiente_verificacion === 1
  }
  await db('conceptos_nomina').where('id', concepto.id).update(data)
  res.json({ concepto: await db('conceptos_nomina').where('id', concepto.id).first() })
}

// GET /nominas - scoped: empresa ve solo las suyas; admin ve todas o filtra por ?empresa_id
export async function list(req, res) {
  const empresaId = esStaff(req.user)
    ? req.query.empresa_id
    : req.user.empresa_id

  if (!esStaff(req.user) && !empresaId) {
    return res.status(400).json({ error: 'empresa_id requerido' })
  }

  const { status, page = 1, per_page = 25 } = req.query

  const query = db('nominas')
    .leftJoin('empresas', 'nominas.empresa_id', 'empresas.id')
    .select('nominas.*', 'empresas.razon_social as empresa_nombre',
      db.raw(`(SELECT COALESCE(SUM(nd.salario_base * nd.dias_laborados / 30), 0)
        FROM nomina_detalles nd WHERE nd.nomina_id = nominas.id) as salario_dias`))
    .orderBy('nominas.id', 'desc')

  if (empresaId) query.where('nominas.empresa_id', empresaId)
  if (status) query.where('nominas.status', status)

  const [{ total }] = await query.clone().count('* as total')
  const data = await query
    .limit(Number(per_page))
    .offset((Number(page) - 1) * Number(per_page))

  res.json({ data, total, page: Number(page), per_page: Number(per_page) })
}

// GET /nominas/:id - nomina con su detalle por empleado
export async function show(req, res) {
  const nomina = await db('nominas')
    .leftJoin('empresas', 'nominas.empresa_id', 'empresas.id')
    .select('nominas.*', 'empresas.razon_social as empresa_nombre')
    .where('nominas.id', req.params.id)
    .first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }

  const detalles = await db('nomina_detalles')
    .leftJoin('empleados', 'nomina_detalles.empleado_id', 'empleados.id')
    .select(
      'nomina_detalles.*',
      'empleados.primer_nombre',
      'empleados.primer_apellido',
      'empleados.numero_documento'
    )
    .where('nomina_id', nomina.id)

  res.json({ nomina, detalles })
}

// POST /nominas - admin crea la cabecera (borrador) para una empresa/periodo
export async function create(req, res) {
  const { empresa_id, nombre_periodo } = req.body
  if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' })

  const yearFromLabel = String(nombre_periodo || '').match(/\b(20\d{2})\b/)
  const vigencia = Number(req.body.vigencia || yearFromLabel?.[1] || new Date().getFullYear())
  const parametros = await db('nomina_parametros').where('vigencia', vigencia).first()
  if (!parametros) return res.status(400).json({ error: `No hay parámetros de nómina configurados para ${vigencia}` })

  for (const campo of ['fecha_inicio', 'fecha_fin']) {
    if (req.body[campo] !== undefined && req.body[campo] !== null && !FECHA_RE.test(String(req.body[campo]))) {
      return res.status(400).json({ error: `${campo} debe tener formato AAAA-MM-DD` })
    }
  }

  const [id] = await db('nominas').insert({
    empresa_id,
    nombre_periodo: nombre_periodo || null,
    vigencia,
    dias_periodo: Number(req.body.dias_periodo) === 15 ? 15 : 30,
    aplica_exoneracion: req.body.aplica_exoneracion === true || req.body.aplica_exoneracion === 1,
    fecha_inicio: req.body.fecha_inicio || null,
    fecha_fin: req.body.fecha_fin || null,
    status: 'borrador',
  })
  res.status(201).json({ nomina: await db('nominas').where('id', id).first() })
}

export async function liquidar(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }
  if (nomina.status === 'pagada') {
    return res.status(409).json({ error: 'No se puede reliquidar una nómina pagada' })
  }

  const items = Array.isArray(req.body.empleados) ? req.body.empleados : []
  if (!items.length) return res.status(400).json({ error: 'empleados requerido' })
  const empleadoIds = [...new Set(items.map(i => Number(i.empleado_id)).filter(Number.isInteger))]
  if (!empleadoIds.length) return res.status(400).json({ error: 'IDs de empleados no válidos' })

  const parametros = await db('nomina_parametros').where('vigencia', nomina.vigencia).first()
  if (!parametros) return res.status(400).json({ error: `No hay parámetros para la vigencia ${nomina.vigencia}` })

  // Festivos de la vigencia y el año adyacente (períodos que cruzan diciembre/
  // enero): se adjuntan a los parámetros para marcar filas de horas en día
  // no laboral y quedan en el snapshot de la liquidación.
  const festivosMap = new Map()
  for (let a = Number(nomina.vigencia) - 1; a <= Number(nomina.vigencia) + 1; a++) {
    for (const [fecha, nombre] of await festivosDeAnio(a)) festivosMap.set(fecha, nombre)
  }
  parametros.festivos = Object.fromEntries(festivosMap)

  const empleados = await db('empleados')
    .where('empresa_id', nomina.empresa_id)
    .whereIn('id', empleadoIds)
    .where(builder => builder.whereNull('tipo_contrato').orWhereNotIn('tipo_contrato', ['prestacion', 'aprendizaje']))
  if (empleados.length !== empleadoIds.length) {
    return res.status(400).json({ error: 'La nómina incluye empleados no válidos o con contrato de prestación/aprendizaje, que requieren liquidación diferenciada' })
  }
  const riesgosValidos = new Set(['I', 'II', 'III', 'IV', 'V'])
  const sinRiesgo = empleados.filter(empleado => !riesgosValidos.has(empleado.riesgo))
  if (sinRiesgo.length) {
    return res.status(400).json({ error: `Asigna la clase de riesgo ARL a todos los empleados: ${sinRiesgo.map(e => e.id).join(', ')}` })
  }

  // Catálogo de conceptos: resuelve salarialidad y tratamiento fiscal por fila
  const conceptoIds = [...new Set(items
    .flatMap(i => (Array.isArray(i.ingresos) ? i.ingresos : []))
    .map(g => Number(g.concepto_id))
    .filter(Number.isInteger))]
  const conceptos = conceptoIds.length
    ? await db('conceptos_nomina').whereIn('id', conceptoIds)
      .where('activo', 1).where('activo_pendiente_verificacion', 0)
    : []
  if (conceptos.length !== conceptoIds.length) {
    return res.status(400).json({ error: 'La liquidación incluye conceptos no válidos o inactivos' })
  }
  const conceptoMap = new Map(conceptos.map(c => [c.id, c]))

  // El INCR manual (monto plano sin concepto) es la excepción y exige motivo
  const incrSinMotivo = items.filter(i =>
    Number(i.ingreso_noc) > 0 &&
    (i.ingreso_noc_incr === true || i.ingreso_noc_incr === 1) &&
    !String(i.ingreso_noc_incr_motivo || '').trim())
  if (incrSinMotivo.length) {
    return res.status(400).json({
      error: `El INCR manual requiere motivo (empleados: ${incrSinMotivo.map(i => i.empleado_id).join(', ')}). Usa el catálogo de conceptos para casos recurrentes.`,
    })
  }

  // Salario base menor al SMMLV vigente exige motivo obligatorio
  // (CST art. 143 — ej. medio tiempo, contrato especial). El motivo puede
  // venir del input de liquidación o de la ficha del empleado. La liquidación
  // prosigue con alerta persistida, pero el motivo bloquea el guardado.
  const smmlvVigente = Number(parametros.salario_minimo) || 0
  const bajoMinimoSinMotivo = empleados.filter(e => {
    if (!smmlvVigente || Number(e.salario_base) >= smmlvVigente) return false
    const sub = items.find(i => Number(i.empleado_id) === e.id) || {}
    return !String(sub.salario_menor_motivo || '').trim()
      && !String(e.salario_menor_motivo || '').trim()
  })
  if (bajoMinimoSinMotivo.length) {
    return res.status(400).json({
      error: 'Salario inferior al SMMLV requiere motivo',
      empleados_bloqueados: bajoMinimoSinMotivo.map(e => ({
        id: e.id,
        nombre: [e.primer_nombre, e.primer_apellido].filter(Boolean).join(' ').trim(),
        documento: e.numero_documento,
        salario: Number(e.salario_base),
      })),
    })
  }

  // Elegibilidad del salario integral (CST art. 132): piso = 10 SMMLV ×
  // (1 + factor prestacional de la empresa). Bloqueante en liquidación
  // también — un empleado pudo quedar flagged antes de un cambio de salario.
  const esIntegral = e => e.salario_integral === true || e.salario_integral === 1
  const conIntegral = empleados.filter(esIntegral)
  if (conIntegral.length && smmlvVigente) {
    const empresa = await db('empresas').where('id', nomina.empresa_id).first()
    const factor = Number(empresa?.factor_prestacional_pct ?? 30)
    const pisoIntegral = smmlvVigente * 10 * (1 + factor / 100)
    const invalidos = conIntegral.filter(e => Number(e.salario_base) < pisoIntegral)
    if (invalidos.length) {
      return res.status(400).json({
        error: `Salario integral por debajo del mínimo legal (≥ $${Math.round(pisoIntegral).toLocaleString('es-CO')}, CST art. 132)`,
        empleados_integral_invalidos: invalidos.map(e => ({
          id: e.id,
          nombre: [e.primer_nombre, e.primer_apellido].filter(Boolean).join(' ').trim(),
          documento: e.numero_documento,
          salario: Number(e.salario_base),
          minimo_requerido: Math.round(pisoIntegral),
        })),
      })
    }
  }

  // Novedades de ausentismo que se cruzan con el período
  const fechas = periodoFechas(nomina)
  const novedadesPorEmpleado = {}
  if (fechas) {
    const [ini, fin] = fechas
    const rows = await db('incapacidades')
      .whereIn('empleado_id', empleadoIds)
      .where('fecha_inicio', '<=', fin)
      .where(q => q.whereNull('fecha_fin').orWhere('fecha_fin', '>=', ini))
    for (const row of rows) {
      const fi = isoDate(row.fecha_inicio)
      const ff = row.fecha_fin ? isoDate(row.fecha_fin) : fin
      const desde = fi > ini ? fi : ini
      const hasta = ff < fin ? ff : fin
      const diasEnPeriodo = Math.max(0, diffDias(desde, hasta) + 1)
      if (!diasEnPeriodo) continue
      ;(novedadesPorEmpleado[row.empleado_id] ||= []).push({
        tipo: row.tipo,
        dias: diasEnPeriodo,
        dias_previos: Number(row.dias_acumulado || 0) + Math.max(0, diffDias(fi, ini)),
        descripcion: `${row.tipo} ${fi} → ${ff}`,
      })
    }
  }

  // Base de vacaciones disfrutadas (CST art. 192): con salario variable se
  // toma el promedio del devengado salarial de los últimos 12 meses de nómina
  // en el sistema; sin histórico exige base manual con motivo obligatorio.
  const empleadosById = new Map(empleados.map(e => [e.id, e]))
  const idsConVac = Object.keys(novedadesPorEmpleado)
    .filter(id => novedadesPorEmpleado[id].some(n => n.tipo === 'vacaciones'))
    .map(Number)
  const vacBasePorEmpleado = {}
  for (const id of idsConVac) {
    const emp = empleadosById.get(id)
    if (!emp?.salario_variable) continue
    const prevRows = await db('nomina_detalles')
      .join('nominas', 'nomina_detalles.nomina_id', 'nominas.id')
      .where('nomina_detalles.empleado_id', id)
      .where('nominas.id', '!=', nomina.id)
      .orderBy('nominas.id', 'desc')
      .limit(12)
      .select('nomina_detalles.total_devengado', 'nomina_detalles.ingreso_noc', 'nomina_detalles.indemnizacion')
    if (prevRows.length) {
      const promedio = prevRows.reduce((s, r) =>
        s + Number(r.total_devengado) - Number(r.ingreso_noc || 0) - Number(r.indemnizacion || 0), 0) / prevRows.length
      vacBasePorEmpleado[id] = { base: round2(promedio), fuente: 'promedio_12m' }
    } else {
      const submitted = items.find(i => Number(i.empleado_id) === id) || {}
      const manual = Number(submitted.vacaciones_base)
      const motivo = String(submitted.vacaciones_motivo || '').trim()
      if (!(manual > 0) || !motivo) {
        return res.status(400).json({
          error: `Empleado ${id} tiene vacaciones con salario variable y sin histórico: ingresa vacaciones_base y vacaciones_motivo (CST art. 192)`,
        })
      }
      vacBasePorEmpleado[id] = { base: manual, fuente: 'manual', motivo }
    }
  }

  // IBC del mes inmediatamente anterior para empleados con SLN
  // (Decreto 780/2016 art. 3.2.5.2: base de cotización durante la suspensión)
  const idsConSln = Object.keys(novedadesPorEmpleado)
    .filter(id => novedadesPorEmpleado[id].some(n => n.tipo === 'no_remunerada'))
    .map(Number)
  const ibcAnteriorPorEmpleado = {}
  for (const id of idsConSln) {
    const prev = await db('nomina_detalles')
      .join('nominas', 'nomina_detalles.nomina_id', 'nominas.id')
      .where('nomina_detalles.empleado_id', id)
      .where('nominas.id', '!=', nomina.id)
      .where('nomina_detalles.ibc', '>', 0)
      .orderBy('nominas.id', 'desc')
      .select('nomina_detalles.ibc')
      .first()
    ibcAnteriorPorEmpleado[id] = prev ? Number(prev.ibc) : null
  }

  const totales = { devengado: 0, neto: 0, planilla: 0, horas: 0, otros: 0, deducciones: 0, aportes: 0, prestaciones: 0, costo: 0 }
  const alertas = []
  const horasRows = []
  const ingresoRows = []
  const dedRows = []
  const detalles = empleados.map(empleado => {
    const submitted = items.find(i => Number(i.empleado_id) === empleado.id) || {}
    const ingresos = (Array.isArray(submitted.ingresos) ? submitted.ingresos : [])
      .map(g => {
        const concepto = conceptoMap.get(Number(g.concepto_id))
        return {
          concepto_id: concepto?.id ?? null,
          concepto: concepto?.nombre || null,
          valor: Number(g.valor) || 0,
          constitutivo_salario: concepto ? !!concepto.constitutivo_salario : true,
          tratamiento_fiscal: concepto?.tratamiento_fiscal || 'gravable',
          limite_incr_uvt: concepto?.limite_incr_uvt ?? null,
          condicion_salario_uvt: concepto?.condicion_salario_uvt ?? null,
        }
      })
      .filter(g => g.valor > 0)
    const input = {
      ...submitted,
      ingresos,
      dias_laborados: submitted.dias_laborados ?? nomina.dias_periodo ?? 30,
      fecha_referencia: fechas?.[0] || null,
      novedades: (novedadesPorEmpleado[empleado.id] || []).map(n => n.tipo === 'vacaciones'
        ? { ...n, base_fuente: vacBasePorEmpleado[empleado.id]?.fuente, motivo: vacBasePorEmpleado[empleado.id]?.motivo }
        : n),
      vacaciones_base: vacBasePorEmpleado[empleado.id]?.base ?? null,
      salario_integral: empleado.salario_integral === true || empleado.salario_integral === 1,
      ibc_mes_anterior: ibcAnteriorPorEmpleado[empleado.id] ?? null,
      // El motivo de la ficha del empleado respalda el de liquidación
      salario_menor_motivo: submitted.salario_menor_motivo || empleado.salario_menor_motivo || null,
    }
    const aplicaExoneracion = nomina.aplica_exoneracion === true || nomina.aplica_exoneracion === 1
    const detalle = calcularEmpleado(empleado, input, parametros, aplicaExoneracion)
    for (const mensaje of JSON.parse(detalle.alertas || '[]')) {
      alertas.push({ empleado_id: empleado.id, mensaje })
    }
    for (const h of JSON.parse(detalle.recargos_detalle || '[]')) {
      if (!h.error) {
        horasRows.push({
          empleado_id: empleado.id, nomina_id: nomina.id,
          fecha: h.fecha || fechas?.[0] || null,
          cantidad: h.cantidad, tipo: h.tipo, valor: h.valor,
        })
      }
    }
    for (const g of JSON.parse(detalle.ingresos_detalle || '[]')) {
      ingresoRows.push({
        empleado_id: empleado.id, nomina_id: nomina.id,
        concepto_id: g.concepto_id,
        concepto: g.concepto || 'Ingreso',
        valor: g.valor,
        fecha: fechas?.[0] || null,
      })
    }
    for (const d of JSON.parse(detalle.deducciones_detalle || '[]')) {
      dedRows.push({
        empleado_id: empleado.id, nomina_id: nomina.id,
        tipo: d.tipo, concepto: d.concepto, valor: d.valor,
        fecha: fechas?.[0] || null,
      })
    }
    totales.devengado += detalle.total_devengado
    totales.neto += detalle.neto_pagar
    totales.planilla += detalle.total_planilla
    totales.horas += detalle.horas_extras
    totales.otros += detalle.otros_ingresos + detalle.ingreso_noc
    totales.deducciones += detalle.total_deducciones
    totales.aportes += detalle.total_aportes_empleador
    totales.prestaciones += detalle.total_prestaciones
    totales.costo += detalle.costo_empresa
    return { nomina_id: nomina.id, empleado_id: empleado.id, ...detalle }
  })

  const actualizada = await db.transaction(async trx => {
    await trx('nomina_detalles').where('nomina_id', nomina.id).delete()
    if (detalles.length) await trx('nomina_detalles').insert(detalles)
    await trx('horas_extras').where('nomina_id', nomina.id).delete()
    if (horasRows.length) await trx('horas_extras').insert(horasRows)
    await trx('otros_ingresos').where('nomina_id', nomina.id).delete()
    if (ingresoRows.length) await trx('otros_ingresos').insert(ingresoRows)
    await trx('deducciones').where('nomina_id', nomina.id).delete()
    if (dedRows.length) await trx('deducciones').insert(dedRows)
    await trx('nominas').where('id', nomina.id).update({
      nombre_periodo: req.body.nombre_periodo || nomina.nombre_periodo,
      num_empleados: empleados.length,
      valor_total: round2(totales.devengado),
      total_seguridad_social: round2(totales.planilla),
      total_horas_extras: round2(totales.horas),
      total_otros_pagos: round2(totales.otros),
      total_deducciones: round2(totales.deducciones),
      total_neto_pagar: round2(totales.neto),
      total_aportes_empleador: round2(totales.aportes),
      total_prestaciones: round2(totales.prestaciones),
      total_costo_empresa: round2(totales.costo),
      parametros_snapshot: JSON.stringify(parametros),
      status: 'liquidada',
    })
    return trx('nominas').where('id', nomina.id).first()
  })

  const detallesActualizados = await db('nomina_detalles')
    .leftJoin('empleados', 'nomina_detalles.empleado_id', 'empleados.id')
    .select('nomina_detalles.*', 'empleados.primer_nombre', 'empleados.primer_apellido', 'empleados.numero_documento')
    .where('nomina_detalles.nomina_id', nomina.id)
  res.json({ nomina: actualizada, detalles: detallesActualizados, alertas })
}

// Descarga del archivo plano de nómina (delimitador ';', decimales con coma,
// UTF-8 sin BOM, CRLF). ?tipo=conceptos entrega el detalle empleado×concepto.
export async function plano(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }

  const detalles = await db('nomina_detalles')
    .leftJoin('empleados', 'nomina_detalles.empleado_id', 'empleados.id')
    .leftJoin('cargos', 'empleados.cargo_id', 'cargos.id')
    .select(
      'nomina_detalles.*',
      'empleados.primer_nombre', 'empleados.segundo_nombre',
      'empleados.primer_apellido', 'empleados.segundo_apellido',
      'empleados.tipo_documento', 'empleados.numero_documento',
      'cargos.nombre as cargo_nombre'
    )
    .where('nomina_id', nomina.id)

  const esConceptos = req.query.tipo === 'conceptos'
  const contenido = esConceptos ? planoConceptos(nomina, detalles) : planoNomina(nomina, detalles)
  const nombre = esConceptos
    ? `nomina-detalle-conceptos-${nomina.id}.txt`
    : `nomina-detalle-${nomina.id}.txt`

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
  res.send(contenido)
}

// GET /nominas/pila-estado - cobertura de datos requeridos por el archivo PILA.
// Con ?empresa_id detalla también las brechas del aportante y sus cotizantes.
export async function pilaEstado(req, res) {
  const catalogos = {}
  for (const tabla of ['eps', 'arl', 'pensiones', 'cajas_compensacion']) {
    const [tot] = await db(tabla).where('activo', 1).count('id as n')
    const [con] = await db(tabla).where('activo', 1)
      .whereNotNull('codigo_pila').where('codigo_pila', '<>', '').count('id as n')
    catalogos[tabla] = { total: Number(tot.n), con_codigo: Number(con.n) }
  }
  const [dTot] = await db('departamentos').count('id as n')
  const [dCon] = await db('departamentos')
    .whereNotNull('codigo_dane').where('codigo_dane', '<>', '').count('id as n')
  const [cTot] = await db('ciudades').count('id as n')
  const [cCon] = await db('ciudades')
    .whereNotNull('codigo_dane').where('codigo_dane', '<>', '').count('id as n')
  const [cgTot] = await db('cargos').count('id as n')
  const [cgCon] = await db('cargos')
    .whereNotNull('codigo_ciuo').where('codigo_ciuo', '<>', '').count('id as n')
  const [sTot] = await db('sucursales').count('id as n')
  const [sCon] = await db('sucursales')
    .whereNotNull('codigo_pila').where('codigo_pila', '<>', '').count('id as n')
  catalogos.departamentos = { total: Number(dTot.n), con_codigo: Number(dCon.n) }
  catalogos.ciudades = { total: Number(cTot.n), con_codigo: Number(cCon.n) }
  catalogos.cargos = { total: Number(cgTot.n), con_codigo: Number(cgCon.n) }
  catalogos.sucursales = { total: Number(sTot.n), con_codigo: Number(sCon.n) }

  const empresaId = req.query.empresa_id ? Number(req.query.empresa_id) : null
  const empresasQ = db('empresas').where('status', 'activo')
  const empleadosQ = db('empleados').where('status', 'activo')
    .where(b => b.whereNull('tipo_contrato').orWhereNotIn('tipo_contrato', ['prestacion', 'aprendizaje']))
  if (empresaId) {
    empresasQ.where('id', empresaId)
    empleadosQ.where('empresa_id', empresaId)
  }
  const [sinArl] = await empresasQ.clone().whereNull('arl_id').count('id as n')
  const [sinEps] = await empresasQ.clone().whereNull('eps_id').count('id as n')
  const [sinCot] = await empleadosQ.clone().whereNull('tipo_cotizante').count('id as n')
  const [sinTrab] = await empleadosQ.clone().whereNull('tipo_trabajador').count('id as n')

  res.json({
    catalogos,
    aportantes: { sin_arl: Number(sinArl.n), sin_eps: Number(sinEps.n) },
    cotizantes: { sin_tipo_cotizante: Number(sinCot.n), sin_tipo_trabajador: Number(sinTrab.n) },
  })
}

// GET /nominas/:id/novedades - incapacidades/licencias que se cruzan con el período
export async function novedades(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }
  const fechas = periodoFechas(nomina)
  if (!fechas) return res.json({ fechas: null, novedades: [] })
  const [ini, fin] = fechas
  const rows = await db('incapacidades')
    .leftJoin('empleados', 'incapacidades.empleado_id', 'empleados.id')
    .select('incapacidades.*', 'empleados.primer_nombre', 'empleados.primer_apellido', 'empleados.numero_documento')
    .where('empleados.empresa_id', nomina.empresa_id)
    .where('incapacidades.fecha_inicio', '<=', fin)
    .where(q => q.whereNull('incapacidades.fecha_fin').orWhere('incapacidades.fecha_fin', '>=', ini))
  res.json({ fechas: { inicio: ini, fin }, novedades: rows })
}

// POST /nominas/:id/planilla - genera la planilla PILA desde la nomina liquidada
export async function generarPlanilla(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  if (!canAccessEmpresa(req.user, nomina.empresa_id)) {
    return res.status(403).json({ error: 'Sin acceso a esta nomina' })
  }
  if (nomina.status !== 'liquidada' && nomina.status !== 'pagada') {
    return res.status(400).json({ error: 'La nomina debe estar liquidada' })
  }

  // Reutilizar planilla existente para la misma nomina (idempotente)
  const existente = await db('planillas').where('nomina_id', nomina.id).first()
  if (existente) {
    return res.json({ planilla: existente, existente: true })
  }

  const [id] = await db('planillas').insert({
    empresa_id: nomina.empresa_id,
    nomina_id: nomina.id,
    periodo: nomina.nombre_periodo,
    valor_total: nomina.total_seguridad_social || 0,
    status: 'generada',
  })
  const planilla = await db('planillas').where('id', id).first()
  res.status(201).json({ planilla })
}

// DELETE /nominas/:id - admin elimina (cascade detalles)
export async function remove(req, res) {
  const nomina = await db('nominas').where('id', req.params.id).first()
  if (!nomina) return res.status(404).json({ error: 'Nomina no encontrada' })
  await db('nominas').where('id', nomina.id).delete()
  res.json({ message: 'Nomina eliminada' })
}

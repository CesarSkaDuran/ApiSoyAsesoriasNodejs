// ════════════════════════════════════════════════════════════════════════════
// Archivo plano de nómina detalle (formato propio SoyAsesorías, no regulado).
// Convención acordada: delimitador ';', decimales con coma, UTF-8 SIN BOM,
// fin de línea CRLF. Fila de encabezado + una fila por empleado + fila TOTALES.
// Fuente de datos: el snapshot de nomina_detalles (nunca datos actuales del
// empleado para los valores; identificación sí viene del join).
// ════════════════════════════════════════════════════════════════════════════

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const DEC = (n) => round2(n).toFixed(2).replace('.', ',')
const TXT = (s) => String(s ?? '').replace(/[\r\n;]/g, ' ').trim()

function parseJson(v) {
  if (!v) return []
  if (typeof v !== 'string') return Array.isArray(v) ? v : []
  try { return JSON.parse(v) } catch { return [] }
}

// Parte el ingreso no constitutivo en INCR / gravable usando el detalle por
// concepto y la marca manual del monto plano.
function splitNoc(d) {
  const det = parseJson(d.ingresos_detalle)
  const incrTipificado = det.reduce((s, r) => s + (Number(r.incr_parte) || 0), 0)
  const noSalarialTipificado = det
    .filter(r => r.constitutivo_salario === false || r.constitutivo_salario === 0)
    .reduce((s, r) => s + (Number(r.valor) || 0), 0)
  const nocPlano = (Number(d.ingreso_noc) || 0) - noSalarialTipificado
  const incrPlano = d.ingreso_noc_incr ? nocPlano : 0
  const incr = incrTipificado + incrPlano
  const gravable = (Number(d.ingreso_noc) || 0) - incr
  return { incr: round2(incr), gravable: round2(gravable) }
}

const COLUMNAS = [
  'nomina_id', 'periodo', 'fecha_inicio', 'fecha_fin',
  'empleado_id', 'tipo_documento', 'numero_documento', 'apellidos', 'nombres', 'cargo',
  'dias_laborados', 'dias_incapacidad',
  'salario_base', 'aux_transporte', 'horas_extras', 'otros_ingresos_salariales',
  'ingreso_noc_incr', 'ingreso_noc_gravable', 'total_devengado',
  'valor_incapacidad_empleador', 'valor_incapacidad_tercero', 'vacaciones_disfrutadas',
  'salud_empleado', 'pension_empleado', 'fsp',
  'retencion_calculada', 'retencion_ajuste', 'retencion_fuente',
  'deducciones', 'total_deducciones', 'neto_pagar',
  'ibc', 'no_salarial_ibc',
  'salud_empleador', 'pension_empleador', 'arl', 'ccf', 'sena', 'icbf',
  'total_aportes_empleador',
  'cesantias', 'intereses', 'prima', 'vacaciones', 'total_prestaciones',
  'costo_empresa',
]

function fila(nomina, d) {
  const noc = splitNoc(d)
  return [
    nomina.id,
    TXT(nomina.nombre_periodo || nomina.vigencia || ''),
    nomina.fecha_inicio ? String(nomina.fecha_inicio).slice(0, 10) : '',
    nomina.fecha_fin ? String(nomina.fecha_fin).slice(0, 10) : '',
    d.empleado_id,
    TXT(d.tipo_documento),
    TXT(d.numero_documento),
    TXT([d.primer_apellido, d.segundo_apellido].filter(Boolean).join(' ')),
    TXT([d.primer_nombre, d.segundo_nombre].filter(Boolean).join(' ')),
    TXT(d.cargo_nombre),
    d.dias_laborados ?? 0,
    d.dias_incapacidad ?? 0,
    DEC(d.salario_base), DEC(d.aux_transporte), DEC(d.horas_extras), DEC(d.otros_ingresos),
    DEC(noc.incr), DEC(noc.gravable), DEC(d.total_devengado),
    DEC(d.valor_incapacidad_empleador), DEC(d.valor_incapacidad_tercero), DEC(d.valor_vacaciones),
    DEC(d.salud_empleado), DEC(d.pension_empleado), DEC(d.fsp),
    DEC(d.retencion_calculada), DEC(d.retencion_ajuste), DEC(d.retencion_fuente),
    DEC(d.deducciones), DEC(d.total_deducciones), DEC(d.neto_pagar),
    DEC(d.ibc), DEC(d.no_salarial_ibc),
    DEC(d.salud), DEC(d.pension), DEC(d.arl), DEC(d.ccf), DEC(d.sena), DEC(d.icbf),
    DEC(d.total_aportes_empleador),
    DEC(d.cesantias), DEC(d.intereses), DEC(d.prima), DEC(d.vacaciones),
    DEC(d.total_prestaciones), DEC(d.costo_empresa),
  ]
}

// Columnas monetarias que se suman en la fila TOTALES (índices en COLUMNAS)
const SUMABLE = COLUMNAS
  .map((c, i) => [c, i])
  .filter(([c]) => [
    'salario_base', 'aux_transporte', 'horas_extras', 'otros_ingresos_salariales',
    'ingreso_noc_incr', 'ingreso_noc_gravable', 'total_devengado',
    'valor_incapacidad_empleador', 'valor_incapacidad_tercero', 'vacaciones_disfrutadas',
    'salud_empleado', 'pension_empleado', 'fsp',
    'retencion_calculada', 'retencion_ajuste', 'retencion_fuente',
    'deducciones', 'total_deducciones', 'neto_pagar',
    'ibc', 'no_salarial_ibc',
    'salud_empleador', 'pension_empleador', 'arl', 'ccf', 'sena', 'icbf',
    'total_aportes_empleador', 'cesantias', 'intereses', 'prima', 'vacaciones',
    'total_prestaciones', 'costo_empresa',
  ].includes(c))

export function planoNomina(nomina, detalles) {
  const lineas = [COLUMNAS.join(';')]
  const totales = new Array(COLUMNAS.length).fill('')
  totales[0] = 'TOTALES'
  for (const d of detalles) {
    const f = fila(nomina, d)
    lineas.push(f.join(';'))
    for (const [, i] of SUMABLE) totales[i] = round2((totales[i] === '' ? 0 : totales[i]) + Number(f[i].replace(',', '.')))
  }
  for (const [, i] of SUMABLE) totales[i] = DEC(totales[i])
  lineas.push(totales.join(';'))
  return lineas.join('\r\n')
}

// Segundo archivo: empleado × concepto, desde el snapshot ingresos_detalle.
const COLUMNAS_CONCEPTOS = [
  'nomina_id', 'empleado_id', 'numero_documento', 'apellidos', 'nombres',
  'concepto_id', 'concepto', 'valor', 'constitutivo_salario',
  'tratamiento_fiscal', 'incr_parte', 'gravable_parte',
]

export function planoConceptos(nomina, detalles) {
  const lineas = [COLUMNAS_CONCEPTOS.join(';')]
  for (const d of detalles) {
    for (const r of parseJson(d.ingresos_detalle)) {
      lineas.push([
        nomina.id, d.empleado_id, TXT(d.numero_documento),
        TXT([d.primer_apellido, d.segundo_apellido].filter(Boolean).join(' ')),
        TXT([d.primer_nombre, d.segundo_nombre].filter(Boolean).join(' ')),
        r.concepto_id ?? '', TXT(r.concepto), DEC(r.valor),
        r.constitutivo_salario ? 'SI' : 'NO',
        TXT(r.tratamiento_fiscal), DEC(r.incr_parte), DEC(r.gravable_parte),
      ].join(';'))
    }
  }
  return lineas.join('\r\n')
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOMINA_PARAMETER_DEFAULTS } from '../src/nomina-parameters.js'
import {
  calcularHorasRecargos,
  calcularNovedades,
  fondoSolidaridadPct,
  liquidarEmpleado,
  retencionMensual,
} from '../src/nomina-calculator.js'

const params = NOMINA_PARAMETER_DEFAULTS[2026]
const trabajador = (values = {}) => ({
  salario_base: params.salario_minimo,
  riesgo: 'I',
  auxilio_transporte_mode: 'automatico',
  ...values,
})

test('liquida deducciones del trabajador, auxilio y provisiones con parámetros 2026', () => {
  const result = liquidarEmpleado(trabajador(), {}, params)

  assert.equal(result.aux_transporte, 249095)
  assert.equal(result.ibc, 1750905)
  assert.equal(result.salud_empleado, 70036.2)
  assert.equal(result.pension_empleado, 70036.2)
  assert.equal(result.neto_pagar, 1859927.6)
  assert.equal(result.prima, 166666.67)
  assert.equal(result.cesantias, 166666.67)
  assert.equal(result.intereses, 20000)
  assert.equal(result.vacaciones, 72954.38)
})

test('aplica exoneración 114-1 solo a aportes patronales que corresponden', () => {
  const result = liquidarEmpleado(trabajador(), {}, params, true)

  assert.equal(result.salud, 0)
  assert.equal(result.sena, 0)
  assert.equal(result.icbf, 0)
  assert.ok(result.pension > 0)
  assert.ok(result.arl > 0)
  assert.ok(result.ccf > 0)
  assert.equal(result.exonerado_ley_114_1, true)
})

test('incluye en IBC solo el excedente no salarial sobre el límite del 40%', () => {
  const result = liquidarEmpleado(
    trabajador({ salario_base: 1000000 }),
    { ingreso_noc: 1000000 },
    params,
  )

  assert.equal(result.no_salarial_ibc, 200000)
  assert.equal(result.ibc, 1200000)
})

test('el excedente del 40% integra IBC y prestaciones (art. 30 Ley 1393/2010)', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 1000000 }), { ingreso_noc: 1000000 }, params)
  const excedente = result.no_salarial_ibc
  assert.equal(excedente, 200000)
  assert.equal(result.ibc, 1200000) // el IBC ya lo incluía; no cambia

  const baseEsperada = 1000000 + result.aux_transporte + excedente
  assert.equal(result.prima, Math.round(baseEsperada * params.prima_pct / 100 * 100) / 100)
  assert.equal(result.cesantias, Math.round(baseEsperada * params.cesantias_pct / 100 * 100) / 100)
  assert.equal(result.intereses, Math.round(baseEsperada * params.intereses_cesantias_pct_anual / 100 / 12 * 100) / 100)
  assert.equal(result.vacaciones, Math.round((1000000 + excedente) * params.vacaciones_pct / 100 * 100) / 100)
})

test('la regla del 40% se aplica al agregado de todas las fuentes no salariales', () => {
  // 400k plano + 300k tipificado gravable + 300k tipificado INCR = 1M no salarial
  const result = liquidarEmpleado(trabajador({ salario_base: 1000000 }), {
    ingreso_noc: 400000,
    ingresos: [
      { concepto: 'Bonificación pactada no salarial', valor: 300000, constitutivo_salario: false, tratamiento_fiscal: 'gravable' },
      { concepto: 'Viáticos ocasionales', valor: 300000, constitutivo_salario: false, tratamiento_fiscal: 'incr' },
    ],
  }, params)
  assert.equal(result.ingreso_noc, 1000000)
  assert.equal(result.no_salarial_ibc, 200000)
  assert.equal(result.ibc, 1200000)
})

test('el ajuste manual de retención nunca sobrescribe la calculada ni la deja negativa', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: params.salario_minimo * 10 }), {
    retencion_ajuste: -99999999,
    retencion_ajuste_motivo: 'certificado ICE / procedimiento 2',
  }, params)
  assert.ok(result.retencion_calculada > 0)
  assert.equal(result.retencion_fuente, 0)
  assert.equal(result.retencion_ajuste, -99999999)
  assert.ok(result.retencion_ajuste_motivo)
})

test('auxilio automático respeta el tope de dos SMMLV y admite ajuste explícito', () => {
  const aboveLimit = params.salario_minimo * 2 + 1
  assert.equal(liquidarEmpleado(trabajador({ salario_base: aboveLimit }), {}, params).aux_transporte, 0)
  assert.equal(liquidarEmpleado(trabajador({ salario_base: aboveLimit, auxilio_transporte_mode: 'si' }), {}, params).aux_transporte, 0)
  assert.equal(liquidarEmpleado(trabajador({ auxilio_transporte_mode: 'si' }), {}, params).aux_transporte, params.auxilio_transporte)
  assert.equal(liquidarEmpleado(trabajador({ auxilio_transporte_mode: 'no' }), {}, params).aux_transporte, 0)
})

test('tipifica ingresos por concepto: INCR excluido de retención y salarial suma al IBC', () => {
  const salario = params.salario_minimo * 5
  const tipificado = liquidarEmpleado(trabajador({ salario_base: salario }), {
    ingresos: [
      { concepto: 'Viáticos', valor: 1000000, constitutivo_salario: false, tratamiento_fiscal: 'incr' },
      { concepto: 'Bonificación extralegal', valor: 500000, constitutivo_salario: true, tratamiento_fiscal: 'gravable' },
    ],
  }, params)
  assert.equal(tipificado.otros_ingresos, 500000)
  assert.equal(tipificado.ingreso_noc, 1000000)
  assert.equal(JSON.parse(tipificado.ingresos_detalle).length, 2)

  // El INCR por catálogo equivale al INCR manual plano en la base de retención
  const incrManual = liquidarEmpleado(trabajador({ salario_base: salario }), {
    otros_ingresos: 500000, ingreso_noc: 1000000, ingreso_noc_incr: true,
  }, params)
  assert.equal(tipificado.retencion_calculada, incrManual.retencion_calculada)

  // Y es menor que el mismo pago no salarial gravable
  const gravable = liquidarEmpleado(trabajador({ salario_base: salario }), {
    otros_ingresos: 500000, ingreso_noc: 1000000,
  }, params)
  assert.ok(tipificado.retencion_calculada < gravable.retencion_calculada)
})

test('salario integral: IBC al 70%, sin provisiones excepto vacaciones, con alerta', () => {
  const integral = liquidarEmpleado(
    trabajador({ salario_base: params.salario_minimo * 13 }),
    { salario_integral: true }, params,
  )
  const normal = liquidarEmpleado(
    trabajador({ salario_base: params.salario_minimo * 13 }),
    {}, params,
  )
  assert.equal(integral.ibc, Math.round(normal.ibc * 0.7 * 100) / 100)
  assert.equal(integral.prima, 0)
  assert.equal(integral.cesantias, 0)
  assert.equal(integral.intereses, 0)
  assert.ok(integral.vacaciones > 0)
  assert.ok(JSON.parse(integral.alertas).some(a => a.includes('Salario integral')))
})

test('salario integral: base de vacaciones parametrizable por vigencia', () => {
  const e = trabajador({ salario_base: params.salario_minimo * 13 })
  const input = { salario_integral: true }
  const p70 = liquidarEmpleado(e, input, params)
  const p100 = liquidarEmpleado(e, input, { ...params, vacaciones_base_integral_pct: 100 })
  const p50 = liquidarEmpleado(e, input, { ...params, vacaciones_base_integral_pct: 50 })
  // La parametrización mueve la base; el valor concreto queda PENDIENTE_VERIFICAR
  assert.ok(p100.vacaciones > p70.vacaciones)
  assert.ok(p50.vacaciones < p70.vacaciones)
})

test('salario base inferior al SMMLV genera alerta y persiste el motivo', () => {
  const bajo = liquidarEmpleado(trabajador({ salario_base: 1000000 }), {
    salario_menor_motivo: 'Medio tiempo pactado',
  }, params)
  assert.ok(JSON.parse(bajo.alertas).some(a => a.includes('SMMLV')))
  assert.equal(bajo.salario_menor_motivo, 'Medio tiempo pactado')

  // Salario >= SMMLV: sin alerta y motivo no se persiste
  const normal = liquidarEmpleado(trabajador({ salario_base: 2000000 }), {
    salario_menor_motivo: 'texto que no aplica',
  }, params)
  assert.ok(!JSON.parse(normal.alertas || '[]').some(a => a.includes('SMMLV')))
  assert.equal(normal.salario_menor_motivo, null)
})

test('embargo que supera la quinta parte del excedente genera alerta sin bloquear', () => {
  const salario = 2000000
  // Excedente sobre SMMLV: 2000000 - 1750905 = 249095 → tope 1/5 = 49819
  const r = liquidarEmpleado(trabajador({ salario_base: salario }), {
    descuentos: [{ tipo: 'embargo', concepto: 'Juzgado X', valor: 100000 }],
  }, params)
  assert.equal(r.deducciones, 100000)
  assert.ok(JSON.parse(r.alertas).some(a => a.includes('embargo')))
})

test('libranza dentro del 50% del neto no alerta; encima sí', () => {
  const salario = 2000000
  const dentro = liquidarEmpleado(trabajador({ salario_base: salario }), {
    descuentos: [{ tipo: 'libranza', concepto: 'Entidad Y', valor: 500000 }],
  }, params)
  assert.ok(!JSON.parse(dentro.alertas || '[]').some(a => a.includes('libranza')))
  const fuera = liquidarEmpleado(trabajador({ salario_base: salario }), {
    descuentos: [{ tipo: 'libranza', concepto: 'Entidad Y', valor: 2000000 }],
  }, params)
  assert.ok(JSON.parse(fuera.alertas || '[]').some(a => a.includes('libranza')))
})

test('SLN: cotiza salud/pensión del empleador sobre IBC anterior prorrateado, sin ARL ni deducciones', () => {
  const salario = 1750905
  const ibcPrevio = 1750905
  const conSln = liquidarEmpleado(trabajador({ salario_base: salario }), {
    novedades: [{ tipo: 'no_remunerada', dias: 10 }],
    ibc_mes_anterior: ibcPrevio,
  }, params)
  const sinSln = liquidarEmpleado(trabajador({ salario_base: salario }), {}, params)
  // IBC trabajador: solo 20 días laborados → 1750905 * 20/30
  assert.equal(conSln.ibc, Math.round(1750905 * 20 / 30 * 100) / 100)
  // Pensión empleador: (IBC trabajado + IBC previo × 10/30) × 12%
  const ibcEmpleador = conSln.ibc + 1750905 * 10 / 30
  assert.equal(conSln.pension, Math.round(ibcEmpleador * 0.12 * 100) / 100)
  assert.equal(conSln.pension, sinSln.pension) // mismo total que mes completo
  // ARL solo sobre días trabajados (T-162/2004)
  assert.ok(conSln.arl < sinSln.arl)
  // Deducciones del trabajador solo sobre días trabajados
  assert.equal(conSln.salud_empleado, Math.round(conSln.ibc * 0.04 * 100) / 100)
})

test('vacaciones disfrutadas: remuneradas a tarifa propia, con base manual', () => {
  const salario = 3000000
  const fija = liquidarEmpleado(trabajador({ salario_base: salario }), {
    novedades: [{ tipo: 'vacaciones', dias: 10 }],
  }, params)
  // Salario fijo: la tarifa de vacaciones = la ordinaria → mismo devengado
  const sinNov = liquidarEmpleado(trabajador({ salario_base: salario }), {}, params)
  assert.equal(fija.total_devengado, sinNov.total_devengado)
  assert.equal(fija.valor_vacaciones, Math.round(salario * 10 / 30 * 100) / 100)
  assert.equal(fija.dias_laborados, 20)
  // Base manual (salario variable sin histórico)
  const manual = liquidarEmpleado(trabajador({ salario_base: salario }), {
    novedades: [{ tipo: 'vacaciones', dias: 10 }],
    vacaciones_base: 4000000,
  }, params)
  assert.equal(manual.valor_vacaciones, Math.round(4000000 * 10 / 30 * 100) / 100)
})

test('INCR parcial: tope en UVT y condición salarial del concepto', () => {
  const uvt = params.uvt // 52.374 en 2026
  const alimentacion = {
    concepto: 'Auxilio de alimentación', valor: 3000000,
    constitutivo_salario: false, tratamiento_fiscal: 'incr',
    limite_incr_uvt: 41, condicion_salario_uvt: 310,
  }
  // Salario bajo el techo de 310 UVT: INCR hasta 41 UVT/mes, exceso gravable
  const bajo = liquidarEmpleado(trabajador({ salario_base: uvt * 100 }), {
    ingresos: [alimentacion],
  }, params)
  const det = JSON.parse(bajo.ingresos_detalle)[0]
  assert.equal(det.incr_parte, Math.round(41 * uvt * 100) / 100)
  assert.equal(det.gravable_parte, Math.round((3000000 - 41 * uvt) * 100) / 100)

  // Salario sobre 310 UVT: pierde el beneficio, todo gravable
  const sobre = liquidarEmpleado(trabajador({ salario_base: uvt * 400 }), {
    ingresos: [alimentacion],
  }, params)
  assert.equal(JSON.parse(sobre.ingresos_detalle)[0].incr_parte, 0)

  // Quincena: el tope se prorratea (41 UVT × 15/30)
  const quincena = liquidarEmpleado(trabajador({ salario_base: uvt * 100 }), {
    dias_laborados: 15, ingresos: [alimentacion],
  }, params)
  assert.equal(JSON.parse(quincena.ingresos_detalle)[0].incr_parte, Math.round(41 * uvt * 0.5 * 100) / 100)
})

test('usa el equivalente mensual para FSP y exoneración en períodos quincenales', () => {
  const fsp = liquidarEmpleado(
    trabajador({ salario_base: params.salario_minimo * 4.5 }),
    { dias_laborados: 15 },
    params,
  )
  assert.equal(fsp.fsp, Math.round(params.salario_minimo * 4.5 / 2 * 0.01 * 100) / 100)

  const noExonerado = liquidarEmpleado(
    trabajador({ salario_base: params.salario_minimo * 12 }),
    { dias_laborados: 15 },
    params,
    true,
  )
  assert.equal(noExonerado.exonerado_ley_114_1, false)
  assert.ok(noExonerado.salud > 0)
})

test('no convierte cero días en un periodo completo', () => {
  const result = liquidarEmpleado(trabajador(), { dias_laborados: 0 }, params)
  assert.equal(result.dias_laborados, 0)
  assert.equal(result.total_devengado, 0)
  assert.equal(result.neto_pagar, 0)
})

test('calcula FSP por rangos de SMMLV', () => {
  assert.equal(fondoSolidaridadPct(4 * params.salario_minimo, params), 1)
  assert.equal(fondoSolidaridadPct(16.5 * params.salario_minimo, params), 1.2)
  assert.equal(fondoSolidaridadPct(20 * params.salario_minimo, params), 2)
})

// ── Retención en la fuente (art. 383 ET, procedimiento 1) ────────────────────

test('retención cero cuando la base depurada no supera 95 UVT', () => {
  const result = liquidarEmpleado(trabajador(), {}, params)
  assert.equal(result.retencion_calculada, 0)
  assert.equal(result.retencion_fuente, 0)
})

test('retención aplica la tabla por tramos de UVT', () => {
  // Depurado mensual de 100 UVT → tramo 19%: (100-95)*19% = 0,95 UVT
  const r2 = v => Math.round(v * 100) / 100
  const t19 = retencionMensual(100 * params.uvt / 0.75, 0, 1, params) // exenta 25% → base 100 UVT
  assert.equal(r2(t19.retencion), r2(0.95 * params.uvt))
  // Base 200 UVT → tramo 28%: (200-150)*28% + 10 = 24 UVT
  const t28 = retencionMensual(200 * params.uvt / 0.75, 0, 1, params)
  assert.equal(r2(t28.retencion), r2(24 * params.uvt))
  // Base 1000 UVT → tramo 37%: (1000-945)*37% + 268 = 288,35 UVT
  // (depurado de 1240 UVT para que la exenta quede topada en 240)
  const t37 = retencionMensual(1240 * params.uvt, 0, 1, params)
  assert.equal(r2(t37.retencion), r2(288.35 * params.uvt))
})

test('retención en nómina real descuenta aportes y aplica tabla', () => {
  const salario = 12000000 // bajo el tope IBC de 25 SMMLV → IBC = salario
  const result = liquidarEmpleado(trabajador({ salario_base: salario }), {}, params)
  // Depuran salud + pensión + FSP (IBC ~6,86 SMMLV → FSP 1%)
  const aportes = salario * 0.08 + salario * 0.01
  const depurado = salario - aportes
  const exenta = depurado * 0.25
  const baseUvt = (depurado - exenta) / params.uvt
  const esperado = ((baseUvt - 150) * 0.28 + 10) * params.uvt
  assert.equal(result.retencion_calculada, Math.round(esperado * 100) / 100)
})

test('retención respeta el tope de la renta exenta de 240 UVT', () => {
  const r = retencionMensual(60000000, 0, 1, params)
  const baseUvt = (60000000 - params.uvt * 240) / params.uvt // ~906 UVT → tramo 35%
  const esperado = ((baseUvt - 640) * 0.35 + 162) * params.uvt
  assert.equal(r.exenta, params.uvt * 240)
  assert.equal(Math.round(r.retencion * 100) / 100, Math.round(esperado * 100) / 100)
})

test('retención quincenal prorratea la retención mensual', () => {
  const salario = 12000000
  const mensual = liquidarEmpleado(trabajador({ salario_base: salario }), {}, params)
  const quincena = liquidarEmpleado(trabajador({ salario_base: salario }), { dias_laborados: 15 }, params)
  assert.equal(quincena.retencion_calculada, Math.round(mensual.retencion_calculada / 2 * 100) / 100)
})

test('ajuste manual de retención se suma sin ocultar el valor calculado', () => {
  const salario = 12000000
  const result = liquidarEmpleado(trabajador({ salario_base: salario }), {
    retencion_ajuste: -50000,
    retencion_ajuste_motivo: 'Certificado ICE',
  }, params)
  assert.ok(result.retencion_calculada > 0)
  assert.equal(result.retencion_fuente, result.retencion_calculada - 50000)
  assert.equal(result.retencion_ajuste, -50000)
  assert.equal(result.retencion_ajuste_motivo, 'Certificado ICE')
})

test('ingreso_noc marcado como INCR fiscal reduce la base de retención', () => {
  const salario = 12000000
  const gravable = liquidarEmpleado(trabajador({ salario_base: salario }), { ingreso_noc: 4000000 }, params)
  const incr = liquidarEmpleado(trabajador({ salario_base: salario }), { ingreso_noc: 4000000, ingreso_noc_incr: true }, params)
  assert.ok(incr.retencion_calculada < gravable.retencion_calculada)
})

test('flag INCR con monto plano 0 queda limpio (sin flag ni motivo)', () => {
  const r = liquidarEmpleado(trabajador({ salario_base: 2000000 }), {
    ingreso_noc: 0, ingreso_noc_incr: true, ingreso_noc_incr_motivo: 'sobró del diálogo',
  }, params)
  assert.equal(r.ingreso_noc_incr, 0)
  assert.equal(r.ingreso_noc_incr_motivo, null)

  // El flag sí persiste cuando hay monto plano > 0
  const conMonto = liquidarEmpleado(trabajador({ salario_base: 2000000 }), {
    ingreso_noc: 100000, ingreso_noc_incr: true, ingreso_noc_incr_motivo: 'Viáticos',
  }, params)
  assert.equal(conMonto.ingreso_noc_incr, 1)
  assert.equal(conMonto.ingreso_noc_incr_motivo, 'Viáticos')
})

test('retencionMensual devuelve cero sin UVT o base', () => {
  assert.equal(retencionMensual(0, 0, 1, params).retencion, 0)
  assert.equal(retencionMensual(5000000, 0, 1, { ...params, uvt: 0 }).retencion, 0)
})

// ── Horas extras y recargos por cantidad y tipo ──────────────────────────────

test('valor hora usa la jornada vigente según la fecha de la novedad', () => {
  const salario = 2200000
  // Enero 2026: jornada 44h → divisor 220; Agosto 2026: 42h → divisor 210
  const enero = calcularHorasRecargos(
    [{ tipo: 'diurna', cantidad: 1, fecha: '2026-01-10' }], salario, params, '2026-01-01')
  const agosto = calcularHorasRecargos(
    [{ tipo: 'diurna', cantidad: 1, fecha: '2026-08-10' }], salario, params, '2026-08-01')
  assert.equal(enero.detalle[0].valor_hora, 10000)
  assert.equal(enero.detalle[0].valor, 12500) // 1.25
  assert.equal(agosto.detalle[0].valor_hora, Math.round(salario / 210 * 100) / 100)
})

test('cada tipo de recargo aplica su factor legal', () => {
  const salario = 2200000 // valor hora = 10.000 con jornada 44h
  const fecha = '2026-03-10' // dominical 80%
  const casos = {
    diurna: 1.25,
    nocturna: 1.75,
    recargo_nocturno: 0.35,
    dominical: 0.8,
    nocturna_dominical: 1.15,
    extra_diurna_dominical: 2.05,
    extra_nocturna_dominical: 2.55,
  }
  for (const [tipo, factor] of Object.entries(casos)) {
    const r = calcularHorasRecargos([{ tipo, cantidad: 1, fecha }], salario, params, fecha)
    assert.equal(r.detalle[0].valor, Math.round(10000 * factor * 100) / 100, tipo)
  }
})

test('recargo dominical cambia en los cortes de la Ley 2466', () => {
  const salario = 2200000
  const antes = calcularHorasRecargos([{ tipo: 'dominical', cantidad: 1, fecha: '2026-06-30' }], salario, params)
  const despues = calcularHorasRecargos([{ tipo: 'dominical', cantidad: 1, fecha: '2026-07-01' }], salario, params)
  assert.equal(antes.detalle[0].valor, 8000)
  assert.equal(despues.detalle[0].valor, 9000)
})

test('horas extra sobre el tope legal generan alerta con consecuencia', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 2200000 }), {
    horas: [{ tipo: 'diurna', cantidad: 70 }],
    fecha_referencia: '2026-03-01',
  }, params)
  const alertas = JSON.parse(result.alertas || '[]')
  assert.ok(alertas.some(a => a.includes('autorización del Ministerio del Trabajo')))
  assert.ok(result.horas_extras > 0)
})

test('el tope se valida por día real, no solo por agregado del período', () => {
  // 3h en un solo día: bajo el tope agregado del período, pero viola 2h/día
  const result = liquidarEmpleado(trabajador({ salario_base: 2200000 }), {
    horas: [{ tipo: 'diurna', cantidad: 3, fecha: '2026-03-10' }],
    fecha_referencia: '2026-03-01',
  }, params)
  const alertas = JSON.parse(result.alertas || '[]')
  assert.ok(alertas.some(a => a.includes('2026-03-10') && a.includes('2h/día')))
})

test('el tope semanal se valida aunque cada día cumpla 2h', () => {
  // 2h/día × 7 días de la misma semana = 14h > 12h/semana
  const result = liquidarEmpleado(trabajador({ salario_base: 2200000 }), {
    horas: ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']
      .map(fecha => ({ tipo: 'diurna', cantidad: 2, fecha })),
    fecha_referencia: '2026-03-01',
  }, params)
  const alertas = JSON.parse(result.alertas || '[]')
  assert.ok(!alertas.some(a => a.includes('h/día')))
  assert.ok(alertas.some(a => a.includes('12h/semana')))
})

test('horas_extras manual se suma a las horas por tipo', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 2200000 }), {
    horas: [{ tipo: 'diurna', cantidad: 2, fecha: '2026-03-10' }],
    horas_extras: 50000,
    fecha_referencia: '2026-03-01',
  }, params)
  assert.equal(result.horas_extras, 2 * 12500 + 50000)
})

// ── Incapacidades y licencias ────────────────────────────────────────────────

test('incapacidad común de 2 días queda a cargo del empleador', () => {
  const salario = 3000000
  const result = liquidarEmpleado(trabajador({ salario_base: salario }), {
    novedades: [{ tipo: 'comun', dias: 2 }],
  }, params)
  assert.equal(result.dias_laborados, 28)
  assert.equal(result.dias_incapacidad, 2)
  assert.equal(result.valor_incapacidad_empleador, 200000)
  assert.equal(result.valor_incapacidad_tercero, 0)
  const aux = params.auxilio_transporte * 28 / 30
  assert.equal(result.total_devengado, Math.round((2800000 + 200000 + aux) * 100) / 100)
})

test('incapacidad común larga pasa a la EPS al 66.67% desde el día 3', () => {
  const salario = 3000000 // día = 100.000
  const result = liquidarEmpleado(trabajador({ salario_base: salario }), {
    novedades: [{ tipo: 'comun', dias: 10 }],
  }, params)
  assert.equal(result.valor_incapacidad_empleador, 200000)
  assert.equal(result.valor_incapacidad_tercero, Math.round(8 * 100000 * 0.6667 * 100) / 100)
  // El empleado recibe el valor EPS a través de la nómina
  const aux = params.auxilio_transporte * 20 / 30
  assert.equal(result.total_devengado, Math.round((2000000 + 200000 + result.valor_incapacidad_tercero + aux) * 100) / 100)
})

test('incapacidad común que ya consumió los días del empleador va toda a EPS', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 3000000 }), {
    novedades: [{ tipo: 'comun', dias: 5, dias_previos: 2 }],
  }, params)
  assert.equal(result.valor_incapacidad_empleador, 0)
  assert.ok(result.valor_incapacidad_tercero > 0)
})

test('excedente parametrizable completa el 100% a cargo del empleador', () => {
  const p = { ...params, incapacidad_excedente_pct: 33.33 }
  const result = liquidarEmpleado(trabajador({ salario_base: 3000000 }), {
    novedades: [{ tipo: 'comun', dias: 10 }],
  }, p)
  assert.equal(result.valor_incapacidad_empleador, Math.round((200000 + 8 * 100000 * 0.3333) * 100) / 100)
})

test('incapacidad laboral: día del accidente del empleador, resto ARL al 100%', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 3000000 }), {
    novedades: [{ tipo: 'laboral', dias: 6 }],
  }, params)
  assert.equal(result.valor_incapacidad_empleador, 100000)
  assert.equal(result.valor_incapacidad_tercero, 500000)
})

test('licencia de maternidad la asume la EPS al 100% desde el día 1', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 3000000 }), {
    novedades: [{ tipo: 'maternidad', dias: 15 }],
  }, params)
  assert.equal(result.valor_incapacidad_empleador, 0)
  assert.equal(result.valor_incapacidad_tercero, 1500000)
  assert.equal(result.dias_laborados, 15)
})

test('licencia no remunerada no genera devengado ni auxilio en esos días', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: 3000000 }), {
    novedades: [{ tipo: 'no_remunerada', dias: 10 }],
  }, params)
  assert.equal(result.dias_incapacidad, 10)
  assert.equal(result.dias_laborados, 20)
  assert.equal(result.valor_incapacidad_empleador + result.valor_incapacidad_tercero, 0)
  // 3M <= 2 SMMLV: auxilio prorrateado a los 20 días trabajados
  const aux = params.auxilio_transporte * 20 / 30
  assert.equal(result.total_devengado, Math.round((2000000 + aux) * 100) / 100)
})

test('durante incapacidad no se causa auxilio de transporte', () => {
  const result = liquidarEmpleado(trabajador({ salario_base: params.salario_minimo }), {
    novedades: [{ tipo: 'comun', dias: 10 }],
  }, params)
  assert.equal(result.aux_transporte, Math.round(params.auxilio_transporte * 20 / 30 * 100) / 100)
})

test('nómina sin novedades calcula igual que antes', () => {
  const result = liquidarEmpleado(trabajador(), {}, params)
  assert.equal(result.dias_incapacidad, 0)
  assert.equal(result.dias_laborados, 30)
  assert.equal(result.aux_transporte, params.auxilio_transporte)
  assert.equal(result.novedades_detalle, null)
})

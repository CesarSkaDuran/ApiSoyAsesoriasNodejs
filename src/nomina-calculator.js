const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const amount = value => Math.max(0, Number(value) || 0)
const pct = (value, base) => base * (Number(value) || 0) / 100

const toJson = (value, fallback) => {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return value
}

// Resuelve el valor vigente de una lista de cortes [{desde: 'AAAA-MM-DD', ...}]
// para una fecha dada. Sin fecha toma el último corte.
function corteVigente(cortes, key, fecha) {
  const list = toJson(cortes, [])
    .filter(c => c && c.desde && c[key] !== undefined && c[key] !== null)
    .sort((a, b) => String(a.desde).localeCompare(String(b.desde)))
  let value = null
  for (const corte of list) {
    if (!fecha || String(corte.desde).slice(0, 10) <= fecha) value = Number(corte[key])
  }
  return value
}

export function fondoSolidaridadPct(ibc, params) {
  const smmlv = Number(params.salario_minimo) || 0
  if (!smmlv || ibc < smmlv * Number(params.fsp_tope_inicial_smmlv || 4)) return 0
  const multiples = ibc / smmlv
  if (multiples >= 20) return Number(params.fsp_mas_20_pct) || 0
  if (multiples >= 19) return Number(params.fsp_19_20_pct) || 0
  if (multiples >= 18) return Number(params.fsp_18_19_pct) || 0
  if (multiples >= 17) return Number(params.fsp_17_18_pct) || 0
  if (multiples >= 16) return Number(params.fsp_16_17_pct) || 0
  return Number(params.fsp_4_16_pct) || 0
}

// Tipos que son trabajo suplementario (cuentan para el tope legal de extras).
// Los demás tipos son recargos sobre horas de la jornada ordinaria.
const HORAS_EXTRA_TIPOS = new Set(['diurna', 'nocturna', 'extra_diurna_dominical', 'extra_nocturna_dominical'])

export function calcularHorasRecargos(horas, salarioMensual, params, fechaReferencia) {
  const detalle = []
  let valor = 0
  let horasExtra = 0
  for (const item of Array.isArray(horas) ? horas : []) {
    const cantidad = amount(item.cantidad)
    const tipo = String(item.tipo || 'diurna')
    if (!cantidad) continue
    const fecha = item.fecha ? String(item.fecha).slice(0, 10) : fechaReferencia
    const jornada = corteVigente(params.jornada_cortes, 'horas_semanales', fecha) ?? 48
    const dominical = corteVigente(params.dominical_cortes, 'pct', fecha) ?? 75
    const valorHora = salarioMensual / (jornada * 5)
    const extD = Number(params.extra_diurna_pct ?? 25) / 100
    const extN = Number(params.extra_nocturna_pct ?? 75) / 100
    const recN = Number(params.recargo_nocturno_pct ?? 35) / 100
    const dom = dominical / 100
    const factor = {
      diurna: 1 + extD,
      nocturna: 1 + extN,
      extra_diurna_dominical: 1 + extD + dom,
      extra_nocturna_dominical: 1 + extN + dom,
      recargo_nocturno: recN,
      dominical: dom,
      festiva: dom,
      nocturna_dominical: dom + recN,
    }[tipo]
    if (factor === undefined) {
      detalle.push({ tipo, cantidad, fecha, error: 'tipo no reconocido', valor: 0 })
      continue
    }
    const subtotal = valorHora * cantidad * factor
    valor += subtotal
    if (HORAS_EXTRA_TIPOS.has(tipo)) horasExtra += cantidad
    detalle.push({
      tipo, cantidad, fecha,
      valor_hora: round2(valorHora),
      factor_pct: round2(factor * 100),
      valor: round2(subtotal),
    })
  }
  return { valor, horasExtra, detalle }
}

// Novedades de ausentismo en el período. Cada novedad llega con:
// { tipo, dias (dentro del período), dias_previos (de la novedad antes del período), descripcion? }
// baseVacaciones: salario base para pagar los días disfrutados — ordinario
// vigente (fijo) o promedio del último año (variable, CST art. 192).
export function calcularNovedades(novedades, salarioMensual, params, topeDias = 30, baseVacaciones = null) {
  const valorDia = salarioMensual / 30
  const valorDiaVac = (amount(baseVacaciones) || salarioMensual) / 30
  let restantes = Math.max(0, Number(topeDias) || 0)
  let diasSolicitados = 0
  let diasIncapacidad = 0
  let diasNoRemunerados = 0
  let diasVacaciones = 0
  let valorEmpleador = 0
  let valorTercero = 0
  let valorVacaciones = 0
  const detalle = []
  for (const n of Array.isArray(novedades) ? novedades : []) {
    diasSolicitados += amount(n.dias)
    const dias = Math.min(amount(n.dias), restantes)
    restantes -= dias
    if (!dias) continue
    const previos = amount(n.dias_previos)
    const tipo = String(n.tipo || 'comun')
    let diasEmpleador = 0
    let diasTercero = 0
    let pctTercero = 100
    let excedentePct = 0
    if (tipo === 'vacaciones') {
      // Días remunerados a tarifa de vacaciones: no descuentan devengado.
      // La provisión del período se calcula aparte (base propia abajo).
      diasVacaciones += dias
      const valor = dias * valorDiaVac
      valorVacaciones += valor
      detalle.push({
        tipo, dias,
        valor_vacaciones: round2(valor),
        base_vacaciones: round2(amount(baseVacaciones) || salarioMensual),
        base_fuente: n.base_fuente || (amount(baseVacaciones) ? 'manual' : 'salario_vigente'),
        motivo: n.motivo || null,
        descripcion: n.descripcion || null,
      })
      continue
    }
    if (tipo === 'no_remunerada') {
      diasNoRemunerados += dias
      diasIncapacidad += dias
      detalle.push({ tipo, dias, dias_empleador: 0, dias_tercero: 0, valor_empleador: 0, valor_tercero: 0, descripcion: n.descripcion || null })
      continue
    }
    if (tipo === 'laboral') {
      // Día del accidente a cargo del empleador; desde el día siguiente la ARL (Ley 776/2002 art. 3)
      diasEmpleador = Math.min(dias, Math.max(0, Number(params.incapacidad_laboral_dias_empleador ?? 1) - previos))
      diasTercero = dias - diasEmpleador
      pctTercero = Number(params.incapacidad_laboral_pct ?? 100)
    } else if (tipo === 'maternidad' || tipo === 'paternidad') {
      // EPS asume desde el día 1 al 100% (sujeto a semanas cotizadas, verificación manual)
      diasTercero = dias
      pctTercero = 100
    } else {
      // Origen común: primeros N días empleador 100%, luego EPS al % configurado
      diasEmpleador = Math.min(dias, Math.max(0, Number(params.incapacidad_comun_dias_empleador ?? 2) - previos))
      diasTercero = dias - diasEmpleador
      pctTercero = Number(params.incapacidad_comun_eps_pct ?? 66.67)
      excedentePct = Number(params.incapacidad_excedente_pct ?? 0)
    }
    const vEmpleador = diasEmpleador * valorDia + diasTercero * valorDia * excedentePct / 100
    const vTercero = diasTercero * valorDia * pctTercero / 100
    valorEmpleador += vEmpleador
    valorTercero += vTercero
    diasIncapacidad += dias
    detalle.push({
      tipo, dias, dias_empleador: diasEmpleador, dias_tercero: diasTercero,
      pct_tercero: pctTercero,
      valor_empleador: round2(vEmpleador),
      valor_tercero: round2(vTercero),
      descripcion: n.descripcion || null,
    })
  }
  return { diasIncapacidad, diasNoRemunerados, diasVacaciones, valorEmpleador, valorTercero, valorVacaciones, detalle, excedeTope: diasSolicitados > topeDias }
}

// Retención en la fuente por ingresos laborales, procedimiento 1 (art. 383 y 388 ET).
// Depura sobre base mensualizada y prorratea al período. No cubre procedimiento 2
// ni deducciones personales del art. 388 (dependientes, medicina prepagada, etc.).
export function retencionMensual(basePeriodo, aportesObligatoriosPeriodo, factorMensual, params) {
  const uvt = Number(params.uvt) || 0
  if (!uvt || !factorMensual || basePeriodo <= 0) {
    return { retencion: 0, depurado_mes: 0, exenta: 0, base_uvt: 0, tramo: null }
  }
  const depuradoMes = Math.max(0, basePeriodo - aportesObligatoriosPeriodo) * factorMensual
  const exenta = Math.min(
    depuradoMes * Number(params.retencion_exenta_pct ?? 25) / 100,
    uvt * Number(params.retencion_exenta_tope_uvt ?? 240),
  )
  const baseUvt = Math.max(0, depuradoMes - exenta) / uvt
  const tramo = toJson(params.retencion_tabla, [])
    .find(t => baseUvt > Number(t.desde) && (t.hasta === null || t.hasta === undefined || baseUvt <= Number(t.hasta)))
  if (!tramo || !Number(tramo.tarifa)) {
    return { retencion: 0, depurado_mes: depuradoMes, exenta, base_uvt: baseUvt, tramo: tramo || null }
  }
  const impuestoUvt = (baseUvt - Number(tramo.resta_uvt || 0)) * Number(tramo.tarifa) / 100 + Number(tramo.suma_uvt || 0)
  return {
    retencion: Math.max(0, impuestoUvt * uvt) / factorMensual,
    depurado_mes: depuradoMes,
    exenta,
    base_uvt: baseUvt,
    tramo,
  }
}

export function liquidarEmpleado(empleado, input = {}, params, aplicaExoneracion = false) {
  const alertas = []
  const dias = Math.min(Math.max(Number(input.dias_laborados ?? 30) || 0, 0), 30)
  const salarioMensual = amount(empleado.salario_base)
  const fechaRef = input.fecha_referencia ? String(input.fecha_referencia).slice(0, 10) : null

  // Novedades de ausentismo: reducen los días efectivamente trabajados.
  // Las vacaciones disfrutadas son días remunerados a tarifa propia (CST 192):
  // base = ordinario vigente (fijo) o promedio último año (variable).
  const baseVacaciones = amount(input.vacaciones_base)
  const nov = calcularNovedades(input.novedades, salarioMensual, params, dias, baseVacaciones || null)
  if (nov.excedeTope) {
    alertas.push('Los días de novedad superan los días del período; se ajustaron al máximo posible')
  }
  if (nov.diasVacaciones && !baseVacaciones && input.vacaciones_base_manual) {
    alertas.push('Vacaciones liquidadas con base manual sin histórico de nómina — revisar el motivo registrado')
  }
  // Salario base inferior al SMMLV vigente (CST art. 143): solo es válido en
  // casos excepcionales (medio tiempo, contrato especial). Alerta, no bloqueo;
  // el motivo es obligatorio y se valida en el endpoint de liquidación.
  const smmlvVigente = Number(params.salario_minimo) || 0
  const bajoMinimo = smmlvVigente > 0 && salarioMensual < smmlvVigente
  if (bajoMinimo) {
    alertas.push(`Salario base (${round2(salarioMensual)}) inferior al SMMLV vigente (${round2(smmlvVigente)}): ${String(input.salario_menor_motivo || '').trim() || 'sin motivo registrado'} — verificar soporte (medio tiempo / contrato especial)`)
  }

  const diasTrabajados = Math.max(0, dias - nov.diasIncapacidad - nov.diasVacaciones)
  const salario = salarioMensual * diasTrabajados / 30
  const valorIncapacidad = nov.valorEmpleador + nov.valorTercero
  const valorVacaciones = nov.valorVacaciones

  // Horas extras y recargos: por cantidad x tipo + campo manual para atípicos
  const horasCalc = calcularHorasRecargos(input.horas, salarioMensual, params, fechaRef)
  const horasManual = amount(input.horas_extras)
  const horas = horasCalc.valor + horasManual
  // Tope de trabajo suplementario: 2h por día y 12h por semana (CST art. 167 /
  // Ley 2466 de 2025 art. 22). Se valida por fecha real de cada fila, no solo
  // por agregado del período; el exceso requiere autorización del Ministerio
  // del Trabajo y es sancionable.
  const maxDiarias = Number(params.extras_max_diarias ?? 2)
  const maxSemanales = Number(params.extras_max_semanales ?? 12)
  const consecuenciaTope = 'el exceso requiere autorización del Ministerio del Trabajo y es sancionable (CST art. 167, Ley 2466/2025 art. 22)'
  const porDia = {}
  const porSemana = {}
  const lunesSemana = f => {
    const d = new Date(`${f}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  }
  for (const d of horasCalc.detalle) {
    if (d.error || !HORAS_EXTRA_TIPOS.has(d.tipo) || !d.fecha) continue
    porDia[d.fecha] = (porDia[d.fecha] || 0) + d.cantidad
    const semana = lunesSemana(d.fecha)
    porSemana[semana] = (porSemana[semana] || 0) + d.cantidad
  }
  for (const [dia, h] of Object.entries(porDia)) {
    if (h > maxDiarias) {
      alertas.push(`${round2(h)}h extra el ${dia} superan el máximo de ${maxDiarias}h/día; ${consecuenciaTope}`)
    }
  }
  for (const [semana, h] of Object.entries(porSemana)) {
    if (h > maxSemanales) {
      alertas.push(`${round2(h)}h extra en la semana del ${semana} superan el máximo de ${maxSemanales}h/semana; ${consecuenciaTope}`)
    }
  }
  // Respaldo agregado: filas sin fecha o acumulado por encima del máximo del período
  const topePeriodo = Math.min(maxDiarias * diasTrabajados, maxSemanales * Math.ceil(diasTrabajados / 7))
  const sinFecha = horasCalc.detalle.some(d => !d.error && HORAS_EXTRA_TIPOS.has(d.tipo) && !d.fecha)
  if (horasCalc.horasExtra > 0 && horasCalc.horasExtra > topePeriodo) {
    alertas.push(`Horas extra del período (${horasCalc.horasExtra}h) superan el tope agregado (~${round2(topePeriodo)}h: ${maxDiarias}/día, ${maxSemanales}/semana); ${consecuenciaTope}`)
  } else if (sinFecha) {
    alertas.push('Hay horas extra sin fecha: no se pudo validar el tope de 2h/día ni 12h/semana por día real')
  }
  if (horasCalc.detalle.some(d => d.error)) {
    alertas.push('Hay tipos de hora extra/recargo no reconocidos; se ignoraron')
  }

  // Ingresos tipificados por concepto (catálogo). Cada fila llega resuelta con
  // { concepto_id, concepto, valor, constitutivo_salario, tratamiento_fiscal }.
  // constitutivo_salario=true → suma como devengo salarial (IBC/prestaciones);
  // tratamiento_fiscal='incr' → se excluye de la depuración de retención.
  const ingresosDetalle = []
  let ingresosSalariales = 0
  let nocGravable = 0
  let nocIncr = 0
  const uvt = Number(params.uvt) || 0
  for (const ing of (Array.isArray(input.ingresos) ? input.ingresos : [])) {
    const valor = amount(ing.valor)
    if (!valor) continue
    const salarial = ing.constitutivo_salario === true || ing.constitutivo_salario === 1
    const incr = ing.tratamiento_fiscal === 'incr'
    // INCR parcial: el componente exento se topa a limite_incr_uvt UVT por mes
    // (prorrateado a los días del período) y puede exigir un techo salarial
    // (condicion_salario_uvt, ej. 310 UVT en el auxilio de alimentación).
    let incrParte = 0
    if (!salarial && incr) {
      const condicionUvt = Number(ing.condicion_salario_uvt) || 0
      const cumpleCondicion = !condicionUvt || !uvt || salarioMensual <= uvt * condicionUvt
      if (cumpleCondicion) {
        const limiteUvt = Number(ing.limite_incr_uvt) || 0
        const tope = limiteUvt && uvt ? uvt * limiteUvt * (dias / 30) : Infinity
        incrParte = Math.min(valor, tope)
      }
    }
    if (salarial) {
      ingresosSalariales += valor
    } else {
      nocIncr += incrParte
      nocGravable += valor - incrParte
    }
    ingresosDetalle.push({
      concepto_id: ing.concepto_id ?? null,
      concepto: ing.concepto || null,
      valor: round2(valor),
      constitutivo_salario: salarial,
      tratamiento_fiscal: incr ? 'incr' : 'gravable',
      incr_parte: round2(incrParte),
      gravable_parte: round2(valor - incrParte),
    })
  }
  const otros = amount(input.otros_ingresos) + ingresosSalariales
  // Monto plano (sin concepto): el checkbox INCR aplica solo a esa porción;
  // las filas tipificadas INCR siempre se excluyen de la retención.
  const ingresoNoc = amount(input.ingreso_noc) + nocGravable + nocIncr
  const indemnizacion = amount(input.indemnizacion)
  // Descuentos tipificados (embargo/libranza/cooperativa/alimentos/prestamo/otro)
  // — el monto plano input.deducciones sigue sumando como genérico.
  const descuentosTipificados = (Array.isArray(input.descuentos) ? input.descuentos : [])
    .map(d => ({
      tipo: ['embargo', 'libranza', 'cooperativa', 'alimentos', 'prestamo'].includes(d.tipo) ? d.tipo : 'otro',
      concepto: String(d.concepto || 'Descuento').slice(0, 200),
      valor: amount(d.valor),
    }))
    .filter(d => d.valor > 0)
  const deducciones = amount(input.deducciones) + descuentosTipificados.reduce((s, d) => s + d.valor, 0)

  const mode = empleado.auxilio_transporte_mode ?? (empleado.subsidio_transporte ? 'si' : 'automatico')
  const topeAuxilio = Number(params.salario_minimo) * Number(params.auxilio_tope_smmlv)
  const auxEligible = mode !== 'no' && salarioMensual <= topeAuxilio
  // El auxilio solo se causa por días efectivamente trabajados (no durante
  // incapacidad); las vacaciones disfrutadas son días remunerados.
  const diasRemunerados = diasTrabajados + nov.diasVacaciones
  const aux = auxEligible ? Number(params.auxilio_transporte) * diasRemunerados / 30 : 0

  const totalRemuneracion = salario + valorIncapacidad + horas + otros + ingresoNoc
  const noSalarialIncluido = Math.min(
    ingresoNoc,
    totalRemuneracion * Number(params.limite_no_salarial_pct) / 100,
  )
  const excedenteNoSalarial = ingresoNoc - noSalarialIncluido
  // Salario integral (CST 132 + Ley 100/93 art. 18): los aportes cotizan sobre
  // el 70% del salario (parametrizado por vigencia). Las prestaciones ya van
  // compensadas en el factor prestacional → no se provisionan; las vacaciones
  // sí se provisionan (art. 132 las excluye expresamente de la integración).
  const esIntegral = input.salario_integral === true || input.salario_integral === 1
  const factorIntegral = esIntegral ? Number(params.salario_integral_ibc_pct ?? 70) / 100 : 1
  const baseIbc = salario + valorVacaciones + valorIncapacidad + horas + otros + excedenteNoSalarial
  const ibc = Math.min(
    baseIbc * factorIntegral,
    Number(params.salario_minimo) * Number(params.max_ibc_smmlv || 25) * dias / 30,
  )
  if (esIntegral) {
    const pctVacInt = Number(params.vacaciones_base_integral_pct ?? 70)
    alertas.push(`Salario integral: IBC al 70% (Ley 100 art. 18), prima/cesantías/intereses no provisionados (compensados en el factor prestacional, CST 132); vacaciones provisionadas sobre ${pctVacInt}% de la base (PENDIENTE_VERIFICAR contador); parafiscales sin reducción (PENDIENTE_VERIFICAR CST 132 num. 3 / C-988-99).`)
  }

  // Licencia no remunerada (SLN): por los días suspendidos el empleador sigue
  // cotizando salud/pensión/parafiscales sobre el IBC del mes inmediatamente
  // anterior, prorrateado (Decreto 780/2016 art. 3.2.5.2; Decreto 1833/2016
  // art. 71). ARL no se cotiza en esos días (Corte Constitucional T-162/2004)
  // y no hay deducciones a cargo del trabajador por ese período.
  const ibcMesAnterior = amount(input.ibc_mes_anterior)
  if (nov.diasNoRemunerados && !ibcMesAnterior) {
    alertas.push('Licencia no remunerada sin IBC del mes anterior: se usa el salario base como referencia — verificar (Decreto 780/2016 art. 3.2.5.2)')
  }
  const ibcSln = nov.diasNoRemunerados
    ? (ibcMesAnterior || salarioMensual) * nov.diasNoRemunerados / 30
    : 0
  const ibcEmpleador = ibc + ibcSln

  const factorMensual = dias > 0 ? 30 / dias : 0
  const ibcMensualizado = ibc * factorMensual
  const deduccionSalud = pct(params.salud_empleado_pct, ibc)
  const deduccionPension = pct(params.pension_empleado_pct, ibc)
  const fsp = pct(fondoSolidaridadPct(ibcMensualizado, params), ibc)

  const salarioParaExoneracion = dias > 0 ? (salario + valorVacaciones + valorIncapacidad + horas + otros) * 30 / dias : 0
  const exoneradoPorEmpleado = Boolean(aplicaExoneracion) &&
    salarioParaExoneracion < Number(params.salario_minimo) * 10
  const saludEmpleador = exoneradoPorEmpleado ? 0 : pct(params.salud_empleador_pct, ibcEmpleador)
  const pensionEmpleador = pct(params.pension_empleador_pct, ibcEmpleador)
  const riesgoClase = String(empleado.riesgo || 'I').toLowerCase()
  const arl = pct(params[`arl_${riesgoClase}_pct`] ?? params.arl_i_pct, ibc)
  const ccf = pct(params.caja_pct, ibcEmpleador)
  const sena = exoneradoPorEmpleado ? 0 : pct(params.sena_pct, ibcEmpleador)
  const icbf = exoneradoPorEmpleado ? 0 : pct(params.icbf_pct, ibcEmpleador)

  // Retención: base = devengado gravable del período (sin auxilio que es INCR,
  // sin indemnización que tiene régimen propio; el INCR tipificado y el plano
  // marcado como INCR quedan excluidos de la base de retención)
  const baseRetencion = salario + valorVacaciones + valorIncapacidad + horas + otros
    + nocGravable
    + (input.ingreso_noc_incr ? 0 : amount(input.ingreso_noc))
  const ret = retencionMensual(baseRetencion, deduccionSalud + deduccionPension + fsp, factorMensual, params)
  // Compatibilidad: retencion_fuente como input manual se interpreta como ajuste
  const retAjuste = Number(input.retencion_ajuste ?? input.retencion_fuente ?? 0) || 0
  const retencion = Math.max(0, ret.retencion + retAjuste)
  if (retAjuste) {
    alertas.push(`Retención ajustada manualmente (${retAjuste > 0 ? '+' : ''}${round2(retAjuste)}): ${input.retencion_ajuste_motivo || 'sin motivo registrado'}`)
  }

  // Provisiones: la base del período ya refleja los días causados.
  // El excedente no salarial sobre el 40% se incluye en prestaciones siguiendo
  // la interpretación mayoritaria del art. 30 Ley 1393/2010 ("salario para
  // todos los efectos legales"). Si el contador del cliente aplica una
  // interpretación restrictiva, el ajuste se hace fuera del sistema.
  const basePrestaciones = salario + valorVacaciones + valorIncapacidad + horas + otros + aux + excedenteNoSalarial
  const prima = esIntegral ? 0 : basePrestaciones * Number(params.prima_pct) / 100
  const cesantias = esIntegral ? 0 : basePrestaciones * Number(params.cesantias_pct) / 100
  const intereses = esIntegral ? 0 : basePrestaciones * Number(params.intereses_cesantias_pct_anual) / 100 / 12
  // Vacaciones cuando es integral: base = salarial × vacaciones_base_integral_pct
  // (default 70%). PENDIENTE_VERIFICAR: el CST 132 exceptúa las vacaciones de
  // la integración, lo que podría implicar base = salario integral completo
  // (100%). Parafiscales sin reducción para integral — PENDIENTE_VERIFICAR
  // (CST 132 num. 3 / C-988-99); el cálculo actual no se toca.
  const baseVacIntegral = baseIbc * Number(params.vacaciones_base_integral_pct ?? 70) / 100
  const vacaciones = (esIntegral ? baseVacIntegral : salario + valorVacaciones + valorIncapacidad + horas + otros + excedenteNoSalarial) * Number(params.vacaciones_pct) / 100

  const totalDevengado = salario + valorVacaciones + valorIncapacidad + aux + horas + otros + ingresoNoc + indemnizacion
  const totalDeducciones = deduccionSalud + deduccionPension + fsp + deducciones + retencion
  const neto = totalDevengado - totalDeducciones

  // Topes legales de descuento por tipo (acumulados por categoría en el período):
  //  - embargo: 1/5 del excedente sobre el SMMLV, base = devengado salarial
  //    (CST arts. 154-155, mod. Ley 11/1984).
  //  - alimentos y cooperativas: hasta 50% del salario (CST art. 156;
  //    cooperativas también Ley 1527/2012 art. 22 — incluye descuentos de ley).
  //  - libranza: el trabajador no puede quedar con menos del 50% del neto
  //    tras descuentos de ley (Ley 1527/2012 art. 5 num. 5 y art. 22).
  //  - prestamo/otro: sin tope legal → no se evalúan.
  // Alerta, no bloqueo (consistente con horas extras).
  if (descuentosTipificados.length) {
    const baseDevengadoSalarial = salario + valorIncapacidad + horas + otros
    const smmlvPeriodo = Number(params.salario_minimo) * dias / 30
    const netoLey = totalDevengado - deduccionSalud - deduccionPension - fsp - retencion
    const topes = {
      embargo: Math.max(0, baseDevengadoSalarial - smmlvPeriodo) * 0.2,
      alimentos: baseDevengadoSalarial * 0.5,
      cooperativa: baseDevengadoSalarial * 0.5,
      libranza: Math.max(0, netoLey) * 0.5,
    }
    const porTipo = {}
    for (const d of descuentosTipificados) porTipo[d.tipo] = (porTipo[d.tipo] || 0) + d.valor
    for (const [tipo, valorTipo] of Object.entries(porTipo)) {
      const tope = topes[tipo]
      if (tope !== undefined && valorTipo > tope) {
        alertas.push(`Descuentos '${tipo}' del período (${round2(valorTipo)}) superan el tope legal (${round2(tope)}) — verificar antes de aplicar`)
      }
    }
  }
  const totalAportesEmpleador = saludEmpleador + pensionEmpleador + arl + ccf + sena + icbf
  const totalPlanilla = totalAportesEmpleador + deduccionSalud + deduccionPension + fsp
  const totalPrestaciones = prima + cesantias + intereses + vacaciones
  const costoEmpresa = totalDevengado + totalAportesEmpleador + totalPrestaciones

  return {
    dias_laborados: diasTrabajados,
    dias_incapacidad: nov.diasIncapacidad,
    salario_base: round2(salarioMensual),
    aux_transporte: round2(aux),
    horas_extras: round2(horas),
    otros_ingresos: round2(otros),
    ingreso_noc: round2(ingresoNoc),
    // El flag INCR solo aplica al ingreso no constitutivo plano (los tipificados
    // llevan su propio tratamiento). Si el monto plano es 0, el flag queda
    // sucio sin efecto → se limpia aquí.
    ingreso_noc_incr: amount(input.ingreso_noc) > 0 && input.ingreso_noc_incr ? 1 : 0,
    ingreso_noc_incr_motivo: amount(input.ingreso_noc) > 0 && input.ingreso_noc_incr
      ? input.ingreso_noc_incr_motivo || null
      : null,
    ingresos_detalle: JSON.stringify(ingresosDetalle),
    indemnizacion: round2(indemnizacion),
    valor_vacaciones: round2(valorVacaciones),
    valor_incapacidad_empleador: round2(nov.valorEmpleador),
    valor_incapacidad_tercero: round2(nov.valorTercero),
    ibc: round2(ibc),
    ibl: round2(ibc),
    salud: round2(saludEmpleador),
    pension: round2(pensionEmpleador),
    salud_empleado: round2(deduccionSalud),
    pension_empleado: round2(deduccionPension),
    fsp: round2(fsp),
    arl: round2(arl),
    ccf: round2(ccf),
    sena: round2(sena),
    icbf: round2(icbf),
    riesgo: round2(arl),
    prima: round2(prima),
    cesantias: round2(cesantias),
    intereses: round2(intereses),
    vacaciones: round2(vacaciones),
    deducciones: round2(deducciones),
    retencion_fuente: round2(retencion),
    retencion_calculada: round2(ret.retencion),
    retencion_ajuste: round2(retAjuste),
    retencion_ajuste_motivo: retAjuste ? String(input.retencion_ajuste_motivo || '').slice(0, 300) || null : null,
    salario_menor_motivo: bajoMinimo ? String(input.salario_menor_motivo || '').slice(0, 300) || null : null,
    total_devengado: round2(totalDevengado),
    total_deducciones: round2(totalDeducciones),
    total_aportes_empleador: round2(totalAportesEmpleador),
    total_prestaciones: round2(totalPrestaciones),
    total_nomina: round2(totalDevengado),
    total_planilla: round2(totalPlanilla),
    neto: round2(neto),
    neto_pagar: round2(neto),
    costo_empresa: round2(costoEmpresa),
    no_salarial_ibc: round2(excedenteNoSalarial),
    exonerado_ley_114_1: exoneradoPorEmpleado,
    deducciones_detalle: descuentosTipificados.length ? JSON.stringify(descuentosTipificados) : null,
    recargos_detalle: horasCalc.detalle.length ? JSON.stringify(horasCalc.detalle) : null,
    novedades_detalle: nov.detalle.length ? JSON.stringify(nov.detalle) : null,
    alertas: alertas.length ? JSON.stringify(alertas) : null,
  }
}

// Tabla de retención en la fuente por ingresos laborales, art. 383 ET
// (redacción vigente desde Ley 2010 de 2019). Rangos en UVT sobre el ingreso
// laboral gravado depurado. El impuesto en UVT = (base - resta_uvt) * tarifa% + suma_uvt.
const RETENCION_TABLA_383 = [
  { desde: 0, hasta: 95, tarifa: 0, resta_uvt: 0, suma_uvt: 0 },
  { desde: 95, hasta: 150, tarifa: 19, resta_uvt: 95, suma_uvt: 0 },
  { desde: 150, hasta: 360, tarifa: 28, resta_uvt: 150, suma_uvt: 10 },
  { desde: 360, hasta: 640, tarifa: 33, resta_uvt: 360, suma_uvt: 69 },
  { desde: 640, hasta: 945, tarifa: 35, resta_uvt: 640, suma_uvt: 162 },
  { desde: 945, hasta: 2300, tarifa: 37, resta_uvt: 945, suma_uvt: 268 },
  { desde: 2300, hasta: null, tarifa: 39, resta_uvt: 2300, suma_uvt: 770 },
]

// Jornada máxima semanal según Ley 2101 de 2021 (reducción gradual).
// El divisor mensual de la hora ordinaria = horas_semanales * 30 / 6.
const JORNADA_CORTES = [
  { desde: '2000-01-01', horas_semanales: 48 },
  { desde: '2023-07-16', horas_semanales: 47 },
  { desde: '2024-07-15', horas_semanales: 46 },
  { desde: '2025-07-15', horas_semanales: 44 },
  { desde: '2026-07-15', horas_semanales: 42 },
]

// Recargo por trabajo en día de descanso obligatorio, art. 179 CST con
// implementación gradual de la Ley 2466 de 2025 (art. 14).
const DOMINICAL_CORTES = [
  { desde: '2000-01-01', pct: 75 },
  { desde: '2025-07-01', pct: 80 },
  { desde: '2026-07-01', pct: 90 },
  { desde: '2027-07-01', pct: 100 },
]

const PARAMETROS_COMUNES = {
  auxilio_tope_smmlv: 2,
  max_ibc_smmlv: 25,
  salud_empleado_pct: 4,
  pension_empleado_pct: 4,
  salud_empleador_pct: 8.5,
  pension_empleador_pct: 12,
  arl_i_pct: 0.522,
  arl_ii_pct: 1.044,
  arl_iii_pct: 2.436,
  arl_iv_pct: 4.35,
  arl_v_pct: 6.96,
  caja_pct: 4,
  sena_pct: 2,
  icbf_pct: 3,
  prima_pct: 8.33333333,
  cesantias_pct: 8.33333333,
  intereses_cesantias_pct_anual: 12,
  vacaciones_pct: 4.16666667,
  fsp_tope_inicial_smmlv: 4,
  fsp_4_16_pct: 1,
  fsp_16_17_pct: 1.2,
  fsp_17_18_pct: 1.4,
  fsp_18_19_pct: 1.6,
  fsp_19_20_pct: 1.8,
  fsp_mas_20_pct: 2,
  limite_no_salarial_pct: 40,
  // Retención en la fuente, procedimiento 1 (art. 383 y 388 ET)
  retencion_tabla: RETENCION_TABLA_383,
  retencion_exenta_pct: 25,
  retencion_exenta_tope_uvt: 240,
  // Horas extras y recargos (CST arts. 161-168, 179; Ley 2466 de 2025)
  extra_diurna_pct: 25,
  extra_nocturna_pct: 75,
  recargo_nocturno_pct: 35,
  dominical_cortes: DOMINICAL_CORTES,
  jornada_cortes: JORNADA_CORTES,
  extras_max_diarias: 2,
  extras_max_semanales: 12,
  // Incapacidades y licencias (Dec. 780/2016, Ley 776/2002, Ley 100/1993)
  incapacidad_comun_dias_empleador: 2,
  incapacidad_comun_eps_pct: 66.67,
  incapacidad_excedente_pct: 0,
  incapacidad_laboral_dias_empleador: 1,
  incapacidad_laboral_pct: 100,
  licencia_maternidad_dias: 126,
  licencia_paternidad_dias: 14,
  // Salario integral (CST 132; Ley 100/93 art. 18): cotizaciones sobre el 70%
  salario_integral_ibc_pct: 70,
}

export const NOMINA_PARAMETER_DEFAULTS = {
  2025: {
    vigencia: 2025,
    salario_minimo: 1423500,
    auxilio_transporte: 200000,
    uvt: 49799,
    ...PARAMETROS_COMUNES,
    fuente_normativa: 'Decretos 1572 y 1573 de 2024; Resolución DIAN 000193 de 2024; tasas SGSS vigentes 2025; retención art. 383 ET; recargos CST arts. 161-179 y Ley 2466 de 2025.',
  },
  2026: {
    vigencia: 2026,
    salario_minimo: 1750905,
    auxilio_transporte: 249095,
    uvt: 52374,
    ...PARAMETROS_COMUNES,
    fuente_normativa: 'Decreto 0159 de 2026 (SMLMV transitorio); Decreto 1470 de 2025 (auxilio); Resolución DIAN 000238 de 2025 (UVT); tasas SGSS vigentes 2026; retención art. 383 ET; recargos CST arts. 161-179 y Ley 2466 de 2025.',
  },
}

// Campos que viajan como JSON (arreglos de tramos/cortes), no como número.
export const NOMINA_JSON_FIELDS = ['retencion_tabla', 'jornada_cortes', 'dominical_cortes']

export const NOMINA_PARAMETER_FIELDS = Object.keys(NOMINA_PARAMETER_DEFAULTS[2026])
  .filter(key => !['vigencia', 'fuente_normativa', ...NOMINA_JSON_FIELDS].includes(key))

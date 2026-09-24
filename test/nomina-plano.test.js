import test from 'node:test'
import assert from 'node:assert/strict'
import { planoNomina, planoConceptos } from '../src/nomina-plano.js'

const nomina = {
  id: 7, nombre_periodo: 'Marzo 2026', vigencia: 2026,
  fecha_inicio: '2026-03-01', fecha_fin: '2026-03-31',
}

const detalles = [
  {
    empleado_id: 11, tipo_documento: 'CC', numero_documento: '123456789',
    primer_apellido: 'Pérez', segundo_apellido: 'Gómez',
    primer_nombre: 'Ana', segundo_nombre: 'María', cargo_nombre: 'Analista',
    dias_laborados: 30, dias_incapacidad: 0,
    salario_base: 2000000, aux_transporte: 249095, horas_extras: 150000,
    otros_ingresos: 0, ingreso_noc: 0, total_devengado: 2399095,
    valor_incapacidad_empleador: 0, valor_incapacidad_tercero: 0,
    salud_empleado: 95963.8, pension_empleado: 95963.8, fsp: 0,
    retencion_calculada: 0, retencion_ajuste: 0, retencion_fuente: 0,
    deducciones: 0, total_deducciones: 191927.6, neto_pagar: 2207167.4,
    ibc: 2399095, no_salarial_ibc: 0,
    salud: 0, pension: 287891.4, arl: 12523.2, ccf: 95963.8, sena: 0, icbf: 0,
    total_aportes_empleador: 396378.4,
    cesantias: 199924.6, intereses: 1999.25, prima: 199924.6, vacaciones: 99962.3,
    total_prestaciones: 501810.75, costo_empresa: 3295852.55,
  },
  {
    empleado_id: 12, tipo_documento: 'CC', numero_documento: '987654321',
    primer_apellido: 'Ríos', segundo_apellido: null,
    primer_nombre: 'Carlos', segundo_nombre: null, cargo_nombre: 'Auxiliar',
    dias_laborados: 15, dias_incapacidad: 5,
    salario_base: 1750905, aux_transporte: 124547.5, horas_extras: 0,
    otros_ingresos: 0, ingreso_noc: 1500000, total_devengado: 3375452.5,
    ingreso_noc_incr: 0,
    ingresos_detalle: JSON.stringify([
      { concepto_id: 5, concepto: 'Auxilio de alimentación (pagos a terceros)', valor: 1000000, constitutivo_salario: 0, tratamiento_fiscal: 'incr', incr_parte: 1000000, gravable_parte: 0 },
      { concepto_id: 2, concepto: 'Bonificación pactada como no salarial', valor: 500000, constitutivo_salario: 0, tratamiento_fiscal: 'gravable', incr_parte: 0, gravable_parte: 500000 },
    ]),
    valor_incapacidad_empleador: 58363.5, valor_incapacidad_tercero: 0,
    salud_empleado: 40844.66, pension_empleado: 40844.66, fsp: 0,
    retencion_calculada: 0, retencion_ajuste: 0, retencion_fuente: 0,
    deducciones: 0, total_deducciones: 81689.32, neto_pagar: 3293763.18,
    ibc: 1021116.5, no_salarial_ibc: 0,
    salud: 0, pension: 122533.98, arl: 5330.63, ccf: 40844.66, sena: 0, icbf: 0,
    total_aportes_empleador: 168709.27,
    cesantias: 85093.04, intereses: 850.93, prima: 85093.04, vacaciones: 42546.52,
    total_prestaciones: 213583.53, costo_empresa: 3757745.3,
  },
]

test('plano principal: estructura, decimales con coma y fila TOTALES', () => {
  const out = planoNomina(nomina, detalles)
  const lineas = out.split('\r\n')
  assert.equal(lineas.length, 4) // header + 2 empleados + totales
  assert.ok(lineas[0].startsWith('nomina_id;periodo;'))
  assert.ok(!out.includes('\uFEFF')) // sin BOM
  const cols = lineas[0].split(';')
  assert.equal(lineas[1].split(';').length, cols.length)
  assert.ok(lineas[1].includes('2.000.000,00'.replace(/\./g, '')) || lineas[1].includes('2000000,00'))
  assert.ok(lineas[3].startsWith('TOTALES'))
  const tot = lineas[3].split(';')
  assert.equal(tot[cols.indexOf('total_devengado')], '5774547,50')
  assert.equal(tot[cols.indexOf('neto_pagar')], '5500930,58')
  assert.equal(tot[cols.indexOf('costo_empresa')], '7053597,85')
})

test('plano conceptos: una fila por empleado×concepto desde el snapshot', () => {
  const out = planoConceptos(nomina, detalles)
  const lineas = out.split('\r\n')
  assert.equal(lineas.length, 3) // header + 2 conceptos del empleado 12
  assert.ok(lineas[1].includes('Auxilio de alimentación'))
  assert.ok(lineas[2].includes('500000,00'))
})

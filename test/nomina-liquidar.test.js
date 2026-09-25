import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, loginAs, ADMIN, stopApp } from './helpers.js'
import db from '../src/db/knex.js'

let nominaId
let incapacidadId

async function smmlvVigente() {
  const p = await db('nomina_parametros').where('vigencia', 2026).first()
  return Number(p?.salario_minimo) || 0
}

test('crea y liquida un período quincenal con deducciones separadas y snapshot anual', async () => {
  const { token } = await loginAs(ADMIN)
  const empleado = await db('empleados')
    .where('empresa_id', 1)
    .where(builder => builder.whereNull('tipo_contrato').orWhereNot('tipo_contrato', 'prestacion'))
    .first()
  assert.ok(empleado, 'se necesita un empleado activo de la empresa de prueba')

  const created = await api.post('/nominas', {
    empresa_id: 1,
    nombre_periodo: `Test Nómina ${Date.now()} 2026`,
    vigencia: 2026,
    dias_periodo: 15,
  }, { token })
  assert.equal(created.status, 201)
  nominaId = created.data.nomina.id
  assert.equal(Number(created.data.nomina.dias_periodo), 15)

  const liquidated = await api.put(`/nominas/${nominaId}/liquidar`, {
    empleados: [{ empleado_id: empleado.id, salario_menor_motivo: 'Empleado de prueba' }],
  }, { token })
  assert.equal(liquidated.status, 200, JSON.stringify(liquidated.data))
  const detail = liquidated.data.detalles[0]
  assert.equal(Number(detail.dias_laborados), 15)
  assert.ok(Number(detail.salud_empleado) > 0)
  assert.ok(Number(detail.pension_empleado) > 0)
  assert.ok(Number(detail.neto_pagar) < Number(detail.total_devengado))
  assert.ok(liquidated.data.nomina.parametros_snapshot)
  assert.equal(Number(liquidated.data.nomina.total_neto_pagar), Number(detail.neto_pagar))
})

test('liquida incapacidad del período y horas por tipo con retención calculada', async () => {
  const { token } = await loginAs(ADMIN)
  const empleado = await db('empleados')
    .where('empresa_id', 1)
    .whereIn('riesgo', ['I', 'II', 'III', 'IV', 'V'])
    .first()
  assert.ok(empleado, 'se necesita un empleado con clase de riesgo ARL asignada')

  // Incapacidad común de 5 días dentro del período (marzo 2026)
  const [incId] = await db('incapacidades').insert({
    empleado_id: empleado.id,
    fecha_inicio: '2026-03-03',
    fecha_fin: '2026-03-07',
    dias: 5,
    tipo: 'comun',
    status: 'reportada',
    created_at: new Date(),
    updated_at: new Date(),
  })
  incapacidadId = incId

  const created = await api.post('/nominas', {
    empresa_id: 1,
    nombre_periodo: 'Marzo 2026 - Mes',
    vigencia: 2026,
    dias_periodo: 30,
    fecha_inicio: '2026-03-01',
    fecha_fin: '2026-03-31',
  }, { token })
  assert.equal(created.status, 201)
  const id = created.data.nomina.id

  const liquidated = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{
      empleado_id: empleado.id,
      horas: [{ tipo: 'diurna', cantidad: 2, fecha: '2026-03-10' }],
      retencion_ajuste: 0,
      salario_menor_motivo: 'Empleado de prueba',
    }],
  }, { token })
  assert.equal(liquidated.status, 200, JSON.stringify(liquidated.data))
  const detail = liquidated.data.detalles[0]
  assert.equal(Number(detail.dias_incapacidad), 5)
  assert.equal(Number(detail.dias_laborados), 25)
  // 2 días empleador al 100% + 3 días EPS al 66.67%
  const dia = Number(empleado.salario_base) / 30
  assert.equal(Number(detail.valor_incapacidad_empleador), Math.round(dia * 2 * 100) / 100)
  assert.equal(Number(detail.valor_incapacidad_tercero), Math.round(dia * 3 * 0.6667 * 100) / 100)
  assert.ok(Number(detail.horas_extras) > 0)
  assert.ok(detail.recargos_detalle)
  assert.equal(Number(detail.retencion_fuente), Number(detail.retencion_calculada) + Number(detail.retencion_ajuste))

  const novedades = await api.get(`/nominas/${id}/novedades`, { token })
  assert.equal(novedades.status, 200)
  assert.ok(novedades.data.novedades.some(n => n.id === incapacidadId))

  const horas = await db('horas_extras').where('nomina_id', id)
  assert.equal(horas.length, 1)
  assert.equal(horas[0].tipo, 'diurna')

  await db('nomina_detalles').where('nomina_id', id).delete()
  await db('horas_extras').where('nomina_id', id).delete()
  await db('planillas').where('nomina_id', id).delete()
  await db('nominas').where('id', id).delete()
})

test('liquida ingresos tipificados por concepto y exige motivo para INCR manual', async () => {
  const { token } = await loginAs(ADMIN)
  const empleado = await db('empleados')
    .where('empresa_id', 1)
    .whereIn('riesgo', ['I', 'II', 'III', 'IV', 'V'])
    .first()
  assert.ok(empleado, 'se necesita un empleado con clase de riesgo ARL asignada')

  const conceptos = await api.get('/nominas/conceptos', { token })
  assert.equal(conceptos.status, 200)
  const viaticos = conceptos.data.data.find(c => c.tratamiento_fiscal === 'incr')
  const salarial = conceptos.data.data.find(c => c.constitutivo_salario === 1 || c.constitutivo_salario === true)
  assert.ok(viaticos && salarial, 'el seed del catálogo debe incluir INCR y salarial')

  const created = await api.post('/nominas', {
    empresa_id: 1,
    nombre_periodo: `Test Conceptos ${Date.now()} 2026`,
    vigencia: 2026,
    dias_periodo: 30,
    fecha_inicio: '2026-04-01',
    fecha_fin: '2026-04-30',
  }, { token })
  assert.equal(created.status, 201)
  const id = created.data.nomina.id

  // INCR manual sin motivo → bloqueado
  const sinMotivo = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{
      empleado_id: empleado.id, ingreso_noc: 500000, ingreso_noc_incr: true,
      salario_menor_motivo: 'Empleado de prueba',
    }],
  }, { token })
  assert.equal(sinMotivo.status, 400)

  const liquidated = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{
      empleado_id: empleado.id,
      salario_menor_motivo: 'Empleado de prueba',
      ingreso_noc: 100000,
      ingreso_noc_incr: true,
      ingreso_noc_incr_motivo: 'viáticos sin tipificar',
      ingresos: [
        { concepto_id: viaticos.id, valor: 200000 },
        { concepto_id: salarial.id, valor: 300000 },
      ],
    }],
  }, { token })
  assert.equal(liquidated.status, 200, JSON.stringify(liquidated.data))
  const detail = liquidated.data.detalles[0]
  // 100k plano + 200k viáticos tipificados no salariales
  assert.equal(Number(detail.ingreso_noc), 300000)
  assert.equal(Number(detail.otros_ingresos), 300000)
  assert.equal(detail.ingreso_noc_incr_motivo, 'viáticos sin tipificar')
  const det = typeof detail.ingresos_detalle === 'string'
    ? JSON.parse(detail.ingresos_detalle)
    : detail.ingresos_detalle
  assert.equal(det.length, 2)
  assert.ok(det.some(g => g.tratamiento_fiscal === 'incr'))

  // Filas persistidas y auditables en otros_ingresos
  const rows = await db('otros_ingresos').where('nomina_id', id)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => r.concepto_id))

  await db('otros_ingresos').where('nomina_id', id).delete()
  await db('nomina_detalles').where('nomina_id', id).delete()
  await db('horas_extras').where('nomina_id', id).delete()
  await db('planillas').where('nomina_id', id).delete()
  await db('nominas').where('id', id).delete()
})

// FIXTURE: JHON SANJUAN (empleado 1042, empresa 1) queda intencionalmente
// con salario_base < SMMLV y motivo 'dato de prueba' en su ficha, para que
// la regla SMMLV (alerta + motivo obligatorio) esté cubierta en el día a
// día de la suite. Todos los demás empleados activos están en SMMLV o más.
// No "corregir" su salario sin ajustar este test.
test('salario inferior al SMMLV exige motivo y queda en alertas', async (t) => {
  const { token } = await loginAs(ADMIN)
  const minimo = await smmlvVigente()
  const empleado = await db('empleados')
    .where('empresa_id', 1)
    .where('salario_base', '>', 0)
    .where('salario_base', '<', minimo)
    .whereIn('riesgo', ['I', 'II', 'III', 'IV', 'V'])
    .where(builder => builder.whereNull('tipo_contrato').orWhereNot('tipo_contrato', 'prestacion'))
    .first()
  if (!empleado) return t.skip('sin empleado bajo el SMMLV en datos de prueba')
  // El motivo de la ficha respalda el input: se limpia para probar el bloqueo
  const motivoFicha = empleado.salario_menor_motivo ?? null
  await db('empleados').where('id', empleado.id).update({ salario_menor_motivo: null })

  const created = await api.post('/nominas', {
    empresa_id: 1,
    nombre_periodo: `Test SMMLV ${Date.now()} 2026`,
    vigencia: 2026,
    dias_periodo: 15,
  }, { token })
  assert.equal(created.status, 201)
  const id = created.data.nomina.id

  // Salario < SMMLV + sin motivo → NO puede liquidar (400 con estructura de nombres)
  const sinMotivo = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{ empleado_id: empleado.id }],
  }, { token })
  assert.equal(sinMotivo.status, 400)
  assert.match(sinMotivo.data.error, /SMMLV/)
  const bloqueado = sinMotivo.data.empleados_bloqueados?.find(b => b.id === empleado.id)
  assert.ok(bloqueado, 'empleados_bloqueados debe listar al empleado')
  assert.ok(bloqueado.nombre, 'debe incluir el nombre')
  assert.equal(bloqueado.documento, empleado.numero_documento)
  assert.equal(Number(bloqueado.salario), Number(empleado.salario_base))

  // Salario < SMMLV + motivo en el input → puede liquidar y el motivo persiste
  const ok = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{ empleado_id: empleado.id, salario_menor_motivo: 'Medio tiempo pactado' }],
  }, { token })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  const detail = ok.data.detalles[0]
  assert.equal(detail.salario_menor_motivo, 'Medio tiempo pactado')
  const alertas = typeof detail.alertas === 'string' ? JSON.parse(detail.alertas) : detail.alertas
  assert.ok(alertas.some(a => a.includes('SMMLV')))

  // Motivo en la ficha del empleado → también desbloquea y persiste
  await db('empleados').where('id', empleado.id).update({ salario_menor_motivo: 'dato de prueba' })
  const okFicha = await api.put(`/nominas/${id}/liquidar`, {
    empleados: [{ empleado_id: empleado.id }],
  }, { token })
  assert.equal(okFicha.status, 200, JSON.stringify(okFicha.data))
  assert.equal(okFicha.data.detalles[0].salario_menor_motivo, 'dato de prueba')

  await db('nomina_detalles').where('nomina_id', id).delete()
  await db('horas_extras').where('nomina_id', id).delete()
  await db('planillas').where('nomina_id', id).delete()
  await db('nominas').where('id', id).delete()
  await db('empleados').where('id', empleado.id).update({ salario_menor_motivo: motivoFicha })
})

test.after(async () => {
  if (incapacidadId) await db('incapacidades').where('id', incapacidadId).delete()
  if (nominaId) {
    await db('nomina_detalles').where('nomina_id', nominaId).delete()
    await db('horas_extras').where('nomina_id', nominaId).delete()
    await db('planillas').where('nomina_id', nominaId).delete()
    await db('nominas').where('id', nominaId).delete()
  }
  await stopApp()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { festivosDelAnio, noLaboralInfo } from '../src/festivos.js'

const mapa2026 = new Map(festivosDelAnio(2026).map(f => [f.fecha, f.nombre]))

test('genera los 18 festivos del año', () => {
  assert.equal(festivosDelAnio(2026).length, 18)
  assert.equal(festivosDelAnio(2025).length, 18)
})

test('fechas fijas nacionales', () => {
  for (const fecha of ['2026-01-01', '2026-05-01', '2026-07-20', '2026-08-07', '2026-12-08', '2026-12-25']) {
    assert.ok(mapa2026.has(fecha), `${fecha} debe ser festivo`)
  }
})

test('Ley Emiliani traslada al lunes siguiente', () => {
  // 2026: Reyes cae martes 6 → lunes 12; San José jueves 19 → lunes 23;
  // Todos los Santos domingo 1 → lunes 2; Cartagena miércoles 11 → lunes 16.
  assert.ok(mapa2026.has('2026-01-12'))
  assert.ok(mapa2026.has('2026-03-23'))
  assert.ok(mapa2026.has('2026-11-02'))
  assert.ok(mapa2026.has('2026-11-16'))
  assert.ok(!mapa2026.has('2026-01-06'))
  assert.ok(!mapa2026.has('2026-03-19'))
  // San Pedro 2026 ya cae lunes 29: no se mueve.
  assert.ok(mapa2026.has('2026-06-29'))
})

test('festivos de Pascua 2026 (Pascua = 5 de abril)', () => {
  assert.ok(mapa2026.has('2026-04-02'), 'Jueves Santo')
  assert.ok(mapa2026.has('2026-04-03'), 'Viernes Santo')
  assert.ok(mapa2026.has('2026-05-18'), 'Ascensión (lunes)')
  assert.ok(mapa2026.has('2026-06-08'), 'Corpus Christi (lunes)')
  assert.ok(mapa2026.has('2026-06-12'), 'Sagrado Corazón (viernes)')
})

test('los festivos trasladables siempre caen lunes', () => {
  const lunes = ['01-12', '03-23', '05-18', '06-08', '06-29', '08-17', '10-12', '11-02', '11-16']
  for (const md of lunes) {
    const dow = new Date(`2026-${md}T00:00:00Z`).getUTCDay()
    assert.equal(dow, 1, `2026-${md} debe ser lunes`)
    assert.ok(mapa2026.has(`2026-${md}`))
  }
})

test('noLaboralInfo detecta festivo, domingo y día hábil', () => {
  assert.deepEqual(
    noLaboralInfo('2026-05-18', mapa2026),
    { es_no_laboral: true, motivo: 'Ascensión del Señor' },
  )
  assert.deepEqual(
    noLaboralInfo('2026-10-11', mapa2026), // domingo
    { es_no_laboral: true, motivo: 'Domingo' },
  )
  assert.deepEqual(
    noLaboralInfo('2026-10-13', mapa2026), // martes hábil
    { es_no_laboral: false, motivo: null },
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatearFechaContrato, textoVencimientoContrato } from '../src/services/avisos-contratos.js'

test('el aviso de contrato formatea DATE UTC sin desplazar el día', () => {
  assert.equal(formatearFechaContrato(new Date('2026-10-17T00:00:00.000Z')), '17/10/2026')
  assert.equal(formatearFechaContrato('2026-10-17'), '17/10/2026')
})

test('el mensaje diferencia vencimiento hoy, mañana y días restantes', () => {
  assert.equal(textoVencimientoContrato(0), 'vence hoy')
  assert.equal(textoVencimientoContrato(1), 'vence mañana')
  assert.equal(textoVencimientoContrato(30), 'vence en 30 días')
})

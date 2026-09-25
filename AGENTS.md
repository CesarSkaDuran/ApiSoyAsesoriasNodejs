# ApiSoyAsesorias — notas del proyecto

## Comandos

- `npm start` — API en :3000 (corre migraciones al arrancar)
- `npm run dev` — con `--watch`
- `npm test` — suite completa (`node --test test/*.test.js`)

## Fixtures de la suite

- **JHON SANJUAN (empleado 1042, empresa 1)** queda intencionalmente con
  `salario_base < SMMLV` y `salario_menor_motivo = 'dato de prueba'` para
  cubrir la regla SMMLV (alerta + motivo obligatorio en liquidación y en
  el form de empleado). No "corregir" su salario sin ajustar
  `test/nomina-liquidar.test.js` ("salario inferior al SMMLV...").
- Todos los demás empleados activos están en SMMLV ($1.750.905, vigencia
  2026) o más, con motivo 'dato de prueba' residual en ficha (inofensivo).

## Reglas de negocio recientes (nómina)

- **Salario integral (CST 132)**: mínimo = 10 SMMLV × (1 +
  `empresas.factor_prestacional_pct`/100) → 13 SMMLV con el default 30%.
  Validación bloqueante 400 al guardar empleado y al liquidar nómina
  (`empleados_integral_invalidos`). Factor de empresa validado 30–100;
  subirlo devuelve 409 si invalida integrales existentes salvo
  `forzar_cambio_factor=true`. IBC al 70% (`salario_integral_ibc_pct`).
  **Parafiscales SIN reducción — PENDIENTE_VERIFICAR** (caja/SENA/ICBF
  como hoy). Base de vacaciones `vacaciones_base_integral_pct` (default
  70) — **PENDIENTE_VERIFICAR** con contador.

- Empleado con `salario_base < SMMLV` exige `salario_menor_motivo`
  (ficha o input de liquidación); sin él el endpoint responde 400 con
  `empleados_bloqueados` (id, nombre, documento, salario).
- `ingreso_noc_incr` solo se persiste cuando el ingreso plano > 0.
- Los DECIMAL llegan como string desde MySQL: coerción `Number()`
  explícita en cualquier suma de parámetros (bug histórico de NaN en el
  estimado del frontend).

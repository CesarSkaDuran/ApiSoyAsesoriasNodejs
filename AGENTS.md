# ApiSoyAsesorias — notas del proyecto

## Comandos

- `npm start` — API en :3000 (corre migraciones al arrancar)
- `npm run dev` — con `--watch`
- `npm test` — suite completa (`node --test test/*.test.js`)

## Fixtures de la suite

- La empresa de pruebas conservada es SOYASESORIAS (ID 2), con sus 11 empleados.
- El test de salarios bajo SMMLV se omite si no hay un empleado elegible
  bajo el mínimo; no mantiene un empleado de prueba dentro de los datos de clientes.
- Los DECIMAL llegan como string y se convierten antes de operaciones aritméticas.

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

## Swagger / OpenAPI

- Interfaz: `/api-docs`; especificación JSON: `/api-docs.json`.
- La definición está en `src/docs/openapi.js`; al agregar o cambiar rutas,
  actualizar también su inventario OpenAPI.
- Endpoints protegidos documentan Bearer JWT; captación de leads usa
  `x-marketing-token`.
- `SWAGGER_ENABLED=false` desactiva la documentación.
- Mantener `src/index.js` sin top-level await: el cargador Passenger/LiteSpeed
  requiere la entrada y no soporta módulos ESM con top-level await.

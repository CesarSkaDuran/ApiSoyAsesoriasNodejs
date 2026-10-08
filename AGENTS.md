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
- La recontratación archiva el vínculo cerrado en `empleado_periodos` y conserva
  el ID del empleado. `empleados` debe usar InnoDB para bloquear recontrataciones
  simultáneas; las migraciones convierten tablas MyISAM existentes sin borrar filas.

## Identidad global y multi-empleo

- `personas` es la identidad global (`UNIQUE(num_documento)`); `empleados` es el
  vínculo laboral por empresa (`empleados.persona_id` NOT NULL + FK).
  `personas.es_independiente` distingue perfiles del módulo independientes.
- Duplicado activo por empresa: columna generada `empresa_activa_id`
  (`empresa_id` si `status='activo'`, NULL si no) + `UNIQUE(persona_id,
  empresa_activa_id)` — MySQL no tiene índices parciales.
- `POST /empleados/contratar` resuelve la identidad con
  `services/personas-identidad.js` dentro de transacción (`FOR UPDATE` +
  retry ante deadlock); `POST /empleados` delega al mismo flujo.
- `GET /personas/buscar?documento=` es búsqueda ciega: solo
  id/nombre/documento/fecha_nacimiento, jamás empresa ni datos del tenant.
- `migrate-identidades.js` corre al final de `runMigrations`: diagnostica
  duplicados (no los fusiona), convierte engines, crea identidades para
  empleados existentes y agrega índices/FKs de forma idempotente.
- `ensurePersona(doc)` en test/helpers crea identidades para inserts directos.
- Los DECIMAL llegan como string desde MySQL: coerción `Number()`
  explícita en cualquier suma de parámetros (bug histórico de NaN en el
  estimado del frontend).

## Swagger / OpenAPI

- Interfaz: `/swagger`; especificación JSON: `/swagger.json`.
- La definición está en `src/docs/openapi.js`; al agregar o cambiar rutas,
  actualizar también su inventario OpenAPI.
- Endpoints protegidos documentan Bearer JWT; captación de leads usa
  `x-marketing-token`.
- `SWAGGER_ENABLED=false` desactiva la documentación.
- Mantener `src/index.js` sin top-level await: el cargador Passenger/LiteSpeed
  requiere la entrada y no soporta módulos ESM con top-level await.

## Despliegue en cPanel / Passenger (producción)

- URL pública: `https://conexion.soyasesorias.co`
- Raíz de la app (código fuente): `/home/soyaseso/soyasesorias-api-app`
- Document root del dominio: `/home/soyaseso/conexion.soyasesorias.co`
  (solo contiene el `.htaccess` de Passenger; no subir código ahí)
- Node: `/home/soyaseso/nodevenv/soyasesorias-api-app/20/bin/node`
- Startup file: `src/index.js` — Passenger lo arranca; **nunca** correr
  `node src/index.js` manual como proceso de producción.
- Al desplegar: subir solo código fuente. No tocar `.env`, `storage/`,
  `uploads/` ni los `.htaccess` generados por CloudLinux.

### Síntoma: rutas nuevas responden `Cannot GET` en producción

Si el código en disco tiene la ruta pero el dominio responde `Cannot GET`
(404 de Express, no de LiteSpeed), el worker `lsnode` está corriendo una
versión vieja en memoria. **Comprobado oct-2026**: `cloudlinux-selector
stop`/`restart` pueden reportar `success` sin matar los workers.

Diagnóstico:

```bash
source /home/soyaseso/nodevenv/soyasesorias-api-app/20/bin/activate
cd /home/soyaseso/soyasesorias-api-app

# Comparar fecha de arranque de los workers vs fecha de los archivos
ps -ef | grep -i node | grep -v grep        # lsnode:... + fecha de inicio
stat -c '%y %n' src/app.js src/routes/<archivo-cambiado>.js
date
```

Si los procesos `lsnode` arrancaron antes del mtime de los archivos, son
workers zombies sirviendo código viejo. Solución:

```bash
kill <PID> [<PID>...]     # o kill -9 si no mueren
sleep 2
ps -ef | grep -i node | grep -v grep        # deben desaparecer
```

Passenger levanta un worker nuevo con el código actual en la próxima
petición. Verificación esperada sin autenticación:

```bash
curl -i https://conexion.soyasesorias.co/health                          # 200
curl -i https://conexion.soyasesorias.co/swagger.json                    # 200
curl -i https://conexion.soyasesorias.co/api/diagnosticos                # 401 (existe)
```

Otras causas si el 404 es de **LiteSpeed** (no de Express): falta o está
vacío `/home/soyaseso/conexion.soyasesorias.co/.htaccess` — crearlo con
`touch` y reintentar `cloudlinux-selector restart --json --interpreter
nodejs --app-root 'soyasesorias-api-app'`.

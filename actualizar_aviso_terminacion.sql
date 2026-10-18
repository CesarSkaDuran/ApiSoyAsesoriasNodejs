-- Cambios de esquema necesarios para avisos de terminación de contrato fijo.
-- Ejecutar con la base de datos SoyAsesorias seleccionada.
-- Idempotente: cada columna se agrega solo si todavía no existe.

SET @schema_actual = DATABASE();

SET @ddl_fecha_terminacion = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_actual
      AND TABLE_NAME = 'empleados'
      AND COLUMN_NAME = 'fecha_terminacion'
  ),
  'SELECT ''empleados.fecha_terminacion ya existe''',
  'ALTER TABLE `empleados` ADD COLUMN `fecha_terminacion` DATE NULL'
);
PREPARE stmt_fecha_terminacion FROM @ddl_fecha_terminacion;
EXECUTE stmt_fecha_terminacion;
DEALLOCATE PREPARE stmt_fecha_terminacion;

SET @ddl_aviso_terminacion = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema_actual
      AND TABLE_NAME = 'empleados'
      AND COLUMN_NAME = 'aviso_terminacion_at'
  ),
  'SELECT ''empleados.aviso_terminacion_at ya existe''',
  'ALTER TABLE `empleados` ADD COLUMN `aviso_terminacion_at` TIMESTAMP NULL'
);
PREPARE stmt_aviso_terminacion FROM @ddl_aviso_terminacion;
EXECUTE stmt_aviso_terminacion;
DEALLOCATE PREPARE stmt_aviso_terminacion;

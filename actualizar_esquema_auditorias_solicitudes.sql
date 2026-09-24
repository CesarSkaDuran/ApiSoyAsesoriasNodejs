SELECT DATABASE() AS base_de_datos_seleccionada;

SET @audit_schema = DATABASE();

SET @audit_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema
      AND TABLE_NAME = 'solicitudes'
      AND COLUMN_NAME = 'status'
      AND COLUMN_TYPE LIKE '%aprobada%'
      AND COLUMN_TYPE LIKE '%cancelada%'
  ),
  'SELECT 1',
  'ALTER TABLE `solicitudes` MODIFY `status` ENUM(''pendiente'',''aprobada'',''en_proceso'',''completada'',''rechazada'',''cancelada'') NOT NULL DEFAULT ''pendiente'''
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

CREATE TABLE IF NOT EXISTS `notificaciones` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `empresa_id` INT UNSIGNED NULL,
  `titulo` VARCHAR(200) NULL,
  `mensaje` TEXT NULL,
  `leida` TINYINT(1) NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `notificaciones_user_id_index` (`user_id`),
  KEY `notificaciones_empresa_id_index` (`empresa_id`),
  CONSTRAINT `fk_notificaciones_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notificaciones_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'notificaciones' AND COLUMN_NAME = 'tipo'
  ),
  'SELECT 1',
  'ALTER TABLE `notificaciones` ADD COLUMN `tipo` VARCHAR(50) NOT NULL DEFAULT ''general'''
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'notificaciones' AND COLUMN_NAME = 'solicitud_id'
  ),
  'SELECT 1',
  'ALTER TABLE `notificaciones` ADD COLUMN `solicitud_id` INT UNSIGNED NULL, ADD INDEX `idx_notificaciones_solicitud_id` (`solicitud_id`), ADD CONSTRAINT `fk_notificaciones_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes` (`id`) ON DELETE SET NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'notificaciones' AND COLUMN_NAME = 'url'
  ),
  'SELECT 1',
  'ALTER TABLE `notificaciones` ADD COLUMN `url` VARCHAR(500) NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'servicio_registros' AND COLUMN_NAME = 'solicitud_id'
  ),
  'SELECT 1',
  'ALTER TABLE `servicio_registros` ADD COLUMN `solicitud_id` INT UNSIGNED NULL, ADD UNIQUE KEY `uq_servicio_registros_solicitud_id` (`solicitud_id`), ADD CONSTRAINT `fk_servicio_registros_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes` (`id`) ON DELETE SET NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

CREATE TABLE IF NOT EXISTS `auditorias` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `actor_email` VARCHAR(180) NULL,
  `actor_role` VARCHAR(30) NULL,
  `accion` VARCHAR(40) NOT NULL,
  `recurso` VARCHAR(80) NOT NULL,
  `recurso_id` VARCHAR(80) NULL,
  `metodo` VARCHAR(10) NOT NULL,
  `ruta` VARCHAR(255) NOT NULL,
  `codigo_respuesta` INT UNSIGNED NOT NULL,
  `ip` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `campos` JSON NULL,
  `detalle` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `auditorias_user_id_index` (`user_id`),
  KEY `idx_auditorias_created_at` (`created_at`),
  KEY `idx_auditorias_recurso_created_at` (`recurso`, `created_at`),
  CONSTRAINT `fk_auditorias_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════════════════════
-- Cambios 1.0: tipos de documento configurables + fecha de entrega
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `documento_tipos` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(150) NOT NULL,
  `descripcion` VARCHAR(500) NULL,
  `orden` INT NULL DEFAULT 1,
  `activo` TINYINT(1) NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed inicial solo si el catalogo esta vacio
INSERT INTO `documento_tipos` (`nombre`, `orden`)
SELECT * FROM (
  SELECT 'Contratos' AS nombre, 1 AS orden
  UNION ALL SELECT 'Reglamento interno', 2
  UNION ALL SELECT 'Manual de funciones', 3
  UNION ALL SELECT 'Quejas o reclamaciones', 4
  UNION ALL SELECT 'Horarios laborales', 5
) seed
WHERE NOT EXISTS (SELECT 1 FROM `documento_tipos`);

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'tipo_id'
  ),
  'SELECT 1',
  'ALTER TABLE `documentos` ADD COLUMN `tipo_id` INT UNSIGNED NULL, ADD INDEX `idx_documentos_tipo_id` (`tipo_id`), ADD CONSTRAINT `fk_documentos_tipo` FOREIGN KEY (`tipo_id`) REFERENCES `documento_tipos` (`id`) ON DELETE SET NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE `documentos` ADD COLUMN `version` VARCHAR(30) NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'fecha_emision'
  ),
  'SELECT 1',
  'ALTER TABLE `documentos` ADD COLUMN `fecha_emision` DATE NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'estatus'
  ),
  'SELECT 1',
  'ALTER TABLE `documentos` ADD COLUMN `estatus` ENUM(''recibido'',''en_revision'',''rechazado'') NOT NULL DEFAULT ''recibido'''
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'solicitudes' AND COLUMN_NAME = 'fecha_entrega'
  ),
  'SELECT 1',
  'ALTER TABLE `solicitudes` ADD COLUMN `fecha_entrega` DATE NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'solicitudes' AND COLUMN_NAME = 'observaciones'
  ),
  'SELECT 1',
  'ALTER TABLE `solicitudes` ADD COLUMN `observaciones` TEXT NULL'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

-- Permiso del modulo diagnosticos en user_modulos
SET @audit_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @audit_schema AND TABLE_NAME = 'user_modulos' AND COLUMN_NAME = 'diagnosticos'
  ),
  'SELECT 1',
  'ALTER TABLE `user_modulos` ADD COLUMN `diagnosticos` TINYINT(1) NULL DEFAULT 0'
);
PREPARE audit_stmt FROM @audit_sql;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

-- Tablas para guardar conversaciones privadas del Asistente IA.
-- Ejecutar con la base de datos de SoyAsesorias seleccionada.
-- No borra ni modifica usuarios, mensajes existentes ni otras tablas.

CREATE TABLE IF NOT EXISTS `ia_chat_sesiones` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `titulo` VARCHAR(160) NOT NULL DEFAULT 'Nueva conversación',
  `contexto` VARCHAR(40) NOT NULL DEFAULT 'general',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ia_chat_sesiones_user_id_index` (`user_id`),
  KEY `ia_chat_sesiones_user_updated_idx` (`user_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ia_chat_mensajes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sesion_id` INT UNSIGNED NOT NULL,
  `rol` VARCHAR(12) NOT NULL,
  `contenido` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ia_chat_mensajes_sesion_id_index` (`sesion_id`),
  KEY `ia_chat_mensajes_sesion_id_idx` (`sesion_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT COUNT(*) AS conversaciones FROM `ia_chat_sesiones`;
SELECT COUNT(*) AS mensajes FROM `ia_chat_mensajes`;

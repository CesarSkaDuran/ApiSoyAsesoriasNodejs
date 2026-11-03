import json
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).parent / 'data' / 'gestor-documental-catalogo.json'
TARGET = API_ROOT / 'actualizar_gestor_documental_produccion.sql'


def quote(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def add_column(lines, table, column, definition):
    lines.extend([
        f"SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='{table}' AND COLUMN_NAME='{column}')=0, 'ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}', 'SELECT 1');",
        "PREPARE gestor_ddl FROM @sql; EXECUTE gestor_ddl; DEALLOCATE PREPARE gestor_ddl;",
    ])


def add_index(lines, table, index, columns):
    lines.extend([
        f"SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='{table}' AND INDEX_NAME='{index}')=0, 'CREATE INDEX `{index}` ON `{table}` ({columns})', 'SELECT 1');",
        "PREPARE gestor_ddl FROM @sql; EXECUTE gestor_ddl; DEALLOCATE PREPARE gestor_ddl;",
    ])


def main():
    catalog = json.loads(SOURCE.read_text(encoding='utf-8'))
    lines = [
        "-- Actualizacion aditiva para Gestor Documental SoyAsesorias.",
        "-- Selecciona primero la base de datos de produccion.",
        "-- No elimina ni modifica documentos, usuarios, empresas ni solicitudes existentes.",
        "-- Los cambios de esquema y los datos del catalogo son idempotentes.",
        "SET NAMES utf8mb4;",
        "SET @schema_name = DATABASE();",
        "",
        "-- Permiso por usuario y perfil de acceso especializado.",
    ]
    add_column(lines, 'user_modulos', 'gestor_documental', 'TINYINT(1) NOT NULL DEFAULT 0')
    add_column(lines, 'users', 'perfil_acceso', 'VARCHAR(30) NULL')
    lines.extend([
        "CREATE TABLE IF NOT EXISTS `user_modulo_permisos` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `user_id` INT UNSIGNED NOT NULL,",
        "  `modulo` VARCHAR(80) NOT NULL,",
        "  `habilitado` TINYINT(1) NOT NULL DEFAULT 0,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  UNIQUE KEY `user_modulo_permisos_user_modulo_unique` (`user_id`, `modulo`),",
        "  KEY `user_modulo_permisos_user_id_index` (`user_id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
        "-- Usuarios secundarios de empresa; no reemplaza empresas.user_id.",
        "CREATE TABLE IF NOT EXISTS `empresa_usuarios` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `empresa_id` INT UNSIGNED NOT NULL,",
        "  `user_id` INT UNSIGNED NOT NULL,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  UNIQUE KEY `empresa_usuarios_user_id_unique` (`user_id`),",
        "  UNIQUE KEY `empresa_usuarios_empresa_user_unique` (`empresa_id`, `user_id`),",
        "  KEY `empresa_usuarios_empresa_id_index` (`empresa_id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
        "-- Carpetas del gestor anterior y metadatos en documentos.",
        "CREATE TABLE IF NOT EXISTS `gestor_documental_carpetas` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `empresa_id` INT UNSIGNED NOT NULL,",
        "  `parent_id` INT UNSIGNED NULL,",
        "  `nombre` VARCHAR(120) NOT NULL,",
        "  `created_by` INT UNSIGNED NULL,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  KEY `gestor_documental_carpetas_empresa_id_index` (`empresa_id`),",
        "  KEY `gestor_documental_carpetas_parent_id_index` (`parent_id`),",
        "  KEY `gestor_documental_carpetas_created_by_foreign` (`created_by`),",
        "  KEY `gdc_empresa_parent_idx` (`empresa_id`, `parent_id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
    ])
    add_column(lines, 'documentos', 'gestor_carpeta_id', 'INT UNSIGNED NULL')
    add_index(lines, 'documentos', 'documentos_gestor_carpeta_id_index', '`gestor_carpeta_id`')
    add_column(lines, 'documentos', 'es_gestor_documental', 'TINYINT(1) NOT NULL DEFAULT 0')
    add_index(lines, 'documentos', 'documentos_es_gestor_documental_index', '`es_gestor_documental`')
    lines.extend([
        "",
        "-- Categorias y subcategorias importadas del Excel.",
        "CREATE TABLE IF NOT EXISTS `gestor_documental_categorias` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `codigo` VARCHAR(180) NOT NULL,",
        "  `numero` VARCHAR(20) NULL,",
        "  `parent_id` INT UNSIGNED NULL,",
        "  `nombre` VARCHAR(255) NOT NULL,",
        "  `orden` INT NOT NULL DEFAULT 0,",
        "  `activo` TINYINT(1) NOT NULL DEFAULT 1,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  UNIQUE KEY `gestor_documental_categorias_codigo_unique` (`codigo`),",
        "  KEY `gestor_documental_categorias_parent_id_index` (`parent_id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
        "-- Catalogo de modelos generales y borradores del administrador.",
        "CREATE TABLE IF NOT EXISTS `gestor_documental_catalogo` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `source_code` VARCHAR(40) NOT NULL,",
        "  `categoria_id` INT UNSIGNED NOT NULL,",
        "  `nombre` VARCHAR(255) NOT NULL,",
        "  `orden` INT NOT NULL DEFAULT 0,",
        "  `activo` TINYINT(1) NOT NULL DEFAULT 1,",
        "  `borrador_path` VARCHAR(500) NULL,",
        "  `borrador_nombre` VARCHAR(255) NULL,",
        "  `borrador_mime` VARCHAR(100) NULL,",
        "  `borrador_size` INT UNSIGNED NULL,",
        "  `borrador_publicado` TINYINT(1) NOT NULL DEFAULT 0,",
        "  `actualizado_por` INT UNSIGNED NULL,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  UNIQUE KEY `gestor_documental_catalogo_source_code_unique` (`source_code`),",
        "  KEY `gestor_documental_catalogo_categoria_id_index` (`categoria_id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
        "-- Archivos finales cargados por cada empresa.",
        "CREATE TABLE IF NOT EXISTS `gestor_documental_archivos` (",
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "  `empresa_id` INT UNSIGNED NOT NULL,",
        "  `catalogo_id` INT UNSIGNED NOT NULL,",
        "  `uploaded_by` INT UNSIGNED NULL,",
        "  `nombre` VARCHAR(255) NOT NULL,",
        "  `path` VARCHAR(500) NOT NULL,",
        "  `mime` VARCHAR(100) NULL,",
        "  `size` INT UNSIGNED NULL,",
        "  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "  PRIMARY KEY (`id`),",
        "  KEY `gestor_documental_archivos_empresa_id_index` (`empresa_id`),",
        "  KEY `gestor_documental_archivos_catalogo_id_index` (`catalogo_id`),",
        "  KEY `gda_empresa_catalogo_id_idx` (`empresa_id`, `catalogo_id`, `id`)",
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
        "",
        "-- Relacion de solicitudes del modulo.",
    ])
    for column in ('gestor_categoria_id', 'gestor_catalogo_id', 'solicitado_por'):
        add_column(lines, 'solicitudes', column, 'INT UNSIGNED NULL')
    add_index(lines, 'solicitudes', 'solicitudes_gestor_categoria_id_index', '`gestor_categoria_id`')
    add_index(lines, 'solicitudes', 'solicitudes_gestor_catalogo_id_index', '`gestor_catalogo_id`')
    add_index(lines, 'solicitudes', 'solicitudes_solicitado_por_index', '`solicitado_por`')
    lines.extend(["", "-- Inserta categorias que falten sin sobrescribir cambios del administrador."])

    for category in catalog['categories']:
        parent_id = 'NULL'
        if category['parent_code']:
            parent_id = (
                "(SELECT `id` FROM `gestor_documental_categorias` "
                f"WHERE `codigo`={quote(category['parent_code'])} LIMIT 1)"
            )
        code = quote(category['code'])
        lines.append(
            "INSERT INTO `gestor_documental_categorias` "
            "(`codigo`,`numero`,`parent_id`,`nombre`,`orden`,`activo`,`created_at`,`updated_at`) "
            f"SELECT {code},{quote(category['number'])},{parent_id},{quote(category['name'])},"
            f"{int(category['sort_order'])},1,NOW(),NOW() "
            f"WHERE NOT EXISTS (SELECT 1 FROM `gestor_documental_categorias` WHERE `codigo`={code});"
        )
        for order, document in enumerate(category['documents'], 1):
            source_code = quote(document['source_code'])
            lines.append(
                "INSERT INTO `gestor_documental_catalogo` "
                "(`source_code`,`categoria_id`,`nombre`,`orden`,`activo`,`created_at`,`updated_at`) "
                f"SELECT {source_code},(SELECT `id` FROM `gestor_documental_categorias` "
                f"WHERE `codigo`={code} LIMIT 1),{quote(document['name'])},{order},1,NOW(),NOW() "
                f"WHERE NOT EXISTS (SELECT 1 FROM `gestor_documental_catalogo` WHERE `source_code`={source_code});"
            )

    lines.extend([
        "",
        "-- Normaliza dos subcategorias que el Excel numeraba ambas como 5.5.",
        "UPDATE `gestor_documental_categorias` SET `numero`='5.6' WHERE `codigo`='5.5-gestion-de-turno-y-horarios-laborales' AND `numero`='5.5';",
        "UPDATE `gestor_documental_categorias` SET `numero`='5.7' WHERE `codigo`='5.5-gestion-documental-del-proceso' AND `numero`='5.5';",
        "",
        "-- Verificacion: 24 categorias/subcategorias y 250 documentos base.",
        "SELECT COUNT(*) AS categorias_y_subcategorias FROM `gestor_documental_categorias`;",
        "SELECT COUNT(*) AS documentos_catalogo FROM `gestor_documental_catalogo`;",
        "SELECT `numero`,`nombre` FROM `gestor_documental_categorias` "
        "WHERE `parent_id`=(SELECT `id` FROM `gestor_documental_categorias` WHERE `codigo`='5' LIMIT 1) "
        "ORDER BY `orden`;",
    ])
    TARGET.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Generado {TARGET} ({len(lines)} lineas, 24 categorias, 250 documentos)')


if __name__ == '__main__':
    main()

-- ============================================================
-- MIGRACION: Integracion GLS + comparativa de costes
-- Fecha: 2026-03-30
-- ============================================================

CREATE TABLE IF NOT EXISTS `gls_shipping_config` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `api_user` VARCHAR(100) NOT NULL DEFAULT '',
  `api_password` VARCHAR(150) NOT NULL DEFAULT '',
  `api_env` ENUM('test','production') NOT NULL DEFAULT 'test',
  `api_base_url` VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT 'Override opcional del host real de la API GLS si difiere del entorno por defecto',
  `origin_postcode` VARCHAR(10) NOT NULL DEFAULT '',
  `origin_country` CHAR(2) NOT NULL DEFAULT 'ES',
  `price_multiplier` DECIMAL(5,4) NOT NULL DEFAULT 1.0000
    COMMENT 'Multiplicador sobre precio GLS. 0.85 = 15 por ciento de descuento',
  `default_weight_per_carro_kg` DECIMAL(8,2) NOT NULL DEFAULT 5.00,
  `default_weight_per_caja_kg` DECIMAL(8,2) NOT NULL DEFAULT 2.50,
  `default_service` VARCHAR(50) NOT NULL DEFAULT 'BusinessParcel',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `gls_shipping_config` (`id`) VALUES (1);

CREATE TABLE IF NOT EXISTS `gls_rate_cache` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cache_key` VARCHAR(64) NOT NULL,
  `dest_postcode` VARCHAR(10) NOT NULL,
  `dest_country` CHAR(2) NOT NULL DEFAULT 'ES',
  `weight_kg` DECIMAL(10,2) NOT NULL,
  `num_parcels` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `service_code` VARCHAR(50) NOT NULL DEFAULT 'BusinessParcel',
  `gls_price_raw` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
  `api_response_json` LONGTEXT NULL,
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gls_rate_cache_key` (`cache_key`),
  KEY `idx_gls_rate_cache_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `client_cost_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `hoja_ruta_id` INT UNSIGNED NULL,
  `route_plan_id` INT UNSIGNED NULL,
  `fecha` DATE NOT NULL,
  `carros` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `cajas` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `weight_kg` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `num_parcels` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `detour_km` DECIMAL(10,3) NOT NULL DEFAULT 0,
  `vehicle_cost_per_km` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_own_route` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_gls_raw` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_gls_adjusted` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `price_multiplier_used` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `recommendation` ENUM('own_route','externalize','break_even','unavailable') NOT NULL DEFAULT 'unavailable',
  `savings_if_externalized` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `gls_service` VARCHAR(50) NOT NULL DEFAULT '',
  `notes` VARCHAR(255) NOT NULL DEFAULT '',
  `calculated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_hoja_fecha` (`client_id`, `hoja_ruta_id`, `fecha`),
  KEY `idx_client_cost_history_client_fecha` (`client_id`, `fecha`),
  KEY `idx_client_cost_history_fecha` (`fecha`),
  CONSTRAINT `fk_client_cost_history_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'clients'
        AND COLUMN_NAME = 'postcode'
    ),
    'SELECT 1',
    'ALTER TABLE `clients` ADD COLUMN `postcode` VARCHAR(10) NOT NULL DEFAULT '''' COMMENT ''Codigo postal para integracion GLS'' AFTER `address`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'detour_km'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `detour_km` DECIMAL(10,3) NULL AFTER `orden_descarga`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'cost_own_route'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `cost_own_route` DECIMAL(10,4) NULL AFTER `detour_km`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'cost_gls_raw'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `cost_gls_raw` DECIMAL(10,4) NULL AFTER `cost_own_route`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'cost_gls_adjusted'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `cost_gls_adjusted` DECIMAL(10,4) NULL AFTER `cost_gls_raw`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'gls_recommendation'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `gls_recommendation` ENUM(''own_route'',''externalize'',''break_even'',''unavailable'') NULL AFTER `cost_gls_adjusted`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'gls_service'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `gls_service` VARCHAR(50) NULL AFTER `gls_recommendation`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hoja_ruta_lineas'
        AND COLUMN_NAME = 'gls_notes'
    ),
    'SELECT 1',
    'ALTER TABLE `hoja_ruta_lineas` ADD COLUMN `gls_notes` VARCHAR(255) NULL AFTER `gls_service`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

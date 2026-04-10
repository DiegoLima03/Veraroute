-- MIGRACION: soporte de contrato GLS 2026 (servicios, pais, importacion y config extendida)

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gls_shipping_config'
        AND COLUMN_NAME = 'gls_fuel_pct_current'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `gls_fuel_pct_current` DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER `price_multiplier`'
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
        AND TABLE_NAME = 'gls_shipping_config'
        AND COLUMN_NAME = 'remote_postcode_prefixes'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `remote_postcode_prefixes` TEXT NULL AFTER `gls_fuel_pct_current`'
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
        AND TABLE_NAME = 'carrier_zones'
        AND COLUMN_NAME = 'country_code'
    ),
    'SELECT 1',
    'ALTER TABLE `carrier_zones` ADD COLUMN `country_code` CHAR(2) NOT NULL DEFAULT ''ES'' AFTER `carrier_id`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

UPDATE `carrier_zones` SET `country_code` = 'ES' WHERE `country_code` IS NULL OR `country_code` = '';

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carrier_zones'
        AND INDEX_NAME = 'uq_carrier_zones_prefix'
    ),
    'ALTER TABLE `carrier_zones` DROP INDEX `uq_carrier_zones_prefix`, ADD UNIQUE KEY `uq_carrier_zones_country_prefix` (`carrier_id`, `country_code`, `cp_prefix`)',
    'SELECT 1'
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
        AND TABLE_NAME = 'carrier_rates'
        AND COLUMN_NAME = 'service_name'
    ),
    'SELECT 1',
    'ALTER TABLE `carrier_rates` ADD COLUMN `service_name` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `carrier_id`'
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
        AND TABLE_NAME = 'carrier_rates'
        AND COLUMN_NAME = 'rate_type'
    ),
    'SELECT 1',
    'ALTER TABLE `carrier_rates` ADD COLUMN `rate_type` VARCHAR(20) NOT NULL DEFAULT ''band'' AFTER `service_name`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carrier_rates'
        AND INDEX_NAME = 'uq_carrier_rates_service_band'
    ),
    'SELECT 1',
    'ALTER TABLE `carrier_rates` ADD UNIQUE KEY `uq_carrier_rates_service_band` (`carrier_id`, `service_name`, `rate_type`, `zona`, `peso_min`, `peso_max`, `vigencia_desde`)'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

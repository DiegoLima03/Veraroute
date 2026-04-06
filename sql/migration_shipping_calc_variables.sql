-- MIGRACION: variables de calculo para paqueteria por tablas

SET @stmt = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gls_shipping_config'
        AND COLUMN_NAME = 'default_parcels_per_carro'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `default_parcels_per_carro` DECIMAL(8,2) NOT NULL DEFAULT 1.00 AFTER `default_weight_per_caja_kg`'
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
        AND COLUMN_NAME = 'default_parcels_per_caja'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `default_parcels_per_caja` DECIMAL(8,2) NOT NULL DEFAULT 1.00 AFTER `default_parcels_per_carro`'
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
        AND COLUMN_NAME = 'default_volume_per_carro_cm3'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `default_volume_per_carro_cm3` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `default_parcels_per_caja`'
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
        AND COLUMN_NAME = 'default_volume_per_caja_cm3'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `default_volume_per_caja_cm3` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `default_volume_per_carro_cm3`'
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
        AND COLUMN_NAME = 'use_volumetric_weight'
    ),
    'SELECT 1',
    'ALTER TABLE `gls_shipping_config` ADD COLUMN `use_volumetric_weight` TINYINT(1) NOT NULL DEFAULT 0 AFTER `default_volume_per_caja_cm3`'
  )
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

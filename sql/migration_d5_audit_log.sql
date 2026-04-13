-- D5: Tabla audit_log para rastrear cambios en variables financieras
-- Fecha: 2026-04-13

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `username` VARCHAR(100) DEFAULT NULL,
  `action` VARCHAR(50) NOT NULL COMMENT 'update_shipping_config, update_fuel_pct, update_vehicle_cost, etc.',
  `entity` VARCHAR(50) DEFAULT NULL COMMENT 'gls_shipping_config, vehicles, carrier_rates, etc.',
  `entity_id` VARCHAR(50) DEFAULT NULL COMMENT 'ID del registro modificado',
  `old_value` JSON DEFAULT NULL,
  `new_value` JSON DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_entity` (`entity`, `entity_id`),
  KEY `idx_audit_date` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

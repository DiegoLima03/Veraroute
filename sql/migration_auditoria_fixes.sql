-- Auditoria 2026-04-13: FKs faltantes + indices + schema_migrations + purga
-- Ejecutar: mysql -h 127.0.0.1 -P 3308 -u root gestorrutas < sql/migration_auditoria_fixes.sql

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- MEDIA-1: Sistema de tracking de migraciones
-- =====================================================================
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename` VARCHAR(255) NOT NULL,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registrar todas las migraciones ya aplicadas
INSERT IGNORE INTO schema_migrations (filename) VALUES
  ('migration_fleet.sql'),
  ('migration_distance_cache.sql'),
  ('migration_rename_delegations.sql'),
  ('migration_client_schedules.sql'),
  ('migration_settings_templates.sql'),
  ('migration_orders_comercial.sql'),
  ('migration_auth.sql'),
  ('migration_fleet_vehicles.sql'),
  ('migration_hojas_ruta_vehicle.sql'),
  ('migration_hojas_ruta_remove_planificada.sql'),
  ('migration_hojas_ruta.sql'),
  ('migration_hojas_ruta_carros_cajas.sql'),
  ('migration_gls_costs.sql'),
  ('migration_shipping_rate_tables.sql'),
  ('migration_shipping_calc_variables.sql'),
  ('migration_client_rutas.sql'),
  ('migration_order_estado.sql'),
  ('migration_gls_contract_support.sql'),
  ('migration_client_comerciales.sql'),
  ('migration_rutas.sql'),
  ('migration_route_colors.sql'),
  ('migration_a3_vehicles_cost_per_km_default.sql'),
  ('migration_a3bis_vehicles_capacities_default.sql'),
  ('migration_a3ter_vehicles_capacities_remaining.sql'),
  ('migration_rename_clients_delegation_index.sql'),
  ('migration_b4_detour_km_nullable.sql'),
  ('migration_c7_cleanup_collations.sql'),
  ('migration_d5_audit_log.sql'),
  ('migration_auditoria_fixes.sql');

-- =====================================================================
-- MEDIA-2: FKs faltantes
-- =====================================================================

-- hojas_ruta.vehicle_id -> vehicles(id)
ALTER TABLE `hojas_ruta`
  ADD CONSTRAINT `fk_hojas_ruta_vehicle`
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- hojas_ruta.user_id -> app_users(id) (si la columna existe)
-- Solo si user_id existe como columna
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'gestorrutas' AND TABLE_NAME = 'hojas_ruta' AND COLUMN_NAME = 'user_id');
SET @sql = IF(@col_exists > 0,
  'ALTER TABLE `hojas_ruta` ADD CONSTRAINT `fk_hojas_ruta_user` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- client_cost_history.hoja_ruta_id -> hojas_ruta(id)
-- Primero alinear tipo: cch.hoja_ruta_id es INT UNSIGNED pero hojas_ruta.id es INT
ALTER TABLE `client_cost_history`
  MODIFY COLUMN `hoja_ruta_id` INT NULL DEFAULT NULL;
ALTER TABLE `client_cost_history`
  ADD CONSTRAINT `fk_cch_hoja_ruta`
  FOREIGN KEY (`hoja_ruta_id`) REFERENCES `hojas_ruta` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- MEDIA-3: Indices faltantes
-- =====================================================================

-- clients.active (filtro frecuente)
CREATE INDEX `idx_clients_active` ON `clients` (`active`);

-- hojas_ruta.fecha standalone (busquedas por fecha sin ruta)
CREATE INDEX `idx_hojas_ruta_fecha` ON `hojas_ruta` (`fecha`);

-- distance_cache.created_at (para limpieza por antiguedad)
CREATE INDEX `idx_distance_cache_created` ON `distance_cache` (`created_at`);

SET FOREIGN_KEY_CHECKS = 1;

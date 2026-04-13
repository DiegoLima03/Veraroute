-- =====================================================================
-- C7: Limpieza de BD — tablas muertas + colaciones unificadas
-- Fecha: 2026-04-13
-- =====================================================================
-- Este script:
--   1. Elimina tablas muertas (sin referencias en código PHP o vacías y obsoletas)
--   2. Unifica colaciones a utf8mb4_unicode_ci (el default de la BD)
-- =====================================================================

-- =====================================================================
-- PARTE 1: ELIMINAR TABLAS MUERTAS
-- =====================================================================

-- 1a. settings — reemplazada por app_settings, 0 rows, sin referencias en PHP
DROP TABLE IF EXISTS `settings`;

-- 1b. shipping_rate_tables — 0 rows, sin referencias en PHP, reemplazada por carriers/carrier_rates
DROP TABLE IF EXISTS `shipping_rate_tables`;

-- 1c. gls_rate_cache — 0 rows, sin referencias en PHP (cache de API GLS nunca implementada)
DROP TABLE IF EXISTS `gls_rate_cache`;


-- =====================================================================
-- PARTE 2: UNIFICAR COLACIONES A utf8mb4_unicode_ci
-- =====================================================================
-- El default de la BD es utf8mb4_unicode_ci.
-- 14 tablas usan utf8mb4_0900_ai_ci; las convertimos.
-- Las tablas con FKs se manejan desactivando checks temporalmente.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- --- app_settings ---
ALTER TABLE `app_settings`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- app_users ---
ALTER TABLE `app_users`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- client_cost_history ---
ALTER TABLE `client_cost_history`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- client_rutas ---
ALTER TABLE `client_rutas`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- client_schedules ---
ALTER TABLE `client_schedules`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- delegations ---
ALTER TABLE `delegations`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- distance_cache ---
ALTER TABLE `distance_cache`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- gls_shipping_config ---
ALTER TABLE `gls_shipping_config`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- hoja_ruta_lineas ---
ALTER TABLE `hoja_ruta_lineas`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- hojas_ruta ---
ALTER TABLE `hojas_ruta`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- products ---
ALTER TABLE `products`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- route_plans ---
ALTER TABLE `route_plans`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- route_stops ---
ALTER TABLE `route_stops`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- route_template_stops ---
ALTER TABLE `route_template_stops`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- route_templates ---
ALTER TABLE `route_templates`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- user_comerciales ---
ALTER TABLE `user_comerciales`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- vehicles ---
ALTER TABLE `vehicles`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- =====================================================================
-- VERIFICACION: tras ejecutar, comprobar con:
--   SELECT TABLE_NAME, TABLE_COLLATION
--   FROM information_schema.TABLES
--   WHERE TABLE_SCHEMA = 'gestorrutas'
--   ORDER BY TABLE_NAME;
-- Todas deben mostrar utf8mb4_unicode_ci.
-- =====================================================================

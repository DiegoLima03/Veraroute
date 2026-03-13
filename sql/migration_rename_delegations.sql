-- Renombrar depots -> delegations y depot_id -> delegation_id
-- Ejecutar despues de migration_fleet.sql

-- 1. Renombrar tabla
RENAME TABLE depots TO delegations;

-- 2. Renombrar columnas FK en vehicles
ALTER TABLE vehicles CHANGE depot_id delegation_id INT UNSIGNED NOT NULL;

-- 3. Renombrar columnas FK en clients
ALTER TABLE clients CHANGE depot_id delegation_id INT UNSIGNED DEFAULT NULL;

-- 4. Renombrar columnas FK en route_plans
ALTER TABLE route_plans CHANGE depot_id delegation_id INT UNSIGNED NOT NULL;

-- 5. Eliminar columna legacy is_depot de clients (las delegaciones ya tienen su propia tabla)
DELETE FROM clients WHERE is_depot = 1;
ALTER TABLE clients DROP COLUMN is_depot;

-- 6. Eliminar columna legacy avg_speed_kmh de vehicles (los tiempos vienen de OSRM)
ALTER TABLE vehicles DROP COLUMN avg_speed_kmh;

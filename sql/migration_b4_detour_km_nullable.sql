-- B4: Permitir detour_km = NULL en client_cost_history
-- para distinguir "no se pudo calcular" de "detour real = 0 km"
-- Fecha: 2026-04-13

ALTER TABLE `client_cost_history`
  MODIFY COLUMN `detour_km` DECIMAL(10,3) NULL DEFAULT NULL;

-- Limpiar los 0 falsos que venian de detourKm ?? 0 cuando realmente era NULL
-- Solo los que tienen notes indicando que faltaban coords
UPDATE `client_cost_history`
  SET `detour_km` = NULL
  WHERE `detour_km` = 0 AND `notes` IN ('missing_coords', 'vehicle_cost_missing');

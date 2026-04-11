-- ============================================================
-- A3-ter · Aplicar capacidades placeholder a los 112 vehiculos
--          restantes que tambien estaban a NULL en peso, volumen
--          e items.
--
-- Fecha: 2026-04-10
-- Motivo: hallazgo durante A3-bis. Los 14 vehiculos sin
--         cost_per_km no eran un caso aislado: la tabla
--         vehicles entera (126 filas) tenia las 3 columnas de
--         capacidad a NULL. Esta migracion extiende el mismo
--         placeholder a los 112 restantes para que TODA la
--         flota pueda ser usada por el optimizador.
--
-- Valores aplicados (mismos que A3-bis para coherencia):
--   max_weight_kg = 1500.00  (carga util furgoneta media)
--   max_volume_m3 =   12.00  (volumen interior tipico Sprinter L2H2)
--   max_items     =     150  (a 8 kg/carro -> 1500/8 ~ 187, redondeo conservador)
--
-- IMPORTANTE: estos valores son genericos. El usuario los
-- refinara cuando los vea por la UI segun el tipo real de cada
-- vehiculo.
--
-- Aplicada en BD: 2026-04-10 (112 filas actualizadas).
-- Estado final: 126/126 vehiculos con capacidades y cost_per_km.
-- ============================================================

UPDATE vehicles
   SET max_weight_kg = 1500.00,
       max_volume_m3 =   12.00,
       max_items     =     150
 WHERE max_weight_kg IS NULL
   AND max_volume_m3 IS NULL
   AND max_items     IS NULL;

-- ============================================================
-- A3-bis · Asignar capacidades placeholder a los 14 vehiculos
--          que tenian max_weight_kg / max_volume_m3 / max_items
--          a NULL.
--
-- Fecha: 2026-04-10
-- Motivo: complemento de A3 (cost_per_km). Sin capacidades, el
--         optimizador de hojas de ruta no puede asignarlos. Se
--         aplican valores PLACEHOLDER de furgoneta de reparto
--         media (Iveco Daily / Mercedes Sprinter), porque NO
--         habia ningun valor real en la tabla del que derivar
--         un estandar (los 126 vehiculos estaban a NULL).
--
-- Valores aplicados:
--   max_weight_kg = 1500.00  (carga util furgoneta media)
--   max_volume_m3 =   12.00  (volumen interior tipico Sprinter L2H2)
--   max_items     =     150  (a 8 kg/carro -> 1500/8 ~ 187, redondeo conservador)
--
-- IMPORTANTE: estos valores son genericos. El usuario los
-- refinara cuando los vea por la UI segun el tipo real de cada
-- vehiculo (camara grande, sonda, mini pala, etc.).
--
-- Aplicada en BD: 2026-04-10 (14 filas actualizadas).
-- ============================================================

UPDATE vehicles
   SET max_weight_kg = 1500.00,
       max_volume_m3 =   12.00,
       max_items     =     150
 WHERE id IN (57, 110, 112, 113, 114, 115, 116,
              117, 118, 119, 120, 121, 122, 128)
   AND max_weight_kg IS NULL
   AND max_volume_m3 IS NULL
   AND max_items     IS NULL;

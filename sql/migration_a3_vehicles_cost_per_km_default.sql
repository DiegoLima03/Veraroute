-- ============================================================
-- A3 · Asignar coste por km estandar a los 14 vehiculos que
--      tenian cost_per_km = 0.
--
-- Fecha: 2026-04-10
-- Motivo: 14 vehiculos de la flota carecian de tarifa por km, lo
--         que falseaba cualquier comparativa GLS o calculo de
--         coste de ruta. Se aplica el valor estandar dominante
--         de la propia tabla (0.55 EUR/km, que es el €/km del
--         64 % de la flota ya tarificada).
--
-- Capacidades (max_weight_kg / max_volume_m3 / max_items) NO se
-- tocan aqui: dependen del tipo concreto de vehiculo y se
-- gestionaran cuando se decida por categoria.
--
-- Aplicada en BD: 2026-04-10 (14 filas actualizadas).
-- ============================================================

UPDATE vehicles
   SET cost_per_km = 0.55
 WHERE id IN (57, 110, 112, 113, 114, 115, 116,
              117, 118, 119, 120, 121, 122, 128)
   AND cost_per_km = 0;

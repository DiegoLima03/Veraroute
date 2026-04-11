-- ============================================================
-- MIGRACION: Color persistente por ruta
-- Ejecutar una sola vez sobre instalaciones existentes.
-- ============================================================

ALTER TABLE rutas
    ADD COLUMN color CHAR(7) DEFAULT NULL AFTER name;

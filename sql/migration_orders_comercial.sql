-- ============================================================
-- MIGRACION: Anadir campos comercial a orders
-- ============================================================

ALTER TABLE orders
    ADD COLUMN comercial_id INT UNSIGNED NULL AFTER client_id,
    ADD COLUMN cc_aprox DECIMAL(5,2) NULL,
    ADD COLUMN observaciones TEXT NULL,
    ADD FOREIGN KEY (comercial_id) REFERENCES comerciales(id) ON DELETE SET NULL;

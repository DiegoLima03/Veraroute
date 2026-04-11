-- ============================================================
-- MIGRACION: comerciales por linea de producto en clients
-- ============================================================

ALTER TABLE clients
    ADD COLUMN comercial_planta_id INT UNSIGNED DEFAULT NULL AFTER comercial_id,
    ADD COLUMN comercial_flor_id INT UNSIGNED DEFAULT NULL AFTER comercial_planta_id,
    ADD COLUMN comercial_accesorio_id INT UNSIGNED DEFAULT NULL AFTER comercial_flor_id;

ALTER TABLE clients
    ADD INDEX ix_clients_comercial_planta (comercial_planta_id),
    ADD INDEX ix_clients_comercial_flor (comercial_flor_id),
    ADD INDEX ix_clients_comercial_accesorio (comercial_accesorio_id);

ALTER TABLE clients
    ADD CONSTRAINT fk_clients_comercial_planta FOREIGN KEY (comercial_planta_id) REFERENCES comerciales(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_clients_comercial_flor FOREIGN KEY (comercial_flor_id) REFERENCES comerciales(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_clients_comercial_accesorio FOREIGN KEY (comercial_accesorio_id) REFERENCES comerciales(id) ON DELETE SET NULL;

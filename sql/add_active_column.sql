USE gestorrutas;

ALTER TABLE clients ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER is_depot;

USE gestorrutas;

-- Añadir campo is_depot a clients
ALTER TABLE clients ADD COLUMN is_depot TINYINT(1) NOT NULL DEFAULT 0 AFTER notes;

-- Insertar la base como cliente
INSERT INTO clients (name, address, phone, notes, is_depot, x, y, open_time, close_time)
VALUES ('Base', 'Calle A Pedra, 3 - 36740', '', '', 1, 41.994524, -8.739887, '00:00', '23:59');

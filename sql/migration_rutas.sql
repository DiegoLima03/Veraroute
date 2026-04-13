-- Tabla de rutas comerciales
CREATE TABLE IF NOT EXISTS rutas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color CHAR(7) DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Columna ruta_id en clients
ALTER TABLE clients ADD COLUMN ruta_id INT DEFAULT NULL AFTER comercial_id;
ALTER TABLE clients ADD CONSTRAINT fk_clients_ruta FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE SET NULL;

-- Rutas iniciales
INSERT INTO rutas (name) VALUES
    ('Comarca A'),
    ('Comarca B'),
    ('Pontevedra 1'),
    ('Pontevedra 2'),
    ('Pontevedra 3'),
    ('Orense A'),
    ('Orense B'),
    ('Orense C');

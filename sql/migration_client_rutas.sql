-- ============================================================
-- MIGRACION: Relacion N:M clientes <-> rutas
-- ============================================================

CREATE TABLE IF NOT EXISTS client_rutas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT UNSIGNED NOT NULL,
    ruta_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE CASCADE,
    UNIQUE KEY uq_client_ruta (client_id, ruta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrar datos existentes de clients.ruta_id a client_rutas
INSERT IGNORE INTO client_rutas (client_id, ruta_id)
SELECT id, ruta_id FROM clients WHERE ruta_id IS NOT NULL;

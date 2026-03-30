-- ============================================================
-- MIGRACIÓN: Hojas de Ruta + Líneas
-- ============================================================

CREATE TABLE IF NOT EXISTS hojas_ruta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ruta_id INT NOT NULL                        COMMENT 'Ruta comercial (Comarca A, B, etc.)',
    user_id INT UNSIGNED NULL                   COMMENT 'Usuario que creó la hoja',
    fecha DATE NOT NULL                         COMMENT 'Fecha de la hoja',
    responsable VARCHAR(100)                    COMMENT 'Quién gestiona la hoja',
    estado ENUM('borrador','cerrada','planificada','en_reparto','completada') DEFAULT 'borrador',
    total_cc DECIMAL(8,2) DEFAULT 0,
    total_bn INT DEFAULT 0,
    total_litros DECIMAL(8,2) DEFAULT 0,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ruta_id) REFERENCES rutas(id),
    UNIQUE KEY unique_ruta_fecha (ruta_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hoja_ruta_lineas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hoja_ruta_id INT NOT NULL,
    order_id INT UNSIGNED NULL                  COMMENT 'Pedido asociado (tabla orders)',
    client_id INT UNSIGNED NOT NULL,
    comercial_id INT UNSIGNED NULL              COMMENT 'Comercial que tomó el pedido',
    zona VARCHAR(100),
    cc_aprox DECIMAL(5,2) DEFAULT 0,
    orden_descarga INT NULL                     COMMENT 'Orden de entrega (lo asigna logística)',
    observaciones TEXT,
    estado ENUM('pendiente','entregado','cancelado','no_entregado') DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hoja_ruta_id) REFERENCES hojas_ruta(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (comercial_id) REFERENCES comerciales(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

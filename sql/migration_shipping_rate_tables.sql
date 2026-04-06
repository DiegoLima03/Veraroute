-- MIGRACION: catalogo de paqueteria por transportista, zonas, tarifas y recargos

CREATE TABLE IF NOT EXISTS carriers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    divisor_vol INT NOT NULL DEFAULT 167,
    fuel_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_carriers_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carrier_zones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    carrier_id INT NOT NULL,
    cp_prefix VARCHAR(5) NOT NULL,
    zona INT NOT NULL,
    remoto TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_carrier_zones_carrier
        FOREIGN KEY (carrier_id) REFERENCES carriers(id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_carrier_zones_prefix (carrier_id, cp_prefix),
    KEY idx_cp (carrier_id, cp_prefix),
    KEY idx_zone (carrier_id, zona)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carrier_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    carrier_id INT NOT NULL,
    zona INT NOT NULL,
    peso_min DECIMAL(6,2) NOT NULL,
    peso_max DECIMAL(6,2) NOT NULL,
    precio_base DECIMAL(8,2) NOT NULL,
    vigencia_desde DATE NOT NULL,
    vigencia_hasta DATE NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_carrier_rates_carrier
        FOREIGN KEY (carrier_id) REFERENCES carriers(id)
        ON DELETE CASCADE,
    KEY idx_lookup (carrier_id, zona, peso_min, peso_max),
    KEY idx_vigencia (carrier_id, vigencia_desde, vigencia_hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carrier_surcharges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    carrier_id INT NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    importe DECIMAL(8,2) NULL DEFAULT NULL,
    porcentaje DECIMAL(5,2) NULL DEFAULT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_carrier_surcharges_carrier
        FOREIGN KEY (carrier_id) REFERENCES carriers(id)
        ON DELETE CASCADE,
    KEY idx_carrier_surcharge (carrier_id, tipo, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

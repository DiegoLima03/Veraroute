-- ============================================================
-- MIGRACION: Settings globales + Route templates
-- ============================================================

USE gestorrutas;

-- 1. TABLA SETTINGS (clave-valor para configuracion global)
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key   VARCHAR(50) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    description   VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Valores por defecto
INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
('lunch_duration_min', '60', 'Duracion del almuerzo en minutos'),
('lunch_earliest', '12:00', 'Hora minima para empezar almuerzo'),
('lunch_latest', '15:30', 'Hora maxima para empezar almuerzo'),
('base_unload_min', '5', 'Tiempo base de descarga por parada (parking, saludo, papeles)'),
('default_speed_kmh', '50', 'Velocidad media por defecto para fallback Haversine');

-- 2. TABLA ROUTE_TEMPLATES (plantillas de ruta recurrentes)
CREATE TABLE IF NOT EXISTS route_templates (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    day_of_week TINYINT DEFAULT NULL COMMENT '0=Lun..6=Dom, NULL=cualquier dia',
    vehicle_id  INT UNSIGNED DEFAULT NULL,
    delegation_id INT UNSIGNED DEFAULT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
    FOREIGN KEY (delegation_id) REFERENCES delegations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. TABLA ROUTE_TEMPLATE_STOPS (paradas de cada plantilla)
CREATE TABLE IF NOT EXISTS route_template_stops (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    template_id     INT UNSIGNED NOT NULL,
    stop_order      INT UNSIGNED NOT NULL,
    client_id       INT UNSIGNED NOT NULL,
    FOREIGN KEY (template_id) REFERENCES route_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Migracion settings + templates completada' AS resultado;

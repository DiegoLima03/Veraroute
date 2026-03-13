-- ============================================================
-- MIGRACION: Sistema de Flotas Multi-Deposito Multi-Vehiculo
-- Ejecutar en MySQL Workbench sobre la BD gestorrutas
-- ============================================================

USE gestorrutas;
SET SQL_SAFE_UPDATES = 0;

-- 1. TABLA DEPOTS (bases/almacenes)
CREATE TABLE IF NOT EXISTS depots (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    address     VARCHAR(255) DEFAULT '',
    phone       VARCHAR(30)  DEFAULT '',
    notes       TEXT,
    x           DECIMAL(9,6) NOT NULL,
    y           DECIMAL(9,6) NOT NULL,
    open_time   TIME NOT NULL DEFAULT '06:00:00',
    close_time  TIME NOT NULL DEFAULT '22:00:00',
    active      TINYINT(1) NOT NULL DEFAULT 1,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrar el deposito actual de clients a depots
INSERT INTO depots (name, address, x, y, open_time, close_time)
SELECT name, address, x, y,
       COALESCE(open_time, '06:00:00'),
       COALESCE(close_time, '22:00:00')
FROM clients WHERE is_depot = 1
LIMIT 1;

-- 2. TABLA VEHICLES (camiones/furgonetas)
CREATE TABLE IF NOT EXISTS vehicles (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    plate           VARCHAR(20) DEFAULT '',
    depot_id        INT UNSIGNED NOT NULL,
    max_weight_kg   DECIMAL(10,2) DEFAULT NULL,
    max_volume_m3   DECIMAL(10,2) DEFAULT NULL,
    max_items       INT UNSIGNED DEFAULT NULL,
    avg_speed_kmh   DECIMAL(5,1) NOT NULL DEFAULT 50,
    cost_per_km     DECIMAL(6,2) DEFAULT 0,
    active          TINYINT(1) NOT NULL DEFAULT 1,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (depot_id) REFERENCES depots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insertar vehiculo por defecto
INSERT INTO vehicles (name, plate, depot_id, avg_speed_kmh)
SELECT 'Vehiculo 1', '', id, 50 FROM depots LIMIT 1;

-- 3. TABLA PRODUCTS (catalogo para tiempos de descarga)
CREATE TABLE IF NOT EXISTS products (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    weight_kg       DECIMAL(8,3) DEFAULT 0,
    volume_m3       DECIMAL(8,4) DEFAULT 0,
    unload_time_min DECIMAL(5,1) NOT NULL DEFAULT 1,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. AMPLIAR ORDER_ITEMS con producto, peso, volumen, tiempo descarga
ALTER TABLE order_items
    ADD COLUMN product_id INT UNSIGNED DEFAULT NULL AFTER order_id,
    ADD COLUMN weight_kg DECIMAL(8,3) DEFAULT NULL,
    ADD COLUMN volume_m3 DECIMAL(8,4) DEFAULT NULL,
    ADD COLUMN unload_time_min DECIMAL(5,1) DEFAULT NULL;

ALTER TABLE order_items
    ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 5. ASIGNAR CLIENTES A DEPOSITOS
ALTER TABLE clients
    ADD COLUMN depot_id INT UNSIGNED DEFAULT NULL AFTER comercial_id;

ALTER TABLE clients
    ADD FOREIGN KEY (depot_id) REFERENCES depots(id) ON DELETE SET NULL;

-- Asignar todos los clientes existentes al primer deposito
UPDATE clients SET depot_id = (SELECT id FROM depots LIMIT 1) WHERE is_depot = 0;

-- 6. TABLA ROUTE_PLANS (planes de ruta guardados)
CREATE TABLE IF NOT EXISTS route_plans (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_date           DATE NOT NULL,
    vehicle_id          INT UNSIGNED NOT NULL,
    depot_id            INT UNSIGNED NOT NULL,
    total_distance_km   DECIMAL(8,1) DEFAULT 0,
    total_time_h        DECIMAL(6,2) DEFAULT 0,
    total_unload_min    DECIMAL(8,1) DEFAULT 0,
    status              ENUM('draft','confirmed','in_progress','completed') DEFAULT 'draft',
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (depot_id) REFERENCES depots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. TABLA ROUTE_STOPS (paradas de cada ruta)
CREATE TABLE IF NOT EXISTS route_stops (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    route_plan_id           INT UNSIGNED NOT NULL,
    stop_order              INT UNSIGNED NOT NULL,
    client_id               INT UNSIGNED NOT NULL,
    order_id                INT UNSIGNED DEFAULT NULL,
    estimated_arrival       TIME DEFAULT NULL,
    estimated_unload_min    DECIMAL(5,1) DEFAULT 0,
    status                  ENUM('pending','arrived','completed','skipped') DEFAULT 'pending',
    FOREIGN KEY (route_plan_id) REFERENCES route_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Migracion completada correctamente' AS resultado;

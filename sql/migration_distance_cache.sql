-- Cache de distancias OSRM
-- Ejecutar despues de migration_fleet.sql

CREATE TABLE IF NOT EXISTS distance_cache (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    origin_lat  DECIMAL(8,5) NOT NULL,
    origin_lng  DECIMAL(8,5) NOT NULL,
    dest_lat    DECIMAL(8,5) NOT NULL,
    dest_lng    DECIMAL(8,5) NOT NULL,
    distance_km DOUBLE       NOT NULL,
    duration_s  DOUBLE       NOT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pair (origin_lat, origin_lng, dest_lat, dest_lng)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

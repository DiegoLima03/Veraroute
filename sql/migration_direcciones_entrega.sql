-- Migración: Direcciones de entrega múltiples por cliente
-- 2026-04-16

-- 1. Nueva tabla direcciones_entrega
CREATE TABLE IF NOT EXISTS direcciones_entrega (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_cliente      INT UNSIGNED NOT NULL,
    descripcion     VARCHAR(200) DEFAULT '' COMMENT 'Nombre libre: Almacen Vigo, Tienda centro...',
    direccion       VARCHAR(255) DEFAULT '',
    direccion_2     VARCHAR(255) DEFAULT '',
    codigo_postal   VARCHAR(10) DEFAULT '',
    localidad       VARCHAR(100) DEFAULT '',
    provincia       VARCHAR(100) DEFAULT '',
    pais            VARCHAR(50) DEFAULT 'ES',
    x               DECIMAL(9,6) NULL DEFAULT NULL COMMENT 'Latitud GPS',
    y               DECIMAL(9,6) NULL DEFAULT NULL COMMENT 'Longitud GPS',
    tipo_zona       ENUM('rural','villa','ciudad','poligono') NOT NULL DEFAULT 'villa',
    tipo_negocio    ENUM('almacen','tienda_especializada','tienda_centro','cooperativa') NOT NULL DEFAULT 'tienda_especializada',
    contacto        VARCHAR(150) DEFAULT '',
    telefono        VARCHAR(30) DEFAULT '',
    observaciones   TEXT,
    principal       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = direccion por defecto del cliente',
    activo          TINYINT(1) NOT NULL DEFAULT 1,
    codigo_erp      VARCHAR(50) DEFAULT NULL COMMENT 'Codigo DIR_M del ERP para trazabilidad',
    creado_el       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_el  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cliente) REFERENCES clientes(id) ON DELETE CASCADE,
    INDEX idx_dir_cliente (id_cliente),
    INDEX idx_dir_principal (id_cliente, principal),
    INDEX idx_dir_codigo_erp (codigo_erp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Columna nullable en pedidos (NULL = usar direccion principal del cliente)
ALTER TABLE pedidos
    ADD COLUMN id_direccion INT UNSIGNED NULL DEFAULT NULL AFTER id_cliente,
    ADD CONSTRAINT fk_pedido_direccion FOREIGN KEY (id_direccion)
        REFERENCES direcciones_entrega(id) ON DELETE SET NULL;

-- 3. Columna nullable en hoja_ruta_lineas (NULL = usar direccion principal del cliente)
ALTER TABLE hoja_ruta_lineas
    ADD COLUMN id_direccion INT UNSIGNED NULL DEFAULT NULL AFTER id_cliente,
    ADD CONSTRAINT fk_linea_direccion FOREIGN KEY (id_direccion)
        REFERENCES direcciones_entrega(id) ON DELETE SET NULL;

-- 4. Seed: crear una direccion_entrega "principal" para cada cliente que tenga direccion
--    Las coordenadas del cliente se copian a esta direccion
INSERT INTO direcciones_entrega
    (id_cliente, descripcion, direccion, codigo_postal, x, y, tipo_zona, tipo_negocio, principal)
SELECT
    id, 'Direccion fiscal', direccion, codigo_postal, x, y, tipo_zona, tipo_negocio, 1
FROM clientes
WHERE direccion IS NOT NULL AND direccion != '';

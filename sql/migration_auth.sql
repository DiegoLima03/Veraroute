-- ============================================================
-- MIGRACIÓN: Tabla de usuarios con roles
-- ============================================================
-- Roles:
--   comercial  → ve solo sus clientes, crea hojas de ruta propias
--   logistica  → recibe todas las hojas, las ordena y genera la definitiva
--   admin      → acceso total

CREATE TABLE IF NOT EXISTS app_users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    pass_hash     VARCHAR(255) NOT NULL,
    full_name     VARCHAR(100) DEFAULT '',
    role          ENUM('comercial','logistica','admin') NOT NULL DEFAULT 'comercial',
    comercial_id  INT UNSIGNED NULL     COMMENT 'Solo para rol comercial: enlaza con tabla comerciales',
    failed_logins INT          DEFAULT 0,
    locked        TINYINT(1)   DEFAULT 0,
    locked_at     DATETIME     NULL,
    last_login_at DATETIME     NULL,
    last_login_ip VARCHAR(45)  NULL,
    last_failed_login DATETIME NULL,
    active        TINYINT(1)   DEFAULT 1,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (comercial_id) REFERENCES comerciales(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Usuarios iniciales (contraseña por defecto: admin)
-- IMPORTANTE: cambiar contraseñas tras el primer acceso
INSERT IGNORE INTO app_users (username, pass_hash, full_name, role) VALUES
('admin',     '$2y$10$dCbX1Oy51UetEpHDwuFjcOFHm.7lOEhm.PDfxRk20Hyx89TVBh/ke', 'Administrador', 'admin'),
('logistica', '$2y$10$dCbX1Oy51UetEpHDwuFjcOFHm.7lOEhm.PDfxRk20Hyx89TVBh/ke', 'Logística',     'logistica');

-- Para crear un usuario comercial vinculado:
-- INSERT INTO app_users (username, pass_hash, full_name, role, comercial_id)
-- VALUES ('pedro', '$2y$...hash...', 'Pedro García', 'comercial', 1);

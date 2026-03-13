-- Horarios semanales por cliente (reemplaza open_time/close_time simples)
-- Permite multiples ventanas por dia (turno manana/tarde)
-- Ejecutar despues de migration_rename_delegations.sql

CREATE TABLE IF NOT EXISTS client_schedules (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    client_id   INT UNSIGNED NOT NULL,
    day_of_week TINYINT NOT NULL COMMENT '0=Lunes, 1=Martes, 2=Miercoles, 3=Jueves, 4=Viernes, 5=Sabado, 6=Domingo',
    open_time   TIME NOT NULL,
    close_time  TIME NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE KEY uq_client_day_open (client_id, day_of_week, open_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Los campos open_time/close_time/open_time_2/close_time_2 de clients se mantienen como fallback
-- Si un cliente tiene registros en client_schedules, se usan esos
-- Si no tiene, se usa open_time/close_time de la tabla clients

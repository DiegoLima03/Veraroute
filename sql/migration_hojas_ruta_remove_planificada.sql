ALTER TABLE hojas_ruta
    MODIFY COLUMN estado ENUM('borrador','cerrada','en_reparto','completada') DEFAULT 'borrador';

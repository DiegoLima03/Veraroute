-- Migration: Add estado field to orders table
-- States: pendiente (default), confirmado, anulado

ALTER TABLE orders
  ADD COLUMN estado ENUM('pendiente','confirmado','anulado') NOT NULL DEFAULT 'pendiente' AFTER observaciones;

-- Index for filtering by estado and date
ALTER TABLE orders ADD INDEX idx_orders_estado_date (order_date, estado);

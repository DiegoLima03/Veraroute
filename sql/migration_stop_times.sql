-- Migración: Modelado de tiempos de parada por zona, tipo de negocio y franja horaria
-- 2026-04-16

-- 1. Campos en clientes para clasificarlos
ALTER TABLE clientes
  ADD COLUMN tipo_zona ENUM('rural','villa','ciudad','poligono') NOT NULL DEFAULT 'villa' AFTER hora_cierre_2,
  ADD COLUMN tipo_negocio ENUM('almacen','tienda_especializada','tienda_centro','cooperativa') NOT NULL DEFAULT 'tienda_especializada' AFTER tipo_zona;

-- 2. Configuración de tiempos de parada (tabla configuracion, clave-valor)
INSERT INTO configuracion (clave, valor) VALUES
  -- Tiempo base por tipo de zona (minutos)
  ('parada_min_rural', '8'),
  ('parada_min_villa', '12'),
  ('parada_min_ciudad', '18'),
  ('parada_min_poligono', '6'),
  -- Tiempo extra por volumen de entrega (minutos)
  ('parada_extra_2_3_cajas', '2'),
  ('parada_extra_carros', '5'),
  -- Espera en tienda por tipo de negocio (minutos)
  ('espera_min_almacen', '0'),
  ('espera_min_tienda_especializada', '5'),
  ('espera_min_tienda_centro', '8'),
  ('espera_min_cooperativa', '3'),
  -- Multiplicador de espera por franja horaria
  ('espera_mult_apertura', '0.5'),
  ('espera_mult_normal', '1.0'),
  ('espera_mult_punta', '1.5'),
  -- Franjas horarias (formato HH:MM)
  ('franja_apertura_inicio', '09:00'),
  ('franja_apertura_fin', '10:00'),
  ('franja_normal_inicio', '10:00'),
  ('franja_normal_fin', '12:00'),
  ('franja_punta_inicio', '12:00'),
  ('franja_punta_fin', '13:30'),
  -- Tiempo extra por hora punta en ciudad (minutos)
  ('parada_extra_hora_punta_ciudad', '5')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

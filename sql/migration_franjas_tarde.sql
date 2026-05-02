-- L7: franjas vespertinas + multiplicadores de espera asociados.
-- 2026-05-02
-- Complementa migration_stop_times.sql que solo cubría 09:00–13:30.
-- Cubre tarde tranquila (13:30–17:00), tarde punta (17:00–19:30) y cierre (19:30–21:00).

INSERT INTO configuracion (clave, valor) VALUES
  -- Franjas vespertinas
  ('franja_tarde_tranquila_inicio', '13:30'),
  ('franja_tarde_tranquila_fin',    '17:00'),
  ('franja_tarde_punta_inicio',     '17:00'),
  ('franja_tarde_punta_fin',        '19:30'),
  ('franja_cierre_inicio',          '19:30'),
  ('franja_cierre_fin',             '21:00'),
  -- Multiplicadores de espera para las nuevas franjas
  ('espera_mult_tarde_tranquila', '0.8'),  -- tras la comida, comercio más calmado
  ('espera_mult_tarde_punta',     '1.3'),  -- pico de tarde (recogidas, cierre comercio)
  ('espera_mult_cierre',          '1.5')   -- cerca del cierre, atención más precipitada
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

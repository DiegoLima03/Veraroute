ALTER TABLE hojas_ruta
    ADD COLUMN total_carros DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER total_cc,
    ADD COLUMN total_cajas DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER total_carros;

ALTER TABLE hoja_ruta_lineas
    ADD COLUMN carros DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER zona,
    ADD COLUMN cajas DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER carros;

UPDATE hoja_ruta_lineas
SET cajas = cc_aprox
WHERE (carros IS NULL OR carros = 0)
  AND (cajas IS NULL OR cajas = 0)
  AND cc_aprox IS NOT NULL
  AND cc_aprox <> 0;

UPDATE hojas_ruta h
JOIN (
    SELECT hoja_ruta_id,
           COALESCE(SUM(carros), 0) AS total_carros,
           COALESCE(SUM(cajas), 0) AS total_cajas,
           COALESCE(SUM(cc_aprox), 0) AS total_cc
    FROM hoja_ruta_lineas
    GROUP BY hoja_ruta_id
) t ON t.hoja_ruta_id = h.id
SET h.total_cc = t.total_cc,
    h.total_carros = t.total_carros,
    h.total_cajas = t.total_cajas;

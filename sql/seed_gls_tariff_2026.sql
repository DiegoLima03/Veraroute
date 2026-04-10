-- ════════════════════════════════════════════════════════════════
-- SEED: Tarifas GLS / Via Galicia - Vigente hasta 31/12/2026
-- Origen: contrato "TARIFAS GLS" PDF
-- Servicios: Express 10:30, Express 14:00, Express 19:00, Business Parcel
-- ════════════════════════════════════════════════════════════════

-- Limpieza previa de GLS (en orden por FK)
DELETE FROM carrier_rates WHERE carrier_id IN (SELECT id FROM carriers WHERE nombre = 'GLS');
DELETE FROM carrier_zones WHERE carrier_id IN (SELECT id FROM carriers WHERE nombre = 'GLS');
DELETE FROM carrier_surcharges WHERE carrier_id IN (SELECT id FROM carriers WHERE nombre = 'GLS');
DELETE FROM carriers WHERE nombre = 'GLS';

-- ── CARRIER ────────────────────────────────────────────────
-- divisor_vol = 180 kg/m³ según PDF (equivalencia volumétrica)
-- fuel_pct = 0.00 inicial (se actualiza mensualmente desde gls_shipping_config.gls_fuel_pct_current)
INSERT INTO carriers (nombre, activo, divisor_vol, fuel_pct)
VALUES ('GLS', 1, 180, 0.00);

SET @gls_id = LAST_INSERT_ID();

-- ── ZONAS GEOGRAFICAS ──────────────────────────────────────
-- Origen: Pontevedra (36XXX) — Vía Galicia, Vigo
-- Zona 1 = Provincial (Pontevedra)
-- Zona 2 = Regional (resto de Galicia)
-- Zona 3 = Nacional (resto península + Ceuta/Melilla)
-- Zona 4 = Baleares Mayores (Mallorca)
-- Zona 5 = Baleares Menores (Menorca, Ibiza, Formentera)
-- Zona 6 = Canarias Mayores (Tenerife, Gran Canaria)
-- Zona 7 = Canarias Menores (La Palma, La Gomera, El Hierro, Fuerteventura, Lanzarote)
-- Zona 8 = Portugal Península

-- Provincial (Pontevedra)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '36', 1, 0);

-- Regional (Galicia)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '15', 2, 0),  -- A Coruña
(@gls_id, 'ES', '27', 2, 0),  -- Lugo
(@gls_id, 'ES', '32', 2, 0);  -- Ourense

-- Baleares Mayores (Mallorca: 07000-07699)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '070', 4, 1),
(@gls_id, 'ES', '071', 4, 1),
(@gls_id, 'ES', '072', 4, 1),
(@gls_id, 'ES', '073', 4, 1),
(@gls_id, 'ES', '074', 4, 1),
(@gls_id, 'ES', '075', 4, 1),
(@gls_id, 'ES', '076', 4, 1);

-- Baleares Menores (Menorca: 07700-07799, Ibiza/Formentera: 07800-07899)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '077', 5, 1),
(@gls_id, 'ES', '078', 5, 1);

-- Canarias Mayores (Las Palmas/Gran Canaria: 35000-35499, Tenerife: 38000-38699 excepto La Palma/Gomera/Hierro)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '350', 6, 1),
(@gls_id, 'ES', '351', 6, 1),
(@gls_id, 'ES', '352', 6, 1),
(@gls_id, 'ES', '353', 6, 1),
(@gls_id, 'ES', '354', 6, 1),
(@gls_id, 'ES', '380', 6, 1),
(@gls_id, 'ES', '381', 6, 1),
(@gls_id, 'ES', '382', 6, 1),
(@gls_id, 'ES', '383', 6, 1),
(@gls_id, 'ES', '384', 6, 1),
(@gls_id, 'ES', '385', 6, 1),
(@gls_id, 'ES', '386', 6, 1);

-- Canarias Menores (Lanzarote: 35500-35599, Fuerteventura: 35600-35699, La Palma: 38700-38799, La Gomera/El Hierro: 38800-38999)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '355', 7, 1),
(@gls_id, 'ES', '356', 7, 1),
(@gls_id, 'ES', '357', 7, 1),
(@gls_id, 'ES', '358', 7, 1),
(@gls_id, 'ES', '359', 7, 1),
(@gls_id, 'ES', '387', 7, 1),
(@gls_id, 'ES', '388', 7, 1),
(@gls_id, 'ES', '389', 7, 1);

-- Nacional (fallback para resto de península y Ceuta/Melilla)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'ES', '*', 3, 0);

-- Portugal Península (todos los CP portugueses)
INSERT INTO carrier_zones (carrier_id, country_code, cp_prefix, zona, remoto) VALUES
(@gls_id, 'PT', '*', 8, 0);

-- ── TARIFAS POR SERVICIO Y ZONA ────────────────────────────

-- ════════════════════════════════════════════════════
-- GLS Express 10:30 (sólo Provincial / Regional / Nacional)
-- ════════════════════════════════════════════════════
-- Zona 1 - Provincial
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 10:30', 'band', 1, 0.00, 1.00, 7.05, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 1, 1.01, 3.00, 8.45, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 1, 3.01, 5.00, 9.86, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 1, 5.01, 10.00, 11.27, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 1, 10.01, 15.00, 14.07, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'additional_kg', 1, 15.00, 9999.00, 0.70, '2026-01-01', '2026-12-31');

-- Zona 2 - Regional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 10:30', 'band', 2, 0.00, 1.00, 7.05, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 2, 1.01, 3.00, 8.45, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 2, 3.01, 5.00, 9.86, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 2, 5.01, 10.00, 11.27, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 2, 10.01, 15.00, 14.07, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'additional_kg', 2, 15.00, 9999.00, 0.70, '2026-01-01', '2026-12-31');

-- Zona 3 - Nacional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 10:30', 'band', 3, 0.00, 1.00, 11.27, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 3, 1.01, 3.00, 11.95, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 3, 3.01, 5.00, 13.36, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 3, 5.01, 10.00, 17.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'band', 3, 10.01, 15.00, 26.04, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 10:30', 'additional_kg', 3, 15.00, 9999.00, 0.85, '2026-01-01', '2026-12-31');

-- ════════════════════════════════════════════════════
-- GLS Express 14:00
-- ════════════════════════════════════════════════════
-- Zona 1 - Provincial
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 1, 0.00, 1.00, 5.46, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 1, 1.01, 3.00, 5.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 1, 3.01, 5.00, 5.74, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 1, 5.01, 10.00, 6.02, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 1, 10.01, 15.00, 6.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 1, 15.00, 9999.00, 0.36, '2026-01-01', '2026-12-31');

-- Zona 2 - Regional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 2, 0.00, 1.00, 5.46, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 2, 1.01, 3.00, 5.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 2, 3.01, 5.00, 5.74, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 2, 5.01, 10.00, 6.02, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 2, 10.01, 15.00, 6.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 2, 15.00, 9999.00, 0.36, '2026-01-01', '2026-12-31');

-- Zona 3 - Nacional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 3, 0.00, 1.00, 5.57, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 3, 1.01, 3.00, 5.87, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 3, 3.01, 5.00, 6.28, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 3, 5.01, 10.00, 6.94, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 3, 10.01, 15.00, 9.02, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 3, 15.00, 9999.00, 0.52, '2026-01-01', '2026-12-31');

-- Zona 4 - Baleares Mayores (sólo banda 1kg + adicional)
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 4, 0.00, 1.00, 13.53, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 4, 1.00, 9999.00, 3.57, '2026-01-01', '2026-12-31');

-- Zona 5 - Baleares Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 5, 0.00, 1.00, 20.67, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 5, 1.00, 9999.00, 5.89, '2026-01-01', '2026-12-31');

-- Zona 6 - Canarias Mayores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 6, 0.00, 1.00, 20.67, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 6, 1.00, 9999.00, 5.89, '2026-01-01', '2026-12-31');

-- Zona 7 - Canarias Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 7, 0.00, 1.00, 26.76, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 7, 1.00, 9999.00, 6.77, '2026-01-01', '2026-12-31');

-- Zona 8 - Portugal Península
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 14:00', 'band', 8, 0.00, 1.00, 6.13, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 8, 1.01, 3.00, 6.45, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 8, 5.01, 10.00, 7.64, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'band', 8, 10.01, 15.00, 9.92, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 14:00', 'additional_kg', 8, 15.00, 9999.00, 0.58, '2026-01-01', '2026-12-31');

-- ════════════════════════════════════════════════════
-- GLS Express 19:00
-- ════════════════════════════════════════════════════
-- Zona 1 - Provincial
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 1, 0.00, 1.00, 4.04, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 1, 1.01, 3.00, 4.25, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 1, 3.01, 5.00, 4.41, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 1, 5.01, 10.00, 4.84, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 1, 10.01, 15.00, 5.29, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 1, 15.00, 9999.00, 0.21, '2026-01-01', '2026-12-31');

-- Zona 2 - Regional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 2, 0.00, 1.00, 4.04, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 2, 1.01, 3.00, 4.25, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 2, 3.01, 5.00, 4.41, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 2, 5.01, 10.00, 4.84, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 2, 10.01, 15.00, 5.29, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 2, 15.00, 9999.00, 0.21, '2026-01-01', '2026-12-31');

-- Zona 3 - Nacional (con bandas 20-50kg)
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 3, 0.00, 1.00, 5.02, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 1.01, 3.00, 5.17, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 3.01, 5.00, 5.58, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 5.01, 10.00, 6.28, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 10.01, 15.00, 7.83, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 15.01, 20.00, 9.95, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 20.01, 25.00, 12.09, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 25.01, 30.00, 14.22, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 30.01, 40.00, 18.49, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 3, 40.01, 50.00, 22.75, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 3, 50.00, 9999.00, 0.42, '2026-01-01', '2026-12-31');

-- Zona 4 - Baleares Mayores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 4, 0.00, 1.00, 11.99, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 4, 1.00, 9999.00, 3.19, '2026-01-01', '2026-12-31');

-- Zona 5 - Baleares Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 5, 0.00, 1.00, 15.45, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 5, 1.00, 9999.00, 4.00, '2026-01-01', '2026-12-31');

-- Zona 6 - Canarias Mayores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 6, 0.00, 1.00, 18.52, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 6, 1.00, 9999.00, 6.38, '2026-01-01', '2026-12-31');

-- Zona 7 - Canarias Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 7, 0.00, 1.00, 23.62, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 7, 1.00, 9999.00, 6.77, '2026-01-01', '2026-12-31');

-- Zona 8 - Portugal Península
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Express 19:00', 'band', 8, 0.00, 1.00, 7.06, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 8, 1.01, 3.00, 7.23, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 8, 3.01, 5.00, 7.88, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 8, 5.01, 10.00, 8.94, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'band', 8, 10.01, 15.00, 11.06, '2026-01-01', '2026-12-31'),
(@gls_id, 'Express 19:00', 'additional_kg', 8, 15.00, 9999.00, 0.65, '2026-01-01', '2026-12-31');

-- ════════════════════════════════════════════════════
-- GLS Business Parcel
-- ════════════════════════════════════════════════════
-- Zona 1 - Provincial
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 1, 0.00, 1.00, 3.86, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 1, 1.01, 3.00, 4.08, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 1, 3.01, 5.00, 4.22, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 1, 5.01, 10.00, 4.64, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 1, 10.01, 15.00, 5.08, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 1, 15.00, 9999.00, 0.20, '2026-01-01', '2026-12-31');

-- Zona 2 - Regional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 2, 0.00, 1.00, 3.86, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 2, 1.01, 3.00, 4.08, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 2, 3.01, 5.00, 4.22, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 2, 5.01, 10.00, 4.64, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 2, 10.01, 15.00, 5.08, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 2, 15.00, 9999.00, 0.20, '2026-01-01', '2026-12-31');

-- Zona 3 - Nacional
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 3, 0.00, 1.00, 4.82, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 1.01, 3.00, 4.98, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 3.01, 5.00, 5.35, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 5.01, 10.00, 6.03, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 10.01, 15.00, 7.51, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 15.01, 20.00, 9.55, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 20.01, 25.00, 11.60, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 25.01, 30.00, 13.65, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 30.01, 40.00, 17.74, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 3, 40.01, 50.00, 21.83, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 3, 50.00, 9999.00, 0.41, '2026-01-01', '2026-12-31');

-- Zona 4 - Baleares Mayores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 4, 0.00, 1.00, 11.49, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 4, 1.00, 9999.00, 3.07, '2026-01-01', '2026-12-31');

-- Zona 5 - Baleares Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 5, 0.00, 1.00, 14.81, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 5, 1.00, 9999.00, 3.83, '2026-01-01', '2026-12-31');

-- Zona 6 - Canarias Mayores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 6, 0.00, 1.00, 17.86, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 6, 1.00, 9999.00, 6.12, '2026-01-01', '2026-12-31');

-- Zona 7 - Canarias Menores
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 7, 0.00, 1.00, 22.67, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 7, 1.00, 9999.00, 6.49, '2026-01-01', '2026-12-31');

-- Zona 8 - Portugal Península
INSERT INTO carrier_rates (carrier_id, service_name, rate_type, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta) VALUES
(@gls_id, 'Business Parcel', 'band', 8, 0.00, 1.00, 6.77, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 8, 1.01, 3.00, 6.93, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 8, 3.01, 5.00, 7.56, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 8, 5.01, 10.00, 8.58, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'band', 8, 10.01, 15.00, 10.62, '2026-01-01', '2026-12-31'),
(@gls_id, 'Business Parcel', 'additional_kg', 8, 15.00, 9999.00, 0.63, '2026-01-01', '2026-12-31');

-- ── RECARGOS / SUPLEMENTOS (Extra Cargo Nacional, p.10) ────
INSERT INTO carrier_surcharges (carrier_id, tipo, importe, porcentaje, activo) VALUES
(@gls_id, 'remoto', 0.00, 0.00, 1),                       -- Recargo zona remota (no aplicable, GLS no lo cobra explicito)
(@gls_id, 'sabado', 15.19, NULL, 0),                      -- Entrega en sabado (servicio compatible con 14:00)
(@gls_id, 'interciudades', 3.70, NULL, 0),                -- Cada 100 kg o fraccion
(@gls_id, 'reembolso', 5.00, 5.00, 0),                    -- 5% mín 5€
(@gls_id, 'tercer_intento', 3.93, NULL, 0),               -- 3er intento entrega (Parcel Shop)
(@gls_id, 'recogida_fallida', 3.11, NULL, 0),             -- Recogida fallida culpa cliente
(@gls_id, 'gestion', 17.00, NULL, 0),                     -- Servicios con gestion (15min espera + 0.56€/min)
(@gls_id, 'dac', 3.11, NULL, 0),                          -- Devolucion con acuse de recibo
(@gls_id, 'bajo_valor', 15.00, NULL, 0),                  -- Bajo valor (envios cargo en origen)
(@gls_id, 'seguro_superior', NULL, 8.00, 0),              -- 8% sobre valor del porte
(@gls_id, 'seguro_todo_riesgo', NULL, 1.50, 0),           -- 1-2% media 1.5%, prima min 23.42€
(@gls_id, 'bulto_irregular', 14.00, NULL, 0);             -- Suplemento por bulto irregular

-- ── CONFIGURACION GLS_SHIPPING_CONFIG ──────────────────────
-- Origen Vigo (36) y descuento negociado pendiente de definir
UPDATE gls_shipping_config SET
  origin_postcode = '36214',                              -- Vigo (Vía Galicia)
  origin_country = 'ES',
  price_multiplier = 1.0000,                              -- Sin descuento por defecto (ajustar segun negociado)
  gls_fuel_pct_current = 5.50,                            -- % combustible vigente (ajustar mensualmente)
  default_weight_per_carro_kg = 8.00,                     -- Peso medio carro
  default_weight_per_caja_kg = 3.00,                      -- Peso medio caja
  default_parcels_per_carro = 1.00,
  default_parcels_per_caja = 1.00,
  use_volumetric_weight = 0,                              -- Activar si se quiere considerar peso volumetrico (180kg/m³)
  default_service = 'Business Parcel'
WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM gls_shipping_config) AS t);

-- ════════════════════════════════════════════════════
-- VERIFICACION
-- ════════════════════════════════════════════════════
SELECT 'CARRIERS' AS tabla, COUNT(*) AS total FROM carriers WHERE nombre = 'GLS'
UNION ALL
SELECT 'ZONES', COUNT(*) FROM carrier_zones WHERE carrier_id = @gls_id
UNION ALL
SELECT 'RATES', COUNT(*) FROM carrier_rates WHERE carrier_id = @gls_id
UNION ALL
SELECT 'SURCHARGES', COUNT(*) FROM carrier_surcharges WHERE carrier_id = @gls_id;

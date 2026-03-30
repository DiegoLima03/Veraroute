-- Migration: Fleet Vehicles
-- Database: gestorrutas
-- Generated: 2026-03-30

USE gestorrutas;

SET SQL_SAFE_UPDATES = 0;

-- -----------------------------------------------------------
-- 1. Clean dependent data
-- -----------------------------------------------------------
DELETE FROM route_stops;
DELETE FROM route_plans;

-- -----------------------------------------------------------
-- 2. Clean vehicles table
-- -----------------------------------------------------------
DELETE FROM vehicles;

-- -----------------------------------------------------------
-- 3. Resolve Tomiño delegation
-- -----------------------------------------------------------
SET @tomino = (SELECT id FROM delegations WHERE name LIKE '%Tomi%' LIMIT 1);
SET @tomino = COALESCE(@tomino, (SELECT id FROM delegations LIMIT 1));

-- -----------------------------------------------------------
-- 4. Insert 126 vehicles (from veratrack.vehiculos dump)
--    alias → name, matricula → plate
-- -----------------------------------------------------------
INSERT INTO vehicles (name, plate, delegation_id) VALUES
    ('Scania R500 0148JFT', '0148JFT', @tomino),
    ('Nissan Atleon 0251DPZ', '0251DPZ', @tomino),
    ('RUTA 43', '0384MLH', @tomino),
    ('Juan Jose', '0403NDV', @tomino),
    ('MAN TGE 0586NKW', '0586NKW', @tomino),
    ('Vera Fruits 0668KVP', '0668KVP', @tomino),
    ('Iveco Eurocargo 0882LLX', '0882LLX', @tomino),
    ('BELAVISTA', '08TZ97', @tomino),
    ('Caimbra 11CM18', '11CM18', @tomino),
    ('GAIA 16', '11CM20', @tomino),
    ('GAIA 10', '11QZ48', @tomino),
    ('49', '11QZ49', @tomino),
    ('Iveco Daily 1339GVD', '1239GVD', @tomino),
    ('Belavista 12ZF97', '12ZF55', @tomino),
    ('Maria José Nuñez 1350MXX', '1350MXX', @tomino),
    ('RUTA 47', '1640MNG', @tomino),
    ('Renault Premium 320 1685DZH', '1685DZH', @tomino),
    ('LOGISTICA 4', '1916FKJ', @tomino),
    ('MAN TGL 8220 2072MCG', '2072MCG', @tomino),
    ('GAIA 11', '20DH04', @tomino),
    ('REPARTO CIUDAD PEQUEÑA', '2437KVX', @tomino),
    ('MARL 1', '24RV31', @tomino),
    ('Iveco Eurocargo 2579JYW', '2579JYW', @tomino),
    ('TOXAL', '2592KXM', @tomino),
    ('RUTA 13', '2596LGF', @tomino),
    ('RUTA 17', '2597LGF', @tomino),
    ('LOGISTICA 5', '2601LGF', @tomino),
    ('RUTA 85', '2631MNJ', @tomino),
    ('Celso', '2797MYC', @tomino),
    ('Coimbra 27LH46', '27LH46', @tomino),
    ('Gaia 27PM82', '27PM82', @tomino),
    ('LOGISTICA 2', '2809MSW', @tomino),
    ('LOGISTICA 6', '2873MYD', @tomino),
    ('MAN TGL 8220 3011MCF', '3011MCF', @tomino),
    ('Paulo', '3577JMT', @tomino),
    ('SEVILLA', '3637NFS', @tomino),
    ('3712', '3712', @tomino),
    ('Renault Trafic 3861DLC', '3861DLC', @tomino),
    ('Iveco Daily 4446FXW', '4446FXW', @tomino),
    ('RUTA 15', '4562MBB', @tomino),
    ('RUTA 18', '4596MBB', @tomino),
    ('GAIA 12', '45ZH96', @tomino),
    ('Iveco Daily 4638DZX', '4638DZX', @tomino),
    ('Sustitución Planta Tomiño', '4969GKX', @tomino),
    ('RUTA 19', '4976MBB', @tomino),
    ('RUTA 11', '5121MDL', @tomino),
    ('San Campio 5136DHX', '5136DHX', @tomino),
    ('Iveco Daily 5237CLW', '5237CLW', @tomino),
    ('SUSTITUCIÓN VERALEZA', '5319KLF', @tomino),
    ('ZI', '53ZI78', @tomino),
    ('LOGISTICA 7', '5423MYG', @tomino),
    ('Jose Collazo', '5482MTZ', @tomino),
    ('GAIA 15', '54ZI28', @tomino),
    ('Faro 54ZI32', '54ZI32', @tomino),
    ('Pte Instalar 58891', '58891', @tomino),
    ('Fernando Otero', '5939MVB', @tomino),
    ('SEVILLA 2', '5955NPW', @tomino),
    ('GAIA 14', '63ZE11', @tomino),
    ('Mercedes Sprinter 6567NKL', '6567NKL', @tomino),
    ('DAF LF220 6581MZV', '6581MZV', @tomino),
    ('Sustitución Flor Tomiño', '6682KFH', @tomino),
    ('ALMACEN MADRID', '6683KFH', @tomino),
    ('SUSTITUCION', '6684KFH', @tomino),
    ('RUTA 12', '6685KFH', @tomino),
    ('RUTA R80', '6752KFH', @tomino),
    ('Renault Midlum 6786CXF', '6786CXF', @tomino),
    ('Veraleza Almería. \n6849NHC', '6849NHC', @tomino),
    ('Veraleza Almería.  6862KTL', '6862KTL', @tomino),
    ('LOGISTICA 3', '6942MRK', @tomino),
    ('Renault Trafic 7015CTP', '7015CTP', @tomino),
    ('Scania G410 7086LGT', '7086LGT', @tomino),
    ('RUTA 60', '7137MHS', @tomino),
    ('LOGISTICA 1', '7260MRK', @tomino),
    ('Renault Mascott 7686CWS', '7686CWS', @tomino),
    ('Iveco Daily 7693FXG', '7693FXG', @tomino),
    ('RUTA 45', '7946MKZ', @tomino),
    ('Gaia 8216VM', '8216VM', @tomino),
    ('RUTA 70', '8387JPL', @tomino),
    ('Mauri R-48', '8637MPY', @tomino),
    ('SEVILLA', '8685GKX', @tomino),
    ('Iveco Daily 8720DYF', '8720DYF', @tomino),
    ('Iveco Daily 8911DYF', '8911DYF', @tomino),
    ('Fiat Ducato 8928FKS', '8928FKS', @tomino),
    ('Corña 8960 HZK', '8960HZK', @tomino),
    ('Veraleza Almería.  9077JWR', '9077JWR', @tomino),
    ('MARL 2', '90GR63', @tomino),
    ('RUTA 16', '9133MPK', @tomino),
    ('RUTA 14', '9144MPK', @tomino),
    ('Coruña 9283 FYT', '9283FYT', @tomino),
    ('Faro 92TU06', '92TU06', @tomino),
    ('San Campio 9314FFZ', '9314FFZ', @tomino),
    ('Uxia Otero', '9370MJB', @tomino),
    ('RUTA 50', '9513LLJ', @tomino),
    ('REPARTO CIUDAD GRANDE', '9965KJC', @tomino),
    ('AG', 'AG78OS', @tomino),
    ('AQ', 'AQ81AL', @tomino),
    ('GAIA 13', 'AR64SE', @tomino),
    ('Faro AS78HI', 'AS78HI', @tomino),
    ('DAF LF180 BD59PS', 'BD59PS', @tomino),
    ('VERALEZA PORTUGAL 2', 'BR04PV', @tomino),
    ('VERALEZA PORTUGAL 1', 'BR63PT', @tomino),
    ('BR', 'BR66PU', @tomino),
    ('BF', 'BR66PV', @tomino),
    ('Gaia BZ66EJ', 'BZ66EJ', @tomino),
    ('GAIA 17', 'BZ91EI', @tomino),
    ('Gabarra', 'C04310R', @tomino),
    ('Iveco Daily CA41OV', 'CA41OV', @tomino),
    ('CAMARA CLIENTES GAIA', 'CAMARA', @tomino),
    ('CAMARAS GIJON', 'CAMARAASTURI', @tomino),
    ('CAMARA FLOR', 'CAMARAFLOR', @tomino),
    ('CAMARA 1, 2, 3 GAIA', 'CAMARAGAIA', @tomino),
    ('CAMARA INVERNADERO VIEJO', 'CAMARAINVVIEJO', @tomino),
    ('CAMARA PLANTA', 'CAMARAPLANTA', @tomino),
    ('CAMARAS COIMBRA  1, 2 y 3', 'CAMARASCOIMBRA', @tomino),
    ('Pte Instalar 10408', 'NSERIE10408', @tomino),
    ('Pte Instalar 29148', 'NSERIE29148', @tomino),
    ('Pte Instalar 32101', 'NSERIE32101', @tomino),
    ('Pte Instalar 32106', 'NSERIE32106', @tomino),
    ('Pte Instalar 32109', 'NSERIE32109', @tomino),
    ('Pte Instalar 4728', 'NSERIE4728', @tomino),
    ('Gabarra Frio Marl', 'PO2257R', @tomino),
    ('Gabarra Benavente', 'R0169BBG', @tomino),
    ('Remolque Scania R500', 'R2454BCS', @tomino),
    ('Remolque Hamurg', 'R4886BCY', @tomino),
    ('Remolque Renault', 'R6877BBR', @tomino),
    ('Mini Pala', 'S/M', @tomino);

SET SQL_SAFE_UPDATES = 1;

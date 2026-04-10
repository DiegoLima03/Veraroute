-- ════════════════════════════════════════════════════════════════
-- SEED: Estimacion coste/km de cada vehiculo segun categoria
-- Datos orientativos del sector logistica Espana 2024-2026
-- Incluye: combustible + amortizacion + neumaticos + mantenimiento
--          + seguros + ITV + impuesto circulacion. SIN chofer.
-- ════════════════════════════════════════════════════════════════

-- Por defecto: furgoneta de reparto generica (0.55)
UPDATE vehicles SET cost_per_km = 0.55 WHERE active = 1;

-- ─── Camiones rigidos grandes (>12t): 0.85 €/km ────────────
UPDATE vehicles SET cost_per_km = 0.85
WHERE active = 1 AND (
    name LIKE '%Scania%'
 OR name LIKE '%MAN TGL%'
 OR name LIKE '%MAN TGS%'
 OR name LIKE '%MAN TGX%'
 OR name LIKE '%DAF LF%'
 OR name LIKE '%DAF XF%'
 OR name LIKE '%Renault Premium%'
 OR name LIKE '%Iveco Eurocargo%'
 OR name LIKE '%Iveco Stralis%'
);

-- ─── Camiones medios (7.5-12t): 0.65 €/km ──────────────────
UPDATE vehicles SET cost_per_km = 0.65
WHERE active = 1 AND (
    name LIKE '%Renault Midlum%'
 OR name LIKE '%Renault Mascott%'
);

-- ─── Furgones medianos (3.5-7.5t): 0.50 €/km ───────────────
UPDATE vehicles SET cost_per_km = 0.50
WHERE active = 1 AND (
    name LIKE '%Iveco Daily%'
 OR name LIKE '%Mercedes Sprinter%'
 OR name LIKE '%MAN TGE%'
 OR name LIKE '%Fiat Ducato%'
 OR name LIKE '%Nissan Atleon%'
 OR name LIKE '%Renault Trafic%'
);

-- ─── Remolques y gabarras: 0.30 €/km ───────────────────────
UPDATE vehicles SET cost_per_km = 0.30
WHERE active = 1 AND (
    name LIKE '%Gabarra%'
 OR name LIKE '%Remolque%'
);

-- ─── No-vehiculos (camaras, mini pala, pte instalar): 0.00 ─
UPDATE vehicles SET cost_per_km = 0.00
WHERE active = 1 AND (
    name LIKE 'CAMARA%'
 OR name LIKE '%CAMARAS%'
 OR name LIKE 'Mini Pala%'
 OR name LIKE 'Pte Instalar%'
);

-- ════════════════════════════════════════════════════
-- VERIFICACION
-- ════════════════════════════════════════════════════
SELECT
  cost_per_km,
  COUNT(*) AS num_vehiculos,
  GROUP_CONCAT(name ORDER BY name SEPARATOR ', ') AS ejemplos
FROM vehicles
WHERE active = 1
GROUP BY cost_per_km
ORDER BY cost_per_km DESC;

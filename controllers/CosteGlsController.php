<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/ConfigEnviosGls.php';
require_once __DIR__ . '/../models/HistorialCosteCliente.php';
require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../services/CalculadorCosteRuta.php';
require_once __DIR__ . '/../models/RegistroAuditoria.php';

class CosteGlsController extends Controlador
{
    private ConfigEnviosGls $configModel;
    private HistorialCosteCliente $historyModel;
    private HojaRuta $hojaModel;
    private CalculadorCosteRuta $calculator;

    public function __construct()
    {
        $this->configModel = new ConfigEnviosGls();
        $this->historyModel = new HistorialCosteCliente();
        $this->hojaModel = new HojaRuta();
        $this->calculator = new CalculadorCosteRuta();
    }

    public function getConfig()
    {
        Autenticacion::requireRole('admin');
        $this->json($this->getConfigPayload());
    }

    /** PUT /api/shipping-config/fuel  body: { fuel_pct: 5.80 } */
    public function updateFuelPct()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (!isset($data['fuel_pct'])) {
            $this->json(['error' => 'fuel_pct es obligatorio'], 400);
        }
        $fp = (float) $data['fuel_pct'];
        if ($fp < 0 || $fp > 100) {
            $this->json(['error' => 'El % de combustible debe estar entre 0 y 100'], 400);
        }
        $oldFuel = $this->configModel->getCurrentFuelPct();
        $this->configModel->updateConfig(['gls_fuel_pct_current' => round($fp, 2)]);
        RegistroAuditoria::log('update_fuel_pct', 'config_envios_gls', 'gls_fuel_pct_current', $oldFuel, round($fp, 2));
        $this->json($this->getConfigPayload());
    }

    /** GET /api/shipping-config/alerts  - CP de clientes que no encuentran zona en el carrier */
    public function getAlerts()
    {
        Autenticacion::requireRole('admin', 'logistica');

        $unmappedCps = $this->query(
            "SELECT c.codigo_postal AS postcode, COUNT(*) as num_clientes,
                    GROUP_CONCAT(DISTINCT c.nombre ORDER BY c.nombre SEPARATOR ', ') as ejemplos
             FROM clientes c
             WHERE c.activo = 1
               AND c.codigo_postal IS NOT NULL
               AND TRIM(c.codigo_postal) != ''
               AND NOT EXISTS (
                   SELECT 1 FROM zonas_transportista cz
                   WHERE cz.id_transportista = (SELECT id FROM transportistas WHERE nombre = 'GLS' LIMIT 1)
                     AND cz.codigo_pais = 'ES'
                     AND (cz.prefijo_cp = '*' OR c.codigo_postal LIKE CONCAT(cz.prefijo_cp, '%'))
               )
             GROUP BY c.codigo_postal
             ORDER BY num_clientes DESC
             LIMIT 50"
        )->fetchAll();

        // Stats globales
        $stats = $this->query(
            "SELECT
                COUNT(*) as total_clientes,
                SUM(CASE WHEN codigo_postal IS NULL OR TRIM(codigo_postal) = '' THEN 1 ELSE 0 END) as sin_cp,
                SUM(CASE WHEN x IS NULL OR y IS NULL THEN 1 ELSE 0 END) as sin_coords
             FROM clientes WHERE activo = 1"
        )->fetch();

        $this->json([
            'unmapped_postcodes' => array_map(function ($r) {
                $ej = (string) ($r['ejemplos'] ?? '');
                return [
                    'postcode' => $r['postcode'],
                    'num_clientes' => (int) $r['num_clientes'],
                    'ejemplos' => mb_strlen($ej) > 80 ? mb_substr($ej, 0, 80) . '...' : $ej,
                ];
            }, $unmappedCps),
            'stats' => [
                'total_clientes' => (int) $stats['total_clientes'],
                'sin_cp' => (int) $stats['sin_cp'],
                'sin_coords' => (int) $stats['sin_coords'],
            ],
        ]);
    }

    private function query(string $sql, array $params = [])
    {
        $stmt = Database::connect()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function updateConfig()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();

        $errors = [];
        foreach ([
            'default_weight_per_carro_kg',
            'default_weight_per_caja_kg',
            'default_parcels_per_carro',
            'default_parcels_per_caja',
            'default_volume_per_carro_cm3',
            'default_volume_per_caja_cm3',
        ] as $field) {
            if (isset($data[$field]) && (float) $data[$field] < 0) {
                $errors[] = 'Las variables de calculo no pueden ser negativas.';
            }
        }

        if (!empty($data['pais_origen']) && strlen(trim((string) $data['pais_origen'])) !== 2) {
            $errors[] = 'El pais de origen debe tener 2 caracteres.';
        }

        if (isset($data['price_multiplier'])) {
            $pm = (float) $data['price_multiplier'];
            if ($pm < 0 || $pm > 5) {
                $errors[] = 'El multiplicador de precio debe estar entre 0 y 5 (ej: 0.85 para 15% descuento).';
            }
        }

        if (isset($data['gls_fuel_pct_current'])) {
            $fp = (float) $data['gls_fuel_pct_current'];
            if ($fp < 0 || $fp > 100) {
                $errors[] = 'El recargo de combustible debe estar entre 0 y 100 %.';
            }
        }

        if ($errors) {
            $this->json(['error' => implode(' ', $errors)], 400);
        }

        if (isset($data['pais_origen'])) {
            $data['pais_origen'] = strtoupper(trim((string) $data['pais_origen']));
        }
        if (isset($data['usar_peso_volumetrico'])) {
            $data['usar_peso_volumetrico'] = !empty($data['usar_peso_volumetrico']) ? 1 : 0;
        }

        $oldConfig = $this->configModel->getCalculationVariables();
        $this->configModel->updateConfig($data);
        RegistroAuditoria::log('update_shipping_config', 'config_envios_gls', null, $oldConfig, $data);
        $this->json($this->getConfigPayload());
    }

    public function calculateForHoja()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $data = $this->getInput();
        $hojaRutaId = (int) ($data['id_hoja_ruta'] ?? 0);
        if ($hojaRutaId <= 0) {
            $this->json(['error' => 'id_hoja_ruta es obligatorio'], 400);
        }

        if (!$this->hojaModel->getById($hojaRutaId)) {
            $this->json(['error' => 'Hoja no encontrada'], 404);
        }

        $summary = $this->calculator->calculateAndSave($hojaRutaId, !empty($data['force']));
        $this->json($summary);
    }

    /** POST /api/shipping-costs/simulate body: { id_hoja_ruta, client_ids_in_fleet } */
    public function simulateForHoja()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $data = $this->getInput();
        $hojaRutaId = (int) ($data['id_hoja_ruta'] ?? 0);
        if ($hojaRutaId <= 0) {
            $this->json(['error' => 'id_hoja_ruta es obligatorio'], 400);
        }
        $clientIds = $data['client_ids_in_fleet'] ?? [];
        if (!is_array($clientIds)) {
            $this->json(['error' => 'client_ids_in_fleet debe ser un array'], 400);
        }
        if (!$this->hojaModel->getById($hojaRutaId)) {
            $this->json(['error' => 'Hoja no encontrada'], 404);
        }
        $result = $this->calculator->simulateRouteForClients($hojaRutaId, array_map('intval', $clientIds));
        $this->json($result);
    }

    public function getCostsForHoja($id)
    {
        Autenticacion::requireRole('admin', 'logistica');
        $hoja = $this->hojaModel->getById((int) $id);
        if (!$hoja) {
            $this->json(['error' => 'Hoja no encontrada'], 404);
        }

        $lines = $this->hojaModel->getCostLines((int) $id);
        $result = array_map(function ($line) {
            return [
                'linea_id' => (int) $line['linea_id'],
                'id_cliente' => (int) $line['id_cliente'],
                'client_name' => $line['client_name'],
                'client_postcode' => $line['client_postcode'] ?? '',
                'carros' => (float) ($line['carros'] ?? 0),
                'cajas' => (float) ($line['cajas'] ?? 0),
                'desvio_km' => $line['desvio_km'] !== null ? (float) $line['desvio_km'] : null,
                'coste_ruta_propia' => $line['coste_ruta_propia'] !== null ? (float) $line['coste_ruta_propia'] : null,
                'coste_gls_ajustado' => $line['coste_gls_ajustado'] !== null ? (float) $line['coste_gls_ajustado'] : null,
                'recomendacion' => $line['recomendacion'] ?? 'no_disponible',
                'savings' => $line['coste_ruta_propia'] !== null && $line['coste_gls_ajustado'] !== null
                    ? round((float) $line['coste_ruta_propia'] - (float) $line['coste_gls_ajustado'], 4)
                    : null,
                'servicio_gls' => $line['servicio_gls'] ?? '',
                'postcode_missing' => trim((string) ($line['client_postcode'] ?? '')) === '',
                'notes' => $line['notas_gls'] ?? '',
            ];
        }, $lines);

        $this->json($result);
    }

    public function getClientHistory($id)
    {
        Autenticacion::requireRole('admin', 'logistica');
        $this->json($this->historyModel->getForClient((int) $id, 30));
    }

    public function getDailyReport()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $date = $_GET['date'] ?? date('Y-m-d');
        $this->json($this->historyModel->getDailySummary($date));
    }

    /** GET /api/shipping-costs/range-report?from=YYYY-MM-DD&to=YYYY-MM-DD */
    public function getRangeReport()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $from = $_GET['from'] ?? date('Y-m-d', strtotime('-30 days'));
        $to = $_GET['to'] ?? date('Y-m-d');
        $this->json($this->historyModel->getRangeReport($from, $to));
    }

    public function recalculateAll()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        $date = $data['date'] ?? date('Y-m-d');
        $force = !empty($data['force']);

        $hojas = $this->hojaModel->getByFecha($date);
        $results = [];
        $totals = [
            'hojas' => 0,
            'processed' => 0,
            'skipped_cached' => 0,
            'skipped_zero_load' => 0,
            'skipped_no_postcode' => 0,
            'gls_errors' => 0,
            'recommend_own' => 0,
            'recommend_externalize' => 0,
            'recommend_break_even' => 0,
            'no_disponible' => 0,
            'total_own_cost' => 0.0,
            'total_gls_cost' => 0.0,
            'potential_savings_if_externalized' => 0.0,
        ];

        foreach ($hojas as $hoja) {
            $summary = $this->calculator->calculateAndSave((int) $hoja['id'], $force);
            $results[] = [
                'id_hoja_ruta' => (int) $hoja['id'],
                'ruta_name' => $hoja['ruta_name'],
                'summary' => $summary,
            ];
            $totals['hojas']++;
            foreach ($totals as $key => $value) {
                if ($key === 'hojas') {
                    continue;
                }
                if (isset($summary[$key])) {
                    $totals[$key] += $summary[$key];
                }
            }
        }

        $totals['total_own_cost'] = round($totals['total_own_cost'], 4);
        $totals['total_gls_cost'] = round($totals['total_gls_cost'], 4);
        $totals['potential_savings_if_externalized'] = round($totals['potential_savings_if_externalized'], 4);

        $this->json([
            'date' => $date,
            'results' => $results,
            'totals' => $totals,
        ]);
    }

    /** GET /api/stats/gls — metricas ejecutivas para dashboard */
    public function dashboardStats()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $db = Database::connect();

        // Ahorro acumulado historico
        $savings = $db->query("
            SELECT
                COUNT(DISTINCT id_hoja_ruta) as hojas_analizadas,
                SUM(CASE WHEN recomendacion = 'externalizar' THEN ahorro_si_externaliza ELSE 0 END) as ahorro_externalizables,
                SUM(coste_ruta_propia) as total_coste_marginal,
                SUM(coste_gls_ajustado) as total_coste_gls,
                COUNT(*) as lineas_analizadas,
                SUM(CASE WHEN recomendacion = 'ruta_propia' THEN 1 ELSE 0 END) as lineas_ruta_propia,
                SUM(CASE WHEN recomendacion = 'externalizar' THEN 1 ELSE 0 END) as lineas_externalizar,
                SUM(CASE WHEN recomendacion = 'equilibrio' THEN 1 ELSE 0 END) as lineas_empate
            FROM historial_coste_cliente
            WHERE coste_gls_ajustado > 0
        ")->fetch();

        // Top 5 vehiculos mas usados (por num hojas)
        $topVehicles = $db->query("
            SELECT v.nombre AS name, COUNT(hr.id) as num_hojas
            FROM hojas_ruta hr
            JOIN vehiculos v ON v.id = hr.id_vehiculo
            GROUP BY hr.id_vehiculo
            ORDER BY num_hojas DESC
            LIMIT 5
        ")->fetchAll();

        // Vehiculos sin usar
        $unusedVehicles = $db->query("
            SELECT COUNT(*) as total
            FROM vehiculos v
            WHERE v.activo = 1
              AND v.id NOT IN (SELECT DISTINCT id_vehiculo FROM hojas_ruta WHERE id_vehiculo IS NOT NULL)
        ")->fetch();

        // Cobertura geocodificacion
        $geocode = $db->query("
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN x IS NOT NULL AND x != 0 THEN 1 ELSE 0 END) as con_coords
            FROM clientes
        ")->fetch();

        // Clientes por ruta
        $clientsByRoute = $db->query("
            SELECT r.nombre AS name, r.color, COUNT(cr.id_cliente) as num_clientes
            FROM rutas r
            LEFT JOIN cliente_rutas cr ON cr.id_ruta = r.id
            GROUP BY r.id
            ORDER BY num_clientes DESC
            LIMIT 10
        ")->fetchAll();

        $this->json([
            'hojas_analizadas' => (int) ($savings['hojas_analizadas'] ?? 0),
            'lineas_analizadas' => (int) ($savings['lineas_analizadas'] ?? 0),
            'ahorro_externalizables' => round((float) ($savings['ahorro_externalizables'] ?? 0), 2),
            'total_coste_marginal' => round((float) ($savings['total_coste_marginal'] ?? 0), 2),
            'total_coste_gls' => round((float) ($savings['total_coste_gls'] ?? 0), 2),
            'lineas_ruta_propia' => (int) ($savings['lineas_ruta_propia'] ?? 0),
            'lineas_externalizar' => (int) ($savings['lineas_externalizar'] ?? 0),
            'lineas_empate' => (int) ($savings['lineas_empate'] ?? 0),
            'top_vehiculos' => $topVehicles,
            'vehiculos_sin_usar' => (int) ($unusedVehicles['total'] ?? 0),
            'geocode_total' => (int) ($geocode['total'] ?? 0),
            'geocode_con_coords' => (int) ($geocode['con_coords'] ?? 0),
            'clientes_por_ruta' => $clientsByRoute,
        ]);
    }

    private function getConfigPayload(): array
    {
        $config = $this->configModel->getConfig();
        return [
            'cp_origen' => $config['cp_origen'] ?? '',
            'pais_origen' => $config['pais_origen'] ?? 'ES',
            'price_multiplier' => $config['price_multiplier'] ?? '1.0000',
            'gls_fuel_pct_current' => $config['gls_fuel_pct_current'] ?? '0.00',
            'prefijos_cp_remotos' => $config['prefijos_cp_remotos'] ?? '',
            'default_weight_per_carro_kg' => $config['default_weight_per_carro_kg'] ?? '5.00',
            'default_weight_per_caja_kg' => $config['default_weight_per_caja_kg'] ?? '2.50',
            'default_parcels_per_carro' => $config['default_parcels_per_carro'] ?? '1.00',
            'default_parcels_per_caja' => $config['default_parcels_per_caja'] ?? '1.00',
            'default_volume_per_carro_cm3' => $config['default_volume_per_carro_cm3'] ?? '0.00',
            'default_volume_per_caja_cm3' => $config['default_volume_per_caja_cm3'] ?? '0.00',
            'usar_peso_volumetrico' => !empty($config['usar_peso_volumetrico']) ? 1 : 0,
        ];
    }
}

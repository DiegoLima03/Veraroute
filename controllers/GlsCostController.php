<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/GlsShippingConfig.php';
require_once __DIR__ . '/../models/ClientCostHistory.php';
require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../services/GlsApiClient.php';
require_once __DIR__ . '/../services/RouteCostCalculator.php';

class GlsCostController extends Controller
{
    private GlsShippingConfig $configModel;
    private ClientCostHistory $historyModel;
    private HojaRuta $hojaModel;
    private GlsApiClient $apiClient;
    private RouteCostCalculator $calculator;

    public function __construct()
    {
        $this->configModel = new GlsShippingConfig();
        $this->historyModel = new ClientCostHistory();
        $this->hojaModel = new HojaRuta();
        $this->apiClient = new GlsApiClient();
        $this->calculator = new RouteCostCalculator();
    }

    public function getConfig()
    {
        Auth::requireRole('admin');
        $config = $this->configModel->getConfig();
        $config['api_password'] = trim((string) ($config['api_password'] ?? '')) !== '' ? '***' : '';
        $this->json($config);
    }

    public function updateConfig()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();

        $errors = [];
        $multiplier = isset($data['price_multiplier']) ? (float) $data['price_multiplier'] : 1;
        if ($multiplier < 0.1 || $multiplier > 2.0) {
            $errors[] = 'El multiplicador debe estar entre 0.1 y 2.0.';
        }

        foreach (['default_weight_per_carro_kg', 'default_weight_per_caja_kg'] as $field) {
            if (isset($data[$field]) && (float) $data[$field] < 0) {
                $errors[] = 'Los pesos por defecto no pueden ser negativos.';
            }
        }

        if (!empty($data['origin_country']) && strlen(trim((string) $data['origin_country'])) !== 2) {
            $errors[] = 'El pais de origen debe tener 2 caracteres.';
        }

        if ($errors) {
            $this->json(['error' => implode(' ', $errors)], 400);
        }

        if (($data['api_password'] ?? '') === '***') {
            unset($data['api_password']);
        }

        if (isset($data['origin_country'])) {
            $data['origin_country'] = strtoupper(trim((string) $data['origin_country']));
        }
        if (isset($data['api_env'])) {
            $data['api_env'] = in_array($data['api_env'], ['test', 'production'], true) ? $data['api_env'] : 'test';
        }

        $this->configModel->updateConfig($data);
        $config = $this->configModel->getConfig();
        $config['api_password'] = trim((string) ($config['api_password'] ?? '')) !== '' ? '***' : '';
        $this->json($config);
    }

    public function testConnection()
    {
        Auth::requireRole('admin');
        $result = $this->apiClient->testConnection();
        $message = $result['success']
            ? sprintf(
                'Conexion OK. Precio de prueba: %.2f %s (%s)',
                (float) ($result['price_raw'] ?? 0),
                $result['currency'] ?? 'EUR',
                $result['service'] ?? 'GLS'
            )
            : ($result['error'] ?? 'No se pudo conectar con GLS.');

        $this->json([
            'success' => (bool) $result['success'],
            'message' => $message,
            'price_raw' => (float) ($result['price_raw'] ?? 0),
            'currency' => $result['currency'] ?? 'EUR',
            'service' => $result['service'] ?? '',
            'response_time_ms' => (int) ($result['response_time_ms'] ?? 0),
        ], $result['success'] ? 200 : 400);
    }

    public function calculateForHoja()
    {
        Auth::requireRole('admin', 'logistica');
        $data = $this->getInput();
        $hojaRutaId = (int) ($data['hoja_ruta_id'] ?? 0);
        if ($hojaRutaId <= 0) {
            $this->json(['error' => 'hoja_ruta_id es obligatorio'], 400);
        }

        if (!$this->hojaModel->getById($hojaRutaId)) {
            $this->json(['error' => 'Hoja no encontrada'], 404);
        }

        $summary = $this->calculator->calculateAndSave($hojaRutaId, !empty($data['force']));
        $this->json($summary);
    }

    public function getCostsForHoja($id)
    {
        Auth::requireRole('admin', 'logistica');
        $hoja = $this->hojaModel->getById((int) $id);
        if (!$hoja) {
            $this->json(['error' => 'Hoja no encontrada'], 404);
        }

        $lines = $this->hojaModel->getCostLines((int) $id);
        $result = array_map(function ($line) {
            return [
                'linea_id' => (int) $line['linea_id'],
                'client_id' => (int) $line['client_id'],
                'client_name' => $line['client_name'],
                'client_postcode' => $line['client_postcode'] ?? '',
                'carros' => (float) ($line['carros'] ?? 0),
                'cajas' => (float) ($line['cajas'] ?? 0),
                'detour_km' => $line['detour_km'] !== null ? (float) $line['detour_km'] : null,
                'cost_own_route' => $line['cost_own_route'] !== null ? (float) $line['cost_own_route'] : null,
                'cost_gls_adjusted' => $line['cost_gls_adjusted'] !== null ? (float) $line['cost_gls_adjusted'] : null,
                'recommendation' => $line['recommendation'] ?? 'unavailable',
                'savings' => $line['cost_own_route'] !== null && $line['cost_gls_adjusted'] !== null
                    ? round((float) $line['cost_own_route'] - (float) $line['cost_gls_adjusted'], 4)
                    : null,
                'gls_service' => $line['gls_service'] ?? '',
                'postcode_missing' => trim((string) ($line['client_postcode'] ?? '')) === '',
                'notes' => $line['gls_notes'] ?? '',
            ];
        }, $lines);

        $this->json($result);
    }

    public function getClientHistory($id)
    {
        Auth::requireRole('admin', 'logistica');
        $this->json($this->historyModel->getForClient((int) $id, 30));
    }

    public function getDailyReport()
    {
        Auth::requireRole('admin', 'logistica');
        $date = $_GET['date'] ?? date('Y-m-d');
        $this->json($this->historyModel->getDailySummary($date));
    }

    public function recalculateAll()
    {
        Auth::requireRole('admin');
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
            'unavailable' => 0,
            'total_own_cost' => 0.0,
            'total_gls_cost' => 0.0,
            'potential_savings_if_externalized' => 0.0,
        ];

        foreach ($hojas as $hoja) {
            $summary = $this->calculator->calculateAndSave((int) $hoja['id'], $force);
            $results[] = [
                'hoja_ruta_id' => (int) $hoja['id'],
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
}

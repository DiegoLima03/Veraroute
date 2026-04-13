<?php

require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../models/Vehicle.php';
require_once __DIR__ . '/../models/Delegation.php';
require_once __DIR__ . '/../models/DistanceCache.php';
require_once __DIR__ . '/../models/GlsShippingConfig.php';
require_once __DIR__ . '/../models/ClientCostHistory.php';
require_once __DIR__ . '/../models/ShippingRateTable.php';
require_once __DIR__ . '/RouteOptimizer.php';

class RouteCostCalculator
{
    private ?string $lastOsrmWarning = null;
    private HojaRuta $hojaModel;
    private Vehicle $vehicleModel;
    private Delegation $delegationModel;
    private DistanceCache $distanceCache;
    private GlsShippingConfig $configModel;
    private ClientCostHistory $historyModel;
    private ShippingRateTable $shippingRateModel;
    private RouteOptimizer $routeOptimizer;

    public function __construct()
    {
        $this->hojaModel = new HojaRuta();
        $this->vehicleModel = new Vehicle();
        $this->delegationModel = new Delegation();
        $this->distanceCache = new DistanceCache();
        $this->configModel = new GlsShippingConfig();
        $this->historyModel = new ClientCostHistory();
        $this->shippingRateModel = new ShippingRateTable();
        $this->routeOptimizer = new RouteOptimizer($this->distanceCache);
    }

    public function calculateDetourKm(int $clientId, int $hojaRutaId): ?float
    {
        $hoja = $this->hojaModel->getById($hojaRutaId);
        if (!$hoja) {
            return null;
        }

        $depot = $this->resolveDepotForHoja($hoja);
        if (!$depot) {
            return null;
        }

        $lineas = $this->getActiveOrderedLineas($hoja['lineas'] ?? []);
        return $this->calculateDetourKmFromLineas($clientId, $lineas, $depot);
    }

    public function calculateAndSave(int $hojaRutaId, bool $forceRecalc = false): array
    {
        $hoja = $this->hojaModel->getById($hojaRutaId);
        if (!$hoja) {
            return [
                'processed' => 0,
                'error' => 'Hoja de ruta no encontrada',
            ];
        }

        $calcVars = $this->configModel->getCalculationVariables();
        $priceMultiplier = $this->configModel->getPriceMultiplier();
        $fuelPctOverride = $this->configModel->getCurrentFuelPct();
        $remotePrefixes = $this->configModel->getRemotePostcodePrefixes();
        $vehicle = !empty($hoja['vehicle_id']) ? $this->vehicleModel->getById((int) $hoja['vehicle_id']) : null;
        $vehicleCostPerKm = $vehicle && $vehicle['cost_per_km'] !== null ? (float) $vehicle['cost_per_km'] : null;
        $depot = $this->resolveDepotForHoja($hoja);
        $lineas = $this->getActiveOrderedLineas($hoja['lineas'] ?? []);

        $summary = [
            'processed' => 0,
            'skipped_cached' => 0,
            'skipped_zero_load' => 0,
            'skipped_no_postcode' => 0,
            'gls_errors' => 0,
            'unavailable' => 0,
            'recommend_own' => 0,
            'recommend_externalize' => 0,
            'recommend_break_even' => 0,
            'total_own_cost' => 0.0,
            'total_gls_cost' => 0.0,
            'total_gls_all_clients' => 0.0,
            'potential_savings_if_externalized' => 0.0,
            'total_route_km' => 0.0,
            'total_route_cost' => 0.0,
            'global_recommendation' => 'unavailable',
            'global_savings' => 0.0,
            'optimization_mode' => 'unavailable',
            'optimized_route_cost' => 0.0,
            'optimized_gls_cost' => 0.0,
            'optimized_total_cost' => 0.0,
            'optimized_savings' => 0.0,
            'line_recommendations' => [],
            'line_recommendation_notes' => [],
            'osrm_warning' => null,
        ];
        $evaluatedLineas = [];

        foreach ($lineas as $linea) {
            if (!$forceRecalc && $this->lineHasComputedCosts($linea)) {
                $summary['skipped_cached']++;
                $evaluatedLineas[] = $this->buildEvaluatedLinea($linea, [
                    'detour_km' => $linea['detour_km'] !== null ? (float) $linea['detour_km'] : null,
                    'cost_own_route' => $linea['cost_own_route'] !== null ? (float) $linea['cost_own_route'] : null,
                    'cost_gls_adjusted' => $linea['cost_gls_adjusted'] !== null ? (float) $linea['cost_gls_adjusted'] : null,
                    'gls_recommendation' => $linea['gls_recommendation'] ?? 'unavailable',
                    'gls_notes' => $linea['gls_notes'] ?? '',
                ]);
                continue;
            }

            $carros = max(0.0, (float) ($linea['carros'] ?? 0));
            $cajas = max(0.0, (float) ($linea['cajas'] ?? 0));
            if ($carros <= 0 && $cajas <= 0) {
                $summary['skipped_zero_load']++;
                continue;
            }

            $lineaId = (int) $linea['id'];
            $clientId = (int) $linea['client_id'];
            $postcode = trim((string) ($linea['client_postcode'] ?? ''));
            $realWeightKg = round(
                ($carros * $calcVars['per_carro']) + ($cajas * $calcVars['per_caja']),
                2
            );
            $volumeM3 = round(
                ($carros * $calcVars['volume_per_carro_cm3']) + ($cajas * $calcVars['volume_per_caja_cm3']),
                2
            );
            $numParcels = max(
                1,
                (int) ceil(
                    ($carros * $calcVars['parcels_per_carro']) + ($cajas * $calcVars['parcels_per_caja'])
                )
            );
            $detourKm = $this->calculateDetourKmFromLineas($clientId, $lineas, $depot);
            $costOwnRoute = null;
            $costCarrierRaw = null;
            $costCarrierAdjusted = null;
            $billableWeightKg = $realWeightKg;
            $recommendation = 'unavailable';
            $carrierService = '';
            $notes = '';

            if ($detourKm === null) {
                $notes = 'missing_coords';
            } elseif ($vehicleCostPerKm === null) {
                $notes = 'vehicle_cost_missing';
            } else {
                $costOwnRoute = round($detourKm * $vehicleCostPerKm, 4);
            }

            if ($postcode === '') {
                $summary['skipped_no_postcode']++;
                $notes = $notes ?: 'postcode_missing';
            } else {
                $bestRate = $this->shippingRateModel->findBestRate(
                    $postcode,
                    'ES',
                    $realWeightKg,
                    $numParcels,
                    [
                        'volume_m3' => $volumeM3,
                        'use_volumetric_weight' => $calcVars['use_volumetric_weight'],
                        'price_multiplier' => $priceMultiplier,
                        'fuel_pct_override' => $fuelPctOverride,
                        'remote_postcode_prefixes' => $remotePrefixes,
                    ]
                );

                if ($bestRate) {
                    $costCarrierRaw = round((float) ($bestRate['raw_price'] ?? $bestRate['price'] ?? 0), 4);
                    $costCarrierAdjusted = round((float) ($bestRate['price'] ?? 0), 4);
                    $billableWeightKg = round((float) ($bestRate['billable_weight_kg'] ?? $realWeightKg), 2);
                    $carrierService = trim(
                        (string) ($bestRate['carrier_name'] ?? $bestRate['carrier_code'] ?? '')
                        . (!empty($bestRate['service_name']) ? ' - ' . $bestRate['service_name'] : '')
                    );
                } else {
                    $summary['gls_errors']++;
                    $notes = $notes ?: 'carrier_rate_missing';
                }
            }

            if ($costOwnRoute !== null && $costCarrierAdjusted !== null) {
                $recommendation = $this->resolveRecommendation($costOwnRoute, $costCarrierAdjusted);
            }

            $saving = 0.0;
            if ($costOwnRoute !== null && $costCarrierAdjusted !== null) {
                $saving = round($costOwnRoute - $costCarrierAdjusted, 4);
            }

            $this->hojaModel->updateLineaCostData($lineaId, [
                'detour_km' => $detourKm,
                'cost_own_route' => $costOwnRoute,
                'cost_gls_raw' => $costCarrierRaw,
                'cost_gls_adjusted' => $costCarrierAdjusted,
                'gls_recommendation' => $recommendation,
                'gls_service' => $carrierService ?: null,
                'gls_notes' => $notes ?: null,
            ]);

            $this->historyModel->upsert([
                'client_id' => $clientId,
                'hoja_ruta_id' => $hojaRutaId,
                'fecha' => $hoja['fecha'],
                'carros' => $carros,
                'cajas' => $cajas,
                'weight_kg' => $billableWeightKg,
                'num_parcels' => $numParcels,
                'detour_km' => $detourKm,
                'vehicle_cost_per_km' => $vehicleCostPerKm ?? 0,
                'cost_own_route' => $costOwnRoute ?? 0,
                'cost_gls_raw' => $costCarrierRaw ?? 0,
                'cost_gls_adjusted' => $costCarrierAdjusted ?? 0,
                'price_multiplier_used' => $priceMultiplier,
                'recommendation' => $recommendation,
                'savings_if_externalized' => $saving,
                'gls_service' => $carrierService,
                'notes' => $notes,
            ]);

            $evaluatedLineas[] = $this->buildEvaluatedLinea($linea, [
                'detour_km' => $detourKm,
                'cost_own_route' => $costOwnRoute,
                'cost_gls_adjusted' => $costCarrierAdjusted,
                'gls_recommendation' => $recommendation,
                'gls_notes' => $notes,
            ]);
            $summary['processed']++;
        }

        $summary['total_own_cost'] = round(array_reduce($evaluatedLineas, function ($sum, $linea) {
            if ($linea['cost_own_route'] === null || $linea['cost_gls_adjusted'] === null) {
                return $sum;
            }
            return $sum + (float) $linea['cost_own_route'];
        }, 0.0), 4);
        $summary['total_gls_cost'] = round(array_reduce($evaluatedLineas, function ($sum, $linea) {
            if ($linea['cost_own_route'] === null || $linea['cost_gls_adjusted'] === null) {
                return $sum;
            }
            return $sum + (float) $linea['cost_gls_adjusted'];
        }, 0.0), 4);
        $summary['total_gls_all_clients'] = round(array_reduce($evaluatedLineas, function ($sum, $linea) {
            if ($linea['cost_gls_adjusted'] === null) {
                return $sum;
            }
            return $sum + (float) $linea['cost_gls_adjusted'];
        }, 0.0), 4);
        $summary['potential_savings_if_externalized'] = round(array_reduce($evaluatedLineas, function ($sum, $linea) {
            if ($linea['cost_own_route'] === null || $linea['cost_gls_adjusted'] === null) {
                return $sum;
            }
            return $sum + max(0.0, (float) $linea['cost_own_route'] - (float) $linea['cost_gls_adjusted']);
        }, 0.0), 4);

        // Reset del tracking OSRM para esta ejecucion
        $this->lastOsrmWarning = null;

        // Distancia total real de la ruta (depot -> clientes con carga -> depot)
        $totalRouteKm = 0.0;
        if ($depot) {
            $sequence = $this->buildRoutePointSequence($lineas, $depot, true);
            if ($sequence !== null) {
                $totalRouteKm = $this->calculateSequenceDistance($sequence);
            }
        }
        $summary['total_route_km'] = round($totalRouteKm, 3);
        $summary['total_route_cost'] = $vehicleCostPerKm !== null
            ? round($totalRouteKm * $vehicleCostPerKm, 4)
            : 0.0;

        $plan = $this->calculateOptimalRoutePlan(
            $evaluatedLineas,
            $depot,
            $vehicleCostPerKm,
            (float) $summary['total_route_cost']
        );
        $summary['optimization_mode'] = $plan['mode'];
        $summary['optimized_route_cost'] = $plan['route_cost'];
        $summary['optimized_gls_cost'] = $plan['gls_cost'];
        $summary['optimized_total_cost'] = $plan['total_cost'];
        $summary['optimized_savings'] = $plan['savings'];
        $summary['line_recommendations'] = $plan['line_recommendations'];
        $summary['line_recommendation_notes'] = $plan['line_recommendation_notes'];

        $summary['recommend_own'] = 0;
        $summary['recommend_externalize'] = 0;
        $summary['recommend_break_even'] = 0;
        $summary['unavailable'] = 0;
        foreach ($evaluatedLineas as $linea) {
            $effectiveRecommendation = $plan['line_recommendations'][$linea['id']] ?? ($linea['gls_recommendation'] ?? 'unavailable');
            if ($effectiveRecommendation === 'own_route') {
                $summary['recommend_own']++;
            } elseif ($effectiveRecommendation === 'externalize') {
                $summary['recommend_externalize']++;
            } elseif ($effectiveRecommendation === 'break_even') {
                $summary['recommend_break_even']++;
            } else {
                $summary['unavailable']++;
            }
        }

        $totalRouteCost = (float) $summary['total_route_cost'];
        $totalGlsAllClients = (float) $summary['total_gls_all_clients'];
        if ($totalRouteCost <= 0 || $totalGlsAllClients <= 0) {
            $summary['global_recommendation'] = 'unavailable';
            $summary['global_savings'] = 0.0;
        } elseif ($totalGlsAllClients < ($totalRouteCost * 0.95)) {
            $summary['global_recommendation'] = 'externalize_all';
            $summary['global_savings'] = round(max(0.0, $totalRouteCost - $totalGlsAllClients), 4);
        } elseif ($totalGlsAllClients > ($totalRouteCost * 1.05)) {
            $summary['global_recommendation'] = 'do_route';
            $summary['global_savings'] = round(max(0.0, $totalGlsAllClients - $totalRouteCost), 4);
        } else {
            $summary['global_recommendation'] = 'mixed';
            $summary['global_savings'] = 0.0;
        }

        // Optimizacion combinatoria/greedy SOLO en caso mixto
        $summary['optimization_used'] = null;
        $summary['optimal_combo'] = [];
        $summary['optimal_total_cost'] = 0.0;
        $summary['optimal_fleet_cost'] = 0.0;
        $summary['optimal_gls_cost'] = 0.0;
        if ($summary['global_recommendation'] === 'mixed' && $depot && $vehicleCostPerKm !== null) {
            // Construir pool de candidatos: lineas con coords validas y coste GLS conocido
            $optCandidates = [];
            $glsCostByLinea = [];
            foreach ($evaluatedLineas as $idx => $eval) {
                $hasCoords = $eval['client_x'] !== null && $eval['client_y'] !== null
                    && $eval['client_x'] !== '' && $eval['client_y'] !== '';
                $hasGls = $eval['cost_gls_adjusted'] !== null;
                if (!$hasCoords || !$hasGls) {
                    continue;
                }
                $glsCostByLinea[count($optCandidates)] = (float) $eval['cost_gls_adjusted'];
                $optCandidates[] = $lineas[$idx];
            }
            $n = count($optCandidates);

            $optResult = null;
            if ($n > 0 && $n <= 15) {
                $optResult = $this->optimizeCombinatorial($optCandidates, $depot, $vehicleCostPerKm, $glsCostByLinea);
            } elseif ($n > 15 && $n <= 100) {
                $optResult = $this->optimizeGreedy($optCandidates, $depot, $vehicleCostPerKm, $glsCostByLinea);
            }

            if ($optResult !== null) {
                $summary['optimization_used'] = $optResult['optimization_used'];
                $summary['optimal_combo'] = $optResult['optimal_combo'];
                $summary['optimal_total_cost'] = $optResult['optimal_total_cost'];
                $summary['optimal_fleet_cost'] = $optResult['optimal_fleet_cost'];
                $summary['optimal_gls_cost'] = $optResult['optimal_gls_cost'];

                // Sobrescribir line_recommendations con sufijo _optimal solo para los candidatos
                $externalizedSet = array_flip(array_map('intval', $optResult['externalize_linea_ids']));
                foreach ($optCandidates as $cand) {
                    $lid = (int) $cand['id'];
                    $summary['line_recommendations'][$lid] = isset($externalizedSet[$lid])
                        ? 'externalize_optimal'
                        : 'own_route_optimal';
                }
            }
        }

        $summary['osrm_warning'] = $this->lastOsrmWarning;

        return $summary;
    }

    /** Registra si OSRM uso fallback haversine durante el calculo */
    private function trackOsrmStatus(?string $status): void
    {
        if ($status === null || $status === 'ok') {
            return;
        }
        // El peor estado gana
        if ($this->lastOsrmWarning === 'fallback_haversine') {
            return; // ya estamos en el peor estado
        }
        $this->lastOsrmWarning = $status;
    }

    private function buildEvaluatedLinea(array $linea, array $computed): array
    {
        return [
            'id' => (int) ($linea['id'] ?? 0),
            'client_id' => (int) ($linea['client_id'] ?? 0),
            'client_x' => $linea['client_x'] ?? null,
            'client_y' => $linea['client_y'] ?? null,
            'detour_km' => array_key_exists('detour_km', $computed) ? $computed['detour_km'] : null,
            'cost_own_route' => array_key_exists('cost_own_route', $computed) ? $computed['cost_own_route'] : null,
            'cost_gls_adjusted' => array_key_exists('cost_gls_adjusted', $computed) ? $computed['cost_gls_adjusted'] : null,
            'gls_recommendation' => $computed['gls_recommendation'] ?? 'unavailable',
            'gls_notes' => $computed['gls_notes'] ?? '',
        ];
    }

    private function calculateOptimalRoutePlan(array $lineas, ?array $depot, ?float $vehicleCostPerKm, float $fullRouteCost): array
    {
        $defaultLineRecommendations = [];
        foreach ($lineas as $linea) {
            $defaultLineRecommendations[(int) $linea['id']] = $linea['gls_recommendation'] ?? 'unavailable';
        }

        $default = [
            'mode' => 'unavailable',
            'route_cost' => 0.0,
            'gls_cost' => 0.0,
            'total_cost' => 0.0,
            'savings' => 0.0,
            'line_recommendations' => $defaultLineRecommendations,
            'line_recommendation_notes' => [],
        ];

        if (!$depot || $vehicleCostPerKm === null || empty($lineas)) {
            return $default;
        }

        $points = [[
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ]];
        $pointIndexByPos = [0 => 0];
        $routeCapablePositions = [];
        $prefixForcedKeep = [0 => 0];
        $prefixGls = [0 => 0.0];

        foreach ($lineas as $idx => $linea) {
            $pos = $idx + 1;
            $hasCoords = $this->lineHasCoords($linea);
            $hasGls = $linea['cost_gls_adjusted'] !== null;
            $forcedKeep = !$hasGls;

            $prefixForcedKeep[$pos] = $prefixForcedKeep[$pos - 1] + ($forcedKeep ? 1 : 0);
            $prefixGls[$pos] = $prefixGls[$pos - 1] + ($hasGls ? (float) $linea['cost_gls_adjusted'] : 0.0);

            if (!$hasCoords && !$hasGls) {
                return $default;
            }
            if ($forcedKeep && !$hasCoords) {
                return $default;
            }

            if ($hasCoords) {
                $pointIndexByPos[$pos] = count($points);
                $points[] = [
                    'lat' => (float) $linea['client_x'],
                    'lng' => (float) $linea['client_y'],
                ];
                $routeCapablePositions[] = $pos;
            }
        }

        $matrixResult = $this->distanceCache->buildMatrix($points);
        $matrix = $matrixResult['distances'] ?? [];
        $this->trackOsrmStatus($matrixResult['osrm_status'] ?? null);
        if (empty($matrix)) {
            return $default;
        }

        $endPos = count($lineas) + 1;
        $candidateNodes = array_merge([0], $routeCapablePositions, [$endPos]);
        $dp = [];
        $prev = [];
        foreach ($candidateNodes as $node) {
            $dp[$node] = INF;
            $prev[$node] = null;
        }
        $dp[0] = 0.0;

        $candidateCount = count($candidateNodes);
        for ($i = 0; $i < $candidateCount; $i++) {
            $fromPos = $candidateNodes[$i];
            if (!is_finite($dp[$fromPos])) {
                continue;
            }

            for ($j = $i + 1; $j < $candidateCount; $j++) {
                $toPos = $candidateNodes[$j];
                $skipStart = $fromPos + 1;
                $skipEnd = $toPos === $endPos ? count($lineas) : ($toPos - 1);
                if ($skipStart <= $skipEnd) {
                    $forcedKeepSkipped = $prefixForcedKeep[$skipEnd] - $prefixForcedKeep[$skipStart - 1];
                    if ($forcedKeepSkipped > 0) {
                        continue;
                    }
                }

                $glsSkipped = $skipStart <= $skipEnd
                    ? ($prefixGls[$skipEnd] - $prefixGls[$skipStart - 1])
                    : 0.0;

                $travelKm = $this->getPlanTravelKm($matrix, $pointIndexByPos, $fromPos, $toPos, $endPos);
                $edgeCost = round(($travelKm * $vehicleCostPerKm) + $glsSkipped, 4);
                $candidateCost = round($dp[$fromPos] + $edgeCost, 4);
                if ($candidateCost < $dp[$toPos]) {
                    $dp[$toPos] = $candidateCost;
                    $prev[$toPos] = $fromPos;
                }
            }
        }

        if (!is_finite($dp[$endPos])) {
            return $default;
        }

        $keptPositions = [];
        $cursor = $endPos;
        while ($cursor !== null && $cursor !== 0) {
            if ($cursor !== $endPos) {
                $keptPositions[$cursor] = true;
            }
            $cursor = $prev[$cursor];
        }
        ksort($keptPositions);

        $routeCost = 0.0;
        $prevPos = 0;
        foreach (array_keys($keptPositions) as $pos) {
            $routeCost += $this->getPlanTravelKm($matrix, $pointIndexByPos, $prevPos, (int) $pos, $endPos) * $vehicleCostPerKm;
            $prevPos = (int) $pos;
        }
        if (!empty($keptPositions)) {
            $routeCost += $this->getPlanTravelKm($matrix, $pointIndexByPos, $prevPos, $endPos, $endPos) * $vehicleCostPerKm;
        }
        $routeCost = round($routeCost, 4);

        $glsCost = 0.0;
        $effectiveRecommendations = [];
        foreach ($lineas as $idx => $linea) {
            $pos = $idx + 1;
            $hasCoords = $this->lineHasCoords($linea);
            $hasGls = $linea['cost_gls_adjusted'] !== null;
            $lineaId = (int) $linea['id'];

            if (!$hasCoords && !$hasGls) {
                $effectiveRecommendations[$lineaId] = 'unavailable';
                continue;
            }
            if (isset($keptPositions[$pos]) || ($hasCoords && !$hasGls)) {
                $effectiveRecommendations[$lineaId] = 'own_route';
                continue;
            }
            if ($hasGls) {
                $effectiveRecommendations[$lineaId] = 'externalize';
                $glsCost += (float) $linea['cost_gls_adjusted'];
                continue;
            }
            $effectiveRecommendations[$lineaId] = 'unavailable';
        }
        $glsCost = round($glsCost, 4);
        $totalCost = round($routeCost + $glsCost, 4);
        $externalized = count(array_filter($effectiveRecommendations, fn ($rec) => $rec === 'externalize'));
        $owned = count(array_filter($effectiveRecommendations, fn ($rec) => $rec === 'own_route'));

        $mode = 'mixed';
        if ($externalized > 0 && $owned === 0) {
            $mode = 'externalize_all';
        } elseif ($owned > 0 && $externalized === 0) {
            $mode = 'do_route';
        }

        return [
            'mode' => $mode,
            'route_cost' => $routeCost,
            'gls_cost' => $glsCost,
            'total_cost' => $totalCost,
            'savings' => round(max(0.0, $fullRouteCost - $totalCost), 4),
            'line_recommendations' => $effectiveRecommendations,
            'line_recommendation_notes' => $this->buildPlanRecommendationNotes($lineas, $effectiveRecommendations, $mode),
        ];
    }

    private function buildPlanRecommendationNotes(array $lineas, array $effectiveRecommendations, string $mode): array
    {
        $notes = [];
        foreach ($lineas as $linea) {
            $lineaId = (int) $linea['id'];
            $effective = $effectiveRecommendations[$lineaId] ?? 'unavailable';
            $marginal = $linea['gls_recommendation'] ?? 'unavailable';
            if ($effective === $marginal) {
                continue;
            }
            if ($mode === 'externalize_all' && $effective === 'externalize') {
                $notes[$lineaId] = 'La hoja completa sale mejor por paqueteria';
            } elseif ($mode === 'mixed') {
                $notes[$lineaId] = 'Ajustado por el plan optimo de la hoja';
            }
        }

        return $notes;
    }

    private function getPlanTravelKm(array $matrix, array $pointIndexByPos, int $fromPos, int $toPos, int $endPos): float
    {
        if ($fromPos === 0 && $toPos === $endPos) {
            return 0.0;
        }

        $fromPoint = $pointIndexByPos[$fromPos] ?? 0;
        $toPoint = $toPos === $endPos ? 0 : ($pointIndexByPos[$toPos] ?? 0);
        return (float) ($matrix[$fromPoint][$toPoint] ?? 0.0);
    }

    private function lineHasCoords(array $linea): bool
    {
        return $linea['client_x'] !== null
            && $linea['client_y'] !== null
            && $linea['client_x'] !== ''
            && $linea['client_y'] !== '';
    }

    private function getActiveOrderedLineas(array $lineas): array
    {
        $active = array_values(array_filter($lineas, function ($linea) {
            return (float) ($linea['carros'] ?? 0) > 0 || (float) ($linea['cajas'] ?? 0) > 0;
        }));

        usort($active, function ($a, $b) {
            $orderA = isset($a['orden_descarga']) && $a['orden_descarga'] !== null ? (int) $a['orden_descarga'] : 999999;
            $orderB = isset($b['orden_descarga']) && $b['orden_descarga'] !== null ? (int) $b['orden_descarga'] : 999999;
            if ($orderA === $orderB) {
                return (int) $a['id'] <=> (int) $b['id'];
            }
            return $orderA <=> $orderB;
        });

        return $active;
    }

    private function calculateDetourKmFromLineas(int $clientId, array $lineas, ?array $depot): ?float
    {
        if (!$depot) {
            return null;
        }

        $withClient = $this->buildRoutePointSequence($lineas, $depot);
        if ($withClient === null) {
            return null;
        }

        $withoutClientLineas = array_values(array_filter($lineas, fn ($linea) => (int) $linea['client_id'] !== $clientId));
        $withoutClient = $this->buildRoutePointSequence($withoutClientLineas, $depot, true);
        if ($withoutClient === null) {
            return null;
        }

        $withDistance = $this->calculateSequenceDistance($withClient);
        $withoutDistance = $this->calculateSequenceDistance($withoutClient);

        return round(max(0.0, $withDistance - $withoutDistance), 3);
    }

    /** Delegado a RouteOptimizer */
    private function buildRoutePointSequence(array $lineas, array $depot, bool $allowEmpty = false): ?array
    {
        return $this->routeOptimizer->buildRoutePointSequence($lineas, $depot, $allowEmpty);
    }

    /** Delegado a RouteOptimizer */
    private function calculateSequenceDistance(array $points): float
    {
        return $this->routeOptimizer->calculateSequenceDistance($points);
    }

    private function resolveDepotForHoja(array $hoja): ?array
    {
        if (!empty($hoja['vehicle_id'])) {
            $vehicle = $this->vehicleModel->getById((int) $hoja['vehicle_id']);
            if ($vehicle && !empty($vehicle['delegation_id'])) {
                $delegation = $this->delegationModel->getById((int) $vehicle['delegation_id']);
                if ($delegation && $delegation['x'] !== null && $delegation['y'] !== null) {
                    return $delegation;
                }
            }
        }

        $fallback = $this->hojaModel->getDelegationForHoja((int) $hoja['id']);
        if ($fallback && $fallback['x'] !== null && $fallback['y'] !== null) {
            return $fallback;
        }

        return null;
    }

    private function resolveRecommendation(float $costOwnRoute, float $costGlsAdjusted): string
    {
        $threshold = $costGlsAdjusted * 0.05;
        if (abs($costOwnRoute - $costGlsAdjusted) <= $threshold) {
            return 'break_even';
        }

        return $costOwnRoute <= $costGlsAdjusted ? 'own_route' : 'externalize';
    }

    private function lineHasComputedCosts(array $linea): bool
    {
        return $linea['detour_km'] !== null
            && $linea['gls_recommendation'] !== null
            && (
                $linea['cost_own_route'] !== null
                || $linea['cost_gls_adjusted'] !== null
                || !empty($linea['gls_notes'])
            );
    }

    /**
     * Recorre los indices de la matriz en orden (depot=0 -> idx1 -> idx2 -> ... -> depot)
     * y devuelve los km totales. Si la flota va vacia devuelve 0.
     */
    /** Delegado a RouteOptimizer */
    private function computeRouteKmFromMatrix(array $matrix, array $orderedFleetIndices): float
    {
        return $this->routeOptimizer->computeRouteKmFromMatrix($matrix, $orderedFleetIndices);
    }

    /**
     * Busqueda combinatoria exacta 2^N. Devuelve null si N > 15.
     * $glsCostByLinea: array indexado por la posicion en $lineas (0..N-1).
     */
    private function optimizeCombinatorial(array $lineas, array $depot, float $vehicleCostPerKm, array $glsCostByLinea): ?array
    {
        $n = count($lineas);
        if ($n > 15) {
            return null;
        }
        if ($n === 0) {
            return [
                'optimization_used' => 'combinatorial',
                'optimal_combo' => [],
                'optimal_total_cost' => 0.0,
                'optimal_fleet_cost' => 0.0,
                'optimal_gls_cost' => 0.0,
                'externalize_linea_ids' => [],
            ];
        }

        // Matriz: 0 = depot, 1..N = clientes en orden de descarga
        $points = [[
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ]];
        foreach ($lineas as $linea) {
            $points[] = [
                'lat' => (float) $linea['client_x'],
                'lng' => (float) $linea['client_y'],
            ];
        }
        $matrixResult = $this->distanceCache->buildMatrix($points);
        $matrix = $matrixResult['distances'] ?? [];
        $this->trackOsrmStatus($matrixResult['osrm_status'] ?? null);
        if (empty($matrix)) {
            return null;
        }

        $best = null;
        $combos = 1 << $n; // 2^N
        for ($mask = 0; $mask < $combos; $mask++) {
            $inFleetIdx = [];
            $glsCost = 0.0;
            $externalizedLineaIds = [];
            for ($i = 0; $i < $n; $i++) {
                if (($mask >> $i) & 1) {
                    // bit puesto = externalizar
                    $glsCost += $glsCostByLinea[$i];
                    $externalizedLineaIds[] = (int) $lineas[$i]['id'];
                } else {
                    $inFleetIdx[] = $i + 1;
                }
            }
            $fleetKm = $this->computeRouteKmFromMatrix($matrix, $inFleetIdx);
            $fleetCost = $fleetKm * $vehicleCostPerKm;
            $total = $fleetCost + $glsCost;
            if ($best === null || $total < $best['optimal_total_cost']) {
                $best = [
                    'optimization_used' => 'combinatorial',
                    'optimal_combo' => $externalizedLineaIds,
                    'optimal_total_cost' => round($total, 4),
                    'optimal_fleet_cost' => round($fleetCost, 4),
                    'optimal_gls_cost' => round($glsCost, 4),
                    'externalize_linea_ids' => $externalizedLineaIds,
                ];
            }
        }

        return $best;
    }

    /**
     * Heuristica voraz iterativa. Externaliza de uno en uno el cliente que mas
     * ahorra hasta que ningun movimiento adicional sea rentable.
     */
    private function optimizeGreedy(array $lineas, array $depot, float $vehicleCostPerKm, array $glsCostByLinea): array
    {
        $n = count($lineas);
        if ($n === 0) {
            return [
                'optimization_used' => 'greedy',
                'optimal_combo' => [],
                'optimal_total_cost' => 0.0,
                'optimal_fleet_cost' => 0.0,
                'optimal_gls_cost' => 0.0,
                'externalize_linea_ids' => [],
                'iterations' => 0,
            ];
        }

        $points = [[
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ]];
        foreach ($lineas as $linea) {
            $points[] = [
                'lat' => (float) $linea['client_x'],
                'lng' => (float) $linea['client_y'],
            ];
        }
        $matrixResult = $this->distanceCache->buildMatrix($points);
        $matrix = $matrixResult['distances'] ?? [];
        $this->trackOsrmStatus($matrixResult['osrm_status'] ?? null);
        if (empty($matrix)) {
            return null;
        }

        // Estado inicial: todos en flota
        $inFleet = [];
        for ($i = 0; $i < $n; $i++) {
            $inFleet[$i] = true;
        }
        $externalized = [];
        $glsExternalizedCost = 0.0;

        $currentFleetIdx = [];
        for ($i = 0; $i < $n; $i++) {
            $currentFleetIdx[] = $i + 1;
        }
        $currentFleetKm = $this->computeRouteKmFromMatrix($matrix, $currentFleetIdx);
        $currentFleetCost = $currentFleetKm * $vehicleCostPerKm;
        $currentTotal = $currentFleetCost; // 0 externalizados al inicio

        $iterations = 0;
        while (!empty($inFleet)) {
            $bestSavings = 0.0;
            $bestI = null;
            $bestTotal = null;
            $bestFleetCost = null;
            $bestGlsCost = null;

            foreach (array_keys($inFleet) as $i) {
                $iterations++;
                $simFleetIdx = [];
                for ($j = 0; $j < $n; $j++) {
                    if ($j !== $i && isset($inFleet[$j])) {
                        $simFleetIdx[] = $j + 1;
                    }
                }
                $simFleetKm = $this->computeRouteKmFromMatrix($matrix, $simFleetIdx);
                $simFleetCost = $simFleetKm * $vehicleCostPerKm;
                $simGlsCost = $glsExternalizedCost + $glsCostByLinea[$i];
                $simTotal = $simFleetCost + $simGlsCost;
                $savings = $currentTotal - $simTotal;

                if ($savings > $bestSavings + 1e-9) {
                    $bestSavings = $savings;
                    $bestI = $i;
                    $bestTotal = $simTotal;
                    $bestFleetCost = $simFleetCost;
                    $bestGlsCost = $simGlsCost;
                }
            }

            if ($bestI === null) {
                break;
            }

            unset($inFleet[$bestI]);
            $externalized[] = $bestI;
            $glsExternalizedCost = $bestGlsCost;
            $currentTotal = $bestTotal;
            $currentFleetCost = $bestFleetCost;
        }

        $externalizedLineaIds = array_map(fn ($i) => (int) $lineas[$i]['id'], $externalized);
        return [
            'optimization_used' => 'greedy',
            'optimal_combo' => $externalizedLineaIds,
            'optimal_total_cost' => round($currentTotal, 4),
            'optimal_fleet_cost' => round($currentFleetCost, 4),
            'optimal_gls_cost' => round($glsExternalizedCost, 4),
            'externalize_linea_ids' => $externalizedLineaIds,
            'iterations' => $iterations,
        ];
    }

    /**
     * Simulador del coste de la flota para un subconjunto concreto de clientes.
     * Filtra las lineas de la hoja por los client_ids dados, calcula la
     * distancia depot -> clientes (en el orden actual de la hoja) -> depot
     * usando el cache OSRM y devuelve fleet_km y fleet_cost.
     */
    public function simulateRouteForClients(int $hojaId, array $clientIds): array
    {
        $hoja = $this->hojaModel->getById($hojaId);
        if (!$hoja) {
            return ['error' => 'Hoja no encontrada', 'fleet_km' => 0.0, 'fleet_cost' => 0.0];
        }

        $vehicle = !empty($hoja['vehicle_id']) ? $this->vehicleModel->getById((int) $hoja['vehicle_id']) : null;
        $vehicleCostPerKm = $vehicle && $vehicle['cost_per_km'] !== null ? (float) $vehicle['cost_per_km'] : 0.0;
        $depot = $this->resolveDepotForHoja($hoja);
        if (!$depot) {
            return ['error' => 'Sin depot', 'fleet_km' => 0.0, 'fleet_cost' => 0.0];
        }

        $allLineas = $this->getActiveOrderedLineas($hoja['lineas'] ?? []);
        $clientIdSet = array_flip(array_map('intval', $clientIds));
        $filteredLineas = array_values(array_filter(
            $allLineas,
            fn ($linea) => isset($clientIdSet[(int) $linea['client_id']])
        ));

        if (empty($filteredLineas)) {
            return [
                'fleet_km' => 0.0,
                'fleet_cost' => 0.0,
                'vehicle_cost_per_km' => $vehicleCostPerKm,
            ];
        }

        $sequence = $this->buildRoutePointSequence($filteredLineas, $depot, true);
        if ($sequence === null) {
            return ['error' => 'No se pudo construir la secuencia (faltan coordenadas)', 'fleet_km' => 0.0, 'fleet_cost' => 0.0];
        }

        $fleetKm = $this->calculateSequenceDistance($sequence);
        $fleetCost = round($fleetKm * $vehicleCostPerKm, 4);

        return [
            'fleet_km' => round($fleetKm, 3),
            'fleet_cost' => $fleetCost,
            'vehicle_cost_per_km' => $vehicleCostPerKm,
        ];
    }
}

<?php

require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../models/Vehicle.php';
require_once __DIR__ . '/../models/Delegation.php';
require_once __DIR__ . '/../models/DistanceCache.php';
require_once __DIR__ . '/../models/GlsShippingConfig.php';
require_once __DIR__ . '/../models/ClientCostHistory.php';
require_once __DIR__ . '/../models/ShippingRateTable.php';

class RouteCostCalculator
{
    private HojaRuta $hojaModel;
    private Vehicle $vehicleModel;
    private Delegation $delegationModel;
    private DistanceCache $distanceCache;
    private GlsShippingConfig $configModel;
    private ClientCostHistory $historyModel;
    private ShippingRateTable $shippingRateModel;

    public function __construct()
    {
        $this->hojaModel = new HojaRuta();
        $this->vehicleModel = new Vehicle();
        $this->delegationModel = new Delegation();
        $this->distanceCache = new DistanceCache();
        $this->configModel = new GlsShippingConfig();
        $this->historyModel = new ClientCostHistory();
        $this->shippingRateModel = new ShippingRateTable();
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
            'potential_savings_if_externalized' => 0.0,
        ];

        foreach ($lineas as $linea) {
            if (!$forceRecalc && $this->lineHasComputedCosts($linea)) {
                $summary['skipped_cached']++;
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
                    ]
                );

                if ($bestRate) {
                    $costCarrierRaw = round((float) ($bestRate['price'] ?? 0), 4);
                    $costCarrierAdjusted = $costCarrierRaw;
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
                $summary['total_own_cost'] += $costOwnRoute;
                $summary['total_gls_cost'] += $costCarrierAdjusted;
                if ($saving > 0) {
                    $summary['potential_savings_if_externalized'] += $saving;
                }
            }

            if ($recommendation === 'own_route') {
                $summary['recommend_own']++;
            } elseif ($recommendation === 'externalize') {
                $summary['recommend_externalize']++;
            } elseif ($recommendation === 'break_even') {
                $summary['recommend_break_even']++;
            } else {
                $summary['unavailable']++;
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
                'detour_km' => $detourKm ?? 0,
                'vehicle_cost_per_km' => $vehicleCostPerKm ?? 0,
                'cost_own_route' => $costOwnRoute ?? 0,
                'cost_gls_raw' => $costCarrierRaw ?? 0,
                'cost_gls_adjusted' => $costCarrierAdjusted ?? 0,
                'price_multiplier_used' => 1,
                'recommendation' => $recommendation,
                'savings_if_externalized' => $saving,
                'gls_service' => $carrierService,
                'notes' => $notes,
            ]);

            $summary['processed']++;
        }

        $summary['total_own_cost'] = round($summary['total_own_cost'], 4);
        $summary['total_gls_cost'] = round($summary['total_gls_cost'], 4);
        $summary['potential_savings_if_externalized'] = round($summary['potential_savings_if_externalized'], 4);

        return $summary;
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

    private function buildRoutePointSequence(array $lineas, array $depot, bool $allowEmpty = false): ?array
    {
        $points = [[
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ]];

        foreach ($lineas as $linea) {
            if (empty($linea['client_x']) || empty($linea['client_y'])) {
                if ((float) ($linea['carros'] ?? 0) > 0 || (float) ($linea['cajas'] ?? 0) > 0) {
                    return null;
                }
                continue;
            }

            $points[] = [
                'lat' => (float) $linea['client_x'],
                'lng' => (float) $linea['client_y'],
            ];
        }

        if (!$allowEmpty && count($points) === 1) {
            return null;
        }

        $points[] = [
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ];

        return $points;
    }

    private function calculateSequenceDistance(array $points): float
    {
        if (count($points) < 2) {
            return 0.0;
        }

        $distanceKm = 0.0;
        for ($i = 0, $max = count($points) - 1; $i < $max; $i++) {
            $a = $points[$i];
            $b = $points[$i + 1];

            if ($a['lat'] === $b['lat'] && $a['lng'] === $b['lng']) {
                continue;
            }

            $segment = $this->distanceCache->getOrFetch($a['lat'], $a['lng'], $b['lat'], $b['lng']);
            $distanceKm += (float) ($segment['distance_km'] ?? 0);
        }

        return round($distanceKm, 3);
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
}

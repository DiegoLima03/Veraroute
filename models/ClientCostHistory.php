<?php

require_once __DIR__ . '/../core/Model.php';

class ClientCostHistory extends Model
{
    public function upsert(array $data): bool
    {
        $this->query(
            'INSERT INTO client_cost_history (
                client_id, hoja_ruta_id, route_plan_id, fecha, carros, cajas, weight_kg, num_parcels,
                detour_km, vehicle_cost_per_km, cost_own_route, cost_gls_raw, cost_gls_adjusted,
                price_multiplier_used, recommendation, savings_if_externalized, gls_service, notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                route_plan_id = VALUES(route_plan_id),
                carros = VALUES(carros),
                cajas = VALUES(cajas),
                weight_kg = VALUES(weight_kg),
                num_parcels = VALUES(num_parcels),
                detour_km = VALUES(detour_km),
                vehicle_cost_per_km = VALUES(vehicle_cost_per_km),
                cost_own_route = VALUES(cost_own_route),
                cost_gls_raw = VALUES(cost_gls_raw),
                cost_gls_adjusted = VALUES(cost_gls_adjusted),
                price_multiplier_used = VALUES(price_multiplier_used),
                recommendation = VALUES(recommendation),
                savings_if_externalized = VALUES(savings_if_externalized),
                gls_service = VALUES(gls_service),
                notes = VALUES(notes),
                calculated_at = CURRENT_TIMESTAMP',
            [
                (int) $data['client_id'],
                !empty($data['hoja_ruta_id']) ? (int) $data['hoja_ruta_id'] : null,
                !empty($data['route_plan_id']) ? (int) $data['route_plan_id'] : null,
                $data['fecha'],
                (float) ($data['carros'] ?? 0),
                (float) ($data['cajas'] ?? 0),
                (float) ($data['weight_kg'] ?? 0),
                max(1, (int) ($data['num_parcels'] ?? 1)),
                (float) ($data['detour_km'] ?? 0),
                (float) ($data['vehicle_cost_per_km'] ?? 0),
                (float) ($data['cost_own_route'] ?? 0),
                (float) ($data['cost_gls_raw'] ?? 0),
                (float) ($data['cost_gls_adjusted'] ?? 0),
                (float) ($data['price_multiplier_used'] ?? 1),
                $data['recommendation'] ?? 'unavailable',
                (float) ($data['savings_if_externalized'] ?? 0),
                $data['gls_service'] ?? '',
                $data['notes'] ?? '',
            ]
        );

        return true;
    }

    public function getForClient(int $clientId, int $limit = 30): array
    {
        $limit = max(1, (int) $limit);
        return $this->normalizeTextRows(
            $this->query(
                "SELECT cch.*, r.name AS ruta_name, v.name AS vehicle_name, v.plate AS vehicle_plate
                 FROM client_cost_history cch
                 LEFT JOIN hojas_ruta hr ON hr.id = cch.hoja_ruta_id
                 LEFT JOIN rutas r ON r.id = hr.ruta_id
                 LEFT JOIN vehicles v ON v.id = hr.vehicle_id
                 WHERE cch.client_id = ?
                 ORDER BY cch.fecha DESC, cch.calculated_at DESC
                 LIMIT {$limit}",
                [$clientId]
            )->fetchAll()
        );
    }

    public function getForDate(string $date): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cch.*, c.name AS client_name, c.postcode AS client_postcode,
                        hr.ruta_id, r.name AS ruta_name,
                        hr.vehicle_id, v.name AS vehicle_name, v.plate AS vehicle_plate,
                        (cch.cost_own_route - cch.cost_gls_adjusted) AS savings
                 FROM client_cost_history cch
                 JOIN clients c ON c.id = cch.client_id
                 LEFT JOIN hojas_ruta hr ON hr.id = cch.hoja_ruta_id
                 LEFT JOIN rutas r ON r.id = hr.ruta_id
                 LEFT JOIN vehicles v ON v.id = hr.vehicle_id
                 WHERE cch.fecha = ?
                 ORDER BY r.name, c.name',
                [$date]
            )->fetchAll()
        );
    }

    public function getForHoja(int $hojaRutaId): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cch.*, c.name AS client_name, c.postcode AS client_postcode
                 FROM client_cost_history cch
                 JOIN clients c ON c.id = cch.client_id
                 WHERE cch.hoja_ruta_id = ?
                 ORDER BY c.name',
                [$hojaRutaId]
            )->fetchAll()
        );
    }

    public function getDailySummary(string $date): array
    {
        $rows = $this->getForDate($date);
        $summary = [
            'date' => $date,
            'total_clients' => count($rows),
            'clients_no_postcode' => 0,
            'clients_gls_error' => 0,
            'recommend_own_route' => 0,
            'recommend_externalize' => 0,
            'recommend_break_even' => 0,
            'recommend_unavailable' => 0,
            'total_cost_own_all' => 0.0,
            'total_cost_gls_all' => 0.0,
            'potential_savings' => 0.0,
            'last_calculated_at' => null,
            'lines' => $rows,
        ];

        foreach ($rows as $row) {
            $notes = (string) ($row['notes'] ?? '');
            $recommendation = (string) ($row['recommendation'] ?? 'unavailable');
            $costOwn = (float) ($row['cost_own_route'] ?? 0);
            $costGls = (float) ($row['cost_gls_adjusted'] ?? 0);
            $saving = max(0.0, (float) ($row['savings_if_externalized'] ?? 0));

            if ($notes === 'postcode_missing' || trim((string) ($row['client_postcode'] ?? '')) === '') {
                $summary['clients_no_postcode']++;
            }
            if (str_starts_with($notes, 'gls_error:')) {
                $summary['clients_gls_error']++;
            }

            if ($recommendation === 'own_route') {
                $summary['recommend_own_route']++;
            } elseif ($recommendation === 'externalize') {
                $summary['recommend_externalize']++;
            } elseif ($recommendation === 'break_even') {
                $summary['recommend_break_even']++;
            } else {
                $summary['recommend_unavailable']++;
            }

            $summary['total_cost_own_all'] += $costOwn;
            $summary['total_cost_gls_all'] += $costGls;
            $summary['potential_savings'] += $saving;

            if (!empty($row['calculated_at']) && ($summary['last_calculated_at'] === null || $row['calculated_at'] > $summary['last_calculated_at'])) {
                $summary['last_calculated_at'] = $row['calculated_at'];
            }
        }

        return $summary;
    }
}

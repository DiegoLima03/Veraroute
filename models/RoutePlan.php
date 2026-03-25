<?php

require_once __DIR__ . '/../core/Model.php';

class RoutePlan extends Model
{
    public function getByDate(string $date)
    {
        $plans = $this->query(
            'SELECT rp.*, v.name AS vehicle_name, v.plate, d.name AS delegation_name, d.x AS delegation_x, d.y AS delegation_y
             FROM route_plans rp
             JOIN vehicles v ON rp.vehicle_id = v.id
             JOIN delegations d ON rp.delegation_id = d.id
             WHERE rp.plan_date = ?
             ORDER BY v.name',
            [$date]
        )->fetchAll();

        foreach ($plans as &$plan) {
            $plan['stops'] = $this->query(
                'SELECT rs.*, c.name AS client_name, c.address, c.x, c.y
                 FROM route_stops rs
                 JOIN clients c ON rs.client_id = c.id
                 WHERE rs.route_plan_id = ?
                 ORDER BY rs.stop_order',
                [$plan['id']]
            )->fetchAll();
        }

        return $plans;
    }

    public function getById(int $id)
    {
        $plan = $this->query(
            'SELECT rp.*, v.name AS vehicle_name, v.plate, d.name AS delegation_name, d.x AS delegation_x, d.y AS delegation_y
             FROM route_plans rp
             JOIN vehicles v ON rp.vehicle_id = v.id
             JOIN delegations d ON rp.delegation_id = d.id
             WHERE rp.id = ?',
            [$id]
        )->fetch();

        if (!$plan) return null;

        $plan['stops'] = $this->query(
            'SELECT rs.*, c.name AS client_name, c.address, c.x, c.y
             FROM route_stops rs
             JOIN clients c ON rs.client_id = c.id
             WHERE rs.route_plan_id = ?
             ORDER BY rs.stop_order',
            [$plan['id']]
        )->fetchAll();

        return $plan;
    }

    public function calculateUnloadTime(int $orderId, float $baseMin = 5.0): float
    {
        $items = $this->query(
            'SELECT oi.quantity,
                    COALESCE(oi.unload_time_min, p.unload_time_min, 1.0) AS unit_time
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?',
            [$orderId]
        )->fetchAll();

        $time = $baseMin;
        foreach ($items as $item) {
            $time += (float) $item['quantity'] * (float) $item['unit_time'];
        }
        return $time;
    }

    public function calculateOrderLoad(int $orderId): array
    {
        $items = $this->query(
            'SELECT oi.quantity,
                    COALESCE(oi.weight_kg, p.weight_kg, 0) AS unit_weight,
                    COALESCE(oi.volume_m3, p.volume_m3, 0) AS unit_volume
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?',
            [$orderId]
        )->fetchAll();

        $totalWeight = 0;
        $totalVolume = 0;
        $totalItems = 0;
        foreach ($items as $item) {
            $qty = (int) $item['quantity'];
            $totalWeight += $qty * (float) $item['unit_weight'];
            $totalVolume += $qty * (float) $item['unit_volume'];
            $totalItems += $qty;
        }

        return [
            'weight_kg' => $totalWeight,
            'volume_m3' => $totalVolume,
            'items'     => $totalItems,
        ];
    }

    public function create(string $date, int $vehicleId, int $delegationId, array $stops, float $distKm, float $timeH, float $unloadMin): int
    {
        $db = $this->db();
        $db->beginTransaction();

        try {
            // Borrar plan anterior del mismo vehiculo y fecha
            $existing = $this->query(
                'SELECT id FROM route_plans WHERE plan_date = ? AND vehicle_id = ?',
                [$date, $vehicleId]
            )->fetch();

            if ($existing) {
                $this->query('DELETE FROM route_plans WHERE id = ?', [$existing['id']]);
            }

            $this->query(
                'INSERT INTO route_plans (plan_date, vehicle_id, delegation_id, total_distance_km, total_time_h, total_unload_min)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$date, $vehicleId, $delegationId, $distKm, $timeH, $unloadMin]
            );
            $planId = (int) $db->lastInsertId();

            foreach ($stops as $i => $stop) {
                $this->query(
                    'INSERT INTO route_stops (route_plan_id, stop_order, client_id, order_id, estimated_arrival, estimated_unload_min)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        $planId,
                        $i + 1,
                        $stop['client_id'],
                        $stop['order_id'] ?? null,
                        $stop['eta'] ?? null,
                        $stop['unload_min'] ?? 0,
                    ]
                );
            }

            $db->commit();
            return $planId;
        } catch (\Exception $e) {
            $db->rollBack();
            throw $e;
        }
    }

    public function updateStops(int $planId, array $stops, float $distKm, float $timeH, float $unloadMin): void
    {
        $db = $this->db();
        $db->beginTransaction();
        try {
            $this->query('DELETE FROM route_stops WHERE route_plan_id = ?', [$planId]);
            $this->query(
                'UPDATE route_plans SET total_distance_km = ?, total_time_h = ?, total_unload_min = ? WHERE id = ?',
                [$distKm, $timeH, $unloadMin, $planId]
            );
            foreach ($stops as $i => $stop) {
                $this->query(
                    'INSERT INTO route_stops (route_plan_id, stop_order, client_id, order_id, estimated_arrival, estimated_unload_min)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [$planId, $i + 1, $stop['client_id'], $stop['order_id'] ?? null, $stop['eta'] ?? null, $stop['unload_min'] ?? 0]
                );
            }
            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            throw $e;
        }
    }

    public function deleteByDate(string $date)
    {
        $this->query('DELETE FROM route_plans WHERE plan_date = ?', [$date]);
    }

    /** Historial de rutas agrupado por fecha */
    public function getHistory(string $from, string $to): array
    {
        $rows = $this->query(
            'SELECT rp.id, rp.plan_date, rp.status, rp.total_distance_km, rp.total_time_h, rp.total_unload_min,
                    v.name AS vehicle_name, v.plate,
                    d.name AS delegation_name,
                    (SELECT COUNT(*) FROM route_stops WHERE route_plan_id = rp.id) AS stop_count,
                    (SELECT COUNT(*) FROM route_stops WHERE route_plan_id = rp.id AND status = "completed") AS completed_count
             FROM route_plans rp
             JOIN vehicles v ON rp.vehicle_id = v.id
             JOIN delegations d ON rp.delegation_id = d.id
             WHERE rp.plan_date BETWEEN ? AND ?
             ORDER BY rp.plan_date DESC, v.name',
            [$from, $to]
        )->fetchAll();

        // Agrupar por fecha
        $grouped = [];
        foreach ($rows as $r) {
            $date = $r['plan_date'];
            if (!isset($grouped[$date])) {
                $grouped[$date] = ['date' => $date, 'routes' => [], 'total_km' => 0, 'total_h' => 0];
            }
            $grouped[$date]['routes'][] = $r;
            $grouped[$date]['total_km'] += (float) $r['total_distance_km'];
            $grouped[$date]['total_h']  += (float) $r['total_time_h'];
        }

        return array_values($grouped);
    }

    /** Actualizar status de una parada */
    public function updateStopStatus(int $planId, int $stopOrder, string $status): void
    {
        $this->query(
            'UPDATE route_stops SET status = ? WHERE route_plan_id = ? AND stop_order = ?',
            [$status, $planId, $stopOrder]
        );
    }

    /** Actualizar status de un plan */
    public function updatePlanStatus(int $planId, string $status): void
    {
        $this->query('UPDATE route_plans SET status = ? WHERE id = ?', [$status, $planId]);
    }

    /** Dashboard: estadisticas agregadas */
    public function getStats(string $from, string $to): array
    {
        $row = $this->query(
            'SELECT COUNT(DISTINCT plan_date) AS days,
                    COUNT(*) AS total_routes,
                    COALESCE(SUM(total_distance_km), 0) AS total_km,
                    COALESCE(SUM(total_time_h), 0) AS total_hours,
                    COALESCE(AVG(total_distance_km), 0) AS avg_km_per_route,
                    COALESCE(AVG(total_time_h), 0) AS avg_h_per_route
             FROM route_plans
             WHERE plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        $stopStats = $this->query(
            'SELECT COUNT(*) AS total_stops,
                    SUM(CASE WHEN rs.status = "completed" THEN 1 ELSE 0 END) AS completed_stops,
                    SUM(CASE WHEN rs.status = "skipped" THEN 1 ELSE 0 END) AS skipped_stops
             FROM route_stops rs
             JOIN route_plans rp ON rs.route_plan_id = rp.id
             WHERE rp.plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        // Coste estimado (cost_per_km de vehiculos)
        $costRow = $this->query(
            'SELECT COALESCE(SUM(rp.total_distance_km * COALESCE(v.cost_per_km, 0)), 0) AS total_cost
             FROM route_plans rp
             JOIN vehicles v ON rp.vehicle_id = v.id
             WHERE rp.plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        return array_merge($row, $stopStats, ['total_cost' => (float) $costRow['total_cost']]);
    }
}

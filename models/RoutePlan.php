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

    public function calculateUnloadTime(int $orderId): float
    {
        $items = $this->query(
            'SELECT oi.quantity,
                    COALESCE(oi.unload_time_min, p.unload_time_min, 1.0) AS unit_time
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?',
            [$orderId]
        )->fetchAll();

        $time = 5.0; // base: parking, saludo, papeles
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

    public function deleteByDate(string $date)
    {
        $this->query('DELETE FROM route_plans WHERE plan_date = ?', [$date]);
    }
}

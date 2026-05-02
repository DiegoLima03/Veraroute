<?php

require_once __DIR__ . '/../core/Modelo.php';
require_once __DIR__ . '/Configuracion.php';

class PlanRuta extends Modelo
{
    public function getByDate(string $date)
    {
        $plans = $this->query(
            'SELECT rp.*, v.nombre AS vehicle_name, v.matricula AS plate, d.nombre AS delegation_name, d.x AS delegation_x, d.y AS delegation_y
             FROM planes_ruta rp
             JOIN vehiculos v ON rp.id_vehiculo = v.id
             JOIN delegaciones d ON rp.id_delegacion = d.id
             WHERE rp.plan_date = ?
             ORDER BY v.nombre',
            [$date]
        )->fetchAll();

        foreach ($plans as &$plan) {
            $plan['stops'] = $this->query(
                'SELECT rs.*, c.nombre AS client_name, c.direccion AS address, c.x, c.y
                 FROM paradas_ruta rs
                 JOIN clientes c ON rs.id_cliente = c.id
                 WHERE rs.id_plan_ruta = ?
                 ORDER BY rs.stop_order',
                [$plan['id']]
            )->fetchAll();
        }

        return $plans;
    }

    public function getById(int $id)
    {
        $plan = $this->query(
            'SELECT rp.*, v.nombre AS vehicle_name, v.matricula AS plate, d.nombre AS delegation_name, d.x AS delegation_x, d.y AS delegation_y
             FROM planes_ruta rp
             JOIN vehiculos v ON rp.id_vehiculo = v.id
             JOIN delegaciones d ON rp.id_delegacion = d.id
             WHERE rp.id = ?',
            [$id]
        )->fetch();

        if (!$plan) return null;

        $plan['stops'] = $this->query(
            'SELECT rs.*, c.nombre AS client_name, c.direccion AS address, c.x, c.y
             FROM paradas_ruta rs
             JOIN clientes c ON rs.id_cliente = c.id
             WHERE rs.id_plan_ruta = ?
             ORDER BY rs.stop_order',
            [$plan['id']]
        )->fetchAll();

        return $plan;
    }

    public function calculateUnloadTime(int $orderId, float $baseMin = 5.0, ?array $client = null, ?float $arrivalMin = null): float
    {
        // L7: si el cliente tiene tipo_zona y tipo_negocio, usar modelo parametrizado.
        // Prevalece sobre el cálculo línea-por-línea porque captura mejor la realidad
        // operativa de la parada (zona + tipo de negocio + franja horaria de llegada).
        if ($client && !empty($client['tipo_zona']) && !empty($client['tipo_negocio'])) {
            $cfg = (new Configuracion())->getAll();
            $base   = (float) ($cfg['parada_min_' . $client['tipo_zona']] ?? $baseMin);
            $espera = (float) ($cfg['espera_min_' . $client['tipo_negocio']] ?? 0);
            $mult   = $arrivalMin !== null ? $this->getMultForTime((float) $arrivalMin, $cfg) : 1.0;
            return $base + ($espera * $mult);
        }

        // Fallback original: baseMin + suma(cantidad × unload_time_min) por línea de pedido
        $items = $this->query(
            'SELECT oi.cantidad AS quantity,
                    COALESCE(oi.unload_time_min, 1.0) AS unit_time
             FROM pedido_lineas oi
             WHERE oi.id_pedido = ?',
            [$orderId]
        )->fetchAll();

        $time = $baseMin;
        foreach ($items as $item) {
            $time += (float) $item['quantity'] * (float) $item['unit_time'];
        }
        return $time;
    }

    /**
     * L7: multiplicador de espera según franja horaria de llegada (minutos desde 00:00).
     * Cubre 6 franjas: apertura · normal · punta · tarde tranquila · tarde punta · cierre.
     * Devuelve 1.0 si la hora cae fuera de cualquier franja declarada.
     */
    private function getMultForTime(float $arrivalMin, array $cfg): float
    {
        $franjas = [
            ['ini' => 'franja_apertura_inicio',        'fin' => 'franja_apertura_fin',        'mult' => 'espera_mult_apertura'],
            ['ini' => 'franja_normal_inicio',          'fin' => 'franja_normal_fin',          'mult' => 'espera_mult_normal'],
            ['ini' => 'franja_punta_inicio',           'fin' => 'franja_punta_fin',           'mult' => 'espera_mult_punta'],
            ['ini' => 'franja_tarde_tranquila_inicio', 'fin' => 'franja_tarde_tranquila_fin', 'mult' => 'espera_mult_tarde_tranquila'],
            ['ini' => 'franja_tarde_punta_inicio',     'fin' => 'franja_tarde_punta_fin',     'mult' => 'espera_mult_tarde_punta'],
            ['ini' => 'franja_cierre_inicio',          'fin' => 'franja_cierre_fin',          'mult' => 'espera_mult_cierre'],
        ];
        foreach ($franjas as $f) {
            if (!isset($cfg[$f['ini']], $cfg[$f['fin']], $cfg[$f['mult']])) continue;
            $iniMin = $this->timeStringToMin((string) $cfg[$f['ini']]);
            $finMin = $this->timeStringToMin((string) $cfg[$f['fin']]);
            if ($arrivalMin >= $iniMin && $arrivalMin < $finMin) {
                return (float) $cfg[$f['mult']];
            }
        }
        return 1.0;
    }

    private function timeStringToMin(string $time): int
    {
        $parts = explode(':', $time);
        return ((int) $parts[0]) * 60 + ((int) ($parts[1] ?? 0));
    }

    public function calculateOrderLoad(int $orderId): array
    {
        $items = $this->query(
            'SELECT oi.cantidad AS quantity,
                    COALESCE(oi.peso_kg, 0) AS unit_weight,
                    COALESCE(oi.volume_m3, 0) AS unit_volume
             FROM pedido_lineas oi
             WHERE oi.id_pedido = ?',
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
            'peso_kg' => $totalWeight,
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
                'SELECT id FROM planes_ruta WHERE plan_date = ? AND id_vehiculo = ?',
                [$date, $vehicleId]
            )->fetch();

            if ($existing) {
                $this->query('DELETE FROM planes_ruta WHERE id = ?', [$existing['id']]);
            }

            $this->query(
                'INSERT INTO planes_ruta (plan_date, id_vehiculo, id_delegacion, total_distance_km, total_time_h, total_unload_min)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$date, $vehicleId, $delegationId, $distKm, $timeH, $unloadMin]
            );
            $planId = (int) $db->lastInsertId();

            foreach ($stops as $i => $stop) {
                $this->query(
                    'INSERT INTO paradas_ruta (id_plan_ruta, stop_order, id_cliente, id_pedido, estimated_arrival, estimated_unload_min)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        $planId,
                        $i + 1,
                        $stop['id_cliente'],
                        $stop['id_pedido'] ?? null,
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
            $this->query('DELETE FROM paradas_ruta WHERE id_plan_ruta = ?', [$planId]);
            $this->query(
                'UPDATE planes_ruta SET total_distance_km = ?, total_time_h = ?, total_unload_min = ? WHERE id = ?',
                [$distKm, $timeH, $unloadMin, $planId]
            );
            foreach ($stops as $i => $stop) {
                $this->query(
                    'INSERT INTO paradas_ruta (id_plan_ruta, stop_order, id_cliente, id_pedido, estimated_arrival, estimated_unload_min)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [$planId, $i + 1, $stop['id_cliente'], $stop['id_pedido'] ?? null, $stop['eta'] ?? null, $stop['unload_min'] ?? 0]
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
        $this->query('DELETE FROM planes_ruta WHERE plan_date = ?', [$date]);
    }

    /** Historial de rutas agrupado por fecha */
    public function getHistory(string $from, string $to): array
    {
        $rows = $this->query(
            'SELECT rp.id, rp.plan_date, rp.status, rp.total_distance_km, rp.total_time_h, rp.total_unload_min,
                    v.nombre AS vehicle_name, v.matricula AS plate,
                    d.nombre AS delegation_name,
                    (SELECT COUNT(*) FROM paradas_ruta WHERE id_plan_ruta = rp.id) AS stop_count,
                    (SELECT COUNT(*) FROM paradas_ruta WHERE id_plan_ruta = rp.id AND status = "completed") AS completed_count
             FROM planes_ruta rp
             JOIN vehiculos v ON rp.id_vehiculo = v.id
             JOIN delegaciones d ON rp.id_delegacion = d.id
             WHERE rp.plan_date BETWEEN ? AND ?
             ORDER BY rp.plan_date DESC, v.nombre',
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
            'UPDATE paradas_ruta SET status = ? WHERE id_plan_ruta = ? AND stop_order = ?',
            [$status, $planId, $stopOrder]
        );
    }

    /** Actualizar status de un plan */
    public function updatePlanStatus(int $planId, string $status): void
    {
        $this->query('UPDATE planes_ruta SET status = ? WHERE id = ?', [$status, $planId]);
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
             FROM planes_ruta
             WHERE plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        $stopStats = $this->query(
            'SELECT COUNT(*) AS total_stops,
                    SUM(CASE WHEN rs.status = "completed" THEN 1 ELSE 0 END) AS completed_stops,
                    SUM(CASE WHEN rs.status = "skipped" THEN 1 ELSE 0 END) AS skipped_stops
             FROM paradas_ruta rs
             JOIN planes_ruta rp ON rs.id_plan_ruta = rp.id
             WHERE rp.plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        // Coste estimado (cost_per_km de vehiculos)
        $costRow = $this->query(
            'SELECT COALESCE(SUM(rp.total_distance_km * COALESCE(v.cost_per_km, 0)), 0) AS total_cost
             FROM planes_ruta rp
             JOIN vehiculos v ON rp.id_vehiculo = v.id
             WHERE rp.plan_date BETWEEN ? AND ?',
            [$from, $to]
        )->fetch();

        return array_merge($row, $stopStats, ['total_cost' => (float) $costRow['total_cost']]);
    }
}

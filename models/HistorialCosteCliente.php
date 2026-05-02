<?php

require_once __DIR__ . '/../core/Modelo.php';

class HistorialCosteCliente extends Modelo
{
    public function upsert(array $data): bool
    {
        $this->query(
            'INSERT INTO historial_coste_cliente (
                id_cliente, id_hoja_ruta, id_plan_ruta, fecha, carros, cajas, peso_kg, num_bultos,
                desvio_km, coste_km_vehiculo, coste_ruta_propia, coste_gls_bruto, coste_gls_ajustado,
                multiplicador_precio_usado, recomendacion, ahorro_si_externaliza, servicio_gls, notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                id_plan_ruta = VALUES(id_plan_ruta),
                carros = VALUES(carros),
                cajas = VALUES(cajas),
                peso_kg = VALUES(peso_kg),
                num_bultos = VALUES(num_bultos),
                desvio_km = VALUES(desvio_km),
                coste_km_vehiculo = VALUES(coste_km_vehiculo),
                coste_ruta_propia = VALUES(coste_ruta_propia),
                coste_gls_bruto = VALUES(coste_gls_bruto),
                coste_gls_ajustado = VALUES(coste_gls_ajustado),
                multiplicador_precio_usado = VALUES(multiplicador_precio_usado),
                recomendacion = VALUES(recomendacion),
                ahorro_si_externaliza = VALUES(ahorro_si_externaliza),
                servicio_gls = VALUES(servicio_gls),
                notes = VALUES(notes),
                calculado_el = CURRENT_TIMESTAMP',
            [
                (int) $data['id_cliente'],
                !empty($data['id_hoja_ruta']) ? (int) $data['id_hoja_ruta'] : null,
                !empty($data['id_plan_ruta']) ? (int) $data['id_plan_ruta'] : null,
                $data['fecha'],
                (float) ($data['carros'] ?? 0),
                (float) ($data['cajas'] ?? 0),
                (float) ($data['peso_kg'] ?? 0),
                max(1, (int) ($data['num_bultos'] ?? 1)),
                isset($data['desvio_km']) && $data['desvio_km'] !== null ? (float) $data['desvio_km'] : null,
                (float) ($data['coste_km_vehiculo'] ?? 0),
                (float) ($data['coste_ruta_propia'] ?? 0),
                (float) ($data['coste_gls_bruto'] ?? 0),
                (float) ($data['coste_gls_ajustado'] ?? 0),
                (float) ($data['multiplicador_precio_usado'] ?? 1),
                $data['recomendacion'] ?? 'no_disponible',
                (float) ($data['ahorro_si_externaliza'] ?? 0),
                $data['servicio_gls'] ?? '',
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
                "SELECT cch.*, r.nombre AS ruta_name, v.nombre AS vehicle_name, v.matricula AS vehicle_plate
                 FROM historial_coste_cliente cch
                 LEFT JOIN hojas_ruta hr ON hr.id = cch.id_hoja_ruta
                 LEFT JOIN rutas r ON r.id = hr.id_ruta
                 LEFT JOIN vehiculos v ON v.id = hr.id_vehiculo
                 WHERE cch.id_cliente = ?
                 ORDER BY cch.fecha DESC, cch.calculado_el DESC
                 LIMIT {$limit}",
                [$clientId]
            )->fetchAll()
        );
    }

    public function getForDate(string $date): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cch.*, c.nombre AS client_name, c.codigo_postal AS client_postcode,
                        hr.id_ruta, r.nombre AS ruta_name,
                        hr.id_vehiculo, v.nombre AS vehicle_name, v.matricula AS vehicle_plate,
                        (cch.coste_ruta_propia - cch.coste_gls_ajustado) AS savings
                 FROM historial_coste_cliente cch
                 JOIN clientes c ON c.id = cch.id_cliente
                 LEFT JOIN hojas_ruta hr ON hr.id = cch.id_hoja_ruta
                 LEFT JOIN rutas r ON r.id = hr.id_ruta
                 LEFT JOIN vehiculos v ON v.id = hr.id_vehiculo
                 WHERE cch.fecha = ?
                 ORDER BY r.nombre, c.nombre',
                [$date]
            )->fetchAll()
        );
    }

    public function getForHoja(int $hojaRutaId): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cch.*, c.nombre AS client_name, c.codigo_postal AS client_postcode
                 FROM historial_coste_cliente cch
                 JOIN clientes c ON c.id = cch.id_cliente
                 WHERE cch.id_hoja_ruta = ?
                 ORDER BY c.nombre',
                [$hojaRutaId]
            )->fetchAll()
        );
    }

    /**
     * Resumen agregado por rango de fechas: por dia, por ruta y top clientes a externalizar.
     */
    public function getRangeReport(string $from, string $to): array
    {
        // Por dia
        $daily = $this->query(
            "SELECT cch.fecha,
                    COUNT(*) as entregas,
                    SUM(cch.desvio_km) as total_km,
                    SUM(cch.coste_ruta_propia) as total_own,
                    SUM(cch.coste_gls_ajustado) as total_gls,
                    SUM(GREATEST(0, cch.coste_ruta_propia - cch.coste_gls_ajustado)) as ahorro_potencial,
                    SUM(CASE WHEN cch.recomendacion='externalizar' THEN 1 ELSE 0 END) as n_externalize,
                    SUM(CASE WHEN cch.recomendacion='ruta_propia' THEN 1 ELSE 0 END) as n_own,
                    SUM(CASE WHEN cch.recomendacion='equilibrio' THEN 1 ELSE 0 END) as n_breakeven
             FROM historial_coste_cliente cch
             WHERE cch.fecha BETWEEN ? AND ?
               AND cch.recomendacion IN ('externalizar','ruta_propia','equilibrio')
             GROUP BY cch.fecha
             ORDER BY cch.fecha",
            [$from, $to]
        )->fetchAll();

        // Por ruta comercial
        $byRuta = $this->query(
            "SELECT r.id as id_ruta, r.nombre as ruta_name,
                    COUNT(*) as entregas,
                    SUM(cch.desvio_km) as total_km,
                    SUM(cch.coste_ruta_propia) as total_own,
                    SUM(cch.coste_gls_ajustado) as total_gls,
                    SUM(GREATEST(0, cch.coste_ruta_propia - cch.coste_gls_ajustado)) as ahorro_potencial,
                    SUM(CASE WHEN cch.recomendacion='externalizar' THEN 1 ELSE 0 END) as n_externalize
             FROM historial_coste_cliente cch
             JOIN hojas_ruta hr ON hr.id = cch.id_hoja_ruta
             JOIN rutas r ON r.id = hr.id_ruta
             WHERE cch.fecha BETWEEN ? AND ?
               AND cch.recomendacion IN ('externalizar','ruta_propia','equilibrio')
             GROUP BY r.id, r.nombre
             ORDER BY ahorro_potencial DESC",
            [$from, $to]
        )->fetchAll();

        // Top clientes a externalizar (mas ahorro potencial acumulado)
        $topExt = $this->query(
            "SELECT c.id as id_cliente, c.nombre as client_name, c.codigo_postal AS postcode,
                    COUNT(*) as entregas,
                    SUM(cch.coste_ruta_propia) as total_own,
                    SUM(cch.coste_gls_ajustado) as total_gls,
                    SUM(GREATEST(0, cch.coste_ruta_propia - cch.coste_gls_ajustado)) as ahorro_potencial,
                    AVG(cch.desvio_km) as avg_km
             FROM historial_coste_cliente cch
             JOIN clientes c ON c.id = cch.id_cliente
             WHERE cch.fecha BETWEEN ? AND ?
               AND cch.recomendacion = 'externalizar'
             GROUP BY c.id, c.nombre, c.codigo_postal
             HAVING ahorro_potencial > 0
             ORDER BY ahorro_potencial DESC
             LIMIT 25",
            [$from, $to]
        )->fetchAll();

        // Totales del rango
        $totals = $this->query(
            "SELECT COUNT(*) as entregas,
                    SUM(cch.desvio_km) as total_km,
                    SUM(cch.coste_ruta_propia) as total_own,
                    SUM(cch.coste_gls_ajustado) as total_gls,
                    SUM(GREATEST(0, cch.coste_ruta_propia - cch.coste_gls_ajustado)) as ahorro_potencial,
                    SUM(CASE WHEN cch.recomendacion='externalizar' THEN 1 ELSE 0 END) as n_externalize,
                    SUM(CASE WHEN cch.recomendacion='ruta_propia' THEN 1 ELSE 0 END) as n_own
             FROM historial_coste_cliente cch
             WHERE cch.fecha BETWEEN ? AND ?
               AND cch.recomendacion IN ('externalizar','ruta_propia','equilibrio')",
            [$from, $to]
        )->fetch();

        return [
            'from' => $from,
            'to' => $to,
            'totals' => $totals ?: [],
            'daily' => $daily ?: [],
            'by_ruta' => $byRuta ?: [],
            'top_externalize' => $topExt ?: [],
        ];
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
            $recomendacion = (string) ($row['recomendacion'] ?? 'no_disponible');
            $costOwn = (float) ($row['coste_ruta_propia'] ?? 0);
            $costGls = (float) ($row['coste_gls_ajustado'] ?? 0);
            $saving = max(0.0, (float) ($row['ahorro_si_externaliza'] ?? 0));

            if ($notes === 'postcode_missing' || trim((string) ($row['client_postcode'] ?? '')) === '') {
                $summary['clients_no_postcode']++;
            }
            if (str_starts_with($notes, 'gls_error:')) {
                $summary['clients_gls_error']++;
            }

            if ($recomendacion === 'ruta_propia') {
                $summary['recommend_own_route']++;
            } elseif ($recomendacion === 'externalizar') {
                $summary['recommend_externalize']++;
            } elseif ($recomendacion === 'equilibrio') {
                $summary['recommend_break_even']++;
            } else {
                $summary['recommend_unavailable']++;
            }

            $summary['total_cost_own_all'] += $costOwn;
            $summary['total_cost_gls_all'] += $costGls;
            $summary['potential_savings'] += $saving;

            if (!empty($row['calculado_el']) && ($summary['last_calculated_at'] === null || $row['calculado_el'] > $summary['last_calculated_at'])) {
                $summary['last_calculated_at'] = $row['calculado_el'];
            }
        }

        return $summary;
    }

    /** Elimina registros de mas de $months meses. Devuelve filas eliminadas. */
    public function purgeOlderThan(int $months = 12): int
    {
        $cutoff = date('Y-m-d', strtotime("-{$months} months"));
        $stmt = $this->query('DELETE FROM historial_coste_cliente WHERE fecha < ?', [$cutoff]);
        return $stmt->rowCount();
    }
}

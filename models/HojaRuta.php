<?php

require_once __DIR__ . '/../core/Model.php';

class HojaRuta extends Model
{
    /* ── Listar hojas por fecha (y opcionalmente por ruta) ── */
    public function getByFecha(string $fecha, ?int $rutaId = null, ?int $userId = null)
    {
        $sql = "SELECT h.*, r.name as ruta_name, v.name as vehicle_name, v.plate as vehicle_plate,
                       (SELECT COUNT(*) FROM hoja_ruta_lineas l WHERE l.hoja_ruta_id = h.id) as num_lineas
                FROM hojas_ruta h
                JOIN rutas r ON r.id = h.ruta_id
                LEFT JOIN vehicles v ON v.id = h.vehicle_id
                WHERE h.fecha = ?
                  AND (
                      COALESCE(h.total_carros, 0) > 0
                      OR COALESCE(h.total_cajas, 0) > 0
                      OR EXISTS (
                          SELECT 1
                          FROM hoja_ruta_lineas l
                          WHERE l.hoja_ruta_id = h.id
                            AND (COALESCE(l.carros, 0) > 0 OR COALESCE(l.cajas, 0) > 0)
                      )
                  )";
        $params = [$fecha];

        if ($rutaId) {
            $sql .= " AND h.ruta_id = ?";
            $params[] = $rutaId;
        }

        if ($userId) {
            $sql .= " AND h.user_id = ?";
            $params[] = $userId;
        }

        $sql .= " ORDER BY r.name";
        $hojas = $this->query($sql, $params)->fetchAll();

        foreach ($hojas as &$h) {
            $h['lineas'] = $this->getLineas((int) $h['id']);
        }

        return $hojas;
    }

    /* ── Detalle de una hoja con todas sus líneas ── */
    public function getById(int $id)
    {
        $hoja = $this->query(
            "SELECT h.*, r.name as ruta_name, v.name as vehicle_name, v.plate as vehicle_plate
             FROM hojas_ruta h
             JOIN rutas r ON r.id = h.ruta_id
             LEFT JOIN vehicles v ON v.id = h.vehicle_id
             WHERE h.id = ?",
            [$id]
        )->fetch();

        if (!$hoja) return null;

        $hoja['lineas'] = $this->getLineas($id);
        return $hoja;
    }

    /* ── Líneas de una hoja con datos de cliente y comercial ── */
    public function getLineas(int $hojaId)
    {
        return $this->query(
            "SELECT l.*, c.name as client_name, c.address as client_address,
                    c.postcode as client_postcode,
                    c.x as client_x, c.y as client_y,
                    com.name as comercial_name
             FROM hoja_ruta_lineas l
             JOIN clients c ON c.id = l.client_id
             LEFT JOIN comerciales com ON com.id = l.comercial_id
             WHERE l.hoja_ruta_id = ?
             ORDER BY COALESCE(l.orden_descarga, 9999), l.id",
            [$hojaId]
        )->fetchAll();
    }

    public function getLineaById(int $lineaId)
    {
        return $this->query(
            "SELECT l.*, h.id as hoja_ruta_id, h.user_id as hoja_user_id, h.ruta_id
             FROM hoja_ruta_lineas l
             JOIN hojas_ruta h ON h.id = l.hoja_ruta_id
             WHERE l.id = ?",
            [$lineaId]
        )->fetch();
    }

    public function prefillRouteClientsForComerciales(int $hojaId, array $comercialIds): int
    {
        $comercialIds = array_values(array_filter(array_map('intval', $comercialIds)));
        if (empty($comercialIds)) {
            return 0;
        }

        $hoja = $this->query(
            "SELECT id, ruta_id
             FROM hojas_ruta
             WHERE id = ?",
            [$hojaId]
        )->fetch();

        if (!$hoja || empty($hoja['ruta_id'])) {
            return 0;
        }

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));
        $params = array_merge([(int) $hoja['ruta_id']], $comercialIds, [$hojaId]);
        $clients = $this->query(
            "SELECT c.id, c.comercial_id
             FROM clients c
             WHERE c.active = 1
               AND c.ruta_id = ?
               AND c.comercial_id IN ($placeholders)
               AND NOT EXISTS (
                   SELECT 1
                   FROM hoja_ruta_lineas l
                   WHERE l.hoja_ruta_id = ?
                     AND l.client_id = c.id
               )
             ORDER BY c.name, c.id",
            $params
        )->fetchAll();

        if (empty($clients)) {
            return 0;
        }

        foreach ($clients as $client) {
            $this->query(
                "INSERT INTO hoja_ruta_lineas (hoja_ruta_id, client_id, comercial_id, carros, cajas, cc_aprox)
                 VALUES (?, ?, ?, 0, 0, 0)",
                [$hojaId, (int) $client['id'], (int) $client['comercial_id']]
            );
        }

        $this->recalcTotals($hojaId);
        return count($clients);
    }

    public function getRutaIdsForComerciales(array $comercialIds): array
    {
        $comercialIds = array_values(array_filter(array_map('intval', $comercialIds)));
        if (empty($comercialIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));
        $rows = $this->query(
            "SELECT DISTINCT ruta_id
             FROM clients
             WHERE active = 1
               AND ruta_id IS NOT NULL
               AND comercial_id IN ($placeholders)
             ORDER BY ruta_id",
            $comercialIds
        )->fetchAll();

        return array_values(array_map('intval', array_column($rows, 'ruta_id')));
    }

    /* ── Crear hoja ── */
    public function create(array $data)
    {
        $existing = $this->query(
            "SELECT h.id,
                    COALESCE(h.total_carros, 0) as total_carros,
                    COALESCE(h.total_cajas, 0) as total_cajas,
                    EXISTS(SELECT 1 FROM hoja_ruta_lineas l WHERE l.hoja_ruta_id = h.id) as has_lineas
             FROM hojas_ruta h
             WHERE h.ruta_id = ? AND h.fecha = ?
             LIMIT 1",
            [$data['ruta_id'], $data['fecha']]
        )->fetch();

        if ($existing) {
            $hojaId = (int) $existing['id'];
            $hasActivity = (float) $existing['total_carros'] > 0 || (float) $existing['total_cajas'] > 0;

            if (!$hasActivity) {
                $fields = ["estado = 'borrador'"];
                $params = [];

                foreach (['responsable', 'notas', 'user_id', 'vehicle_id'] as $f) {
                    if (array_key_exists($f, $data)) {
                        $fields[] = "$f = ?";
                        $params[] = $f === 'vehicle_id' && empty($data[$f]) ? null : $data[$f];
                    }
                }

                $params[] = $hojaId;
                $this->query(
                    "UPDATE hojas_ruta SET " . implode(', ', $fields) . " WHERE id = ?",
                    $params
                );
            }

            return $hojaId;
        }

        $this->query(
            "INSERT INTO hojas_ruta (ruta_id, vehicle_id, fecha, responsable, notas, user_id)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $data['ruta_id'],
                !empty($data['vehicle_id']) ? (int) $data['vehicle_id'] : null,
                $data['fecha'],
                $data['responsable'] ?? null,
                $data['notas'] ?? null,
                $data['user_id'] ?? null,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    /* ── Actualizar hoja ── */
    public function update(int $id, array $data)
    {
        $fields = [];
        $params = [];
        $clearCosts = false;

        foreach (['responsable', 'notas', 'estado', 'total_cc', 'total_carros', 'total_cajas', 'total_bn', 'total_litros', 'vehicle_id'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'vehicle_id' && empty($data[$f]) ? null : $data[$f];
                if ($f === 'vehicle_id') {
                    $clearCosts = true;
                }
            }
        }

        if (empty($fields)) return;

        $params[] = $id;
        $this->query("UPDATE hojas_ruta SET " . implode(', ', $fields) . " WHERE id = ?", $params);
        if ($clearCosts) {
            $this->clearCostDataForHoja($id);
        }
    }

    /* ── Eliminar hoja (solo borrador) ── */
    public function delete(int $id)
    {
        $hoja = $this->query("SELECT estado FROM hojas_ruta WHERE id = ?", [$id])->fetch();
        if (!$hoja) return false;
        if ($hoja['estado'] !== 'borrador') return false;

        $this->query("DELETE FROM hojas_ruta WHERE id = ?", [$id]);
        return true;
    }

    /* ── Cambiar estado ── */
    public function updateEstado(int $id, string $estado)
    {
        $valid = ['borrador', 'cerrada', 'en_reparto', 'completada'];
        if (!in_array($estado, $valid)) return false;

        $this->query("UPDATE hojas_ruta SET estado = ? WHERE id = ?", [$estado, $id]);
        return true;
    }

    /* ── Añadir línea ── */
    public function addLinea(int $hojaId, array $data)
    {
        $this->query(
            "INSERT INTO hoja_ruta_lineas (hoja_ruta_id, order_id, client_id, comercial_id, zona, carros, cajas, cc_aprox, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $hojaId,
                $data['order_id'] ?? null,
                $data['client_id'],
                $data['comercial_id'] ?? null,
                $data['zona'] ?? null,
                $data['carros'] ?? 0,
                $data['cajas'] ?? 0,
                $data['cc_aprox'] ?? (($data['carros'] ?? 0) + ($data['cajas'] ?? 0)),
                $data['observaciones'] ?? null,
            ]
        );
        $lineaId = (int) $this->db()->lastInsertId();
        $this->recalcTotals($hojaId);
        $this->clearCostDataForHoja($hojaId);
        return $lineaId;
    }

    /* ── Actualizar línea ── */
    public function updateLinea(int $lineaId, array $data)
    {
        $fields = [];
        $params = [];
        $clearCosts = false;

        foreach (['order_id', 'comercial_id', 'zona', 'carros', 'cajas', 'cc_aprox', 'orden_descarga', 'observaciones', 'estado'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f];
                if (in_array($f, ['carros', 'cajas', 'orden_descarga'], true)) {
                    $clearCosts = true;
                }
            }
        }

        if (empty($fields)) return;

        $params[] = $lineaId;
        $this->query("UPDATE hoja_ruta_lineas SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        $row = $this->query("SELECT hoja_ruta_id FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        if ($row) {
            $hojaId = (int) $row['hoja_ruta_id'];
            $this->recalcTotals($hojaId);
            if ($clearCosts) {
                $this->clearCostDataForHoja($hojaId);
            }
        }
    }

    public function updateLineaCostData(int $lineaId, array $data): void
    {
        $this->query(
            "UPDATE hoja_ruta_lineas
             SET detour_km = ?, cost_own_route = ?, cost_gls_raw = ?, cost_gls_adjusted = ?,
                 gls_recommendation = ?, gls_service = ?, gls_notes = ?
             WHERE id = ?",
            [
                $data['detour_km'] ?? null,
                $data['cost_own_route'] ?? null,
                $data['cost_gls_raw'] ?? null,
                $data['cost_gls_adjusted'] ?? null,
                $data['gls_recommendation'] ?? null,
                $data['gls_service'] ?? null,
                $data['gls_notes'] ?? null,
                $lineaId,
            ]
        );
    }

    /* ── Eliminar línea ── */
    public function clearCostDataForHoja(int $hojaId): void
    {
        $this->query(
            "UPDATE hoja_ruta_lineas
             SET detour_km = NULL,
                 cost_own_route = NULL,
                 cost_gls_raw = NULL,
                 cost_gls_adjusted = NULL,
                 gls_recommendation = NULL,
                 gls_service = NULL,
                 gls_notes = NULL
             WHERE hoja_ruta_id = ?",
            [$hojaId]
        );
    }

    public function removeLinea(int $lineaId)
    {
        $row = $this->query("SELECT hoja_ruta_id FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        $this->query("DELETE FROM hoja_ruta_lineas WHERE id = ?", [$lineaId]);
        if ($row) {
            $hojaId = (int) $row['hoja_ruta_id'];
            $this->recalcTotals($hojaId);
            $this->clearCostDataForHoja($hojaId);
        }
    }

    /* ── Reordenar líneas ── */
    public function reorder(int $hojaId, array $lineaIds)
    {
        foreach ($lineaIds as $i => $lineaId) {
            $this->query(
                "UPDATE hoja_ruta_lineas SET orden_descarga = ? WHERE id = ? AND hoja_ruta_id = ?",
                [$i + 1, $lineaId, $hojaId]
            );
        }
        $this->clearCostDataForHoja($hojaId);
    }

    /* ── Duplicar hoja de otra fecha ── */
    public function duplicate(int $sourceId, string $newFecha)
    {
        $source = $this->getById($sourceId);
        if (!$source) return null;

        $newId = $this->create([
            'ruta_id'     => $source['ruta_id'],
            'vehicle_id'  => $source['vehicle_id'] ?? null,
            'fecha'       => $newFecha,
            'responsable' => $source['responsable'],
            'notas'       => $source['notas'],
        ]);

        foreach ($source['lineas'] as $linea) {
            $this->addLinea($newId, [
                'client_id'     => $linea['client_id'],
                'comercial_id'  => $linea['comercial_id'],
                'zona'          => $linea['zona'],
                'carros'        => $linea['carros'] ?? 0,
                'cajas'         => $linea['cajas'] ?? 0,
                'cc_aprox'      => $linea['cc_aprox'],
                'observaciones' => $linea['observaciones'],
            ]);
        }

        return $newId;
    }

    /* ── Recalcular totales de la hoja ── */
    public function recalcTotals(int $hojaId)
    {
        $row = $this->query(
            "SELECT COALESCE(SUM(carros), 0) as total_carros,
                    COALESCE(SUM(cajas), 0) as total_cajas,
                    COALESCE(SUM(cc_aprox), 0) as total_cc,
                    COUNT(*) as total_lineas
             FROM hoja_ruta_lineas
             WHERE hoja_ruta_id = ?",
            [$hojaId]
        )->fetch();

        $this->query(
            "UPDATE hojas_ruta SET total_cc = ?, total_carros = ?, total_cajas = ? WHERE id = ?",
            [$row['total_cc'], $row['total_carros'], $row['total_cajas'], $hojaId]
        );
    }

    /* ── Rutas sin hoja en una fecha ── */
    public function getRutasSinHoja(string $fecha)
    {
        return $this->query(
            "SELECT r.* FROM rutas r
             WHERE r.active = 1
               AND NOT EXISTS (
                   SELECT 1
                   FROM hojas_ruta h
                   WHERE h.ruta_id = r.id
                     AND h.fecha = ?
                     AND (
                         COALESCE(h.total_carros, 0) > 0
                         OR COALESCE(h.total_cajas, 0) > 0
                         OR EXISTS (
                             SELECT 1
                             FROM hoja_ruta_lineas l
                             WHERE l.hoja_ruta_id = h.id
                               AND (COALESCE(l.carros, 0) > 0 OR COALESCE(l.cajas, 0) > 0)
                         )
                     )
               )
             ORDER BY r.name",
            [$fecha]
        )->fetchAll();
    }

    /* ── Delegacion mas comun entre los clientes de la hoja ── */
    public function getDelegationForHoja(int $hojaId)
    {
        $row = $this->query(
            "SELECT d.* FROM delegations d
             JOIN clients c ON c.delegation_id = d.id
             JOIN hoja_ruta_lineas l ON l.client_id = c.id
             WHERE l.hoja_ruta_id = ? AND d.active = 1
             GROUP BY d.id
             ORDER BY COUNT(*) DESC
             LIMIT 1",
            [$hojaId]
        )->fetch();

        if ($row) return $row;

        return $this->query("SELECT * FROM delegations WHERE active = 1 ORDER BY id LIMIT 1")->fetch();
    }

    /* ── Listar comerciales ── */
    public function getComerciales()
    {
        return $this->query("SELECT id, code, name FROM comerciales ORDER BY name")->fetchAll();
    }

    public function getCostLines(int $hojaId): array
    {
        return $this->query(
            "SELECT l.id as linea_id, l.client_id, c.name as client_name, c.postcode as client_postcode,
                    l.carros, l.cajas, l.detour_km, l.cost_own_route, l.cost_gls_raw, l.cost_gls_adjusted,
                    l.gls_recommendation as recommendation, l.gls_service, l.gls_notes
             FROM hoja_ruta_lineas l
             JOIN clients c ON c.id = l.client_id
             WHERE l.hoja_ruta_id = ?
               AND (COALESCE(l.carros, 0) > 0 OR COALESCE(l.cajas, 0) > 0)
             ORDER BY COALESCE(l.orden_descarga, 9999), l.id",
            [$hojaId]
        )->fetchAll();
    }
}

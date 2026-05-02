<?php

require_once __DIR__ . '/../core/Modelo.php';

class HojaRuta extends Modelo
{
    private function clientCommercialIds(array $client): array
    {
        $ids = [];
        foreach (['id_comercial', 'id_comercial_planta', 'id_comercial_flor', 'id_comercial_accesorio'] as $field) {
            if (!empty($client[$field])) {
                $ids[] = (int) $client[$field];
            }
        }

        return array_values(array_unique($ids));
    }

    private function matchesAnyCommercial(array $client, array $commercialIds): bool
    {
        $commercialIds = array_values(array_filter(array_map('intval', $commercialIds)));
        if (empty($commercialIds)) {
            return false;
        }

        return (bool) array_intersect($this->clientCommercialIds($client), $commercialIds);
    }

    private function pickMatchingCommercialId(array $client, array $commercialIds): ?int
    {
        $commercialIds = array_values(array_filter(array_map('intval', $commercialIds)));
        if (empty($commercialIds)) {
            return null;
        }

        foreach ($this->clientCommercialIds($client) as $clientCommercialId) {
            if (in_array($clientCommercialId, $commercialIds, true)) {
                return $clientCommercialId;
            }
        }

        return null;
    }

    /* ── Listar hojas por fecha (y opcionalmente por ruta) ── */
    public function getByFecha(string $fecha, ?int $rutaId = null, ?int $userId = null)
    {
        $sql = "SELECT h.*, r.nombre as ruta_name, v.nombre as vehicle_name, v.matricula as vehicle_plate,
                       (SELECT COUNT(*) FROM hoja_ruta_lineas l WHERE l.id_hoja_ruta = h.id) as num_lineas
                FROM hojas_ruta h
                JOIN rutas r ON r.id = h.id_ruta
                LEFT JOIN vehiculos v ON v.id = h.id_vehiculo
                WHERE h.fecha = ?";
        $params = [$fecha];

        if ($rutaId) {
            $sql .= " AND h.id_ruta = ?";
            $params[] = $rutaId;
        }

        if ($userId) {
            $sql .= " AND h.id_usuario = ?";
            $params[] = $userId;
        }

        $sql .= " ORDER BY r.nombre";
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
            "SELECT h.*, r.nombre as ruta_name, v.nombre as vehicle_name, v.matricula as vehicle_plate
             FROM hojas_ruta h
             JOIN rutas r ON r.id = h.id_ruta
             LEFT JOIN vehiculos v ON v.id = h.id_vehiculo
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
            "SELECT l.*, c.nombre as client_name,
                    COALESCE(de.direccion, c.direccion) as client_address,
                    COALESCE(de.codigo_postal, c.codigo_postal) as client_postcode,
                    COALESCE(de.x, c.x) as client_x, COALESCE(de.y, c.y) as client_y,
                    l.id_direccion, de.descripcion AS direccion_descripcion,
                    c.id_comercial as client_comercial_id,
                    c.id_comercial_planta as client_comercial_planta_id,
                    c.id_comercial_flor as client_comercial_flor_id,
                    c.id_comercial_accesorio as client_comercial_accesorio_id,
                    com.nombre as comercial_name
             FROM hoja_ruta_lineas l
             JOIN clientes c ON c.id = l.id_cliente
             LEFT JOIN direcciones_entrega de ON de.id = l.id_direccion
             LEFT JOIN comerciales com ON com.id = l.id_comercial
             WHERE l.id_hoja_ruta = ?
             ORDER BY COALESCE(l.orden_descarga, 9999), l.id",
            [$hojaId]
        )->fetchAll();
    }

    public function getLineaById(int $lineaId)
    {
        return $this->query(
            "SELECT l.*, h.id as id_hoja_ruta, h.id_usuario as hoja_user_id, h.id_ruta,
                    c.id_comercial as client_comercial_id,
                    c.id_comercial_planta as client_comercial_planta_id,
                    c.id_comercial_flor as client_comercial_flor_id,
                    c.id_comercial_accesorio as client_comercial_accesorio_id
             FROM hoja_ruta_lineas l
             JOIN hojas_ruta h ON h.id = l.id_hoja_ruta
             LEFT JOIN clientes c ON c.id = l.id_cliente
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
            "SELECT id, id_ruta
             FROM hojas_ruta
             WHERE id = ?",
            [$hojaId]
        )->fetch();

        if (!$hoja || empty($hoja['id_ruta'])) {
            return 0;
        }

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));
        $params = array_merge([(int) $hoja['id_ruta']], $comercialIds, $comercialIds, $comercialIds, $comercialIds, [$hojaId]);
        $clients = $this->query(
            "SELECT c.id, c.id_comercial, c.id_comercial_planta, c.id_comercial_flor, c.id_comercial_accesorio
             FROM clientes c
             WHERE c.activo = 1
               AND c.id_ruta = ?
               AND (
                   c.id_comercial IN ($placeholders)
                   OR c.id_comercial_planta IN ($placeholders)
                   OR c.id_comercial_flor IN ($placeholders)
                   OR c.id_comercial_accesorio IN ($placeholders)
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM hoja_ruta_lineas l
                   WHERE l.id_hoja_ruta = ?
                     AND l.id_cliente = c.id
               )
             ORDER BY c.nombre, c.id",
            $params
        )->fetchAll();

        if (empty($clients)) {
            return 0;
        }

        foreach ($clients as $client) {
            $matchedCommercialId = $this->pickMatchingCommercialId($client, $comercialIds);
            if (!$matchedCommercialId) {
                continue;
            }

            $this->query(
                "INSERT INTO hoja_ruta_lineas (id_hoja_ruta, id_cliente, id_comercial, carros, cajas, cc_aprox)
                 VALUES (?, ?, ?, 0, 0, 0)",
                [$hojaId, (int) $client['id'], $matchedCommercialId]
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
        $params = array_merge($comercialIds, $comercialIds, $comercialIds, $comercialIds);
        $rows = $this->query(
            "SELECT DISTINCT id_ruta
             FROM clientes
             WHERE activo = 1
               AND id_ruta IS NOT NULL
               AND (
                   id_comercial IN ($placeholders)
                   OR id_comercial_planta IN ($placeholders)
                   OR id_comercial_flor IN ($placeholders)
                   OR id_comercial_accesorio IN ($placeholders)
               )
             ORDER BY id_ruta",
            $params
        )->fetchAll();

        return array_values(array_map('intval', array_column($rows, 'id_ruta')));
    }

    /* ── Crear hoja ── */
    public function create(array $data)
    {
        $existing = $this->query(
            "SELECT h.id,
                    COALESCE(h.total_carros, 0) as total_carros,
                    COALESCE(h.total_cajas, 0) as total_cajas,
                    EXISTS(SELECT 1 FROM hoja_ruta_lineas l WHERE l.id_hoja_ruta = h.id) as has_lineas
             FROM hojas_ruta h
             WHERE h.id_ruta = ? AND h.fecha = ?
             LIMIT 1",
            [$data['id_ruta'], $data['fecha']]
        )->fetch();

        if ($existing) {
            $hojaId = (int) $existing['id'];
            $hasActivity = (float) $existing['total_carros'] > 0 || (float) $existing['total_cajas'] > 0;

            if (!$hasActivity) {
                $fields = ["estado = 'borrador'"];
                $params = [];

                foreach (['responsable', 'notas', 'id_usuario', 'id_vehiculo'] as $f) {
                    if (array_key_exists($f, $data)) {
                        $fields[] = "$f = ?";
                        $params[] = $f === 'id_vehiculo' && empty($data[$f]) ? null : $data[$f];
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
            "INSERT INTO hojas_ruta (id_ruta, id_vehiculo, fecha, responsable, notas, id_usuario)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $data['id_ruta'],
                !empty($data['id_vehiculo']) ? (int) $data['id_vehiculo'] : null,
                $data['fecha'],
                $data['responsable'] ?? null,
                $data['notas'] ?? null,
                $data['id_usuario'] ?? null,
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

        foreach (['responsable', 'notas', 'estado', 'total_cc', 'total_carros', 'total_cajas', 'total_bn', 'total_litros', 'id_vehiculo'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'id_vehiculo' && empty($data[$f]) ? null : $data[$f];
                if ($f === 'id_vehiculo') {
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
            "INSERT INTO hoja_ruta_lineas (id_hoja_ruta, id_pedido, id_cliente, id_comercial, id_direccion, zona, carros, cajas, cc_aprox, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $hojaId,
                $data['id_pedido'] ?? null,
                $data['id_cliente'],
                $data['id_comercial'] ?? null,
                $data['id_direccion'] ?? null,
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

        foreach (['id_pedido', 'id_comercial', 'zona', 'carros', 'cajas', 'cc_aprox', 'orden_descarga', 'observaciones', 'estado'] as $f) {
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

        $row = $this->query("SELECT id_hoja_ruta FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        if ($row) {
            $hojaId = (int) $row['id_hoja_ruta'];
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
             SET desvio_km = ?, coste_ruta_propia = ?, coste_gls_bruto = ?, coste_gls_ajustado = ?,
                 recomendacion_gls = ?, servicio_gls = ?, notas_gls = ?
             WHERE id = ?",
            [
                $data['desvio_km'] ?? null,
                $data['coste_ruta_propia'] ?? null,
                $data['coste_gls_bruto'] ?? null,
                $data['coste_gls_ajustado'] ?? null,
                $data['recomendacion_gls'] ?? null,
                $data['servicio_gls'] ?? null,
                $data['notas_gls'] ?? null,
                $lineaId,
            ]
        );
    }

    /* ── Eliminar línea ── */
    public function clearCostDataForHoja(int $hojaId): void
    {
        $this->query(
            "UPDATE hoja_ruta_lineas
             SET desvio_km = NULL,
                 coste_ruta_propia = NULL,
                 coste_gls_bruto = NULL,
                 coste_gls_ajustado = NULL,
                 recomendacion_gls = NULL,
                 servicio_gls = NULL,
                 notas_gls = NULL
             WHERE id_hoja_ruta = ?",
            [$hojaId]
        );
    }

    public function removeLinea(int $lineaId)
    {
        $row = $this->query("SELECT id_hoja_ruta FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        $this->query("DELETE FROM hoja_ruta_lineas WHERE id = ?", [$lineaId]);
        if ($row) {
            $hojaId = (int) $row['id_hoja_ruta'];
            $this->recalcTotals($hojaId);
            $this->clearCostDataForHoja($hojaId);
        }
    }

    /* ── Reordenar líneas ── */
    public function reorder(int $hojaId, array $lineaIds)
    {
        foreach ($lineaIds as $i => $lineaId) {
            $this->query(
                "UPDATE hoja_ruta_lineas SET orden_descarga = ? WHERE id = ? AND id_hoja_ruta = ?",
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
            'id_ruta'     => $source['id_ruta'],
            'id_vehiculo'  => $source['id_vehiculo'] ?? null,
            'fecha'       => $newFecha,
            'responsable' => $source['responsable'],
            'notas'       => $source['notas'],
        ]);

        foreach ($source['lineas'] as $linea) {
            $this->addLinea($newId, [
                'id_cliente'     => $linea['id_cliente'],
                'id_comercial'  => $linea['id_comercial'],
                'id_direccion'  => $linea['id_direccion'] ?? null,
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
             WHERE id_hoja_ruta = ?",
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
            "SELECT r.id, r.nombre AS name, r.color, r.activo AS active,
                    r.creado_el AS created_at, r.actualizado_el AS updated_at
             FROM rutas r
             WHERE r.activo = 1
               AND NOT EXISTS (
                   SELECT 1
                   FROM hojas_ruta h
                   WHERE h.id_ruta = r.id
                     AND h.fecha = ?
               )
             ORDER BY r.nombre",
            [$fecha]
        )->fetchAll();
    }

    /* ── Delegacion mas comun entre los clientes de la hoja ── */
    public function getDelegationForHoja(int $hojaId)
    {
        $row = $this->query(
            "SELECT d.id, d.nombre AS name, d.direccion AS address, d.telefono AS phone, d.notas AS notes, d.x, d.y,
                    d.hora_apertura AS open_time, d.hora_cierre AS close_time, d.activo AS active,
                    d.creado_el AS created_at, d.actualizado_el AS updated_at
             FROM delegaciones d
             JOIN clientes c ON c.id_delegacion = d.id
             JOIN hoja_ruta_lineas l ON l.id_cliente = c.id
             WHERE l.id_hoja_ruta = ? AND d.activo = 1
             GROUP BY d.id
             ORDER BY COUNT(*) DESC
             LIMIT 1",
            [$hojaId]
        )->fetch();

        if ($row) return $row;

        return $this->query("SELECT id, nombre AS name, direccion AS address, telefono AS phone, notas AS notes, x, y,
            hora_apertura AS open_time, hora_cierre AS close_time, activo AS active,
            creado_el AS created_at, actualizado_el AS updated_at
            FROM delegaciones WHERE activo = 1 ORDER BY id LIMIT 1")->fetch();
    }

    /* ── Listar comerciales ── */
    public function getComerciales()
    {
        return $this->query("SELECT id, codigo AS code, nombre AS name FROM comerciales ORDER BY nombre")->fetchAll();
    }

    /**
     * Genera hojas de ruta desde pedidos confirmados de una fecha.
     * Crea una hoja por ruta y vincula cada linea al id_pedido de origen.
     * No duplica lineas si ya existen para ese id_pedido en la hoja.
     */
    public function generateFromOrders(string $fecha, array $rutasConPedidos): array
    {
        $created = [];
        $linesAdded = 0;
        $skipped = 0;

        foreach ($rutasConPedidos as $rutaData) {
            $rutaId = (int) $rutaData['id_ruta'];
            $pedidos = $rutaData['pedidos'] ?? [];
            if (empty($pedidos)) continue;

            // Crear o reutilizar hoja para esta ruta+fecha
            $hojaId = $this->create([
                'id_ruta' => $rutaId,
                'fecha'   => $fecha,
            ]);

            // Obtener order_ids ya vinculados en esta hoja para evitar duplicados
            $existingOrderIds = [];
            $rows = $this->query(
                "SELECT id_pedido FROM hoja_ruta_lineas WHERE id_hoja_ruta = ? AND id_pedido IS NOT NULL",
                [$hojaId]
            )->fetchAll();
            foreach ($rows as $r) {
                $existingOrderIds[(int) $r['id_pedido']] = true;
            }

            // Tambien obtener client_ids existentes para evitar duplicados sin id_pedido
            $existingClientIds = [];
            $rows2 = $this->query(
                "SELECT id_cliente FROM hoja_ruta_lineas WHERE id_hoja_ruta = ?",
                [$hojaId]
            )->fetchAll();
            foreach ($rows2 as $r) {
                $existingClientIds[(int) $r['id_cliente']] = true;
            }

            $hojaLinesAdded = 0;
            foreach ($pedidos as $p) {
                $orderId = (int) $p['id_pedido'];
                $clientId = (int) $p['id_cliente'];

                // Skip si ya existe este pedido o este cliente en la hoja
                if (isset($existingOrderIds[$orderId]) || isset($existingClientIds[$clientId])) {
                    $skipped++;
                    continue;
                }

                $this->addLinea($hojaId, [
                    'id_pedido'      => $orderId,
                    'id_cliente'     => $clientId,
                    'id_comercial'  => $p['id_comercial'] ?? null,
                    'id_direccion'  => $p['id_direccion'] ?? null,
                    'carros'        => 0,
                    'cajas'         => $p['cc_aprox'] ?? 0,
                    'cc_aprox'      => $p['cc_aprox'] ?? 0,
                    'observaciones' => $p['observaciones'] ?? null,
                ]);
                $hojaLinesAdded++;
                $linesAdded++;
            }

            $hoja = $this->getById($hojaId);
            $created[] = [
                'hoja_id'     => $hojaId,
                'id_ruta'     => $rutaId,
                'ruta_name'   => $rutaData['ruta_name'] ?? '',
                'lines_added' => $hojaLinesAdded,
                'total_lines' => count($hoja['lineas'] ?? []),
            ];
        }

        return [
            'hojas_created'  => $created,
            'total_lines'    => $linesAdded,
            'total_skipped'  => $skipped,
        ];
    }

    public function getCostLines(int $hojaId): array
    {
        return $this->query(
            "SELECT l.id as linea_id, l.id_cliente, c.nombre as client_name,
                    COALESCE(de.codigo_postal, c.codigo_postal) as client_postcode,
                    l.carros, l.cajas, l.desvio_km, l.coste_ruta_propia, l.coste_gls_bruto, l.coste_gls_ajustado,
                    l.recomendacion_gls as recomendacion, l.servicio_gls, l.notas_gls
             FROM hoja_ruta_lineas l
             JOIN clientes c ON c.id = l.id_cliente
             LEFT JOIN direcciones_entrega de ON de.id = l.id_direccion
             WHERE l.id_hoja_ruta = ?
               AND (COALESCE(l.carros, 0) > 0 OR COALESCE(l.cajas, 0) > 0)
             ORDER BY COALESCE(l.orden_descarga, 9999), l.id",
            [$hojaId]
        )->fetchAll();
    }
}

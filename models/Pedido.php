<?php

require_once __DIR__ . '/../core/Modelo.php';

class Pedido extends Modelo
{
    /**
     * Devuelve pedidos de una fecha como mapa: { clientId: { items, notes } }
     */
    public function getByDate(string $date)
    {
        // Una sola query con JOIN para evitar N+1
        $rows = $this->query(
            'SELECT o.id, o.id_cliente, o.notas AS notes, o.id_comercial, o.cc_aprox, o.observaciones, o.estado,
                    com.nombre as comercial_name,
                    oi.nombre_producto AS item_name, oi.cantidad AS quantity
             FROM pedidos o
             LEFT JOIN comerciales com ON com.id = o.id_comercial
             LEFT JOIN pedido_lineas oi ON oi.id_pedido = o.id
             WHERE o.fecha_pedido = ?
             ORDER BY o.id_cliente, oi.id',
            [$date]
        )->fetchAll();

        $result = [];
        foreach ($rows as $row) {
            $cid = $row['id_cliente'];
            if (!isset($result[$cid])) {
                $result[$cid] = [
                    'id'              => (int) $row['id'],
                    'items'           => [],
                    'notes'           => $row['notes'] ?? '',
                    'id_comercial'    => $row['id_comercial'] ? (int) $row['id_comercial'] : null,
                    'comercial_name'  => $row['comercial_name'] ?? null,
                    'cc_aprox'        => $row['cc_aprox'] !== null ? (float) $row['cc_aprox'] : null,
                    'observaciones'   => $row['observaciones'] ?? '',
                    'estado'          => $row['estado'] ?? 'pendiente',
                ];
            }
            if (!empty($row['item_name'])) {
                $result[$cid]['items'][] = ['name' => $row['item_name'], 'qty' => (int) $row['quantity']];
            }
        }

        return $result;
    }

    /**
     * Devuelve pedidos del dia para un comercial (lista plana con datos de cliente).
     */
    public function getComercialDayOrders(string $date, array $comercialIds)
    {
        if (empty($comercialIds)) return [];

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));
        $params = array_merge([$date], $comercialIds);

        $rows = $this->query(
            "SELECT o.id, o.id_cliente, o.notas AS notes, o.id_comercial, o.cc_aprox, o.observaciones, o.estado,
                    o.created_at, o.id_direccion,
                    c.nombre as client_name,
                    COALESCE(de.direccion, c.direccion) as client_address,
                    COALESCE(de.codigo_postal, c.codigo_postal) as client_postcode,
                    de.descripcion AS direccion_descripcion,
                    com.nombre as comercial_name
             FROM pedidos o
             JOIN clientes c ON c.id = o.id_cliente
             LEFT JOIN direcciones_entrega de ON de.id = o.id_direccion
             LEFT JOIN comerciales com ON com.id = o.id_comercial
             WHERE o.fecha_pedido = ? AND o.id_comercial IN ($placeholders)
             ORDER BY o.created_at DESC",
            $params
        )->fetchAll();

        $result = [];
        foreach ($rows as $row) {
            $items = $this->query(
                'SELECT nombre_producto AS item_name, cantidad AS quantity FROM pedido_lineas WHERE id_pedido = ?',
                [$row['id']]
            )->fetchAll();

            $result[] = [
                'id'              => (int) $row['id'],
                'id_cliente'       => (int) $row['id_cliente'],
                'client_name'     => $row['client_name'],
                'client_address'  => $row['client_address'] ?? '',
                'client_postcode' => $row['client_postcode'] ?? '',
                'id_direccion'    => $row['id_direccion'] ? (int) $row['id_direccion'] : null,
                'direccion_descripcion' => $row['direccion_descripcion'] ?? null,
                'items'           => array_map(function ($it) {
                    return ['name' => $it['item_name'], 'qty' => (int) $it['quantity']];
                }, $items),
                'notes'           => $row['notes'] ?? '',
                'id_comercial'    => $row['id_comercial'] ? (int) $row['id_comercial'] : null,
                'comercial_name'  => $row['comercial_name'] ?? null,
                'cc_aprox'        => $row['cc_aprox'] !== null ? (float) $row['cc_aprox'] : null,
                'observaciones'   => $row['observaciones'] ?? '',
                'estado'          => $row['estado'] ?? 'pendiente',
                'created_at'      => $row['created_at'] ?? '',
            ];
        }

        return $result;
    }

    /**
     * Cambia el estado de un pedido.
     */
    public function updateEstado(int $id, string $estado)
    {
        $valid = ['pendiente', 'confirmado', 'anulado'];
        if (!in_array($estado, $valid)) {
            throw new \InvalidArgumentException('Estado no valido: ' . $estado);
        }
        $this->query('UPDATE pedidos SET estado = ? WHERE id = ?', [$estado, $id]);
    }

    /**
     * Obtiene un pedido por ID.
     */
    public function getById(int $id)
    {
        return $this->query(
            'SELECT id, id_cliente, id_comercial, fecha_pedido AS order_date, notas AS notes,
                    cc_aprox, observaciones, estado,
                    creado_el AS created_at, actualizado_el AS updated_at
             FROM pedidos WHERE id = ?',
            [$id]
        )->fetch();
    }

    /**
     * Crea o actualiza un pedido para un cliente en una fecha.
     */
    public function createOrUpdate(int $clientId, string $date, array $items, string $notes,
                                    ?int $comercialId = null, ?float $ccAprox = null, ?string $observaciones = null,
                                    string $estado = 'pendiente', ?int $idDireccion = null)
    {
        $db = $this->db();
        $db->beginTransaction();

        try {
            // Buscar pedido existente
            $existing = $this->query(
                'SELECT id FROM pedidos WHERE id_cliente = ? AND fecha_pedido = ?',
                [$clientId, $date]
            )->fetch();

            if ($existing) {
                $orderId = (int) $existing['id'];
                $this->query(
                    'UPDATE pedidos SET notas = ?, id_comercial = ?, cc_aprox = ?, observaciones = ?, estado = ?, id_direccion = ? WHERE id = ?',
                    [$notes, $comercialId, $ccAprox, $observaciones, $estado, $idDireccion, $orderId]
                );
                $this->query('DELETE FROM pedido_lineas WHERE id_pedido = ?', [$orderId]);
            } else {
                $this->query(
                    'INSERT INTO pedidos (id_cliente, fecha_pedido, notas, id_comercial, cc_aprox, observaciones, estado, id_direccion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [$clientId, $date, $notes, $comercialId, $ccAprox, $observaciones, $estado, $idDireccion]
                );
                $orderId = (int) $db->lastInsertId();
            }

            foreach ($items as $item) {
                $name = $item['name'] ?? '';
                $qty  = (int) ($item['qty'] ?? 1);
                if ($name !== '') {
                    $this->query(
                        'INSERT INTO pedido_lineas (id_pedido, nombre_producto, cantidad) VALUES (?, ?, ?)',
                        [$orderId, $name, $qty]
                    );
                }
            }

            $db->commit();
            return $orderId;
        } catch (Exception $e) {
            $db->rollBack();
            throw $e;
        }
    }

    public function deleteByClientAndDate(int $clientId, string $date)
    {
        $this->query(
            'DELETE FROM pedidos WHERE id_cliente = ? AND fecha_pedido = ?',
            [$clientId, $date]
        );
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM pedidos WHERE id = ?', [$id]);
    }

    /**
     * Pedidos confirmados de una fecha agrupados por ruta, con alertas.
     * Devuelve array de rutas con sus pedidos y warnings.
     */
    public function getConfirmedByDateGroupedByRuta(string $date): array
    {
        $rows = $this->query(
            "SELECT o.id as id_pedido, o.id_cliente, o.notas AS notes, o.id_comercial, o.cc_aprox,
                    o.observaciones, o.estado, o.id_direccion,
                    c.nombre as client_name,
                    COALESCE(de.direccion, c.direccion) as client_address,
                    COALESCE(de.codigo_postal, c.codigo_postal) as client_postcode,
                    COALESCE(de.x, c.x) as client_x, COALESCE(de.y, c.y) as client_y,
                    de.descripcion AS direccion_descripcion,
                    c.id_ruta, c.al_contado,
                    r.nombre as ruta_name,
                    com.nombre as comercial_name
             FROM pedidos o
             JOIN clientes c ON c.id = o.id_cliente
             LEFT JOIN direcciones_entrega de ON de.id = o.id_direccion
             LEFT JOIN rutas r ON r.id = c.id_ruta
             LEFT JOIN comerciales com ON com.id = o.id_comercial
             WHERE o.fecha_pedido = ? AND o.estado = 'confirmado'
             ORDER BY r.nombre, c.nombre",
            [$date]
        )->fetchAll();

        // Agrupar por id_ruta
        $rutas = [];
        $sinRuta = [];
        $alertas = [];

        foreach ($rows as $row) {
            $rutaId = $row['id_ruta'] ? (int) $row['id_ruta'] : null;

            $pedido = [
                'id_pedido'        => (int) $row['id_pedido'],
                'id_cliente'       => (int) $row['id_cliente'],
                'client_name'     => $row['client_name'],
                'client_address'  => $row['client_address'] ?? '',
                'client_postcode' => $row['client_postcode'] ?? '',
                'client_x'        => $row['client_x'],
                'client_y'        => $row['client_y'],
                'id_direccion'    => $row['id_direccion'] ? (int) $row['id_direccion'] : null,
                'direccion_descripcion' => $row['direccion_descripcion'] ?? null,
                'id_comercial'    => $row['id_comercial'] ? (int) $row['id_comercial'] : null,
                'comercial_name'  => $row['comercial_name'] ?? '',
                'cc_aprox'        => $row['cc_aprox'] !== null ? (float) $row['cc_aprox'] : null,
                'observaciones'   => $row['observaciones'] ?? '',
                'al_contado'      => (int) ($row['al_contado'] ?? 0),
            ];

            // Alertas
            if (!$row['client_x'] || !$row['client_y']) {
                $alertas[] = ['tipo' => 'sin_coordenadas', 'client_name' => $row['client_name'], 'id_cliente' => (int) $row['id_cliente']];
            }
            $cp = trim($row['client_postcode'] ?? '');
            if (!$cp || strlen($cp) < 4) {
                $alertas[] = ['tipo' => 'sin_cp', 'client_name' => $row['client_name'], 'id_cliente' => (int) $row['id_cliente']];
            }

            if (!$rutaId) {
                $sinRuta[] = $pedido;
                $alertas[] = ['tipo' => 'sin_ruta', 'client_name' => $row['client_name'], 'id_cliente' => (int) $row['id_cliente']];
            } else {
                if (!isset($rutas[$rutaId])) {
                    $rutas[$rutaId] = [
                        'id_ruta'   => $rutaId,
                        'ruta_name' => $row['ruta_name'] ?? 'Ruta ' . $rutaId,
                        'pedidos'   => [],
                    ];
                }
                $rutas[$rutaId]['pedidos'][] = $pedido;
            }
        }

        return [
            'rutas'    => array_values($rutas),
            'sin_ruta' => $sinRuta,
            'alertas'  => $alertas,
            'total_pedidos' => count($rows),
        ];
    }

    /**
     * Resumen rapido: pedidos por estado para una fecha.
     */
    public function getResumenByDate(string $date): array
    {
        $rows = $this->query(
            "SELECT o.estado, COUNT(*) as total
             FROM pedidos o
             WHERE o.fecha_pedido = ?
             GROUP BY o.estado",
            [$date]
        )->fetchAll();

        $result = ['pendiente' => 0, 'confirmado' => 0, 'anulado' => 0];
        foreach ($rows as $row) {
            $result[$row['estado']] = (int) $row['total'];
        }
        return $result;
    }
}

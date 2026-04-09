<?php

require_once __DIR__ . '/../core/Model.php';

class Order extends Model
{
    /**
     * Devuelve pedidos de una fecha como mapa: { clientId: { items, notes } }
     */
    public function getByDate(string $date)
    {
        $rows = $this->query(
            'SELECT o.id, o.client_id, o.notes, o.comercial_id, o.cc_aprox, o.observaciones, o.estado,
                    com.name as comercial_name
             FROM orders o
             LEFT JOIN comerciales com ON com.id = o.comercial_id
             WHERE o.order_date = ?',
            [$date]
        )->fetchAll();

        $result = [];
        foreach ($rows as $row) {
            $items = $this->query(
                'SELECT item_name, quantity FROM order_items WHERE order_id = ?',
                [$row['id']]
            )->fetchAll();

            $result[$row['client_id']] = [
                'id'              => (int) $row['id'],
                'items'           => array_map(function ($it) {
                    return ['name' => $it['item_name'], 'qty' => (int) $it['quantity']];
                }, $items),
                'notes'           => $row['notes'] ?? '',
                'comercial_id'    => $row['comercial_id'] ? (int) $row['comercial_id'] : null,
                'comercial_name'  => $row['comercial_name'] ?? null,
                'cc_aprox'        => $row['cc_aprox'] !== null ? (float) $row['cc_aprox'] : null,
                'observaciones'   => $row['observaciones'] ?? '',
                'estado'          => $row['estado'] ?? 'pendiente',
            ];
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
            "SELECT o.id, o.client_id, o.notes, o.comercial_id, o.cc_aprox, o.observaciones, o.estado,
                    o.created_at,
                    c.name as client_name, c.address as client_address, c.postcode as client_postcode,
                    com.name as comercial_name
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             LEFT JOIN comerciales com ON com.id = o.comercial_id
             WHERE o.order_date = ? AND o.comercial_id IN ($placeholders)
             ORDER BY o.created_at DESC",
            $params
        )->fetchAll();

        $result = [];
        foreach ($rows as $row) {
            $items = $this->query(
                'SELECT item_name, quantity FROM order_items WHERE order_id = ?',
                [$row['id']]
            )->fetchAll();

            $result[] = [
                'id'              => (int) $row['id'],
                'client_id'       => (int) $row['client_id'],
                'client_name'     => $row['client_name'],
                'client_address'  => $row['client_address'] ?? '',
                'client_postcode' => $row['client_postcode'] ?? '',
                'items'           => array_map(function ($it) {
                    return ['name' => $it['item_name'], 'qty' => (int) $it['quantity']];
                }, $items),
                'notes'           => $row['notes'] ?? '',
                'comercial_id'    => $row['comercial_id'] ? (int) $row['comercial_id'] : null,
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
        $this->query('UPDATE orders SET estado = ? WHERE id = ?', [$estado, $id]);
    }

    /**
     * Obtiene un pedido por ID.
     */
    public function getById(int $id)
    {
        return $this->query('SELECT * FROM orders WHERE id = ?', [$id])->fetch();
    }

    /**
     * Crea o actualiza un pedido para un cliente en una fecha.
     */
    public function createOrUpdate(int $clientId, string $date, array $items, string $notes,
                                    ?int $comercialId = null, ?float $ccAprox = null, ?string $observaciones = null,
                                    string $estado = 'pendiente')
    {
        $db = $this->db();
        $db->beginTransaction();

        try {
            // Buscar pedido existente
            $existing = $this->query(
                'SELECT id FROM orders WHERE client_id = ? AND order_date = ?',
                [$clientId, $date]
            )->fetch();

            if ($existing) {
                $orderId = (int) $existing['id'];
                $this->query(
                    'UPDATE orders SET notes = ?, comercial_id = ?, cc_aprox = ?, observaciones = ?, estado = ? WHERE id = ?',
                    [$notes, $comercialId, $ccAprox, $observaciones, $estado, $orderId]
                );
                $this->query('DELETE FROM order_items WHERE order_id = ?', [$orderId]);
            } else {
                $this->query(
                    'INSERT INTO orders (client_id, order_date, notes, comercial_id, cc_aprox, observaciones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$clientId, $date, $notes, $comercialId, $ccAprox, $observaciones, $estado]
                );
                $orderId = (int) $db->lastInsertId();
            }

            foreach ($items as $item) {
                $name = $item['name'] ?? '';
                $qty  = (int) ($item['qty'] ?? 1);
                if ($name !== '') {
                    $this->query(
                        'INSERT INTO order_items (order_id, item_name, quantity) VALUES (?, ?, ?)',
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
            'DELETE FROM orders WHERE client_id = ? AND order_date = ?',
            [$clientId, $date]
        );
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM orders WHERE id = ?', [$id]);
    }

    /**
     * Pedidos confirmados de una fecha agrupados por ruta, con alertas.
     * Devuelve array de rutas con sus pedidos y warnings.
     */
    public function getConfirmedByDateGroupedByRuta(string $date): array
    {
        $rows = $this->query(
            "SELECT o.id as order_id, o.client_id, o.notes, o.comercial_id, o.cc_aprox,
                    o.observaciones, o.estado,
                    c.name as client_name, c.address as client_address,
                    c.postcode as client_postcode, c.x as client_x, c.y as client_y,
                    c.ruta_id, c.al_contado,
                    r.name as ruta_name,
                    com.name as comercial_name
             FROM orders o
             JOIN clients c ON c.id = o.client_id
             LEFT JOIN rutas r ON r.id = c.ruta_id
             LEFT JOIN comerciales com ON com.id = o.comercial_id
             WHERE o.order_date = ? AND o.estado = 'confirmado'
             ORDER BY r.name, c.name",
            [$date]
        )->fetchAll();

        // Agrupar por ruta_id
        $rutas = [];
        $sinRuta = [];
        $alertas = [];

        foreach ($rows as $row) {
            $rutaId = $row['ruta_id'] ? (int) $row['ruta_id'] : null;

            $pedido = [
                'order_id'        => (int) $row['order_id'],
                'client_id'       => (int) $row['client_id'],
                'client_name'     => $row['client_name'],
                'client_address'  => $row['client_address'] ?? '',
                'client_postcode' => $row['client_postcode'] ?? '',
                'client_x'        => $row['client_x'],
                'client_y'        => $row['client_y'],
                'comercial_id'    => $row['comercial_id'] ? (int) $row['comercial_id'] : null,
                'comercial_name'  => $row['comercial_name'] ?? '',
                'cc_aprox'        => $row['cc_aprox'] !== null ? (float) $row['cc_aprox'] : null,
                'observaciones'   => $row['observaciones'] ?? '',
                'al_contado'      => (int) ($row['al_contado'] ?? 0),
            ];

            // Alertas
            if (!$row['client_x'] || !$row['client_y']) {
                $alertas[] = ['tipo' => 'sin_coordenadas', 'client_name' => $row['client_name'], 'client_id' => (int) $row['client_id']];
            }
            $cp = trim($row['client_postcode'] ?? '');
            if (!$cp || strlen($cp) < 4) {
                $alertas[] = ['tipo' => 'sin_cp', 'client_name' => $row['client_name'], 'client_id' => (int) $row['client_id']];
            }

            if (!$rutaId) {
                $sinRuta[] = $pedido;
                $alertas[] = ['tipo' => 'sin_ruta', 'client_name' => $row['client_name'], 'client_id' => (int) $row['client_id']];
            } else {
                if (!isset($rutas[$rutaId])) {
                    $rutas[$rutaId] = [
                        'ruta_id'   => $rutaId,
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
             FROM orders o
             WHERE o.order_date = ?
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

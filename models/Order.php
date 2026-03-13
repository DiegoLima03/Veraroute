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
            'SELECT o.id, o.client_id, o.notes
             FROM orders o
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
                'id'    => (int) $row['id'],
                'items' => array_map(function ($it) {
                    return ['name' => $it['item_name'], 'qty' => (int) $it['quantity']];
                }, $items),
                'notes' => $row['notes'] ?? '',
            ];
        }

        return $result;
    }

    /**
     * Crea o actualiza un pedido para un cliente en una fecha.
     */
    public function createOrUpdate(int $clientId, string $date, array $items, string $notes)
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
                $this->query('UPDATE orders SET notes = ? WHERE id = ?', [$notes, $orderId]);
                $this->query('DELETE FROM order_items WHERE order_id = ?', [$orderId]);
            } else {
                $this->query(
                    'INSERT INTO orders (client_id, order_date, notes) VALUES (?, ?, ?)',
                    [$clientId, $date, $notes]
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
}

<?php

require_once __DIR__ . '/../core/Model.php';

class Client extends Model
{
    public function getAll()
    {
        return $this->query('SELECT * FROM clients WHERE is_depot = 0 ORDER BY name')->fetchAll();
    }

    public function getById(int $id)
    {
        return $this->query('SELECT * FROM clients WHERE id = ?', [$id])->fetch() ?: null;
    }

    public function getDepot()
    {
        return $this->query('SELECT * FROM clients WHERE is_depot = 1 LIMIT 1')->fetch() ?: null;
    }

    public function updateDepot(array $data)
    {
        $depot = $this->getDepot();
        if ($depot) {
            $this->query(
                'UPDATE clients SET name = ?, address = ?, phone = ?, notes = ?, x = ?, y = ?, open_time = ?, close_time = ?
                 WHERE id = ?',
                [
                    $data['name'] ?? $depot['name'],
                    $data['address'] ?? $depot['address'],
                    $data['phone'] ?? $depot['phone'],
                    $data['notes'] ?? $depot['notes'],
                    $data['x'] ?? $depot['x'],
                    $data['y'] ?? $depot['y'],
                    $data['open_time'] ?? $depot['open_time'],
                    $data['close_time'] ?? $depot['close_time'],
                    $depot['id'],
                ]
            );
            return $depot['id'];
        } else {
            $this->query(
                'INSERT INTO clients (name, address, phone, notes, is_depot, x, y, open_time, close_time)
                 VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)',
                [
                    $data['name'] ?? 'Base',
                    $data['address'] ?? '',
                    $data['phone'] ?? '',
                    $data['notes'] ?? '',
                    $data['x'],
                    $data['y'],
                    $data['open_time'] ?? '00:00',
                    $data['close_time'] ?? '23:59',
                ]
            );
            return (int) $this->db()->lastInsertId();
        }
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO clients (name, address, phone, notes, x, y, open_time, close_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '09:00',
                $data['close_time'] ?? '18:00',
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE clients SET name = ?, address = ?, phone = ?, notes = ?, x = ?, y = ?, open_time = ?, close_time = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '09:00',
                $data['close_time'] ?? '18:00',
                $id,
            ]
        );
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM clients WHERE id = ? AND is_depot = 0', [$id]);
    }

    public function truncate()
    {
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 0');
        $this->db()->exec('TRUNCATE TABLE order_items');
        $this->db()->exec('TRUNCATE TABLE orders');
        $this->db()->exec('DELETE FROM clients WHERE is_depot = 0');
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 1');
    }
}

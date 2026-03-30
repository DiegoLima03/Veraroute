<?php

require_once __DIR__ . '/../core/Model.php';

class Client extends Model
{
    public function getAll()
    {
        return $this->query(
            'SELECT c.*, r.name as ruta_name, com.name as comercial_name FROM clients c LEFT JOIN rutas r ON c.ruta_id = r.id LEFT JOIN comerciales com ON com.id = c.comercial_id ORDER BY c.active DESC, c.name'
        )->fetchAll();
    }

    public function toggleActive(int $id)
    {
        $this->query('UPDATE clients SET active = NOT active WHERE id = ?', [$id]);
    }

    public function getById(int $id)
    {
        return $this->query('SELECT * FROM clients WHERE id = ?', [$id])->fetch() ?: null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO clients (name, address, phone, notes, x, y, open_time, close_time, open_time_2, close_time_2, ruta_id, al_contado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '09:00',
                $data['close_time'] ?? '18:00',
                $data['open_time_2'] ?: null,
                $data['close_time_2'] ?: null,
                $data['ruta_id'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE clients SET name = ?, address = ?, phone = ?, notes = ?, x = ?, y = ?, open_time = ?, close_time = ?, open_time_2 = ?, close_time_2 = ?, ruta_id = ?, al_contado = ?
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
                $data['open_time_2'] ?: null,
                $data['close_time_2'] ?: null,
                $data['ruta_id'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
                $id,
            ]
        );
    }

    public function setContado(int $id, bool $contado)
    {
        $this->query('UPDATE clients SET al_contado = ? WHERE id = ?', [$contado ? 1 : 0, $id]);
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM clients WHERE id = ?', [$id]);
    }

    public function truncate()
    {
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 0');
        $this->db()->exec('TRUNCATE TABLE order_items');
        $this->db()->exec('TRUNCATE TABLE orders');
        $this->db()->exec('TRUNCATE TABLE clients');
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 1');
    }
}

<?php

require_once __DIR__ . '/../core/Model.php';

class Product extends Model
{
    public function getAll()
    {
        return $this->query('SELECT * FROM products ORDER BY name')->fetchAll();
    }

    public function getById(int $id)
    {
        return $this->query('SELECT * FROM products WHERE id = ?', [$id])->fetch() ?: null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO products (name, weight_kg, volume_m3, unload_time_min)
             VALUES (?, ?, ?, ?)',
            [
                $data['name'],
                $data['weight_kg'] ?? 0,
                $data['volume_m3'] ?? 0,
                $data['unload_time_min'] ?? 1,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE products SET name = ?, weight_kg = ?, volume_m3 = ?, unload_time_min = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['weight_kg'] ?? 0,
                $data['volume_m3'] ?? 0,
                $data['unload_time_min'] ?? 1,
                $id,
            ]
        );
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM products WHERE id = ?', [$id]);
    }
}

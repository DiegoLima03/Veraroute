<?php

require_once __DIR__ . '/../core/Model.php';

class Vehicle extends Model
{
    public function getAll()
    {
        return $this->query(
            'SELECT v.*, d.name AS delegation_name
             FROM vehicles v
             JOIN delegations d ON v.delegation_id = d.id
             WHERE v.active = 1
             ORDER BY d.name, v.name'
        )->fetchAll();
    }

    public function getAllIncludingInactive()
    {
        return $this->query(
            'SELECT v.*, d.name AS delegation_name
             FROM vehicles v
             JOIN delegations d ON v.delegation_id = d.id
             ORDER BY v.active DESC, d.name, v.name'
        )->fetchAll();
    }

    public function getByDelegation(int $delegationId)
    {
        return $this->query(
            'SELECT * FROM vehicles WHERE delegation_id = ? AND active = 1 ORDER BY name',
            [$delegationId]
        )->fetchAll();
    }

    public function getById(int $id)
    {
        return $this->query(
            'SELECT v.*, d.name AS delegation_name
             FROM vehicles v
             JOIN delegations d ON v.delegation_id = d.id
             WHERE v.id = ?',
            [$id]
        )->fetch() ?: null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO vehicles (name, plate, delegation_id, max_weight_kg, max_volume_m3, max_items, cost_per_km)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['plate'] ?? '',
                (int) $data['delegation_id'],
                $data['max_weight_kg'] ?? null,
                $data['max_volume_m3'] ?? null,
                $data['max_items'] ?? null,
                $data['cost_per_km'] ?? 0,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE vehicles SET name = ?, plate = ?, delegation_id = ?, max_weight_kg = ?, max_volume_m3 = ?, max_items = ?, cost_per_km = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['plate'] ?? '',
                (int) $data['delegation_id'],
                $data['max_weight_kg'] ?? null,
                $data['max_volume_m3'] ?? null,
                $data['max_items'] ?? null,
                $data['cost_per_km'] ?? 0,
                $id,
            ]
        );
    }

    public function toggleActive(int $id)
    {
        $this->query('UPDATE vehicles SET active = NOT active WHERE id = ?', [$id]);
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM vehicles WHERE id = ?', [$id]);
    }
}

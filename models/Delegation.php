<?php

require_once __DIR__ . '/../core/Model.php';

class Delegation extends Model
{
    public function getAll()
    {
        return $this->normalizeTextRows(
            $this->query('SELECT * FROM delegations WHERE active = 1 ORDER BY name')->fetchAll()
        );
    }

    public function getAllIncludingInactive()
    {
        return $this->normalizeTextRows(
            $this->query('SELECT * FROM delegations ORDER BY active DESC, name')->fetchAll()
        );
    }

    public function getById(int $id)
    {
        $row = $this->query('SELECT * FROM delegations WHERE id = ?', [$id])->fetch() ?: null;
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO delegations (name, address, phone, notes, x, y, open_time, close_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '06:00',
                $data['close_time'] ?? '22:00',
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE delegations SET name = ?, address = ?, phone = ?, notes = ?, x = ?, y = ?, open_time = ?, close_time = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '06:00',
                $data['close_time'] ?? '22:00',
                $id,
            ]
        );
    }

    public function toggleActive(int $id)
    {
        $this->query('UPDATE delegations SET active = NOT active WHERE id = ?', [$id]);
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM delegations WHERE id = ?', [$id]);
    }
}

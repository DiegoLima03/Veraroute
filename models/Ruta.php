<?php

require_once __DIR__ . '/../core/Model.php';

class Ruta extends Model
{
    public function getAll()
    {
        return $this->query(
            'SELECT r.*, (SELECT COUNT(*) FROM clients c WHERE c.ruta_id = r.id) as client_count
             FROM rutas r ORDER BY r.name'
        )->fetchAll();
    }

    public function getById(int $id)
    {
        return $this->query('SELECT * FROM rutas WHERE id = ?', [$id])->fetch() ?: null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO rutas (name) VALUES (?)',
            [$data['name']]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE rutas SET name = ? WHERE id = ?',
            [$data['name'], $id]
        );
    }

    public function delete(int $id)
    {
        $this->query('UPDATE clients SET ruta_id = NULL WHERE ruta_id = ?', [$id]);
        $this->query('DELETE FROM rutas WHERE id = ?', [$id]);
    }
}

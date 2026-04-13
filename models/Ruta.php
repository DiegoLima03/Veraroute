<?php

require_once __DIR__ . '/../core/Model.php';

class Ruta extends Model
{
    private function normalizeColor($color): ?string
    {
        $color = trim((string) $color);
        if ($color === '') {
            return null;
        }

        if (preg_match('/^#([0-9a-f]{6})$/i', $color, $matches)) {
            return '#' . strtolower($matches[1]);
        }

        return null;
    }

    public function getAll()
    {
        return $this->query(
            'SELECT r.*, (SELECT COUNT(DISTINCT c.id)
                           FROM clients c
                           LEFT JOIN client_rutas cr ON cr.client_id = c.id AND cr.ruta_id = r.id
                           WHERE c.ruta_id = r.id OR cr.ruta_id IS NOT NULL) as client_count
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
            'INSERT INTO rutas (name, color) VALUES (?, ?)',
            [
                $data['name'],
                $this->normalizeColor($data['color'] ?? null),
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $fields = ['name = ?'];
        $params = [$data['name']];

        if (array_key_exists('color', $data)) {
            $fields[] = 'color = ?';
            $params[] = $this->normalizeColor($data['color']);
        }

        $params[] = $id;
        $this->query('UPDATE rutas SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
    }

    public function delete(int $id)
    {
        $this->query('UPDATE clients SET ruta_id = NULL WHERE ruta_id = ?', [$id]);
        $this->query('DELETE FROM rutas WHERE id = ?', [$id]);
    }
}

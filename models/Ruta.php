<?php

require_once __DIR__ . '/../core/Modelo.php';

class Ruta extends Modelo
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
            'SELECT r.id, r.nombre AS name, r.color, r.activo AS active,
                    r.creado_el AS created_at, r.actualizado_el AS updated_at,
                    (SELECT COUNT(DISTINCT c.id)
                           FROM clientes c
                           LEFT JOIN cliente_rutas cr ON cr.id_cliente = c.id AND cr.id_ruta = r.id
                           WHERE c.id_ruta = r.id OR cr.id_ruta IS NOT NULL) as client_count
             FROM rutas r ORDER BY r.nombre'
        )->fetchAll();
    }

    public function getById(int $id)
    {
        return $this->query(
            'SELECT id, nombre AS name, color, activo AS active,
                    creado_el AS created_at, actualizado_el AS updated_at
             FROM rutas WHERE id = ?',
            [$id]
        )->fetch() ?: null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO rutas (nombre, color) VALUES (?, ?)',
            [
                $data['name'],
                $this->normalizeColor($data['color'] ?? null),
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $fields = ['nombre = ?'];
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
        $this->query('UPDATE clientes SET id_ruta = NULL WHERE id_ruta = ?', [$id]);
        $this->query('DELETE FROM rutas WHERE id = ?', [$id]);
    }
}

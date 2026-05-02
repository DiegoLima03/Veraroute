<?php

require_once __DIR__ . '/../core/Modelo.php';

class Delegacion extends Modelo
{
    private const SELECT_COMPAT = 'id, nombre AS name, direccion AS address, telefono AS phone, notas AS notes, x, y,
            hora_apertura AS open_time, hora_cierre AS close_time, activo AS active,
            creado_el AS created_at, actualizado_el AS updated_at';

    public function getAll()
    {
        return $this->normalizeTextRows(
            $this->query('SELECT ' . self::SELECT_COMPAT . ' FROM delegaciones WHERE activo = 1 ORDER BY nombre')->fetchAll()
        );
    }

    public function getAllIncludingInactive()
    {
        return $this->normalizeTextRows(
            $this->query('SELECT ' . self::SELECT_COMPAT . ' FROM delegaciones ORDER BY activo DESC, nombre')->fetchAll()
        );
    }

    public function getById(int $id)
    {
        $row = $this->query('SELECT ' . self::SELECT_COMPAT . ' FROM delegaciones WHERE id = ?', [$id])->fetch() ?: null;
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO delegaciones (nombre, direccion, telefono, notas, x, y, hora_apertura, hora_cierre)
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
            'UPDATE delegaciones SET nombre = ?, direccion = ?, telefono = ?, notas = ?, x = ?, y = ?, hora_apertura = ?, hora_cierre = ?
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
        $this->query('UPDATE delegaciones SET activo = NOT activo WHERE id = ?', [$id]);
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM delegaciones WHERE id = ?', [$id]);
    }
}

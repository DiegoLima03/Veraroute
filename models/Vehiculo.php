<?php

require_once __DIR__ . '/../core/Modelo.php';

class Vehiculo extends Modelo
{
    private const SELECT_COMPAT = 'v.id, v.nombre AS name, v.matricula AS plate, v.id_delegacion AS id_delegacion,
            v.max_weight_kg, v.max_volume_m3, v.max_items, v.cost_per_km, v.activo AS active,
            v.creado_el AS created_at, v.actualizado_el AS updated_at';

    public function getAll()
    {
        return $this->normalizeTextRows($this->query(
            'SELECT ' . self::SELECT_COMPAT . ', d.nombre AS delegation_name
             FROM vehiculos v
             JOIN delegaciones d ON v.id_delegacion = d.id
             WHERE v.activo = 1
             ORDER BY d.nombre, v.nombre'
        )->fetchAll());
    }

    public function getAllIncludingInactive()
    {
        return $this->normalizeTextRows($this->query(
            'SELECT ' . self::SELECT_COMPAT . ', d.nombre AS delegation_name
             FROM vehiculos v
             JOIN delegaciones d ON v.id_delegacion = d.id
             ORDER BY v.activo DESC, d.nombre, v.nombre'
        )->fetchAll());
    }

    public function getByDelegation(int $delegationId)
    {
        return $this->normalizeTextRows($this->query(
            'SELECT ' . self::SELECT_COMPAT . '
             FROM vehiculos v
             WHERE v.id_delegacion = ? AND v.activo = 1
             ORDER BY v.nombre',
            [$delegationId]
        )->fetchAll());
    }

    public function getById(int $id)
    {
        $row = $this->query(
            'SELECT ' . self::SELECT_COMPAT . ', d.nombre AS delegation_name
             FROM vehiculos v
             JOIN delegaciones d ON v.id_delegacion = d.id
             WHERE v.id = ?',
            [$id]
        )->fetch() ?: null;

        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO vehiculos (nombre, matricula, id_delegacion, max_weight_kg, max_volume_m3, max_items, cost_per_km)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['plate'] ?? '',
                (int) $data['id_delegacion'],
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
            'UPDATE vehiculos SET nombre = ?, matricula = ?, id_delegacion = ?, max_weight_kg = ?, max_volume_m3 = ?, max_items = ?, cost_per_km = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['plate'] ?? '',
                (int) $data['id_delegacion'],
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
        $this->query('UPDATE vehiculos SET activo = NOT activo WHERE id = ?', [$id]);
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM vehiculos WHERE id = ?', [$id]);
    }
}

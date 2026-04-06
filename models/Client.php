<?php

require_once __DIR__ . '/../core/Model.php';

class Client extends Model
{
    public function getAll()
    {
        $clients = $this->query(
            'SELECT c.*, r.name as ruta_name, com.name as comercial_name FROM clients c LEFT JOIN rutas r ON c.ruta_id = r.id LEFT JOIN comerciales com ON com.id = c.comercial_id ORDER BY c.active DESC, c.name'
        )->fetchAll();

        // Cargar rutas N:M de todos los clientes de golpe
        $allRutas = $this->query(
            'SELECT cr.client_id, cr.ruta_id, r.name as ruta_name
             FROM client_rutas cr
             JOIN rutas r ON r.id = cr.ruta_id
             ORDER BY r.name'
        )->fetchAll();

        $rutasByClient = [];
        foreach ($allRutas as $row) {
            $rutasByClient[(int) $row['client_id']][] = [
                'id'   => (int) $row['ruta_id'],
                'name' => $row['ruta_name'],
            ];
        }

        foreach ($clients as &$c) {
            $c['rutas'] = $rutasByClient[(int) $c['id']] ?? [];
        }

        return $clients;
    }

    public function getAllByComercialIds(array $comercialIds)
    {
        if (empty($comercialIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));

        return $this->query(
            "SELECT c.*, r.name as ruta_name, com.name as comercial_name
             FROM clients c
             LEFT JOIN rutas r ON c.ruta_id = r.id
             LEFT JOIN comerciales com ON com.id = c.comercial_id
             WHERE c.comercial_id IN ($placeholders)
             ORDER BY c.active DESC, c.name",
            array_values(array_map('intval', $comercialIds))
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
            'INSERT INTO clients (name, address, postcode, phone, notes, x, y, open_time, close_time, open_time_2, close_time_2, comercial_id, ruta_id, al_contado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['postcode'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '09:00',
                $data['close_time'] ?? '18:00',
                $data['open_time_2'] ?: null,
                $data['close_time_2'] ?: null,
                $data['comercial_id'] ?: null,
                $data['ruta_id'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE clients SET name = ?, address = ?, postcode = ?, phone = ?, notes = ?, x = ?, y = ?, open_time = ?, close_time = ?, open_time_2 = ?, close_time_2 = ?, comercial_id = ?, ruta_id = ?, al_contado = ?
             WHERE id = ?',
            [
                $data['name'],
                $data['address'] ?? '',
                $data['postcode'] ?? '',
                $data['phone'] ?? '',
                $data['notes'] ?? '',
                $data['x'],
                $data['y'],
                $data['open_time'] ?? '09:00',
                $data['close_time'] ?? '18:00',
                $data['open_time_2'] ?: null,
                $data['close_time_2'] ?: null,
                $data['comercial_id'] ?: null,
                $data['ruta_id'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
                $id,
            ]
        );
    }

    public function setRutas(int $clientId, array $rutaIds)
    {
        $this->query('DELETE FROM client_rutas WHERE client_id = ?', [$clientId]);
        foreach ($rutaIds as $rutaId) {
            if ($rutaId) {
                $this->query(
                    'INSERT IGNORE INTO client_rutas (client_id, ruta_id) VALUES (?, ?)',
                    [$clientId, (int) $rutaId]
                );
            }
        }
        // Mantener ruta_id principal (la primera) para retrocompatibilidad
        $first = !empty($rutaIds) ? (int) $rutaIds[0] : null;
        $this->query('UPDATE clients SET ruta_id = ? WHERE id = ?', [$first, $clientId]);
    }

    public function getRutas(int $clientId)
    {
        return $this->query(
            'SELECT cr.ruta_id as id, r.name FROM client_rutas cr JOIN rutas r ON r.id = cr.ruta_id WHERE cr.client_id = ? ORDER BY r.name',
            [$clientId]
        )->fetchAll();
    }

    public function setContado(int $id, bool $contado)
    {
        $this->query('UPDATE clients SET al_contado = ? WHERE id = ?', [$contado ? 1 : 0, $id]);
    }

    public function duplicate(int $id)
    {
        $src = $this->getById($id);
        if (!$src) return null;

        $newId = $this->create([
            'name'        => $src['name'] . ' (copia)',
            'address'     => $src['address'],
            'postcode'    => $src['postcode'],
            'phone'       => $src['phone'],
            'notes'       => $src['notes'],
            'x'           => $src['x'],
            'y'           => $src['y'],
            'open_time'   => $src['open_time'],
            'close_time'  => $src['close_time'],
            'open_time_2' => $src['open_time_2'],
            'close_time_2'=> $src['close_time_2'],
            'comercial_id'=> $src['comercial_id'],
            'ruta_id'     => $src['ruta_id'],
            'al_contado'  => $src['al_contado'],
        ]);

        // Copiar horarios
        $rows = $this->query(
            'SELECT day_of_week, open_time, close_time FROM client_schedules WHERE client_id = ?',
            [$id]
        )->fetchAll();
        foreach ($rows as $r) {
            $this->query(
                'INSERT INTO client_schedules (client_id, day_of_week, open_time, close_time) VALUES (?, ?, ?, ?)',
                [$newId, $r['day_of_week'], $r['open_time'], $r['close_time']]
            );
        }

        return $newId;
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

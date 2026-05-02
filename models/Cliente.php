<?php

require_once __DIR__ . '/../core/Modelo.php';
require_once __DIR__ . '/DireccionEntrega.php';

class Cliente extends Modelo
{
    private const SELECT_COMPAT = 'c.id, c.nombre AS name, c.nombre_fiscal AS fiscal_name, c.direccion AS address, c.codigo_postal AS postcode,
            c.telefono AS phone, c.notas AS notes, c.activo AS active,
            c.id_comercial AS id_comercial, c.id_comercial_planta AS id_comercial_planta,
            c.id_comercial_flor AS id_comercial_flor, c.id_comercial_accesorio AS id_comercial_accesorio,
            c.al_contado, c.id_ruta AS id_ruta, c.id_delegacion AS id_delegacion, c.x, c.y,
            c.hora_apertura AS open_time, c.hora_cierre AS close_time,
            c.hora_apertura_2 AS open_time_2, c.hora_cierre_2 AS close_time_2,
            c.tipo_zona, c.tipo_negocio,
            c.creado_el AS created_at, c.actualizado_el AS updated_at';

    private function commercialIdsFromClient(array $client): array
    {
        $ids = [];
        foreach (['id_comercial', 'id_comercial_planta', 'id_comercial_flor', 'id_comercial_accesorio'] as $field) {
            if (!empty($client[$field])) {
                $ids[] = (int) $client[$field];
            }
        }

        return array_values(array_unique($ids));
    }

    private function attachCommercialIds(array $client): array
    {
        $client['comercial_ids'] = $this->commercialIdsFromClient($client);
        return $client;
    }

    private function attachRutas(array &$clients): void
    {
        if (empty($clients)) {
            return;
        }

        $allRutas = $this->query(
            'SELECT cr.id_cliente AS id_cliente, cr.id_ruta AS id_ruta, r.nombre as ruta_name, r.color as ruta_color
             FROM cliente_rutas cr
             JOIN rutas r ON r.id = cr.id_ruta
             ORDER BY r.nombre'
        )->fetchAll();

        $rutasByClient = [];
        foreach ($allRutas as $row) {
            $rutasByClient[(int) $row['id_cliente']][] = [
                'id'   => (int) $row['id_ruta'],
                'name' => $row['ruta_name'],
                'color' => $row['ruta_color'] ?? null,
            ];
        }

        foreach ($clients as &$client) {
            $client['rutas'] = $rutasByClient[(int) $client['id']] ?? [];
        }
        unset($client);
    }

    public function getAll()
    {
        $clients = $this->query(
            'SELECT ' . self::SELECT_COMPAT . ', r.nombre as ruta_name, com.nombre as comercial_name FROM clientes c LEFT JOIN rutas r ON c.id_ruta = r.id LEFT JOIN comerciales com ON com.id = c.id_comercial ORDER BY c.activo DESC, c.nombre'
        )->fetchAll();
        foreach ($clients as &$client) {
            $client = $this->attachCommercialIds($client);
        }
        unset($client);
        $this->attachRutas($clients);

        // Adjuntar direcciones de entrega (carga masiva eficiente)
        $dirModel = new DireccionEntrega();
        $allDirecciones = $dirModel->getAllGroupedByCliente();
        foreach ($clients as &$client) {
            $client['direcciones'] = $allDirecciones[(int) $client['id']] ?? [];
        }
        unset($client);

        return $clients;
    }

    public function getAllByComercialIds(array $comercialIds)
    {
        if (empty($comercialIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($comercialIds), '?'));
        $ids = array_values(array_map('intval', $comercialIds));
        $params = array_merge($ids, $ids, $ids, $ids);

        $clients = $this->query(
            "SELECT " . self::SELECT_COMPAT . ", r.nombre as ruta_name, com.nombre as comercial_name
             FROM clientes c
             LEFT JOIN rutas r ON c.id_ruta = r.id
             LEFT JOIN comerciales com ON com.id = c.id_comercial
             WHERE (
                 c.id_comercial IN ($placeholders)
                 OR c.id_comercial_planta IN ($placeholders)
                 OR c.id_comercial_flor IN ($placeholders)
                 OR c.id_comercial_accesorio IN ($placeholders)
             )
             ORDER BY c.activo DESC, c.nombre",
            $params
        )->fetchAll();

        foreach ($clients as &$client) {
            $client = $this->attachCommercialIds($client);
        }
        unset($client);
        $this->attachRutas($clients);

        return $clients;
    }

    public function toggleActive(int $id)
    {
        $this->query('UPDATE clientes SET activo = NOT activo WHERE id = ?', [$id]);
    }

    public function getById(int $id)
    {
        $client = $this->query(
            'SELECT ' . self::SELECT_COMPAT . ', r.nombre as ruta_name, com.nombre as comercial_name
             FROM clientes c
             LEFT JOIN rutas r ON c.id_ruta = r.id
             LEFT JOIN comerciales com ON com.id = c.id_comercial
             WHERE c.id = ?',
            [$id]
        )->fetch();

        if (!$client) {
            return null;
        }

        $client = $this->attachCommercialIds($client);
        $client['rutas'] = $this->getRutas($id);

        // Adjuntar direcciones de entrega
        $dirModel = new DireccionEntrega();
        $client['direcciones'] = $dirModel->getByCliente($id);

        return $client;
    }

    public function create(array $data)
    {
        $this->query(
            'INSERT INTO clientes (nombre, direccion, codigo_postal, telefono, notas, x, y, hora_apertura, hora_cierre, hora_apertura_2, hora_cierre_2, id_comercial, id_comercial_planta, id_comercial_flor, id_comercial_accesorio, id_ruta, al_contado, tipo_zona, tipo_negocio)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                $data['id_comercial'] ?: null,
                $data['id_comercial_planta'] ?: null,
                $data['id_comercial_flor'] ?: null,
                $data['id_comercial_accesorio'] ?: null,
                $data['id_ruta'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
                $data['tipo_zona'] ?? 'villa',
                $data['tipo_negocio'] ?? 'tienda_especializada',
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function update(int $id, array $data)
    {
        $this->query(
            'UPDATE clientes SET nombre = ?, direccion = ?, codigo_postal = ?, telefono = ?, notas = ?, x = ?, y = ?, hora_apertura = ?, hora_cierre = ?, hora_apertura_2 = ?, hora_cierre_2 = ?, id_comercial = ?, id_comercial_planta = ?, id_comercial_flor = ?, id_comercial_accesorio = ?, id_ruta = ?, al_contado = ?, tipo_zona = ?, tipo_negocio = ?
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
                $data['id_comercial'] ?: null,
                $data['id_comercial_planta'] ?: null,
                $data['id_comercial_flor'] ?: null,
                $data['id_comercial_accesorio'] ?: null,
                $data['id_ruta'] ?: null,
                !empty($data['al_contado']) ? 1 : 0,
                $data['tipo_zona'] ?? 'villa',
                $data['tipo_negocio'] ?? 'tienda_especializada',
                $id,
            ]
        );
    }

    public function setRutas(int $clientId, array $rutaIds)
    {
        $this->query('DELETE FROM cliente_rutas WHERE id_cliente = ?', [$clientId]);
        foreach ($rutaIds as $rutaId) {
            if ($rutaId) {
                $this->query(
                    'INSERT IGNORE INTO cliente_rutas (id_cliente, id_ruta) VALUES (?, ?)',
                    [$clientId, (int) $rutaId]
                );
            }
        }
        // Mantener id_ruta principal (la primera) para retrocompatibilidad
        $first = !empty($rutaIds) ? (int) $rutaIds[0] : null;
        $this->query('UPDATE clientes SET id_ruta = ? WHERE id = ?', [$first, $clientId]);
    }

    public function getRutas(int $clientId)
    {
        return $this->query(
            'SELECT cr.id_ruta as id, r.nombre AS name, r.color FROM cliente_rutas cr JOIN rutas r ON r.id = cr.id_ruta WHERE cr.id_cliente = ? ORDER BY r.nombre',
            [$clientId]
        )->fetchAll();
    }

    public function setContado(int $id, bool $contado)
    {
        $this->query('UPDATE clientes SET al_contado = ? WHERE id = ?', [$contado ? 1 : 0, $id]);
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
            'id_comercial'=> $src['id_comercial'],
            'id_comercial_planta' => $src['id_comercial_planta'] ?? null,
            'id_comercial_flor' => $src['id_comercial_flor'] ?? null,
            'id_comercial_accesorio' => $src['id_comercial_accesorio'] ?? null,
            'id_ruta'     => $src['id_ruta'],
            'al_contado'  => $src['al_contado'],
            'tipo_zona'   => $src['tipo_zona'] ?? 'villa',
            'tipo_negocio'=> $src['tipo_negocio'] ?? 'tienda_especializada',
        ]);

        // Copiar horarios
        $rows = $this->query(
            'SELECT dia_semana, hora_apertura, hora_cierre FROM horarios_cliente WHERE id_cliente = ?',
            [$id]
        )->fetchAll();
        foreach ($rows as $r) {
            $this->query(
                'INSERT INTO horarios_cliente (id_cliente, dia_semana, hora_apertura, hora_cierre) VALUES (?, ?, ?, ?)',
                [$newId, $r['dia_semana'], $r['hora_apertura'], $r['hora_cierre']]
            );
        }

        return $newId;
    }

    public function delete(int $id)
    {
        $this->query('DELETE FROM clientes WHERE id = ?', [$id]);
    }

    public function truncate()
    {
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 0');
        $this->db()->exec('TRUNCATE TABLE pedido_lineas');
        $this->db()->exec('TRUNCATE TABLE pedidos');
        $this->db()->exec('TRUNCATE TABLE clientes');
        $this->db()->exec('SET FOREIGN_KEY_CHECKS = 1');
    }
}

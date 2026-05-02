<?php

require_once __DIR__ . '/../core/Modelo.php';

class DireccionEntrega extends Modelo
{
    /** Campos permitidos para crear/actualizar */
    private const ALLOWED_FIELDS = [
        'descripcion', 'direccion', 'direccion_2', 'codigo_postal', 'localidad',
        'provincia', 'pais', 'x', 'y', 'tipo_zona', 'tipo_negocio',
        'contacto', 'telefono', 'observaciones', 'principal', 'activo', 'codigo_erp',
    ];

    /**
     * Todas las direcciones activas de un cliente, ordenadas por principal DESC, descripcion ASC.
     */
    public function getByCliente(int $clienteId): array
    {
        return $this->query(
            'SELECT * FROM direcciones_entrega
             WHERE id_cliente = ? AND activo = 1
             ORDER BY principal DESC, descripcion ASC',
            [$clienteId]
        )->fetchAll();
    }

    /**
     * Una direccion por su ID, o null si no existe.
     */
    public function getById(int $id): ?array
    {
        $row = $this->query(
            'SELECT * FROM direcciones_entrega WHERE id = ?',
            [$id]
        )->fetch();

        return $row ?: null;
    }

    /**
     * La direccion principal de un cliente, o null si no tiene.
     */
    public function getPrincipal(int $clienteId): ?array
    {
        $row = $this->query(
            'SELECT * FROM direcciones_entrega
             WHERE id_cliente = ? AND principal = 1 AND activo = 1
             LIMIT 1',
            [$clienteId]
        )->fetch();

        return $row ?: null;
    }

    /**
     * Crea una direccion para un cliente. Si es la primera, se marca como principal.
     * Devuelve el ID de la nueva direccion.
     */
    public function create(int $clienteId, array $data): int
    {
        // Comprobar si es la primera direccion del cliente
        $count = $this->query(
            'SELECT COUNT(*) as total FROM direcciones_entrega WHERE id_cliente = ? AND activo = 1',
            [$clienteId]
        )->fetch();

        $esPrimera = ((int) $count['total']) === 0;

        $this->query(
            'INSERT INTO direcciones_entrega
                (id_cliente, descripcion, direccion, direccion_2, codigo_postal, localidad,
                 provincia, pais, x, y, tipo_zona, tipo_negocio,
                 contacto, telefono, observaciones, principal, activo, codigo_erp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
            [
                $clienteId,
                $data['descripcion'] ?? '',
                $data['direccion'] ?? '',
                $data['direccion_2'] ?? null,
                $data['codigo_postal'] ?? '',
                $data['localidad'] ?? '',
                $data['provincia'] ?? '',
                $data['pais'] ?? 'ES',
                isset($data['x']) && $data['x'] !== '' ? $data['x'] : null,
                isset($data['y']) && $data['y'] !== '' ? $data['y'] : null,
                $data['tipo_zona'] ?? null,
                $data['tipo_negocio'] ?? null,
                $data['contacto'] ?? null,
                $data['telefono'] ?? null,
                $data['observaciones'] ?? null,
                $esPrimera ? 1 : 0,
                $data['codigo_erp'] ?? null,
            ]
        );

        return (int) $this->db()->lastInsertId();
    }

    /**
     * Actualiza los campos permitidos de una direccion.
     */
    public function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];

        foreach (self::ALLOWED_FIELDS as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f];
            }
        }

        if (empty($fields)) return;

        $params[] = $id;
        $this->query(
            'UPDATE direcciones_entrega SET ' . implode(', ', $fields) . ' WHERE id = ?',
            $params
        );
    }

    /**
     * Elimina una direccion. Si era principal, promueve la siguiente (por id ASC).
     */
    public function delete(int $id): void
    {
        $dir = $this->getById($id);
        if (!$dir) return;

        $clienteId = (int) $dir['id_cliente'];
        $eraPrincipal = (int) $dir['principal'] === 1;

        $this->query('DELETE FROM direcciones_entrega WHERE id = ?', [$id]);

        // Si era principal, promover la siguiente
        if ($eraPrincipal) {
            $next = $this->query(
                'SELECT id FROM direcciones_entrega
                 WHERE id_cliente = ? AND activo = 1
                 ORDER BY id ASC LIMIT 1',
                [$clienteId]
            )->fetch();

            if ($next) {
                $this->query(
                    'UPDATE direcciones_entrega SET principal = 1 WHERE id = ?',
                    [$next['id']]
                );
            }
        }
    }

    /**
     * Establece una direccion como principal, desmarcando la anterior del mismo cliente.
     */
    public function setPrincipal(int $id): void
    {
        $dir = $this->getById($id);
        if (!$dir) return;

        $clienteId = (int) $dir['id_cliente'];

        // Desmarcar todas las del cliente
        $this->query(
            'UPDATE direcciones_entrega SET principal = 0 WHERE id_cliente = ?',
            [$clienteId]
        );

        // Marcar la seleccionada
        $this->query(
            'UPDATE direcciones_entrega SET principal = 1 WHERE id = ?',
            [$id]
        );
    }

    /**
     * Todas las direcciones activas agrupadas por id_cliente (para carga masiva).
     */
    public function getAllGroupedByCliente(): array
    {
        $rows = $this->query(
            'SELECT * FROM direcciones_entrega
             WHERE activo = 1
             ORDER BY principal DESC, descripcion ASC'
        )->fetchAll();

        $grouped = [];
        foreach ($rows as $row) {
            $grouped[(int) $row['id_cliente']][] = $row;
        }

        return $grouped;
    }
}

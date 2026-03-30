<?php

require_once __DIR__ . '/../core/Model.php';

class HojaRuta extends Model
{
    /* ── Listar hojas por fecha (y opcionalmente por ruta) ── */
    public function getByFecha(string $fecha, ?int $rutaId = null)
    {
        $sql = "SELECT h.*, r.name as ruta_name,
                       (SELECT COUNT(*) FROM hoja_ruta_lineas l WHERE l.hoja_ruta_id = h.id) as num_lineas
                FROM hojas_ruta h
                JOIN rutas r ON r.id = h.ruta_id
                WHERE h.fecha = ?";
        $params = [$fecha];

        if ($rutaId) {
            $sql .= " AND h.ruta_id = ?";
            $params[] = $rutaId;
        }

        $sql .= " ORDER BY r.name";
        $hojas = $this->query($sql, $params)->fetchAll();

        foreach ($hojas as &$h) {
            $h['lineas'] = $this->getLineas((int) $h['id']);
        }

        return $hojas;
    }

    /* ── Detalle de una hoja con todas sus líneas ── */
    public function getById(int $id)
    {
        $hoja = $this->query(
            "SELECT h.*, r.name as ruta_name
             FROM hojas_ruta h
             JOIN rutas r ON r.id = h.ruta_id
             WHERE h.id = ?",
            [$id]
        )->fetch();

        if (!$hoja) return null;

        $hoja['lineas'] = $this->getLineas($id);
        return $hoja;
    }

    /* ── Líneas de una hoja con datos de cliente y comercial ── */
    public function getLineas(int $hojaId)
    {
        return $this->query(
            "SELECT l.*, c.name as client_name, c.address as client_address,
                    c.x as client_x, c.y as client_y,
                    com.name as comercial_name
             FROM hoja_ruta_lineas l
             JOIN clients c ON c.id = l.client_id
             LEFT JOIN comerciales com ON com.id = l.comercial_id
             WHERE l.hoja_ruta_id = ?
             ORDER BY COALESCE(l.orden_descarga, 9999), l.id",
            [$hojaId]
        )->fetchAll();
    }

    /* ── Crear hoja ── */
    public function create(array $data)
    {
        $this->query(
            "INSERT INTO hojas_ruta (ruta_id, fecha, responsable, notas)
             VALUES (?, ?, ?, ?)",
            [
                $data['ruta_id'],
                $data['fecha'],
                $data['responsable'] ?? null,
                $data['notas'] ?? null,
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    /* ── Actualizar hoja ── */
    public function update(int $id, array $data)
    {
        $fields = [];
        $params = [];

        foreach (['responsable', 'notas', 'estado', 'total_cc', 'total_bn', 'total_litros'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f];
            }
        }

        if (empty($fields)) return;

        $params[] = $id;
        $this->query("UPDATE hojas_ruta SET " . implode(', ', $fields) . " WHERE id = ?", $params);
    }

    /* ── Eliminar hoja (solo borrador) ── */
    public function delete(int $id)
    {
        $hoja = $this->query("SELECT estado FROM hojas_ruta WHERE id = ?", [$id])->fetch();
        if (!$hoja) return false;
        if ($hoja['estado'] !== 'borrador') return false;

        $this->query("DELETE FROM hojas_ruta WHERE id = ?", [$id]);
        return true;
    }

    /* ── Cambiar estado ── */
    public function updateEstado(int $id, string $estado)
    {
        $valid = ['borrador', 'cerrada', 'planificada', 'en_reparto', 'completada'];
        if (!in_array($estado, $valid)) return false;

        $this->query("UPDATE hojas_ruta SET estado = ? WHERE id = ?", [$estado, $id]);
        return true;
    }

    /* ── Añadir línea ── */
    public function addLinea(int $hojaId, array $data)
    {
        $this->query(
            "INSERT INTO hoja_ruta_lineas (hoja_ruta_id, order_id, client_id, comercial_id, zona, cc_aprox, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                $hojaId,
                $data['order_id'] ?? null,
                $data['client_id'],
                $data['comercial_id'] ?? null,
                $data['zona'] ?? null,
                $data['cc_aprox'] ?? 0,
                $data['observaciones'] ?? null,
            ]
        );
        $lineaId = (int) $this->db()->lastInsertId();
        $this->recalcTotals($hojaId);
        return $lineaId;
    }

    /* ── Actualizar línea ── */
    public function updateLinea(int $lineaId, array $data)
    {
        $fields = [];
        $params = [];

        foreach (['order_id', 'comercial_id', 'zona', 'cc_aprox', 'orden_descarga', 'observaciones', 'estado'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f];
            }
        }

        if (empty($fields)) return;

        $params[] = $lineaId;
        $this->query("UPDATE hoja_ruta_lineas SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        $row = $this->query("SELECT hoja_ruta_id FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        if ($row) $this->recalcTotals((int) $row['hoja_ruta_id']);
    }

    /* ── Eliminar línea ── */
    public function removeLinea(int $lineaId)
    {
        $row = $this->query("SELECT hoja_ruta_id FROM hoja_ruta_lineas WHERE id = ?", [$lineaId])->fetch();
        $this->query("DELETE FROM hoja_ruta_lineas WHERE id = ?", [$lineaId]);
        if ($row) $this->recalcTotals((int) $row['hoja_ruta_id']);
    }

    /* ── Reordenar líneas ── */
    public function reorder(int $hojaId, array $lineaIds)
    {
        foreach ($lineaIds as $i => $lineaId) {
            $this->query(
                "UPDATE hoja_ruta_lineas SET orden_descarga = ? WHERE id = ? AND hoja_ruta_id = ?",
                [$i + 1, $lineaId, $hojaId]
            );
        }
    }

    /* ── Duplicar hoja de otra fecha ── */
    public function duplicate(int $sourceId, string $newFecha)
    {
        $source = $this->getById($sourceId);
        if (!$source) return null;

        $newId = $this->create([
            'ruta_id'     => $source['ruta_id'],
            'fecha'       => $newFecha,
            'responsable' => $source['responsable'],
            'notas'       => $source['notas'],
        ]);

        foreach ($source['lineas'] as $linea) {
            $this->addLinea($newId, [
                'client_id'     => $linea['client_id'],
                'comercial_id'  => $linea['comercial_id'],
                'zona'          => $linea['zona'],
                'cc_aprox'      => $linea['cc_aprox'],
                'observaciones' => $linea['observaciones'],
            ]);
        }

        return $newId;
    }

    /* ── Recalcular totales de la hoja ── */
    public function recalcTotals(int $hojaId)
    {
        $row = $this->query(
            "SELECT COALESCE(SUM(cc_aprox), 0) as total_cc,
                    COUNT(*) as total_lineas
             FROM hoja_ruta_lineas
             WHERE hoja_ruta_id = ?",
            [$hojaId]
        )->fetch();

        $this->query(
            "UPDATE hojas_ruta SET total_cc = ? WHERE id = ?",
            [$row['total_cc'], $hojaId]
        );
    }

    /* ── Rutas sin hoja en una fecha ── */
    public function getRutasSinHoja(string $fecha)
    {
        return $this->query(
            "SELECT r.* FROM rutas r
             WHERE r.active = 1
               AND r.id NOT IN (SELECT ruta_id FROM hojas_ruta WHERE fecha = ?)
             ORDER BY r.name",
            [$fecha]
        )->fetchAll();
    }

    /* ── Delegacion mas comun entre los clientes de la hoja ── */
    public function getDelegationForHoja(int $hojaId)
    {
        $row = $this->query(
            "SELECT d.* FROM delegations d
             JOIN clients c ON c.delegation_id = d.id
             JOIN hoja_ruta_lineas l ON l.client_id = c.id
             WHERE l.hoja_ruta_id = ? AND d.active = 1
             GROUP BY d.id
             ORDER BY COUNT(*) DESC
             LIMIT 1",
            [$hojaId]
        )->fetch();

        if ($row) return $row;

        return $this->query("SELECT * FROM delegations WHERE active = 1 ORDER BY id LIMIT 1")->fetch();
    }

    /* ── Listar comerciales ── */
    public function getComerciales()
    {
        return $this->query("SELECT id, code, name FROM comerciales ORDER BY name")->fetchAll();
    }
}

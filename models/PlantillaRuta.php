<?php

require_once __DIR__ . '/../core/Modelo.php';

class PlantillaRuta extends Modelo
{
    public function getAll(): array
    {
        $templates = $this->query(
            'SELECT rt.*, v.nombre AS vehicle_name, v.matricula AS plate, d.nombre AS delegation_name
             FROM plantillas_ruta rt
             LEFT JOIN vehiculos v ON rt.id_vehiculo = v.id
             LEFT JOIN delegaciones d ON rt.id_delegacion = d.id
             ORDER BY rt.name'
        )->fetchAll();

        foreach ($templates as &$t) {
            $t['stops'] = $this->query(
                'SELECT rts.stop_order, rts.id_cliente, c.nombre AS client_name
                 FROM paradas_plantilla_ruta rts
                 JOIN clientes c ON rts.id_cliente = c.id
                 WHERE rts.id_plantilla = ?
                 ORDER BY rts.stop_order',
                [$t['id']]
            )->fetchAll();
        }

        return $templates;
    }

    public function create(string $name, ?int $dayOfWeek, ?int $vehicleId, ?int $delegationId, array $clientIds): int
    {
        $db = $this->db();
        $db->beginTransaction();
        try {
            $this->query(
                'INSERT INTO plantillas_ruta (name, day_of_week, id_vehiculo, id_delegacion) VALUES (?, ?, ?, ?)',
                [$name, $dayOfWeek, $vehicleId, $delegationId]
            );
            $templateId = (int) $db->lastInsertId();

            foreach ($clientIds as $i => $clientId) {
                $this->query(
                    'INSERT INTO paradas_plantilla_ruta (id_plantilla, stop_order, id_cliente) VALUES (?, ?, ?)',
                    [$templateId, $i + 1, $clientId]
                );
            }

            $db->commit();
            return $templateId;
        } catch (\Exception $e) {
            $db->rollBack();
            throw $e;
        }
    }

    public function delete(int $id): void
    {
        $this->query('DELETE FROM plantillas_ruta WHERE id = ?', [$id]);
    }
}

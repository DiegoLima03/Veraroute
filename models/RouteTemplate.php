<?php

require_once __DIR__ . '/../core/Model.php';

class RouteTemplate extends Model
{
    public function getAll(): array
    {
        $templates = $this->query(
            'SELECT rt.*, v.name AS vehicle_name, v.plate, d.name AS delegation_name
             FROM route_templates rt
             LEFT JOIN vehicles v ON rt.vehicle_id = v.id
             LEFT JOIN delegations d ON rt.delegation_id = d.id
             ORDER BY rt.name'
        )->fetchAll();

        foreach ($templates as &$t) {
            $t['stops'] = $this->query(
                'SELECT rts.stop_order, rts.client_id, c.name AS client_name
                 FROM route_template_stops rts
                 JOIN clients c ON rts.client_id = c.id
                 WHERE rts.template_id = ?
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
                'INSERT INTO route_templates (name, day_of_week, vehicle_id, delegation_id) VALUES (?, ?, ?, ?)',
                [$name, $dayOfWeek, $vehicleId, $delegationId]
            );
            $templateId = (int) $db->lastInsertId();

            foreach ($clientIds as $i => $clientId) {
                $this->query(
                    'INSERT INTO route_template_stops (template_id, stop_order, client_id) VALUES (?, ?, ?)',
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
        $this->query('DELETE FROM route_templates WHERE id = ?', [$id]);
    }
}

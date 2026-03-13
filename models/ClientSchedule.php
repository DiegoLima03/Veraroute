<?php

require_once __DIR__ . '/../core/Model.php';

class ClientSchedule extends Model
{
    /**
     * Devuelve horarios de un cliente agrupados por dia.
     * Retorna: [day_of_week => [['open_time' => '09:00', 'close_time' => '14:00'], ...]]
     */
    public function getByClient(int $clientId): array
    {
        $rows = $this->query(
            'SELECT day_of_week, open_time, close_time FROM client_schedules WHERE client_id = ? ORDER BY day_of_week, open_time',
            [$clientId]
        )->fetchAll();

        $schedule = [];
        foreach ($rows as $r) {
            $day = (int) $r['day_of_week'];
            $schedule[$day][] = [
                'open_time'  => substr($r['open_time'], 0, 5),
                'close_time' => substr($r['close_time'], 0, 5),
            ];
        }
        return $schedule;
    }

    /**
     * Devuelve horarios de TODOS los clientes indexados por client_id y dia.
     * Retorna: [client_id => [day_of_week => [['open_time', 'close_time'], ...]]]
     */
    public function getAllGrouped(): array
    {
        $rows = $this->query(
            'SELECT client_id, day_of_week, open_time, close_time FROM client_schedules ORDER BY client_id, day_of_week, open_time'
        )->fetchAll();

        $result = [];
        foreach ($rows as $r) {
            $cid = (int) $r['client_id'];
            $day = (int) $r['day_of_week'];
            $result[$cid][$day][] = [
                'open_time'  => substr($r['open_time'], 0, 5),
                'close_time' => substr($r['close_time'], 0, 5),
            ];
        }
        return $result;
    }

    /**
     * Reemplaza horarios de un cliente.
     * $schedule = [day_of_week => [['open_time', 'close_time'], ...]]
     */
    public function replaceForClient(int $clientId, array $schedule): void
    {
        $this->query('DELETE FROM client_schedules WHERE client_id = ?', [$clientId]);

        foreach ($schedule as $day => $windows) {
            foreach ($windows as $w) {
                if (empty($w['open_time']) || empty($w['close_time'])) continue;
                $this->query(
                    'INSERT INTO client_schedules (client_id, day_of_week, open_time, close_time) VALUES (?, ?, ?, ?)',
                    [$clientId, (int) $day, $w['open_time'], $w['close_time']]
                );
            }
        }
    }
}

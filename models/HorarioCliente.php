<?php

require_once __DIR__ . '/../core/Modelo.php';

class HorarioCliente extends Modelo
{
    /**
     * Devuelve horarios de un cliente agrupados por dia.
     * Retorna: [day_of_week => [['open_time' => '09:00', 'close_time' => '14:00'], ...]]
     */
    public function getByClient(int $clientId): array
    {
        $rows = $this->query(
            'SELECT dia_semana AS day_of_week, hora_apertura AS open_time, hora_cierre AS close_time
             FROM horarios_cliente WHERE id_cliente = ? ORDER BY dia_semana, hora_apertura',
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
     * Devuelve horarios de TODOS los clientes indexados por id_cliente y dia.
     * Retorna: [id_cliente => [day_of_week => [['open_time', 'close_time'], ...]]]
     */
    public function getAllGrouped(): array
    {
        $rows = $this->query(
            'SELECT id_cliente, dia_semana AS day_of_week, hora_apertura AS open_time, hora_cierre AS close_time
             FROM horarios_cliente ORDER BY id_cliente, dia_semana, hora_apertura'
        )->fetchAll();

        $result = [];
        foreach ($rows as $r) {
            $cid = (int) $r['id_cliente'];
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
        $this->query('DELETE FROM horarios_cliente WHERE id_cliente = ?', [$clientId]);

        foreach ($schedule as $day => $windows) {
            foreach ($windows as $w) {
                if (empty($w['open_time']) || empty($w['close_time'])) continue;
                $this->query(
                    'INSERT INTO horarios_cliente (id_cliente, dia_semana, hora_apertura, hora_cierre) VALUES (?, ?, ?, ?)',
                    [$clientId, (int) $day, $w['open_time'], $w['close_time']]
                );
            }
        }
    }
}

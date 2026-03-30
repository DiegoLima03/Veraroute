<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/Client.php';
require_once __DIR__ . '/../models/ClientSchedule.php';
require_once __DIR__ . '/../models/Order.php';

class ClientController extends Controller
{
    private $client;
    private $schedule;

    public function __construct()
    {
        $this->client   = new Client();
        $this->schedule = new ClientSchedule();
    }

    public function index()
    {
        $clients = Auth::isComercial()
            ? $this->client->getAllByComercialIds(Auth::comercialIds())
            : $this->client->getAll();
        $schedules = $this->schedule->getAllGrouped();

        foreach ($clients as &$c) {
            $c['schedules'] = $schedules[(int) $c['id']] ?? [];
        }

        $this->json($clients);
    }

    public function store()
    {
        $data = $this->getInput();

        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
            return;
        }

        // x e y pueden ser null (cliente sin coordenadas)
        $data['x'] = isset($data['x']) && $data['x'] !== '' && $data['x'] !== null ? $data['x'] : null;
        $data['y'] = isset($data['y']) && $data['y'] !== '' && $data['y'] !== null ? $data['y'] : null;

        $id = $this->client->create($data);
        $created = $this->client->getById($id);
        $this->json($created, 201);
    }

    public function update($id)
    {
        $data = $this->getInput();

        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
            return;
        }

        $data['x'] = isset($data['x']) && $data['x'] !== '' && $data['x'] !== null ? $data['x'] : null;
        $data['y'] = isset($data['y']) && $data['y'] !== '' && $data['y'] !== null ? $data['y'] : null;

        $this->client->update((int) $id, $data);
        $updated = $this->client->getById((int) $id);
        $this->json($updated);
    }

    public function toggleActive($id)
    {
        $client = $this->client->getById((int) $id);
        if (!$client) {
            $this->json(['error' => 'Cliente no encontrado'], 404);
            return;
        }

        // No permitir activar sin coordenadas
        if (!$client['active'] && ($client['x'] === null || $client['y'] === null)) {
            $this->json(['error' => 'No se puede activar un cliente sin coordenadas. Edítalo primero.'], 400);
            return;
        }

        $this->client->toggleActive((int) $id);
        $updated = $this->client->getById((int) $id);
        $this->json($updated);
    }

    public function updateContado($id)
    {
        $data = $this->getInput();
        $this->client->setContado((int) $id, !empty($data['al_contado']));
        $this->json(['ok' => true]);
    }

    public function destroy($id)
    {
        $this->client->delete((int) $id);
        $this->json(['ok' => true]);
    }

    /** GET api/clients/{id}/schedules */
    public function getSchedules($id)
    {
        $this->json($this->schedule->getByClient((int) $id));
    }

    /** PUT api/clients/{id}/schedules */
    public function saveSchedules($id)
    {
        $data = $this->getInput();
        $schedule = $data['schedules'] ?? [];
        $this->schedule->replaceForClient((int) $id, $schedule);
        $this->json($this->schedule->getByClient((int) $id));
    }

    public function loadDemo()
    {
        $this->client->truncate();

        // Coordenadas reales de Vigo y alrededores
        $demoClients = [
            ['name' => 'Farmacia Coia',      'x' => 42.2155, 'y' => -8.7475, 'open_time' => '09:00', 'close_time' => '21:00', 'address' => 'Av. de Coia, 12',       'phone' => '986 110 001', 'notes' => ''],
            ['name' => 'Supermercado Teis',   'x' => 42.2380, 'y' => -8.6920, 'open_time' => '08:00', 'close_time' => '22:00', 'address' => 'C/ Teis, 45',            'phone' => '986 110 002', 'notes' => 'Entrada lateral'],
            ['name' => 'Librería Nós',        'x' => 42.2406, 'y' => -8.7207, 'open_time' => '10:00', 'close_time' => '14:00', 'address' => 'Pl. Mayor, 3',           'phone' => '986 110 003', 'notes' => 'Solo mañanas'],
            ['name' => 'Clínica Montero',     'x' => 42.2310, 'y' => -8.7120, 'open_time' => '09:00', 'close_time' => '20:00', 'address' => 'Av. Camelias, 88',       'phone' => '986 110 004', 'notes' => ''],
            ['name' => 'Bazar El Puerto',     'x' => 42.2370, 'y' => -8.7260, 'open_time' => '10:00', 'close_time' => '19:30', 'address' => 'C/ Progreso, 7',         'phone' => '986 110 005', 'notes' => ''],
            ['name' => 'Cafetería Plaza',     'x' => 42.2345, 'y' => -8.7225, 'open_time' => '07:30', 'close_time' => '23:00', 'address' => 'Pl. Compostela, 1',      'phone' => '986 110 006', 'notes' => ''],
            ['name' => 'Taller Mecánico',     'x' => 42.2090, 'y' => -8.7530, 'open_time' => '08:00', 'close_time' => '18:00', 'address' => 'Polígono Coia, 33',      'phone' => '986 110 007', 'notes' => 'Preguntar por Manolo'],
            ['name' => 'Centro Estética',     'x' => 42.2330, 'y' => -8.7190, 'open_time' => '10:00', 'close_time' => '20:00', 'address' => 'C/ Urzáiz, 22',          'phone' => '986 110 008', 'notes' => ''],
            ['name' => 'Ferretería Norte',    'x' => 42.2450, 'y' => -8.6850, 'open_time' => '09:00', 'close_time' => '13:30', 'address' => 'C/ Ecuador, 5',          'phone' => '986 110 009', 'notes' => 'Cierra 13:30 exacto'],
            ['name' => 'Peluquería Mar',      'x' => 42.2200, 'y' => -8.7400, 'open_time' => '09:30', 'close_time' => '19:00', 'address' => 'C/ Lepanto, 18',         'phone' => '986 110 010', 'notes' => ''],
            ['name' => 'Óptica Visión',       'x' => 42.2360, 'y' => -8.7150, 'open_time' => '10:00', 'close_time' => '14:00', 'address' => 'Gran Vía, 55',           'phone' => '986 110 011', 'notes' => ''],
            ['name' => 'Papelería Ramos',     'x' => 42.2250, 'y' => -8.7300, 'open_time' => '09:00', 'close_time' => '20:00', 'address' => 'C/ Elduayen, 9',         'phone' => '986 110 012', 'notes' => ''],
        ];

        $ids = [];
        foreach ($demoClients as $c) {
            $ids[] = $this->client->create($c);
        }

        // Pedidos demo para hoy
        $order = new Order();
        $today = date('Y-m-d');
        $demoOrders = [
            $ids[0]  => ['items' => [['name' => 'Caja papel A4', 'qty' => 5], ['name' => 'Bolígrafos', 'qty' => 20]], 'notes' => ''],
            $ids[1]  => ['items' => [['name' => 'Agua 5L', 'qty' => 10]], 'notes' => 'Entrada lateral'],
            $ids[3]  => ['items' => [['name' => 'Material sanitario', 'qty' => 3]], 'notes' => ''],
            $ids[5]  => ['items' => [['name' => 'Café 1kg', 'qty' => 8], ['name' => 'Azúcar sobres', 'qty' => 200]], 'notes' => 'Urgente'],
            $ids[6]  => ['items' => [['name' => 'Aceite motor 5W40', 'qty' => 4]], 'notes' => ''],
            $ids[8]  => ['items' => [['name' => 'Tornillería surtida', 'qty' => 2]], 'notes' => 'Antes de las 13:00'],
            $ids[10] => ['items' => [['name' => 'Paños limpieza', 'qty' => 6]], 'notes' => ''],
        ];

        foreach ($demoOrders as $clientId => $ord) {
            $order->createOrUpdate($clientId, $today, $ord['items'], $ord['notes']);
        }

        $this->json(['ok' => true, 'clients' => count($ids), 'orders' => count($demoOrders)]);
    }
}

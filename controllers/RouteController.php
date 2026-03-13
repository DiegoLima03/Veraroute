<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Delegation.php';
require_once __DIR__ . '/../models/Vehicle.php';
require_once __DIR__ . '/../models/RoutePlan.php';
require_once __DIR__ . '/../models/Order.php';
require_once __DIR__ . '/../models/Client.php';
require_once __DIR__ . '/../models/DistanceCache.php';
require_once __DIR__ . '/../models/ClientSchedule.php';

class RouteController extends Controller
{
    private $delegationModel;
    private $vehicleModel;
    private $routePlan;
    private $orderModel;
    private $clientModel;
    private $distCache;
    private $scheduleModel;

    public function __construct()
    {
        $this->delegationModel = new Delegation();
        $this->vehicleModel    = new Vehicle();
        $this->routePlan       = new RoutePlan();
        $this->orderModel      = new Order();
        $this->clientModel     = new Client();
        $this->distCache       = new DistanceCache();
        $this->scheduleModel   = new ClientSchedule();
    }

    /** GET api/routes?date=YYYY-MM-DD */
    public function index()
    {
        $date = $_GET['date'] ?? date('Y-m-d');
        $this->json($this->routePlan->getByDate($date));
    }

    /** GET api/routes/{id} */
    public function show($id)
    {
        $plan = $this->routePlan->getById((int) $id);
        if (!$plan) {
            $this->json(['error' => 'Plan no encontrado'], 404);
            return;
        }
        $this->json($plan);
    }

    /** POST api/routes/optimize */
    public function optimize()
    {
        $input = $this->getInput();
        $date  = $input['date'] ?? date('Y-m-d');

        // 1. Obtener delegaciones y vehiculos activos
        $delegations = $this->delegationModel->getAll();
        $vehicles    = $this->vehicleModel->getAll();

        if (!count($delegations)) {
            $this->json(['error' => 'No hay delegaciones configuradas'], 400);
            return;
        }
        if (!count($vehicles)) {
            $this->json(['error' => 'No hay vehiculos configurados'], 400);
            return;
        }

        // Filtrar por IDs si se proporcionan
        if (!empty($input['delegation_ids'])) {
            $ids = $input['delegation_ids'];
            $delegations = array_values(array_filter($delegations, fn($d) => in_array($d['id'], $ids)));
        }
        if (!empty($input['vehicle_ids'])) {
            $ids = $input['vehicle_ids'];
            $vehicles = array_values(array_filter($vehicles, fn($v) => in_array($v['id'], $ids)));
        }

        // 2. Obtener pedidos del dia con datos de cliente
        $ordersMap = $this->orderModel->getByDate($date);
        if (!count($ordersMap)) {
            $this->json(['error' => 'Sin pedidos para ' . $date], 400);
            return;
        }

        // Dia de la semana de la ruta: 0=Lun...6=Dom
        $routeDow = ((int) date('N', strtotime($date))) - 1; // PHP date('N'): 1=Mon -> 0=Lun

        // Cargar horarios semanales
        $allSchedules = $this->scheduleModel->getAllGrouped();

        $allClients = $this->clientModel->getAll();
        $clientMap  = [];
        foreach ($allClients as $c) {
            $cid = (int) $c['id'];
            // Inyectar ventanas horarias del dia de la ruta
            if (isset($allSchedules[$cid][$routeDow])) {
                $c['_day_windows'] = $allSchedules[$cid][$routeDow];
            } else {
                $c['_day_windows'] = null; // usara open_time/close_time como fallback
            }
            $clientMap[$cid] = $c;
        }

        // Clientes con pedido y activos
        $eligible = [];
        foreach ($ordersMap as $clientId => $orderData) {
            $cid = (int) $clientId;
            if (isset($clientMap[$cid]) && $clientMap[$cid]['active']) {
                $load = $this->routePlan->calculateOrderLoad($orderData['id']);
                $unloadTime = $this->routePlan->calculateUnloadTime($orderData['id']);
                $eligible[] = [
                    'client'        => $clientMap[$cid],
                    'order_id'      => $orderData['id'],
                    'load'          => $load,
                    'unload_min'    => $unloadTime,
                    'delegation_id' => $clientMap[$cid]['delegation_id'] ? (int) $clientMap[$cid]['delegation_id'] : null,
                ];
            }
        }

        if (!count($eligible)) {
            $this->json(['error' => 'Sin clientes activos con pedidos para ' . $date], 400);
            return;
        }

        // 3. Asignar clientes a delegaciones (por delegation_id o por cercania)
        $delegationIndex = [];
        foreach ($delegations as $d) {
            $delegationIndex[(int) $d['id']] = $d;
        }

        $clusters = []; // delegation_id => [eligible entries]
        foreach ($eligible as $e) {
            $assignedDelegation = null;
            if ($e['delegation_id'] && isset($delegationIndex[$e['delegation_id']])) {
                $assignedDelegation = $e['delegation_id'];
            } else {
                // Asignar a la delegacion mas cercana (con distancia OSRM cacheada)
                $minDist = PHP_FLOAT_MAX;
                foreach ($delegations as $d) {
                    $result = $this->distCache->getOrFetch(
                        (float) $e['client']['x'], (float) $e['client']['y'],
                        (float) $d['x'], (float) $d['y']
                    );
                    $dd = $result['distance_km'];
                    if ($dd < $minDist) {
                        $minDist = $dd;
                        $assignedDelegation = (int) $d['id'];
                    }
                }
            }
            $clusters[$assignedDelegation][] = $e;
        }

        // 4. Agrupar vehiculos por delegacion
        $vehiclesByDelegation = [];
        foreach ($vehicles as $v) {
            $did = (int) $v['delegation_id'];
            $vehiclesByDelegation[$did][] = $v;
        }

        // 5. Para cada delegacion: repartir clientes entre vehiculos y optimizar rutas
        $routes = [];
        $unassigned = [];

        foreach ($clusters as $delegationId => $entries) {
            $delegation = $delegationIndex[$delegationId];
            $delegationVehicles = $vehiclesByDelegation[$delegationId] ?? [];

            if (!count($delegationVehicles)) {
                foreach ($entries as $e) {
                    $unassigned[] = ['client_id' => $e['client']['id'], 'name' => $e['client']['name'], 'reason' => 'Sin vehiculo en delegacion ' . $delegation['name']];
                }
                continue;
            }

            // Bin-packing: repartir entre vehiculos
            $vehicleLoads = $this->assignToVehicles($entries, $delegationVehicles);

            foreach ($vehicleLoads as $vi => $assigned) {
                if (!count($assigned)) continue;

                $vehicle = $delegationVehicles[$vi];
                $route = $this->optimizeVehicleRoute($delegation, $assigned);

                // Guardar en BD
                $totalUnload = array_sum(array_column($route['stops'], 'unload_min'));
                $planId = $this->routePlan->create(
                    $date,
                    (int) $vehicle['id'],
                    $delegationId,
                    $route['stops'],
                    $route['distance_km'],
                    $route['time_h'],
                    $totalUnload
                );

                $routes[] = [
                    'plan_id'           => $planId,
                    'vehicle'           => ['id' => (int) $vehicle['id'], 'name' => $vehicle['name'], 'plate' => $vehicle['plate']],
                    'delegation'        => ['id' => $delegationId, 'name' => $delegation['name'], 'x' => (float) $delegation['x'], 'y' => (float) $delegation['y']],
                    'stops'             => $route['stops'],
                    'total_distance_km' => $route['distance_km'],
                    'total_time_h'      => $route['time_h'],
                    'total_unload_min'  => $totalUnload,
                ];
            }

            // Clientes que no cupieron
            foreach ($entries as $e) {
                $found = false;
                foreach ($vehicleLoads as $assigned) {
                    foreach ($assigned as $a) {
                        if ((int) $a['client']['id'] === (int) $e['client']['id']) {
                            $found = true;
                            break 2;
                        }
                    }
                }
                if (!$found) {
                    $unassigned[] = ['client_id' => $e['client']['id'], 'name' => $e['client']['name'], 'reason' => 'Excede capacidad'];
                }
            }
        }

        $this->json([
            'date'       => $date,
            'routes'     => $routes,
            'unassigned' => $unassigned,
        ]);
    }

    /** Reparte entries entre vehiculos respetando capacidad */
    private function assignToVehicles(array $entries, array $vehicles): array
    {
        // Ordenar por carga descendente (first-fit decreasing)
        usort($entries, fn($a, $b) => $b['load']['items'] <=> $a['load']['items']);

        $assignments = array_fill(0, count($vehicles), []);
        $remaining   = array_fill(0, count($vehicles), [
            'items'  => 0,
            'weight' => 0,
            'volume' => 0,
        ]);

        foreach ($entries as $e) {
            $bestVi = null;
            $bestFit = PHP_FLOAT_MAX;

            foreach ($vehicles as $vi => $v) {
                $curItems  = $remaining[$vi]['items'] + $e['load']['items'];
                $curWeight = $remaining[$vi]['weight'] + $e['load']['weight_kg'];
                $curVolume = $remaining[$vi]['volume'] + $e['load']['volume_m3'];

                // Comprobar capacidad
                if ($v['max_items'] && $curItems > (int) $v['max_items']) continue;
                if ($v['max_weight_kg'] && $curWeight > (float) $v['max_weight_kg']) continue;
                if ($v['max_volume_m3'] && $curVolume > (float) $v['max_volume_m3']) continue;

                // El vehiculo con menos carga actual es mejor
                $fit = $remaining[$vi]['items'];
                if ($fit < $bestFit) {
                    $bestFit = $fit;
                    $bestVi = $vi;
                }
            }

            if ($bestVi !== null) {
                $assignments[$bestVi][] = $e;
                $remaining[$bestVi]['items']  += $e['load']['items'];
                $remaining[$bestVi]['weight'] += $e['load']['weight_kg'];
                $remaining[$bestVi]['volume'] += $e['load']['volume_m3'];
            }
            // Si no cabe en ningun vehiculo, queda sin asignar (se detecta arriba)
        }

        return $assignments;
    }

    /** Optimiza ruta de un vehiculo: nearest neighbor + 2-opt con distancias OSRM */
    private function optimizeVehicleRoute(array $delegation, array $entries): array
    {
        // Construir lista de puntos: [0] = delegacion, [1..N] = clientes
        $points = [['lat' => (float) $delegation['x'], 'lng' => (float) $delegation['y']]];
        foreach ($entries as $e) {
            $points[] = ['lat' => (float) $e['client']['x'], 'lng' => (float) $e['client']['y']];
        }

        // Matriz OSRM (con cache)
        $matrix = $this->distCache->buildMatrix($points);
        $dist = $matrix['distances']; // dist[i][j] en km
        $dur  = $matrix['durations']; // dur[i][j] en segundos

        // Nearest-neighbor con ventanas horarias (usando indices de la matriz)
        $n = count($entries);
        $visited = array_fill(0, $n, false);
        $order = []; // indices en $entries
        $curIdx = 0; // indice en $points (0 = delegacion)
        $delegationOpenMin = $this->timeToMin($delegation['open_time'] ?? '06:00');
        $t = $delegationOpenMin;

        for ($step = 0; $step < $n; $step++) {
            $bestEi = null;
            $bestDist = PHP_FLOAT_MAX;

            for ($ei = 0; $ei < $n; $ei++) {
                if ($visited[$ei]) continue;
                $pi = $ei + 1; // indice en $points
                $d = $dist[$curIdx][$pi];
                $travelMin = ($dur[$curIdx][$pi]) / 60;
                $arrivalMin = $t + $travelMin;
                // Comprobar si llega antes del cierre (usando horarios semanales o fallback)
                $canVisit = $this->canVisitAt($arrivalMin, $entries[$ei]['client']);

                if ($canVisit && $d < $bestDist) {
                    $bestDist = $d;
                    $bestEi = $ei;
                }
            }

            if ($bestEi === null) break;

            $visited[$bestEi] = true;
            $order[] = $bestEi;
            $pi = $bestEi + 1;
            $travelMin = ($dur[$curIdx][$pi]) / 60;
            $t += $travelMin;

            $t = $this->adjustToOpenTime($t, $entries[$bestEi]['client']);
            $t += $entries[$bestEi]['unload_min'];
            $curIdx = $pi;
        }

        // 2-opt improvement (sobre indices)
        $order = $this->twoOpt($order, $dist);

        // Reconstruir ruta con ETAs recalculadas
        $route = [];
        $t = $delegationOpenMin;
        $prevPi = 0; // delegacion

        foreach ($order as $ei) {
            $pi = $ei + 1;
            $travelMin = ($dur[$prevPi][$pi]) / 60;
            $t += $travelMin;

            $t = $this->adjustToOpenTime($t, $entries[$ei]['client']);

            $eta = sprintf('%02d:%02d', floor($t / 60) % 24, (int)$t % 60);

            $route[] = [
                'client_id'  => (int) $entries[$ei]['client']['id'],
                'order_id'   => $entries[$ei]['order_id'],
                'name'       => $entries[$ei]['client']['name'],
                'x'          => (float) $entries[$ei]['client']['x'],
                'y'          => (float) $entries[$ei]['client']['y'],
                'eta'        => $eta,
                'unload_min' => $entries[$ei]['unload_min'],
            ];

            $t += $entries[$ei]['unload_min'];
            $prevPi = $pi;
        }

        // Calcular distancia/tiempo totales con la matriz
        $totalDist = 0;
        $totalDriveS = 0;
        $totalUnload = 0;
        $prevPi = 0;

        foreach ($order as $ei) {
            $pi = $ei + 1;
            $totalDist += $dist[$prevPi][$pi];
            $totalDriveS += $dur[$prevPi][$pi];
            $totalUnload += $entries[$ei]['unload_min'];
            $prevPi = $pi;
        }
        // Vuelta a la delegacion
        $totalDist += $dist[$prevPi][0];
        $totalDriveS += $dur[$prevPi][0];

        $totalHours = ($totalDriveS / 3600) + ($totalUnload / 60);

        return [
            'stops'       => $route,
            'distance_km' => round($totalDist, 1),
            'time_h'      => round($totalHours, 2),
        ];
    }

    /** 2-opt para mejorar la ruta (trabaja con indices y matriz de distancias) */
    private function twoOpt(array $order, array $distMatrix): array
    {
        $n = count($order);
        if ($n < 4) return $order;

        $improved = true;
        while ($improved) {
            $improved = false;
            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 2; $j < $n; $j++) {
                    $ai = $i === 0 ? 0 : $order[$i - 1] + 1;
                    $bi = $order[$i] + 1;
                    $ci = $order[$j] + 1;
                    $di = $j + 1 < $n ? $order[$j + 1] + 1 : 0;

                    $before = $distMatrix[$ai][$bi] + $distMatrix[$ci][$di];
                    $after  = $distMatrix[$ai][$ci] + $distMatrix[$bi][$di];

                    if ($after < $before - 0.001) {
                        $segment = array_slice($order, $i, $j - $i + 1);
                        array_splice($order, $i, $j - $i + 1, array_reverse($segment));
                        $improved = true;
                    }
                }
            }
        }
        return $order;
    }

    /** Obtiene las ventanas horarias del dia para un cliente (_day_windows o fallback) */
    private function getClientWindows(array $client): array
    {
        if (!empty($client['_day_windows'])) {
            return $client['_day_windows']; // [{open_time, close_time}, ...]
        }
        // Fallback a campos simples
        $windows = [['open_time' => $client['open_time'] ?? '00:00', 'close_time' => $client['close_time'] ?? '23:59']];
        if (!empty($client['open_time_2']) && !empty($client['close_time_2'])) {
            $windows[] = ['open_time' => $client['open_time_2'], 'close_time' => $client['close_time_2']];
        }
        return $windows;
    }

    /** Comprueba si se puede visitar a la hora dada (cae antes del cierre de alguna ventana) */
    private function canVisitAt(float $arrivalMin, array $client): bool
    {
        foreach ($this->getClientWindows($client) as $w) {
            if ($arrivalMin <= $this->timeToMin($w['close_time'])) {
                return true;
            }
        }
        return false;
    }

    /** Ajusta el tiempo de llegada a la ventana de apertura mas cercana */
    private function adjustToOpenTime(float $t, array $client): float
    {
        foreach ($this->getClientWindows($client) as $w) {
            $open = $this->timeToMin($w['open_time']);
            $close = $this->timeToMin($w['close_time']);
            if ($t >= $open && $t <= $close) return $t;
            if ($t < $open) return $open;
        }
        return $t; // fuera de horario, se entregara igualmente
    }

    private function timeToMin(string $time): int
    {
        $parts = explode(':', $time);
        return (int) $parts[0] * 60 + (int) ($parts[1] ?? 0);
    }
}

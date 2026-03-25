<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Delegation.php';
require_once __DIR__ . '/../models/Vehicle.php';
require_once __DIR__ . '/../models/RoutePlan.php';
require_once __DIR__ . '/../models/Order.php';
require_once __DIR__ . '/../models/Client.php';
require_once __DIR__ . '/../models/DistanceCache.php';
require_once __DIR__ . '/../models/ClientSchedule.php';
require_once __DIR__ . '/../models/AppSetting.php';

class RouteController extends Controller
{
    private $delegationModel;
    private $vehicleModel;
    private $routePlan;
    private $orderModel;
    private $clientModel;
    private $distCache;
    private $scheduleModel;
    private $settingModel;

    // Configuracion dinamica (se carga en optimize)
    private int $lunchDuration = 60;
    private int $lunchEarliest = 720;
    private int $lunchLatest = 930;
    private float $baseUnloadMin = 5.0;

    public function __construct()
    {
        $this->delegationModel = new Delegation();
        $this->vehicleModel    = new Vehicle();
        $this->routePlan       = new RoutePlan();
        $this->orderModel      = new Order();
        $this->clientModel     = new Client();
        $this->distCache       = new DistanceCache();
        $this->scheduleModel   = new ClientSchedule();
        $this->settingModel    = new AppSetting();
    }

    /** GET api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD */
    public function stats()
    {
        $from = $_GET['from'] ?? date('Y-m-d', strtotime('-30 days'));
        $to   = $_GET['to']   ?? date('Y-m-d');
        $this->json($this->routePlan->getStats($from, $to));
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

    /** PUT api/routes/{id} — guardar cambios manuales en ruta */
    public function update($id)
    {
        $input = $this->getInput();
        $stops = $input['stops'] ?? [];
        $totalDist = (float) ($input['total_distance_km'] ?? 0);
        $totalTime = (float) ($input['total_time_h'] ?? 0);
        $totalUnload = (float) ($input['total_unload_min'] ?? 0);

        $this->routePlan->updateStops((int) $id, $stops, $totalDist, $totalTime, $totalUnload);
        $this->json(['ok' => true]);
    }

    /** GET api/routes/history?from=YYYY-MM-DD&to=YYYY-MM-DD */
    public function history()
    {
        $from = $_GET['from'] ?? date('Y-m-d', strtotime('-30 days'));
        $to   = $_GET['to']   ?? date('Y-m-d');
        $rows = $this->routePlan->getHistory($from, $to);
        $this->json($rows);
    }

    /** PUT api/routes/{id}/stop/{stopOrder}/status */
    public function updateStopStatus($planId, $stopOrder)
    {
        $input = $this->getInput();
        $status = $input['status'] ?? 'pending';
        $allowed = ['pending', 'arrived', 'completed', 'skipped'];
        if (!in_array($status, $allowed)) {
            $this->json(['error' => 'Estado invalido'], 400);
            return;
        }
        $this->routePlan->updateStopStatus((int) $planId, (int) $stopOrder, $status);

        // Actualizar status del plan si todas las paradas estan completadas/skipped
        $plan = $this->routePlan->getById((int) $planId);
        if ($plan) {
            $allDone = true;
            foreach ($plan['stops'] as $s) {
                if (!in_array($s['status'], ['completed', 'skipped'])) {
                    $allDone = false;
                    break;
                }
            }
            $newStatus = $allDone ? 'completed' : 'in_progress';
            $this->routePlan->updatePlanStatus((int) $planId, $newStatus);
        }

        $this->json(['ok' => true]);
    }

    /** PUT api/routes/{id}/status */
    public function updatePlanStatus($planId)
    {
        $input = $this->getInput();
        $status = $input['status'] ?? 'draft';
        $this->routePlan->updatePlanStatus((int) $planId, $status);
        $this->json(['ok' => true]);
    }

    /** POST api/routes/optimize */
    public function optimize()
    {
        $this->loadSettings();
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
                $unloadTime = $this->routePlan->calculateUnloadTime($orderData['id'], $this->baseUnloadMin);
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
                    'delegation'        => ['id' => $delegationId, 'name' => $delegation['name'], 'x' => (float) $delegation['x'], 'y' => (float) $delegation['y'], 'open_time' => $delegation['open_time'] ?? '06:00'],
                    'stops'             => $route['stops'],
                    'total_distance_km' => $route['distance_km'],
                    'total_time_h'      => $route['time_h'],
                    'total_unload_min'  => $totalUnload,
                    'lunch_after_stop'  => $route['lunch_after_stop'],
                    'lunch_eta'         => $route['lunch_eta'],
                    'return_travel_min' => $route['return_travel_min'],
                    'departure_earliest' => $route['departure_earliest'],
                    'departure_latest'   => $route['departure_latest'],
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
            'settings'   => [
                'lunch_duration_min' => $this->lunchDuration,
                'lunch_earliest'     => sprintf('%02d:%02d', floor($this->lunchEarliest / 60), $this->lunchEarliest % 60),
                'lunch_latest'       => sprintf('%02d:%02d', floor($this->lunchLatest / 60), $this->lunchLatest % 60),
                'base_unload_min'    => $this->baseUnloadMin,
            ],
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

    /** Carga configuracion dinamica de app_settings */
    private function loadSettings(): void
    {
        $s = $this->settingModel->getAll();
        $this->lunchDuration = (int) ($s['lunch_duration_min'] ?? 60);
        $this->lunchEarliest = $this->timeToMin($s['lunch_earliest'] ?? '12:00');
        $this->lunchLatest   = $this->timeToMin($s['lunch_latest'] ?? '15:30');
        $this->baseUnloadMin = (float) ($s['base_unload_min'] ?? 5.0);
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

        // 1. Nearest-neighbor SIN almuerzo
        $n = count($entries);
        $visited = array_fill(0, $n, false);
        $order = [];
        $curIdx = 0;
        $delegationOpenMin = $this->timeToMin($delegation['open_time'] ?? '06:00');
        $t = $delegationOpenMin;

        for ($step = 0; $step < $n; $step++) {
            $bestEi = null;
            $bestDist = PHP_FLOAT_MAX;

            for ($ei = 0; $ei < $n; $ei++) {
                if ($visited[$ei]) continue;
                $pi = $ei + 1;
                $d = $dist[$curIdx][$pi];
                $travelMin = ($dur[$curIdx][$pi]) / 60;
                $arrivalMin = $t + $travelMin;
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

        // 2-opt improvement
        $order = $this->twoOpt($order, $dist);

        // 2. Encontrar posicion optima para el almuerzo
        $lunchAfterStop = $this->findBestLunchPosition($order, $entries, $dur, $delegationOpenMin);

        // 3. Reconstruir ruta con ETAs y almuerzo en posicion optima
        $route = [];
        $t = $delegationOpenMin;
        $prevPi = 0;
        $lunchEta = null;

        foreach ($order as $idx => $ei) {
            // Insertar almuerzo ANTES de esta parada si corresponde
            if ($lunchAfterStop !== null && $idx === $lunchAfterStop) {
                $lunchEta = sprintf('%02d:%02d', floor($t / 60) % 24, (int)$t % 60);
                $t += $this->lunchDuration;
            }

            $pi = $ei + 1;
            $travelMin = ($dur[$prevPi][$pi]) / 60;
            $t += $travelMin;

            $t = $this->adjustToOpenTime($t, $entries[$ei]['client']);

            $eta = sprintf('%02d:%02d', floor($t / 60) % 24, (int)$t % 60);

            $route[] = [
                'client_id'   => (int) $entries[$ei]['client']['id'],
                'order_id'    => $entries[$ei]['order_id'],
                'name'        => $entries[$ei]['client']['name'],
                'x'           => (float) $entries[$ei]['client']['x'],
                'y'           => (float) $entries[$ei]['client']['y'],
                'eta'         => $eta,
                'travel_min'  => round($travelMin, 1),
                'unload_min'  => $entries[$ei]['unload_min'],
                'items_count' => $entries[$ei]['load']['items'] ?? 0,
            ];

            $t += $entries[$ei]['unload_min'];
            $prevPi = $pi;
        }

        // Almuerzo al final si no se inserto durante la ruta
        if ($lunchAfterStop !== null && $lunchAfterStop === count($order)) {
            $lunchEta = sprintf('%02d:%02d', floor($t / 60) % 24, (int)$t % 60);
        }

        // Calcular distancia/tiempo totales
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
        $totalDist += $dist[$prevPi][0];
        $totalDriveS += $dur[$prevPi][0];

        $lunchHours = ($lunchAfterStop !== null) ? $this->lunchDuration / 60.0 : 0;
        $totalHours = ($totalDriveS / 3600) + ($totalUnload / 60) + $lunchHours;

        $returnTravelMin = round($dur[$prevPi][0] / 60, 1);

        // 4. Calcular rango de salida viable
        $latestDep = $this->findLatestDeparture($order, $entries, $dur, $delegationOpenMin, $lunchAfterStop);
        $depEarliest = sprintf('%02d:%02d', floor($delegationOpenMin / 60) % 24, $delegationOpenMin % 60);
        $depLatest   = sprintf('%02d:%02d', floor($latestDep / 60) % 24, $latestDep % 60);

        return [
            'stops'       => $route,
            'distance_km' => round($totalDist, 1),
            'time_h'      => round($totalHours, 2),
            'lunch_after_stop' => $lunchAfterStop,
            'lunch_eta'   => $lunchEta,
            'return_travel_min' => $returnTravelMin,
            'departure_earliest' => $depEarliest,
            'departure_latest'   => $depLatest,
        ];
    }

    /**
     * Encuentra la posicion optima para el almuerzo.
     * Simula insertar 1h de pausa entre cada par de paradas y elige
     * la que anade menos tiempo extra (aprovechando huecos de espera).
     * Solo considera posiciones donde el almuerzo cae entre LUNCH_EARLIEST y LUNCH_LATEST.
     * Retorna indice en $order (almuerzo ANTES del stop en esa posicion), o null si la ruta acaba antes de las 12:00.
     */
    private function findBestLunchPosition(array $order, array $entries, array $dur, int $startMin): ?int
    {
        if (count($order) < 2) return null;

        // Primero calcular ETAs sin almuerzo para saber los tiempos
        $times = []; // departure time after each stop
        $arrivals = []; // arrival time at each stop
        $t = $startMin;
        $prevPi = 0;

        foreach ($order as $idx => $ei) {
            $pi = $ei + 1;
            $travelMin = ($dur[$prevPi][$pi]) / 60;
            $t += $travelMin;
            $arrivalRaw = $t;
            $t = $this->adjustToOpenTime($t, $entries[$ei]['client']);
            $arrivals[$idx] = ['raw' => $arrivalRaw, 'adjusted' => $t];
            $t += $entries[$ei]['unload_min'];
            $times[$idx] = $t; // tiempo de salida de esta parada
            $prevPi = $pi;
        }

        // Si la ruta entera acaba antes de la ventana de almuerzo, no hace falta
        $routeEnd = end($times);
        if ($routeEnd < $this->lunchEarliest) return null;

        // Evaluar cada posicion posible (0..N: antes del stop 0, entre 0-1, ..., despues del ultimo)
        $bestPos = null;
        $bestCost = PHP_FLOAT_MAX;

        for ($pos = 0; $pos <= count($order); $pos++) {
            // Tiempo al que empezaria el almuerzo en esta posicion
            $lunchStartTime = ($pos === 0) ? $startMin : $times[$pos - 1];

            // Solo considerar si el almuerzo cae en ventana razonable
            if ($lunchStartTime < $this->lunchEarliest - 30) continue; // muy pronto
            if ($lunchStartTime > $this->lunchLatest) continue; // muy tarde

            // Simular la ruta con almuerzo en esta posicion
            $cost = $this->simulateLunchCost($order, $entries, $dur, $startMin, $pos);

            if ($cost !== null && $cost < $bestCost) {
                $bestCost = $cost;
                $bestPos = $pos;
            }
        }

        return $bestPos;
    }

    /**
     * Simula el coste extra de insertar almuerzo en una posicion.
     * Retorna el tiempo extra anadido respecto a la ruta sin almuerzo,
     * o null si alguna parada posterior se vuelve inaccesible.
     */
    private function simulateLunchCost(array $order, array $entries, array $dur, int $startMin, int $lunchPos): ?float
    {
        $t = $startMin;
        $prevPi = 0;
        $tNoLunch = $startMin;

        foreach ($order as $idx => $ei) {
            // Insertar almuerzo antes de esta parada
            if ($idx === $lunchPos) {
                $t += $this->lunchDuration;
            }

            $pi = $ei + 1;
            $travelMin = ($dur[$prevPi][$pi]) / 60;
            $t += $travelMin;
            $tNoLunch += $travelMin;

            // Con almuerzo: ajustar a apertura
            $t = $this->adjustToOpenTime($t, $entries[$ei]['client']);
            // Sin almuerzo: ajustar a apertura
            $tNoLunch = $this->adjustToOpenTime($tNoLunch, $entries[$ei]['client']);

            // Verificar que sigue siendo visitable
            if (!$this->canVisitAt($t, $entries[$ei]['client'])) {
                return null; // esta posicion invalida la ruta
            }

            $t += $entries[$ei]['unload_min'];
            $tNoLunch += $entries[$ei]['unload_min'];
            $prevPi = $pi;
        }

        // Almuerzo despues del ultimo stop
        if ($lunchPos === count($order)) {
            $t += $this->lunchDuration;
        }

        // Coste = tiempo extra que el almuerzo anade realmente
        // (puede ser < 60 min si el almuerzo se solapa con tiempo de espera a apertura)
        return $t - $tNoLunch;
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

    /**
     * Busqueda binaria: hora de salida mas tardia que no rompe ninguna ventana horaria.
     * Simula la ruta completa (con almuerzo) desplazando la salida y comprueba
     * que cada parada llega antes del cierre de al menos una ventana.
     */
    private function findLatestDeparture(array $order, array $entries, array $dur, int $earliestMin, ?int $lunchAfterStop): int
    {
        // Limite superior: salir mas tarde de las 12:00 no tiene sentido
        $lo = $earliestMin;
        $hi = min($earliestMin + 360, 720); // max +6h o mediodia

        // Verificar que saliendo lo mas temprano posible funciona
        if (!$this->simulateDeparture($order, $entries, $dur, $lo, $lunchAfterStop)) {
            return $lo;
        }

        // Busqueda binaria con paso de 5 minutos
        while ($hi - $lo > 5) {
            $mid = (int)(($lo + $hi) / 2);
            if ($this->simulateDeparture($order, $entries, $dur, $mid, $lunchAfterStop)) {
                $lo = $mid;
            } else {
                $hi = $mid;
            }
        }

        return $lo;
    }

    /** Simula la ruta completa desde $startMin y devuelve true si todas las paradas son visitables */
    private function simulateDeparture(array $order, array $entries, array $dur, int $startMin, ?int $lunchAfterStop): bool
    {
        $t = (float) $startMin;
        $prevPi = 0;

        foreach ($order as $idx => $ei) {
            if ($lunchAfterStop !== null && $idx === $lunchAfterStop) {
                $t += $this->lunchDuration;
            }

            $pi = $ei + 1;
            $travelMin = $dur[$prevPi][$pi] / 60;
            $t += $travelMin;

            // Comprobar que llegamos antes del cierre de alguna ventana
            if (!$this->canVisitAt($t, $entries[$ei]['client'])) {
                return false;
            }

            $t = $this->adjustToOpenTime($t, $entries[$ei]['client']);
            $t += $entries[$ei]['unload_min'];
            $prevPi = $pi;
        }

        return true;
    }

    private function timeToMin(string $time): int
    {
        $parts = explode(':', $time);
        return (int) $parts[0] * 60 + (int) ($parts[1] ?? 0);
    }
}

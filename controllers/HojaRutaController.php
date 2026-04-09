<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../models/Client.php';
require_once __DIR__ . '/../models/DistanceCache.php';

class HojaRutaController extends Controller
{
    private $model;

    public function __construct()
    {
        $this->model = new HojaRuta();
    }

    /* GET /api/hojas-ruta?fecha=YYYY-MM-DD[&ruta_id=X] */
    public function index()
    {
        $fecha  = $_GET['fecha'] ?? date('Y-m-d');
        $rutaId = isset($_GET['ruta_id']) ? (int) $_GET['ruta_id'] : null;
        $userId = Auth::isComercial() ? Auth::currentUser()['id'] : null;

        if (Auth::isComercial()) {
            $allowedIds = Auth::comercialIds();
            $allowedRutaIds = $this->model->getRutaIdsForComerciales($allowedIds);

            if ($rutaId && !in_array($rutaId, $allowedRutaIds, true)) {
                $hojas = [];
                $rutasSinHoja = [];
            } else {
                $hojas = [];
                $rutasSinHojaMap = [];
                foreach ($this->model->getRutasSinHoja($fecha) as $ruta) {
                    if (in_array((int) $ruta['id'], $allowedRutaIds, true)) {
                        $rutasSinHojaMap[(int) $ruta['id']] = $ruta;
                    }
                }

                foreach ($this->model->getByFecha($fecha, $rutaId, null) as $hoja) {
                    if (!in_array((int) $hoja['ruta_id'], $allowedRutaIds, true)) {
                        continue;
                    }

                    $this->model->prefillRouteClientsForComerciales((int) $hoja['id'], $allowedIds);
                    $hoja = $this->model->getById((int) $hoja['id']);
                    $hoja = $this->filterHojaForComercial($hoja, $allowedIds);

                    if ($this->hojaHasComercialActivity($hoja)) {
                        $hojas[] = $hoja;
                        unset($rutasSinHojaMap[(int) $hoja['ruta_id']]);
                    } else {
                        $rutasSinHojaMap[(int) $hoja['ruta_id']] = [
                            'id' => (int) $hoja['ruta_id'],
                            'name' => $hoja['ruta_name'],
                            'active' => 1,
                        ];
                    }
                }

                $rutasSinHoja = array_values($rutasSinHojaMap);
                usort($rutasSinHoja, fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));
            }
        } else {
            $hojas = $this->model->getByFecha($fecha, $rutaId, $userId);
            $rutasSinHoja = $this->model->getRutasSinHoja($fecha);
        }

        $this->json([
            'hojas'         => $hojas,
            'rutas_sin_hoja' => $rutasSinHoja,
        ]);
    }

    /* GET /api/hojas-ruta/{id} */
    public function show($id)
    {
        $hoja = $this->model->getById((int) $id);
        if (!$hoja) $this->json(['error' => 'Hoja no encontrada'], 404);

        if (Auth::isComercial()) {
            $allowedIds = Auth::comercialIds();
            $allowedRutaIds = $this->model->getRutaIdsForComerciales($allowedIds);
            if (!in_array((int) $hoja['ruta_id'], $allowedRutaIds, true)) {
                $this->json(['error' => 'No tienes acceso a esta ruta'], 403);
            }

            $this->model->prefillRouteClientsForComerciales((int) $id, $allowedIds);
            $hoja = $this->model->getById((int) $id);
            $hoja = $this->filterHojaForComercial($hoja, $allowedIds);
        }

        $this->json($hoja);
    }

    /* POST /api/hojas-ruta */
    public function store()
    {
        $data = $this->getInput();
        if (empty($data['ruta_id']) || empty($data['fecha'])) {
            $this->json(['error' => 'ruta_id y fecha son obligatorios'], 400);
        }

        try {
            $data['user_id'] = Auth::currentUser()['id'] ?? null;
            $id = $this->model->create($data);
            if (Auth::isComercial()) {
                $this->model->prefillRouteClientsForComerciales($id, Auth::comercialIds());
            }
            $this->json($this->model->getById($id), 201);
        } catch (\Exception $e) {
            if (strpos($e->getMessage(), 'Duplicate') !== false) {
                $this->json(['error' => 'Ya existe una hoja para esa ruta y fecha'], 409);
            }
            throw $e;
        }
    }

    /* PUT /api/hojas-ruta/{id} */
    public function update($id)
    {
        $data = $this->getInput();
        $hoja = $this->model->getById((int) $id);
        if (!$hoja) $this->json(['error' => 'Hoja no encontrada'], 404);

        if (array_key_exists('vehicle_id', $data)) {
            $data['vehicle_id'] = !empty($data['vehicle_id']) ? (int) $data['vehicle_id'] : null;
        }

        $targetEstado = $data['estado'] ?? $hoja['estado'];
        $targetVehicleId = array_key_exists('vehicle_id', $data) ? $data['vehicle_id'] : ($hoja['vehicle_id'] ?? null);
        if ($targetEstado === 'cerrada' && empty($targetVehicleId)) {
            $this->json(['error' => 'Debes asignar un vehiculo antes de cerrar la ruta'], 400);
        }

        $this->model->update((int) $id, $data);
        $this->json($this->model->getById((int) $id));
    }

    /* DELETE /api/hojas-ruta/{id} */
    public function destroy($id)
    {
        $ok = $this->model->delete((int) $id);
        if (!$ok) {
            $this->json(['error' => 'Solo se pueden eliminar hojas en estado borrador'], 400);
        }
        $this->json(['ok' => true]);
    }

    /* PUT /api/hojas-ruta/{id}/estado */
    public function updateEstado($id)
    {
        $data = $this->getInput();
        if (empty($data['estado'])) {
            $this->json(['error' => 'estado es obligatorio'], 400);
        }

        $hoja = $this->model->getById((int) $id);
        if (!$hoja) $this->json(['error' => 'Hoja no encontrada'], 404);
        if ($data['estado'] === 'cerrada' && empty($hoja['vehicle_id'])) {
            $this->json(['error' => 'Debes asignar un vehiculo antes de cerrar la ruta'], 400);
        }

        $ok = $this->model->updateEstado((int) $id, $data['estado']);
        if (!$ok) $this->json(['error' => 'Estado no valido'], 400);
        $this->json($this->model->getById((int) $id));
    }

    /* POST /api/hojas-ruta/{id}/lineas */
    public function addLinea($id)
    {
        $data = $this->getInput();
        if (empty($data['client_id'])) {
            $this->json(['error' => 'client_id es obligatorio'], 400);
        }

        if (Auth::isComercial()) {
            $clientModel = new Client();
            $client = $clientModel->getById((int) $data['client_id']);
            if (!$client) {
                $this->json(['error' => 'Cliente no encontrado'], 404);
            }

            $allowedComercialIds = Auth::comercialIds();
            $clientComercialId = !empty($client['comercial_id']) ? (int) $client['comercial_id'] : null;

            if (!$clientComercialId || !in_array($clientComercialId, $allowedComercialIds, true)) {
                $this->json(['error' => 'Ese cliente no pertenece a tus comerciales asociados'], 403);
            }

            // Para usuarios comerciales el comercial de la linea se deduce del propio cliente.
            $data['comercial_id'] = $clientComercialId;
        }

        $data = $this->normalizeLineaUnits($data);
        $data['hoja_ruta_id'] = (int) $id;
        $lineaId = $this->model->addLinea((int) $id, $data);
        $this->json($this->model->getById((int) $id), 201);
    }

    /* PUT /api/hojas-ruta/{id}/lineas/{lineaId} */
    public function updateLinea($id, $lineaId)
    {
        $data = $this->getInput();
        $linea = $this->model->getLineaById((int) $lineaId);
        if (!$linea || (int) $linea['hoja_ruta_id'] !== (int) $id) {
            $this->json(['error' => 'Linea no encontrada'], 404);
        }

        if (Auth::isComercial()) {
            $allowedIds = Auth::comercialIds();
            $lineaComercialId = !empty($linea['comercial_id']) ? (int) $linea['comercial_id'] : null;

            if (!$lineaComercialId || !in_array($lineaComercialId, $allowedIds, true)) {
                $this->json(['error' => 'No puedes editar una linea de otro comercial'], 403);
            }

            $data = [
                'carros' => isset($data['carros']) ? (float) $data['carros'] : (float) ($linea['carros'] ?? 0),
                'cajas' => isset($data['cajas']) ? (float) $data['cajas'] : (float) ($linea['cajas'] ?? 0),
            ];
        }

        if (array_key_exists('carros', $data) || array_key_exists('cajas', $data)) {
            if (!array_key_exists('carros', $data)) {
                $data['carros'] = (float) ($linea['carros'] ?? 0);
            }
            if (!array_key_exists('cajas', $data)) {
                $data['cajas'] = (float) ($linea['cajas'] ?? 0);
            }
        }

        $data = $this->normalizeLineaUnits($data);
        $this->model->updateLinea((int) $lineaId, $data);
        $this->json($this->model->getById((int) $id));
    }

    /* DELETE /api/hojas-ruta/{id}/lineas/{lineaId} */
    public function removeLinea($id, $lineaId)
    {
        $this->model->removeLinea((int) $lineaId);
        $this->json($this->model->getById((int) $id));
    }

    /* PUT /api/hojas-ruta/{id}/reordenar */
    public function reorder($id)
    {
        $data = $this->getInput();
        if (empty($data['linea_ids']) || !is_array($data['linea_ids'])) {
            $this->json(['error' => 'linea_ids (array) es obligatorio'], 400);
        }
        $this->model->reorder((int) $id, $data['linea_ids']);
        $this->json($this->model->getById((int) $id));
    }

    /* POST /api/hojas-ruta/{id}/auto-ordenar */
    public function autoOrder($id)
    {
        $hoja = $this->model->getById((int) $id);
        if (!$hoja) $this->json(['error' => 'Hoja no encontrada'], 404);

        $allLineas = $hoja['lineas'];
        // Solo ordenar líneas con carga (carros o cajas > 0) — las sin carga van al final
        $lineas = array_values(array_filter($allLineas, fn($l) =>
            (float) ($l['carros'] ?? 0) > 0 || (float) ($l['cajas'] ?? 0) > 0
        ));
        $noCargaLineaIds = array_map(
            fn($l) => (int) $l['id'],
            array_filter($allLineas, fn($l) =>
                (float) ($l['carros'] ?? 0) <= 0 && (float) ($l['cajas'] ?? 0) <= 0
            )
        );

        if (count($lineas) < 2) {
            if (count($lineas) === 1) {
                $ordered = [(int) $lineas[0]['id']];
                $ordered = array_merge($ordered, $noCargaLineaIds);
                $this->model->reorder((int) $id, $ordered);
            }
            $this->json($this->model->getById((int) $id));
            return;
        }

        // Obtener delegacion de referencia para salida y regreso
        $delegation = $this->getDelegationForHoja($hoja);

        // Construir puntos: [0] = delegacion, [1..N] = clientes
        $points = [];
        $hasDepot = false;
        if ($delegation) {
            $points[] = ['lat' => (float) $delegation['x'], 'lng' => (float) $delegation['y']];
            $hasDepot = true;
        }

        $clientWaypoints = [];
        $noCoordLineaIds = [];
        foreach ($lineas as $l) {
            if ($l['client_x'] && $l['client_y']) {
                $wp = [
                    'lat'      => (float) $l['client_x'],
                    'lng'      => (float) $l['client_y'],
                    'linea_id' => (int) $l['id'],
                ];
                $points[] = $wp;
                $clientWaypoints[] = $wp;
            } else {
                $noCoordLineaIds[] = (int) $l['id'];
            }
        }

        // Construir matriz de distancias/duraciones reales via OSRM
        $distCache = new DistanceCache();
        $matrix = $distCache->buildMatrix($points);
        $durations = $matrix['durations'];

        // Nearest-neighbor usando duraciones reales
        $depotIdx = $hasDepot ? 0 : null;
        $n = count($points);
        $clientIndices = $hasDepot ? range(1, $n - 1) : range(0, $n - 1);

        $currentIdx = $depotIdx ?? $clientIndices[0];
        $remaining = $clientIndices;
        $orderedIndices = [];

        while (count($remaining) > 0) {
            $bestIdx = 0;
            $bestTime = PHP_FLOAT_MAX;
            foreach ($remaining as $ri => $ptIdx) {
                $t = $durations[$currentIdx][$ptIdx];
                if ($t < $bestTime) {
                    $bestTime = $t;
                    $bestIdx = $ri;
                }
            }
            $orderedIndices[] = $remaining[$bestIdx];
            $currentIdx = $remaining[$bestIdx];
            array_splice($remaining, $bestIdx, 1);
        }

        // 2-opt improvement usando duraciones reales
        $orderedIndices = $this->twoOptMatrix($orderedIndices, $durations, $depotIdx);

        // Mapear indices de vuelta a linea_ids, clientes sin coordenadas y sin carga van al final
        $lineaIds = array_map(fn($idx) => $points[$idx]['linea_id'], $orderedIndices);
        $lineaIds = array_merge($lineaIds, $noCoordLineaIds, $noCargaLineaIds);
        $this->model->reorder((int) $id, $lineaIds);

        $this->json($this->model->getById((int) $id));
    }

    /* POST /api/hojas-ruta/generar-desde-pedidos */
    public function generateFromOrders()
    {
        if (Auth::isComercial()) {
            $this->json(['error' => 'Solo logistica/admin puede generar hojas'], 403);
            return;
        }

        $data = $this->getInput();
        $fecha = $data['fecha'] ?? date('Y-m-d');

        require_once __DIR__ . '/../models/Order.php';
        $orderModel = new Order();
        $grouped = $orderModel->getConfirmedByDateGroupedByRuta($fecha);

        if (empty($grouped['rutas'])) {
            $this->json([
                'error'   => 'No hay pedidos confirmados para ' . $fecha,
                'alertas' => $grouped['alertas'],
            ], 400);
            return;
        }

        $result = $this->model->generateFromOrders($fecha, $grouped['rutas']);
        $result['alertas'] = $grouped['alertas'];
        $result['sin_ruta'] = $grouped['sin_ruta'];

        $this->json($result, 201);
    }

    /* POST /api/hojas-ruta/{id}/duplicar */
    public function duplicate($id)
    {
        $data = $this->getInput();
        $newFecha = $data['fecha'] ?? date('Y-m-d');

        $newId = $this->model->duplicate((int) $id, $newFecha);
        if (!$newId) $this->json(['error' => 'Hoja origen no encontrada'], 404);

        $this->json($this->model->getById($newId), 201);
    }

    /* GET /api/hojas-ruta/{id}/imprimir */
    public function printHoja($id)
    {
        $hoja = $this->model->getById((int) $id);
        if (!$hoja) $this->json(['error' => 'Hoja no encontrada'], 404);

        // Devolver datos para que el frontend genere la vista de impresion
        $this->json($hoja);
    }

    /* GET /api/comerciales */
    public function comerciales()
    {
        $comerciales = $this->model->getComerciales();

        if (Auth::isComercial()) {
            $allowedIds = Auth::comercialIds();
            $comerciales = array_values(array_filter(
                $comerciales,
                fn ($comercial) => in_array((int) $comercial['id'], $allowedIds, true)
            ));
        }

        $this->json($comerciales);
    }

    /* ── Helpers privados ── */

    private function getDelegationForHoja(array $hoja)
    {
        return $this->model->getDelegationForHoja((int) $hoja['id']);
    }

    private function filterHojaForComercial(array $hoja, array $allowedIds): array
    {
        $allowedIds = array_values(array_filter(array_map('intval', $allowedIds)));
        $hoja['lineas'] = array_values(array_filter(
            $hoja['lineas'] ?? [],
            fn ($linea) => !empty($linea['comercial_id']) && in_array((int) $linea['comercial_id'], $allowedIds, true)
        ));
        $hoja['num_lineas'] = count($hoja['lineas']);
        $hoja['total_carros'] = array_reduce(
            $hoja['lineas'],
            fn ($carry, $linea) => $carry + (float) ($linea['carros'] ?? 0),
            0.0
        );
        $hoja['total_cajas'] = array_reduce(
            $hoja['lineas'],
            fn ($carry, $linea) => $carry + (float) ($linea['cajas'] ?? 0),
            0.0
        );
        $hoja['total_cc'] = array_reduce(
            $hoja['lineas'],
            fn ($carry, $linea) => $carry + (float) (($linea['carros'] ?? 0) + ($linea['cajas'] ?? 0)),
            0.0
        );

        return $hoja;
    }

    private function hojaHasComercialActivity(array $hoja): bool
    {
        foreach ($hoja['lineas'] ?? [] as $linea) {
            if ((float) ($linea['carros'] ?? 0) > 0 || (float) ($linea['cajas'] ?? 0) > 0) {
                return true;
            }
        }

        return false;
    }

    private function normalizeLineaUnits(array $data): array
    {
        $hasCarros = array_key_exists('carros', $data);
        $hasCajas = array_key_exists('cajas', $data);

        if (!$hasCarros && !$hasCajas && array_key_exists('cc_aprox', $data)) {
            $data['cajas'] = (float) $data['cc_aprox'];
            $hasCajas = true;
        }

        if ($hasCarros) {
            $data['carros'] = max(0, (float) $data['carros']);
        }

        if ($hasCajas) {
            $data['cajas'] = max(0, (float) $data['cajas']);
        }

        if ($hasCarros || $hasCajas || array_key_exists('cc_aprox', $data)) {
            $data['cc_aprox'] = (float) ($data['carros'] ?? 0) + (float) ($data['cajas'] ?? 0);
        }

        return $data;
    }

    private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function twoOpt(array $route, ?array $delegation): array
    {
        $n = count($route);
        if ($n < 3) return $route;

        $improved = true;
        $maxIter = 50;
        $iter = 0;

        while ($improved && $iter < $maxIter) {
            $improved = false;
            $iter++;

            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $d1 = $this->segDist($route, $i - 1, $i, $delegation)
                        + $this->segDist($route, $j, $j + 1, $delegation);
                    $d2 = $this->segDist($route, $i - 1, $j, $delegation)
                        + $this->segDist($route, $i, $j + 1, $delegation);

                    if ($d2 < $d1 - 0.001) {
                        $reversed = array_reverse(array_slice($route, $i, $j - $i + 1));
                        array_splice($route, $i, $j - $i + 1, $reversed);
                        $improved = true;
                    }
                }
            }
        }

        return $route;
    }

    private function segDist(array $route, int $a, int $b, ?array $delegation): float
    {
        $n = count($route);
        if ($a < 0 || $a >= $n) {
            if ($delegation) return $this->haversine($delegation['x'], $delegation['y'], $route[$b]['lat'], $route[$b]['lng']);
            return 0;
        }
        if ($b < 0 || $b >= $n) {
            if ($delegation) return $this->haversine($route[$a]['lat'], $route[$a]['lng'], $delegation['x'], $delegation['y']);
            return 0;
        }
        return $this->haversine($route[$a]['lat'], $route[$a]['lng'], $route[$b]['lat'], $route[$b]['lng']);
    }

    /**
     * 2-opt improvement usando matriz de duraciones reales (OSRM).
     * $route = array de indices en la matriz de puntos.
     * $durations = float[][] matriz NxN de duraciones.
     * $depotIdx = indice del depot en la matriz (o null).
     */
    private function twoOptMatrix(array $route, array $durations, ?int $depotIdx): array
    {
        $n = count($route);
        if ($n < 3) return $route;

        $improved = true;
        $maxIter = 50;
        $iter = 0;

        while ($improved && $iter < $maxIter) {
            $improved = false;
            $iter++;

            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $prevI = $i === 0 ? $depotIdx : $route[$i - 1];
                    $nextJ = $j === $n - 1 ? $depotIdx : $route[$j + 1];

                    $d1 = ($prevI !== null ? $durations[$prevI][$route[$i]] : 0)
                         + ($nextJ !== null ? $durations[$route[$j]][$nextJ] : 0);
                    $d2 = ($prevI !== null ? $durations[$prevI][$route[$j]] : 0)
                         + ($nextJ !== null ? $durations[$route[$i]][$nextJ] : 0);

                    if ($d2 < $d1 - 0.1) {
                        $reversed = array_reverse(array_slice($route, $i, $j - $i + 1));
                        array_splice($route, $i, $j - $i + 1, $reversed);
                        $improved = true;
                    }
                }
            }
        }

        return $route;
    }
}

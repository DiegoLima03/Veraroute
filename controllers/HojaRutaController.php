<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/HojaRuta.php';
require_once __DIR__ . '/../models/Cliente.php';
require_once __DIR__ . '/../models/DistanciasCache.php';
require_once __DIR__ . '/../services/OptimizadorRuta.php';

class HojaRutaController extends Controlador
{
    private $model;

    public function __construct()
    {
        $this->model = new HojaRuta();
    }

    /* GET /api/hojas-ruta?fecha=YYYY-MM-DD[&id_ruta=X] */
    public function index()
    {
        $fecha  = $_GET['fecha'] ?? date('Y-m-d');
        $rutaId = isset($_GET['id_ruta']) ? (int) $_GET['id_ruta'] : null;
        $userId = Autenticacion::isComercial() ? Autenticacion::currentUser()['id'] : null;

        if (Autenticacion::isComercial()) {
            $allowedIds = Autenticacion::comercialIds();
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
                    if (!in_array((int) $hoja['id_ruta'], $allowedRutaIds, true)) {
                        continue;
                    }

                    $this->model->prefillRouteClientsForComerciales((int) $hoja['id'], $allowedIds);
                    $hoja = $this->model->getById((int) $hoja['id']);
                    $hoja = $this->filterHojaForComercial($hoja, $allowedIds);

                    if ($this->hojaHasComercialActivity($hoja)) {
                        $hojas[] = $hoja;
                        unset($rutasSinHojaMap[(int) $hoja['id_ruta']]);
                    } else {
                        $rutasSinHojaMap[(int) $hoja['id_ruta']] = [
                            'id' => (int) $hoja['id_ruta'],
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

        if (Autenticacion::isComercial()) {
            $allowedIds = Autenticacion::comercialIds();
            $allowedRutaIds = $this->model->getRutaIdsForComerciales($allowedIds);
            if (!in_array((int) $hoja['id_ruta'], $allowedRutaIds, true)) {
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
        if (empty($data['id_ruta']) || empty($data['fecha'])) {
            $this->json(['error' => 'id_ruta y fecha son obligatorios'], 400);
        }

        try {
            $data['id_usuario'] = Autenticacion::currentUser()['id'] ?? null;
            $id = $this->model->create($data);
            if (Autenticacion::isComercial()) {
                $this->model->prefillRouteClientsForComerciales($id, Autenticacion::comercialIds());
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

        if (array_key_exists('id_vehiculo', $data)) {
            $data['id_vehiculo'] = !empty($data['id_vehiculo']) ? (int) $data['id_vehiculo'] : null;
        }

        $targetEstado = $data['estado'] ?? $hoja['estado'];
        $targetVehicleId = array_key_exists('id_vehiculo', $data) ? $data['id_vehiculo'] : ($hoja['id_vehiculo'] ?? null);
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
        if ($data['estado'] === 'cerrada' && empty($hoja['id_vehiculo'])) {
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
        if (empty($data['id_cliente'])) {
            $this->json(['error' => 'id_cliente es obligatorio'], 400);
        }

        if (Autenticacion::isComercial()) {
            $clientModel = new Cliente();
            $client = $clientModel->getById((int) $data['id_cliente']);
            if (!$client) {
                $this->json(['error' => 'Cliente no encontrado'], 404);
            }

            $allowedComercialIds = Autenticacion::comercialIds();
            $clientComercialId = $this->pickMatchingCommercialId($client, $allowedComercialIds);

            if (!$clientComercialId || !in_array($clientComercialId, $allowedComercialIds, true)) {
                $this->json(['error' => 'Ese cliente no pertenece a tus comerciales asociados'], 403);
            }

            // Para usuarios comerciales el comercial de la linea se deduce del propio cliente.
            $data['id_comercial'] = $clientComercialId;
        }

        $data = $this->normalizeLineaUnits($data);
        $data['id_hoja_ruta'] = (int) $id;
        $lineaId = $this->model->addLinea((int) $id, $data);
        $this->json($this->model->getById((int) $id), 201);
    }

    /* PUT /api/hojas-ruta/{id}/lineas/{lineaId} */
    public function updateLinea($id, $lineaId)
    {
        $data = $this->getInput();
        $linea = $this->model->getLineaById((int) $lineaId);
        if (!$linea || (int) $linea['id_hoja_ruta'] !== (int) $id) {
            $this->json(['error' => 'Linea no encontrada'], 404);
        }

        if (Autenticacion::isComercial()) {
            $allowedIds = Autenticacion::comercialIds();
            if (!$this->matchesCommercialIds($linea, $allowedIds)) {
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
        $distCache = new DistanciasCache();
        $matrix = $distCache->buildMatrix($points);
        if (empty($matrix['durations'])) {
            return $this->json(['error' => 'No se pudo calcular la matriz de duraciones. OSRM puede estar caido.'], 503);
        }
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
        if (Autenticacion::isComercial()) {
            $this->json(['error' => 'Solo logistica/admin puede generar hojas'], 403);
            return;
        }

        $data = $this->getInput();
        $fecha = $data['fecha'] ?? date('Y-m-d');

        require_once __DIR__ . '/../models/Pedido.php';
        $orderModel = new Pedido();
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

        if (Autenticacion::isComercial()) {
            $allowedIds = Autenticacion::comercialIds();
            $comerciales = array_values(array_filter(
                $comerciales,
                fn ($comercial) => in_array((int) $comercial['id'], $allowedIds, true)
            ));
        }

        $this->json($comerciales);
    }

    /* ── Helpers privados ── */

    private function commercialIdsFromRow(array $row): array
    {
        $ids = [];
        foreach ([
            'id_comercial',
            'id_comercial_planta',
            'id_comercial_flor',
            'id_comercial_accesorio',
            'client_comercial_id',
            'client_comercial_planta_id',
            'client_comercial_flor_id',
            'client_comercial_accesorio_id',
        ] as $field) {
            if (!empty($row[$field])) {
                $ids[] = (int) $row[$field];
            }
        }

        return array_values(array_unique($ids));
    }

    private function matchesCommercialIds(array $row, array $allowedIds): bool
    {
        $allowedIds = array_values(array_filter(array_map('intval', $allowedIds)));
        if (empty($allowedIds)) {
            return false;
        }

        return (bool) array_intersect($this->commercialIdsFromRow($row), $allowedIds);
    }

    private function pickMatchingCommercialId(array $row, array $allowedIds): ?int
    {
        $allowedIds = array_values(array_filter(array_map('intval', $allowedIds)));
        if (empty($allowedIds)) {
            return null;
        }

        foreach ($this->commercialIdsFromRow($row) as $commercialId) {
            if (in_array($commercialId, $allowedIds, true)) {
                return $commercialId;
            }
        }

        return null;
    }

    private function getDelegationForHoja(array $hoja)
    {
        return $this->model->getDelegationForHoja((int) $hoja['id']);
    }

    private function filterHojaForComercial(array $hoja, array $allowedIds): array
    {
        $allowedIds = array_values(array_filter(array_map('intval', $allowedIds)));
        $hoja['lineas'] = array_values(array_filter(
            $hoja['lineas'] ?? [],
            fn ($linea) => $this->matchesCommercialIds($linea, $allowedIds)
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

    /** Delegados a OptimizadorRuta */
    private function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        return (new OptimizadorRuta())->haversine($lat1, $lng1, $lat2, $lng2);
    }

    private function twoOpt(array $route, ?array $delegation): array
    {
        return (new OptimizadorRuta())->twoOptHaversine($route, $delegation);
    }

    private function twoOptMatrix(array $route, array $durations, ?int $depotIdx): array
    {
        return (new OptimizadorRuta())->twoOptDurationMatrix($route, $durations, $depotIdx);
    }
}

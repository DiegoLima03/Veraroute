<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/HojaRuta.php';

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

        $hojas = $this->model->getByFecha($fecha, $rutaId);
        $rutasSinHoja = $this->model->getRutasSinHoja($fecha);

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
            $id = $this->model->create($data);
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
        $data['hoja_ruta_id'] = (int) $id;
        $lineaId = $this->model->addLinea((int) $id, $data);
        $this->json($this->model->getById((int) $id), 201);
    }

    /* PUT /api/hojas-ruta/{id}/lineas/{lineaId} */
    public function updateLinea($id, $lineaId)
    {
        $data = $this->getInput();
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

        $lineas = $hoja['lineas'];
        if (count($lineas) < 2) {
            // Con 0-1 paradas no hay nada que optimizar
            if (count($lineas) === 1) {
                $this->model->reorder((int) $id, [(int) $lineas[0]['id']]);
            }
            $this->json($this->model->getById((int) $id));
            return;
        }

        // Obtener delegacion del primer cliente o la por defecto
        $firstClient = $lineas[0];
        $delegation = $this->getDelegationForHoja($hoja);

        // Construir waypoints: delegacion + clientes
        $waypoints = [];
        if ($delegation) {
            $waypoints[] = ['lat' => (float) $delegation['x'], 'lng' => (float) $delegation['y']];
        }
        foreach ($lineas as $l) {
            if ($l['client_x'] && $l['client_y']) {
                $waypoints[] = [
                    'lat'      => (float) $l['client_x'],
                    'lng'      => (float) $l['client_y'],
                    'linea_id' => (int) $l['id'],
                ];
            }
        }

        // Nearest-neighbor desde la delegacion
        $clientWaypoints = array_filter($waypoints, fn($w) => isset($w['linea_id']));
        $clientWaypoints = array_values($clientWaypoints);

        $current = $delegation
            ? ['lat' => (float) $delegation['x'], 'lng' => (float) $delegation['y']]
            : ['lat' => (float) $clientWaypoints[0]['lat'], 'lng' => (float) $clientWaypoints[0]['lng']];

        $ordered = [];
        $remaining = $clientWaypoints;

        while (count($remaining) > 0) {
            $bestIdx = 0;
            $bestDist = PHP_FLOAT_MAX;
            foreach ($remaining as $i => $wp) {
                $d = $this->haversine($current['lat'], $current['lng'], $wp['lat'], $wp['lng']);
                if ($d < $bestDist) {
                    $bestDist = $d;
                    $bestIdx = $i;
                }
            }
            $ordered[] = $remaining[$bestIdx];
            $current = $remaining[$bestIdx];
            array_splice($remaining, $bestIdx, 1);
        }

        // 2-opt improvement
        $ordered = $this->twoOpt($ordered, $delegation);

        $lineaIds = array_map(fn($w) => $w['linea_id'], $ordered);
        $this->model->reorder((int) $id, $lineaIds);

        $this->json($this->model->getById((int) $id));
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
        $this->json($this->model->getComerciales());
    }

    /* ── Helpers privados ── */

    private function getDelegationForHoja(array $hoja)
    {
        return $this->model->getDelegationForHoja((int) $hoja['id']);
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
                for ($j = $i + 2; $j < $n; $j++) {
                    $d1 = $this->segDist($route, $i, $i + 1, $delegation)
                        + $this->segDist($route, $j, ($j + 1) % $n, $delegation);
                    $d2 = $this->segDist($route, $i, $j, $delegation)
                        + $this->segDist($route, $i + 1, ($j + 1) % $n, $delegation);

                    if ($d2 < $d1 - 0.001) {
                        $reversed = array_reverse(array_slice($route, $i + 1, $j - $i));
                        array_splice($route, $i + 1, $j - $i, $reversed);
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
}

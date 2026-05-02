<?php
/**
 * C1: Servicio unificado de optimizacion de rutas.
 * Consolida las 3 versiones de 2-opt y las utilidades de routing
 * que estaban dispersas en OptimizadorRutaController, HojaRutaController y CalculadorCosteRuta.
 */

require_once __DIR__ . '/../models/DistanciasCache.php';

class OptimizadorRuta
{
    private DistanciasCache $distanceCache;

    public function __construct(?DistanciasCache $distanceCache = null)
    {
        $this->distanceCache = $distanceCache ?? new DistanciasCache();
    }

    // ── 2-opt con matriz de distancias (km) ──────────────────
    // Versión original de OptimizadorRutaController: trabaja con índices offset +1 (depot = 0)
    public function twoOptDistanceMatrix(array $order, array $distMatrix): array
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

    // ── 2-opt con feasibility check (L2) ──────────────────────
    // Variante de twoOptDistanceMatrix que, antes de aceptar una inversión que
    // mejora km, simula el orden resultante via $isFeasible (callback) y descarta
    // el swap si rompe alguna ventana horaria. Garantiza que el 2-opt no deshace
    // el rescate del NN look-ahead L1.
    public function twoOptDistanceMatrixConstrained(array $order, array $distMatrix, callable $isFeasible): array
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
                        $candidate = $order;
                        $segment = array_slice($candidate, $i, $j - $i + 1);
                        array_splice($candidate, $i, $j - $i + 1, array_reverse($segment));
                        if ($isFeasible($candidate)) {
                            $order = $candidate;
                            $improved = true;
                        }
                    }
                }
            }
        }
        return $order;
    }

    // ── 2-opt con matriz de duraciones (OSRM) ───────────────
    // Versión original de HojaRutaController::twoOptMatrix
    public function twoOptDurationMatrix(array $route, array $durations, ?int $depotIdx): array
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

    // ── 2-opt con haversine (sin matriz precalculada) ────────
    // Versión original de HojaRutaController::twoOpt
    // $route = [['lat' => ..., 'lng' => ...], ...]
    // $depot = ['x' => lat, 'y' => lng] o null
    public function twoOptHaversine(array $route, ?array $depot): array
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
                    $d1 = $this->segDist($route, $i - 1, $i, $depot)
                        + $this->segDist($route, $j, $j + 1, $depot);
                    $d2 = $this->segDist($route, $i - 1, $j, $depot)
                        + $this->segDist($route, $i, $j + 1, $depot);

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

    // ── Utilidades de routing ─────────────────────────────────

    /** Distancia haversine entre dos puntos en km */
    public function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** Distancia de un segmento para 2-opt haversine (con depot como punto virtual) */
    private function segDist(array $route, int $a, int $b, ?array $depot): float
    {
        $n = count($route);
        if ($a < 0 || $a >= $n) {
            if ($depot) return $this->haversine($depot['x'], $depot['y'], $route[$b]['lat'], $route[$b]['lng']);
            return 0;
        }
        if ($b < 0 || $b >= $n) {
            if ($depot) return $this->haversine($route[$a]['lat'], $route[$a]['lng'], $depot['x'], $depot['y']);
            return 0;
        }
        return $this->haversine($route[$a]['lat'], $route[$a]['lng'], $route[$b]['lat'], $route[$b]['lng']);
    }

    /** Suma de km para una secuencia ordenada sobre una matriz de distancias */
    public function computeRouteKmFromMatrix(array $matrix, array $orderedIndices): float
    {
        if (empty($orderedIndices)) {
            return 0.0;
        }
        $km = 0.0;
        $prev = 0; // depot
        foreach ($orderedIndices as $idx) {
            $km += (float) ($matrix[$prev][$idx] ?? 0.0);
            $prev = $idx;
        }
        $km += (float) ($matrix[$prev][0] ?? 0.0);
        return $km;
    }

    /**
     * Construye secuencia de puntos [depot, clientes con coords, depot]
     * filtrando lineas sin coordenadas (salvo que tengan carga, en cuyo caso devuelve null).
     */
    public function buildRoutePointSequence(array $lineas, array $depot, bool $allowEmpty = false): ?array
    {
        $points = [[
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ]];

        foreach ($lineas as $linea) {
            if (empty($linea['client_x']) || empty($linea['client_y'])) {
                if ((float) ($linea['carros'] ?? 0) > 0 || (float) ($linea['cajas'] ?? 0) > 0) {
                    return null;
                }
                continue;
            }

            $points[] = [
                'lat' => (float) $linea['client_x'],
                'lng' => (float) $linea['client_y'],
            ];
        }

        if (!$allowEmpty && count($points) === 1) {
            return null;
        }

        $points[] = [
            'lat' => (float) $depot['x'],
            'lng' => (float) $depot['y'],
        ];

        return $points;
    }

    /** Distancia total de una secuencia de puntos via OSRM (cache) */
    public function calculateSequenceDistance(array $points): float
    {
        if (count($points) < 2) {
            return 0.0;
        }

        $distanceKm = 0.0;
        for ($i = 0, $max = count($points) - 1; $i < $max; $i++) {
            $a = $points[$i];
            $b = $points[$i + 1];

            if ($a['lat'] === $b['lat'] && $a['lng'] === $b['lng']) {
                continue;
            }

            $segment = $this->distanceCache->getOrFetch($a['lat'], $a['lng'], $b['lat'], $b['lng']);
            $distanceKm += (float) ($segment['distance_km'] ?? 0);
        }

        return round($distanceKm, 3);
    }
}

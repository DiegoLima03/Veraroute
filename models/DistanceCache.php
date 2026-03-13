<?php

require_once __DIR__ . '/../core/Model.php';

class DistanceCache extends Model
{
    private int $precision = 5; // decimales (~1 m)

    private function round(float $v): float
    {
        return round($v, $this->precision);
    }

    /** Busca en cache */
    public function get(float $lat1, float $lng1, float $lat2, float $lng2): ?array
    {
        $row = $this->query(
            'SELECT distance_km, duration_s FROM distance_cache
             WHERE origin_lat = ? AND origin_lng = ? AND dest_lat = ? AND dest_lng = ?',
            [$this->round($lat1), $this->round($lng1), $this->round($lat2), $this->round($lng2)]
        )->fetch();

        return $row ?: null;
    }

    /** Guarda en cache (INSERT IGNORE para evitar duplicados) */
    public function set(float $lat1, float $lng1, float $lat2, float $lng2, float $distKm, float $durationS): void
    {
        $this->query(
            'INSERT IGNORE INTO distance_cache (origin_lat, origin_lng, dest_lat, dest_lng, distance_km, duration_s)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$this->round($lat1), $this->round($lng1), $this->round($lat2), $this->round($lng2), $distKm, $durationS]
        );
    }

    /** Cache-through: devuelve cache o consulta OSRM y guarda */
    public function getOrFetch(float $lat1, float $lng1, float $lat2, float $lng2): array
    {
        $cached = $this->get($lat1, $lng1, $lat2, $lng2);
        if ($cached) return $cached;

        $result = $this->fetchOSRM($lat1, $lng1, $lat2, $lng2);
        $this->set($lat1, $lng1, $lat2, $lng2, $result['distance_km'], $result['duration_s']);
        return $result;
    }

    /** Llama a OSRM route para un par de puntos */
    private function fetchOSRM(float $lat1, float $lng1, float $lat2, float $lng2): array
    {
        $url = sprintf(
            'https://router.project-osrm.org/route/v1/driving/%s,%s;%s,%s?overview=false',
            $lng1, $lat1, $lng2, $lat2
        );

        $json = @file_get_contents($url);
        if ($json === false) {
            return $this->haversineFallback($lat1, $lng1, $lat2, $lng2);
        }

        $data = json_decode($json, true);
        if (($data['code'] ?? '') !== 'Ok' || empty($data['routes'])) {
            return $this->haversineFallback($lat1, $lng1, $lat2, $lng2);
        }

        $route = $data['routes'][0];
        return [
            'distance_km' => round($route['distance'] / 1000, 3),
            'duration_s'   => round($route['duration'], 1),
        ];
    }

    /** Fallback Haversine si OSRM no responde */
    private function haversineFallback(float $lat1, float $lng1, float $lat2, float $lng2): array
    {
        $km = $this->haversine($lat1, $lng1, $lat2, $lng2);
        return [
            'distance_km' => round($km, 3),
            'duration_s'   => round(($km / 50) * 3600, 1), // estimacion a 50 km/h
        ];
    }

    /**
     * Construye matriz NxN de distancias usando OSRM table API.
     * $points = [['lat' => ..., 'lng' => ...], ...]
     * Devuelve ['distances' => float[][], 'durations' => float[][]]
     */
    public function buildMatrix(array $points): array
    {
        $n = count($points);
        $distances = array_fill(0, $n, array_fill(0, $n, 0.0));
        $durations = array_fill(0, $n, array_fill(0, $n, 0.0));

        // Primero: intentar llenar desde cache
        $missing = [];
        for ($i = 0; $i < $n; $i++) {
            for ($j = 0; $j < $n; $j++) {
                if ($i === $j) continue;
                $cached = $this->get($points[$i]['lat'], $points[$i]['lng'], $points[$j]['lat'], $points[$j]['lng']);
                if ($cached) {
                    $distances[$i][$j] = $cached['distance_km'];
                    $durations[$i][$j] = $cached['duration_s'];
                } else {
                    $missing[] = [$i, $j];
                }
            }
        }

        if (empty($missing)) {
            return ['distances' => $distances, 'durations' => $durations];
        }

        // Intentar OSRM table API (max ~100 puntos)
        if ($n <= 100) {
            $coords = implode(';', array_map(
                fn($p) => $p['lng'] . ',' . $p['lat'],
                $points
            ));
            $url = "https://router.project-osrm.org/table/v1/driving/{$coords}?annotations=distance,duration";
            $json = @file_get_contents($url);
            $data = $json ? json_decode($json, true) : null;

            if ($data && ($data['code'] ?? '') === 'Ok') {
                for ($i = 0; $i < $n; $i++) {
                    for ($j = 0; $j < $n; $j++) {
                        if ($i === $j) continue;
                        $dKm = round($data['distances'][$i][$j] / 1000, 3);
                        $dSec = round($data['durations'][$i][$j], 1);
                        $distances[$i][$j] = $dKm;
                        $durations[$i][$j] = $dSec;
                        // Guardar en cache cada par
                        $this->set(
                            $points[$i]['lat'], $points[$i]['lng'],
                            $points[$j]['lat'], $points[$j]['lng'],
                            $dKm, $dSec
                        );
                    }
                }
                return ['distances' => $distances, 'durations' => $durations];
            }
        }

        // Fallback: consultar par a par los que faltan
        foreach ($missing as [$i, $j]) {
            $result = $this->getOrFetch(
                $points[$i]['lat'], $points[$i]['lng'],
                $points[$j]['lat'], $points[$j]['lng']
            );
            $distances[$i][$j] = $result['distance_km'];
            $durations[$i][$j] = $result['duration_s'];
        }

        return ['distances' => $distances, 'durations' => $durations];
    }

    private function haversine(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $R = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}

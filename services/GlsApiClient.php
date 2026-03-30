<?php

require_once __DIR__ . '/../models/GlsShippingConfig.php';
require_once __DIR__ . '/../config/database.php';

class GlsApiClient
{
    private GlsShippingConfig $configModel;
    private \PDO $db;

    public function __construct()
    {
        $this->configModel = new GlsShippingConfig();
        $this->db = Database::connect();
    }

    public function testConnection(): array
    {
        $startedAt = microtime(true);
        $result = $this->getShippingRate([
            'dest_postcode' => '28001',
            'dest_country' => 'ES',
            'weight_kg' => 1.0,
            'num_parcels' => 1,
            'service' => 'BusinessParcel',
            'shipping_date' => date('d-m-Y'),
        ]);
        $result['response_time_ms'] = (int) round((microtime(true) - $startedAt) * 1000);
        return $result;
    }

    public function getShippingRate(array $params): array
    {
        $config = $this->configModel->getConfig();
        $apiUser = trim((string) ($config['api_user'] ?? ''));
        $apiPassword = trim((string) ($config['api_password'] ?? ''));

        if ($apiUser === '' || $apiPassword === '') {
            return $this->errorResult('Configura usuario y contrasena GLS antes de cotizar.');
        }

        $destPostcode = trim((string) ($params['dest_postcode'] ?? ''));
        $destCountry = strtoupper(trim((string) ($params['dest_country'] ?? 'ES')));
        $weightKg = round(max(0.01, (float) ($params['weight_kg'] ?? 0)), 2);
        $numParcels = max(1, (int) ($params['num_parcels'] ?? 1));
        $service = trim((string) ($params['service'] ?? $config['default_service'] ?? 'BusinessParcel'));

        if ($destPostcode === '') {
            return $this->errorResult('Falta el codigo postal de destino.');
        }

        $cacheKey = hash('sha256', implode('|', [
            $destPostcode,
            $destCountry,
            number_format($weightKg, 2, '.', ''),
            $numParcels,
            $service,
        ]));

        $cached = $this->getCachedRate($cacheKey);
        if ($cached) {
            return [
                'success' => true,
                'price_raw' => (float) $cached['gls_price_raw'],
                'service' => (string) $cached['service_code'],
                'currency' => (string) $cached['currency'],
                'raw_response' => $cached['api_response_json'] ? json_decode($cached['api_response_json'], true) : null,
                'from_cache' => true,
            ];
        }

        if (!function_exists('curl_init')) {
            return $this->errorResult('La extension cURL no esta disponible en PHP.');
        }

        $payload = [
            'Username' => $apiUser,
            'Password' => $apiPassword,
            'ShippingDate' => $params['shipping_date'] ?? date('d-m-Y'),
            'ZipCode' => $destPostcode,
            'CountryCode' => $destCountry,
            'LangCode' => 'es',
            'ShipType' => 'P',
            'Service' => $service,
            'ServiceCode' => $service,
            'Weight' => $weightKg,
            'WeightKg' => $weightKg,
            'NumberOfParcels' => $numParcels,
            'ParcelCount' => $numParcels,
            'OriginZipCode' => trim((string) ($config['origin_postcode'] ?? '')),
            'OriginCountryCode' => strtoupper(trim((string) ($config['origin_country'] ?? 'ES'))),
        ];

        $attemptErrors = [];
        foreach ($this->candidateUrls($config, $this->deliveryOptionsPaths()) as $url) {
            $response = $this->postJson($url, $payload);

            if (!$response['success']) {
                $attemptErrors[] = $response['error'] . ' [' . $url . ']';
                if (($response['http_code'] ?? 0) === 404) {
                    continue;
                }
                if (($response['http_code'] ?? 0) >= 500) {
                    continue;
                }
                if (($response['http_code'] ?? 0) === 0) {
                    continue;
                }
                break;
            }

            $price = $this->extractPrice($response['data']);
            if ($price === null) {
                $attemptErrors[] = 'La respuesta GLS no incluye un precio interpretable [' . $url . ']';
                continue;
            }

            $serviceCode = $this->extractService($response['data'], $service);
            $currency = $this->extractCurrency($response['data']);
            $this->storeRateCache($cacheKey, $destPostcode, $destCountry, $weightKg, $numParcels, $serviceCode, $currency, $price, $response['data']);

            return [
                'success' => true,
                'price_raw' => $price,
                'service' => $serviceCode,
                'currency' => $currency,
                'raw_response' => $response['data'],
                'from_cache' => false,
            ];
        }

        $message = !empty($attemptErrors)
            ? implode(' | ', $attemptErrors)
            : 'No se pudo obtener tarifa GLS.';
        error_log('[GLS] ' . $message);
        return $this->errorResult($message);
    }

    private function getCachedRate(string $cacheKey): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM gls_rate_cache
             WHERE cache_key = ?
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1'
        );
        $stmt->execute([$cacheKey]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function storeRateCache(
        string $cacheKey,
        string $destPostcode,
        string $destCountry,
        float $weightKg,
        int $numParcels,
        string $serviceCode,
        string $currency,
        float $priceRaw,
        array $responseData
    ): void {
        $this->db->prepare(
            'INSERT INTO gls_rate_cache (
                cache_key, dest_postcode, dest_country, weight_kg, num_parcels,
                service_code, gls_price_raw, currency, api_response_json, expires_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
             ON DUPLICATE KEY UPDATE
                gls_price_raw = VALUES(gls_price_raw),
                currency = VALUES(currency),
                service_code = VALUES(service_code),
                api_response_json = VALUES(api_response_json),
                fetched_at = CURRENT_TIMESTAMP,
                expires_at = VALUES(expires_at)'
        )->execute([
            $cacheKey,
            $destPostcode,
            $destCountry,
            $weightKg,
            $numParcels,
            $serviceCode,
            $priceRaw,
            $currency,
            json_encode($responseData, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
        ]);
    }

    private function postJson(string $url, array $payload): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => true,
        ]);

        $raw = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $curlError) {
            return [
                'success' => false,
                'http_code' => $httpCode,
                'error' => $curlError ?: 'Error de transporte cURL.',
            ];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [
                'success' => false,
                'http_code' => $httpCode,
                'error' => 'La API GLS devolvio una respuesta no JSON.',
            ];
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            return [
                'success' => false,
                'http_code' => $httpCode,
                'error' => $decoded['Message'] ?? $decoded['message'] ?? ('HTTP ' . $httpCode),
            ];
        }

        return [
            'success' => true,
            'http_code' => $httpCode,
            'data' => $decoded,
        ];
    }

    private function candidateUrls(array $config, array $paths): array
    {
        $baseUrls = [];
        $override = trim((string) ($config['api_base_url'] ?? ''));
        if ($override !== '') {
            $baseUrls[] = rtrim($override, '/');
        }

        $env = strtolower((string) ($config['api_env'] ?? 'test'));
        $defaults = $env === 'production'
            ? ['https://api.mygls.es', 'https://api.gls.nl']
            : ['https://api-sandbox.mygls.es', 'https://api.mygls.es', 'https://api.gls.nl'];

        foreach ($defaults as $url) {
            $url = rtrim($url, '/');
            if (!in_array($url, $baseUrls, true)) {
                $baseUrls[] = $url;
            }
        }

        $urls = [];
        foreach ($baseUrls as $baseUrl) {
            foreach ($paths as $path) {
                $full = $baseUrl . '/' . ltrim($path, '/');
                if (!in_array($full, $urls, true)) {
                    $urls[] = $full;
                }
            }
        }

        return $urls;
    }

    private function deliveryOptionsPaths(): array
    {
        return [
            'GetDeliveryOptions',
            'api/GetDeliveryOptions',
            'rest/GetDeliveryOptions',
            'Shipping/GetDeliveryOptions',
        ];
    }

    private function extractPrice(array $data): ?float
    {
        $candidates = [];
        $keys = [
            'price',
            'price_raw',
            'totalprice',
            'shipmentprice',
            'shippingprice',
            'amount',
            'netamount',
            'grossamount',
            'tariff',
            'cost',
            'shippingcost',
        ];
        $this->collectNumericCandidates($data, '', $keys, $candidates);
        $candidates = array_values(array_filter($candidates, fn ($value) => $value > 0));
        if (empty($candidates)) {
            return null;
        }
        sort($candidates, SORT_NUMERIC);
        return round((float) $candidates[0], 4);
    }

    private function collectNumericCandidates($value, string $path, array $keys, array &$out): void
    {
        if (is_array($value)) {
            foreach ($value as $key => $child) {
                $nextPath = $path === '' ? strtolower((string) $key) : $path . '.' . strtolower((string) $key);
                $this->collectNumericCandidates($child, $nextPath, $keys, $out);
            }
            return;
        }

        if (!is_numeric($value)) {
            return;
        }

        foreach ($keys as $key) {
            if ($path === $key || str_ends_with($path, '.' . $key) || str_contains($path, '.' . $key . '.')) {
                $out[] = (float) $value;
                return;
            }
        }
    }

    private function extractCurrency(array $data): string
    {
        $currency = $this->findFirstStringByKeys($data, ['currency', 'currencycode', 'currency_code']);
        return $currency ? strtoupper($currency) : 'EUR';
    }

    private function extractService(array $data, string $fallback): string
    {
        return $this->findFirstStringByKeys($data, ['service', 'servicecode', 'service_code']) ?: $fallback;
    }

    private function findFirstStringByKeys($value, array $keys): ?string
    {
        if (!is_array($value)) {
            return null;
        }

        foreach ($value as $key => $child) {
            $normalizedKey = strtolower((string) $key);
            if (in_array($normalizedKey, $keys, true) && is_scalar($child) && trim((string) $child) !== '') {
                return trim((string) $child);
            }
            if (is_array($child)) {
                $found = $this->findFirstStringByKeys($child, $keys);
                if ($found !== null) {
                    return $found;
                }
            }
        }

        return null;
    }

    private function errorResult(string $message): array
    {
        return [
            'success' => false,
            'error' => $message,
            'price_raw' => 0,
            'service' => '',
            'currency' => 'EUR',
            'raw_response' => null,
            'from_cache' => false,
        ];
    }
}

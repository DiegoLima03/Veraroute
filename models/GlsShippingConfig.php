<?php

require_once __DIR__ . '/../core/Model.php';

class GlsShippingConfig extends Model
{
    private function ensureRow(): array
    {
        $row = $this->query('SELECT * FROM gls_shipping_config WHERE id = 1')->fetch();
        if ($row) {
            return $row;
        }

        $this->query('INSERT IGNORE INTO gls_shipping_config (id) VALUES (1)');
        return $this->query('SELECT * FROM gls_shipping_config WHERE id = 1')->fetch() ?: [
            'id' => 1,
            'api_user' => '',
            'api_password' => '',
            'api_env' => 'test',
            'api_base_url' => '',
            'origin_postcode' => '',
            'origin_country' => 'ES',
            'price_multiplier' => '1.0000',
            'default_weight_per_carro_kg' => '5.00',
            'default_weight_per_caja_kg' => '2.50',
            'default_service' => 'BusinessParcel',
        ];
    }

    public function getConfig(): array
    {
        return $this->normalizeTextRow($this->ensureRow());
    }

    public function updateConfig(array $data): bool
    {
        $this->ensureRow();

        $allowed = [
            'api_user',
            'api_password',
            'api_env',
            'api_base_url',
            'origin_postcode',
            'origin_country',
            'price_multiplier',
            'default_weight_per_carro_kg',
            'default_weight_per_caja_kg',
            'default_service',
        ];

        $fields = [];
        $params = [];

        foreach ($allowed as $key) {
            if (!array_key_exists($key, $data)) {
                continue;
            }
            $fields[] = "{$key} = ?";
            $params[] = $data[$key];
        }

        if (empty($fields)) {
            return true;
        }

        $params[] = 1;
        $this->query('UPDATE gls_shipping_config SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
        return true;
    }

    public function getMultiplier(): float
    {
        $config = $this->getConfig();
        return max(0.0, (float) ($config['price_multiplier'] ?? 1));
    }

    public function getWeightsPerUnit(): array
    {
        $config = $this->getConfig();
        return [
            'per_carro' => max(0.0, (float) ($config['default_weight_per_carro_kg'] ?? 5)),
            'per_caja' => max(0.0, (float) ($config['default_weight_per_caja_kg'] ?? 2.5)),
        ];
    }

    public function hasPassword(): bool
    {
        $config = $this->getConfig();
        return trim((string) ($config['api_password'] ?? '')) !== '';
    }
}

<?php

require_once __DIR__ . '/../core/Modelo.php';

class ConfigEnviosGls extends Modelo
{
    private function ensureRow(): array
    {
        $row = $this->query('SELECT * FROM config_envios_gls WHERE id = 1')->fetch();
        if ($row) {
            return $row;
        }

        $this->query('INSERT IGNORE INTO config_envios_gls (id) VALUES (1)');
        return $this->query('SELECT * FROM config_envios_gls WHERE id = 1')->fetch() ?: [
            'id' => 1,
            'cp_origen' => '',
            'pais_origen' => 'ES',
            'price_multiplier' => '1.0000',
            'gls_fuel_pct_current' => '0.00',
            'prefijos_cp_remotos' => '',
            'default_weight_per_carro_kg' => '5.00',
            'default_weight_per_caja_kg' => '2.50',
            'default_parcels_per_carro' => '1.00',
            'default_parcels_per_caja' => '1.00',
            'default_volume_per_carro_cm3' => '0.00',
            'default_volume_per_caja_cm3' => '0.00',
            'usar_peso_volumetrico' => '0',
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
            'cp_origen',
            'pais_origen',
            'price_multiplier',
            'gls_fuel_pct_current',
            'prefijos_cp_remotos',
            'default_weight_per_carro_kg',
            'default_weight_per_caja_kg',
            'default_parcels_per_carro',
            'default_parcels_per_caja',
            'default_volume_per_carro_cm3',
            'default_volume_per_caja_cm3',
            'usar_peso_volumetrico',
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
        $this->query('UPDATE config_envios_gls SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
        return true;
    }

    public function getWeightsPerUnit(): array
    {
        $config = $this->getCalculationVariables();
        return [
            'per_carro' => $config['per_carro'],
            'per_caja' => $config['per_caja'],
        ];
    }

    public function getCalculationVariables(): array
    {
        $config = $this->getConfig();
        return [
            'per_carro' => max(0.0, (float) ($config['default_weight_per_carro_kg'] ?? 5)),
            'per_caja' => max(0.0, (float) ($config['default_weight_per_caja_kg'] ?? 2.5)),
            'parcels_per_carro' => max(0.0, (float) ($config['default_parcels_per_carro'] ?? 1)),
            'parcels_per_caja' => max(0.0, (float) ($config['default_parcels_per_caja'] ?? 1)),
            'volume_per_carro_cm3' => max(0.0, (float) ($config['default_volume_per_carro_cm3'] ?? 0)),
            'volume_per_caja_cm3' => max(0.0, (float) ($config['default_volume_per_caja_cm3'] ?? 0)),
            'usar_peso_volumetrico' => !empty($config['usar_peso_volumetrico']),
        ];
    }

    public function getPriceMultiplier(): float
    {
        $config = $this->getConfig();
        return max(0.0, (float) ($config['price_multiplier'] ?? 1.0));
    }

    public function getCurrentFuelPct(): float
    {
        $config = $this->getConfig();
        return max(0.0, (float) ($config['gls_fuel_pct_current'] ?? 0.0));
    }

    public function getRemotePostcodePrefixes(): array
    {
        $config = $this->getConfig();
        $raw = (string) ($config['prefijos_cp_remotos'] ?? '');
        $parts = preg_split('/[\s,;]+/', strtoupper($raw)) ?: [];
        $parts = array_values(array_unique(array_filter(array_map(
            fn ($value) => preg_replace('/[^A-Z0-9\*\-]/', '', trim((string) $value)),
            $parts
        ))));
        return $parts;
    }
}

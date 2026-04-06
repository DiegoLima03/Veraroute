<?php

require_once __DIR__ . '/../core/Model.php';

class ShippingRateTable extends Model
{
    public function getCatalog(): array
    {
        return [
            'carriers' => $this->getCarriers(),
            'zones' => $this->getZones(),
            'rates' => $this->getRates(),
            'surcharges' => $this->getSurcharges(),
        ];
    }

    public function getCarriers(): array
    {
        return $this->normalizeTextRows(
            $this->query('SELECT * FROM carriers ORDER BY activo DESC, nombre ASC')->fetchAll()
        );
    }

    public function getCarrierById(int $id): ?array
    {
        $row = $this->query('SELECT * FROM carriers WHERE id = ?', [$id])->fetch();
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function createCarrier(array $data): int
    {
        $carrier = $this->normalizeCarrierData($data);
        $this->query(
            'INSERT INTO carriers (nombre, activo, divisor_vol, fuel_pct) VALUES (?, ?, ?, ?)',
            [$carrier['nombre'], $carrier['activo'], $carrier['divisor_vol'], $carrier['fuel_pct']]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function updateCarrier(int $id, array $data): bool
    {
        $carrier = $this->normalizeCarrierData($data);
        $this->query(
            'UPDATE carriers
             SET nombre = ?, activo = ?, divisor_vol = ?, fuel_pct = ?
             WHERE id = ?',
            [$carrier['nombre'], $carrier['activo'], $carrier['divisor_vol'], $carrier['fuel_pct'], $id]
        );
        return true;
    }

    public function deleteCarrier(int $id): bool
    {
        $this->query('DELETE FROM carriers WHERE id = ?', [$id]);
        return true;
    }

    public function validateCarrier(array $data): array
    {
        $errors = [];
        $nombre = trim((string) ($data['nombre'] ?? ''));
        $divisorVol = (int) ($data['divisor_vol'] ?? 0);
        $fuelPct = (float) ($data['fuel_pct'] ?? 0);

        if ($nombre === '') {
            $errors[] = 'El nombre del transportista es obligatorio.';
        }
        if ($divisorVol <= 0) {
            $errors[] = 'El divisor volumetrico debe ser mayor que 0.';
        }
        if ($fuelPct < 0) {
            $errors[] = 'El recargo de combustible no puede ser negativo.';
        }

        return $errors;
    }

    public function getZones(): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cz.*, c.nombre AS carrier_name
                 FROM carrier_zones cz
                 JOIN carriers c ON c.id = cz.carrier_id
                 ORDER BY c.nombre ASC, CHAR_LENGTH(cz.cp_prefix) DESC, cz.cp_prefix ASC'
            )->fetchAll()
        );
    }

    public function getZoneById(int $id): ?array
    {
        $row = $this->query(
            'SELECT cz.*, c.nombre AS carrier_name
             FROM carrier_zones cz
             JOIN carriers c ON c.id = cz.carrier_id
             WHERE cz.id = ?',
            [$id]
        )->fetch();
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function createZone(array $data): int
    {
        $zone = $this->normalizeZoneData($data);
        $this->query(
            'INSERT INTO carrier_zones (carrier_id, cp_prefix, zona, remoto) VALUES (?, ?, ?, ?)',
            [$zone['carrier_id'], $zone['cp_prefix'], $zone['zona'], $zone['remoto']]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function updateZone(int $id, array $data): bool
    {
        $zone = $this->normalizeZoneData($data);
        $this->query(
            'UPDATE carrier_zones
             SET carrier_id = ?, cp_prefix = ?, zona = ?, remoto = ?
             WHERE id = ?',
            [$zone['carrier_id'], $zone['cp_prefix'], $zone['zona'], $zone['remoto'], $id]
        );
        return true;
    }

    public function deleteZone(int $id): bool
    {
        $this->query('DELETE FROM carrier_zones WHERE id = ?', [$id]);
        return true;
    }

    public function validateZone(array $data): array
    {
        $errors = [];
        $carrierId = (int) ($data['carrier_id'] ?? 0);
        $prefix = $this->normalizePostcodePrefix((string) ($data['cp_prefix'] ?? ''));
        $zona = (int) ($data['zona'] ?? 0);

        if ($carrierId <= 0 || !$this->getCarrierById($carrierId)) {
            $errors[] = 'Selecciona un transportista valido.';
        }
        if ($prefix === '') {
            $errors[] = 'El prefijo postal es obligatorio.';
        }
        if ($zona <= 0) {
            $errors[] = 'La zona debe ser mayor que 0.';
        }

        return $errors;
    }

    public function getRates(): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cr.*, c.nombre AS carrier_name
                 FROM carrier_rates cr
                 JOIN carriers c ON c.id = cr.carrier_id
                 ORDER BY c.nombre ASC, cr.zona ASC, cr.peso_min ASC, cr.vigencia_desde DESC, cr.id ASC'
            )->fetchAll()
        );
    }

    public function getRateById(int $id): ?array
    {
        $row = $this->query(
            'SELECT cr.*, c.nombre AS carrier_name
             FROM carrier_rates cr
             JOIN carriers c ON c.id = cr.carrier_id
             WHERE cr.id = ?',
            [$id]
        )->fetch();
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function createRate(array $data): int
    {
        $rate = $this->normalizeRateData($data);
        $this->query(
            'INSERT INTO carrier_rates (carrier_id, zona, peso_min, peso_max, precio_base, vigencia_desde, vigencia_hasta)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $rate['carrier_id'],
                $rate['zona'],
                $rate['peso_min'],
                $rate['peso_max'],
                $rate['precio_base'],
                $rate['vigencia_desde'],
                $rate['vigencia_hasta'],
            ]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function updateRate(int $id, array $data): bool
    {
        $rate = $this->normalizeRateData($data);
        $this->query(
            'UPDATE carrier_rates
             SET carrier_id = ?, zona = ?, peso_min = ?, peso_max = ?, precio_base = ?, vigencia_desde = ?, vigencia_hasta = ?
             WHERE id = ?',
            [
                $rate['carrier_id'],
                $rate['zona'],
                $rate['peso_min'],
                $rate['peso_max'],
                $rate['precio_base'],
                $rate['vigencia_desde'],
                $rate['vigencia_hasta'],
                $id,
            ]
        );
        return true;
    }

    public function deleteRate(int $id): bool
    {
        $this->query('DELETE FROM carrier_rates WHERE id = ?', [$id]);
        return true;
    }

    public function validateRate(array $data): array
    {
        $errors = [];
        $carrierId = (int) ($data['carrier_id'] ?? 0);
        $zona = (int) ($data['zona'] ?? 0);
        $pesoMin = (float) ($data['peso_min'] ?? -1);
        $pesoMax = (float) ($data['peso_max'] ?? -1);
        $precio = (float) ($data['precio_base'] ?? -1);
        $desde = trim((string) ($data['vigencia_desde'] ?? ''));
        $hasta = trim((string) ($data['vigencia_hasta'] ?? ''));

        if ($carrierId <= 0 || !$this->getCarrierById($carrierId)) {
            $errors[] = 'Selecciona un transportista valido.';
        }
        if ($zona <= 0) {
            $errors[] = 'La zona debe ser mayor que 0.';
        }
        if ($pesoMin < 0) {
            $errors[] = 'El peso minimo no puede ser negativo.';
        }
        if ($pesoMax <= 0 || $pesoMax < $pesoMin) {
            $errors[] = 'El peso maximo debe ser mayor o igual que el minimo.';
        }
        if ($precio < 0) {
            $errors[] = 'El precio base no puede ser negativo.';
        }
        if (!$this->isValidDate($desde)) {
            $errors[] = 'La fecha de inicio no es valida.';
        }
        if ($hasta !== '' && (!$this->isValidDate($hasta) || $hasta < $desde)) {
            $errors[] = 'La fecha fin no es valida.';
        }

        return $errors;
    }

    public function getSurcharges(): array
    {
        return $this->normalizeTextRows(
            $this->query(
                'SELECT cs.*, c.nombre AS carrier_name
                 FROM carrier_surcharges cs
                 JOIN carriers c ON c.id = cs.carrier_id
                 ORDER BY c.nombre ASC, cs.tipo ASC, cs.id ASC'
            )->fetchAll()
        );
    }

    public function getSurchargeById(int $id): ?array
    {
        $row = $this->query(
            'SELECT cs.*, c.nombre AS carrier_name
             FROM carrier_surcharges cs
             JOIN carriers c ON c.id = cs.carrier_id
             WHERE cs.id = ?',
            [$id]
        )->fetch();
        return $row ? $this->normalizeTextRow($row) : null;
    }

    public function createSurcharge(array $data): int
    {
        $row = $this->normalizeSurchargeData($data);
        $this->query(
            'INSERT INTO carrier_surcharges (carrier_id, tipo, importe, porcentaje, activo) VALUES (?, ?, ?, ?, ?)',
            [$row['carrier_id'], $row['tipo'], $row['importe'], $row['porcentaje'], $row['activo']]
        );
        return (int) $this->db()->lastInsertId();
    }

    public function updateSurcharge(int $id, array $data): bool
    {
        $row = $this->normalizeSurchargeData($data);
        $this->query(
            'UPDATE carrier_surcharges
             SET carrier_id = ?, tipo = ?, importe = ?, porcentaje = ?, activo = ?
             WHERE id = ?',
            [$row['carrier_id'], $row['tipo'], $row['importe'], $row['porcentaje'], $row['activo'], $id]
        );
        return true;
    }

    public function deleteSurcharge(int $id): bool
    {
        $this->query('DELETE FROM carrier_surcharges WHERE id = ?', [$id]);
        return true;
    }

    public function validateSurcharge(array $data): array
    {
        $errors = [];
        $carrierId = (int) ($data['carrier_id'] ?? 0);
        $tipo = trim((string) ($data['tipo'] ?? ''));
        $importeSet = array_key_exists('importe', $data) && $data['importe'] !== '' && $data['importe'] !== null;
        $porcentajeSet = array_key_exists('porcentaje', $data) && $data['porcentaje'] !== '' && $data['porcentaje'] !== null;
        $importe = $importeSet ? (float) $data['importe'] : null;
        $porcentaje = $porcentajeSet ? (float) $data['porcentaje'] : null;

        if ($carrierId <= 0 || !$this->getCarrierById($carrierId)) {
            $errors[] = 'Selecciona un transportista valido.';
        }
        if ($tipo === '') {
            $errors[] = 'El tipo de recargo es obligatorio.';
        }
        if ($importe === null && $porcentaje === null) {
            $errors[] = 'Indica un importe fijo o un porcentaje.';
        }
        if ($importe !== null && $importe < 0) {
            $errors[] = 'El importe no puede ser negativo.';
        }
        if ($porcentaje !== null && $porcentaje < 0) {
            $errors[] = 'El porcentaje no puede ser negativo.';
        }

        return $errors;
    }

    public function findBestRate(string $postcode, string $countryCode, float $weightKg, int $numParcels, array $options = []): ?array
    {
        $quote = $this->quoteShipment($postcode, $weightKg, null, $options);
        if (!$quote) {
            return null;
        }

        return [
            'carrier_id' => $quote['carrier_id'],
            'carrier_code' => $quote['carrier_name'],
            'carrier_name' => $quote['carrier_name'],
            'service_name' => 'Zona ' . $quote['zone'],
            'price' => $quote['total_price'],
            'base_price' => $quote['base_price'],
            'fuel_pct' => $quote['fuel_pct'],
            'fuel_amount' => $quote['fuel_amount'],
            'surcharge_total' => $quote['surcharge_total'],
            'postcode_prefix' => $quote['cp_prefix'],
            'zone' => $quote['zone'],
            'remote' => $quote['remote'],
            'divisor_vol' => $quote['divisor_vol'],
            'real_weight_kg' => $quote['real_weight_kg'],
            'volumetric_weight_kg' => $quote['volumetric_weight_kg'],
            'billable_weight_kg' => $quote['billable_weight_kg'],
            'applied_surcharges' => $quote['applied_surcharges'],
        ];
    }

    public function quoteShipment(string $postcode, float $weightKg, ?string $date = null, array $options = []): ?array
    {
        $postcode = $this->normalizePostcodePrefix($postcode);
        if ($postcode === '') {
            return null;
        }

        $date = $date ?: date('Y-m-d');
        $volumeM3 = max(0.0, (float) ($options['volume_m3'] ?? $options['volume_cm3'] ?? 0));
        $useVolumetricWeight = !empty($options['use_volumetric_weight']);
        $carriers = $this->getCarriers();
        $bestQuote = null;

        foreach ($carriers as $carrier) {
            if (!(int) ($carrier['activo'] ?? 0)) {
                continue;
            }

            $zone = $this->findZoneForCarrier((int) $carrier['id'], $postcode);
            if (!$zone) {
                continue;
            }

            $divisorVol = max(1, (int) ($carrier['divisor_vol'] ?? 167));
            $volumetricWeightKg = 0.0;
            if ($useVolumetricWeight && $volumeM3 > 0) {
                $volumetricWeightKg = round($volumeM3 * $divisorVol, 2);
            }
            $billableWeightKg = round(max($weightKg, $volumetricWeightKg), 2);

            $rate = $this->findRateForCarrierZone((int) $carrier['id'], (int) $zone['zona'], $billableWeightKg, $date);
            if (!$rate) {
                continue;
            }

            $basePrice = round((float) $rate['precio_base'], 4);
            $fuelPct = round((float) ($carrier['fuel_pct'] ?? 0), 2);
            $fuelAmount = round($basePrice * ($fuelPct / 100), 4);
            $surchargeTotal = 0.0;
            $applied = [];

            if ((int) ($zone['remoto'] ?? 0)) {
                $remote = $this->findSurchargeForCarrier((int) $carrier['id'], 'remoto');
                if ($remote) {
                    $amount = $this->calculateSurchargeAmount($remote, $basePrice);
                    $surchargeTotal += $amount;
                    $applied[] = [
                        'tipo' => $remote['tipo'],
                        'importe' => $amount,
                    ];
                }
            }

            $total = round($basePrice + $fuelAmount + $surchargeTotal, 4);
            $quote = [
                'carrier_id' => (int) $carrier['id'],
                'carrier_name' => $carrier['nombre'],
                'zone' => (int) $zone['zona'],
                'cp_prefix' => $zone['cp_prefix'],
                'remote' => (int) ($zone['remoto'] ?? 0),
                'base_price' => $basePrice,
                'fuel_pct' => $fuelPct,
                'fuel_amount' => $fuelAmount,
                'surcharge_total' => round($surchargeTotal, 4),
                'total_price' => $total,
                'divisor_vol' => $divisorVol,
                'real_weight_kg' => round($weightKg, 2),
                'volumetric_weight_kg' => $volumetricWeightKg,
                'billable_weight_kg' => $billableWeightKg,
                'applied_surcharges' => $applied,
                'rate_id' => (int) $rate['id'],
                'zone_id' => (int) $zone['id'],
            ];

            if (
                $bestQuote === null
                || $quote['total_price'] < $bestQuote['total_price']
                || (
                    abs($quote['total_price'] - $bestQuote['total_price']) < 0.0001
                    && strcasecmp((string) $quote['carrier_name'], (string) $bestQuote['carrier_name']) < 0
                )
            ) {
                $bestQuote = $quote;
            }
        }

        return $bestQuote;
    }

    private function findZoneForCarrier(int $carrierId, string $postcode): ?array
    {
        $rows = $this->normalizeTextRows(
            $this->query(
                'SELECT * FROM carrier_zones
                 WHERE carrier_id = ?
                 ORDER BY CHAR_LENGTH(cp_prefix) DESC, cp_prefix ASC',
                [$carrierId]
            )->fetchAll()
        );

        foreach ($rows as $row) {
            $prefix = $this->normalizePostcodePrefix((string) ($row['cp_prefix'] ?? ''));
            if ($prefix !== '' && str_starts_with($postcode, $prefix)) {
                return $row;
            }
        }

        return null;
    }

    private function findRateForCarrierZone(int $carrierId, int $zone, float $weightKg, string $date): ?array
    {
        $row = $this->query(
            'SELECT *
             FROM carrier_rates
             WHERE carrier_id = ?
               AND zona = ?
               AND ? BETWEEN peso_min AND peso_max
               AND vigencia_desde <= ?
               AND (vigencia_hasta IS NULL OR vigencia_hasta >= ?)
             ORDER BY vigencia_desde DESC, id DESC
             LIMIT 1',
            [$carrierId, $zone, $weightKg, $date, $date]
        )->fetch();

        return $row ? $this->normalizeTextRow($row) : null;
    }

    private function findSurchargeForCarrier(int $carrierId, string $type): ?array
    {
        $row = $this->query(
            'SELECT *
             FROM carrier_surcharges
             WHERE carrier_id = ?
               AND tipo = ?
               AND activo = 1
             ORDER BY id ASC
             LIMIT 1',
            [$carrierId, $type]
        )->fetch();

        return $row ? $this->normalizeTextRow($row) : null;
    }

    private function calculateSurchargeAmount(array $row, float $basePrice): float
    {
        $fixed = $row['importe'] !== null ? (float) $row['importe'] : 0.0;
        $percent = $row['porcentaje'] !== null ? (float) $row['porcentaje'] : 0.0;
        return round($fixed + ($percent > 0 ? $basePrice * ($percent / 100) : 0.0), 4);
    }

    private function normalizeCarrierData(array $data): array
    {
        return [
            'nombre' => trim((string) ($data['nombre'] ?? '')),
            'activo' => !empty($data['activo']) ? 1 : 0,
            'divisor_vol' => max(1, (int) ($data['divisor_vol'] ?? 167)),
            'fuel_pct' => round(max(0, (float) ($data['fuel_pct'] ?? 0)), 2),
        ];
    }

    private function normalizeZoneData(array $data): array
    {
        return [
            'carrier_id' => (int) ($data['carrier_id'] ?? 0),
            'cp_prefix' => $this->normalizePostcodePrefix((string) ($data['cp_prefix'] ?? '')),
            'zona' => max(1, (int) ($data['zona'] ?? 1)),
            'remoto' => !empty($data['remoto']) ? 1 : 0,
        ];
    }

    private function normalizeRateData(array $data): array
    {
        return [
            'carrier_id' => (int) ($data['carrier_id'] ?? 0),
            'zona' => max(1, (int) ($data['zona'] ?? 1)),
            'peso_min' => round(max(0, (float) ($data['peso_min'] ?? 0)), 2),
            'peso_max' => round(max(0, (float) ($data['peso_max'] ?? 0)), 2),
            'precio_base' => round(max(0, (float) ($data['precio_base'] ?? 0)), 2),
            'vigencia_desde' => trim((string) ($data['vigencia_desde'] ?? date('Y-m-d'))),
            'vigencia_hasta' => ($data['vigencia_hasta'] ?? '') !== '' ? trim((string) $data['vigencia_hasta']) : null,
        ];
    }

    private function normalizeSurchargeData(array $data): array
    {
        return [
            'carrier_id' => (int) ($data['carrier_id'] ?? 0),
            'tipo' => trim((string) ($data['tipo'] ?? '')),
            'importe' => ($data['importe'] ?? '') !== '' ? round(max(0, (float) $data['importe']), 2) : null,
            'porcentaje' => ($data['porcentaje'] ?? '') !== '' ? round(max(0, (float) $data['porcentaje']), 2) : null,
            'activo' => !empty($data['activo']) ? 1 : 0,
        ];
    }

    private function normalizePostcodePrefix(string $value): string
    {
        return strtoupper(preg_replace('/\s+/', '', trim($value)));
    }

    private function isValidDate(string $date): bool
    {
        if ($date === '') {
            return false;
        }
        $dt = DateTime::createFromFormat('Y-m-d', $date);
        return $dt && $dt->format('Y-m-d') === $date;
    }
}

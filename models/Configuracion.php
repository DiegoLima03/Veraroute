<?php

require_once __DIR__ . '/../core/Modelo.php';

class Configuracion extends Modelo
{
    public function getAll(): array
    {
        $rows = $this->query('SELECT clave, valor FROM configuracion')->fetchAll();
        $result = [];
        foreach ($rows as $r) {
            $result[$r['clave']] = $r['valor'];
        }
        return $result;
    }

    public function get(string $key, string $default = ''): string
    {
        $row = $this->query('SELECT valor FROM configuracion WHERE clave = ?', [$key])->fetch();
        return $row ? $row['valor'] : $default;
    }

    public function set(string $key, string $value): void
    {
        $this->query(
            'INSERT INTO configuracion (clave, valor) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
            [$key, $value]
        );
    }

    public function setMany(array $settings): void
    {
        foreach ($settings as $key => $value) {
            $this->set($key, $value);
        }
    }
}

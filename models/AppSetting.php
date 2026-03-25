<?php

require_once __DIR__ . '/../core/Model.php';

class AppSetting extends Model
{
    public function getAll(): array
    {
        $rows = $this->query('SELECT setting_key, setting_value FROM app_settings')->fetchAll();
        $result = [];
        foreach ($rows as $r) {
            $result[$r['setting_key']] = $r['setting_value'];
        }
        return $result;
    }

    public function get(string $key, string $default = ''): string
    {
        $row = $this->query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [$key])->fetch();
        return $row ? $row['setting_value'] : $default;
    }

    public function set(string $key, string $value): void
    {
        $this->query(
            'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
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

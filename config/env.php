<?php
/**
 * Cargador minimalista de variables de entorno desde config/.env
 *
 * - Sin dependencias externas (sin Composer/Dotenv).
 * - Las variables quedan disponibles via getenv() y $_ENV.
 * - Si config/.env no existe, hace fallback a config/.env.example
 *   (útil en arranque inicial o entornos limpios).
 * - Las variables ya definidas en el entorno del sistema NO se sobrescriben.
 */

class Env
{
    private static bool $loaded = false;

    public static function load(): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        $envFile = __DIR__ . '/.env';
        if (!file_exists($envFile)) {
            $envFile = __DIR__ . '/.env.example';
            if (!file_exists($envFile)) {
                return;
            }
        }

        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $eq = strpos($line, '=');
            if ($eq === false) {
                continue;
            }
            $key = trim(substr($line, 0, $eq));
            $val = trim(substr($line, $eq + 1));

            // Quitar comillas envolventes si las hay
            if (strlen($val) >= 2) {
                $first = $val[0];
                $last  = $val[strlen($val) - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $val = substr($val, 1, -1);
                }
            }

            // No pisar variables ya definidas en el entorno del sistema
            if (getenv($key) === false) {
                putenv("$key=$val");
                $_ENV[$key] = $val;
            }
        }
    }

    /**
     * Helper de lectura con valor por defecto.
     */
    public static function get(string $key, ?string $default = null): ?string
    {
        $v = getenv($key);
        if ($v === false || $v === '') {
            return $default;
        }
        return $v;
    }

    /**
     * Lectura como booleano (1/true/yes/on -> true).
     */
    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::get($key);
        if ($v === null) {
            return $default;
        }
        $v = strtolower($v);
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }
}

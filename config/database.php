<?php

require_once __DIR__ . '/env.php';

class Database
{
    private static $pdo = null;

    public static function connect()
    {
        if (self::$pdo === null) {
            Env::load();

            $host = Env::get('DB_HOST', '127.0.0.1');
            $port = Env::get('DB_PORT', '3308');
            $name = Env::get('DB_NAME', 'gestorrutas');
            $user = Env::get('DB_USER', 'root');
            $pass = Env::get('DB_PASS', '') ?? '';

            $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";

            self::$pdo = new PDO(
                $dsn,
                $user,
                $pass,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        }
        return self::$pdo;
    }
}

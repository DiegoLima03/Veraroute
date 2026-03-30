<?php

require_once __DIR__ . '/../config/database.php';

class Auth
{
    public static function init()
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    public static function isLoggedIn(): bool
    {
        self::init();
        return !empty($_SESSION['user']['id']);
    }

    public static function currentUser(): ?array
    {
        self::init();
        return $_SESSION['user'] ?? null;
    }

    /** Rol del usuario actual: 'comercial', 'logistica' o 'admin' */
    public static function role(): string
    {
        return self::currentUser()['role'] ?? '';
    }

    public static function isAdmin(): bool
    {
        return self::role() === 'admin';
    }

    public static function isLogistica(): bool
    {
        return self::role() === 'logistica';
    }

    public static function isComercial(): bool
    {
        return self::role() === 'comercial';
    }

    /** ID del comercial vinculado (solo para rol comercial) */
    public static function comercialId(): ?int
    {
        $u = self::currentUser();
        return $u && $u['role'] === 'comercial' ? ($u['comercial_id'] ?? null) : null;
    }

    /** IDs de comerciales asociados al usuario actual. */
    public static function comercialIds(): array
    {
        self::init();
        $u = self::currentUser();
        if (!$u || empty($u['id'])) {
            return [];
        }

        static $cache = [];
        $userId = (int) $u['id'];
        if (isset($cache[$userId])) {
            return $cache[$userId];
        }

        $ids = [];
        if (!empty($u['comercial_id'])) {
            $ids[] = (int) $u['comercial_id'];
        }

        try {
            $db = Database::connect();
            $stmt = $db->prepare('SELECT comercial_id FROM user_comerciales WHERE user_id = ?');
            $stmt->execute([$userId]);

            foreach ($stmt->fetchAll() as $row) {
                if (!empty($row['comercial_id'])) {
                    $ids[] = (int) $row['comercial_id'];
                }
            }
        } catch (\Throwable $e) {
            // Si la tabla intermedia aun no existe, mantenemos la compatibilidad con comercial_id.
        }

        $ids = array_values(array_unique(array_filter($ids, fn ($id) => $id > 0)));
        $cache[$userId] = $ids;
        return $ids;
    }

    /** Comprueba si el usuario puede acceder. Redirige o devuelve 401 si no. */
    public static function requireLogin()
    {
        if (!self::isLoggedIn()) {
            if (self::isApiRequest()) {
                http_response_code(401);
                header('Content-Type: application/json');
                echo json_encode(['error' => 'No autenticado']);
                exit;
            }
            header('Location: /Gestor de Rutas/login.php');
            exit;
        }
    }

    /** Exige uno o más roles. Devuelve 403 si el rol actual no está en la lista. */
    public static function requireRole(string ...$roles)
    {
        self::requireLogin();
        if (!in_array(self::role(), $roles, true)) {
            if (self::isApiRequest()) {
                http_response_code(403);
                header('Content-Type: application/json');
                echo json_encode(['error' => 'Sin permisos']);
                exit;
            }
            http_response_code(403);
            echo 'Acceso denegado';
            exit;
        }
    }

    public static function login(array $userData)
    {
        self::init();
        session_regenerate_id(true);
        $_SESSION['user'] = [
            'id'           => (int) $userData['id'],
            'username'     => $userData['username'],
            'full_name'    => $userData['full_name'],
            'role'         => $userData['role'],
            'comercial_id' => $userData['comercial_id'] ? (int) $userData['comercial_id'] : null,
        ];
    }

    public static function logout()
    {
        self::init();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    private static function isApiRequest(): bool
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        return strpos($uri, '/api/') !== false;
    }
}

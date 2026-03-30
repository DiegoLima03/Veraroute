<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../config/database.php';

class UserController extends Controller
{
    private function db()
    {
        return Database::connect();
    }

    /* GET /api/users */
    public function index()
    {
        Auth::requireRole('admin');
        $rows = $this->db()->query(
            "SELECT u.id, u.username, u.full_name, u.role, u.active, u.locked,
                    u.last_login_at, u.comercial_id,
                    GROUP_CONCAT(uc.comercial_id) as comercial_ids
             FROM app_users u
             LEFT JOIN user_comerciales uc ON uc.user_id = u.id
             GROUP BY u.id
             ORDER BY u.role, u.full_name"
        )->fetchAll();

        foreach ($rows as &$r) {
            $r['comercial_ids'] = $r['comercial_ids']
                ? array_map('intval', explode(',', $r['comercial_ids']))
                : [];
        }

        $this->json($rows);
    }

    /* POST /api/users */
    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();

        if (empty($data['username']) || empty($data['password']) || empty($data['role'])) {
            $this->json(['error' => 'username, password y role son obligatorios'], 400);
        }

        $db = $this->db();

        // Comprobar duplicado
        $exists = $db->prepare("SELECT id FROM app_users WHERE username = ?");
        $exists->execute([$data['username']]);
        if ($exists->fetch()) {
            $this->json(['error' => 'El usuario ya existe'], 409);
        }

        $db->prepare(
            "INSERT INTO app_users (username, pass_hash, full_name, role) VALUES (?, ?, ?, ?)"
        )->execute([
            $data['username'],
            password_hash($data['password'], PASSWORD_DEFAULT),
            $data['full_name'] ?? '',
            $data['role'],
        ]);

        $userId = (int) $db->lastInsertId();

        // Guardar comerciales asociados
        $this->syncComerciales($userId, $data['comercial_ids'] ?? []);

        $this->json(['id' => $userId], 201);
    }

    /* PUT /api/users/{id} */
    public function update($id)
    {
        Auth::requireRole('admin');
        $id = (int) $id;
        $data = $this->getInput();
        $db = $this->db();

        $sets = ['full_name = ?', 'role = ?', 'active = ?', 'locked = ?'];
        $params = [
            $data['full_name'] ?? '',
            $data['role'] ?? 'comercial',
            isset($data['active']) ? (int) $data['active'] : 1,
            isset($data['locked']) ? (int) $data['locked'] : 0,
        ];

        // Actualizar username si cambió
        if (!empty($data['username'])) {
            $dup = $db->prepare("SELECT id FROM app_users WHERE username = ? AND id != ?");
            $dup->execute([$data['username'], $id]);
            if ($dup->fetch()) {
                $this->json(['error' => 'Ese nombre de usuario ya existe'], 409);
            }
            $sets[] = 'username = ?';
            $params[] = $data['username'];
        }

        // Actualizar contraseña solo si se envía
        if (!empty($data['password'])) {
            $sets[] = 'pass_hash = ?';
            $params[] = password_hash($data['password'], PASSWORD_DEFAULT);
        }

        // Reset failed_logins si se desbloquea
        if (isset($data['locked']) && !(int) $data['locked']) {
            $sets[] = 'failed_logins = 0';
        }

        $params[] = $id;
        $db->prepare("UPDATE app_users SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);

        // Guardar comerciales asociados
        $this->syncComerciales($id, $data['comercial_ids'] ?? []);

        $this->json(['ok' => true]);
    }

    /* DELETE /api/users/{id} */
    public function destroy($id)
    {
        Auth::requireRole('admin');
        $id = (int) $id;

        // No permitir borrar el propio usuario
        if ($id === Auth::currentUser()['id']) {
            $this->json(['error' => 'No puedes eliminar tu propio usuario'], 400);
        }

        $db = $this->db();
        $db->prepare("DELETE FROM user_comerciales WHERE user_id = ?")->execute([$id]);
        $db->prepare("DELETE FROM app_users WHERE id = ?")->execute([$id]);
        $this->json(['ok' => true]);
    }

    private function syncComerciales(int $userId, array $comercialIds)
    {
        $db = $this->db();
        $db->prepare("DELETE FROM user_comerciales WHERE user_id = ?")->execute([$userId]);

        if (!empty($comercialIds)) {
            $stmt = $db->prepare("INSERT INTO user_comerciales (user_id, comercial_id) VALUES (?, ?)");
            foreach ($comercialIds as $cid) {
                $stmt->execute([$userId, (int) $cid]);
            }
        }
    }
}

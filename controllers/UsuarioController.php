<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../config/database.php';

class UsuarioController extends Controlador
{
    private function db()
    {
        return Database::connect();
    }

    /* GET /api/users */
    public function index()
    {
        Autenticacion::requireRole('admin');
        $rows = $this->db()->query(
            "SELECT u.id, u.username, u.nombre_completo AS full_name, u.rol AS role,
                    u.activo AS active, u.bloqueado AS locked,
                    u.ultimo_login_en AS last_login_at, u.id_comercial,
                    GROUP_CONCAT(uc.id_comercial) as comercial_ids
             FROM usuarios u
             LEFT JOIN usuario_comerciales uc ON uc.id_usuario = u.id
             GROUP BY u.id
             ORDER BY u.rol, u.nombre_completo"
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
        Autenticacion::requireRole('admin');
        $data = $this->getInput();

        if (empty($data['username']) || empty($data['password']) || empty($data['role'])) {
            $this->json(['error' => 'username, password y role son obligatorios'], 400);
        }

        $db = $this->db();

        // Comprobar duplicado
        $exists = $db->prepare("SELECT id FROM usuarios WHERE username = ?");
        $exists->execute([$data['username']]);
        if ($exists->fetch()) {
            $this->json(['error' => 'El usuario ya existe'], 409);
        }

        $db->prepare(
            "INSERT INTO usuarios (username, hash_password, nombre_completo, rol) VALUES (?, ?, ?, ?)"
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
        Autenticacion::requireRole('admin');
        $id = (int) $id;
        $data = $this->getInput();
        $db = $this->db();

        $sets = ['nombre_completo = ?', 'rol = ?', 'activo = ?', 'bloqueado = ?'];
        $params = [
            $data['full_name'] ?? '',
            $data['role'] ?? 'comercial',
            isset($data['active']) ? (int) $data['active'] : 1,
            isset($data['locked']) ? (int) $data['locked'] : 0,
        ];

        // Actualizar username si cambió
        if (!empty($data['username'])) {
            $dup = $db->prepare("SELECT id FROM usuarios WHERE username = ? AND id != ?");
            $dup->execute([$data['username'], $id]);
            if ($dup->fetch()) {
                $this->json(['error' => 'Ese nombre de usuario ya existe'], 409);
            }
            $sets[] = 'username = ?';
            $params[] = $data['username'];
        }

        // Actualizar contraseña solo si se envía
        if (!empty($data['password'])) {
            $sets[] = 'hash_password = ?';
            $params[] = password_hash($data['password'], PASSWORD_DEFAULT);
        }

        // Reset failed_logins si se desbloquea
        if (isset($data['locked']) && !(int) $data['locked']) {
            $sets[] = 'intentos_fallidos = 0';
        }

        $params[] = $id;
        $db->prepare("UPDATE usuarios SET " . implode(', ', $sets) . " WHERE id = ?")->execute($params);

        // Guardar comerciales asociados
        $this->syncComerciales($id, $data['comercial_ids'] ?? []);

        $this->json(['ok' => true]);
    }

    /* DELETE /api/users/{id} */
    public function destroy($id)
    {
        Autenticacion::requireRole('admin');
        $id = (int) $id;

        // No permitir borrar el propio usuario
        if ($id === Autenticacion::currentUser()['id']) {
            $this->json(['error' => 'No puedes eliminar tu propio usuario'], 400);
        }

        $db = $this->db();
        $db->prepare("DELETE FROM usuario_comerciales WHERE id_usuario = ?")->execute([$id]);
        $db->prepare("DELETE FROM usuarios WHERE id = ?")->execute([$id]);
        $this->json(['ok' => true]);
    }

    private function syncComerciales(int $userId, array $comercialIds)
    {
        $db = $this->db();
        $db->prepare("DELETE FROM usuario_comerciales WHERE id_usuario = ?")->execute([$userId]);

        if (!empty($comercialIds)) {
            $stmt = $db->prepare("INSERT INTO usuario_comerciales (id_usuario, id_comercial) VALUES (?, ?)");
            foreach ($comercialIds as $cid) {
                $stmt->execute([$userId, (int) $cid]);
            }
        }
    }
}

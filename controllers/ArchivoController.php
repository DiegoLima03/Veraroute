<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';

class ArchivoController extends Controlador
{
    private $uploadDir;
    private const ALLOWED_EXTENSIONS = ['pdf', 'xlsx', 'xls'];
    private const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

    public function __construct()
    {
        $this->uploadDir = __DIR__ . '/../uploads';
        if (!is_dir($this->uploadDir)) {
            mkdir($this->uploadDir, 0775, true);
        }
    }

    /* GET /api/files */
    public function index()
    {
        Autenticacion::requireRole('admin');
        $files = [];
        foreach (glob($this->uploadDir . '/*') as $path) {
            if (is_file($path)) {
                $files[] = [
                    'name'     => basename($path),
                    'size'     => filesize($path),
                    'modified' => date('Y-m-d H:i:s', filemtime($path)),
                ];
            }
        }
        usort($files, fn($a, $b) => strcmp($b['modified'], $a['modified']));
        $this->json($files);
    }

    /* POST /api/files */
    public function upload()
    {
        Autenticacion::requireRole('admin');

        if (empty($_FILES['file'])) {
            $this->json(['error' => 'No se ha enviado ningun archivo'], 400);
        }

        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'Error en la subida: codigo ' . $file['error']], 400);
        }

        if ($file['size'] > self::MAX_SIZE) {
            $this->json(['error' => 'El archivo excede el limite de 20 MB'], 400);
        }

        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, self::ALLOWED_EXTENSIONS, true)) {
            $this->json(['error' => 'Extension no permitida: .' . $ext], 400);
        }

        // Nombre seguro: quitar caracteres peligrosos
        $safeName = preg_replace('/[^a-zA-Z0-9._\-() ]/', '_', $file['name']);
        $dest = $this->uploadDir . '/' . $safeName;

        // Si ya existe, añadir sufijo
        if (file_exists($dest)) {
            $base = pathinfo($safeName, PATHINFO_FILENAME);
            $i = 1;
            while (file_exists($this->uploadDir . '/' . $base . '_' . $i . '.' . $ext)) {
                $i++;
            }
            $safeName = $base . '_' . $i . '.' . $ext;
            $dest = $this->uploadDir . '/' . $safeName;
        }

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            $this->json(['error' => 'No se pudo guardar el archivo'], 500);
        }

        $this->json([
            'name'     => $safeName,
            'size'     => filesize($dest),
            'modified' => date('Y-m-d H:i:s'),
        ], 201);
    }

    /* DELETE /api/files/{name} */
    public function destroy($name)
    {
        Autenticacion::requireRole('admin');
        $name = urldecode($name);
        $path = $this->uploadDir . '/' . basename($name);

        if (!file_exists($path)) {
            $this->json(['error' => 'Archivo no encontrado'], 404);
        }

        unlink($path);
        $this->json(['ok' => true]);
    }

    /* GET /api/files/{name}/download */
    public function download($name)
    {
        Autenticacion::requireRole('admin');
        $name = urldecode($name);
        $path = $this->uploadDir . '/' . basename($name);

        if (!file_exists($path)) {
            $this->json(['error' => 'Archivo no encontrado'], 404);
        }

        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . basename($path) . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);
        exit;
    }

    /* POST /api/files/{name}/parse-pedidos */
    public function parsePedidos($name)
    {
        Autenticacion::requireRole('admin');
        require_once __DIR__ . '/../services/LectorExcel.php';
        require_once __DIR__ . '/../config/database.php';

        $name = urldecode($name);
        $path = $this->uploadDir . '/' . basename($name);

        if (!file_exists($path)) {
            $this->json(['error' => 'Archivo no encontrado'], 404);
        }

        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (!in_array($ext, ['xlsx', 'xls'], true)) {
            $this->json(['error' => 'Solo se pueden procesar archivos Excel'], 400);
        }

        try {
            $data = LectorExcel::leerFilas($path);
        } catch (\Exception $e) {
            $this->json(['error' => 'Error leyendo Excel: ' . $e->getMessage()], 400);
        }

        $header = $data['header'];
        $rows = $data['rows'];

        // Buscar dinamicamente la columna "Cliente" en la cabecera
        $clientCol = null;
        foreach ($header as $idx => $val) {
            if (mb_stripos(trim($val), 'cliente') !== false) {
                $clientCol = $idx;
                break;
            }
        }
        if ($clientCol === null) {
            $this->json(['error' => 'No se encontro la columna "Cliente" en la cabecera del Excel'], 400);
        }

        $pdo = Database::connect();
        $clientNames = [];
        foreach ($rows as $row) {
            $fiscalName = trim($row[$clientCol] ?? '');
            if ($fiscalName === '') continue;
            if (!isset($clientNames[$fiscalName])) {
                $clientNames[$fiscalName] = [
                    'fiscal_name' => $fiscalName,
                    'count'       => 0,
                ];
            }
            $clientNames[$fiscalName]['count']++;
        }

        // Buscar cada nombre fiscal en la BD
        $found = [];
        $notFound = [];

        foreach ($clientNames as $fiscal => $info) {
            // Busqueda exacta por nombre_fiscal
            $stmt = $pdo->prepare(
                "SELECT c.id, c.nombre AS name, c.nombre_fiscal AS fiscal_name, c.activo AS active,
                        c.id_ruta, r.nombre AS ruta_name
                 FROM clientes c
                 LEFT JOIN rutas r ON r.id = c.id_ruta
                 WHERE c.nombre_fiscal = ?
                 LIMIT 1"
            );
            $stmt->execute([$fiscal]);
            $client = $stmt->fetch(\PDO::FETCH_ASSOC);

            if (!$client) {
                // Busqueda parcial (LIKE)
                $stmt = $pdo->prepare(
                    "SELECT c.id, c.nombre AS name, c.nombre_fiscal AS fiscal_name, c.activo AS active,
                            c.id_ruta, r.nombre AS ruta_name
                     FROM clientes c
                     LEFT JOIN rutas r ON r.id = c.id_ruta
                     WHERE c.nombre_fiscal LIKE ?
                     LIMIT 1"
                );
                $stmt->execute(['%' . $fiscal . '%']);
                $client = $stmt->fetch(\PDO::FETCH_ASSOC);
            }

            if (!$client) {
                // Buscar por nombre comercial
                $stmt = $pdo->prepare(
                    "SELECT c.id, c.nombre AS name, c.nombre_fiscal AS fiscal_name, c.activo AS active,
                            c.id_ruta, r.nombre AS ruta_name
                     FROM clientes c
                     LEFT JOIN rutas r ON r.id = c.id_ruta
                     WHERE c.nombre LIKE ?
                     LIMIT 1"
                );
                $stmt->execute(['%' . $fiscal . '%']);
                $client = $stmt->fetch(\PDO::FETCH_ASSOC);
            }

            if ($client) {
                $found[] = [
                    'excel_name'  => $fiscal,
                    'id'          => (int) $client['id'],
                    'name'        => $client['name'],
                    'fiscal_name' => $client['fiscal_name'],
                    'active'      => (bool) $client['active'],
                    'id_ruta'     => $client['id_ruta'] ? (int) $client['id_ruta'] : null,
                    'ruta_name'   => $client['ruta_name'],
                    'lineas'      => $info['count'],
                ];
            } else {
                $notFound[] = [
                    'excel_name' => $fiscal,
                    'lineas'     => $info['count'],
                ];
            }
        }

        $this->json([
            'file'       => $name,
            'total_rows' => count($rows),
            'found'      => $found,
            'not_found'  => $notFound,
        ]);
    }
}

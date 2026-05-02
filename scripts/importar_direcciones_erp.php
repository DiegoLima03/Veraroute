<?php
/**
 * Importar direcciones de entrega desde DIR_M.xlsx (ERP Velneo)
 *
 * Uso:
 *   php scripts/importar_direcciones_erp.php              # dry-run (preview)
 *   php scripts/importar_direcciones_erp.php --execute     # ejecutar importacion
 *
 * Requiere: composer require phpoffice/phpspreadsheet
 *   O bien: pip install openpyxl  (se usa Python como fallback)
 */

// -- Configuracion --
$DB_HOST = '127.0.0.1';
$DB_PORT = 3308;
$DB_USER = 'root';
$DB_PASS = '';
$DB_NAME = 'gestorrutas';
$XLSX_PATH = __DIR__ . '/../DIR_M.xlsx';

$dryRun = !in_array('--execute', $argv ?? []);

if ($dryRun) {
    echo "=== MODO DRY-RUN (preview) ===\n";
    echo "Usa --execute para aplicar cambios\n\n";
}

// -- Conexion BD --
$pdo = new PDO(
    "mysql:host=$DB_HOST;port=$DB_PORT;dbname=$DB_NAME;charset=utf8mb4",
    $DB_USER, $DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

// -- Cargar clientes actuales --
$stmt = $pdo->query('SELECT id, nombre, direccion, codigo_postal, x, y FROM clientes');
$clientes = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Indice por nombre normalizado
$clientesByName = [];
foreach ($clientes as $c) {
    $norm = normalizeName($c['nombre']);
    $clientesByName[$norm][] = $c;
}

// Cargar direcciones existentes para detectar duplicados
$existingDirs = [];
$stmt = $pdo->query('SELECT id_cliente, direccion, codigo_postal, codigo_erp FROM direcciones_entrega');
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $d) {
    $key = $d['id_cliente'] . '|' . normalizeName($d['direccion'] ?? '') . '|' . trim($d['codigo_postal'] ?? '');
    $existingDirs[$key] = true;
    if ($d['codigo_erp']) {
        $existingDirs['erp:' . $d['codigo_erp']] = true;
    }
}

// -- Leer DIR_M.xlsx con Python (no necesita phpspreadsheet) --
echo "Leyendo DIR_M.xlsx...\n";
$jsonFile = __DIR__ . '/../dir_m_parsed.json';
$pyScript = __DIR__ . '/_parse_dirm.py';

// Crear script Python temporal
file_put_contents($pyScript, '
import openpyxl, json, sys

xlsx = sys.argv[1]
out  = sys.argv[2]

wb = openpyxl.load_workbook(xlsx, read_only=True)
ws = wb.active
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    rows.append({
        "codigo": row[0],
        "descripcion": str(row[1] or ""),
        "contacto": str(row[3] or ""),
        "direccion": str(row[9] or "").replace("_x000D_", "").strip(),
        "direccion_2": str(row[10] or "").replace("_x000D_", "").strip(),
        "cp": str(row[11] or ""),
        "localidad": str(row[12] or ""),
        "provincia": str(row[8] or ""),
        "lat": float(row[13] or 0),
        "lng": float(row[14] or 0),
        "principal_erp": str(row[17] or ""),
        "desactivado": str(row[22] or ""),
    })
wb.close()
with open(out, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False)
print(len(rows))
');

$pythonCmd = sprintf(
    'python "%s" "%s" "%s" 2>&1',
    str_replace('/', '\\', $pyScript),
    str_replace('/', '\\', $XLSX_PATH),
    str_replace('/', '\\', $jsonFile)
);
$count = trim(shell_exec($pythonCmd));
echo "Leidas $count filas\n\n";

@unlink($pyScript);

$entries = json_decode(file_get_contents($jsonFile), true);
@unlink($jsonFile);
if (!$entries) {
    die("ERROR: No se pudo leer DIR_M.xlsx\n");
}

// -- Procesar entradas --
$stats = [
    'matched' => 0,
    'unmatched' => 0,
    'skipped_desactivado' => 0,
    'skipped_duplicado' => 0,
    'inserted' => 0,
    'coords_asignadas' => 0,
    'coords_multi_match' => 0,
    'sin_coords' => 0,
];

$unmatchedNames = [];
$insertedByCliente = []; // id_cliente => [array de dirs insertadas]

foreach ($entries as $entry) {
    // Saltar desactivados
    if (in_array(strtolower($entry['desactivado']), ['sí', 'si', 'yes', '1'])) {
        $stats['skipped_desactivado']++;
        continue;
    }

    // Parsear contacto: "ID - NOMBRE / NOMBRE_FISCAL"
    if (!preg_match('/^(\d[\d.]*)\s*-\s*(.+)/', $entry['contacto'], $m)) {
        continue;
    }
    $erpClientId = trim($m[1]);
    $rest = trim($m[2]);
    $name = (strpos($rest, ' / ') !== false) ? explode(' / ', $rest)[0] : $rest;

    // Buscar cliente en BD
    $norm = normalizeName($name);
    if (!isset($clientesByName[$norm])) {
        $stats['unmatched']++;
        if (count($unmatchedNames) < 50) {
            $unmatchedNames[] = $name;
        }
        continue;
    }
    $stats['matched']++;
    $cliente = $clientesByName[$norm][0]; // Tomar el primero si hay duplicados
    $clienteId = (int) $cliente['id'];

    // Saltar si ya existe (por codigo_erp o por direccion+cp)
    $erpCode = (string) $entry['codigo'];
    if (isset($existingDirs['erp:' . $erpCode])) {
        $stats['skipped_duplicado']++;
        continue;
    }
    $dirKey = $clienteId . '|' . normalizeName($entry['direccion']) . '|' . trim($entry['cp']);
    if (isset($existingDirs[$dirKey])) {
        $stats['skipped_duplicado']++;
        continue;
    }

    // Preparar datos de insercion
    $dirData = [
        'id_cliente' => $clienteId,
        'descripcion' => $entry['descripcion'] ?: $name,
        'direccion' => $entry['direccion'],
        'direccion_2' => $entry['direccion_2'],
        'codigo_postal' => $entry['cp'],
        'localidad' => $entry['localidad'],
        'provincia' => cleanProvincia($entry['provincia']),
        'x' => null, // Se asigna despues
        'y' => null,
        'principal' => 0,
        'codigo_erp' => $erpCode,
    ];

    // GPS del ERP (si tiene)
    if ($entry['lat'] != 0 && $entry['lng'] != 0) {
        $dirData['x'] = $entry['lat'];
        $dirData['y'] = $entry['lng'];
    }

    if (!$dryRun) {
        $sql = 'INSERT INTO direcciones_entrega
            (id_cliente, descripcion, direccion, direccion_2, codigo_postal, localidad, provincia, x, y, principal, codigo_erp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        $pdo->prepare($sql)->execute([
            $dirData['id_cliente'], $dirData['descripcion'], $dirData['direccion'],
            $dirData['direccion_2'], $dirData['codigo_postal'], $dirData['localidad'],
            $dirData['provincia'], $dirData['x'], $dirData['y'],
            $dirData['principal'], $dirData['codigo_erp'],
        ]);
    }

    $stats['inserted']++;
    $existingDirs[$dirKey] = true;
    $existingDirs['erp:' . $erpCode] = true;
    $insertedByCliente[$clienteId][] = $dirData;
}

// -- Asignar coordenadas de clientes a direcciones importadas --
echo "=== ASIGNACION DE COORDENADAS ===\n";

foreach ($insertedByCliente as $clienteId => $dirs) {
    $cliente = null;
    foreach ($clientes as $c) {
        if ((int)$c['id'] === $clienteId) { $cliente = $c; break; }
    }
    if (!$cliente || !$cliente['x'] || !$cliente['y']) continue;

    $clienteX = (float) $cliente['x'];
    $clienteY = (float) $cliente['y'];
    if ($clienteX == 0 && $clienteY == 0) continue;

    // Contar dirs sin coords para este cliente
    $sinCoords = array_filter($dirs, fn($d) => $d['x'] === null);
    if (empty($sinCoords)) continue;

    if (count($dirs) === 1) {
        // Cliente con 1 sola DIR_M nueva: copiar coords directamente
        if (!$dryRun) {
            $pdo->prepare('UPDATE direcciones_entrega SET x = ?, y = ? WHERE id_cliente = ? AND codigo_erp = ?')
                ->execute([$clienteX, $clienteY, $clienteId, $dirs[0]['codigo_erp']]);
        }
        $stats['coords_asignadas']++;
    } else {
        // Cliente con N DIR_M: buscar cual coincide por CP
        $clienteCP = trim($cliente['codigo_postal']);
        $matched = false;
        foreach ($dirs as $d) {
            if ($d['x'] !== null) continue; // Ya tiene coords del ERP
            if (trim($d['codigo_postal']) === $clienteCP && $clienteCP !== '') {
                if (!$dryRun) {
                    $pdo->prepare('UPDATE direcciones_entrega SET x = ?, y = ? WHERE id_cliente = ? AND codigo_erp = ?')
                        ->execute([$clienteX, $clienteY, $clienteId, $d['codigo_erp']]);
                }
                $stats['coords_multi_match']++;
                $matched = true;
                break;
            }
        }
        if (!$matched) {
            // Fallback: asignar a la que tenga direccion mas similar
            $bestSim = 0;
            $bestErp = null;
            $clienteDir = normalizeName($cliente['direccion']);
            foreach ($dirs as $d) {
                if ($d['x'] !== null) continue;
                $sim = 0;
                similar_text($clienteDir, normalizeName($d['direccion']), $sim);
                if ($sim > $bestSim) {
                    $bestSim = $sim;
                    $bestErp = $d['codigo_erp'];
                }
            }
            if ($bestErp && $bestSim > 30) {
                if (!$dryRun) {
                    $pdo->prepare('UPDATE direcciones_entrega SET x = ?, y = ? WHERE id_cliente = ? AND codigo_erp = ?')
                        ->execute([$clienteX, $clienteY, $clienteId, $bestErp]);
                }
                $stats['coords_multi_match']++;
            } else {
                $stats['sin_coords'] += count($sinCoords);
            }
        }
    }
}

// -- Informe --
echo "\n=== RESULTADOS ===\n";
echo "DIR_M leidas:          " . count($entries) . "\n";
echo "Matched a clientes:    {$stats['matched']}\n";
echo "Unmatched (sin cliente):{$stats['unmatched']}\n";
echo "Desactivadas:          {$stats['skipped_desactivado']}\n";
echo "Duplicadas (ya existian):{$stats['skipped_duplicado']}\n";
echo "Insertadas:            {$stats['inserted']}\n";
echo "Coords asignadas (1 dir): {$stats['coords_asignadas']}\n";
echo "Coords asignadas (N dirs):{$stats['coords_multi_match']}\n";
echo "Sin coords (pendientes):  {$stats['sin_coords']}\n";

if ($unmatchedNames) {
    echo "\nPrimeros " . count($unmatchedNames) . " nombres no matcheados:\n";
    foreach ($unmatchedNames as $n) {
        echo "  - $n\n";
    }
}

if ($dryRun) {
    echo "\n=== DRY-RUN: no se han insertado datos ===\n";
    echo "Usa: php scripts/importar_direcciones_erp.php --execute\n";
}

// -- Funciones auxiliares --
function normalizeName(string $s): string {
    $s = mb_strtoupper(trim($s));
    // Quitar acentos
    $s = str_replace(
        ['Á','É','Í','Ó','Ú','Ñ','Ü','À','È','Ì','Ò','Ù','Â','Ê','Ô','Ã','Õ'],
        ['A','E','I','O','U','N','U','A','E','I','O','U','A','E','O','A','O'],
        $s
    );
    // Quitar sufijos empresariales
    $noise = [', S.L.', ', SL', ', S.L', ',S.L.', ', SLU', ', SL.', ', S.A.', ', SA',
              ', CB', ', SC', ', SCG', ', SCOOP', ', S.COOP', '.'];
    foreach ($noise as $n) {
        $s = str_replace($n, '', $s);
    }
    $s = preg_replace('/\s+/', ' ', $s);
    return trim($s);
}

function cleanProvincia(string $s): string {
    // "36 - PONTEVEDRA" -> "PONTEVEDRA"
    if (preg_match('/^\d+\s*-\s*(.+)/', $s, $m)) {
        return trim($m[1]);
    }
    return trim($s);
}

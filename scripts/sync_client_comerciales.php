<?php

require_once __DIR__ . '/../config/database.php';

function normalizeCommercialKey(?string $value): string
{
    $value = trim((string) $value);
    $value = preg_replace('/\s+/u', ' ', $value);
    return mb_strtolower($value, 'UTF-8');
}

function columnExists(PDO $db, string $column): bool
{
    $column = str_replace("'", "''", $column);
    $stmt = $db->query("SHOW COLUMNS FROM clients LIKE '$column'");
    return (bool) $stmt->fetch();
}

$db = Database::connect();

$requiredColumns = ['comercial_planta_id', 'comercial_flor_id', 'comercial_accesorio_id'];
foreach ($requiredColumns as $column) {
    if (!columnExists($db, $column)) {
        fwrite(STDERR, "Falta la migracion de columnas comerciales. Ejecuta sql/migration_client_comerciales.sql primero.\n");
        exit(1);
    }
}

$commercialMap = [];
$commercialRows = $db->query('SELECT id, code, name FROM comerciales')->fetchAll();
foreach ($commercialRows as $row) {
    $keys = [
        normalizeCommercialKey(($row['code'] ?? '') . ' - ' . ($row['name'] ?? '')),
        normalizeCommercialKey($row['name'] ?? ''),
    ];
    foreach ($keys as $key) {
        if ($key !== '') {
            $commercialMap[$key] = (int) $row['id'];
        }
    }
}

$file = __DIR__ . '/../sql/contactos (5).sql';
$fh = fopen($file, 'r');
if (!$fh) {
    fwrite(STDERR, "No se pudo abrir el dump original: $file\n");
    exit(1);
}

$assignments = [];
$totalRows = 0;
$matchedClients = 0;

while (($line = fgets($fh)) !== false) {
    $trim = trim($line);
    if ($trim === '' || $trim[0] !== '(') {
        continue;
    }

    $totalRows++;
    $clean = rtrim($trim, ",\r\n");
    if (substr($clean, 0, 1) === '(') {
        $clean = substr($clean, 1);
    }
    if (substr($clean, -1) === ')') {
        $clean = substr($clean, 0, -1);
    }

    $values = str_getcsv($clean, ',', "'");
    if (count($values) < 19) {
        continue;
    }

    if (trim((string) ($values[4] ?? '')) !== 'Cliente') {
        continue;
    }

    $name = trim((string) ($values[2] ?? ''));
    if ($name === '') {
        continue;
    }

    $key = normalizeCommercialKey($name);
    $planta = $commercialMap[normalizeCommercialKey($values[16] ?? null)] ?? null;
    $flor = $commercialMap[normalizeCommercialKey($values[17] ?? null)] ?? null;
    $accesorio = $commercialMap[normalizeCommercialKey($values[18] ?? null)] ?? null;

    $assignments[$key] = [
        'name' => $name,
        'planta' => $planta,
        'flor' => $flor,
        'accesorio' => $accesorio,
    ];
}

fclose($fh);

$update = $db->prepare(
    'UPDATE clients
     SET comercial_planta_id = ?, comercial_flor_id = ?, comercial_accesorio_id = ?
     WHERE name = ?'
);
$fillPrimary = $db->prepare(
    'UPDATE clients
     SET comercial_id = COALESCE(comercial_id, comercial_planta_id, comercial_flor_id, comercial_accesorio_id)
     WHERE name = ?'
);

$db->beginTransaction();
try {
    foreach ($assignments as $assignment) {
        $update->execute([
            $assignment['planta'],
            $assignment['flor'],
            $assignment['accesorio'],
            $assignment['name'],
        ]);
        $fillPrimary->execute([$assignment['name']]);
        $matchedClients++;
    }
    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    throw $e;
}

$r11Id = $commercialMap[normalizeCommercialKey('106 - JAVI R-11 / DOMINGUEZ COLLAZO JAVIER')] ?? null;
$r11ActiveMatches = 0;
if ($r11Id) {
    $stmt = $db->prepare(
        'SELECT COUNT(*) AS total
         FROM clients
         WHERE active = 1
           AND (
               comercial_id = ?
               OR comercial_planta_id = ?
               OR comercial_flor_id = ?
               OR comercial_accesorio_id = ?
           )'
    );
    $stmt->execute([$r11Id, $r11Id, $r11Id, $r11Id]);
    $r11ActiveMatches = (int) ($stmt->fetch()['total'] ?? 0);
}

echo "rows_in_dump\t$totalRows\n";
echo "client_assignments\t$matchedClients\n";
echo "r11_active_matches\t$r11ActiveMatches\n";

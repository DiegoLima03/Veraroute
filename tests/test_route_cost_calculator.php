<?php
/**
 * C6: Tests minimos sobre CalculadorCosteRuta
 * Ejecutar: php tests/test_route_cost_calculator.php
 *
 * No usa PHPUnit — test runner minimalista sin dependencias externas.
 * Valida contra datos reales de la BD local.
 */

// Cambiar al directorio raiz del proyecto
chdir(__DIR__ . '/..');

require_once 'config/database.php';
require_once 'core/Modelo.php';
require_once 'core/Autenticacion.php';
require_once 'models/HojaRuta.php';
require_once 'models/Vehiculo.php';
require_once 'models/Delegacion.php';
require_once 'models/DistanciasCache.php';
require_once 'models/ConfigEnviosGls.php';
require_once 'models/HistorialCosteCliente.php';
require_once 'models/TarifaTransportista.php';
require_once 'services/CalculadorCosteRuta.php';

// ── Mini test runner ──────────────────────────────────────
$passed = 0;
$failed = 0;
$errors = [];

function assert_true(bool $condition, string $msg): void {
    global $passed, $failed, $errors;
    if ($condition) {
        $passed++;
        echo "  PASS: {$msg}\n";
    } else {
        $failed++;
        $errors[] = $msg;
        echo "  FAIL: {$msg}\n";
    }
}

function assert_equals($expected, $actual, string $msg): void {
    assert_true($expected === $actual, "{$msg} (esperado: " . var_export($expected, true) . ", obtenido: " . var_export($actual, true) . ")");
}

function assert_gt(float $a, float $b, string $msg): void {
    assert_true($a > $b, "{$msg} ({$a} > {$b})");
}

function assert_gte(float $a, float $b, string $msg): void {
    assert_true($a >= $b, "{$msg} ({$a} >= {$b})");
}

function assert_in(string $needle, array $haystack, string $msg): void {
    assert_true(in_array($needle, $haystack, true), "{$msg} ('{$needle}' en [" . implode(', ', $haystack) . "])");
}

echo "=== Tests CalculadorCosteRuta ===\n\n";

// ── Test 1: Constructor no lanza excepcion ────────────────
echo "Test 1: Instanciar CalculadorCosteRuta\n";
try {
    $calc = new CalculadorCosteRuta();
    assert_true(true, 'Constructor OK');
} catch (Throwable $e) {
    assert_true(false, 'Constructor fallo: ' . $e->getMessage());
}

// ── Test 2: Buscar una hoja con lineas para testear ───────
echo "\nTest 2: Buscar hoja de ruta con lineas\n";
$db = Database::connect();
$row = $db->query("
    SELECT hr.id, hr.id_vehiculo, COUNT(hrl.id) as num_lineas
    FROM hojas_ruta hr
    JOIN hoja_ruta_lineas hrl ON hrl.id_hoja_ruta = hr.id
    WHERE hr.id_vehiculo IS NOT NULL
    GROUP BY hr.id
    HAVING num_lineas >= 2
    ORDER BY hr.fecha DESC
    LIMIT 1
")->fetch();

if (!$row) {
    echo "  SKIP: No hay hojas con vehiculo y >= 2 lineas\n";
} else {
    $hojaId = (int) $row['id'];
    echo "  Usando hoja ID={$hojaId} con {$row['num_lineas']} lineas\n";

    // ── Test 3: calculateAndSave devuelve estructura correcta ──
    echo "\nTest 3: calculateAndSave devuelve campos esperados\n";
    $result = $calc->calculateAndSave($hojaId, true);

    assert_true(is_array($result), 'Resultado es array');
    assert_true(array_key_exists('processed', $result), 'Campo processed existe');
    assert_true(array_key_exists('total_route_km', $result), 'Campo total_route_km existe');
    assert_true(array_key_exists('total_route_cost', $result), 'Campo total_route_cost existe');
    assert_true(array_key_exists('total_gls_all_clients', $result), 'Campo total_gls_all_clients existe');
    assert_true(array_key_exists('global_recommendation', $result), 'Campo global_recommendation existe');
    assert_true(array_key_exists('global_savings', $result), 'Campo global_savings existe');
    assert_true(array_key_exists('osrm_warning', $result), 'Campo osrm_warning existe');
    assert_true(array_key_exists('optimization_mode', $result), 'Campo optimization_mode existe');
    assert_true(array_key_exists('line_recommendations', $result), 'Campo line_recommendations existe');

    // ── Test 4: Valores numericos son coherentes ──────────────
    echo "\nTest 4: Valores numericos coherentes\n";
    assert_gte((float) $result['total_route_km'], 0, 'total_route_km >= 0');
    assert_gte((float) $result['total_route_cost'], 0, 'total_route_cost >= 0');
    assert_gte((float) $result['total_gls_all_clients'], 0, 'total_gls_all_clients >= 0');
    assert_gte((float) $result['global_savings'], 0, 'global_savings >= 0');

    // ── Test 5: global_recommendation tiene valor valido ──────
    echo "\nTest 5: global_recommendation es valida\n";
    $validRecs = ['externalize_all', 'do_route', 'mixed', 'no_disponible'];
    assert_in($result['global_recommendation'], $validRecs, 'global_recommendation valida');

    // ── Test 6: Coherencia entre global_recommendation y savings ──
    echo "\nTest 6: Coherencia recomendacion vs savings\n";
    $routeCost = (float) $result['total_route_cost'];
    $glsAll = (float) $result['total_gls_all_clients'];
    $rec = $result['global_recommendation'];

    if ($routeCost > 0 && $glsAll > 0) {
        if ($rec === 'externalize_all') {
            assert_true($glsAll < $routeCost * 0.95, 'externalize_all: GLS < flota*0.95');
            assert_gt((float) $result['global_savings'], 0, 'externalize_all: savings > 0');
        } elseif ($rec === 'do_route') {
            assert_true($glsAll > $routeCost * 1.05, 'do_route: GLS > flota*1.05');
            assert_gt((float) $result['global_savings'], 0, 'do_route: savings > 0');
        } elseif ($rec === 'mixed') {
            assert_equals(0.0, (float) $result['global_savings'], 'mixed: savings = 0');
        }
    }

    // ── Test 7: processed + skipped suman el total ────────────
    echo "\nTest 7: Contadores suman correctamente\n";
    $summed = $result['processed'] + $result['skipped_cached'] + $result['skipped_zero_load'] + $result['skipped_no_postcode'];
    assert_true($summed > 0, "Suma de contadores > 0 (total: {$summed})");

    // ── Test 8: line_recommendations es array asociativo ──────
    echo "\nTest 8: line_recommendations estructura\n";
    assert_true(is_array($result['line_recommendations']), 'line_recommendations es array');
}

// ── Test 9: Hoja inexistente devuelve error ───────────────
echo "\nTest 9: Hoja inexistente\n";
$badResult = $calc->calculateAndSave(999999, true);
assert_true(!empty($badResult['error']), 'Hoja inexistente devuelve error');

// ── Test 10: calculateDetourKm con cliente valido ─────────
echo "\nTest 10: calculateDetourKm\n";
if (isset($hojaId)) {
    $lineaRow = $db->query("
        SELECT id_cliente FROM hoja_ruta_lineas
        WHERE id_hoja_ruta = {$hojaId}
        AND id_cliente IS NOT NULL
        LIMIT 1
    ")->fetch();
    if ($lineaRow) {
        $detour = $calc->calculateDetourKm((int) $lineaRow['id_cliente'], $hojaId);
        assert_true($detour === null || $detour >= 0, 'desvio_km es null o >= 0');
    }
}

// ── Resumen ───────────────────────────────────────────────
echo "\n" . str_repeat('=', 50) . "\n";
echo "Resultados: {$passed} PASS, {$failed} FAIL\n";
if ($failed > 0) {
    echo "\nFallos:\n";
    foreach ($errors as $e) {
        echo "  - {$e}\n";
    }
    exit(1);
}
echo "Todos los tests pasaron.\n";
exit(0);

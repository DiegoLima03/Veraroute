<?php
ob_start();

require_once __DIR__ . '/config/env.php';
Env::load();

// Headers de seguridad
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

if (Env::bool('APP_DEBUG', false)) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }
    ini_set('error_log', $logDir . '/error.log');
}

// Determinar la URI relativa al proyecto
$requestUri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$basePath   = '/Gestor de Rutas';
$uri        = '/';

$pos = strpos($requestUri, $basePath);
if ($pos !== false) {
    $uri = substr($requestUri, $pos + strlen($basePath));
}
$uri = trim($uri, '/');

// Versionado API: api/v1/xxx se resuelve como api/xxx (compatibilidad)
if (strpos($uri, 'api/v1/') === 0) {
    $uri = 'api/' . substr($uri, 7);
}

// Servir ficheros estáticos (css, js) directamente
if (preg_match('#^public/.+#', $uri) && file_exists(__DIR__ . '/' . $uri)) {
    return false;
}

// Login page se gestiona por separado
if ($uri === 'login.php') {
    require __DIR__ . '/login.php';
    exit;
}

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/core/Enrutador.php';
require_once __DIR__ . '/core/Controlador.php';
require_once __DIR__ . '/core/Modelo.php';
require_once __DIR__ . '/core/Autenticacion.php';

// Proteger todas las rutas: requiere sesión activa
Autenticacion::requireLogin();

$router = new Enrutador();

// Vista principal
$router->get('', 'PaginaController@index');
$router->get('api/me', 'PaginaController@me');
$router->get('logout', 'PaginaController@logout');

// API — Clientes
$router->get('api/clients', 'ClienteController@index');
$router->post('api/clients', 'ClienteController@store');
$router->post('api/clients/(\d+)/duplicate', 'ClienteController@duplicate');
$router->put('api/clients/(\d+)/toggle', 'ClienteController@toggleActive');
$router->put('api/clients/(\d+)/contado', 'ClienteController@updateContado');
$router->put('api/clients/(\d+)', 'ClienteController@update');
$router->delete('api/clients/(\d+)', 'ClienteController@destroy');
$router->get('api/clients/(\d+)/schedules', 'ClienteController@getSchedules');
$router->put('api/clients/(\d+)/schedules', 'ClienteController@saveSchedules');

// API — Direcciones de entrega
$router->get('api/clients/(\d+)/addresses', 'ClienteController@getAddresses');
$router->post('api/clients/(\d+)/addresses', 'ClienteController@storeAddress');
$router->put('api/clients/(\d+)/addresses/(\d+)', 'ClienteController@updateAddress');
$router->delete('api/clients/(\d+)/addresses/(\d+)', 'ClienteController@destroyAddress');
$router->put('api/clients/(\d+)/addresses/(\d+)/principal', 'ClienteController@setAddressPrincipal');

// API — Pedidos
$router->get('api/orders', 'PedidoController@index');
$router->get('api/orders/comercial-day', 'PedidoController@comercialDay');
$router->get('api/orders/resumen-por-ruta', 'PedidoController@resumenPorRuta');
$router->post('api/orders', 'PedidoController@store');
$router->put('api/orders/(\d+)', 'PedidoController@update');
$router->put('api/orders/(\d+)/estado', 'PedidoController@updateEstado');
$router->delete('api/orders', 'PedidoController@destroy');

// Demo
$router->post('api/demo', 'ClienteController@loadDemo');

// API — Settings (delegacion) — retrocompatibilidad
$router->get('api/delegation', 'ConfiguracionController@delegation');
$router->put('api/delegation', 'ConfiguracionController@updateDelegation');

// API — Delegaciones
$router->get('api/delegations', 'DelegacionController@index');
$router->post('api/delegations', 'DelegacionController@store');
$router->put('api/delegations/(\d+)/toggle', 'DelegacionController@toggleActive');
$router->put('api/delegations/(\d+)', 'DelegacionController@update');
$router->delete('api/delegations/(\d+)', 'DelegacionController@destroy');

// API — Vehiculos
$router->get('api/vehicles', 'VehiculoController@index');
$router->post('api/vehicles', 'VehiculoController@store');
$router->put('api/vehicles/(\d+)/toggle', 'VehiculoController@toggleActive');
$router->put('api/vehicles/(\d+)', 'VehiculoController@update');
$router->delete('api/vehicles/(\d+)', 'VehiculoController@destroy');

// API — Rutas (optimizacion multi-vehiculo)
$router->post('api/routes/optimize', 'OptimizadorRutaController@optimize');
$router->get('api/routes/history', 'OptimizadorRutaController@history');
$router->put('api/routes/(\d+)/stop/(\d+)/status', 'OptimizadorRutaController@updateStopStatus');
$router->put('api/routes/(\d+)/status', 'OptimizadorRutaController@updatePlanStatus');
$router->put('api/routes/(\d+)', 'OptimizadorRutaController@update');
$router->get('api/routes', 'OptimizadorRutaController@index');
$router->get('api/routes/(\d+)', 'OptimizadorRutaController@show');

// API — Settings globales
$router->get('api/settings', 'ConfiguracionController@getSettings');
$router->put('api/settings', 'ConfiguracionController@updateSettings');

// API — Paqueteria por tablas + comparativa de costes
$router->get('api/shipping-config', 'CosteGlsController@getConfig');
$router->get('api/shipping-config/alerts', 'CosteGlsController@getAlerts');
$router->put('api/shipping-config/fuel', 'CosteGlsController@updateFuelPct');
$router->put('api/shipping-config', 'CosteGlsController@updateConfig');
$router->post('api/shipping-costs/calculate', 'CosteGlsController@calculateForHoja');
$router->post('api/shipping-costs/simulate', 'CosteGlsController@simulateForHoja');
$router->get('api/shipping-costs/hoja/(\d+)', 'CosteGlsController@getCostsForHoja');
$router->get('api/shipping-costs/client/(\d+)', 'CosteGlsController@getClientHistory');
$router->get('api/shipping-costs/daily-report', 'CosteGlsController@getDailyReport');
$router->get('api/shipping-costs/range-report', 'CosteGlsController@getRangeReport');
$router->post('api/shipping-costs/recalculate', 'CosteGlsController@recalculateAll');
$router->get('api/shipping-rates', 'TarifaTransportistaController@index');
$router->post('api/shipping-rates', 'TarifaTransportistaController@store');
$router->put('api/shipping-rates/(\d+)', 'TarifaTransportistaController@update');
$router->delete('api/shipping-rates/(\d+)', 'TarifaTransportistaController@destroy');

// API — Dashboard stats
$router->get('api/stats', 'OptimizadorRutaController@stats');
$router->get('api/stats/gls', 'CosteGlsController@dashboardStats');

// API — Rutas comerciales (asignación de clientes)
$router->get('api/rutas', 'RutaController@index');
$router->post('api/rutas', 'RutaController@store');
$router->put('api/rutas/(\d+)', 'RutaController@update');
$router->delete('api/rutas/(\d+)', 'RutaController@destroy');

// API — Hojas de Ruta
$router->get('api/hojas-ruta', 'HojaRutaController@index');
$router->post('api/hojas-ruta/generar-desde-pedidos', 'HojaRutaController@generateFromOrders');
$router->get('api/hojas-ruta/(\d+)', 'HojaRutaController@show');
$router->post('api/hojas-ruta', 'HojaRutaController@store');
$router->put('api/hojas-ruta/(\d+)', 'HojaRutaController@update');
$router->delete('api/hojas-ruta/(\d+)', 'HojaRutaController@destroy');
$router->put('api/hojas-ruta/(\d+)/estado', 'HojaRutaController@updateEstado');
$router->post('api/hojas-ruta/(\d+)/lineas', 'HojaRutaController@addLinea');
$router->put('api/hojas-ruta/(\d+)/lineas/(\d+)', 'HojaRutaController@updateLinea');
$router->delete('api/hojas-ruta/(\d+)/lineas/(\d+)', 'HojaRutaController@removeLinea');
$router->put('api/hojas-ruta/(\d+)/reordenar', 'HojaRutaController@reorder');
$router->post('api/hojas-ruta/(\d+)/auto-ordenar', 'HojaRutaController@autoOrder');
$router->get('api/hojas-ruta/(\d+)/imprimir', 'HojaRutaController@printHoja');
$router->post('api/hojas-ruta/(\d+)/duplicar', 'HojaRutaController@duplicate');

// API — Comerciales
$router->get('api/comerciales', 'HojaRutaController@comerciales');

// API — Usuarios (solo admin)
$router->get('api/users', 'UsuarioController@index');
$router->post('api/users', 'UsuarioController@store');
$router->put('api/users/(\d+)', 'UsuarioController@update');
$router->delete('api/users/(\d+)', 'UsuarioController@destroy');

// API — Plantillas de ruta
$router->get('api/templates', 'PlantillaController@index');
$router->post('api/templates', 'PlantillaController@store');
$router->delete('api/templates/(\d+)', 'PlantillaController@destroy');

// API — Archivos (subida/descarga)
$router->get('api/files', 'ArchivoController@index');
$router->post('api/files', 'ArchivoController@upload');
$router->post('api/files/(.+)/parse-pedidos', 'ArchivoController@parsePedidos');
$router->get('api/files/(.+)/download', 'ArchivoController@download');
$router->delete('api/files/(.+)', 'ArchivoController@destroy');

// Manejador global de excepciones — devuelve JSON limpio en API
set_exception_handler(function (Throwable $e) {
    if (ob_get_level()) ob_end_clean();
    $isApi = strpos($_SERVER['REQUEST_URI'] ?? '', '/api/') !== false;
    $debug = Env::bool('APP_DEBUG', false);
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) @mkdir($logDir, 0775, true);
    error_log(
        date('[Y-m-d H:i:s] ') . get_class($e) . ': ' . $e->getMessage()
        . ' in ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString() . "\n",
        3,
        $logDir . '/error.log'
    );
    if ($isApi) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode([
            'error' => $debug ? get_class($e) . ': ' . $e->getMessage() : 'Error interno del servidor',
        ]);
    } else {
        http_response_code(500);
        echo $debug ? '<pre>' . htmlspecialchars($e) . '</pre>' : 'Error interno. Contacta con el administrador.';
    }
    exit;
});

$router->dispatch($uri, $_SERVER['REQUEST_METHOD']);

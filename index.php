<?php

error_reporting(E_ALL);
ini_set('display_errors', '1');

// Determinar la URI relativa al proyecto
$requestUri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$basePath   = '/Gestor de Rutas';
$uri        = '/';

$pos = strpos($requestUri, $basePath);
if ($pos !== false) {
    $uri = substr($requestUri, $pos + strlen($basePath));
}
$uri = trim($uri, '/');

// Servir ficheros estáticos (css, js) directamente
if (preg_match('#^public/.+#', $uri) && file_exists(__DIR__ . '/' . $uri)) {
    return false;
}

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/core/Router.php';
require_once __DIR__ . '/core/Controller.php';
require_once __DIR__ . '/core/Model.php';

$router = new Router();

// Vista principal
$router->get('', 'PageController@index');

// API — Clientes
$router->get('api/clients', 'ClientController@index');
$router->post('api/clients', 'ClientController@store');
$router->put('api/clients/(\d+)/toggle', 'ClientController@toggleActive');
$router->put('api/clients/(\d+)/contado', 'ClientController@updateContado');
$router->put('api/clients/(\d+)', 'ClientController@update');
$router->delete('api/clients/(\d+)', 'ClientController@destroy');
$router->get('api/clients/(\d+)/schedules', 'ClientController@getSchedules');
$router->put('api/clients/(\d+)/schedules', 'ClientController@saveSchedules');

// API — Pedidos
$router->get('api/orders', 'OrderController@index');
$router->post('api/orders', 'OrderController@store');
$router->put('api/orders/(\d+)', 'OrderController@update');
$router->delete('api/orders', 'OrderController@destroy');

// Demo
$router->post('api/demo', 'ClientController@loadDemo');

// API — Settings (delegacion) — retrocompatibilidad
$router->get('api/delegation', 'SettingController@delegation');
$router->put('api/delegation', 'SettingController@updateDelegation');

// API — Delegaciones
$router->get('api/delegations', 'DelegationController@index');
$router->post('api/delegations', 'DelegationController@store');
$router->put('api/delegations/(\d+)/toggle', 'DelegationController@toggleActive');
$router->put('api/delegations/(\d+)', 'DelegationController@update');
$router->delete('api/delegations/(\d+)', 'DelegationController@destroy');

// API — Vehiculos
$router->get('api/vehicles', 'VehicleController@index');
$router->post('api/vehicles', 'VehicleController@store');
$router->put('api/vehicles/(\d+)/toggle', 'VehicleController@toggleActive');
$router->put('api/vehicles/(\d+)', 'VehicleController@update');
$router->delete('api/vehicles/(\d+)', 'VehicleController@destroy');

// API — Productos (catalogo)
$router->get('api/products', 'ProductController@index');
$router->post('api/products', 'ProductController@store');
$router->put('api/products/(\d+)', 'ProductController@update');
$router->delete('api/products/(\d+)', 'ProductController@destroy');

// API — Rutas (optimizacion multi-vehiculo)
$router->post('api/routes/optimize', 'RouteController@optimize');
$router->get('api/routes/history', 'RouteController@history');
$router->put('api/routes/(\d+)/stop/(\d+)/status', 'RouteController@updateStopStatus');
$router->put('api/routes/(\d+)/status', 'RouteController@updatePlanStatus');
$router->put('api/routes/(\d+)', 'RouteController@update');
$router->get('api/routes', 'RouteController@index');
$router->get('api/routes/(\d+)', 'RouteController@show');

// API — Settings globales
$router->get('api/settings', 'SettingController@getSettings');
$router->put('api/settings', 'SettingController@updateSettings');

// API — Dashboard stats
$router->get('api/stats', 'RouteController@stats');

// API — Rutas comerciales (asignación de clientes)
$router->get('api/rutas', 'RutaController@index');
$router->post('api/rutas', 'RutaController@store');
$router->put('api/rutas/(\d+)', 'RutaController@update');
$router->delete('api/rutas/(\d+)', 'RutaController@destroy');

// API — Hojas de Ruta
$router->get('api/hojas-ruta', 'HojaRutaController@index');
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

// API — Plantillas de ruta
$router->get('api/templates', 'TemplateController@index');
$router->post('api/templates', 'TemplateController@store');
$router->delete('api/templates/(\d+)', 'TemplateController@destroy');

$router->dispatch($uri, $_SERVER['REQUEST_METHOD']);

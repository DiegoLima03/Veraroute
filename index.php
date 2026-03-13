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
$router->put('api/clients/(\d+)', 'ClientController@update');
$router->delete('api/clients/(\d+)', 'ClientController@destroy');

// API — Pedidos
$router->get('api/orders', 'OrderController@index');
$router->post('api/orders', 'OrderController@store');
$router->put('api/orders/(\d+)', 'OrderController@update');
$router->delete('api/orders', 'OrderController@destroy');

// Demo
$router->post('api/demo', 'ClientController@loadDemo');

// API — Settings (depot)
$router->get('api/depot', 'SettingController@depot');
$router->put('api/depot', 'SettingController@updateDepot');

$router->dispatch($uri, $_SERVER['REQUEST_METHOD']);

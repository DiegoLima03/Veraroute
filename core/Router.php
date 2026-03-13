<?php

class Router
{
    private $routes = [];

    public function get(string $pattern, string $action)
    {
        $this->routes[] = ['GET', $pattern, $action];
    }

    public function post(string $pattern, string $action)
    {
        $this->routes[] = ['POST', $pattern, $action];
    }

    public function put(string $pattern, string $action)
    {
        $this->routes[] = ['PUT', $pattern, $action];
    }

    public function delete(string $pattern, string $action)
    {
        $this->routes[] = ['DELETE', $pattern, $action];
    }

    public function dispatch(string $uri, string $method)
    {
        foreach ($this->routes as $route) {
            list($routeMethod, $pattern, $action) = $route;

            if ($routeMethod !== $method) {
                continue;
            }

            $regex = '#^' . $pattern . '$#';

            if (preg_match($regex, $uri, $matches)) {
                array_shift($matches);

                list($controllerName, $methodName) = explode('@', $action);

                $controllerFile = __DIR__ . '/../controllers/' . $controllerName . '.php';
                if (!file_exists($controllerFile)) {
                    http_response_code(500);
                    echo json_encode(['error' => 'Controller not found']);
                    return;
                }

                require_once $controllerFile;
                $controller = new $controllerName();
                call_user_func_array([$controller, $methodName], $matches);
                return;
            }
        }

        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Route not found']);
    }
}

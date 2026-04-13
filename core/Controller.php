<?php

class Controller
{
    protected function json($data, int $code = 200)
    {
        // Limpiar cualquier output previo (warnings PHP con display_errors)
        if (ob_get_level()) ob_end_clean();
        http_response_code($code);
        header('Content-Type: application/json');
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) {
            http_response_code(500);
            echo json_encode(['error' => 'JSON encode error: ' . json_last_error_msg()]);
        } else {
            echo $json;
        }
        exit;
    }

    protected function getInput()
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }

    /** Valida y sanitiza una fecha de $_GET. Devuelve YYYY-MM-DD o el default. */
    protected function getDateParam(string $key, ?string $default = null): string
    {
        $val = $_GET[$key] ?? $default ?? date('Y-m-d');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $val) && strtotime($val) !== false) {
            return $val;
        }
        return $default ?? date('Y-m-d');
    }
}

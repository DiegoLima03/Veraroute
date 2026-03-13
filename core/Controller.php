<?php

class Controller
{
    protected function json($data, int $code = 200)
    {
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
}

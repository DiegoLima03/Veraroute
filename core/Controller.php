<?php

class Controller
{
    protected function json($data, int $code = 200)
    {
        http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    protected function getInput()
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }
}

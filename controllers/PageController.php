<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';

class PageController extends Controller
{
    public function index()
    {
        require __DIR__ . '/../views/app.php';
    }

    public function me()
    {
        $user = Auth::currentUser();
        $this->json([
            'id'           => $user['id'],
            'username'     => $user['username'],
            'full_name'    => $user['full_name'],
            'role'         => $user['role'],
            'comercial_id' => $user['comercial_id'],
            'comercial_ids' => Auth::comercialIds(),
        ]);
    }

    public function logout()
    {
        Auth::logout();
        header('Location: /Gestor de Rutas/login.php');
        exit;
    }
}

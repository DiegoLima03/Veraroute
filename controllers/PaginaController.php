<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';

class PaginaController extends Controlador
{
    public function index()
    {
        require __DIR__ . '/../views/app.php';
    }

    public function me()
    {
        $user = Autenticacion::currentUser();
        $this->json([
            'id'           => $user['id'],
            'username'     => $user['username'],
            'full_name'    => $user['full_name'],
            'role'         => $user['role'],
            'id_comercial' => $user['id_comercial'],
            'comercial_ids' => Autenticacion::comercialIds(),
        ]);
    }

    public function logout()
    {
        Autenticacion::logout();
        header('Location: /Gestor de Rutas/login.php');
        exit;
    }
}

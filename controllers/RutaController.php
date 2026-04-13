<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/Ruta.php';

class RutaController extends Controller
{
    private $ruta;

    public function __construct()
    {
        $this->ruta = new Ruta();
    }

    public function index()
    {
        Auth::requireRole('admin', 'logistica', 'comercial');
        $this->json($this->ruta->getAll());
    }

    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $id = $this->ruta->create($data);
        $this->json($this->ruta->getById($id), 201);
    }

    public function update($id)
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $this->ruta->update((int) $id, $data);
        $this->json($this->ruta->getById((int) $id));
    }

    public function destroy($id)
    {
        Auth::requireRole('admin');
        $this->ruta->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

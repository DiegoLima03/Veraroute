<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/Delegacion.php';

class DelegacionController extends Controlador
{
    private $delegation;

    public function __construct()
    {
        $this->delegation = new Delegacion();
    }

    public function index()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $this->json($this->delegation->getAllIncludingInactive());
    }

    public function store()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || !isset($data['x']) || !isset($data['y'])) {
            $this->json(['error' => 'Nombre y coordenadas son obligatorios'], 400);
        }
        $id = $this->delegation->create($data);
        $this->json($this->delegation->getById($id), 201);
    }

    public function update($id)
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || !isset($data['x']) || !isset($data['y'])) {
            $this->json(['error' => 'Nombre y coordenadas son obligatorios'], 400);
        }
        $this->delegation->update((int) $id, $data);
        $this->json($this->delegation->getById((int) $id));
    }

    public function toggleActive($id)
    {
        Autenticacion::requireRole('admin');
        $this->delegation->toggleActive((int) $id);
        $this->json($this->delegation->getById((int) $id));
    }

    public function destroy($id)
    {
        Autenticacion::requireRole('admin');
        $this->delegation->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

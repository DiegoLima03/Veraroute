<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Delegation.php';

class DelegationController extends Controller
{
    private $delegation;

    public function __construct()
    {
        $this->delegation = new Delegation();
    }

    public function index()
    {
        $this->json($this->delegation->getAllIncludingInactive());
    }

    public function store()
    {
        $data = $this->getInput();
        if (empty($data['name']) || !isset($data['x']) || !isset($data['y'])) {
            $this->json(['error' => 'Nombre y coordenadas son obligatorios'], 400);
        }
        $id = $this->delegation->create($data);
        $this->json($this->delegation->getById($id), 201);
    }

    public function update($id)
    {
        $data = $this->getInput();
        if (empty($data['name']) || !isset($data['x']) || !isset($data['y'])) {
            $this->json(['error' => 'Nombre y coordenadas son obligatorios'], 400);
        }
        $this->delegation->update((int) $id, $data);
        $this->json($this->delegation->getById((int) $id));
    }

    public function toggleActive($id)
    {
        $this->delegation->toggleActive((int) $id);
        $this->json($this->delegation->getById((int) $id));
    }

    public function destroy($id)
    {
        $this->delegation->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

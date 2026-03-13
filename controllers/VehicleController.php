<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Vehicle.php';

class VehicleController extends Controller
{
    private $vehicle;

    public function __construct()
    {
        $this->vehicle = new Vehicle();
    }

    public function index()
    {
        $this->json($this->vehicle->getAllIncludingInactive());
    }

    public function store()
    {
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['delegation_id'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $id = $this->vehicle->create($data);
        $this->json($this->vehicle->getById($id), 201);
    }

    public function update($id)
    {
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['delegation_id'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $this->vehicle->update((int) $id, $data);
        $this->json($this->vehicle->getById((int) $id));
    }

    public function toggleActive($id)
    {
        $this->vehicle->toggleActive((int) $id);
        $this->json($this->vehicle->getById((int) $id));
    }

    public function destroy($id)
    {
        $this->vehicle->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

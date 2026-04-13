<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/Vehicle.php';
require_once __DIR__ . '/../models/AuditLog.php';

class VehicleController extends Controller
{
    private $vehicle;

    public function __construct()
    {
        $this->vehicle = new Vehicle();
    }

    public function index()
    {
        Auth::requireRole('admin', 'logistica');
        $this->json($this->vehicle->getAllIncludingInactive());
    }

    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['delegation_id'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $id = $this->vehicle->create($data);
        $this->json($this->vehicle->getById($id), 201);
    }

    public function update($id)
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['delegation_id'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $old = $this->vehicle->getById((int) $id);
        $this->vehicle->update((int) $id, $data);
        $updated = $this->vehicle->getById((int) $id);
        // Auditar si cambian campos financieros
        if (($old['cost_per_km'] ?? null) !== ($updated['cost_per_km'] ?? null)) {
            AuditLog::log('update_vehicle_cost', 'vehicles', $id,
                ['cost_per_km' => $old['cost_per_km'] ?? null],
                ['cost_per_km' => $updated['cost_per_km'] ?? null]
            );
        }
        $this->json($updated);
    }

    public function toggleActive($id)
    {
        Auth::requireRole('admin');
        $this->vehicle->toggleActive((int) $id);
        $this->json($this->vehicle->getById((int) $id));
    }

    public function destroy($id)
    {
        Auth::requireRole('admin');
        $this->vehicle->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

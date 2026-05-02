<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/Vehiculo.php';
require_once __DIR__ . '/../models/RegistroAuditoria.php';

class VehiculoController extends Controlador
{
    private $vehicle;

    public function __construct()
    {
        $this->vehicle = new Vehiculo();
    }

    public function index()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $this->json($this->vehicle->getAllIncludingInactive());
    }

    public function store()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['id_delegacion'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $id = $this->vehicle->create($data);
        $this->json($this->vehicle->getById($id), 201);
    }

    public function update($id)
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['id_delegacion'])) {
            $this->json(['error' => 'Nombre y delegacion son obligatorios'], 400);
        }
        $old = $this->vehicle->getById((int) $id);
        $this->vehicle->update((int) $id, $data);
        $updated = $this->vehicle->getById((int) $id);
        // Auditar si cambian campos financieros
        if (($old['cost_per_km'] ?? null) !== ($updated['cost_per_km'] ?? null)) {
            RegistroAuditoria::log('update_vehicle_cost', 'vehiculos', $id,
                ['cost_per_km' => $old['cost_per_km'] ?? null],
                ['cost_per_km' => $updated['cost_per_km'] ?? null]
            );
        }
        $this->json($updated);
    }

    public function toggleActive($id)
    {
        Autenticacion::requireRole('admin');
        $this->vehicle->toggleActive((int) $id);
        $this->json($this->vehicle->getById((int) $id));
    }

    public function destroy($id)
    {
        Autenticacion::requireRole('admin');
        $this->vehicle->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

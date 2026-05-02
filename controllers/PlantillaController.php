<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/PlantillaRuta.php';

class PlantillaController extends Controlador
{
    private $templateModel;

    public function __construct()
    {
        $this->templateModel = new PlantillaRuta();
    }

    public function index()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $this->json($this->templateModel->getAll());
    }

    public function store()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['client_ids'])) {
            $this->json(['error' => 'Nombre y clientes requeridos'], 400);
            return;
        }
        $id = $this->templateModel->create(
            $data['name'],
            $data['day_of_week'] ?? null,
            $data['id_vehiculo'] ?? null,
            $data['id_delegacion'] ?? null,
            $data['client_ids']
        );
        $this->json(['id' => $id]);
    }

    public function destroy($id)
    {
        Autenticacion::requireRole('admin');
        $this->templateModel->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

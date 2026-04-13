<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/RouteTemplate.php';

class TemplateController extends Controller
{
    private $templateModel;

    public function __construct()
    {
        $this->templateModel = new RouteTemplate();
    }

    public function index()
    {
        Auth::requireRole('admin', 'logistica');
        $this->json($this->templateModel->getAll());
    }

    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name']) || empty($data['client_ids'])) {
            $this->json(['error' => 'Nombre y clientes requeridos'], 400);
            return;
        }
        $id = $this->templateModel->create(
            $data['name'],
            $data['day_of_week'] ?? null,
            $data['vehicle_id'] ?? null,
            $data['delegation_id'] ?? null,
            $data['client_ids']
        );
        $this->json(['id' => $id]);
    }

    public function destroy($id)
    {
        Auth::requireRole('admin');
        $this->templateModel->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

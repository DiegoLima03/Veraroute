<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/ShippingRateTable.php';

class ShippingRateController extends Controller
{
    private ShippingRateTable $model;

    public function __construct()
    {
        $this->model = new ShippingRateTable();
    }

    public function index()
    {
        Auth::requireRole('admin');
        $this->json($this->model->getCatalog());
    }

    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        $type = $this->resolveEntityType($data);

        switch ($type) {
            case 'carrier':
                $this->storeEntity($data, [$this->model, 'validateCarrier'], [$this->model, 'createCarrier'], [$this->model, 'getCarrierById']);
                break;
            case 'zone':
                $this->storeEntity($data, [$this->model, 'validateZone'], [$this->model, 'createZone'], [$this->model, 'getZoneById']);
                break;
            case 'rate':
                $this->storeEntity($data, [$this->model, 'validateRate'], [$this->model, 'createRate'], [$this->model, 'getRateById']);
                break;
            case 'surcharge':
                $this->storeEntity($data, [$this->model, 'validateSurcharge'], [$this->model, 'createSurcharge'], [$this->model, 'getSurchargeById']);
                break;
        }
    }

    public function update($id)
    {
        Auth::requireRole('admin');
        $entityId = (int) $id;
        $data = $this->getInput();
        $type = $this->resolveEntityType($data);

        switch ($type) {
            case 'carrier':
                $this->updateEntity($entityId, $data, [$this->model, 'getCarrierById'], [$this->model, 'validateCarrier'], [$this->model, 'updateCarrier']);
                break;
            case 'zone':
                $this->updateEntity($entityId, $data, [$this->model, 'getZoneById'], [$this->model, 'validateZone'], [$this->model, 'updateZone']);
                break;
            case 'rate':
                $this->updateEntity($entityId, $data, [$this->model, 'getRateById'], [$this->model, 'validateRate'], [$this->model, 'updateRate']);
                break;
            case 'surcharge':
                $this->updateEntity($entityId, $data, [$this->model, 'getSurchargeById'], [$this->model, 'validateSurcharge'], [$this->model, 'updateSurcharge']);
                break;
        }
    }

    public function destroy($id)
    {
        Auth::requireRole('admin');
        $entityId = (int) $id;
        $type = $this->resolveEntityType();

        switch ($type) {
            case 'carrier':
                $this->deleteEntity($entityId, [$this->model, 'getCarrierById'], [$this->model, 'deleteCarrier']);
                break;
            case 'zone':
                $this->deleteEntity($entityId, [$this->model, 'getZoneById'], [$this->model, 'deleteZone']);
                break;
            case 'rate':
                $this->deleteEntity($entityId, [$this->model, 'getRateById'], [$this->model, 'deleteRate']);
                break;
            case 'surcharge':
                $this->deleteEntity($entityId, [$this->model, 'getSurchargeById'], [$this->model, 'deleteSurcharge']);
                break;
        }
    }

    private function storeEntity(array $data, callable $validator, callable $creator, callable $getter)
    {
        $errors = call_user_func($validator, $data);
        if ($errors) {
            $this->json(['error' => implode(' ', $errors)], 400);
        }

        $id = call_user_func($creator, $data);
        $this->json(call_user_func($getter, $id), 201);
    }

    private function updateEntity(int $id, array $data, callable $getter, callable $validator, callable $updater)
    {
        if (!call_user_func($getter, $id)) {
            $this->json(['error' => 'Registro no encontrado'], 404);
        }

        $errors = call_user_func($validator, $data);
        if ($errors) {
            $this->json(['error' => implode(' ', $errors)], 400);
        }

        call_user_func($updater, $id, $data);
        $this->json(call_user_func($getter, $id));
    }

    private function deleteEntity(int $id, callable $getter, callable $deleter)
    {
        if (!call_user_func($getter, $id)) {
            $this->json(['error' => 'Registro no encontrado'], 404);
        }

        call_user_func($deleter, $id);
        $this->json(['ok' => true]);
    }

    private function resolveEntityType(?array $data = null): string
    {
        $value = strtolower(trim((string) (($data['entity_type'] ?? null) ?? ($_GET['entity_type'] ?? ''))));
        if (!in_array($value, ['carrier', 'zone', 'rate', 'surcharge'], true)) {
            $this->json(['error' => 'entity_type invalido'], 400);
        }
        return $value;
    }
}

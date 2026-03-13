<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Order.php';

class OrderController extends Controller
{
    private $order;

    public function __construct()
    {
        $this->order = new Order();
    }

    public function index()
    {
        $date = $_GET['date'] ?? date('Y-m-d');
        $this->json($this->order->getByDate($date));
    }

    public function store()
    {
        $data = $this->getInput();

        if (empty($data['client_id']) || empty($data['date'])) {
            $this->json(['error' => 'client_id y date son obligatorios'], 400);
        }

        $orderId = $this->order->createOrUpdate(
            (int) $data['client_id'],
            $data['date'],
            $data['items'] ?? [],
            $data['notes'] ?? ''
        );

        $this->json(['ok' => true, 'order_id' => $orderId], 201);
    }

    public function update($id)
    {
        $data = $this->getInput();

        // Eliminar items anteriores y re-crear
        $this->order->delete((int) $id);

        if (!empty($data['client_id']) && !empty($data['date'])) {
            $this->order->createOrUpdate(
                (int) $data['client_id'],
                $data['date'],
                $data['items'] ?? [],
                $data['notes'] ?? ''
            );
        }

        $this->json(['ok' => true]);
    }

    public function destroy()
    {
        $clientId = $_GET['client_id'] ?? null;
        $date     = $_GET['date'] ?? null;

        if ($clientId && $date) {
            $this->order->deleteByClientAndDate((int) $clientId, $date);
            $this->json(['ok' => true]);
            return;
        }

        $this->json(['error' => 'client_id y date son obligatorios'], 400);
    }
}

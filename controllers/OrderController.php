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

        $comercialId = isset($data['comercial_id']) ? (int) $data['comercial_id'] : null;
        $ccAprox = isset($data['cc_aprox']) ? (float) $data['cc_aprox'] : null;
        $estado = $data['estado'] ?? 'pendiente';

        $orderId = $this->order->createOrUpdate(
            (int) $data['client_id'],
            $data['date'],
            $data['items'] ?? [],
            $data['notes'] ?? '',
            $comercialId,
            $ccAprox,
            $data['observaciones'] ?? null,
            $estado
        );

        $this->json(['ok' => true, 'order_id' => $orderId], 201);
    }

    /** GET /api/orders/comercial-day?date=YYYY-MM-DD */
    public function comercialDay()
    {
        $date = $_GET['date'] ?? date('Y-m-d');

        require_once __DIR__ . '/../core/Auth.php';
        $comercialIds = \Auth::comercialIds();

        if (empty($comercialIds)) {
            $this->json([]);
            return;
        }

        $orders = $this->order->getComercialDayOrders($date, $comercialIds);
        $this->json($orders);
    }

    /** PUT /api/orders/{id}/estado */
    public function updateEstado($id)
    {
        $data = $this->getInput();
        $estado = $data['estado'] ?? null;

        if (!$estado) {
            $this->json(['error' => 'estado es obligatorio'], 400);
            return;
        }

        $order = $this->order->getById((int) $id);
        if (!$order) {
            $this->json(['error' => 'Pedido no encontrado'], 404);
            return;
        }

        // Comerciales only can cancel today's orders
        require_once __DIR__ . '/../core/Auth.php';
        if (\Auth::isComercial()) {
            if ($estado !== 'anulado' && $estado !== 'pendiente') {
                $this->json(['error' => 'Solo puedes anular o reactivar pedidos'], 403);
                return;
            }
            if ($order['order_date'] !== date('Y-m-d')) {
                $this->json(['error' => 'Solo puedes modificar pedidos de hoy'], 403);
                return;
            }
        }

        $this->order->updateEstado((int) $id, $estado);
        $this->json(['ok' => true]);
    }

    public function update($id)
    {
        $data = $this->getInput();

        // Eliminar items anteriores y re-crear
        $this->order->delete((int) $id);

        if (!empty($data['client_id']) && !empty($data['date'])) {
            $comercialId = isset($data['comercial_id']) ? (int) $data['comercial_id'] : null;
            $ccAprox = isset($data['cc_aprox']) ? (float) $data['cc_aprox'] : null;

            $this->order->createOrUpdate(
                (int) $data['client_id'],
                $data['date'],
                $data['items'] ?? [],
                $data['notes'] ?? '',
                $comercialId,
                $ccAprox,
                $data['observaciones'] ?? null
            );
        }

        $this->json(['ok' => true]);
    }

    /** GET /api/orders/resumen-por-ruta?date=YYYY-MM-DD */
    public function resumenPorRuta()
    {
        $date = $_GET['date'] ?? date('Y-m-d');

        $resumen = $this->order->getResumenByDate($date);
        $grouped = $this->order->getConfirmedByDateGroupedByRuta($date);

        $this->json([
            'fecha'          => $date,
            'resumen_estado' => $resumen,
            'rutas'          => $grouped['rutas'],
            'sin_ruta'       => $grouped['sin_ruta'],
            'alertas'        => $grouped['alertas'],
            'total_pedidos'  => $grouped['total_pedidos'],
        ]);
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

<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/Pedido.php';

class PedidoController extends Controlador
{
    private $order;

    public function __construct()
    {
        $this->order = new Pedido();
    }

    public function index()
    {
        Autenticacion::requireRole('admin', 'logistica', 'comercial');
        $date = $_GET['date'] ?? date('Y-m-d');
        $this->json($this->order->getByDate($date));
    }

    public function store()
    {
        Autenticacion::requireRole('admin', 'logistica', 'comercial');
        $data = $this->getInput();

        if (empty($data['id_cliente']) || empty($data['date'])) {
            $this->json(['error' => 'id_cliente y date son obligatorios'], 400);
        }

        $comercialId = isset($data['id_comercial']) ? (int) $data['id_comercial'] : null;
        $ccAprox = isset($data['cc_aprox']) ? (float) $data['cc_aprox'] : null;
        $estado = $data['estado'] ?? 'pendiente';
        $idDireccion = isset($data['id_direccion']) ? (int) $data['id_direccion'] : null;

        $orderId = $this->order->createOrUpdate(
            (int) $data['id_cliente'],
            $data['date'],
            $data['items'] ?? [],
            $data['notes'] ?? '',
            $comercialId,
            $ccAprox,
            $data['observaciones'] ?? null,
            $estado,
            $idDireccion
        );

        $this->json(['ok' => true, 'id_pedido' => $orderId], 201);
    }

    /** GET /api/orders/comercial-day?date=YYYY-MM-DD */
    public function comercialDay()
    {
        Autenticacion::requireRole('admin', 'logistica', 'comercial');
        $date = $_GET['date'] ?? date('Y-m-d');

        $comercialIds = Autenticacion::comercialIds();

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
        Autenticacion::requireRole('admin', 'logistica', 'comercial');
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

        // Comerciales solo pueden anular/reactivar pedidos de hoy
        if (Autenticacion::isComercial()) {
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
        Autenticacion::requireRole('admin', 'logistica', 'comercial');
        $data = $this->getInput();

        // Eliminar items anteriores y re-crear
        $this->order->delete((int) $id);

        if (!empty($data['id_cliente']) && !empty($data['date'])) {
            $comercialId = isset($data['id_comercial']) ? (int) $data['id_comercial'] : null;
            $ccAprox = isset($data['cc_aprox']) ? (float) $data['cc_aprox'] : null;
            $idDireccion = isset($data['id_direccion']) ? (int) $data['id_direccion'] : null;

            $this->order->createOrUpdate(
                (int) $data['id_cliente'],
                $data['date'],
                $data['items'] ?? [],
                $data['notes'] ?? '',
                $comercialId,
                $ccAprox,
                $data['observaciones'] ?? null,
                'pendiente',
                $idDireccion
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
        Autenticacion::requireRole('admin', 'logistica');
        $clientId = $_GET['id_cliente'] ?? null;
        $date     = $_GET['date'] ?? null;

        if ($clientId && $date) {
            $this->order->deleteByClientAndDate((int) $clientId, $date);
            $this->json(['ok' => true]);
            return;
        }

        $this->json(['error' => 'id_cliente y date son obligatorios'], 400);
    }
}

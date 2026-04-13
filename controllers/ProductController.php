<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/Product.php';

class ProductController extends Controller
{
    private $product;

    public function __construct()
    {
        $this->product = new Product();
    }

    public function index()
    {
        Auth::requireRole('admin', 'logistica');
        $this->json($this->product->getAll());
    }

    public function store()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $id = $this->product->create($data);
        $this->json($this->product->getById($id), 201);
    }

    public function update($id)
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $this->product->update((int) $id, $data);
        $this->json($this->product->getById((int) $id));
    }

    public function destroy($id)
    {
        Auth::requireRole('admin');
        $this->product->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

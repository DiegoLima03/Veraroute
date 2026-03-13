<?php

require_once __DIR__ . '/../core/Controller.php';
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
        $this->json($this->product->getAll());
    }

    public function store()
    {
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $id = $this->product->create($data);
        $this->json($this->product->getById($id), 201);
    }

    public function update($id)
    {
        $data = $this->getInput();
        if (empty($data['name'])) {
            $this->json(['error' => 'Nombre es obligatorio'], 400);
        }
        $this->product->update((int) $id, $data);
        $this->json($this->product->getById((int) $id));
    }

    public function destroy($id)
    {
        $this->product->delete((int) $id);
        $this->json(['ok' => true]);
    }
}

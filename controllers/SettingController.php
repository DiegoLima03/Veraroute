<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Client.php';

class SettingController extends Controller
{
    private $client;

    public function __construct()
    {
        $this->client = new Client();
    }

    public function depot()
    {
        $depot = $this->client->getDepot();
        if (!$depot) {
            $this->json(['error' => 'No hay base configurada'], 404);
        }
        $this->json($depot);
    }

    public function updateDepot()
    {
        $data = $this->getInput();
        $this->client->updateDepot($data);
        $this->json($this->client->getDepot());
    }
}

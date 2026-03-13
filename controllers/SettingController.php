<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../models/Delegation.php';

class SettingController extends Controller
{
    private $delegation;

    public function __construct()
    {
        $this->delegation = new Delegation();
    }

    public function delegation()
    {
        $delegations = $this->delegation->getAll();
        if (!count($delegations)) {
            $this->json(['error' => 'No hay delegacion configurada'], 404);
            return;
        }
        $this->json($delegations[0]);
    }

    public function updateDelegation()
    {
        $data = $this->getInput();
        $delegations = $this->delegation->getAll();

        if (count($delegations)) {
            $this->delegation->update((int) $delegations[0]['id'], $data);
            $this->json($this->delegation->getById((int) $delegations[0]['id']));
        } else {
            $id = $this->delegation->create($data);
            $this->json($this->delegation->getById($id));
        }
    }
}

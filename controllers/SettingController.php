<?php

require_once __DIR__ . '/../core/Controller.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../models/Delegation.php';
require_once __DIR__ . '/../models/AppSetting.php';

class SettingController extends Controller
{
    private $delegation;
    private $settings;

    public function __construct()
    {
        $this->delegation = new Delegation();
        $this->settings = new AppSetting();
    }

    public function delegation()
    {
        Auth::requireRole('admin', 'logistica');
        $delegations = $this->delegation->getAll();
        if (!count($delegations)) {
            $this->json(['error' => 'No hay delegacion configurada'], 404);
            return;
        }
        $this->json($delegations[0]);
    }

    public function updateDelegation()
    {
        Auth::requireRole('admin');
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

    public function getSettings()
    {
        Auth::requireRole('admin', 'logistica');
        $this->json($this->settings->getAll());
    }

    public function updateSettings()
    {
        Auth::requireRole('admin');
        $data = $this->getInput();
        $allowed = ['lunch_duration_min', 'lunch_earliest', 'lunch_latest', 'base_unload_min', 'default_speed_kmh'];
        $toSave = [];
        foreach ($allowed as $key) {
            if (isset($data[$key])) {
                $toSave[$key] = (string) $data[$key];
            }
        }
        $this->settings->setMany($toSave);
        $this->json($this->settings->getAll());
    }
}

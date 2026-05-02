<?php

require_once __DIR__ . '/../core/Controlador.php';
require_once __DIR__ . '/../core/Autenticacion.php';
require_once __DIR__ . '/../models/Delegacion.php';
require_once __DIR__ . '/../models/Configuracion.php';

class ConfiguracionController extends Controlador
{
    private $delegation;
    private $settings;

    public function __construct()
    {
        $this->delegation = new Delegacion();
        $this->settings = new Configuracion();
    }

    public function delegation()
    {
        Autenticacion::requireRole('admin', 'logistica');
        $delegations = $this->delegation->getAll();
        if (!count($delegations)) {
            $this->json(['error' => 'No hay delegacion configurada'], 404);
            return;
        }
        $this->json($delegations[0]);
    }

    public function updateDelegation()
    {
        Autenticacion::requireRole('admin');
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
        Autenticacion::requireRole('admin', 'logistica');
        $this->json($this->settings->getAll());
    }

    public function updateSettings()
    {
        Autenticacion::requireRole('admin');
        $data = $this->getInput();
        $allowed = [
            'almuerzo_duracion_min', 'almuerzo_hora_min', 'almuerzo_hora_max',
            'descarga_min_base', 'velocidad_defecto_kmh',
            // Tiempos de parada por zona
            'parada_min_rural', 'parada_min_villa', 'parada_min_ciudad', 'parada_min_poligono',
            // Extra por volumen
            'parada_extra_2_3_cajas', 'parada_extra_carros',
            // Espera en tienda por tipo de negocio
            'espera_min_almacen', 'espera_min_tienda_especializada',
            'espera_min_tienda_centro', 'espera_min_cooperativa',
            // Multiplicadores por franja horaria
            'espera_mult_apertura', 'espera_mult_normal', 'espera_mult_punta',
            // L7: multiplicadores vespertinos
            'espera_mult_tarde_tranquila', 'espera_mult_tarde_punta', 'espera_mult_cierre',
            // Franjas horarias
            'franja_apertura_inicio', 'franja_apertura_fin',
            'franja_normal_inicio', 'franja_normal_fin',
            'franja_punta_inicio', 'franja_punta_fin',
            // L7: franjas vespertinas
            'franja_tarde_tranquila_inicio', 'franja_tarde_tranquila_fin',
            'franja_tarde_punta_inicio', 'franja_tarde_punta_fin',
            'franja_cierre_inicio', 'franja_cierre_fin',
            // Extra hora punta ciudad
            'parada_extra_hora_punta_ciudad',
        ];
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

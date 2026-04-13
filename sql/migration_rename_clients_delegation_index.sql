-- Renombrar el indice legacy `depot_id` en `clients`.
-- El flujo actual sale desde la delegacion de Tomino, pero la estructura
-- queda preparada para multidelegacion manteniendo el indice sobre
-- `delegation_id`.

ALTER TABLE `clients`
  RENAME INDEX `depot_id` TO `idx_clients_delegation_id`;

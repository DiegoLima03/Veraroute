<?php

require_once __DIR__ . '/../core/Model.php';

class AuditLog extends Model
{
    /**
     * Registra un cambio en el audit log.
     * $action: 'update_shipping_config', 'update_fuel_pct', 'update_vehicle_cost', etc.
     * $entity: nombre de la tabla afectada
     * $entityId: ID del registro
     * $oldValue: valor anterior (array o scalar)
     * $newValue: valor nuevo (array o scalar)
     */
    public static function log(string $action, ?string $entity = null, $entityId = null, $oldValue = null, $newValue = null): void
    {
        try {
            $user = null;
            if (class_exists('Auth')) {
                $user = Auth::currentUser();
            }
            $db = Database::connect();
            $db->prepare(
                'INSERT INTO audit_log (user_id, username, action, entity, entity_id, old_value, new_value, ip)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $user['id'] ?? null,
                $user['username'] ?? null,
                $action,
                $entity,
                $entityId !== null ? (string) $entityId : null,
                $oldValue !== null ? json_encode($oldValue, JSON_UNESCAPED_UNICODE) : null,
                $newValue !== null ? json_encode($newValue, JSON_UNESCAPED_UNICODE) : null,
                $_SERVER['REMOTE_ADDR'] ?? null,
            ]);
        } catch (\Throwable $e) {
            // No romper la operacion principal si falla el audit
            error_log('AuditLog error: ' . $e->getMessage());
        }
    }
}

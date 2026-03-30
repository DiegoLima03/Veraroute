# PROMPT ULTRADETALLADO - INTEGRACION MYGLS + COMPARATIVA DE COSTES EN VERAROUTE

Fecha de referencia: `2026-03-30`
Proyecto destino: `VeraRoute`
Stack actual: `PHP clasico + MySQL + JS vanilla + Leaflet + OSRM`

---

## Objetivo de este archivo

Este documento desarrolla y amplifica la idea original del prompt de integracion GLS para VeraRoute. No es una simple lista de tareas: es una especificacion funcional y tecnica lista para pasarse a otra IA o a un desarrollador para implementar la feature con criterio, minimizando suposiciones y aterrizando la solucion sobre el codigo real del proyecto.

El tono del prompt esta orientado a implementacion real sobre la base actual, no a una demo aislada ni a una reescritura completa.

---

## Prompt listo para usar

```md
Quiero que actues como arquitecto tecnico y desarrollador senior sobre una aplicacion existente llamada VeraRoute. Tu trabajo no es proponer una idea vaga, sino disenar e implementar una integracion realista, incremental y segura entre VeraRoute y MyGLS Spain para comparar el coste de servir un cliente con ruta propia frente al coste estimado de externalizar ese envio a GLS.

Debes trabajar sobre el codigo existente, respetando la arquitectura actual y evitando inventarte capas o modulos que no encajen con el proyecto. No simplifiques la aplicacion a un CRUD generico. Asume que el objetivo final es que el equipo de administracion/logistica pueda decidir, cliente a cliente y dia a dia, si compensa mas mantener una entrega en ruta propia o sacarla fuera a GLS.

Tu salida debe ser extremadamente practica y ejecutable. Si en algun punto detectas un detalle del prompt que no encaja exactamente con el codigo real, no lo ignores: adaptalo de forma explicita y documenta la decision.

## 0. Modo de trabajo obligatorio

Antes de tocar codigo debes inspeccionar y comprender, como minimo, estos archivos del proyecto:

1. `index.php`
2. `core/Auth.php`
3. `controllers/SettingController.php`
4. `controllers/ClientController.php`
5. `controllers/HojaRutaController.php`
6. `controllers/RouteController.php`
7. `models/AppSetting.php`
8. `models/Client.php`
9. `models/HojaRuta.php`
10. `models/Vehicle.php`
11. `models/DistanceCache.php`
12. `models/RoutePlan.php`
13. `views/app.php`
14. `public/js/app.js`
15. `sql/schema.sql`
16. `sql/migration_hojas_ruta.sql`

No debes asumir nombres de columnas que no existan realmente sin verificar. Por ejemplo:

1. En `vehicles` el coste actual esta en `cost_per_km`, no en `coste_por_km`.
2. En hojas de ruta el trabajo actual usa `carros` y `cajas`; `cc_aprox` existe como legado.
3. El sistema global de configuracion ya usa `app_settings`.
4. El proyecto ya dispone de una capa de cache de distancias en `models/DistanceCache.php`.
5. El proyecto ya tiene un modal de Settings y un patron de tabs en `views/app.php` + `public/js/app.js`.

Tu implementacion debe reutilizar todo eso siempre que sea razonable.

## 1. Contexto funcional real de VeraRoute

VeraRoute tiene dos motores operativos distintos que conviven en la misma aplicacion:

1. Motor de optimizacion multi-vehiculo:
   - pedidos del dia
   - asignacion a vehiculos
   - planes en `route_plans`
   - paradas en `route_stops`
   - mapa y panel de rutas

2. Motor de hojas de ruta comerciales:
   - hoja diaria por ruta comercial en `hojas_ruta`
   - lineas por cliente en `hoja_ruta_lineas`
   - cantidades por `carros` y `cajas`
   - estados `borrador`, `cerrada`, `en_reparto`, `completada`

La comparativa GLS de esta iteracion debe centrarse principalmente en el motor de hojas de ruta, porque es donde hoy se esta decidiendo cliente a cliente que se carga y que no se carga en una ruta diaria manual/comercial.

No obstante, el prompt debe dejar preparada la base conceptual para poder extender esa comparativa mas adelante al motor de optimizacion multi-vehiculo.

## 2. Objetivo de negocio de la nueva feature

Quiero incorporar un modulo de comparativa de costes que permita, para cada cliente con carga real en una hoja de ruta del dia, ver:

1. Coste estimado de servirlo en ruta propia.
2. Coste estimado de enviarlo mediante GLS.
3. Diferencia economica entre ambas opciones.
4. Recomendacion automatica:
   - `own_route`
   - `externalize`
   - `break_even`

La regla de negocio central es:

`coste_ruta_propia = km_desvio_marginal * cost_per_km_del_vehiculo`

Donde `km_desvio_marginal` significa:

1. Tomar la secuencia completa de la hoja del dia:
   `delegacion -> cliente_1 -> cliente_2 -> ... -> cliente_n -> delegacion`
2. Medir su distancia total.
3. Eliminar un cliente concreto de la secuencia.
4. Volver a medir la distancia total.
5. Restar ambas distancias.

No es un reparto proporcional, no es un promedio por parada, y no es una formula lineal simplificada. Es una comparativa marginal real sobre la secuencia de ruta.

## 3. Donde debe aparecer la comparativa

La comparativa debe aparecer en estos puntos concretos de VeraRoute:

1. En un tab nuevo llamado `Rentabilidad` visible solo para `admin` y `logistica`.
2. En el detalle de hoja de ruta de admin/logistica, como informacion adicional por linea.
3. En la ficha o modal de cliente, como historico por fechas.
4. En la impresion de hoja de ruta, de forma condicional cuando existan datos calculados.

Importante:

1. La vista `comercial` no debe ver ni tab de rentabilidad ni columnas GLS.
2. La falta de respuesta de GLS no puede bloquear la operativa normal.
3. La comparativa es de soporte a decision, no un requisito para crear, editar o cerrar una hoja.

## 4. Restricciones de arquitectura

Debes seguir la arquitectura actual del proyecto:

1. Backend PHP clasico.
2. Router manual en `index.php`.
3. Modelos en `models/`.
4. Controladores en `controllers/`.
5. Logica de servicios en `services/`.
6. Vista principal server-rendered en `views/app.php`.
7. Logica UI centralizada en `public/js/app.js`.

No introduzcas frameworks nuevos.
No metas librerias JS adicionales.
No migres la app a SPA moderna.
No uses llamadas GLS desde frontend.
No hardcodes credenciales.

## 5. Alcance exacto de implementacion

La implementacion debe incluir estas 10 piezas:

1. Migracion SQL para tablas y columnas nuevas.
2. Modelo de configuracion GLS.
3. Modelo de historico de costes por cliente.
4. Servicio PHP de acceso a API MyGLS.
5. Servicio PHP de calculo de coste de ruta propia.
6. Controlador PHP especifico para GLS/costes.
7. Integracion con cliente para guardar `postcode`.
8. Tab de rentabilidad en la UI.
9. Integracion con detalle de hoja y ficha de cliente.
10. Extension de impresion de hoja.

## 6. Diseno de base de datos

### 6.1 Tabla `gls_shipping_config`

Crear una tabla de configuracion propia de GLS porque:

1. Tiene varias claves relacionadas entre si.
2. Incluye credenciales.
3. Incluye multiplicador de tarifa.
4. Incluye pesos por defecto por unidad logistica.

Usar una sola fila logica (`id = 1`).

DDL propuesto:

```sql
CREATE TABLE IF NOT EXISTS `gls_shipping_config` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `api_user` VARCHAR(100) NOT NULL DEFAULT '',
  `api_password` VARCHAR(150) NOT NULL DEFAULT '',
  `api_env` ENUM('test','production') NOT NULL DEFAULT 'test',
  `origin_postcode` VARCHAR(10) NOT NULL DEFAULT '',
  `origin_country` CHAR(2) NOT NULL DEFAULT 'ES',
  `price_multiplier` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `default_weight_per_carro_kg` DECIMAL(8,2) NOT NULL DEFAULT 5.00,
  `default_weight_per_caja_kg` DECIMAL(8,2) NOT NULL DEFAULT 2.50,
  `default_service` VARCHAR(50) NOT NULL DEFAULT 'BusinessParcel',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `gls_shipping_config` (`id`) VALUES (1);
```

### 6.2 Tabla `gls_rate_cache`

Debe cachear cotizaciones por destino y peso para no golpear la API innecesariamente.

DDL propuesto:

```sql
CREATE TABLE IF NOT EXISTS `gls_rate_cache` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cache_key` VARCHAR(64) NOT NULL,
  `dest_postcode` VARCHAR(10) NOT NULL,
  `dest_country` CHAR(2) NOT NULL DEFAULT 'ES',
  `weight_kg` DECIMAL(10,2) NOT NULL,
  `num_parcels` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `service_code` VARCHAR(50) NOT NULL DEFAULT 'BusinessParcel',
  `gls_price_raw` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `currency` CHAR(3) NOT NULL DEFAULT 'EUR',
  `api_response_json` LONGTEXT NULL,
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gls_rate_cache_key` (`cache_key`),
  KEY `idx_gls_rate_cache_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 6.3 Tabla `client_cost_history`

Debe guardar historico por cliente y fecha para auditoria y analisis.

DDL propuesto:

```sql
CREATE TABLE IF NOT EXISTS `client_cost_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `hoja_ruta_id` INT UNSIGNED NULL,
  `route_plan_id` INT UNSIGNED NULL,
  `fecha` DATE NOT NULL,
  `carros` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `cajas` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `weight_kg` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `num_parcels` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `detour_km` DECIMAL(10,3) NOT NULL DEFAULT 0,
  `vehicle_cost_per_km` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_own_route` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_gls_raw` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `cost_gls_adjusted` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `price_multiplier_used` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `recommendation` ENUM('own_route','externalize','break_even','unavailable') NOT NULL DEFAULT 'unavailable',
  `savings_if_externalized` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `gls_service` VARCHAR(50) NOT NULL DEFAULT '',
  `notes` VARCHAR(255) NOT NULL DEFAULT '',
  `calculated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_hoja_fecha` (`client_id`, `hoja_ruta_id`, `fecha`),
  KEY `idx_client_cost_history_client_fecha` (`client_id`, `fecha`),
  KEY `idx_client_cost_history_fecha` (`fecha`),
  CONSTRAINT `fk_cch_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 6.4 Alter de `clients`

Hay que anadir `postcode` a cliente porque hoy no existe en el modelo.

Preferencia:

```sql
ALTER TABLE `clients`
  ADD COLUMN IF NOT EXISTS `postcode` VARCHAR(10) NOT NULL DEFAULT ''
  AFTER `address`;
```

Si la version de MySQL del WAMP real no soporta `ADD COLUMN IF NOT EXISTS`, implementa la migracion con una comprobacion previa contra `INFORMATION_SCHEMA.COLUMNS`.

### 6.5 Alter de `hoja_ruta_lineas`

Guardar el resultado calculado por linea acelera render y evita recalculos innecesarios.

```sql
ALTER TABLE `hoja_ruta_lineas`
  ADD COLUMN IF NOT EXISTS `detour_km` DECIMAL(10,3) NULL AFTER `orden_descarga`,
  ADD COLUMN IF NOT EXISTS `cost_own_route` DECIMAL(10,4) NULL AFTER `detour_km`,
  ADD COLUMN IF NOT EXISTS `cost_gls_raw` DECIMAL(10,4) NULL AFTER `cost_own_route`,
  ADD COLUMN IF NOT EXISTS `cost_gls_adjusted` DECIMAL(10,4) NULL AFTER `cost_gls_raw`,
  ADD COLUMN IF NOT EXISTS `gls_recommendation` ENUM('own_route','externalize','break_even','unavailable') NULL AFTER `cost_gls_adjusted`,
  ADD COLUMN IF NOT EXISTS `gls_service` VARCHAR(50) NULL AFTER `gls_recommendation`,
  ADD COLUMN IF NOT EXISTS `gls_notes` VARCHAR(255) NULL AFTER `gls_service`;
```

## 7. Servicio PHP `services/GlsApiClient.php`

### 7.1 Responsabilidad

Este servicio debe encapsular toda la comunicacion con MyGLS Spain. Ningun controlador ni modelo debe hablar con GLS directamente.

### 7.2 Requisitos tecnicos

1. Usar `cURL`, no `file_get_contents`.
2. Leer configuracion desde `gls_shipping_config`, nunca hardcodear.
3. Tener timeout de 10 segundos.
4. Nunca lanzar una excepcion sin capturar hacia arriba.
5. Retornar siempre arrays consistentes con `success => true|false`.
6. Cachear las respuestas satisfactorias en `gls_rate_cache`.

### 7.3 Firma recomendada

```php
public function getShippingRate(array $params): array
```

Payload esperado:

```php
[
  'dest_postcode' => '36700',
  'dest_country'  => 'ES',
  'weight_kg'     => 12.50,
  'num_parcels'   => 3,
  'service'       => 'BusinessParcel',
]
```

Salida de exito:

```php
[
  'success'      => true,
  'price_raw'    => 8.50,
  'service'      => 'BusinessParcel',
  'currency'     => 'EUR',
  'raw_response' => [...],
  'from_cache'   => false,
]
```

Salida de error:

```php
[
  'success'    => false,
  'error'      => 'Mensaje descriptivo',
  'price_raw'  => 0,
  'service'    => '',
  'currency'   => 'EUR',
  'from_cache' => false,
]
```

### 7.4 Politica de cache

Construir `cache_key` como:

```php
hash('sha256', implode('|', [
  $dest_postcode,
  $dest_country,
  number_format($weight_kg, 2, '.', ''),
  (int) $num_parcels,
  $service,
]))
```

TTL recomendada:

1. 24 horas para cotizaciones GLS.
2. Si cambia `price_multiplier`, no hace falta invalidar el cache bruto.
3. El multiplicador se aplica despues.

### 7.5 Conexion de prueba

Implementar:

```php
public function testConnection(): array
```

Debe hacer una cotizacion de prueba minima y devolver:

```php
[
  'success' => true,
  'message' => 'Conexion OK',
  'sample'  => [...],
  'response_time_ms' => 431,
]
```

## 8. Servicio PHP `services/RouteCostCalculator.php`

### 8.1 Responsabilidad

Este servicio debe calcular el coste de ruta propia y enriquecer las lineas de una hoja.

No debe encargarse de permisos HTTP ni de render.
Si necesita distancias debe reutilizar `models/DistanceCache.php`.

### 8.2 Principio de calculo

Solo se calculan lineas con carga real:

1. `carros > 0`
2. o `cajas > 0`

Las lineas a cero no deben computar en esta feature, porque la propia aplicacion ya trata como "no creada" una hoja sin actividad real.

### 8.3 Metodo principal de desviacion

Firma sugerida:

```php
public function calculateDetourKm(int $clientId, int $hojaRutaId): float
```

Pasos:

1. Obtener hoja por id con vehiculo asignado.
2. Si no hay vehiculo asignado:
   - retornar 0
   - o marcar `unavailable` segun convenga en la capa superior
3. Obtener vehiculo.
4. Obtener delegacion del vehiculo.
5. Obtener lineas activas de la hoja ordenadas por `orden_descarga` y como fallback por `id`.
6. Construir secuencia:
   - punto inicial delegacion
   - clientes de la hoja
   - punto final delegacion
7. Calcular distancia total usando `DistanceCache`.
8. Repetir quitando el cliente objetivo.
9. Retornar la diferencia positiva.

### 8.4 Como calcular la distancia

No repliques logica de cache a mano. Debes usar el modelo existente `DistanceCache`.

Preferencia:

1. Si necesitas el total de una secuencia completa, recorre segmentos consecutivos y usa `getOrFetch(...)`.
2. Si te interesa optimizar una secuencia larga, puedes apoyarte en `buildMatrix(...)`, pero solo si simplifica.

### 8.5 Orquestador completo

Firma sugerida:

```php
public function calculateAndSave(int $hojaRutaId, bool $forceRecalc = false): array
```

Pasos por linea:

1. Ignorar lineas sin `carros` ni `cajas`.
2. Si no hay `postcode`, marcar recomendacion `unavailable`.
3. Si no hay vehiculo o vehiculo sin `cost_per_km`, marcar `unavailable`.
4. Calcular `detour_km`.
5. Leer `cost_per_km` del vehiculo.
6. Calcular `cost_own_route`.
7. Calcular peso:
   - `carros * default_weight_per_carro_kg`
   - `+ cajas * default_weight_per_caja_kg`
8. Calcular numero de bultos:
   - `max(1, carros + cajas)`
   - redondeando hacia arriba si hubiera decimales
9. Pedir tarifa GLS.
10. Aplicar multiplicador:
    - `cost_gls_adjusted = cost_gls_raw * price_multiplier`
11. Determinar recomendacion:
    - `own_route` si propia es claramente mas barata
    - `externalize` si GLS es claramente mas barata
    - `break_even` si la diferencia relativa esta por debajo del 5 por ciento
    - `unavailable` si no pudo calcularse algo critico
12. Guardar resultado en `hoja_ruta_lineas`.
13. Hacer `upsert` en `client_cost_history`.

Resumen de salida deseado:

```php
[
  'processed' => 12,
  'skipped_zero_load' => 4,
  'skipped_no_postcode' => 2,
  'gls_errors' => 1,
  'unavailable' => 2,
  'recommend_own' => 6,
  'recommend_externalize' => 3,
  'recommend_break_even' => 1,
  'total_own_cost' => 43.20,
  'total_gls_cost' => 31.10,
  'potential_savings_if_externalized' => 12.10,
]
```

## 9. Modelos nuevos

### 9.1 `models/GlsShippingConfig.php`

Metodos recomendados:

1. `getConfig(): array`
2. `updateConfig(array $data): bool`
3. `getMultiplier(): float`
4. `getWeightsPerUnit(): array`
5. `hasPassword(): bool`

### 9.2 `models/ClientCostHistory.php`

Metodos recomendados:

1. `upsert(array $data): bool`
2. `getForClient(int $clientId, int $limit = 30): array`
3. `getForDate(string $date): array`
4. `getForHoja(int $hojaRutaId): array`
5. `getDailySummary(string $date): array`

## 10. Controlador `controllers/GlsCostController.php`

Registrar en `index.php` rutas nuevas, siguiendo el patron actual del router:

```text
GET    /api/gls-config
PUT    /api/gls-config
POST   /api/gls-config/test
POST   /api/gls-costs/calculate
GET    /api/gls-costs/hoja/{id}
GET    /api/gls-costs/client/{id}
GET    /api/gls-costs/daily-report
POST   /api/gls-costs/recalculate
```

### 10.1 Permisos

1. `getConfig` y `testConnection`: solo `admin`.
2. `updateConfig`: solo `admin`.
3. `calculateForHoja`: `admin` y `logistica`.
4. `getCostsForHoja`: `admin` y `logistica`.
5. `getClientHistory`: `admin` y `logistica`.
6. `getDailyReport`: `admin` y `logistica`.
7. `recalculateAll`: solo `admin`.

Debes reutilizar el sistema de autenticacion actual:

1. `Auth::requireLogin()`
2. comprobacion de rol con el patron ya usado en el proyecto

### 10.2 Contratos

#### `GET /api/gls-config`

No devolver nunca la password en claro.

Respuesta:

```json
{
  "api_user": "miusuario",
  "api_password": "***",
  "api_env": "test",
  "origin_postcode": "36780",
  "origin_country": "ES",
  "price_multiplier": "0.8500",
  "default_weight_per_carro_kg": "5.00",
  "default_weight_per_caja_kg": "2.50",
  "default_service": "BusinessParcel"
}
```

#### `PUT /api/gls-config`

Si `api_password` viene como `***`, conservar la actual.
Validaciones:

1. `price_multiplier` entre `0.10` y `2.00`
2. pesos mayores o iguales que `0`
3. `origin_country` en 2 caracteres

#### `POST /api/gls-config/test`

Debe permitir probar conexion sin recalcular nada de la app.

#### `POST /api/gls-costs/calculate`

Entrada:

```json
{
  "hoja_ruta_id": 123,
  "force": false
}
```

#### `GET /api/gls-costs/hoja/{id}`

Debe devolver lineas enriquecidas.

Ejemplo:

```json
[
  {
    "linea_id": 55,
    "client_id": 2729,
    "client_name": "Agro Carlos",
    "client_postcode": "36700",
    "carros": 2,
    "cajas": 1,
    "detour_km": 4.800,
    "cost_own_route": 2.4000,
    "cost_gls_raw": 6.0000,
    "cost_gls_adjusted": 5.1000,
    "recommendation": "own_route",
    "savings": -2.7000,
    "gls_service": "BusinessParcel",
    "postcode_missing": false,
    "notes": ""
  }
]
```

#### `GET /api/gls-costs/daily-report?date=YYYY-MM-DD`

Debe devolver resumen + detalle.

## 11. Integracion con cliente (`postcode`)

### 11.1 Backend

Actualizar `models/Client.php` y `controllers/ClientController.php` para:

1. leer `postcode`
2. guardar `postcode`
3. incluirlo en listados y detalle

### 11.2 Frontend

En el modal de cliente actual:

1. anadir el campo justo debajo de `address`
2. label: `Codigo postal (GLS)`
3. placeholder: `ej. 36700`
4. validacion suave:
   - numeros o alfanumerico corto
   - maximo 10 caracteres
5. aviso visual si esta vacio:
   - `Sin codigo postal no se puede cotizar GLS`

## 12. Integracion con Settings

La app ya tiene:

1. modal `settingsModal` en `views/app.php`
2. carga con `openSettingsModal()` en `public/js/app.js`
3. guardado con `saveSettings()`
4. backend en `SettingController` + `AppSetting`

La nueva seccion GLS debe integrarse sin romper eso.

### 12.1 Decisiones de implementacion

1. No mezclar credenciales GLS en `app_settings`.
2. Mantener `gls_shipping_config` como tabla propia.
3. Extender el modal de Settings actual con un bloque adicional llamado `Integracion GLS`.

### 12.2 Campos UI

1. Usuario API MyGLS
2. Password API MyGLS
3. Entorno test/produccion
4. Codigo postal origen
5. Pais origen
6. Multiplicador de precio
7. Peso por carro
8. Peso por caja
9. Servicio por defecto
10. Boton `Probar conexion`

### 12.3 Comportamiento UI

1. Al abrir Settings, cargar settings normales y config GLS en paralelo.
2. Si falla GLS config, no bloquear el modal completo.
3. El boton `Guardar` debe guardar settings generales y GLS.
4. El boton `Probar conexion` debe probar solo GLS.
5. Mostrar resultado inline con verde/rojo.

## 13. Tab nuevo `Rentabilidad`

### 13.1 Visibilidad

Visible solo para:

1. `admin`
2. `logistica`

No visible para:

1. `comercial`

### 13.2 Integracion con tabs actuales

La app hoy tiene tabs:

1. Clientes
2. Hojas Ruta
3. Flota
4. Historial
5. Usuarios solo admin

Debes insertar `Rentabilidad` sin romper el sistema de `switchTab(...)`.

### 13.3 Contenido del tab

Barra superior:

1. selector de fecha
2. boton `Calcular / Recalcular`
3. estado del ultimo calculo

Resumen:

1. Total clientes evaluados
2. Recomendados en ruta propia
3. Candidatos a externalizar
4. Ahorro potencial

Tabla principal:

1. Cliente
2. CP
3. Ruta
4. Vehiculo
5. Carros
6. Cajas
7. Km desvio
8. Coste propio
9. Coste GLS
10. Diferencia
11. Recomendacion
12. Estado de calculo

### 13.4 Reglas visuales

1. Verde si `own_route`
2. Naranja si `externalize`
3. Gris si `unavailable`
4. Badge neutro para `break_even`

### 13.5 Casos especiales

1. Sin CP -> icono de aviso
2. Error GLS -> icono de error
3. Hoja sin vehiculo -> `No calculable`
4. Linea sin carga -> no debe aparecer

## 14. Integracion con detalle de hoja

La UI actual del detalle de hoja no es una tabla clasica; renderiza tarjetas/listas en `public/js/app.js`.

Por eso no debes forzar una maqueta que contradiga el render actual. Debes adaptar la comparativa al formato existente.

### 14.1 Para admin/logistica

Anadir en cada linea un bloque secundario con:

1. `Km desvio`
2. `Coste propio`
3. `Coste GLS`
4. `Recomendacion`

Y un boton a nivel de cabecera:

`Calcular costes GLS`

### 14.2 Comportamiento

1. Si no hay datos aun, no mostrar columnas vacias gigantes.
2. Si se calcula, refrescar solo el detalle de la hoja si es posible.
3. No recargar toda la app.
4. No tocar la vista comercial.

## 15. Historico en ficha de cliente

En el modal de cliente actual debes anadir una seccion:

`Historial GLS`

Contenido:

1. ultimas 10 o 30 entradas
2. fecha
3. carros
4. cajas
5. km desvio
6. coste propio
7. coste GLS
8. recomendacion

Si no hay datos:

`Sin historial de comparativa GLS todavia.`

## 16. Impresion de hoja

Extender `GET /api/hojas-ruta/{id}/imprimir` y su HTML de impresion.

Solo si existen datos calculados:

1. anadir columna `Coste propio`
2. anadir columna `Coste GLS`
3. anadir columna `Decision`

Pie opcional:

```
CLIENTES CANDIDATOS A EXTERNALIZAR
- Cliente X - ahorro potencial 3,80 EUR
- Cliente Y - ahorro potencial 5,20 EUR
Total ahorro potencial diario: 9,00 EUR
```

Si no hay datos calculados, imprimir exactamente como hoy.

## 17. Compatibilidad con reglas actuales de hojas de ruta

Debes respetar estas reglas ya vigentes en VeraRoute:

1. Una hoja con `0 carros` y `0 cajas` no debe contarse como hoja real en listados del dia.
2. Las lineas precargadas para comercial con cantidad `0` existen operativamente, pero no deben computar como clientes activos ni para resumen ni para comparativa GLS.
3. Para cerrar hoja ya se exige vehiculo asignado.
4. El autoordenar ya considera salida y vuelta a delegacion.

La comparativa GLS debe alinearse con esas reglas.

## 18. Manejo de errores y degradacion elegante

La feature debe degradar bien.

### 18.1 Si GLS falla

1. No bloquear hojas.
2. Guardar `unavailable` o nota de error.
3. Mostrar aviso, no excepcion cruda.

### 18.2 Si falta postcode

1. No calcular GLS.
2. Permitir calcular coste propio si hay vehiculo.
3. Marcar `gls_notes = 'postcode_missing'` o equivalente.

### 18.3 Si falta vehiculo

1. No calcular coste propio.
2. No impedir ver la hoja.
3. Marcar como `unavailable`.

### 18.4 Si no hay coste por km

1. Tratar como no calculable.
2. No asumir cero silenciosamente.

## 19. Rendimiento

### 19.1 No recalcular todo siempre

Si una linea ya tiene coste y no se ha pedido `force`, puedes reutilizarla salvo que:

1. haya cambiado el vehiculo de la hoja
2. haya cambiado `carros` o `cajas`
3. haya cambiado el orden de descarga
4. haya cambiado el multiplicador y necesites recalcular la parte GLS ajustada

### 19.2 Estrategia recomendada

1. Guardar en linea el resultado calculado.
2. Guardar historico aparte.
3. Recalcular por hoja cuando se pulse el boton.
4. Ofrecer recalculo masivo por fecha solo para admin.

## 20. Seguridad

1. Ninguna credencial GLS en JS.
2. Ninguna password GLS de vuelta al cliente en claro.
3. Endpoints protegidos por login y rol.
4. Sanitizar y validar todos los payloads.

## 21. Testing minimo esperado

Debes dejar lista una verificacion minima funcional:

1. Migracion ejecuta sin romper instalaciones ya migradas.
2. Settings GLS se guardan y recuperan.
3. Test de conexion responde correctamente.
4. Cliente guarda `postcode`.
5. Calculo por hoja procesa solo lineas con carga.
6. Sin `postcode` se marca como no cotizable.
7. Sin vehiculo se marca como no calculable.
8. Tab rentabilidad carga y pinta datos.
9. Impresion de hoja no se rompe si no hay datos GLS.

## 22. Criterios de aceptacion

La feature se considera terminada solo si se cumplen todos estos puntos:

1. Existe una migracion idempotente para GLS.
2. El proyecto puede almacenar credenciales GLS y parametros de calculo.
3. Se puede probar conexion GLS desde Settings.
4. Cada cliente puede tener `postcode`.
5. Se puede calcular la comparativa para una hoja del dia.
6. Se guarda resultado por linea y en historico.
7. Existe una vista global de rentabilidad por fecha.
8. El detalle de hoja muestra la comparativa sin afectar a comercial.
9. La ficha de cliente muestra historico.
10. La impresion de hoja incluye costes solo cuando existen.

## 23. No objetivos de esta iteracion

No hacer ahora:

1. Generacion automatica de etiquetas GLS.
2. Creacion real de expediciones GLS.
3. Tracking GLS.
4. Sincronizacion de estados GLS.
5. Facturacion avanzada.
6. Reescritura del motor multi-vehiculo.
7. Cambios en login, roles o sesiones.

## 24. Entregables finales esperados

Nuevos archivos:

```text
sql/migration_gls_costs.sql
models/GlsShippingConfig.php
models/ClientCostHistory.php
services/GlsApiClient.php
services/RouteCostCalculator.php
controllers/GlsCostController.php
```

Archivos a modificar:

```text
index.php
models/Client.php
models/HojaRuta.php
controllers/ClientController.php
controllers/HojaRutaController.php
views/app.php
public/js/app.js
```

## 25. Formato de respuesta que debes producir

Quiero que tu respuesta final venga en este orden:

1. Resumen ejecutivo del enfoque.
2. Lista exacta de archivos nuevos y modificados.
3. SQL de migracion.
4. Implementacion de modelos.
5. Implementacion de servicios.
6. Implementacion del controlador y rutas.
7. Cambios de frontend.
8. Riesgos y decisiones tomadas.
9. Pasos de verificacion.

No me des solo ideas. Quiero una propuesta de implementacion concreta, adaptada al proyecto real.
```

---

## Notas para quien use este prompt

Este prompt ya viene ajustado al codigo real de VeraRoute a fecha `2026-03-30`, especialmente en estos puntos:

1. El router actual vive en [index.php](c:/wamp64/www/Gestor%20de%20Rutas/index.php).
2. Las hojas de ruta viven en [models/HojaRuta.php](c:/wamp64/www/Gestor%20de%20Rutas/models/HojaRuta.php).
3. La cache de distancias OSRM ya existe en [models/DistanceCache.php](c:/wamp64/www/Gestor%20de%20Rutas/models/DistanceCache.php).
4. La configuracion actual de la app vive en [models/AppSetting.php](c:/wamp64/www/Gestor%20de%20Rutas/models/AppSetting.php) y [controllers/SettingController.php](c:/wamp64/www/Gestor%20de%20Rutas/controllers/SettingController.php).
5. El modal de Settings y el patron de tabs estan en [views/app.php](c:/wamp64/www/Gestor%20de%20Rutas/views/app.php) y [public/js/app.js](c:/wamp64/www/Gestor%20de%20Rutas/public/js/app.js).
6. El coste por km del vehiculo usa el nombre real `cost_per_km` en [models/Vehicle.php](c:/wamp64/www/Gestor%20de%20Rutas/models/Vehicle.php).

Tambien he limpiado el problema de codificacion que tenia la version anterior del archivo, para que este prompt ya quede reutilizable tal cual.


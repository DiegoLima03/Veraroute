# PROMPT ULTRADETALLADO - FUNCIONAMIENTO ACTUAL DE VERAROUTE

Fecha de referencia del estado descrito: `2026-03-30`

Este archivo esta pensado para copiarse y pegarse como prompt de contexto a otra IA o como documento maestro de referencia funcional. El objetivo es describir con el mayor nivel posible de detalle el flujo actual de la aplicacion, sus modulos, reglas de negocio, entidades y comportamientos vigentes segun el codigo actual del proyecto.

---

## Prompt listo para usar

```md
Quiero que actues como analista funcional y tecnico senior de una aplicacion PHP + JavaScript llamada VeraRoute. Necesito que entiendas y describas la aplicacion tal y como funciona HOY, no como podria funcionar idealmente ni como estaba en versiones anteriores.

Tu fuente de verdad conceptual es este contexto. No asumas modulos no descritos, no inventes tablas ni permisos, y no sustituyas reglas actuales por interpretaciones mas simples. Si detectas tensiones entre logica legacy y logica nueva, debes explicarlas como convivencia entre comportamientos y no como contradiccion abstracta.

## 1. Identidad del producto

La aplicacion se llama VeraRoute y sirve para gestionar:

1. La cartera de clientes y sus datos logistico-comerciales.
2. Los pedidos diarios asociados a clientes.
3. La optimizacion de rutas multi-vehiculo basada en pedidos.
4. Las hojas de ruta diarias por ruta comercial.
5. La operativa de usuarios comerciales, logistica y administracion.
6. La flota (delegaciones y vehiculos).
7. El historial de rutas optimizadas y un dashboard agregado.
8. Las plantillas reutilizables de rutas.

Hay dos grandes motores operativos dentro de la misma aplicacion:

1. El motor de optimizacion de rutas "fleet/multi-vehicle", basado en pedidos (`orders`, `route_plans`, `route_stops`).
2. El motor de "hojas de ruta" manual/comercial, basado en rutas comerciales y en lineas de hoja (`hojas_ruta`, `hoja_ruta_lineas`).

Ambos conviven en la misma UI y comparten clientes, delegaciones, vehiculos y parte del mapa, pero no son exactamente el mismo flujo.

## 2. Stack y arquitectura

La arquitectura actual es:

1. Backend PHP clasico con enrutado propio.
2. Frontend server-rendered con una sola vista principal y mucha logica en `public/js/app.js`.
3. Base de datos MySQL.
4. Mapa con Leaflet.
5. Calculo de rutas por carretera usando OSRM desde frontend y backend.

Piezas clave:

1. `index.php` centraliza el router y expone todas las rutas web/API.
2. `login.php` resuelve la autenticacion y el bloqueo por intentos fallidos.
3. `views/app.php` monta la interfaz principal segun el rol.
4. `public/js/app.js` contiene la mayor parte del comportamiento de UI, sincronizacion, mapa y flujos operativos.
5. Los controladores PHP resuelven logica de negocio por modulo.
6. Los modelos encapsulan acceso a datos.

## 3. Sistema de autenticacion y sesion

El login funciona asi:

1. El usuario entra por `login.php`.
2. Se consulta `app_users`.
3. Solo pueden entrar usuarios `active = 1`.
4. La contrasena se valida con `password_verify` sobre `pass_hash`.
5. Si el login falla se incrementa `failed_logins`.
6. A partir de 5 intentos fallidos el usuario queda bloqueado (`locked = 1`).
7. Si el login es correcto:
   - se resetea `failed_logins`
   - se guarda `last_login_at`
   - se guarda `last_login_ip`
   - se regenera la sesion
   - se guarda en sesion `id`, `username`, `full_name`, `role`, `comercial_id`

La sesion se exige en toda la app principal desde `index.php` mediante `Auth::requireLogin()`.

## 4. Roles existentes

Los roles actuales son exactamente:

1. `admin`
2. `logistica`
3. `comercial`

### 4.1 Admin

Tiene acceso a:

1. Clientes
2. Hojas de ruta
3. Flota
4. Historial
5. Gestion de usuarios
6. Mapa y panel de rutas optimizadas
7. Settings y plantillas

### 4.2 Logistica

Tiene acceso a:

1. Clientes
2. Hojas de ruta
3. Flota
4. Historial
5. Mapa y panel de rutas optimizadas
6. Settings y plantillas

No tiene modulo de usuarios.

### 4.3 Comercial

Tiene una vista completamente distinta:

1. No ve tabs generales.
2. No ve mapa principal.
3. Trabaja solo en el flujo de hojas de ruta comerciales.
4. Solo puede ver clientes asociados a sus comerciales.
5. Sus rutas visibles dependen de los comerciales asociados al usuario.
6. Puede trabajar por fecha.
7. Puede crear o reutilizar hojas de ruta de sus rutas permitidas.
8. Puede editar solo cantidades (`carros`, `cajas`) de sus lineas.

## 5. Modelo de usuarios comerciales

Un usuario comercial puede estar vinculado a uno o varios comerciales reales. Esa relacion se resuelve por dos vias:

1. `app_users.comercial_id` como compatibilidad simple.
2. `user_comerciales` como tabla intermedia para multiples asociaciones.

La app usa `Auth::comercialIds()` para consolidar ambos mecanismos y devolver el conjunto final de IDs de comerciales asociados al usuario actual.

Consecuencia funcional:

1. Un usuario comercial puede operar sobre varios comerciales reales.
2. La visibilidad de clientes y hojas depende de esas asociaciones.

## 6. Vista principal por rol

### 6.1 Comercial

La vista comercial tiene:

1. Header con nombre y rol.
2. Selector de fecha.
3. Listado principal de hojas/rutas.
4. Vista detalle de hoja sin mapa principal.

En su listado principal aparecen dos bloques:

1. `Crear hoja de ruta`
2. `Mis hojas de hoy`

Ademas existe un buscador rapido de clientes en la parte superior del listado comercial:

1. Busca por nombre, direccion o ruta.
2. Muestra sugerencias de clientes permitidos.
3. Permite escribir directamente `carros` y `cajas`.
4. Si se introducen cantidades, crea o reutiliza automaticamente la hoja de ruta correspondiente.

### 6.2 Admin y logistica

Comparten una SPA de panel izquierdo + mapa derecho.

Tabs principales:

1. `Clientes`
2. `Hojas Ruta`
3. `Flota`
4. `Historial`
5. `Usuarios` (solo admin)

Ademas:

1. Barra superior con estadisticas.
2. Mapa Leaflet a la derecha.
3. Resizer para ensanchar o estrechar el lateral.
4. Barra inferior de optimizacion.
5. Panel de rutas optimizadas.

## 7. Modulo de clientes

El modulo de clientes permite:

1. Listar todos los clientes (admin/logistica) o solo los asociados a comerciales del usuario (comercial).
2. Buscar por nombre o direccion.
3. Filtrar entre activos e inactivos.
4. Crear cliente.
5. Editar cliente.
6. Activar/desactivar cliente.
7. Marcar cliente `al contado`.
8. Asociar cliente a un comercial.
9. Asociar cliente a una ruta comercial.
10. Guardar coordenadas.
11. Definir horario principal y segundo tramo horario.
12. Gestionar horarios semanales por dia.

Campos relevantes de cliente:

1. `name`
2. `address`
3. `phone`
4. `notes`
5. `x`, `y`
6. `open_time`, `close_time`
7. `open_time_2`, `close_time_2`
8. `comercial_id`
9. `ruta_id`
10. `al_contado`
11. `active`

Reglas importantes:

1. No se puede activar un cliente sin coordenadas.
2. El cliente puede tener horario fijo simple o una agenda semanal mas detallada.
3. El cliente puede pertenecer a una ruta comercial concreta.
4. El cliente puede quedar visible solo para determinados usuarios comerciales si depende de sus `comercial_ids`.

Existe tambien una carga demo de clientes/pedidos desde `api/demo`.

## 8. Modulo de pedidos

Los pedidos son la base del motor de optimizacion multi-vehiculo.

Cada pedido:

1. Pertenece a un cliente.
2. Esta ligado a una fecha (`order_date`).
3. Tiene items.
4. Puede tener `notes`.
5. Puede tener `comercial_id`.
6. Puede tener `cc_aprox`.
7. Puede tener `observaciones`.

Los `order_items` almacenan:

1. nombre del item
2. cantidad
3. y, si existen en BD, datos de peso/volumen/tiempo de descarga heredables desde `products`

Regla clave:

1. Por cliente y fecha solo existe un pedido (`UNIQUE client_id + order_date`).
2. `createOrUpdate` actualiza o crea en la misma operacion.

## 9. Modulo de rutas optimizadas (fleet / multi-vehicle)

Este modulo usa pedidos del dia para construir rutas reales por vehiculo y delegacion.

### 9.1 Flujo funcional

1. El usuario elige la fecha operativa.
2. Pulsa `Optimizar rutas`.
3. El backend:
   - carga settings globales
   - obtiene delegaciones activas
   - obtiene vehiculos activos
   - obtiene pedidos del dia
   - obtiene clientes y horarios
   - calcula carga y tiempo de descarga por pedido
   - asigna cada cliente a una delegacion
   - reparte clientes entre vehiculos segun capacidad
   - optimiza el orden de paradas
   - inserta/actualiza `route_plans` y `route_stops`
4. El frontend:
   - muestra rutas por vehiculo
   - calcula o recalcula geometria OSRM
   - dibuja rutas en mapa
   - permite reordenar manualmente
   - permite confirmar rutas
   - permite exportar a impresion y CSV

### 9.2 Entidades principales del modulo

1. `route_plans`
2. `route_stops`
3. `route_templates`
4. `route_template_stops`
5. `app_settings`
6. `distance_cache`

### 9.3 Criterios del optimizador

El optimizador tiene en cuenta:

1. Delegacion del cliente o delegacion mas cercana.
2. Vehiculos disponibles por delegacion.
3. Capacidad por items, peso y volumen.
4. Horarios de apertura de clientes.
5. Almuerzo configurable:
   - duracion
   - hora mas temprana
   - hora mas tardia
6. Tiempo base de descarga.
7. Distancias y duraciones por carretera mediante cache OSRM.

### 9.4 Acciones del usuario en el panel de rutas optimizadas

1. Ver rutas del dia.
2. Ver km y horas totales.
3. Ver paradas por vehiculo.
4. Confirmar rutas.
5. Imprimir / exportar PDF.
6. Exportar CSV.
7. Guardar la ruta actual como plantilla.
8. Cargar plantillas.
9. Eliminar plantillas.
10. Limpiar el resultado actual.

## 10. Modulo de hojas de ruta

Este modulo es distinto del optimizador multi-vehiculo. Aqui se trabaja con hojas diarias por `ruta comercial` (Comarca A, Orense A, Pontevedra 1, etc.).

Entidad principal:

1. `hojas_ruta`
2. `hoja_ruta_lineas`

Campos relevantes de `hojas_ruta`:

1. `ruta_id`
2. `vehicle_id`
3. `user_id`
4. `fecha`
5. `responsable`
6. `estado`
7. `total_carros`
8. `total_cajas`
9. `total_cc` (legacy / compatibilidad)
10. `notas`

Campos relevantes de `hoja_ruta_lineas`:

1. `client_id`
2. `order_id`
3. `comercial_id`
4. `zona`
5. `carros`
6. `cajas`
7. `cc_aprox` (legacy / compatibilidad)
8. `orden_descarga`
9. `observaciones`
10. `estado`

Estados actuales de hoja:

1. `borrador`
2. `cerrada`
3. `en_reparto`
4. `completada`

`planificada` ya no forma parte del estado vigente.

### 10.1 Flujo general de hojas

1. Se trabaja por fecha.
2. La app lista hojas existentes y rutas sin hoja.
3. Se puede crear una hoja vacia/reutilizar una existente sin actividad.
4. Se pueden anadir lineas o dejar que se precarguen automaticamente si el usuario es comercial.
5. Se puede editar el orden de descarga.
6. Se puede autoordenar.
7. Se puede asignar vehiculo.
8. Se puede cambiar estado.
9. Se puede imprimir.
10. Se puede duplicar a otra fecha.

### 10.2 Regla de existencia real de la hoja

Una hoja con `0 carros` y `0 cajas` no se considera realmente creada a efectos de listado.

Consecuencias:

1. No debe aparecer como hoja del dia si no hay carga real.
2. La ruta debe volver a `Rutas sin hoja hoy`.
3. Si existe una hoja previa sin actividad, al crear se reutiliza.

### 10.3 Cierre de hoja

Para cerrar una hoja:

1. Debe tener vehiculo asignado.
2. Si no hay vehiculo, el backend y el frontend bloquean el cambio a `cerrada`.

### 10.4 Carros y cajas

La unidad operativa actual esta separada:

1. `carros`
2. `cajas`

`cc_aprox` se mantiene por compatibilidad con logica previa, pero la UI operativa actual trabaja con `carros` y `cajas`.

### 10.5 Autoordenar hoja

El autoordenado actual:

1. Obtiene la delegacion mas comun de la hoja o una por defecto.
2. Ordena clientes con OSRM / cache de distancias.
3. Considera salida desde delegacion.
4. Considera regreso a delegacion.
5. Reordena `orden_descarga`.
6. El mapa y el calculo visual de la hoja tambien incluyen la salida y la vuelta a delegacion.

### 10.6 Impresion de hoja

La impresion muestra:

1. titulo de ruta
2. fecha
3. responsable
4. clientes activos de la hoja
5. comercial
6. carros
7. cajas
8. observaciones
9. totales
10. firmas

## 11. Flujo comercial de hojas de ruta

Este es uno de los flujos mas especificos de la app.

### 11.1 Lo que ve un comercial

El comercial trabaja en una interfaz simplificada orientada a sus rutas del dia.

Pantallas:

1. Listado de rutas sin hoja.
2. Listado de sus hojas activas del dia.
3. Detalle de una hoja.
4. Buscador rapido superior para introducir cantidades sin entrar primero al detalle.

### 11.2 Como se decide que rutas ve

Un usuario comercial solo ve:

1. rutas cuyos clientes pertenecen a alguno de sus `comercial_ids`
2. hojas de esas rutas

### 11.3 Precarga de clientes

Cuando un comercial crea o abre una hoja:

1. la app busca clientes activos de la ruta
2. filtra solo los de sus comerciales asociados
3. inserta lineas en `hoja_ruta_lineas` con `carros = 0` y `cajas = 0` si aun no existen

Objetivo:

1. que el comercial no tenga que elegir cliente/comercial manualmente uno por uno
2. que solo meta cantidades sobre clientes ya precargados

### 11.4 Regla para pasar de "crear hoja" a "mis hojas de hoy"

Aunque existan lineas precargadas, una hoja del comercial solo pasa al bloque `Mis hojas de hoy` cuando hay actividad real:

1. al menos una linea con `carros > 0`
2. o al menos una linea con `cajas > 0`

Si todas las lineas estan a cero:

1. la hoja no cuenta como creada para listado
2. la ruta sigue apareciendo en `Crear hoja de ruta`

### 11.5 Buscador rapido del comercial

El listado comercial tiene un buscador rapido:

1. busca clientes por nombre, direccion o ruta
2. solo dentro del universo permitido por sus comerciales
3. muestra inputs directos de `carros` y `cajas`
4. al introducir cantidades:
   - crea o reutiliza la hoja de esa ruta/fecha
   - inserta o actualiza la linea del cliente
5. usa debounce para que la escritura sea fluida y no repinte agresivamente en cada tecla

### 11.6 Detalle de hoja para comercial

En el detalle comercial:

1. no aparece selector de vehiculo
2. no aparece selector de estado
3. no aparece `+ Cliente`
4. si aparece buscador de cliente dentro de la hoja
5. cada linea muestra inputs directos de `Carros` y `Cajas`
6. el comercial solo puede editar cantidades de sus lineas

## 12. Flujo admin/logistica de hojas de ruta

Admin y logistica trabajan con un flujo mas completo:

1. ven todas las hojas con actividad real
2. ven rutas sin hoja
3. pueden crear hoja manualmente
4. pueden abrir detalle
5. pueden anadir clientes
6. pueden autoordenar
7. pueden imprimir
8. pueden duplicar
9. pueden asignar vehiculo con buscador
10. pueden cambiar estado
11. pueden editar lineas completas
12. ven mapa de la hoja

El resumen de clientes en listados no debe contar lineas precargadas a cero, sino lineas con carga real.

## 13. Flota

La flota se divide en:

1. delegaciones
2. vehiculos

### 13.1 Delegaciones

Una delegacion tiene:

1. nombre
2. direccion
3. telefono
4. notas
5. coordenadas
6. horario de apertura/cierre
7. flag de activa/inactiva

### 13.2 Vehiculos

Un vehiculo tiene:

1. nombre
2. matricula
3. delegacion
4. capacidad de peso
5. capacidad de volumen
6. capacidad de items
7. coste por km
8. flag de activo/inactivo

Uso funcional:

1. el optimizador usa delegacion + capacidad del vehiculo
2. las hojas de ruta usan el vehiculo asignado para poder cerrarse

## 14. Historial y dashboard

El modulo de historial permite:

1. consultar rutas optimizadas entre fechas
2. ver agrupacion por dia
3. ver km totales
4. ver horas totales
5. ver numero de rutas
6. ver rutas concretas

El dashboard agrega:

1. dias operados
2. rutas totales
3. km totales
4. horas totales
5. medias por ruta
6. informacion historica agregada

## 15. Gestion de usuarios (solo admin)

El admin puede:

1. listar usuarios
2. crear usuarios
3. editar usuarios
4. cambiar username
5. cambiar password
6. activar o desactivar usuarios
7. bloquear o desbloquear usuarios
8. asociar multiples comerciales a un usuario comercial
9. eliminar usuarios

Restricciones:

1. no puede eliminarse a si mismo
2. el username debe ser unico

## 16. Settings globales

Existe un modal de configuracion donde se guardan parametros operativos:

1. `lunch_duration_min`
2. `lunch_earliest`
3. `lunch_latest`
4. `base_unload_min`
5. `default_speed_kmh`

Esos parametros impactan sobre el optimizador de rutas.

## 17. Plantillas

Las plantillas permiten:

1. guardar la estructura actual de una o varias rutas optimizadas
2. persistir cliente por cliente el orden de una ruta tipo
3. asociar opcionalmente vehiculo y delegacion
4. reinyectar pedidos minimos para esos clientes al aplicar una plantilla

Uso habitual:

1. se optimiza
2. se guarda como plantilla
3. otro dia se aplica
4. se generan pedidos basicos para los clientes de la plantilla
5. luego se vuelve a optimizar

## 18. Reglas de negocio finas y comportamiento actual

Estas reglas son CRITICAS y deben respetarse si explicas la app:

1. Un cliente no puede reactivarse sin coordenadas.
2. Un usuario comercial solo ve clientes de sus comerciales asociados.
3. Un usuario comercial puede tener varios `comercial_ids`.
4. Los clientes de una hoja comercial se precargan automaticamente por ruta/comercial.
5. Una hoja con `0 carros` y `0 cajas` no cuenta como hoja creada para listado.
6. El badge/listado de hojas debe reflejar solo clientes con carga real, no lineas precargadas a cero.
7. Para cerrar una hoja hay que asignar vehiculo.
8. El estado `planificada` ya no existe.
9. `carros` y `cajas` son las unidades vigentes; `cc_aprox` es legado.
10. El autoordenado de hoja debe contemplar salida y vuelta a delegacion.
11. El comercial no debe escoger manualmente comercial en su propio flujo si sus asociaciones ya estan definidas.
12. El buscador comercial rapido puede generar la hoja automaticamente al introducir cantidades.
13. El buscador del comercial esta suavizado para no re-renderizar de forma agresiva en cada tecla.

## 19. Endpoints principales

### 19.1 Autenticacion / sesion

1. `GET /login.php`
2. `POST /login.php`
3. `GET /api/me`
4. `GET /logout`

### 19.2 Clientes

1. `GET /api/clients`
2. `POST /api/clients`
3. `PUT /api/clients/{id}`
4. `PUT /api/clients/{id}/toggle`
5. `PUT /api/clients/{id}/contado`
6. `DELETE /api/clients/{id}`
7. `GET /api/clients/{id}/schedules`
8. `PUT /api/clients/{id}/schedules`
9. `POST /api/demo`

### 19.3 Pedidos

1. `GET /api/orders?date=YYYY-MM-DD`
2. `POST /api/orders`
3. `PUT /api/orders/{id}`
4. `DELETE /api/orders?client_id=X&date=YYYY-MM-DD`

### 19.4 Delegaciones y vehiculos

1. `GET /api/delegations`
2. `POST /api/delegations`
3. `PUT /api/delegations/{id}`
4. `PUT /api/delegations/{id}/toggle`
5. `DELETE /api/delegations/{id}`
6. `GET /api/vehicles`
7. `POST /api/vehicles`
8. `PUT /api/vehicles/{id}`
9. `PUT /api/vehicles/{id}/toggle`
10. `DELETE /api/vehicles/{id}`

### 19.5 Optimizacion de rutas

1. `POST /api/routes/optimize`
2. `GET /api/routes`
3. `GET /api/routes/{id}`
4. `PUT /api/routes/{id}`
5. `PUT /api/routes/{id}/status`
6. `PUT /api/routes/{id}/stop/{stopOrder}/status`
7. `GET /api/routes/history`
8. `GET /api/stats`

### 19.6 Hojas de ruta

1. `GET /api/hojas-ruta`
2. `GET /api/hojas-ruta/{id}`
3. `POST /api/hojas-ruta`
4. `PUT /api/hojas-ruta/{id}`
5. `DELETE /api/hojas-ruta/{id}`
6. `PUT /api/hojas-ruta/{id}/estado`
7. `POST /api/hojas-ruta/{id}/lineas`
8. `PUT /api/hojas-ruta/{id}/lineas/{lineaId}`
9. `DELETE /api/hojas-ruta/{id}/lineas/{lineaId}`
10. `PUT /api/hojas-ruta/{id}/reordenar`
11. `POST /api/hojas-ruta/{id}/auto-ordenar`
12. `GET /api/hojas-ruta/{id}/imprimir`
13. `POST /api/hojas-ruta/{id}/duplicar`
14. `GET /api/comerciales`

### 19.7 Rutas comerciales y usuarios

1. `GET /api/rutas`
2. `POST /api/rutas`
3. `PUT /api/rutas/{id}`
4. `DELETE /api/rutas/{id}`
5. `GET /api/users`
6. `POST /api/users`
7. `PUT /api/users/{id}`
8. `DELETE /api/users/{id}`

### 19.8 Settings y plantillas

1. `GET /api/settings`
2. `PUT /api/settings`
3. `GET /api/delegation`
4. `PUT /api/delegation`
5. `GET /api/templates`
6. `POST /api/templates`
7. `DELETE /api/templates/{id}`

## 20. Entidades y relaciones clave

Resume asi la capa de datos:

1. `clients` puede enlazar con `comerciales`, `rutas`, `delegations`, `client_schedules`.
2. `orders` enlaza con `clients` y tiene `order_items`.
3. `delegations` tiene `vehicles`.
4. `route_plans` enlaza con `vehicles` y `delegations`.
5. `route_stops` enlaza con `route_plans` y `clients`.
6. `hojas_ruta` enlaza con `rutas`, `vehicles`, `app_users`.
7. `hoja_ruta_lineas` enlaza con `hojas_ruta`, `clients`, `orders`, `comerciales`.
8. `app_users` puede enlazar con `comerciales` de forma directa o por `user_comerciales`.
9. `route_templates` y `route_template_stops` almacenan rutas reutilizables.
10. `app_settings` guarda parametros operativos.

## 21. Como debes responder si te pido analisis de esta aplicacion

Cuando te pregunte por VeraRoute:

1. diferencia siempre entre modulo de optimizacion y modulo de hojas de ruta.
2. explica siempre el rol que realiza cada accion.
3. indica si un comportamiento es de admin/logistica o de comercial.
4. no reduzcas `carros/cajas` a una unica unidad salvo que hables de compatibilidad legacy.
5. trata las hojas con `0/0` como no creadas a nivel de listado operativo.
6. recuerda que el comercial ve clientes precargados para editar cantidades, pero los resumenes deben contar carga real.
7. si propones cambios, respeta la separacion actual de roles y el uso de `user_comerciales`.

## 22. Formato de salida deseado cuando analices VeraRoute

Si te piden una explicacion completa, responde idealmente en este orden:

1. Vision general del producto.
2. Roles y permisos.
3. Flujos principales paso a paso.
4. Modulos y funcionalidades.
5. Reglas de negocio.
6. Entidades/tablas implicadas.
7. Riesgos, incoherencias o zonas legacy si existen.

No lo conviertas en una descripcion generica de "software logistico". Debe sonar a esta aplicacion concreta.
```

---

## Archivos clave usados como base del prompt

Referencias principales del estado actual:

1. `index.php`
2. `login.php`
3. `views/app.php`
4. `public/js/app.js`
5. `controllers/ClientController.php`
6. `controllers/HojaRutaController.php`
7. `controllers/RouteController.php`
8. `controllers/UserController.php`
9. `controllers/DelegationController.php`
10. `controllers/VehicleController.php`
11. `controllers/SettingController.php`
12. `controllers/OrderController.php`
13. `controllers/RutaController.php`
14. `controllers/TemplateController.php`
15. `models/Client.php`
16. `models/HojaRuta.php`
17. `models/RoutePlan.php`
18. `models/RouteTemplate.php`
19. `models/Order.php`
20. `models/ClientSchedule.php`
21. `models/Vehicle.php`
22. `models/Delegation.php`
23. `models/Ruta.php`
24. `models/AppSetting.php`
25. `sql/migration_auth.sql`
26. `sql/migration_hojas_ruta.sql`

## Nota final

Este documento describe el estado actual inferido del codigo y de los cambios recientes integrados en el proyecto. Si se usa como prompt para otra IA, debe tratarse como contexto operativo vigente y no como documentacion historica.

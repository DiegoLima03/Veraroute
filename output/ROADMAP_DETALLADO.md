# ROADMAP - VeraRoute (Gestor de Rutas)

> Fecha: 9 de abril de 2026
> Objetivo final: App 100% operativa donde comerciales meten pedidos, logistica organiza rutas, se comparan costes GLS vs flota propia, y la entrada de datos viene por API desde el ERP.

---

## Estado actual del proyecto

| Modulo | Estado | Completitud |
|--------|--------|-------------|
| Clientes (CRUD, geocoding, horarios, multi-ruta) | Operativo | 100% |
| Hojas de Ruta (manual, OSRM, coste, impresion) | Operativo | 100% |
| Flota (vehiculos, delegaciones, coste/km) | Operativo | 100% |
| Usuarios (roles admin/logistica/comercial) | Operativo | 100% |
| GLS Integracion (coste comparativo) | Operativo | 95% |
| Tarifas transportistas (carriers, zonas, rates) | Operativo | 100% |
| Optimizacion de rutas (OSRM, multi-vehiculo) | Implementado | 80% |
| Pedidos (orders/order_items) | Parcial | 50% |
| Dashboard / Estadisticas | Operativo | 90% |
| Configuracion / Plantillas | Operativo | 100% |

---

## FASE 1: OPERATIVIDAD DIARIA (Prioridad maxima)

**Objetivo:** Que los comerciales puedan meter pedidos desde el movil/tablet y logistica organice las rutas del dia siguiente sin papel.

### 1.1 Flujo del comercial: Entrada de pedidos

**Problema actual:** El modulo de pedidos existe en backend pero la UI del comercial esta centrada en hojas de ruta, no en creacion rapida de pedidos. Los comerciales necesitan una interfaz sencilla, rapida y movil-friendly para meter pedidos mientras visitan clientes.

**Que hay que hacer:**

- **Pantalla de pedidos para comercial:** Redisenar la vista del rol `comercial` para que el flujo principal sea:
  1. Seleccionar fecha (por defecto hoy)
  2. Ver lista de clientes de sus rutas asignadas
  3. Buscar/seleccionar cliente rapidamente
  4. Meter cantidades: carros, cajas, CC aproximado
  5. Anadir observaciones (direccion especial, llamar antes, horario, etc.)
  6. Guardar pedido con un tap
  7. Ver resumen de pedidos del dia

- **Responsive / Mobile-first:** La pantalla del comercial debe funcionar perfectamente en movil. Botones grandes, formularios sencillos, scroll vertical, sin necesidad del mapa.

- **Pedido rapido desde listado de clientes:** En la lista de clientes de la ruta, cada cliente tiene un boton "+" para anadir pedido inline sin abrir formulario completo. Solo carros + cajas + observaciones.

- **Estado del pedido:** Anadir campo `estado` a orders si no existe (pendiente, confirmado, anulado). El comercial puede anular un pedido del dia si se equivoco.

- **Notificaciones basicas:** Cuando un comercial cierra sus pedidos del dia, que quede registrado (timestamp). Logistica puede ver que comerciales ya han cerrado y cuales faltan.

### 1.2 Flujo de logistica: De pedidos a hojas de ruta

**Problema actual:** Las hojas de ruta se crean manualmente anadiendo clientes uno a uno. Falta el puente automatico desde los pedidos del dia a las hojas.

**Que hay que hacer:**

- **Generacion automatica de hojas desde pedidos:** Boton "Generar hojas del dia" que:
  1. Toma todos los pedidos de una fecha con estado=confirmado
  2. Agrupa por ruta comercial (ruta_id del cliente)
  3. Crea una hoja de ruta por cada ruta que tenga pedidos
  4. Inserta las lineas con los datos del pedido (cliente, cantidades, observaciones)
  5. Calcula totales automaticamente

- **Panel de control de logistica:** Vista que muestre:
  - Fecha seleccionada (manana por defecto, ya que los pedidos de hoy son para el reparto de manana)
  - Estado por ruta: cuantos pedidos, cuantos CC, si la hoja ya esta generada
  - Pedidos sin ruta asignada (clientes sin ruta)
  - Alertas: pedidos de clientes sin coordenadas, sin codigo postal, etc.

- **Edicion post-generacion:** Una vez generada la hoja, logistica puede:
  - Anadir/quitar lineas manualmente
  - Reordenar (drag & drop o auto-OSRM, ya implementado)
  - Asignar vehiculo
  - Cambiar estado (borrador -> cerrada -> en_reparto -> completada)

- **Vinculacion pedido-linea:** Cada `hoja_ruta_lineas` debe enlazar al `order_id` de origen. Si se modifica el pedido antes de cerrar la hoja, los cambios se reflejan.

### 1.3 Mejoras de UX para uso diario

- **Fecha por defecto inteligente:** Si son antes de las 14:00, la fecha por defecto de pedidos es hoy. Despues de las 14:00, manana. Para logistica, siempre el dia siguiente.

- **Duplicar hoja del dia anterior:** Ya existe, pero verificar que funcione bien con el nuevo flujo de pedidos.

- **Impresion de hoja de ruta:** Revisar el formato de impresion para que sea practico:
  - Orden de descarga claro y grande
  - Direccion completa del cliente
  - Cantidades (carros, cajas)
  - Observaciones
  - Espacio para firma de recepcion
  - Indicador "AL CONTADO" visible para clientes que pagan en efectivo

- **Filtros y busqueda rapida:** Buscador de clientes por nombre, localidad o codigo postal en todas las vistas relevantes.

---

## FASE 2: TARIFAS GLS Y COMPARATIVA DE COSTES

**Objetivo:** Poder decidir para cada cliente/pedido si es mas rentable enviarlo con nuestra flota o externalizar a GLS.

### 2.1 Carga y mantenimiento de tarifas GLS

**Estado actual:** El sistema de tarifas (carriers, carrier_zones, carrier_rates, carrier_surcharges) ya esta implementado y funcional. Lo que falta:

- **Importacion masiva de tarifas:** Herramienta para importar tarifas GLS desde Excel/CSV. GLS proporciona sus tarifas en formato tabular (zona x peso = precio). Crear importador que:
  1. Acepte CSV con columnas: zona, peso_min, peso_max, precio
  2. Mapee codigos postales a zonas (GLS usa zonas por prefijo CP)
  3. Actualice precios sin duplicar registros existentes
  4. Registre fecha de ultima actualizacion de tarifas

- **Recargos configurables:**
  - Recargo combustible (% variable, GLS lo actualiza mensualmente)
  - Recargo zona remota (lista de CPs con recargo adicional)
  - Recargo peso volumetrico (si aplica)
  - Recargo entrega en horario especial
  - Descuento negociado (multiplicador de precio, ya existe como `price_multiplier`)

- **Historico de tarifas:** Guardar versiones anteriores de tarifas para poder comparar evolucion de precios.

### 2.2 Calculo comparativo en hojas de ruta

**Estado actual:** El `RouteCostCalculator` ya calcula coste propio vs GLS por linea. Mejorar con:

- **Calculo en tiempo real al generar hoja:** Al crear la hoja desde pedidos, calcular automaticamente el coste GLS para cada linea.

- **Vista comparativa en la hoja:** Para cada linea mostrar:
  - Coste estimado flota propia (km desvio x coste/km vehiculo)
  - Coste GLS (tarifa + recargos)
  - Diferencia (ahorro/sobrecoste)
  - Recomendacion visual (verde = flota propia, naranja = evaluar, rojo = externalizar)

- **Resumen por hoja:** Totales de:
  - Coste total si todo va en flota propia
  - Coste total si todo va por GLS
  - Combinacion optima (cada linea por el canal mas barato)
  - Ahorro potencial de la combinacion optima

- **Umbral de decision configurable:** Parametro "externalizar si GLS es X% mas barato que flota propia" para automatizar la recomendacion.

### 2.3 Informes de rentabilidad

- **Informe diario:** Resumen del dia con costes reales vs estimados.
- **Informe por cliente:** Historico de coste de entrega por cliente. Identificar clientes que siempre salen mas baratos por GLS.
- **Informe por ruta:** Rentabilidad de cada ruta comercial.
- **Exportacion:** CSV o PDF para compartir con direccion.

---

## FASE 3: PULIDO Y FIABILIDAD

**Objetivo:** Hacer la app robusta para uso diario por multiples usuarios simultaneos.

### 3.1 Validacion y control de errores

- **Validacion de datos en formularios:** Campos obligatorios, formatos correctos (CP de 5 digitos, coordenadas validas, cantidades positivas).
- **Control de concurrencia:** Si dos personas editan la misma hoja, avisar del conflicto.
- **Logs de auditoria:** Registrar quien hizo que y cuando (crear pedido, modificar hoja, cambiar estado). Tabla `audit_log` con user_id, action, entity, entity_id, timestamp, old_value, new_value.

### 3.2 Mejoras de rendimiento

- **Cache de tarifas GLS:** Ya existe `gls_rate_cache`, verificar que se invalide correctamente al actualizar tarifas.
- **Paginacion:** Si hay muchos clientes/pedidos, paginar las listas en lugar de cargar todo en memoria.
- **Lazy loading del mapa:** Solo cargar datos del mapa cuando se activa la pestana del mapa.

### 3.3 Vista movil del repartidor

- **Pantalla de reparto:** Vista simplificada para el conductor:
  - Lista de paradas en orden
  - Boton "Entregado" / "No entregado" por parada
  - Navegacion GPS (abrir Google Maps/Waze con la direccion)
  - Foto de firma/entrega (opcional, fase posterior)

### 3.4 Notificaciones y alertas

- **Dashboard de logistica:** Indicadores en tiempo real:
  - Pedidos sin hoja asignada
  - Hojas sin vehiculo
  - Clientes sin coordenadas (no se pueden ordenar)
  - Pedidos al contado (requieren cobro en destino)

---

## FASE 4: INTEGRACION API CON ERP (Paso final)

**Objetivo:** Eliminar la doble entrada de datos. Los pedidos y contactos entran automaticamente desde el ERP.

### 4.1 API de recepcion de datos

- **Endpoint de clientes:**
  ```
  POST /api/v1/erp/clients
  PUT  /api/v1/erp/clients/{erp_id}
  ```
  - Recibe datos del cliente desde el ERP
  - Crea o actualiza en la BD local
  - Geocodifica la direccion si es nueva
  - Mapea el `erp_id` al `client.id` interno (tabla de mapeo o campo `erp_external_id` en clients)

- **Endpoint de pedidos:**
  ```
  POST /api/v1/erp/orders
  PUT  /api/v1/erp/orders/{erp_id}
  DELETE /api/v1/erp/orders/{erp_id}
  ```
  - Recibe pedidos con referencia al cliente (por erp_id)
  - Incluye lineas de pedido con productos y cantidades
  - Auto-calcula CC, carros, cajas segun reglas de conversion
  - Asigna comercial automaticamente por la ruta del cliente

### 4.2 Autenticacion API

- **API Key por sistema:** Tabla `api_keys` con key, nombre_sistema, permisos, activo, created_at.
- **Autenticacion via header:** `Authorization: Bearer {api_key}`
- **Rate limiting:** Limitar peticiones por minuto para proteger el servidor.
- **Log de llamadas API:** Registrar todas las llamadas entrantes para debug y auditoria.

### 4.3 Sincronizacion y mapeo

- **Tabla de mapeo:** `erp_entity_map` (erp_system, erp_entity_type, erp_id, local_id). Permite mapear IDs del ERP a IDs locales.
- **Sincronizacion incremental:** Solo sincronizar cambios desde la ultima sincronizacion (campo `updated_since` en las peticiones).
- **Gestion de conflictos:** Si un dato se modifica tanto en el ERP como en VeraRoute, definir regla: ERP gana siempre (es el master de datos) o alertar al usuario.
- **Webhook de confirmacion:** VeraRoute puede notificar al ERP cuando un pedido se entrega (callback URL configurable).

### 4.4 Migracion de flujo

- **Fase A:** API activa en paralelo. Los comerciales siguen metiendo pedidos manualmente. Los datos del ERP se importan pero se comparan con los manuales para validar.
- **Fase B:** Los pedidos del ERP se cargan automaticamente. Los comerciales solo revisan y confirman, no introducen datos.
- **Fase C:** Entrada manual desactivada para pedidos. Todo entra por API. Los comerciales solo consultan y hacen seguimiento.

---

## Resumen visual del roadmap

```
FASE 1: OPERATIVIDAD                    FASE 2: TARIFAS GLS
 [Pedidos comercial movil]               [Importar tarifas CSV]
 [Pedidos -> Hojas auto]                 [Comparativa en hoja]
 [Panel logistica]                       [Informes rentabilidad]
 [Impresion mejorada]                    [Recargos configurables]
 [UX mobile-first]                       [Historico de tarifas]
         |                                        |
         v                                        v
FASE 3: PULIDO                           FASE 4: API ERP
 [Validaciones]                           [Endpoint clientes]
 [Auditoria]                              [Endpoint pedidos]
 [Vista repartidor]                       [Auth API Key]
 [Dashboard alertas]                      [Sync incremental]
 [Rendimiento]                            [Migracion gradual]
```

---

## Principios guia

1. **Funcional antes que bonito.** Que funcione y se use todos los dias es la prioridad.
2. **Mobile-first para comerciales.** Ellos trabajan en la calle con el movil.
3. **Desktop-first para logistica.** Ellos trabajan con pantalla grande planificando rutas.
4. **No romper lo que funciona.** Las hojas de ruta manuales siguen siendo validas. Los pedidos son un canal de entrada, no un reemplazo.
5. **Datos del ERP son la fuente de verdad.** Cuando llegue la integracion, el ERP manda. VeraRoute es el motor logistico, no el maestro de datos.

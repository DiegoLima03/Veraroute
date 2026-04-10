# Subtareas Notion - Gestor de Rutas

> Tareas marcadas con (YA EXISTE) son las que ya tienes en Notion.
> El resto son las que hay que anadir.

---

## FASE 1: OPERATIVIDAD DIARIA

### Datos y configuracion inicial

- [x] Sacar todos los datos de vClient **(YA EXISTE)**
- [ ] Pedir a Jose que rutas logisticas tiene **(YA EXISTE)**
- [ ] Cargar las rutas logisticas en la app (las que de Jose)
- [ ] Revisar que todos los clientes tienen coordenadas correctas (los que no, geocodificar)
- [ ] Revisar que todos los clientes tienen codigo postal (necesario para tarifas GLS)
- [ ] Asignar cada cliente a su ruta comercial correcta
- [ ] Crear usuarios para cada comercial con rol "comercial"
- [ ] Crear usuarios para logistica con rol "logistica"
- [ ] Probar login de cada usuario y verificar que ve solo sus rutas

### Flujo del comercial (entrada de pedidos)

- [ ] Redisenar la pantalla del comercial para que sea mobile-first
- [ ] Crear vista de "Mis pedidos del dia" para el comercial
- [ ] Implementar formulario rapido de pedido: seleccionar cliente -> carros + cajas + observaciones -> guardar
- [ ] Anadir boton "+" en listado de clientes para pedido rapido inline
- [ ] Anadir campo estado al pedido (pendiente/confirmado/anulado)
- [ ] El comercial puede anular un pedido del dia si se equivoco
- [ ] Mostrar resumen de pedidos del dia al comercial (total carros, cajas, clientes)
- [ ] Probar flujo completo en movil con un comercial real

### Flujo de logistica (pedidos a hojas de ruta)

- [ ] Boton "Generar hojas del dia" que cree hojas automaticamente desde los pedidos confirmados
- [ ] La generacion agrupa pedidos por ruta y crea una hoja por ruta
- [ ] Panel de logistica: ver por fecha cuantos pedidos hay por ruta y si la hoja ya esta generada
- [ ] Alertas: pedidos de clientes sin coordenadas, sin CP, sin ruta
- [ ] Logistica puede anadir/quitar lineas manualmente despues de generar
- [ ] Logistica puede reordenar lineas (drag & drop + auto-OSRM ya funciona)
- [ ] Vincular cada linea de hoja al pedido de origen (order_id)

### Impresion y uso en almacen

- [ ] Revisar formato de impresion de hoja de ruta
- [ ] Que aparezca bien: orden descarga, direccion, carros, cajas, observaciones
- [ ] Indicador visible "AL CONTADO" para clientes que pagan en efectivo
- [ ] Espacio para firma de recepcion en la hoja impresa

---

## FASE 2: TARIFAS GLS Y COMPARATIVA

### Tarifas

- [ ] Implementar comparativa vs cuanto costaria enviarlo por paqueteria **(YA EXISTE)**
- [ ] Conseguir tarifario actualizado de GLS (pedir a GLS o sacarlo del contrato)
- [ ] Cargar tarifas GLS en la app (zonas por codigo postal + precio por peso)
- [ ] Crear importador CSV para actualizar tarifas facilmente cuando cambien
- [ ] Configurar recargo combustible actual (% que aplica GLS)
- [ ] Configurar lista de codigos postales con recargo zona remota
- [ ] Configurar el descuento negociado con GLS (price_multiplier)

### Comparativa en hojas de ruta

- [ ] Al generar hoja, calcular automaticamente coste GLS por cada linea
- [ ] Mostrar en cada linea: coste flota propia vs coste GLS vs diferencia
- [ ] Semaforo visual por linea (verde = flota propia, rojo = externalizar)
- [ ] Resumen por hoja: coste total flota vs total GLS vs combinacion optima
- [ ] Configurar umbral de decision (externalizar si GLS es X% mas barato)

### Informes

- [ ] Informe diario de costes (flota propia vs GLS)
- [ ] Informe por cliente: historico de coste de entrega
- [ ] Informe por ruta: rentabilidad de cada ruta comercial
- [ ] Exportar informes a CSV

---

## FASE 3: PULIDO Y FIABILIDAD

- [ ] Validaciones en formularios (campos obligatorios, formato CP, cantidades positivas)
- [ ] Log de auditoria: quien hizo que y cuando (crear pedido, modificar hoja, etc.)
- [ ] Paginacion en listados grandes (clientes, pedidos)
- [ ] Vista simplificada para el repartidor (lista de paradas + boton entregado/no entregado)
- [ ] Boton "Abrir en Google Maps" por cada parada para el repartidor
- [ ] Dashboard de alertas para logistica (pedidos sin hoja, hojas sin vehiculo, etc.)

---

## FASE 4: INTEGRACION API CON ERP

- [ ] Definir que variables necesito para lo que quiero hacer y pasarselas a Alejandro para que pida una api a Meigasoft **(YA EXISTE)**
- [ ] Definir estructura del JSON que el ERP enviara (campos de cliente + campos de pedido)
- [ ] Anadir campo erp_external_id a la tabla clients para mapear con el ERP
- [ ] Crear endpoint POST /api/v1/erp/clients para recibir clientes del ERP
- [ ] Crear endpoint POST /api/v1/erp/orders para recibir pedidos del ERP
- [ ] Implementar autenticacion por API Key (header Authorization: Bearer)
- [ ] Crear tabla api_keys para gestionar accesos
- [ ] Log de todas las llamadas API entrantes
- [ ] Geocodificar automaticamente clientes nuevos que lleguen del ERP
- [ ] Fase de pruebas: API activa en paralelo, comerciales siguen metiendo pedidos manual
- [ ] Fase de transicion: pedidos entran por API, comerciales solo revisan y confirman
- [ ] Fase final: entrada manual desactivada, todo entra por API

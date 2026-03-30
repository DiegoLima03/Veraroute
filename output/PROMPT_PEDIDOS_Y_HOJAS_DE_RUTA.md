# PROMPT: Sistema de Pedidos Comerciales y Hojas de Ruta para VeraRoute

## Contexto del Proyecto

VeraRoute (Gestor de Rutas) es una aplicación web PHP/MySQL/Leaflet que gestiona rutas de reparto logístico. Ya dispone de: gestión de clientes con coordenadas, pedidos por fecha, flota (delegaciones + vehículos), optimización de rutas con OSRM, plantillas de ruta, historial y dashboard. El stack es PHP vanilla (MVC custom), MySQL, JavaScript vanilla con Leaflet.js. La base de datos se llama `gestorrutas` en `127.0.0.1:3308`.

**Problema actual:** Los comerciales rellenan hojas de papel con los pedidos de cada ruta comercial (Comarca A, Comarca B, etc.) y logística las recibe manualmente para generar el orden de entrega. Este proceso es lento, propenso a errores y difícil de rastrear.

**Objetivo:** Digitalizar completamente este flujo: que los comerciales introduzcan pedidos desde la app (o móvil) y que logística pueda generar hojas de ruta y asignar orden de entrega directamente desde VeraRoute.

---

## 1. MODELO DE DATOS — Nuevas tablas y modificaciones

### 1.1 Tabla `comerciales` — YA EXISTE

La tabla `comerciales` ya existe en la BD con 52 registros (JAVI, SUSA, BETI, YAGO, Pesenti, DANI, Eloy, Pablo, etc.). La tabla `clients` ya tiene un campo `comercial_id` que referencia a esta tabla. **No hay que crear nada nuevo para comerciales.**

### 1.2 Modificación tabla `orders` — añadir referencia al comercial y campos de la hoja

```sql
ALTER TABLE orders
    ADD COLUMN comercial_id INT UNSIGNED NULL AFTER client_id COMMENT 'Comercial que tomó el pedido (FK a comerciales)',
    ADD COLUMN cc_aprox DECIMAL(5,2) NULL COMMENT 'Nº CC aproximado (unidades de carga: 0.50, 1, 2, etc.)',
    ADD COLUMN observaciones TEXT NULL COMMENT 'Observaciones del comercial (dirección, llamar antes, etc.)',
    ADD FOREIGN KEY (comercial_id) REFERENCES comerciales(id) ON DELETE SET NULL;
```

**Nota:** El comercial del pedido se puede precargar automáticamente desde `clients.comercial_id` al crear el pedido, pero se permite cambiarlo (un comercial diferente puede tomar un pedido puntual).

### 1.3 Tabla `hojas_ruta` (la hoja de papel digitalizada)

Cada hoja agrupa los pedidos de una ruta comercial en un día concreto. Es el equivalente digital de cada hoja de papel (ej: "Comarca A - Fran - 27/03/2026").

```sql
CREATE TABLE hojas_ruta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ruta_id INT NOT NULL,                       -- Ruta comercial (Comarca A, B, etc.)
    fecha DATE NOT NULL,                         -- Fecha de la hoja
    responsable VARCHAR(100),                    -- Quién gestiona la hoja (Fran, Jose y Marcelo, Elvis...)
    estado ENUM('borrador','cerrada','planificada','en_reparto','completada') DEFAULT 'borrador',
    total_cc DECIMAL(8,2) DEFAULT 0,             -- Total CC calculado
    total_bn INT DEFAULT 0,                      -- Total bidones
    total_litros DECIMAL(8,2) DEFAULT 0,         -- Total litros
    notas TEXT,                                  -- Notas generales de la hoja
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ruta_id) REFERENCES rutas(id),
    UNIQUE KEY unique_ruta_fecha (ruta_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 1.4 Tabla `hoja_ruta_lineas` (cada línea = un cliente en la hoja)

Cada fila de la hoja de papel es una línea aquí. Incluye el orden de descarga que asigna logística.

```sql
CREATE TABLE hoja_ruta_lineas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hoja_ruta_id INT NOT NULL,
    order_id INT NULL,                           -- Pedido asociado (de la tabla orders)
    client_id INT NOT NULL,
    comercial_id INT UNSIGNED NULL,              -- Comercial que tomó el pedido (FK a comerciales)
    zona VARCHAR(100),                           -- Zona/localidad del cliente
    cc_aprox DECIMAL(5,2) DEFAULT 0,             -- Nº CC aproximado
    orden_descarga INT NULL,                     -- Orden de entrega (lo asigna logística)
    observaciones TEXT,                          -- Observaciones específicas de esta entrega
    estado ENUM('pendiente','entregado','cancelado','no_entregado') DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hoja_ruta_id) REFERENCES hojas_ruta(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (comercial_id) REFERENCES comerciales(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 2. BACKEND — Nuevos controladores y endpoints

### 2.1 `HojaRutaController.php` — Gestión de hojas de ruta

**Modelo:** `models/HojaRuta.php`
**Controlador:** `controllers/HojaRutaController.php`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/hojas-ruta?fecha=YYYY-MM-DD` | Listar hojas del día (con líneas y clientes) |
| GET | `/api/hojas-ruta?fecha=YYYY-MM-DD&ruta_id=X` | Hoja de una ruta específica en un día |
| GET | `/api/hojas-ruta/{id}` | Detalle completo de una hoja con todas sus líneas |
| POST | `/api/hojas-ruta` | Crear hoja de ruta (ruta_id, fecha, responsable) |
| PUT | `/api/hojas-ruta/{id}` | Actualizar hoja (responsable, notas, estado) |
| DELETE | `/api/hojas-ruta/{id}` | Eliminar hoja (solo si estado=borrador) |
| PUT | `/api/hojas-ruta/{id}/estado` | Cambiar estado de la hoja |
| POST | `/api/hojas-ruta/{id}/lineas` | Añadir línea (cliente + pedido a la hoja) |
| PUT | `/api/hojas-ruta/{id}/lineas/{lineaId}` | Modificar línea (orden_descarga, observaciones, estado) |
| DELETE | `/api/hojas-ruta/{id}/lineas/{lineaId}` | Quitar línea de la hoja |
| PUT | `/api/hojas-ruta/{id}/reordenar` | Reordenar todas las líneas (recibe array de IDs en nuevo orden) |
| POST | `/api/hojas-ruta/{id}/auto-ordenar` | Ordenar automáticamente las líneas usando el optimizador de rutas existente |
| GET | `/api/hojas-ruta/{id}/imprimir` | Generar vista de impresión (HTML para imprimir) |
| POST | `/api/hojas-ruta/{id}/vincular-plan` | Vincular la hoja con un route_plan optimizado existente |

### 2.2 Modificación de `OrderController.php`

Añadir soporte para `comercial_id`, `cc_aprox` y `observaciones` en:
- `POST /api/orders` — aceptar campos nuevos al crear pedido. Precargar `comercial_id` desde `clients.comercial_id` si no se envía
- `PUT /api/orders/{id}` — aceptar campos nuevos al actualizar
- `GET /api/orders?date=YYYY-MM-DD` — devolver también el nombre del comercial (JOIN con tabla `comerciales`)

### 2.3 Modificación de `RutaController.php`

Añadir endpoint para obtener clientes de una ruta con sus pedidos del día:
- `GET /api/rutas/{id}/clientes-pedidos?fecha=YYYY-MM-DD` — Devuelve los clientes de la ruta que tienen pedido en esa fecha, con datos del comercial y cc_aprox

### 2.4 Uso de la tabla `comerciales` existente

La tabla `comerciales` ya existe y tiene CRUD. Los selectores de comercial en las hojas de ruta y pedidos deben obtener la lista de comerciales activos vía el endpoint existente o creando:
- `GET /api/comerciales` — Listar comerciales (si no existe ya). Devuelve id y nombre para poblar selectores/autocompletar en formularios.

---

## 3. FLUJO DE TRABAJO DIGITALIZADO

### Flujo completo paso a paso:

```
┌─────────────────────────────────────────────────────────────────────┐
│  COMERCIAL (campo/móvil)                                            │
│                                                                     │
│  1. Abre VeraRoute → selecciona su nombre (autocompletar)           │
│  2. Selecciona la ruta del día (Comarca A, etc.)                   │
│  3. Ve la lista de clientes de esa ruta                            │
│  4. Para cada cliente visitado:                                     │
│     - Marca que tiene pedido                                        │
│     - Introduce Nº CC aproximado (0.50, 1, 2, etc.)               │
│     - Añade observaciones (dirección, "llamar antes", teléfono)    │
│  5. Al terminar la ruta, "cierra" la hoja                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LOGÍSTICA (oficina/escritorio)                                     │
│                                                                     │
│  6. Ve todas las hojas cerradas del día (panel de hojas de ruta)   │
│  7. Para cada hoja:                                                 │
│     a. Revisa los pedidos y observaciones                          │
│     b. Opción A: Asigna manualmente el orden de descarga           │
│        (drag & drop para reordenar)                                │
│     c. Opción B: Pulsa "Auto-ordenar" para que el optimizador     │
│        calcule el orden óptimo automáticamente                     │
│  8. Revisa los totales (CC, BN, litros)                            │
│  9. Cambia estado a "planificada"                                  │
│  10. Opcionalmente imprime la hoja para el repartidor             │
│  11. Opcionalmente vincula con un route_plan para tracking GPS    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REPARTO (conductor)                                                │
│                                                                     │
│  12. Ve su hoja de ruta del día con el orden asignado              │
│  13. Sigue el orden de entrega                                     │
│  14. Marca cada entrega como completada/no entregada              │
│  15. Al terminar, la hoja pasa a "completada"                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. FRONTEND — Nueva pestaña "Hojas de Ruta"

### 4.1 Añadir nueva pestaña al menú principal

En `views/app.php`, añadir una 5ª pestaña **"Hojas de Ruta"** (icono: 📋) entre "Pedidos" y "Flota". Debe ser la pestaña más prominente ya que será la más usada.

### 4.2 Panel principal de Hojas de Ruta

```
┌──────────────────────────────────────────────────────────────────┐
│  📅 Fecha: [27/03/2026]  [← Anterior] [Hoy] [Siguiente →]      │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ COMARCA A          │ Fran       │ 16 clientes │ ⬤ Cerrada  │  │
│  │ 15 CC  ·  62 BN    │            │             │ [Abrir]     │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ COMARCA B          │ Jose/Marc. │ 10 clientes │ ⬤ Borrador │  │
│  │ 10 CC  ·  34 BN    │            │             │ [Abrir]     │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ Sin hoja hoy:  Pontevedra 1, Pontevedra 2, Orense A...    │  │
│  │                                        [+ Crear hoja]       │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Funcionalidades del panel:**
- Selector de fecha con navegación rápida (anterior/hoy/siguiente)
- Tarjeta resumen por cada hoja existente ese día (ruta, responsable, nº clientes, totales, estado)
- Color del estado: borrador=gris, cerrada=amarillo, planificada=azul, en_reparto=naranja, completada=verde
- Botón para crear nueva hoja (seleccionar ruta y responsable)
- Listado de rutas sin hoja ese día con botón rápido de creación

### 4.3 Vista detalle de una Hoja de Ruta

Al hacer clic en "Abrir" una hoja, se muestra la vista detallada que replica la hoja de papel:

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Volver    COMARCA A    27/03/2026    Resp: Fran    ⬤ Cerrada│
│  ─────────────────────────────────────────────────────────────── │
│                                                                    │
│  [+ Añadir cliente] [Auto-ordenar 🔄] [Imprimir 🖨️] [Cerrar hoja]│
│                                                                    │
│  ┌────┬──────────────────┬──────────┬───────┬──────┬───────────┐  │
│  │ Ord│ CLIENTE          │ ZONA     │ COM.  │ CC   │ OBSERV.   │  │
│  ├────┼──────────────────┼──────────┼───────┼──────┼───────────┤  │
│  │ ☰ 1│ TRADESCANTIA     │ VIGO     │ JAVI  │ 0.50 │ Avda aero │  │
│  │ ☰ 2│ FIGUERAGRO       │ RAM      │ SUSA  │ 2    │           │  │
│  │ ☰ 3│ ORGANIZA NIGRAN  │ NIGRAN   │ SUSA  │ 1    │           │  │
│  │ ☰ 4│ AGRO DAVID       │ CABRAL   │ BETI  │ 0.50 │           │  │
│  │ ☰ 5│ BLANCO (CONTA.1) │ NIGRAN   │ BETI  │ 0+1p │           │  │
│  │ ...│ ...              │ ...      │ ...   │ ...  │ ...       │  │
│  └────┴──────────────────┴──────────┴───────┴──────┴───────────┘  │
│                                                                    │
│  ☰ = drag handle para reordenar arrastrando                       │
│                                                                    │
│  ───────────────────────────────────────────────────────────────── │
│  TOTALES:  15 CC  ·  62 BN  ·  0 L     │  16 clientes           │
│  Estado: [Borrador ▾]                                              │
└──────────────────────────────────────────────────────────────────┘
```

**Funcionalidades de la vista detalle:**

1. **Tabla con las líneas de la hoja** — columnas: Orden, Cliente, Zona, Comercial, CC Aprox, Observaciones, Estado
2. **Drag & drop para reordenar** — el icono ☰ permite arrastrar filas para cambiar el orden de descarga manualmente
3. **Botón "Auto-ordenar"** — invoca el optimizador de rutas existente (`RouteController`) para calcular el orden óptimo de las paradas basándose en las coordenadas de los clientes y la delegación de salida. Actualiza el campo `orden_descarga` de cada línea
4. **Botón "Añadir cliente"** — modal para seleccionar un cliente (de los asignados a la ruta o búsqueda libre) y añadirlo a la hoja con vendedor, CC y observaciones
5. **Edición inline** — clic en cualquier celda para editar (CC, observaciones, comercial)
6. **Botón "Imprimir"** — genera una vista limpia optimizada para impresión que replica el formato de la hoja de papel actual (tabla con cabecera de ruta, fecha, responsable y totales)
7. **Selector de estado** — permite cambiar el estado de la hoja (borrador → cerrada → planificada → en_reparto → completada)
8. **Marcar entregas** — en estado "en_reparto", cada línea tiene un checkbox para marcar como entregado/no entregado/cancelado
9. **Totales automáticos** — suma de CC, conteo de clientes, calculados en tiempo real
10. **Visualización en mapa** — al abrir la hoja, mostrar en el mapa los clientes de la hoja con marcadores numerados según el orden de descarga, y la polilínea de la ruta si está auto-ordenada

### 4.4 Modal "Añadir cliente a hoja"

```
┌────────────────────────────────────────────┐
│  Añadir cliente a la hoja                   │
│                                              │
│  Buscar: [________________] 🔍              │
│                                              │
│  Clientes de Comarca A:                     │
│  ☐ TRADESCANTIA (Vigo)                      │
│  ☐ FIGUERAGRO (Ramallosa)                   │
│  ☐ ORGANIZA NIGRAN (Nigrán)                 │
│  ☐ ...                                      │
│                                              │
│  ── o buscar en todos los clientes ──       │
│  ☐ [resultado de búsqueda libre]            │
│                                              │
│  Comercial: [BETI ▾]  (selector de tabla)   │
│  Nº CC aprox: [___]                         │
│  Observaciones: [________________________] │
│                                              │
│  [Cancelar]  [Añadir seleccionados]         │
└────────────────────────────────────────────┘
```

- Primero muestra los clientes asignados a esa ruta comercial (tabla `clients` con `ruta_id` coincidente) que NO estén ya en la hoja
- Permite buscar en todos los clientes activos
- Selección múltiple (varios clientes a la vez)
- Comercial y CC se aplican a todos los seleccionados (editable después en la tabla)

### 4.5 Vista de impresión

Al pulsar "Imprimir" se abre una ventana/pestaña nueva con un HTML limpio para `window.print()` que replica exactamente el formato de la hoja de papel actual:

```
                        COMARCA A
                    27/03/2026 - Fran

 Nº │ CLIENTE           │ ZONA         │ COM. │ ORD │ Nº CC │ OBSERV.
────┼───────────────────┼──────────────┼──────┼─────┼───────┼──────────
  1 │ TRADESCANTIA      │ VIGO         │ JAVI │     │  0.50 │ Avda...
  2 │ FIGUERAGRO        │ RAM          │ SUSA │     │  2    │
  3 │ ORGANIZA NIGRAN   │ NIGRAN       │ SUSA │     │  1    │
 ...│ ...               │ ...          │ ...  │     │  ...  │ ...

                    TOTALES: 15 CC · 62 BN · 0 L
```

- Usar CSS `@media print` para ocultar elementos de navegación
- Tabla con bordes claros, fuente legible
- Columna "ORD" vacía si logística aún no asignó orden (para que el repartidor lo escriba a mano si es necesario)
- Incluir espacio para firma/notas al pie

---

## 5. INTEGRACIÓN CON EL SISTEMA EXISTENTE

### 5.1 Conexión Hojas de Ruta ↔ Pedidos (orders)

- Cuando el comercial añade un cliente a la hoja con CC y observaciones, se debe **crear o actualizar automáticamente** el pedido (`orders`) para ese cliente en esa fecha
- El campo `order_id` en `hoja_ruta_lineas` vincula la línea con el pedido
- Si el pedido ya existe (otro comercial lo creó), se actualiza
- Si se elimina una línea de la hoja, el pedido NO se elimina (puede seguir existiendo independientemente)

### 5.2 Conexión Hojas de Ruta ↔ Optimización de Rutas (route_plans)

- El botón **"Auto-ordenar"** debe:
  1. Tomar los `client_id` de todas las líneas de la hoja
  2. Determinar la delegación de salida (por la delegación asignada a los clientes o la más cercana)
  3. Construir la matriz de distancias OSRM (usando `DistanceCache`)
  4. Ejecutar el algoritmo nearest-neighbor + 2-opt existente en `RouteController`
  5. Devolver el orden óptimo
  6. Actualizar el campo `orden_descarga` de cada línea según ese orden
  7. Mostrar la ruta en el mapa con marcadores numerados

- Opcionalmente, el botón **"Vincular con plan"** crea un `route_plan` formal a partir de la hoja, para poder usar el tracking de paradas (arrived/completed/skipped) del sistema existente

### 5.3 Conexión con Rutas Comerciales (rutas)

- Cada hoja está vinculada a una ruta comercial (`ruta_id`)
- Al crear una hoja, se precargan los clientes asignados a esa ruta (pero el comercial puede añadir/quitar)
- La zona del cliente se autocompleta desde la dirección del cliente si está disponible

### 5.4 Conexión con Comerciales (tabla existente)

- La tabla `comerciales` ya existe con 52 registros y `clients.comercial_id` ya vincula cada cliente con su comercial
- Al añadir un cliente a la hoja, el `comercial_id` se precarga automáticamente desde `clients.comercial_id` (pero se puede cambiar con un selector)
- Al crear un pedido desde la hoja, se registra el `comercial_id` en la tabla `orders`
- Se puede filtrar el historial de pedidos por comercial
- Dashboard: pedidos por comercial, rutas cubiertas, etc.

---

## 6. FUNCIONALIDADES ADICIONALES

### 6.1 Cálculo de totales de carga

En las hojas de papel se anotan totales al pie: "15CC 62BN", "10CC 34BN 62Bz", "16CC 10C 86 20L".

Estos representan diferentes tipos de producto/envase:
- **CC** = Cajas de Cartón (unidad estándar de carga)
- **BN** = Bidones
- **L** = Litros (producto a granel)

**Implementación:** Los totales se calculan automáticamente a partir de los productos del pedido (tabla `order_items`). Si no hay productos detallados, se usa el campo `cc_aprox` como estimación rápida. Mostrar ambos en la hoja: el CC aproximado del comercial y el desglose real si hay productos.

### 6.2 Panel de resumen diario para logística

Añadir al dashboard existente (pestaña Historial) una vista "Resumen del día":

```
┌──────────────────────────────────────────────────────────────────┐
│  📊 RESUMEN 27/03/2026                                           │
│                                                                    │
│  Hojas: 4 (2 cerradas, 1 planificada, 1 en borrador)            │
│  Total clientes: 45                                                │
│  Total CC: 46    Total BN: 162    Total L: 20                     │
│                                                                    │
│  Por ruta:                                                         │
│  · Comarca A (Fran): 16 clientes, 15CC, 62BN — Cerrada           │
│  · Comarca B (Jose): 10 clientes, 10CC, 34BN — Cerrada           │
│  · Elvis: 9 clientes, 5CC, 6BN — Borrador                        │
│  · Ruta 4: 15 clientes, 15CC, 40L — Planificada                  │
│                                                                    │
│  Por comercial:                                                     │
│  · BETI: 28 pedidos                                                │
│  · SUSA: 12 pedidos                                                │
│  · JAVI: 3 pedidos                                                 │
│  · Pablo: 8 pedidos                                                │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3 Histórico de hojas de ruta

- Filtrar hojas por rango de fechas, ruta, responsable, estado
- Ver la evolución: cuántas hojas por día, clientes atendidos, CC total
- Comparar con días/semanas anteriores

### 6.4 Duplicar hoja del día anterior

Botón "Copiar de ayer" o "Copiar de la semana pasada" que crea una nueva hoja con los mismos clientes que la hoja de esa ruta en la fecha seleccionada (útil porque muchas rutas son recurrentes con los mismos clientes).

### 6.5 Clientes marcados como "no visitado" / "cancelado"

En las hojas de papel se ve que algunos clientes están tachados (ej: NOQUERENTE, SIVAR, BORA en la foto 4). Implementar estados por línea:
- **pendiente** — por entregar
- **entregado** — entrega completada (marcado con X en las hojas)
- **cancelado** — cliente canceló o no se pudo visitar (tachado en las hojas)
- **no_entregado** — se intentó pero no fue posible

---

## 7. DISEÑO RESPONSIVE / MÓVIL

Los comerciales usarán esto en el campo desde el móvil. La vista de "añadir pedidos a la hoja" debe ser **mobile-first**:

### 7.1 Vista móvil del comercial

```
┌─────────────────────────────┐
│  COMARCA A · 27/03/2026     │
│  Comercial: BETI            │
│  ─────────────────────────  │
│                              │
│  🔍 Buscar cliente...       │
│                              │
│  ✅ TRADESCANTIA  · 0.50 CC │
│     VIGO · JAVI             │
│  ✅ FIGUERAGRO    · 2 CC    │
│     RAM · SUSA              │
│  ☐ ORGANIZA NIGRAN          │
│     NIGRAN                   │
│  ✅ AGRO DAVID    · 0.50 CC │
│     CABRAL                   │
│  ...                         │
│                              │
│  [+ Añadir otro cliente]    │
│  ─────────────────────────  │
│  Total: 12 clientes · 9 CC │
│  [Cerrar hoja ✓]            │
└─────────────────────────────┘
```

**Comportamiento móvil:**
- Lista de clientes de la ruta con checkbox para marcar los que tienen pedido
- Al marcar un cliente, aparece campo inline para CC aprox y observaciones
- Input numérico grande para CC (fácil de tocar)
- Botón de cerrar hoja prominente al final
- Sin mapa en vista móvil (ahorra datos y batería)
- Funciona offline (guardar en localStorage y sincronizar cuando haya conexión) — FASE 2, no implementar ahora

### 7.2 Detección de vista

- Detectar `window.innerWidth < 768` para activar vista móvil
- En móvil: ocultar mapa, simplificar tabla a lista de tarjetas
- En escritorio: mantener la vista completa con mapa y tabla

---

## 8. RUTAS EN `index.php`

Registrar las nuevas rutas en el Router:

```php
// Hojas de Ruta
$router->get('/api/hojas-ruta', 'HojaRutaController@index');
$router->get('/api/hojas-ruta/{id}', 'HojaRutaController@show');
$router->post('/api/hojas-ruta', 'HojaRutaController@store');
$router->put('/api/hojas-ruta/{id}', 'HojaRutaController@update');
$router->delete('/api/hojas-ruta/{id}', 'HojaRutaController@destroy');
$router->put('/api/hojas-ruta/{id}/estado', 'HojaRutaController@updateEstado');
$router->post('/api/hojas-ruta/{id}/lineas', 'HojaRutaController@addLinea');
$router->put('/api/hojas-ruta/{id}/lineas/{lineaId}', 'HojaRutaController@updateLinea');
$router->delete('/api/hojas-ruta/{id}/lineas/{lineaId}', 'HojaRutaController@removeLinea');
$router->put('/api/hojas-ruta/{id}/reordenar', 'HojaRutaController@reorder');
$router->post('/api/hojas-ruta/{id}/auto-ordenar', 'HojaRutaController@autoOrder');
$router->get('/api/hojas-ruta/{id}/imprimir', 'HojaRutaController@print');
$router->post('/api/hojas-ruta/{id}/vincular-plan', 'HojaRutaController@linkPlan');
$router->post('/api/hojas-ruta/{id}/duplicar', 'HojaRutaController@duplicate');
```

---

## 9. ARCHIVOS A CREAR O MODIFICAR

### Nuevos archivos:
| Archivo | Descripción |
|---------|-------------|
| `sql/migration_hojas_ruta.sql` | Tablas hojas_ruta + hoja_ruta_lineas |
| `sql/migration_orders_comercial.sql` | ALTER orders para añadir comercial_id, cc_aprox, observaciones |
| `models/HojaRuta.php` | Modelo de hojas de ruta con líneas |
| `controllers/HojaRutaController.php` | CRUD hojas de ruta con toda la lógica |

### Archivos a modificar:
| Archivo | Cambios |
|---------|---------|
| `index.php` | Registrar nuevas rutas del router |
| `models/Order.php` | Añadir campos comercial_id, cc_aprox, observaciones |
| `controllers/OrderController.php` | Soportar campos nuevos en CRUD |
| `controllers/RutaController.php` | Endpoint clientes-pedidos por ruta y fecha |
| `views/app.php` | Nueva pestaña "Hojas de Ruta" |
| `public/js/app.js` | Toda la lógica frontend de hojas de ruta, drag&drop |
| `public/css/app.css` | Estilos para hojas de ruta, vista móvil, vista impresión |

---

## 11. ORDEN DE IMPLEMENTACIÓN RECOMENDADO

1. **Fase 1 — Base de datos:** Ejecutar las 2 migraciones SQL (hojas_ruta, orders alter)
2. **Fase 2 — Backend hojas de ruta:** Modelo + Controlador + Rutas (incluye endpoint /api/comerciales)
3. **Fase 3 — Modificar orders:** Añadir campos comercial/cc_aprox/observaciones al modelo y controlador existentes
4. **Fase 4 — Frontend hojas de ruta:** Panel principal + vista detalle + drag&drop
5. **Fase 5 — Auto-ordenar:** Integración con el optimizador existente
6. **Fase 6 — Vista impresión:** HTML para imprimir hojas
7. **Fase 7 — Vista móvil:** Responsive design para comerciales
8. **Fase 8 — Dashboard:** Resumen diario y estadísticas por comercial

---

## 12. NOTAS IMPORTANTES DE IMPLEMENTACIÓN

- **No crear un framework nuevo.** Seguir exactamente los patrones del código existente: mismo estilo de modelos (extienden `Model`), controladores (extienden `Controller`), y el router existente en `core/Router.php`.
- **El frontend es vanilla JS.** No introducir React, Vue ni ningún framework. Seguir el patrón de `app.js` con funciones globales, fetch para API calls, y manipulación directa del DOM.
- **Drag & drop:** Usar la API nativa de HTML5 Drag and Drop o una librería minimalista como SortableJS (CDN). No introducir dependencias pesadas.
- **Los decimales CC usan coma en España** (0,50 en vez de 0.50). Aceptar ambos formatos en el input y normalizar a punto en el backend.
- **Mapa:** Reutilizar la instancia de mapa Leaflet existente. Al abrir una hoja, mostrar los clientes con marcadores numerados. Si hay auto-orden, dibujar la polilínea de la ruta.
- **Estado de la hoja controla permisos:** En estado "borrador" todo es editable. En "cerrada" solo logística puede modificar. En "planificada" solo se puede cambiar estado. En "en_reparto" solo se puede marcar entregas. En "completada" es solo lectura.
- **Respetar la constraint UNIQUE de orders** (client_id, order_date). Si ya existe un pedido para ese cliente en esa fecha, actualizar en vez de crear.
- **Zona del cliente:** Autocompletar desde el campo `address` del cliente si contiene el nombre de la localidad, o permitir edición libre.

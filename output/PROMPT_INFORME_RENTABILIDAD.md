# PROMPT PARA CLAUDE CODE — Informe de Rentabilidad de Rutas por Distancia

Crea el script `scripts/informe_rutas.py` que genera un informe HTML interactivo analizando qué clientes son rentables para reparto en ruta propia y cuáles deberían enviarse por paquetería, basándose exclusivamente en distancias por carretera (OSRM). El informe es para presentar a dirección de la empresa.

---

## CONTEXTO DEL PROYECTO

Este proyecto es un **Gestor de Rutas** con stack PHP/MySQL/JS (Leaflet). La estructura relevante es:

### Base de datos MySQL
- **Host**: `127.0.0.1`, **Puerto**: `3308`, **User**: `root`, **Password**: (vacío), **DB**: `gestorrutas`
- Referencia de credenciales: `config/database.php`

### Tablas relevantes (consultar los modelos PHP para confirmar estructura exacta):

**`clients`** (ver `models/Client.php`):
```
id INT, name VARCHAR, address VARCHAR, phone VARCHAR, notes TEXT,
x DECIMAL(9,6)  -- LATITUD del cliente,
y DECIMAL(9,6)  -- LONGITUD del cliente,
open_time TIME, close_time TIME,
delegation_id INT (FK a delegations),
ruta_id INT (FK a rutas) -- RUTA COMERCIAL asignada,
active TINYINT(1),
created_at, updated_at
```

**`rutas`** (ver `models/Ruta.php`) — rutas comerciales / territorios:
```
id INT, name VARCHAR, active TINYINT(1), created_at, updated_at
```

**`delegations`** (ver `models/Delegation.php`) — almacenes / centros de distribución:
```
id INT, name VARCHAR, address VARCHAR, x DECIMAL(9,6) -- lat, y DECIMAL(9,6) -- lng,
open_time TIME, close_time TIME, active TINYINT(1)
```

**`distance_cache`** (ver `models/DistanceCache.php`) — caché de distancias OSRM ya calculadas:
```
id INT AUTO_INCREMENT,
origin_lat DECIMAL(8,5), origin_lng DECIMAL(8,5),
dest_lat DECIMAL(8,5), dest_lng DECIMAL(8,5),
distance_km DOUBLE, duration_s DOUBLE,
created_at TIMESTAMP,
UNIQUE KEY uq_pair (origin_lat, origin_lng, dest_lat, dest_lng)
```
**IMPORTANTE**: Las coordenadas en `distance_cache` se redondean a 5 decimales. Replicar este comportamiento al consultar/insertar caché.

### API de distancias — OSRM (Open Source Routing Machine)
Ya se usa en el proyecto. Ver implementación PHP en `models/DistanceCache.php`:

- **Ruta entre 2 puntos**: `https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=false`
- **Ruta con geometría completa** (para dibujar en mapa): `https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson`
- **Ruta multi-waypoint** (para ruta optimizada): `https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2};...;{lngN},{latN}?overview=full&geometries=geojson`
- **Tabla de distancias NxN**: `https://router.project-osrm.org/table/v1/driving/{coords}?annotations=distance,duration`
- **Formato coordenadas**: siempre `longitud,latitud` (y,x en términos de la BD)
- **IMPORTANTE**: La API pública tiene rate limiting. Meter 50-100ms de delay entre llamadas. Usar `distance_cache` para no repetir consultas.
- **Fallback Haversine**: Si OSRM falla, calcular distancia en línea recta con fórmula Haversine (R=6371 km) y estimar duración a 50 km/h.

### Referencia de colores (ver `public/js/app.js`):
```javascript
const RUTA_COLORS = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#2c3e50','#d35400','#8e44ad','#16a085','#c0392b','#27ae60','#2980b9','#f1c40f'];
```

---

## ALGORITMO DE ANÁLISIS

### Paso 1: Obtener datos
```python
# Pseudocódigo
clientes = SELECT c.*, r.name as ruta_name
           FROM clients c
           LEFT JOIN rutas r ON c.ruta_id = r.id
           WHERE c.active = 1 AND c.x IS NOT NULL AND c.y IS NOT NULL

delegaciones = SELECT * FROM delegations WHERE active = 1

rutas = SELECT * FROM rutas
```

### Paso 2: Asignar delegación a cada ruta
Cada ruta comercial necesita un punto de origen (delegación). Como no hay FK directa ruta→delegación:
1. Para cada ruta, buscar los clientes que tienen `delegation_id` definido y coger la delegación más frecuente.
2. Si ningún cliente tiene `delegation_id`, usar la delegación más cercana al centroide de los clientes de esa ruta.
3. Si solo hay una delegación activa, usar esa.

### Paso 3: Calcular desvío incremental por cliente
Para cada ruta comercial con sus clientes:

```
FUNCIÓN calcular_desvio(delegacion, clientes):
    # 1. Construir ruta óptima con TODOS los clientes
    ruta_completa = optimizar_ruta(delegacion, clientes)  # Nearest Neighbor + 2-opt
    distancia_total = calcular_distancia_ruta(ruta_completa)  # OSRM waypoints

    # 2. Para cada cliente, calcular cuánto aporta quitarlo
    PARA CADA cliente EN clientes:
        clientes_sin = clientes - {cliente}
        ruta_sin = optimizar_ruta(delegacion, clientes_sin)
        distancia_sin = calcular_distancia_ruta(ruta_sin)

        cliente.desvio_km = distancia_total - distancia_sin
        cliente.distancia_delegacion = distancia_osrm(delegacion, cliente)
        cliente.vecino_mas_cercano_km = min(distancia_osrm(cliente, otro) para otro en clientes_sin)
```

**Algoritmo de optimización de ruta (Nearest Neighbor + 2-opt)**:
- Ya implementado en PHP en `controllers/RouteController.php` (líneas ~395-651). Replicar en Python:
  1. **Nearest Neighbor**: Empezar en delegación, ir al cliente más cercano no visitado, repetir. Terminar volviendo a delegación.
  2. **2-opt**: Iterar intentando invertir segmentos de la ruta. Si invertir un segmento reduce la distancia total, aceptar el cambio. Repetir hasta que no haya mejora.

**Para las distancias entre puntos**:
- PRIMERO consultar `distance_cache` en BD (redondear coords a 5 decimales)
- Si no hay caché, llamar a OSRM y guardar resultado en `distance_cache`
- Delay de 50ms entre llamadas OSRM

### Paso 4: Clasificación de clientes
Umbrales configurables al inicio del script:
```python
UMBRAL_RENTABLE = 5      # km — por debajo es rentable
UMBRAL_REVISAR = 15      # km — entre 5 y 15 es revisar, por encima NO RENTABLE
```

| Clasificación | Desvío km | Color |
|---|---|---|
| RENTABLE | < 5 km | Verde (#2ecc71) |
| REVISAR | 5 - 15 km | Naranja (#f39c12) |
| NO RENTABLE | > 15 km | Rojo (#e74c3c) |

### Paso 5: Análisis de reasignación
Para cada cliente clasificado como NO RENTABLE o REVISAR:
1. Calcular qué desvío tendría si se añadiese a cada una de las OTRAS rutas
2. Si alguna ruta le genera un desvío < UMBRAL_RENTABLE → sugerir reasignación
3. Almacenar: `ruta_actual`, `desvio_actual`, `ruta_sugerida`, `desvio_nuevo`

### Paso 6: Recalcular rutas optimizadas SIN los no rentables
Para cada ruta:
1. Quitar todos los clientes NO RENTABLE
2. Recalcular ruta óptima con los restantes
3. Calcular distancia nueva y ahorro en km

---

## GENERACIÓN DEL INFORME HTML

Crear un **único archivo HTML autocontenido** (sin dependencias externas excepto CDNs de Leaflet/OSM) en `output/informe_rentabilidad_rutas.html`.

### Estructura del HTML:

#### A. Cabecera y estilos
- Título: "Informe de Rentabilidad de Rutas — Análisis por Distancia"
- Fecha de generación
- CSS embebido profesional (colores corporativos, tablas zebra-striped, cards con sombras)
- Leaflet CSS desde CDN: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`
- Leaflet JS desde CDN: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- Fuente: system-ui o similar profesional

#### B. Resumen ejecutivo (dashboard)
Cards con KPIs:
- Total clientes analizados
- Clientes RENTABLE (count + %)
- Clientes REVISAR (count + %)
- Clientes NO RENTABLE (count + %)
- Km totales actuales (suma de todas las rutas)
- Km tras eliminar no rentables
- **Ahorro potencial en km** (diferencia)
- **Ahorro potencial en km/año** (ahorro diario * días laborables estimados, ej: 250)

#### C. Mapa general (vista global)
- Mapa Leaflet con TODOS los clientes de TODAS las rutas
- Marcadores coloreados por clasificación (verde/naranja/rojo)
- Delegaciones con icono especial (marcador azul grande o icono de almacén)
- Popup en cada marcador: nombre cliente, ruta, desvío km, clasificación
- Leyenda del mapa
- **Checkbox/toggle**: "Mostrar solo rentables" → al activar, oculta los no rentables y redibuja las rutas optimizadas sin ellos
- Las polylines de cada ruta con el color de su ruta (usar RUTA_COLORS)

#### D. Secciones por ruta comercial
Para cada ruta (ordenadas por ahorro potencial descendente):

**D.1 Cabecera de ruta:**
- Nombre de ruta
- Delegación de origen
- Num clientes total / rentables / revisar / no rentables
- Km ruta actual vs km ruta optimizada (sin no rentables)
- Ahorro km y % de mejora

**D.2 Mapa de la ruta (dos capas toggleables):**
- **Capa "Ruta Actual"**: Polyline OSRM con todos los clientes, marcadores por color
- **Capa "Ruta Optimizada"**: Polyline OSRM sin no rentables, solo marcadores verdes/naranja
- Los marcadores rojos (no rentables) se muestran en ambas capas pero con opacidad reducida en la optimizada
- Usar L.control.layers para toggle entre capas
- Polyline: obtener geometría real de OSRM con `overview=full&geometries=geojson` para la ruta multi-waypoint

**D.3 Tabla de clientes de la ruta:**
```
| # | Cliente | Dirección | Desvío (km) | Dist. Delegación (km) | Vecino más cercano (km) | Clasificación |
```
- Ordenada por desvío descendente (los peores primero)
- Filas coloreadas según clasificación (fondo suave: verde claro, naranja claro, rojo claro)
- Filtro/búsqueda por nombre
- Columna clasificación con badge de color

#### E. Tabla de reasignaciones sugeridas
```
| Cliente | Ruta Actual | Desvío Actual (km) | Ruta Sugerida | Desvío Nuevo (km) | Ahorro (km) |
```
- Solo clientes que tienen una ruta alternativa mejor
- Ordenada por ahorro descendente

#### F. Conclusiones automáticas
Generar un párrafo de texto con:
- "Se identificaron X clientes que generan un sobrecoste de Y km adicionales por jornada"
- "Eliminando estos clientes de las rutas, el ahorro anual estimado sería de Z km"
- "Se sugiere la reasignación de N clientes a rutas más eficientes"
- "Los restantes M clientes deberían evaluarse para envío por paquetería"

---

## DATOS JSON DE SALIDA

Además del HTML, generar `output/datos_rentabilidad.json` con estructura:
```json
{
  "fecha_generacion": "2026-03-26T14:30:00",
  "umbrales": {"rentable_km": 5, "revisar_km": 15},
  "resumen": {
    "total_clientes": 150,
    "rentables": 120,
    "revisar": 18,
    "no_rentables": 12,
    "km_actuales": 850.5,
    "km_optimizados": 720.3,
    "ahorro_km": 130.2,
    "ahorro_pct": 15.3
  },
  "rutas": [
    {
      "id": 1,
      "nombre": "Comarca A",
      "delegacion": "Vigo",
      "km_actual": 120.5,
      "km_optimizado": 98.2,
      "ahorro_km": 22.3,
      "clientes": [
        {
          "id": 14,
          "nombre": "A HORTA DE LINA",
          "lat": 42.1234,
          "lng": -8.5678,
          "desvio_km": 0.5,
          "distancia_delegacion_km": 24.8,
          "vecino_cercano_km": 2.3,
          "clasificacion": "RENTABLE",
          "reasignacion_sugerida": null
        }
      ],
      "geometria_ruta_actual": [[lat, lng], ...],
      "geometria_ruta_optimizada": [[lat, lng], ...]
    }
  ],
  "reasignaciones": [
    {
      "cliente_id": 50,
      "nombre": "CLIENTE X",
      "ruta_actual": "Orense A",
      "desvio_actual": 18.5,
      "ruta_sugerida": "Comarca B",
      "desvio_nuevo": 3.2
    }
  ]
}
```

---

## REQUISITOS TÉCNICOS DEL SCRIPT PYTHON

### Dependencias
```python
import mysql.connector    # pip install mysql-connector-python
import requests           # pip install requests
import json
import math
import time
from datetime import datetime
```
NO usar folium ni matplotlib. Todo el HTML se genera con strings/templates Python. Los mapas son Leaflet cargado desde CDN.

### Estructura del script
```
scripts/informe_rutas.py
├── Configuración (DB, umbrales, colores)
├── Clase OSRMClient (con caché en distance_cache)
│   ├── get_distance(lat1, lng1, lat2, lng2) → (km, seconds)
│   ├── get_route_geometry(waypoints) → geojson coords
│   └── haversine_fallback(lat1, lng1, lat2, lng2) → km
├── Clase RouteOptimizer
│   ├── nearest_neighbor(depot, clients) → ordered list
│   ├── two_opt_improve(route, distance_matrix) → improved route
│   └── calculate_route_distance(route) → total km
├── Función cargar_datos() → clientes, rutas, delegaciones
├── Función analizar_ruta(ruta, clientes, delegacion) → resultados
├── Función analizar_reasignaciones(clientes_no_rentables, todas_las_rutas) → sugerencias
├── Función generar_html(datos) → string HTML
├── Función main()
│   ├── Cargar datos
│   ├── Para cada ruta: analizar
│   ├── Analizar reasignaciones
│   ├── Generar JSON
│   ├── Generar HTML
│   └── Guardar archivos en output/
```

### Manejo de errores y logging
- Print de progreso: "Analizando ruta 'Comarca A' (15 clientes)..."
- Print al consultar OSRM: "OSRM: 45/120 distancias calculadas (caché: 30 hits)"
- Si un cliente no tiene coordenadas, skipear con warning
- Si OSRM falla 3 veces seguidas, cambiar a Haversine y avisar

### Performance
- Usar `distance_cache` agresivamente — miles de pares ya están cacheados
- Para la tabla NxN de una ruta, intentar primero `OSRM /table/v1/` (hasta 100 puntos)
- Delay de 50ms solo entre llamadas nuevas a OSRM, no entre consultas a caché
- El 2-opt puede ser costoso: limitar a 1000 iteraciones o 30 segundos por ruta

---

## ASPECTO VISUAL DEL HTML

El HTML debe verse profesional. Referencia de estilo:
- Fondo: #f5f7fa
- Cards: blancas con border-radius: 12px, box-shadow suave
- Cabecera: gradiente azul oscuro (#1a1a2e → #16213e)
- Tablas: header azul oscuro, filas alternas #f8f9fa / blanco
- Badges de clasificación: border-radius pill, fondo del color correspondiente, texto blanco
- KPIs: grid de 4 columnas con número grande y label pequeño debajo
- Mapas: altura 500px, border-radius, borde sutil
- Responsive: max-width 1200px centrado
- Imprimible: @media print para ocultar controles interactivos

### JavaScript embebido en el HTML
- Inicializar mapas Leaflet tras DOMContentLoaded
- Función para toggle de capas (ruta actual / optimizada)
- Función de filtrado de tablas
- Los datos de coordenadas, geometrías y marcadores embebidos como `const DATA = {...}` en un `<script>` tag

---

## EJECUCIÓN

```bash
cd "c:/wamp64/www/Gestor de Rutas"
pip install mysql-connector-python requests
python scripts/informe_rutas.py
```

Salida esperada:
```
Conectando a BD gestorrutas...
Cargados: 156 clientes activos, 8 rutas, 2 delegaciones
Analizando ruta 'Comarca A' (23 clientes)...
  OSRM: calculando matriz de distancias... (caché: 210 hits, nuevas: 46)
  Optimizando ruta (nearest neighbor + 2-opt)...
  Calculando desvíos incrementales...
  → 3 clientes NO RENTABLE, 2 REVISAR
[... resto de rutas ...]
Analizando reasignaciones posibles...
  → 4 reasignaciones sugeridas
Generando HTML...
✓ Informe guardado en: output/informe_rentabilidad_rutas.html
✓ Datos guardados en: output/datos_rentabilidad.json
```

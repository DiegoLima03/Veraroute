# CLAUDE.md — VeraRoute (Gestor de Rutas)

> Contexto de proyecto que Claude debe leer **antes** de actuar. Mantener este fichero actualizado cuando cambien decisiones importantes.

---

## 1. Resumen del proyecto

**VeraRoute** es una aplicación interna de gestión logística para una empresa de distribución (delegaciones, comerciales, hojas de ruta, flota propia y comparativa con paquetería GLS).

- **Ruta del proyecto:** `c:\wamp64\www\Gestor de Rutas`
- **Servida por:** WAMP (Apache) en `http://localhost/Gestor%20de%20Rutas/`
- **Idioma de la UI y comentarios:** español
- **Usuario principal:** admin (gestiona variables, vehículos, configuración GLS)

---

## 2. Stack técnico

| Capa | Tecnología |
|------|------------|
| Backend | PHP **sin framework** (MVC casero — `core/Router.php`, `core/Controller.php`, `core/Model.php`) |
| Base de datos | MySQL en `127.0.0.1:3308`, schema `gestorrutas`, usuario `root` sin password |
| Frontend | HTML + **JavaScript vanilla** (sin React/Vue) + **Leaflet.js** para mapas |
| Routing distancias | **OSRM** público (`router.project-osrm.org`) cacheado en tabla `distance_cache` |
| Geocoding | **Nominatim** (OpenStreetMap) cacheado en `geocode_cache.json` / `reverse_geocode_cache.json` |
| Scripts auxiliares | **Python 3** con `pymysql`, `pdfplumber`, `PyMuPDF (fitz)`, `pandas` |

**No usar:** Composer, npm, build steps, frameworks JS, bundlers. El proyecto es deliberadamente low-tech para que el usuario pueda editarlo sin toolchain.

---

## 3. Estructura de carpetas

```
config/database.php      → conexión PDO MySQL (puerto 3308)
core/                    → Router, Controller, Model, Auth (sesiones)
controllers/             → 14 controladores (uno por entidad)
models/                  → 15 modelos (entidades)
services/
  RouteCostCalculator.php → núcleo del cálculo coste ruta + comparativa GLS
views/app.php            → vista única SPA (todos los modales y paneles)
public/css/app.css       → estilos completos
public/js/app.js         → toda la lógica de UI (~10k+ líneas)
sql/                     → migraciones y seeds
output/                  → informes HTML generados (no es código de producción)
index.php                → router principal con todas las rutas API
login.php                → login independiente
```

---

## 4. Convenciones importantes

### 4.1 Modelos / Controladores
- Los controladores extienden `Controller` y devuelven JSON con `$this->json(...)`.
- Acceso a BD: `Database::connect()` devuelve PDO singleton.
- Las rutas se registran en `index.php` (todas las rutas API empiezan por `api/`).

### 4.2 Frontend
- **Una sola página** (`views/app.php`). Toda la navegación es por pestañas/modales en `app.js`.
- Modales custom usando clases `.overlay`, `.modal`, `.mhead`, `.mbody`, `.mfoot`.
- **No usar `confirm()` nativo** — existe `appConfirm(...)` en `app.js` que abre `#confirmModal`.
- Helpers de formato: `esc()`, `formatMoney()`, `formatQty()`.

### 4.3 Cálculo de coste de ruta (clave del dominio)
Implementado en [services/RouteCostCalculator.php](services/RouteCostCalculator.php).
- **Coste marginal (detour) por cliente:** `(km_ruta_con_cliente − km_ruta_sin_cliente) × coste_por_km_vehiculo`. Es lo que ahorras si externalizas ESE cliente concreto.
- **Coste total ruta:** `total_route_km × coste_por_km_vehiculo` (depot → todos los clientes con carga → depot).
- ⚠️ **Bug conceptual conocido:** la suma de costes marginales puede ser MUCHO menor que el coste total (con pocos clientes). Externalizar individualmente NO equivale a no salir con el camión. Ver [output/fix_recomendacion_global.html](output/fix_recomendacion_global.html) y [output/opciones_caso_mixto.html](output/opciones_caso_mixto.html) para fixes propuestos (NO aplicados aún).

### 4.4 Comparativa GLS
- Tarifa cargada en `carriers`, `carrier_zones`, `carrier_rates`, `carrier_surcharges` (seed: `sql/seed_gls_tariff_2026.sql`).
- Variables clave en `gls_shipping_config`: `price_multiplier` (descuento contractual), `gls_fuel_pct_current` (recargo combustible), `remote_postcode_prefixes` (CPs remotos con sobrecoste).
- ⚠️ **Importante:** `findBestRate()` debe recibir SIEMPRE `price_multiplier` y `fuel_pct_override`. Si se llama sin ellos, el cálculo sale mal (bug histórico ya corregido — no reintroducir).

### 4.5 Vehículos
- 126 vehículos en BD con `cost_per_km` estimado por categoría (Scania/MAN ~0.85, Iveco Daily ~0.50…). Seed: `sql/seed_vehicle_cost_per_km.sql`.
- Al actualizar un vehículo desde el modal Variables, hay que mandar TODOS los campos requeridos (`name`, `delegation_id`, `max_weight_kg`, `max_volume_m3`, `max_items`) o se ponen a NULL.

---

## 5. Base de datos

- **Host:** `127.0.0.1`
- **Puerto:** `3308` (NO 3306)
- **Schema:** `gestorrutas`
- **Usuario:** `root` sin contraseña
- Esquema completo en `sql/schema.sql` + migraciones incrementales en `sql/migration_*.sql`.

Tablas principales: `clients` (4098 reg), `vehicles` (126), `delegations`, `orders`, `hojas_ruta`, `hoja_ruta_lineas`, `rutas`, `distance_cache`, `gls_shipping_config`, `carriers`, `carrier_zones`, `carrier_rates`, `carrier_surcharges`, `client_cost_history`, `app_settings`, `users`.

---

## 6. Comandos útiles

```bash
# Conectar a MySQL del WAMP
"c:/wamp64/bin/mysql/mysql8.4.7/bin/mysql.exe" -h 127.0.0.1 -P 3308 -u root gestorrutas

# Ejecutar un script SQL
"c:/wamp64/bin/mysql/mysql8.4.7/bin/mysql.exe" -h 127.0.0.1 -P 3308 -u root gestorrutas < "sql/migration_xxx.sql"

# Lanzar scripts Python (desde la raíz del proyecto)
python rellenar_cp.py
python importar_tarifas_gls.py
```

No hay tests automatizados ni linter configurado. La validación es manual abriendo la app en el navegador.

---

## 7. Reglas de colaboración (feedback acumulado del usuario)

- **Idioma:** responder en **español**. Comentarios de código en español.
- **Concisión:** respuestas directas, sin preámbulos. El usuario lee el diff, no necesita resúmenes largos.
- **No reescribir lo que no se ha pedido.** Si el fix es de 3 líneas, son 3 líneas — no aprovechar para refactorizar alrededor.
- **No mockear BD ni servicios** en pruebas: el usuario quiere validar contra estado real.
- **Etiquetas UI claras para no-técnicos:** usar `+1.53 km` (con tooltip) en vez de `Km 1.53`; usar `Coste extra:` en vez de `Propio:`. El usuario detectó varias veces que las etiquetas eran ambiguas.
- **Antes de tocar variables financieras** (multiplicador, fuel pct, coste/km), avisar al usuario aunque parezca seguro.
- **Acciones destructivas** (drop, truncate, force push, delete masivo): SIEMPRE pedir confirmación.
- **Commits:** solo cuando el usuario lo pida explícitamente con "commit" / "push".

---

## 8. Estado actual del trabajo (snapshot — actualizar cuando cambie)

- ✅ CPs de clientes rellenos (3908/4098 ≈ 95.4%) vía cruce con CSV de Velneo + reverse geocoding.
- ✅ Tarifa GLS 2026 completa cargada (123 tarifas, 35 zonas, 12 surcharges).
- ✅ Bug `price_multiplier`/`fuel_pct` no aplicados → CORREGIDO en `RouteCostCalculator.php`.
- ✅ Modal "Variables" en header (admin only) con pestañas App / GLS / Vehículos.
- ✅ Tarjeta "Ruta total" en resumen GLS (5ª tarjeta con km y coste totales).
- ⚠️ **Pendiente de aplicar (solo documentado):**
  1. Fix recomendación global (`global_recommendation = externalize_all|do_route|mixed`) — ver `output/fix_recomendacion_global.html`.
  2. Tratamiento del caso mixto (clientes parcialmente externalizables) — 4 opciones en `output/opciones_caso_mixto.html`. La opción A (búsqueda combinatoria 2^N) es la recomendada como punto de partida. **Requiere aplicar primero el fix global.**

---

## 9. Antes de actuar — checklist rápido

1. ¿Estoy tocando `RouteCostCalculator.php`? → Releer la sección **4.3** y NO tocar `findBestRate()` sin pasar multiplicador y fuel.
2. ¿Estoy añadiendo un `confirm()` o `alert()`? → Usar `appConfirm()` / modal custom.
3. ¿Estoy creando un modelo/controlador nuevo? → Registrarlo en `index.php` y seguir el patrón de los existentes.
4. ¿Estoy ejecutando SQL destructivo? → Pedir confirmación al usuario.
5. ¿Estoy generando un informe explicativo? → Va a `output/` como `.html`, **no** como `.md` ni `.docx` (preferencia explícita del usuario).
6. ¿Voy a hacer commit? → Solo si el usuario lo ha pedido en este turno.

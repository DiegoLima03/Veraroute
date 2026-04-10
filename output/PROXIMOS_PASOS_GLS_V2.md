# PROXIMOS PASOS - Modulo GLS VeraRoute (post integracion)

> Fecha: 10 de abril de 2026
> Estado: Tarifas GLS 2026 cargadas + comparativa flota/GLS funcionando end-to-end + informe de rentabilidad operativo

---

## LO QUE SE ACABA DE IMPLEMENTAR

### Bug critico arreglado: descuento y combustible no se aplicaban
El `RouteCostCalculator` llamaba a `findBestRate` SIN pasarle `price_multiplier` ni `fuel_pct_override`. Resultado: aunque la BD tuviera un descuento o combustible configurados, el calculo siempre devolvia el precio base. Ahora pasa los tres parametros (multiplier, fuel, remote_postcode_prefixes) leidos desde `gls_shipping_config`.

**Verificacion end-to-end:**
- Hoja 14, 1 cliente con 2 carros + 4 cajas = 28 kg
- 136 km de desvio
- Vehiculo con 0,55 €/km
- **Coste flota propia: 74,83 €**
- **Coste GLS Business Parcel zona 1: 8,10 €** (5,08 base banda 10-15kg + 13×0,20 adicional + 5,5% combustible)
- **Recomendacion: externalize** (ahorro 66,72 €)

### UI Settings ampliada (`Settings → Paqueteria por tablas`)
Nuevos campos visibles y editables:
- **Descuento negociado (multiplier)** - 1.0000 = sin descuento, 0.85 = 15% descuento
- **Recargo combustible GLS (%)** con boton "Aplicar" rapido
- **Codigos postales remotos** (lista separada por comas)

### Boton "Aplicar combustible" (Paso 4 del prompt anterior)
Endpoint dedicado `PUT /api/shipping-config/fuel` que solo actualiza el % de combustible. La UI tiene un boton "Aplicar" al lado del campo que dispara una confirmacion (modal custom) y guarda solo ese campo, sin tocar el resto de Settings.

### Panel de alertas de cobertura GLS
Nueva seccion en Settings que muestra:
- Total clientes activos
- Cuantos sin CP / sin coordenadas (deberia ser 0 actualmente)
- Lista de CP que NO tienen zona asignada en `carrier_zones` (con el numero de clientes afectados y ejemplos)
- Endpoint: `GET /api/shipping-config/alerts`

Actualmente devuelve "✓ Todos los CP tienen zona GLS asignada" porque la zona 3 (Nacional) usa wildcard `*`.

### Informe de rentabilidad GLS (Paso 3)
Nuevo modal accesible desde **Historial → boton "Rentabilidad GLS"** (esquina superior derecha del panel).

Permite seleccionar un rango de fechas y muestra:
- **Totales del periodo**: entregas, km, coste flota, coste GLS, ahorro potencial
- **Tabla por dia**: fecha, entregas, km, coste flota, coste GLS, ahorro
- **Tabla por ruta comercial**: ruta, entregas, km, costes, ahorro, % entregas que saldrian mejor por GLS
- **Top 25 clientes a externalizar**: ranking por mayor ahorro acumulado

Endpoint: `GET /api/shipping-costs/range-report?from=YYYY-MM-DD&to=YYYY-MM-DD`

Modelo: `ClientCostHistory::getRangeReport()` - hace 4 queries agregadas (totales + por dia + por ruta + top clientes).

---

## ARQUITECTURA RESULTANTE

```
┌──────────────────────────────────────────────────────────┐
│  UI: Settings → Paqueteria                                │
│   ├── Multiplier descuento  ──┐                          │
│   ├── % combustible          ─┤                          │
│   ├── CP remotos             ─┤                          │
│   └── [Boton Aplicar fuel]   ─┤                          │
└────────────────────────────────┼──────────────────────────┘
                                 │
                       ┌─────────▼──────────┐
                       │ gls_shipping_config│
                       └─────────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
┌─────────────────────┐ ┌────────────────┐ ┌──────────────┐
│ RouteCostCalculator │ │  carrier_*     │ │ Informe      │
│ (servicio backend)  │ │  (catalogo)    │ │ rentabilidad │
└─────────────────────┘ └────────────────┘ └──────────────┘
              │
              ▼
┌─────────────────────────┐
│ hoja_ruta_lineas        │ ← cost_own_route, cost_gls_*,
│  + client_cost_history  │   recommendation, savings
└─────────────────────────┘
```

---

## QUE HACE FALTA TODAVIA

### Critico (bloqueante para uso real)

- [ ] **Aplicar descuento negociado real** - Sacar del contrato GLS el % que tenemos negociado y configurarlo en Settings → Multiplier (ej: 0.78 para 22% descuento). Por defecto esta a 1.0000.
- [ ] **Confirmar % combustible vigente** - El valor actual es 5.50% (estimacion). Hay que comprobar el valor real en https://www.viagalicia.com/tasa-energetica/ y aplicarlo con el boton de Settings.
- [ ] **Asignar `cost_per_km` a TODOS los vehiculos** - Sin esto, las hojas con vehiculo asignado igual no calculan el coste flota propia. Actualmente solo el vehiculo `id=3` tiene cost_per_km=0.55 (test). Hay que configurar el coste real de cada vehiculo en Flota.
- [ ] **Confirmar peso medio carro/caja con el cliente** - Actualmente: carro 8 kg, caja 3 kg. Esto afecta directamente al peso facturable y por tanto a la banda de tarifa GLS.

### Importante (para que el informe sea util)

- [ ] **Forzar recalculo masivo de todas las hojas existentes** - El informe solo muestra entregas que ya fueron calculadas. Hay que ejecutar `POST /api/shipping-costs/recalculate` con `force=true` para cada fecha del historico, o anadir un boton "Recalcular todo el mes" en la UI del informe.
- [ ] **Recalculo automatico al cambiar config** - Si el usuario cambia el multiplier o el combustible, las hojas ya calculadas mantienen los valores antiguos. Habria que invalidar (NULL) todos los `cost_*` en `hoja_ruta_lineas` para que la proxima vez que se vea la hoja se recalculen, o anadir un boton "Recalcular todo".
- [ ] **Lista oficial CP remotos GLS** - Pedir a GLS la lista oficial de CPs donde aplica el recargo de zona remota (Mallorca, Menorca, Ibiza, La Palma, etc. ya estan marcados como `remoto=1` en `carrier_zones`, pero peninsula puede tener mas). Verificar el importe del recargo `remoto` en `carrier_surcharges` (actualmente esta a 0.00 € que es el valor neutro).

### Mejoras de UX

- [ ] **Boton "Recalcular paqueteria" en el modal del informe** - Que dispare un recalculo del rango seleccionado y refresque la tabla.
- [ ] **Exportar informe a CSV/PDF** - El modal de rentabilidad solo se ve en pantalla. Anadir botones para descargar como CSV o imprimir como PDF.
- [ ] **Filtros adicionales en el informe** - Por ruta, por comercial, por vehiculo. Util para preguntas tipo "cuanto me costaria si externalizo solo Comarca A".
- [ ] **Cache de calculos por fecha** - Evitar recalcular hojas ya cerradas. Ya hay un mecanismo (`lineHasComputedCosts`), verificar que funcione bien.
- [ ] **Indicador de antiguedad del calculo** - Si una hoja se calculo con un combustible antiguo, marcarlo en la UI con un "tag" naranja. Permitir al usuario ver con que parametros se calculo cada linea.

### Datos pendientes (informacion del cliente)

- [ ] **Tarifa Economy Parcel** - El PDF no incluye la tarifa de Economy Parcel (el servicio mas barato 48/72h). Si lo necesitamos, pedirla a GLS.
- [ ] **Verificar bandas Portugal intermedias** - El PDF de PT solo muestra bandas 1kg, 3kg, 10kg, 15kg + adicional. Faltan 5kg en algunos servicios. Confirmar con GLS.
- [ ] **CP origen real** - Actualmente 36214 (Vigo generico). Verificar con el cliente si hay un almacen central con CP especifico.
- [ ] **Provincias 24h Business Parcel** - Las provincias listadas en el PDF (24h en BP) son: Asturias, Avila, Cantabria, A Coruña, Leon, Lugo, Madrid, Orense, Palencia, Pontevedra, Salamanca, Segovia, Valladolid, Zamora. **Esto NO afecta al precio**, solo al SLA, pero si queremos mostrarlo en la UI hay que cargarlo.

### Funcionalidad avanzada (futuro)

- [ ] **Comparar contra factura real GLS** - Cuando llegue la primera factura, importarla y comparar linea a linea contra `client_cost_history`. Detectar discrepancias > 5%.
- [ ] **Auto-deteccion del descuento real** - Si las facturas reales son sistematicamente X% mas baratas que el calculo, sugerir actualizar el `price_multiplier`.
- [ ] **Multi-carrier** - El sistema esta preparado para varios carriers (DHL, MRW, Seur). Cargar tarifas de otros transportistas y dejar que `quoteShipment()` elija el mas barato automaticamente.
- [ ] **Servicio elegible por linea** - Hoy se elige siempre el servicio mas barato. Permitir forzar un servicio especifico (ej: Express 10:30 para clientes urgentes).
- [ ] **Integracion API GLS real** - Hay campos `api_user`, `api_password`, `api_env`, `api_base_url` en `gls_shipping_config` pero no se usan. Si GLS proporciona una API, integrarla para confirmar precios en tiempo real.

---

## FICHEROS MODIFICADOS EN ESTA ITERACION

| Fichero | Cambios |
|---------|---------|
| `services/RouteCostCalculator.php` | Pasa `price_multiplier`, `fuel_pct_override` y `remote_postcode_prefixes` a `findBestRate()`. Guarda `cost_gls_raw` separado de `cost_gls_adjusted`. Actualiza `price_multiplier_used` en historial. |
| `controllers/GlsCostController.php` | `getConfigPayload()` ahora devuelve multiplier+fuel+remotes. Validacion en `updateConfig`. Nuevos endpoints `updateFuelPct()`, `getAlerts()`, `getRangeReport()`. |
| `models/ClientCostHistory.php` | Nuevo metodo `getRangeReport($from, $to)` con 4 queries agregadas. |
| `index.php` | 3 rutas nuevas: `GET /shipping-config/alerts`, `PUT /shipping-config/fuel`, `GET /shipping-costs/range-report`. |
| `views/app.php` | Nuevos campos en Settings (multiplier, fuel, remote prefixes), seccion alertas, boton "Rentabilidad GLS" en Historial, modal `#rentReportModal`. |
| `public/js/app.js` | `applyShippingConfigToForm` y `saveSettings` para los nuevos campos. Funciones `updateFuelPctOnly()`, `loadShippingAlerts()`, `openRentabilityReport()`, `closeRentabilityReport()`, `loadRentabilityReport()`, `renderRentabilityReport()`. |

---

## COMO PROBAR LO QUE SE HA HECHO

### Test 1: Configurar descuento negociado
1. Ir a Settings (icono engranaje)
2. Buscar la seccion "Paqueteria por tablas"
3. Cambiar "Descuento negociado" de 1.0000 a 0.85
4. Cambiar "Recargo combustible GLS" si aplica
5. Pulsar "Guardar"

### Test 2: Aplicar solo combustible
1. Ir a Settings
2. Cambiar el valor del campo "Recargo combustible GLS" a por ej. 5.80
3. Pulsar el boton "Aplicar" al lado del campo (no Guardar)
4. Confirmar el modal -> se guarda solo ese campo

### Test 3: Calcular paqueteria de una hoja
1. Ir a Hojas de Ruta -> abrir una hoja con clientes y carga (carros/cajas > 0)
2. Asegurarse de que tiene vehiculo asignado y que el vehiculo tiene `cost_per_km` > 0
3. Pulsar "Calcular paqueteria"
4. Ver el semaforo en cada linea (verde/naranja/rojo)
5. Ver el resumen total al pie

### Test 4: Informe de rentabilidad
1. Ir a Historial
2. Pulsar "Rentabilidad GLS" arriba a la derecha
3. Seleccionar rango de fechas (por defecto ultimos 30 dias)
4. Pulsar "Calcular"
5. Ver totales, tabla por dia, por ruta, top clientes

---

## CONTEXTO PARA EL SIGUIENTE TRABAJO

Cuando retomes este modulo:

1. **Lee primero los ficheros listados arriba** para entender el estado actual.
2. **No toques `services/RouteCostCalculator.php`** sin entender que ahora pasa multiplier+fuel a `findBestRate`. Si rompes ese flujo, los precios calculados volveran a estar mal.
3. **Si tocas `gls_shipping_config`**, ten en cuenta que las hojas ya calculadas NO se recalculan automaticamente. Considera anadir el boton "Recalcular todo" mencionado arriba.
4. **El metodo `query()` privado en `GlsCostController`** existe para hacer queries directas (alertas) sin tener que crear un modelo nuevo. Si necesitas mas queries SQL ad-hoc, reutilizalo.
5. **El semaforo de recomendacion** se calcula en `RouteCostCalculator::resolveRecommendation()`: own_route si flota es mas barata por > 5%, externalize si GLS es mas barato por > 5%, break_even en medio.

---

## TARIFAS GLS - REFERENCIA RAPIDA

```
Vigo (CP 36) -> destino:
  Provincial (36):     Express 14:00 5kg = 5,74€    Business Parcel 5kg = 4,22€
  Regional (15/27/32): Express 14:00 5kg = 5,74€    Business Parcel 5kg = 4,22€
  Nacional (resto):    Express 14:00 5kg = 6,28€    Business Parcel 5kg = 5,35€
  Baleares Mayores:    Business Parcel 1kg = 11,49€  + 3,07€/kg adicional
  Canarias Mayores:    Business Parcel 1kg = 17,86€  + 6,12€/kg adicional
  Portugal Peninsula:  Business Parcel 5kg = 7,56€

Recargo combustible: variable mensual (actual: 5,50%)
Equivalencia volumetrica: 180 kg/m³
```

---

## VARIABLES DE ENTORNO BD

```
Host: 127.0.0.1
Port: 3308
User: root
Password: (vacio)
Database: gestorrutas
```

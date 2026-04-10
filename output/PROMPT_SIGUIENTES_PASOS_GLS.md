# PROMPT - Siguientes pasos despues de cargar tarifas GLS

> Fecha: 10 de abril de 2026
> Estado: Tarifas GLS 2026 cargadas en BD (123 tarifas, 35 zonas, 12 recargos)
> Origen configurado: Vigo (CP 36214) - Vía Galicia

---

## CONTEXTO PARA EL SIGUIENTE TRABAJO

Acabamos de cargar todo el contrato GLS 2026 en la BD del proyecto VeraRoute (Gestor de Rutas) que esta en `c:\wamp64\www\Gestor de Rutas`. Es una app PHP/MySQL/Leaflet que gestiona rutas de reparto y compara coste flota propia vs externalizar a GLS.

### Lo que ya esta hecho

1. **Tarifas GLS cargadas** - Script en `sql/seed_gls_tariff_2026.sql`:
   - 1 carrier "GLS" con divisor volumetrico 180 kg/m³
   - 35 zonas geograficas (Provincial/Regional/Nacional/Baleares Mayores/Menores/Canarias Mayores/Menores/Portugal)
   - 123 tarifas: 4 servicios (Express 10:30, 14:00, 19:00, Business Parcel) x 8 zonas x bandas de peso
   - 12 recargos en `carrier_surcharges` (sabado, reembolso, gestion, bulto irregular, etc.)

2. **Configuracion en `gls_shipping_config`**:
   - origin_postcode: 36214 (Vigo)
   - origin_country: ES
   - price_multiplier: 1.0000 (sin descuento - PENDIENTE de aplicar el negociado real)
   - gls_fuel_pct_current: 5.50% (recargo combustible PENDIENTE de actualizar mensualmente)
   - default_weight_per_carro_kg: 8.00
   - default_weight_per_caja_kg: 3.00
   - default_service: 'Business Parcel'

3. **Mapeo de zonas (carrier_zones)** - Cobertura completa España + Portugal:
   - Zona 1 Provincial: prefijo `36` (Pontevedra)
   - Zona 2 Regional: `15`, `27`, `32` (A Coruña, Lugo, Ourense)
   - Zona 3 Nacional: `*` ES (fallback)
   - Zona 4 Baleares Mayores: `070`-`076` (Mallorca)
   - Zona 5 Baleares Menores: `077`, `078` (Menorca, Ibiza, Formentera)
   - Zona 6 Canarias Mayores: `350`-`354`, `380`-`386` (Las Palmas, Tenerife)
   - Zona 7 Canarias Menores: `355`-`359`, `387`-`389` (Lanzarote, Fuerteventura, La Palma, La Gomera, El Hierro)
   - Zona 8 Portugal Peninsula: `*` PT

4. **Importador CSV**: `importar_tarifas_gls.py`
   - Export: `python importar_tarifas_gls.py --export tarifas_actuales.csv`
   - Import (dry-run): `python importar_tarifas_gls.py --import nueva.csv --dry-run`
   - Import real: `python importar_tarifas_gls.py --import nueva.csv`

5. **Verificacion end-to-end pasada**: La query `quoteShipment()` del modelo `ShippingRateTable` devuelve precios coherentes:
   - Vigo→Pontevedra 5kg = 4.22€ (Business Parcel zona 1)
   - Vigo→Madrid 12kg con 5.5% combustible = 7.92€
   - Vigo→Mallorca 8kg con 5.5% combustible = 34.79€
   - Vigo→A Coruña 2kg = ~3.86€

### Lo que NO esta hecho todavia

- [ ] **Descuento negociado real** - El `price_multiplier` esta a 1.0000. Hay que sacar del contrato el % de descuento que tenemos negociado con GLS y aplicarlo (ej: 0.85 = 15% descuento)
- [ ] **Recargo combustible mensual** - El campo `gls_fuel_pct_current` esta a 5.50% pero hay que comprobarlo cada mes en https://www.viagalicia.com/tasa-energetica/ y actualizarlo
- [ ] **CP de origen real** - 36214 es Vigo generico. Confirmar con el cliente si la salida es desde otro CP
- [ ] **Portugal: faltan bandas intermedias** - El PDF muestra solo banda 1kg y `kg adicional` para PT en algunos servicios. Hay que verificar si la matriz de PT es completa o se calcula con base+adicional
- [ ] **Validacion de precios contra facturas reales** - Cuando se reciban las primeras facturas reales de GLS, comparar contra el calculo del sistema y ajustar si hay discrepancias
- [ ] **UI de gestion de tarifas** - Verificar que el modal de Settings -> Paqueteria funciona bien y permite editar todo desde la app sin tocar SQL

---

## SIGUIENTES PASOS A IMPLEMENTAR

Quiero que continues con el desarrollo del modulo GLS en VeraRoute. Tienes que:

### Paso 1: Verificar la UI de gestion de tarifas

Comprueba que el modal de Settings → Paqueteria de la app permite:
- Ver y editar el carrier GLS (nombre, divisor volumetrico, fuel_pct base)
- Ver, anadir, editar y borrar zonas (carrier_zones)
- Ver, anadir, editar y borrar tarifas (carrier_rates) por servicio
- Ver, anadir, editar y borrar recargos (carrier_surcharges)
- Editar la configuracion global (`gls_shipping_config`): origen, multiplicador, fuel_pct vigente

Si algo no funciona o esta incompleto, arreglalo.

### Paso 2: Mejorar la comparativa visual en hojas de ruta

En el detalle de una hoja de ruta hay un boton "Calcular paqueteria". Cuando se pulsa, deberia:
1. Calcular para cada linea con carga el coste de mandarlo por GLS
2. Comparar contra el coste de mandarlo en flota propia (km de desvio × coste/km del vehiculo)
3. Mostrar un semaforo por linea: verde (mejor flota propia), naranja (similar), rojo (mejor GLS)
4. Mostrar al final un resumen total: cuanto costaria toda la hoja por flota propia, cuanto por GLS, y cuanto se ahorraria en la combinacion optima

Verifica que esto ya funciona end-to-end (el `RouteCostCalculator` ya esta implementado pero hay que comprobar que con las tarifas reales cargadas de un resultado coherente).

### Paso 3: Informe de rentabilidad

Crea (o mejora si ya existe) un informe accesible desde el menu principal que muestre:
- **Por dia**: total entregas, total km flota propia, coste total flota, coste total simulado GLS, ahorro/sobrecoste
- **Por cliente**: histograma de coste por entrega, % entregas que serian mas baratas por GLS
- **Por ruta comercial**: rentabilidad de cada ruta
- **Top clientes a externalizar**: lista de clientes donde GLS es siempre mas barato

### Paso 4: Configuracion mensual del combustible

Anade en Settings un boton "Actualizar combustible GLS" que:
1. Pida al usuario el nuevo % de combustible (ej: 5.80%)
2. Lo guarde en `gls_shipping_config.gls_fuel_pct_current`
3. Marque las hojas de ruta posteriores a esa fecha para que se recalculen con el nuevo %
4. Opcional: si el usuario lo confirma, llame a la URL https://www.viagalicia.com/tasa-energetica/ para sugerir el % actual (si es scrapeable)

### Paso 5: Alertas de discrepancias

Crea un sistema de alertas que detecte cuando el calculo del sistema difiera de la realidad:
- Si la factura mensual de GLS difiere mas de un 5% del calculo, alertar al admin
- Si una entrega real costo mucho menos de lo calculado (descuento aplicado), sugerir actualizar el `price_multiplier`
- Si un CP de cliente no encuentra zona en `carrier_zones`, alertar y crear automaticamente un ticket para añadirlo

### Paso 6: Importar CP zonas remotas reales

GLS tiene una lista de CP remotos donde aplica un suplemento extra (ya esta el surcharge `remoto` definido en `carrier_surcharges` con importe 0.00). Hay que:
1. Pedir a GLS la lista oficial de CP remotos
2. Cargarlos en la tabla `carrier_zones` con `remoto = 1`
3. O usar el campo `gls_shipping_config.remote_postcode_prefixes` (ya existe) como lista textual de prefijos remotos
4. Verificar que el importe del recargo `remoto` se ajusta al contrato real

---

## FICHEROS RELEVANTES

| Fichero | Descripcion |
|---------|-------------|
| `sql/seed_gls_tariff_2026.sql` | Script de carga inicial (idempotente, borra GLS y recarga) |
| `sql/migration_gls_contract_support.sql` | Migracion del esquema (ya aplicada) |
| `sql/tarifas_gls_2026_export.csv` | Export CSV de las tarifas actuales (123 filas) |
| `importar_tarifas_gls.py` | Importador/exportador CSV |
| `models/ShippingRateTable.php` | Modelo principal con `quoteShipment()` y `findBestRate()` |
| `models/GlsShippingConfig.php` | Configuracion global GLS |
| `services/RouteCostCalculator.php` | Calculo coste comparativo flota vs GLS por hoja |
| `controllers/GlsCostController.php` | Endpoints API de comparativa |
| `controllers/ShippingRateController.php` | Endpoints API CRUD del catalogo de tarifas |

---

## VARIABLES DE ENTORNO BD

```
Host: 127.0.0.1
Port: 3308
User: root
Password: (vacio)
Database: gestorrutas
```

---

## TARIFAS DE REFERENCIA (resumen del PDF)

**Servicios GLS:**
- **Express 10:30** - Entrega antes de 10:30 (24h, solo Provincial/Regional/Nacional)
- **Express 14:00** - Entrega antes de 14:00 (24h, todas las zonas)
- **Express 19:00** - Entrega antes de 19:00 (24h, todas las zonas)
- **Business Parcel** - Entrega 24/48h estandar (todas las zonas)
- **Economy Parcel** - 48/72h (NO cargado, falta el tarifario)

**Bandas estandar (peninsula):** 1kg, 3kg, 5kg, 10kg, 15kg + kg adicional
**Bandas extendidas (Express 19:00 y Business Parcel nacional):** 20, 25, 30, 40, 50kg

**Provincias de entrega 24h en Business Parcel** (segun PDF):
Asturias, Avila, Cantabria, La Coruña, Leon, Lugo, Madrid, Orense, Palencia, Pontevedra, Salamanca, Segovia, Valladolid, Zamora.

---

Cuando empieces con esto, **lee primero** los ficheros listados arriba antes de modificar nada para entender el contexto. Si tienes dudas sobre algun comportamiento esperado, pregunta antes de implementar.

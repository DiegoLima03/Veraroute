"""
Obtiene horarios semanales de direcciones de entrega usando Google Places API (New).
Importa directamente en la BD (tabla horarios_cliente).

Solo procesa direcciones que NO tienen horarios todavia.

Uso:
  pip install requests mysql-connector-python
  python scripts/google_hours.py
"""

import os
import sys
import time
import requests
import mysql.connector

# Lee key de config/.env o variable de entorno
def _load_google_key():
    env_path = os.path.join(os.path.dirname(__file__), '..', 'config', '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                # Primero busca GOOGLE_PLACES_KEY (especifica para Places API)
                if line.startswith('GOOGLE_PLACES_KEY=') and not line.startswith('#'):
                    val = line.split('=', 1)[1].strip().strip("'\"")
                    if val:
                        return val
        # Fallback a GOOGLE_API_KEY
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('GOOGLE_API_KEY=') and not line.startswith('#'):
                    val = line.split('=', 1)[1].strip().strip("'\"")
                    if val:
                        return val
    return os.environ.get('GOOGLE_PLACES_KEY', '') or os.environ.get('GOOGLE_API_KEY', '')

API_KEY = _load_google_key()
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3308,
    "user": "root",
    "password": "",
    "database": "gestorrutas",
}

GOOGLE_TO_DB = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6}
DAY_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
DELAY = 0.05


def find_place(name, lat, lng):
    """Busca un lugar en Google Places (New) por texto + ubicacion."""
    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.regularOpeningHours",
    }
    body = {
        "textQuery": name,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 500.0,
            }
        },
        "maxResultCount": 1,
    }
    resp = requests.post(url, json=body, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    places = data.get("places", [])
    return places[0] if places else None


def extract_weekly_hours(place):
    """Extrae horarios de todos los dias de la semana."""
    hours = place.get("regularOpeningHours")
    if not hours:
        return None
    periods = hours.get("periods", [])
    if not periods:
        return None

    weekly = {}
    for p in periods:
        open_info = p.get("open", {})
        close_info = p.get("close", {})
        google_day = open_info.get("day")
        if google_day is None:
            continue
        db_day = GOOGLE_TO_DB.get(google_day)
        if db_day is None:
            continue

        oh = open_info.get("hour", 0)
        om = open_info.get("minute", 0)
        ch = close_info.get("hour", 0)
        cm = close_info.get("minute", 0)

        if db_day not in weekly:
            weekly[db_day] = []
        weekly[db_day].append({
            "open": f"{oh:02d}:{om:02d}",
            "close": f"{ch:02d}:{cm:02d}",
        })

    for day in weekly:
        weekly[day].sort(key=lambda x: x["open"])
    return weekly if weekly else None


def format_schedule(weekly):
    """Formatea horario semanal para consola."""
    parts = []
    for day in range(7):
        if day not in weekly:
            parts.append(f"{DAY_NAMES[day]}:CERRADO")
            continue
        windows = weekly[day]
        times = " / ".join(f"{w['open']}-{w['close']}" for w in windows)
        parts.append(f"{DAY_NAMES[day]}:{times}")
    return " | ".join(parts)


def main():
    if not API_KEY:
        print("ERROR: GOOGLE_API_KEY no definida. Ponla en config/.env o como variable de entorno.")
        sys.exit(1)

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)

    # Solo direcciones que NO tienen horarios todavia
    cursor.execute("""
        SELECT de.id, de.id_cliente, de.descripcion, de.direccion, de.localidad,
               de.codigo_postal, de.x, de.y, de.principal,
               c.nombre as cliente_nombre
        FROM direcciones_entrega de
        JOIN clientes c ON c.id = de.id_cliente
        WHERE de.activo = 1
          AND de.x IS NOT NULL AND de.x != 0
          AND de.id NOT IN (SELECT DISTINCT id_direccion FROM horarios_cliente WHERE id_direccion IS NOT NULL)
        ORDER BY c.nombre, de.principal DESC, de.id
    """)
    dirs = cursor.fetchall()

    total = len(dirs)
    print(f"=== Obtener horarios de Google Places ===")
    print(f"Direcciones sin horarios: {total}")
    if total == 0:
        print("Todas las direcciones ya tienen horarios.")
        cursor.close()
        conn.close()
        return

    print("-" * 80)

    updated = 0
    skipped = 0
    errors = 0

    for i, d in enumerate(dirs):
        lat = float(d["x"])
        lng = float(d["y"])
        cliente = d["cliente_nombre"] or ""
        desc = d["descripcion"] or ""
        addr = d["direccion"] or ""
        localidad = d["localidad"] or ""

        # Construir query de busqueda
        query_parts = [desc or cliente]
        if addr:
            query_parts.append(addr)
        if localidad:
            query_parts.append(localidad)
        query = ", ".join(query_parts)

        label = f"{cliente[:25]} / {desc[:25]}"

        try:
            place = find_place(query, lat, lng)
            if not place:
                print(f"[{i+1}/{total}] {label} — no encontrado")
                skipped += 1
                time.sleep(DELAY)
                continue

            google_name = place.get("displayName", {}).get("text", "?")
            weekly = extract_weekly_hours(place)

            if not weekly:
                print(f"[{i+1}/{total}] {label} -> {google_name} — sin horarios")
                skipped += 1
                time.sleep(DELAY)
                continue

            print(f"[{i+1}/{total}] {label} -> {google_name}")
            print(f"         {format_schedule(weekly)}")

            # Insertar horarios directamente en BD
            for day, windows in weekly.items():
                for w in windows:
                    cursor.execute(
                        "INSERT INTO horarios_cliente (id_cliente, id_direccion, dia_semana, hora_apertura, hora_cierre) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (d["id_cliente"], d["id"], day, w["open"], w["close"])
                    )

            # Si es la direccion principal, actualizar tambien clientes.hora_apertura/cierre
            if d["principal"] and 0 in weekly:
                mon = weekly[0]
                ot2 = mon[1]["open"] if len(mon) > 1 else None
                ct2 = mon[1]["close"] if len(mon) > 1 else None
                cursor.execute(
                    "UPDATE clientes SET hora_apertura = %s, hora_cierre = %s, "
                    "hora_apertura_2 = %s, hora_cierre_2 = %s WHERE id = %s",
                    (mon[0]["open"], mon[0]["close"], ot2, ct2, d["id_cliente"])
                )

            updated += 1

        except Exception as e:
            print(f"[{i+1}/{total}] {label} — ERROR: {e}")
            errors += 1

        # Commit cada 25 registros
        if (i + 1) % 25 == 0:
            conn.commit()
            print(f"  >>> Progreso: {updated} OK, {skipped} sin horario, {errors} errores")

        time.sleep(DELAY)

    conn.commit()
    cursor.close()
    conn.close()

    print("-" * 80)
    print(f"=== COMPLETADO ===")
    print(f"Con horario: {updated}/{total}")
    print(f"Sin horario: {skipped}/{total}")
    print(f"Errores:     {errors}/{total}")


if __name__ == "__main__":
    main()

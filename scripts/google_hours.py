"""
Obtiene horarios semanales de clientes usando Google Places API (New).
Genera un CSV y un archivo SQL para importar en la BD.

Uso:
  pip install requests mysql-connector-python
  set GOOGLE_API_KEY=tu_api_key_aqui
  python scripts/google_hours.py              # preview (no escribe nada)
  python scripts/google_hours.py --export     # genera CSV + SQL
"""

import os
import sys
import csv
import requests
import mysql.connector

API_KEY = os.environ.get("GOOGLE_API_KEY", "") or "AIzaSyBEjPyOscnxGmDZto8UD6awat2p3pLuwUY"
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3308,
    "user": "root",
    "password": "",
    "database": "gestorrutas",
}

# Google: 0=Sunday, 1=Monday...6=Saturday
# Nuestro BD: 0=Lunes, 1=Martes...6=Domingo
GOOGLE_TO_DB = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6}
DAY_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]


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
    """Extrae horarios de todos los dias de la semana.
    Devuelve dict: {db_day: [{'open': 'HH:MM', 'close': 'HH:MM'}, ...]}
    """
    hours = place.get("regularOpeningHours")
    if not hours:
        return None

    periods = hours.get("periods", [])
    if not periods:
        return None

    weekly = {}  # db_day -> list of periods

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

    # Ordenar turnos por hora de apertura
    for day in weekly:
        weekly[day].sort(key=lambda x: x["open"])

    return weekly if weekly else None


def format_schedule(weekly):
    """Formatea horario semanal para mostrar en consola."""
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
    if not API_KEY or API_KEY == "PEGA_TU_API_KEY_AQUI":
        print("ERROR: Define tu API key de Google en el script o como variable de entorno")
        print("  set GOOGLE_API_KEY=AIza...")
        sys.exit(1)

    export = "--export" in sys.argv

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, name, address, x, y FROM clients ORDER BY name")
    clients = cursor.fetchall()
    cursor.close()
    conn.close()

    print(f"Clientes: {len(clients)}")
    print(f"Modo: {'EXPORTAR a CSV + SQL' if export else 'PREVIEW (usa --export para generar archivos)'}")
    print("-" * 80)

    updated = 0
    skipped = 0
    errors = 0

    # Filas para CSV y SQL
    schedule_rows = []   # (client_id, day_of_week, open_time, close_time)
    fallback_rows = []   # (client_id, open_time, close_time, open_time_2, close_time_2)

    for c in clients:
        lat = float(c["x"])
        lng = float(c["y"])
        query = c["name"]
        if c["address"]:
            query += " " + c["address"]

        try:
            place = find_place(query, lat, lng)
            if not place:
                print(f"  [?] {c['name']}: no encontrado en Google")
                skipped += 1
                continue

            google_name = place.get("displayName", {}).get("text", "?")
            weekly = extract_weekly_hours(place)

            if not weekly:
                print(f"  [?] {c['name']} -> {google_name}: sin horarios")
                skipped += 1
                continue

            print(f"  [OK] {c['name']} -> {google_name}")
            print(f"       {format_schedule(weekly)}")

            # Acumular filas de horarios
            for day, windows in weekly.items():
                for w in windows:
                    schedule_rows.append((c["id"], day, w["open"], w["close"]))

            # Fallback: lunes como referencia para clients.open_time/close_time
            if 0 in weekly:
                mon = weekly[0]
                fallback_rows.append((
                    c["id"],
                    mon[0]["open"],
                    mon[0]["close"],
                    mon[1]["open"] if len(mon) > 1 else "",
                    mon[1]["close"] if len(mon) > 1 else "",
                ))

            updated += 1

        except Exception as e:
            print(f"  [ERR] {c['name']}: {e}")
            errors += 1

    print("-" * 80)
    print(f"Actualizados: {updated} | Saltados: {skipped} | Errores: {errors}")

    if not export:
        if updated:
            print(f"Se generarian {len(schedule_rows)} ventanas horarias")
            print("Ejecuta con --export para generar CSV + SQL")
        return

    # --- Generar CSV ---
    csv_path = os.path.join(os.path.dirname(__file__), "..", "sql", "client_schedules.csv")
    csv_path = os.path.normpath(csv_path)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["client_id", "day_of_week", "open_time", "close_time"])
        for row in schedule_rows:
            writer.writerow(row)

    # --- Generar SQL ---
    sql_path = os.path.join(os.path.dirname(__file__), "..", "sql", "import_schedules.sql")
    sql_path = os.path.normpath(sql_path)
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("-- Generado automaticamente por google_hours.py\n")
        f.write("-- Importar horarios semanales de Google Places\n\n")

        f.write("-- Limpiar horarios existentes de los clientes actualizados\n")
        client_ids = sorted(set(r[0] for r in schedule_rows))
        if client_ids:
            ids_str = ",".join(str(cid) for cid in client_ids)
            f.write(f"DELETE FROM client_schedules WHERE client_id IN ({ids_str});\n\n")

        f.write("-- Insertar horarios semanales\n")
        f.write("INSERT INTO client_schedules (client_id, day_of_week, open_time, close_time) VALUES\n")
        for i, row in enumerate(schedule_rows):
            comma = "," if i < len(schedule_rows) - 1 else ";"
            f.write(f"  ({row[0]}, {row[1]}, '{row[2]}', '{row[3]}'){comma}\n")

        # Fallback updates
        if fallback_rows:
            f.write("\n-- Actualizar horario fallback en tabla clients (lunes como referencia)\n")
            for fb in fallback_rows:
                ot2 = f"'{fb[3]}'" if fb[3] else "NULL"
                ct2 = f"'{fb[4]}'" if fb[4] else "NULL"
                f.write(
                    f"UPDATE clients SET open_time='{fb[1]}', close_time='{fb[2]}', "
                    f"open_time_2={ot2}, close_time_2={ct2} WHERE id={fb[0]};\n"
                )

    print(f"\nArchivos generados:")
    print(f"  CSV: {csv_path}")
    print(f"  SQL: {sql_path}")
    print(f"  Ventanas horarias: {len(schedule_rows)}")
    print(f"\nPara importar ejecuta el SQL en tu gestor de BD o desde consola:")
    print(f"  mysql -u root -P 3308 gestorrutas < sql/import_schedules.sql")


if __name__ == "__main__":
    main()

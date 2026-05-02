#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Rellena el campo postcode de TODOS los clientes en la BD gestorrutas.

Estrategia en 3 fases:
  1. Cruzar con el CSV de Velneo (tiene CP para 5216 de 5465 filas)
  2. Reverse geocoding con Nominatim para los que tienen coordenadas pero no CP
  3. Log de los que quedan sin CP para revision manual
"""

import csv
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

# --- Conexion MySQL via PyMySQL o mysql.connector ---
try:
    import pymysql
    pymysql.install_as_MySQLdb()
    import MySQLdb
    DB_LIB = "pymysql"
except ImportError:
    try:
        import mysql.connector
        DB_LIB = "mysql.connector"
    except ImportError:
        print("ERROR: Necesitas pymysql o mysql-connector-python.")
        print("  pip install pymysql")
        sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VELNEO_CSV = os.path.join(BASE_DIR, "Datos Velneo Geocodificado.csv")
CACHE_FILE = os.path.join(BASE_DIR, "reverse_geocode_cache.json")
LOG_FILE = os.path.join(BASE_DIR, "clientes_sin_cp.csv")

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
HEADERS = {"User-Agent": "VeraRoute-CPFiller/1.0 (filling postcodes for logistics)"}
RATE_LIMIT = 1.1  # seconds between Nominatim requests


# ─── Helpers ───────────────────────────────────────────────

def normalize(text):
    """Normalize for fuzzy matching: lowercase, no accents, no punctuation."""
    if not text:
        return ""
    s = str(text).strip()
    s = s.replace("_x000D_", "").replace("\r", "").replace("\n", " ")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def db_connect():
    if DB_LIB == "pymysql":
        return MySQLdb.connect(
            host="127.0.0.1", port=3308, user="root", passwd="",
            db="gestorrutas", charset="utf8mb4"
        )
    else:
        return mysql.connector.connect(
            host="127.0.0.1", port=3308, user="root", password="",
            database="gestorrutas", charset="utf8mb4"
        )


def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)


def reverse_geocode(lat, lon, retries=2):
    """Nominatim reverse geocoding -> returns postcode or None."""
    params = {
        "lat": lat, "lon": lon,
        "format": "json", "zoom": 18,
        "addressdetails": "1"
    }
    url = NOMINATIM_REVERSE_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                addr = data.get("address", {})
                postcode = addr.get("postcode", "")
                if postcode:
                    return postcode.replace(" ", "").strip()
            return None
        except Exception as e:
            if attempt < retries:
                time.sleep(2)
            else:
                print(f"    Error reverse geocoding ({lat},{lon}): {e}", file=sys.stderr)
    return None


# ─── FASE 1: Cruzar con Velneo CSV ────────────────────────

def load_velneo_postcodes():
    """Load Velneo CSV and build name->postcode mapping."""
    mapping = {}  # normalized_name -> postcode

    if not os.path.exists(VELNEO_CSV):
        print(f"  AVISO: No se encuentra {VELNEO_CSV}")
        return mapping

    with open(VELNEO_CSV, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            cp = row.get("Código postal", "").strip()
            if not cp or len(cp) < 4:
                continue

            desc = row.get("Descripción", "")
            # Extract business name (before " / ")
            name = desc.split(" / ")[0].strip() if " / " in desc else desc.strip()

            norm = normalize(name)
            if norm:
                mapping[norm] = cp

            # Also index full description
            norm_full = normalize(desc)
            if norm_full and norm_full != norm:
                mapping[norm_full] = cp

    print(f"  Velneo: {len(mapping)} nombres con CP cargados")
    return mapping


def fase1_cruzar_velneo(clients, velneo_map):
    """Match DB clients to Velneo by name -> assign postcode."""
    updated = 0

    for c in clients:
        if c["postcode"]:  # ya tiene CP
            continue

        norm_name = normalize(c["name"])

        # Exact match
        if norm_name in velneo_map:
            c["new_postcode"] = velneo_map[norm_name]
            c["cp_source"] = "velneo_exact"
            updated += 1
            continue

        # Partial match: check if client name contains or is contained in Velneo name
        best_cp = None
        best_len = 0
        for vname, vcp in velneo_map.items():
            if not vname:
                continue
            if vname in norm_name or norm_name in vname:
                overlap = min(len(vname), len(norm_name))
                if overlap > best_len:
                    best_len = overlap
                    best_cp = vcp

        if best_cp and best_len >= 5:  # at least 5 chars overlap
            c["new_postcode"] = best_cp
            c["cp_source"] = "velneo_partial"
            updated += 1

    return updated


# ─── FASE 2: Reverse geocoding ────────────────────────────

def fase2_reverse_geocoding(clients, cache):
    """For clients with coords but no CP, reverse geocode."""
    candidates = [c for c in clients
                  if not c.get("new_postcode") and not c["postcode"]
                  and c["x"] and c["y"] and c["x"] != 0 and c["y"] != 0]

    print(f"  Candidatos para reverse geocoding: {len(candidates)}")

    updated = 0
    api_calls = 0
    total = len(candidates)

    for i, c in enumerate(candidates):
        lat, lon = float(c["x"]), float(c["y"])
        cache_key = f"{lat:.6f},{lon:.6f}"

        if cache_key in cache:
            cp = cache[cache_key]
        else:
            cp = reverse_geocode(lat, lon)
            cache[cache_key] = cp
            api_calls += 1
            time.sleep(RATE_LIMIT)

            # Save cache every 100 API calls
            if api_calls % 100 == 0:
                save_cache(cache)

        if cp:
            c["new_postcode"] = cp
            c["cp_source"] = "reverse_geocode"
            updated += 1

        if (i + 1) % 200 == 0 or (i + 1) == total:
            print(f"    Progreso: {i+1}/{total} | Actualizados: {updated} | API calls: {api_calls}")
            sys.stdout.flush()

    save_cache(cache)
    return updated, api_calls


# ─── MAIN ─────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  RELLENAR CODIGOS POSTALES - VeraRoute")
    print("=" * 60)

    # 1. Load all clients from DB
    print("\n[1] Cargando clientes de la BD...")
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("SELECT id, name, address, postcode, x, y FROM clientes ORDER BY id")
    rows = cur.fetchall()

    clients = []
    for r in rows:
        clientes.append({
            "id": r[0],
            "name": r[1] or "",
            "address": r[2] or "",
            "postcode": (r[3] or "").strip(),
            "x": r[4],
            "y": r[5],
            "new_postcode": None,
            "cp_source": None,
        })

    total = len(clients)
    ya_tienen = sum(1 for c in clients if c["postcode"])
    print(f"  Total clientes: {total}")
    print(f"  Ya tienen CP: {ya_tienen}")
    print(f"  Sin CP: {total - ya_tienen}")

    if ya_tienen == total:
        print("\n  Todos los clientes ya tienen CP. Nada que hacer.")
        return

    # 2. FASE 1: Cruzar con Velneo
    print("\n[2] FASE 1: Cruzando con datos Velneo...")
    velneo_map = load_velneo_postcodes()
    f1_count = fase1_cruzar_velneo(clients, velneo_map)
    print(f"  -> Asignados por cruce Velneo: {f1_count}")

    # 3. FASE 2: Reverse geocoding
    pendientes = sum(1 for c in clients if not c.get("new_postcode") and not c["postcode"])
    print(f"\n[3] FASE 2: Reverse geocoding ({pendientes} pendientes)...")
    cache = load_cache()
    f2_count, api_calls = fase2_reverse_geocoding(clients, cache)
    print(f"  -> Asignados por reverse geocoding: {f2_count}")
    print(f"  -> Llamadas API realizadas: {api_calls}")

    # 4. Aplicar cambios a la BD
    total_nuevos = sum(1 for c in clients if c.get("new_postcode"))
    print(f"\n[4] Aplicando {total_nuevos} codigos postales a la BD...")

    update_count = 0
    for c in clients:
        if c.get("new_postcode"):
            cur.execute(
                "UPDATE clientes SET postcode = %s WHERE id = %s",
                (c["new_postcode"], c["id"])
            )
            update_count += 1

    conn.commit()
    print(f"  -> {update_count} clientes actualizados en la BD")

    # 5. Log de los que quedan sin CP
    sin_cp = [c for c in clients if not c.get("new_postcode") and not c["postcode"]]
    print(f"\n[5] Clientes que quedan SIN CP: {len(sin_cp)}")

    if sin_cp:
        with open(LOG_FILE, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["ID", "Nombre", "Direccion", "Tiene_Coords", "Lat", "Lng"])
            for c in sin_cp:
                tiene_coords = "SI" if c["x"] and c["y"] and c["x"] != 0 else "NO"
                writer.writerow([c["id"], c["name"], c["address"], tiene_coords, c["x"], c["y"]])
        print(f"  -> Exportados a: {LOG_FILE}")

    # 6. Resumen final
    print("\n" + "=" * 60)
    print("  RESUMEN")
    print("=" * 60)

    # Re-check from DB
    cur.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN postcode IS NOT NULL AND TRIM(postcode) != '' THEN 1 ELSE 0 END) as con_cp,
            SUM(CASE WHEN postcode IS NULL OR TRIM(postcode) = '' THEN 1 ELSE 0 END) as sin_cp
        FROM clientes
    """)
    r = cur.fetchone()
    print(f"  Total clientes:  {r[0]}")
    print(f"  CON CP:          {r[1]}")
    print(f"  SIN CP:          {r[2]}")

    # Breakdown by source
    by_source = {}
    for c in clients:
        src = c.get("cp_source", "no_asignado" if not c["postcode"] else "ya_tenia")
        by_source[src] = by_source.get(src, 0) + 1

    print("\n  Desglose por fuente:")
    for src, count in sorted(by_source.items(), key=lambda x: -x[1]):
        print(f"    {src}: {count}")

    cur.close()
    conn.close()
    print("\nCompletado!")


if __name__ == "__main__":
    main()

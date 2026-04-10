#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Importador de tarifas GLS desde CSV.

Permite actualizar las tarifas (precio_base) de carrier_rates desde un fichero CSV
sin tocar la estructura. Util cuando GLS publique una nueva version del contrato.

Formato CSV esperado (delimitador ; separator):
  carrier;service;rate_type;zona;peso_min;peso_max;precio_base;vigencia_desde;vigencia_hasta

Ejemplo:
  GLS;Business Parcel;band;1;0.00;1.00;3.86;2026-01-01;2026-12-31
  GLS;Business Parcel;band;1;1.01;3.00;4.08;2026-01-01;2026-12-31
  GLS;Business Parcel;additional_kg;1;15.00;9999.00;0.20;2026-01-01;2026-12-31

Tambien permite generar el CSV actual de la BD:
  python importar_tarifas_gls.py --export tarifas_export.csv

Y aplicar un fichero:
  python importar_tarifas_gls.py --import tarifas_nuevas.csv
  python importar_tarifas_gls.py --import tarifas_nuevas.csv --dry-run
"""

import argparse
import csv
import os
import sys

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


HEADER = ["carrier", "service", "rate_type", "zona", "peso_min", "peso_max",
          "precio_base", "vigencia_desde", "vigencia_hasta"]


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


def get_carrier_id(cur, name):
    cur.execute("SELECT id FROM carriers WHERE nombre = %s LIMIT 1", (name,))
    row = cur.fetchone()
    return row[0] if row else None


def export_to_csv(out_path):
    print(f"Exportando tarifas a {out_path}...")
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("""
        SELECT c.nombre, r.service_name, r.rate_type, r.zona,
               r.peso_min, r.peso_max, r.precio_base,
               r.vigencia_desde, r.vigencia_hasta
        FROM carrier_rates r
        JOIN carriers c ON c.id = r.carrier_id
        ORDER BY c.nombre, r.service_name, r.zona, r.peso_min, r.id
    """)
    rows = cur.fetchall()

    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(HEADER)
        for row in rows:
            row_clean = [
                row[0],                                 # carrier
                row[1],                                 # service
                row[2],                                 # rate_type
                row[3],                                 # zona
                f"{float(row[4]):.2f}",                 # peso_min
                f"{float(row[5]):.2f}",                 # peso_max
                f"{float(row[6]):.2f}",                 # precio_base
                row[7].strftime("%Y-%m-%d") if row[7] else "",
                row[8].strftime("%Y-%m-%d") if row[8] else "",
            ]
            writer.writerow(row_clean)

    print(f"  -> {len(rows)} tarifas exportadas")
    cur.close()
    conn.close()


def import_from_csv(in_path, dry_run=False):
    if not os.path.exists(in_path):
        print(f"ERROR: No se encuentra {in_path}")
        sys.exit(1)

    print(f"{'[DRY RUN] ' if dry_run else ''}Importando tarifas desde {in_path}...")
    conn = db_connect()
    cur = conn.cursor()

    carriers_cache = {}
    new_count = 0
    update_count = 0
    skipped = 0
    errors = []

    with open(in_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")

        # Validar cabeceras
        missing = [h for h in HEADER if h not in reader.fieldnames]
        if missing:
            print(f"ERROR: Faltan columnas en CSV: {missing}")
            print(f"  Cabeceras encontradas: {reader.fieldnames}")
            print(f"  Esperadas: {HEADER}")
            sys.exit(1)

        for line_num, row in enumerate(reader, start=2):
            try:
                carrier_name = (row["carrier"] or "").strip()
                if not carrier_name:
                    skipped += 1
                    continue

                if carrier_name not in carriers_cache:
                    carriers_cache[carrier_name] = get_carrier_id(cur, carrier_name)
                carrier_id = carriers_cache[carrier_name]

                if not carrier_id:
                    errors.append(f"Linea {line_num}: carrier '{carrier_name}' no existe en BD")
                    continue

                service = (row["service"] or "").strip()
                rate_type = (row["rate_type"] or "band").strip().lower()
                if rate_type not in ("band", "additional_kg"):
                    errors.append(f"Linea {line_num}: rate_type '{rate_type}' invalido (band/additional_kg)")
                    continue

                zona = int(row["zona"])
                peso_min = float(row["peso_min"])
                peso_max = float(row["peso_max"])
                precio = float(row["precio_base"])
                desde = (row["vigencia_desde"] or "").strip()
                hasta = (row["vigencia_hasta"] or "").strip() or None

                if not desde:
                    errors.append(f"Linea {line_num}: vigencia_desde es obligatorio")
                    continue

                # Buscar registro existente por clave unica
                cur.execute("""
                    SELECT id FROM carrier_rates
                    WHERE carrier_id = %s AND service_name = %s AND rate_type = %s
                      AND zona = %s AND peso_min = %s AND peso_max = %s
                      AND vigencia_desde = %s
                    LIMIT 1
                """, (carrier_id, service, rate_type, zona, peso_min, peso_max, desde))
                existing = cur.fetchone()

                if existing:
                    if not dry_run:
                        cur.execute("""
                            UPDATE carrier_rates
                            SET precio_base = %s, vigencia_hasta = %s
                            WHERE id = %s
                        """, (precio, hasta, existing[0]))
                    update_count += 1
                else:
                    if not dry_run:
                        cur.execute("""
                            INSERT INTO carrier_rates
                            (carrier_id, service_name, rate_type, zona, peso_min, peso_max,
                             precio_base, vigencia_desde, vigencia_hasta)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (carrier_id, service, rate_type, zona, peso_min, peso_max,
                              precio, desde, hasta))
                    new_count += 1

            except Exception as e:
                errors.append(f"Linea {line_num}: {e}")

    if not dry_run:
        conn.commit()
    cur.close()
    conn.close()

    print()
    print(f"  Nuevas tarifas:    {new_count}")
    print(f"  Actualizadas:      {update_count}")
    print(f"  Saltadas (vacio):  {skipped}")
    print(f"  Errores:           {len(errors)}")
    for err in errors[:20]:
        print(f"    - {err}")
    if len(errors) > 20:
        print(f"    ... y {len(errors) - 20} errores mas")

    if dry_run:
        print()
        print("  [DRY RUN] No se ha modificado nada en la BD.")
    else:
        print()
        print("  Importacion completada.")


def main():
    parser = argparse.ArgumentParser(description="Importar/exportar tarifas de carriers (CSV)")
    parser.add_argument("--export", metavar="FICHERO", help="Exportar tarifas actuales a CSV")
    parser.add_argument("--import", dest="import_file", metavar="FICHERO", help="Importar tarifas desde CSV")
    parser.add_argument("--dry-run", action="store_true", help="Simular importacion sin cambios en BD")
    args = parser.parse_args()

    if args.export:
        export_to_csv(args.export)
    elif args.import_file:
        import_from_csv(args.import_file, dry_run=args.dry_run)
    else:
        parser.print_help()
        print()
        print("Ejemplos:")
        print("  python importar_tarifas_gls.py --export tarifas_actuales.csv")
        print("  python importar_tarifas_gls.py --import tarifas_2027.csv --dry-run")
        print("  python importar_tarifas_gls.py --import tarifas_2027.csv")


if __name__ == "__main__":
    main()

"""
Geocodifica las direcciones de entrega sin coordenadas usando Google Geocoding API.

Lee direcciones_entrega con x IS NULL, geocodifica con Google y actualiza la BD.

Uso: python geocode_direcciones.py
"""

import os
import time
import sys
import pymysql

try:
    import requests
except ImportError:
    print("Instala requests: pip install requests")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════
# CONFIGURACION
# ══════════════════════════════════════════════════════════════
def _load_google_key():
    env_path = os.path.join(os.path.dirname(__file__), 'config', '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('GOOGLE_API_KEY=') and not line.startswith('#'):
                    val = line.split('=', 1)[1].strip().strip("'\"")
                    if val:
                        return val
    return os.environ.get('GOOGLE_API_KEY', '')

GOOGLE_API_KEY = _load_google_key()
if not GOOGLE_API_KEY:
    print("ERROR: GOOGLE_API_KEY no definida. Ponla en config/.env o como variable de entorno.")
    sys.exit(1)
DELAY = 0.05  # 50ms entre peticiones

DB_CONFIG = {
    'host': '127.0.0.1',
    'port': 3308,
    'user': 'root',
    'password': '',
    'database': 'gestorrutas',
    'charset': 'utf8mb4',
}


def geocode_google(address):
    """Geocodifica una direccion con Google Geocoding API. Devuelve (lat, lng) o (None, None)."""
    try:
        r = requests.get('https://maps.googleapis.com/maps/api/geocode/json', params={
            'address': address,
            'key': GOOGLE_API_KEY,
        }, timeout=10)
        data = r.json()
        if data['status'] == 'OK' and data['results']:
            loc = data['results'][0]['geometry']['location']
            return loc['lat'], loc['lng']
        if data['status'] == 'REQUEST_DENIED':
            print(f"\n  ERROR: API key rechazada — {data.get('error_message', '')}")
            return 'DENIED', None
        if data['status'] == 'OVER_QUERY_LIMIT':
            print(f"\n  ERROR: Limite de peticiones alcanzado")
            return 'LIMIT', None
    except Exception as e:
        print(f"\n  Error red: {e}")
    return None, None


def main():
    print("=== Geocodificar direcciones de entrega sin coordenadas (Google API) ===\n")

    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    # Contar total
    cursor.execute("SELECT COUNT(*) as total FROM direcciones_entrega WHERE activo = 1 AND (x IS NULL OR x = 0)")
    total = cursor.fetchone()['total']
    print(f"Direcciones sin coordenadas: {total}")

    if total == 0:
        print("No hay direcciones que geocodificar.")
        conn.close()
        return

    # Cargar direcciones sin coordenadas
    cursor.execute("""
        SELECT de.id, de.id_cliente, de.descripcion, de.direccion, de.direccion_2,
               de.codigo_postal, de.localidad, de.provincia, de.pais,
               c.nombre as cliente_nombre
        FROM direcciones_entrega de
        JOIN clientes c ON c.id = de.id_cliente
        WHERE de.activo = 1 AND (de.x IS NULL OR de.x = 0)
        ORDER BY de.id_cliente, de.id
    """)
    dirs = cursor.fetchall()

    ok_count = 0
    fail_count = 0
    skip_count = 0

    for i, d in enumerate(dirs):
        dir_id = d['id']
        cliente = d['cliente_nombre'] or ''
        desc = d['descripcion'] or ''
        address = (d['direccion'] or '').strip()
        address2 = (d['direccion_2'] or '').strip()
        cp = (d['codigo_postal'] or '').strip()
        localidad = (d['localidad'] or '').strip()
        provincia = (d['provincia'] or '').strip()

        # Construir query de geocodificacion
        # Prioridad: direccion + localidad + cp + provincia
        parts = []
        if address:
            parts.append(address)
        if address2:
            parts.append(address2)
        if localidad:
            parts.append(localidad)
        if cp:
            parts.append(cp)
        if provincia:
            parts.append(provincia)
        parts.append('España')

        query = ', '.join(parts)

        if not address and not cp:
            print(f"[{i+1}/{total}] {cliente[:30]} / {desc[:25]} — SIN DIRECCION, saltado")
            skip_count += 1
            continue

        label = f"{cliente[:25]} / {desc[:25]}"
        print(f"[{i+1}/{total}] {label}...", end=' ')

        lat, lng = geocode_google(query)

        # Control de errores fatales
        if lat == 'DENIED':
            print("\nAPI key no valida. Abortando.")
            break
        if lat == 'LIMIT':
            print("\nLimite de API alcanzado. Abortando.")
            break

        if lat is not None:
            print(f"OK ({lat:.6f}, {lng:.6f})")
            cursor.execute(
                "UPDATE direcciones_entrega SET x = %s, y = %s WHERE id = %s",
                (round(lat, 6), round(lng, 6), dir_id)
            )
            ok_count += 1
        else:
            # Segundo intento: solo CP + localidad
            fallback = f"{cp}, {localidad}, España" if cp else None
            if fallback:
                lat2, lng2 = geocode_google(fallback)
                if lat2 is not None and lat2 not in ('DENIED', 'LIMIT'):
                    print(f"OK por CP ({lat2:.6f}, {lng2:.6f})")
                    cursor.execute(
                        "UPDATE direcciones_entrega SET x = %s, y = %s WHERE id = %s",
                        (round(lat2, 6), round(lng2, 6), dir_id)
                    )
                    ok_count += 1
                    time.sleep(DELAY)
                    continue
            print("FALLO")
            fail_count += 1

        # Commit cada 50 registros
        if (i + 1) % 50 == 0:
            conn.commit()
            print(f"  >>> Progreso: {ok_count} OK, {fail_count} fallos, {skip_count} saltados")

        time.sleep(DELAY)

    conn.commit()
    conn.close()

    print()
    print(f"=== COMPLETADO ===")
    print(f"Geocodificadas: {ok_count}/{total}")
    print(f"Fallidas:       {fail_count}/{total}")
    print(f"Saltadas:       {skip_count}/{total}")


if __name__ == '__main__':
    main()

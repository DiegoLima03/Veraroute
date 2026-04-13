"""
B5: Geocodifica los clientes sin coordenadas directamente desde la BD
usando Google Geocoding API.

Lee clientes con x IS NULL OR x = 0, geocodifica con Google y actualiza
la BD directamente. Prioriza clientes activos.

Uso: python geocode_clientes_bd.py
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
# Lee la key de config/.env o de variable de entorno
def _load_google_key():
    # Intentar leer de config/.env
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
DELAY = 0.05  # 50ms entre peticiones (Google aguanta alto volumen)

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
    print("=== B5: Geocodificar clientes sin coordenadas (Google API) ===\n")

    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    # Contar total
    cursor.execute("SELECT COUNT(*) as total FROM clients WHERE x IS NULL OR x = 0")
    total = cursor.fetchone()['total']
    print(f"Clientes sin coordenadas: {total}")

    if total == 0:
        print("No hay clientes que geocodificar.")
        conn.close()
        return

    # Cargar clientes sin coordenadas, activos primero
    cursor.execute("""
        SELECT id, name, address, postcode
        FROM clients
        WHERE x IS NULL OR x = 0
        ORDER BY active DESC, id ASC
    """)
    clientes = cursor.fetchall()

    ok_count = 0
    fail_count = 0
    skip_count = 0

    for i, c in enumerate(clientes):
        client_id = c['id']
        name = c['name'] or ''
        address = (c['address'] or '').strip()
        postcode = (c['postcode'] or '').strip()

        # Construir query: usar address completa (ya incluye localidad y pais)
        if not address and not postcode:
            print(f"[{i+1}/{total}] {name[:50]} — SIN DIRECCION, saltado")
            skip_count += 1
            continue

        query = address if address else f"{postcode}, Spain"

        print(f"[{i+1}/{total}] {name[:45]}...", end=' ')

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
                "UPDATE clients SET x = %s, y = %s WHERE id = %s",
                (round(lat, 6), round(lng, 6), client_id)
            )
            ok_count += 1
        else:
            # Segundo intento: solo con codigo postal si address fallo
            if postcode:
                lat2, lng2 = geocode_google(f"{postcode}, Spain")
                if lat2 is not None and lat2 not in ('DENIED', 'LIMIT'):
                    print(f"OK por CP ({lat2:.6f}, {lng2:.6f})")
                    cursor.execute(
                        "UPDATE clients SET x = %s, y = %s WHERE id = %s",
                        (round(lat2, 6), round(lng2, 6), client_id)
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
    print(f"Geocodificados: {ok_count}/{total}")
    print(f"Fallidos:       {fail_count}/{total}")
    print(f"Saltados:       {skip_count}/{total}")


if __name__ == '__main__':
    main()

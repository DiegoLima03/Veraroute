#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Informe de Rentabilidad de Rutas — Análisis por Distancia
Genera un HTML interactivo con mapas Leaflet y tablas filtrables.
"""

import json
import math
import time
import sys
import os
from datetime import datetime

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import mysql.connector
import requests

# ─── CONFIGURACIÓN ────────────────────────────────────────────────
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3308,
    "user": "root",
    "password": "",
    "database": "gestorrutas",
}

OSRM_BASE = "https://router.project-osrm.org"
OSRM_DELAY = 0.06          # segundos entre llamadas OSRM
COORD_PRECISION = 5         # decimales para caché (igual que PHP)
MAX_2OPT_ITERS = 800       # límite iteraciones 2-opt por ruta
MAX_2OPT_SECONDS = 30       # límite tiempo 2-opt por ruta

UMBRAL_RENTABLE = 5         # km desvío — por debajo: RENTABLE
UMBRAL_REVISAR = 15         # km desvío — entre 5-15: REVISAR, >15: NO RENTABLE

RUTA_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f39c12",
    "#1abc9c", "#e67e22", "#2c3e50", "#d35400", "#8e44ad",
    "#16a085", "#c0392b", "#27ae60", "#2980b9", "#f1c40f",
]

CLASIF_COLORS = {
    "RENTABLE": "#2ecc71",
    "REVISAR": "#f39c12",
    "NO RENTABLE": "#e74c3c",
}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")

# ─── BASE DE DATOS ────────────────────────────────────────────────

def get_connection():
    return mysql.connector.connect(**DB_CONFIG)


def cargar_datos():
    conn = get_connection()
    cur = conn.cursor(dictionary=True)

    cur.execute("""
        SELECT c.id, c.name, c.address, c.x, c.y, c.ruta_id, c.delegation_id,
               r.name AS ruta_name
        FROM clients c
        LEFT JOIN rutas r ON c.ruta_id = r.id
        WHERE c.active = 1 AND c.x IS NOT NULL AND c.y IS NOT NULL
              AND c.x != 0 AND c.y != 0
        ORDER BY c.name
    """)
    clientes = cur.fetchall()

    cur.execute("SELECT * FROM rutas ORDER BY name")
    rutas = cur.fetchall()

    cur.execute("SELECT * FROM delegations WHERE active = 1 ORDER BY name")
    delegaciones = cur.fetchall()

    cur.close()
    conn.close()
    return clientes, rutas, delegaciones


# ─── CLIENTE OSRM CON CACHÉ ──────────────────────────────────────

class OSRMClient:
    def __init__(self):
        self.conn = get_connection()
        self.cache_hits = 0
        self.osrm_calls = 0
        self.consecutive_failures = 0

    def close(self):
        self.conn.close()

    def _round(self, v):
        return round(v, COORD_PRECISION)

    # ── caché ──
    def _cache_get(self, lat1, lng1, lat2, lng2):
        cur = self.conn.cursor(dictionary=True)
        cur.execute(
            "SELECT distance_km, duration_s FROM distance_cache "
            "WHERE origin_lat=%s AND origin_lng=%s AND dest_lat=%s AND dest_lng=%s",
            (self._round(lat1), self._round(lng1), self._round(lat2), self._round(lng2)),
        )
        row = cur.fetchone()
        cur.close()
        return row

    def _cache_set(self, lat1, lng1, lat2, lng2, km, secs):
        cur = self.conn.cursor()
        try:
            cur.execute(
                "INSERT IGNORE INTO distance_cache "
                "(origin_lat, origin_lng, dest_lat, dest_lng, distance_km, duration_s) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (self._round(lat1), self._round(lng1),
                 self._round(lat2), self._round(lng2), km, secs),
            )
            self.conn.commit()
        except Exception:
            pass
        finally:
            cur.close()

    # ── haversine ──
    @staticmethod
    def haversine(lat1, lng1, lat2, lng2):
        R = 6371.0
        dLat = math.radians(lat2 - lat1)
        dLng = math.radians(lng2 - lng1)
        a = math.sin(dLat / 2) ** 2 + (
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng / 2) ** 2
        )
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # ── distancia punto a punto ──
    def get_distance(self, lat1, lng1, lat2, lng2):
        """Devuelve (km, seconds). Usa caché → OSRM → Haversine."""
        cached = self._cache_get(lat1, lng1, lat2, lng2)
        if cached:
            self.cache_hits += 1
            return cached["distance_km"], cached["duration_s"]

        if self.consecutive_failures < 3:
            try:
                url = (
                    f"{OSRM_BASE}/route/v1/driving/"
                    f"{lng1},{lat1};{lng2},{lat2}?overview=false"
                )
                r = requests.get(url, timeout=10)
                data = r.json()
                if data.get("code") == "Ok" and data.get("routes"):
                    km = round(data["routes"][0]["distance"] / 1000, 3)
                    secs = round(data["routes"][0]["duration"], 1)
                    self._cache_set(lat1, lng1, lat2, lng2, km, secs)
                    self.osrm_calls += 1
                    self.consecutive_failures = 0
                    time.sleep(OSRM_DELAY)
                    return km, secs
            except Exception:
                self.consecutive_failures += 1

        km = round(self.haversine(lat1, lng1, lat2, lng2), 3)
        secs = round((km / 50) * 3600, 1)
        self._cache_set(lat1, lng1, lat2, lng2, km, secs)
        return km, secs

    # ── tabla NxN ──
    def build_matrix(self, points):
        """points = [{'lat': ..., 'lng': ...}, ...]. Devuelve distances[][]."""
        n = len(points)
        dist = [[0.0] * n for _ in range(n)]
        missing = []

        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                cached = self._cache_get(
                    points[i]["lat"], points[i]["lng"],
                    points[j]["lat"], points[j]["lng"],
                )
                if cached:
                    dist[i][j] = cached["distance_km"]
                    self.cache_hits += 1
                else:
                    missing.append((i, j))

        # intentar OSRM table si <= 100 puntos
        if missing and n <= 100 and self.consecutive_failures < 3:
            coords = ";".join(f"{p['lng']},{p['lat']}" for p in points)
            url = f"{OSRM_BASE}/table/v1/driving/{coords}?annotations=distance,duration"
            try:
                r = requests.get(url, timeout=30)
                data = r.json()
                if data.get("code") == "Ok":
                    for i in range(n):
                        for j in range(n):
                            if i == j:
                                continue
                            km = round(data["distances"][i][j] / 1000, 3)
                            secs = round(data["durations"][i][j], 1)
                            dist[i][j] = km
                            self._cache_set(
                                points[i]["lat"], points[i]["lng"],
                                points[j]["lat"], points[j]["lng"], km, secs,
                            )
                    self.osrm_calls += 1
                    self.consecutive_failures = 0
                    time.sleep(OSRM_DELAY)
                    return dist
            except Exception:
                self.consecutive_failures += 1

        # fallback par a par
        for i, j in missing:
            km, _ = self.get_distance(
                points[i]["lat"], points[i]["lng"],
                points[j]["lat"], points[j]["lng"],
            )
            dist[i][j] = km

        return dist

    # ── geometría de ruta multi-waypoint ──
    def get_route_geometry(self, waypoints):
        """waypoints = [{'lat':..,'lng':..}, ...]. Devuelve [[lat,lng], ...] o []."""
        if len(waypoints) < 2:
            return []
        coords = ";".join(f"{p['lng']},{p['lat']}" for p in waypoints)
        try:
            url = f"{OSRM_BASE}/route/v1/driving/{coords}?overview=full&geometries=geojson"
            r = requests.get(url, timeout=30)
            data = r.json()
            if data.get("code") == "Ok" and data.get("routes"):
                # GeoJSON coords son [lng, lat] → convertir a [lat, lng]
                return [[c[1], c[0]] for c in data["routes"][0]["geometry"]["coordinates"]]
        except Exception:
            pass
        # fallback: líneas rectas
        return [[p["lat"], p["lng"]] for p in waypoints]


# ─── OPTIMIZADOR DE RUTAS ────────────────────────────────────────

class RouteOptimizer:
    def __init__(self, osrm: OSRMClient):
        self.osrm = osrm

    def nearest_neighbor(self, dist_matrix, depot_idx=0):
        """Devuelve orden de visita (incluye depot al inicio y final)."""
        n = len(dist_matrix)
        visited = {depot_idx}
        order = [depot_idx]
        current = depot_idx

        while len(visited) < n:
            best_j, best_d = -1, float("inf")
            for j in range(n):
                if j not in visited and dist_matrix[current][j] < best_d:
                    best_d = dist_matrix[current][j]
                    best_j = j
            if best_j == -1:
                break
            visited.add(best_j)
            order.append(best_j)
            current = best_j

        order.append(depot_idx)  # vuelta al depot
        return order

    def two_opt(self, order, dist_matrix):
        """Mejora la ruta con 2-opt. Devuelve orden mejorado."""
        n = len(order)
        improved = True
        iters = 0
        t0 = time.time()

        while improved:
            improved = False
            for i in range(1, n - 2):
                for j in range(i + 1, n - 1):
                    iters += 1
                    if iters > MAX_2OPT_ITERS or (time.time() - t0) > MAX_2OPT_SECONDS:
                        return order

                    d_old = dist_matrix[order[i - 1]][order[i]] + dist_matrix[order[j]][order[j + 1]]
                    d_new = dist_matrix[order[i - 1]][order[j]] + dist_matrix[order[i]][order[j + 1]]
                    if d_new < d_old - 0.001:
                        order[i : j + 1] = reversed(order[i : j + 1])
                        improved = True
        return order

    def optimize(self, dist_matrix, depot_idx=0):
        """Nearest neighbor + 2-opt. Devuelve orden de índices."""
        order = self.nearest_neighbor(dist_matrix, depot_idx)
        order = self.two_opt(order, dist_matrix)
        return order

    @staticmethod
    def route_distance(order, dist_matrix):
        """Distancia total de una ruta ordenada."""
        total = 0.0
        for k in range(len(order) - 1):
            total += dist_matrix[order[k]][order[k + 1]]
        return round(total, 2)


# ─── ANÁLISIS POR RUTA ───────────────────────────────────────────

def asignar_delegacion(ruta_clientes, delegaciones, osrm):
    """Determina la delegación de origen para una ruta."""
    if not delegaciones:
        return None

    if len(delegaciones) == 1:
        return delegaciones[0]

    # frecuencia de delegation_id en los clientes
    freq = {}
    for c in ruta_clientes:
        did = c.get("delegation_id")
        if did:
            freq[did] = freq.get(did, 0) + 1
    if freq:
        best_id = max(freq, key=freq.get)
        for d in delegaciones:
            if d["id"] == best_id:
                return d

    # centroide → delegación más cercana
    avg_lat = sum(float(c["x"]) for c in ruta_clientes) / len(ruta_clientes)
    avg_lng = sum(float(c["y"]) for c in ruta_clientes) / len(ruta_clientes)
    best, best_d = None, float("inf")
    for d in delegaciones:
        dd = OSRMClient.haversine(avg_lat, avg_lng, float(d["x"]), float(d["y"]))
        if dd < best_d:
            best_d = dd
            best = d
    return best


def _build_sub_matrix(dist_matrix, indices):
    """Extrae submatriz de dist_matrix para los índices dados."""
    return [[dist_matrix[a][b] for b in indices] for a in indices]


def _point_name(pidx, clientes_ruta, delegacion):
    if pidx == 0:
        return delegacion["name"]
    return clientes_ruta[pidx - 1]["name"]


def analizar_ruta(ruta, clientes_ruta, delegacion, osrm, optimizer):
    """Analiza una ruta con desvío marginal secuencial.

    Proceso:
    1. Optimiza ruta con todos los clientes
    2. Calcula desvío inicial de cada cliente (quitar uno y reoptimizar)
    3. Clasifica provisionalmente
    4. Elimina el peor, reoptimiza, recalcula desvíos del resto
    5. Repite hasta que no queden clientes por encima del umbral
    6. El desvío final de cada cliente es el MARGINAL (cuánto ahorró
       al quitarlo respecto a la ruta que ya no tenía los peores)
    → La suma de desvíos de los eliminados = ahorro real total
    """
    if not clientes_ruta or not delegacion:
        return None

    n_clients = len(clientes_ruta)
    print(f"  Construyendo matriz de distancias ({n_clients} clientes + depot)...")

    # construir puntos: [depot, cliente0, cliente1, ...]
    points = [{"lat": float(delegacion["x"]), "lng": float(delegacion["y"])}]
    for c in clientes_ruta:
        points.append({"lat": float(c["x"]), "lng": float(c["y"])})

    dist_matrix = osrm.build_matrix(points)

    # datos base por cliente: distancia a delegación y vecino más cercano
    base_info = {}
    for ci in range(n_clients):
        idx = ci + 1
        dist_deleg = dist_matrix[0][idx]
        vecino_min = float("inf")
        for cj in range(n_clients):
            if cj == ci:
                continue
            d = dist_matrix[idx][cj + 1]
            if d < vecino_min:
                vecino_min = d
        if vecino_min == float("inf"):
            vecino_min = 0.0
        base_info[ci] = {
            "distancia_delegacion_km": round(dist_deleg, 2),
            "vecino_cercano_km": round(vecino_min, 2),
        }

    # ── FASE 1: Desvío marginal secuencial ──
    # Índices activos en points[] (0=depot, 1..n=clientes)
    active_indices = list(range(n_clients + 1))  # [0, 1, 2, ..., n]
    # ci → idx_in_points mapping
    ci_to_idx = {ci: ci + 1 for ci in range(n_clients)}

    # Resultado por cliente: ci → desvio marginal
    desvios_marginales = {}
    eliminados_orden = []  # [(ci, desvio_marginal, km_ruta_antes)]

    # Ruta completa inicial
    print("  Optimizando ruta completa...")
    sub = _build_sub_matrix(dist_matrix, active_indices)
    order = optimizer.optimize(sub, depot_idx=0)
    km_current = optimizer.route_distance(order, sub)
    km_full = km_current

    print(f"  Km ruta completa: {km_full}")
    print(f"  Calculando desvíos marginales secuenciales...")

    iteration = 0
    while True:
        iteration += 1
        # Clientes activos (sin depot y sin eliminados)
        active_ci = [ci for ci in range(n_clients) if ci_to_idx[ci] in active_indices]

        if not active_ci:
            break

        # Calcular desvío de cada cliente activo respecto a la ruta actual
        print(f"    Iteración {iteration}: {len(active_ci)} clientes activos, ruta={km_current} km")
        candidate_desvios = {}

        for ci in active_ci:
            idx = ci_to_idx[ci]
            # submatriz sin este cliente
            indices_sin = [i for i in active_indices if i != idx]
            sub_sin = _build_sub_matrix(dist_matrix, indices_sin)
            order_sin = optimizer.optimize(sub_sin, depot_idx=0)
            km_sin = optimizer.route_distance(order_sin, sub_sin)
            dev = round(km_current - km_sin, 2)
            if dev < 0:
                dev = 0.0
            candidate_desvios[ci] = dev

        # Encontrar el peor
        worst_ci = max(candidate_desvios, key=candidate_desvios.get)
        worst_dev = candidate_desvios[worst_ci]

        if worst_dev < UMBRAL_RENTABLE:
            # Todos los restantes son rentables, asignar desvíos y terminar
            for ci in active_ci:
                desvios_marginales[ci] = candidate_desvios[ci]
            break

        # Eliminar el peor
        worst_name = clientes_ruta[worst_ci]["name"]
        print(f"      Eliminando: {worst_name} (desvio marginal: {worst_dev} km)")

        desvios_marginales[worst_ci] = worst_dev
        eliminados_orden.append((worst_ci, worst_dev, km_current))

        # Actualizar activos
        active_indices = [i for i in active_indices if i != ci_to_idx[worst_ci]]

        # Reoptimizar sin el eliminado
        sub = _build_sub_matrix(dist_matrix, active_indices)
        order = optimizer.optimize(sub, depot_idx=0)
        km_current = optimizer.route_distance(order, sub)

        # Si ya no quedan por encima del umbral revisar, calcular los restantes
        remaining_ci = [ci for ci in range(n_clients) if ci_to_idx[ci] in active_indices]
        if not remaining_ci:
            break

    # Para clientes que no fueron procesados en el bucle (salió por break temprano)
    for ci in range(n_clients):
        if ci not in desvios_marginales:
            desvios_marginales[ci] = 0.0

    # ── FASE 2: Construir explicación de posición en ruta ──
    # Ruta completa para la explicación
    sub_full = _build_sub_matrix(dist_matrix, list(range(n_clients + 1)))
    order_full = optimizer.optimize(sub_full, depot_idx=0)

    pos_in_route = {}
    for pos, local_idx in enumerate(order_full):
        if local_idx > 0:
            prev_local = order_full[pos - 1] if pos > 0 else 0
            next_local = order_full[pos + 1] if pos < len(order_full) - 1 else 0
            pos_in_route[local_idx] = (prev_local, next_local, pos)

    # ── FASE 3: Construir resultados ──
    resultados = []
    for ci in range(n_clients):
        idx = ci + 1
        desvio = desvios_marginales[ci]

        if desvio < UMBRAL_RENTABLE:
            clasif = "RENTABLE"
        elif desvio < UMBRAL_REVISAR:
            clasif = "REVISAR"
        else:
            clasif = "NO RENTABLE"

        # Explicación posicional
        prev_idx, next_idx, orden_parada = pos_in_route.get(idx, (0, 0, 0))
        km_prev_cli = round(dist_matrix[prev_idx][idx], 2)
        km_cli_next = round(dist_matrix[idx][next_idx], 2)
        km_prev_next = round(dist_matrix[prev_idx][next_idx], 2)
        km_rodeo = round(km_prev_cli + km_cli_next - km_prev_next, 2)

        nombre_prev = _point_name(prev_idx, clientes_ruta, delegacion)
        nombre_next = _point_name(next_idx, clientes_ruta, delegacion)

        resultados.append({
            "id": clientes_ruta[ci]["id"],
            "nombre": clientes_ruta[ci]["name"],
            "direccion": clientes_ruta[ci].get("address", ""),
            "lat": float(clientes_ruta[ci]["x"]),
            "lng": float(clientes_ruta[ci]["y"]),
            "desvio_km": desvio,
            "distancia_delegacion_km": base_info[ci]["distancia_delegacion_km"],
            "vecino_cercano_km": base_info[ci]["vecino_cercano_km"],
            "clasificacion": clasif,
            "reasignacion_sugerida": None,
            "orden_parada": orden_parada,
            "explicacion": {
                "anterior": nombre_prev,
                "siguiente": nombre_next,
                "km_anterior_cliente": km_prev_cli,
                "km_cliente_siguiente": km_cli_next,
                "km_directo": km_prev_next,
                "km_rodeo": km_rodeo,
            },
        })

    # construir waypoints de la ruta óptima (con todos)
    waypoints_full = [points[i] for i in order_full]

    # ruta sin NO RENTABLE
    indices_sin_norent = [0]  # depot
    for ci, res in enumerate(resultados):
        if res["clasificacion"] != "NO RENTABLE":
            indices_sin_norent.append(ci + 1)

    if len(indices_sin_norent) > 1:
        sub_matrix_opt = _build_sub_matrix(dist_matrix, indices_sin_norent)
        order_opt = optimizer.optimize(sub_matrix_opt, depot_idx=0)
        km_opt = optimizer.route_distance(order_opt, sub_matrix_opt)
        waypoints_opt = [points[indices_sin_norent[i]] for i in order_opt]
    else:
        km_opt = 0.0
        waypoints_opt = []

    # ruta SOLO RENTABLES (sin NO RENTABLE ni REVISAR)
    indices_solo_rent = [0]  # depot
    for ci, res in enumerate(resultados):
        if res["clasificacion"] == "RENTABLE":
            indices_solo_rent.append(ci + 1)

    if len(indices_solo_rent) > 1:
        sub_matrix_strict = _build_sub_matrix(dist_matrix, indices_solo_rent)
        order_strict = optimizer.optimize(sub_matrix_strict, depot_idx=0)
        km_strict = optimizer.route_distance(order_strict, sub_matrix_strict)
        waypoints_strict = [points[indices_solo_rent[i]] for i in order_strict]
    else:
        km_strict = 0.0
        waypoints_strict = []

    n_no_rent = sum(1 for r in resultados if r["clasificacion"] == "NO RENTABLE")
    n_revisar = sum(1 for r in resultados if r["clasificacion"] == "REVISAR")
    n_rent = sum(1 for r in resultados if r["clasificacion"] == "RENTABLE")

    print(f"  → {n_no_rent} NO RENTABLE, {n_revisar} REVISAR, {n_rent} RENTABLE")
    print(f"  → Km actual: {km_full} | Sin no rent: {km_opt} | Solo rent: {km_strict}")

    return {
        "id": ruta["id"],
        "nombre": ruta["name"],
        "delegacion": delegacion["name"],
        "delegacion_lat": float(delegacion["x"]),
        "delegacion_lng": float(delegacion["y"]),
        "km_actual": km_full,
        "km_optimizado": km_opt,
        "km_solo_rentables": km_strict,
        "ahorro_km": round(km_full - km_opt, 2),
        "ahorro_strict_km": round(km_full - km_strict, 2),
        "total_clientes": n_clients,
        "n_rentable": n_rent,
        "n_revisar": n_revisar,
        "n_no_rentable": n_no_rent,
        "clientes": sorted(resultados, key=lambda r: -r["desvio_km"]),
        "waypoints_full": waypoints_full,
        "waypoints_opt": waypoints_opt,
        "waypoints_strict": waypoints_strict,
    }


# ─── REASIGNACIONES ──────────────────────────────────────────────

def analizar_reasignaciones(datos_rutas, osrm, optimizer):
    """Para clientes NO RENTABLE / REVISAR, busca si encajan mejor en otra ruta."""
    print("\nAnalizando reasignaciones posibles...")
    reasignaciones = []

    candidatos = []
    for dr in datos_rutas:
        for c in dr["clientes"]:
            if c["clasificacion"] in ("NO RENTABLE", "REVISAR"):
                candidatos.append((dr, c))

    total_cand = len(candidatos)
    print(f"  Candidatos a reasignar: {total_cand}")

    for idx_cand, (dr_actual, cliente) in enumerate(candidatos):
        print(f"  [{idx_cand+1}/{total_cand}] {cliente['nombre']} (ruta: {dr_actual['nombre']}, desvio: {cliente['desvio_km']} km)...", end="", flush=True)

        mejor_ruta = None
        mejor_desvio = cliente["desvio_km"]

        for dr_otra in datos_rutas:
            if dr_otra["id"] == dr_actual["id"]:
                continue
            if dr_otra["total_clientes"] < 1:
                continue

            # Pre-filtro Haversine a delegación: si en línea recta ya está lejos, skip
            hav_deleg = OSRMClient.haversine(
                cliente["lat"], cliente["lng"],
                dr_otra["delegacion_lat"], dr_otra["delegacion_lng"],
            )
            if hav_deleg > mejor_desvio * 3:
                continue

            # Buscar vecino más cercano con pre-filtro Haversine
            min_vecino = float("inf")
            for c2 in dr_otra["clientes"]:
                # Haversine rápido primero
                hav = OSRMClient.haversine(cliente["lat"], cliente["lng"], c2["lat"], c2["lng"])
                if hav * 2 >= min_vecino:
                    continue  # no puede mejorar
                d, _ = osrm.get_distance(
                    cliente["lat"], cliente["lng"], c2["lat"], c2["lng"],
                )
                if d < min_vecino:
                    min_vecino = d

            desvio_estimado = round(min_vecino * 2, 2)

            if desvio_estimado < mejor_desvio:
                mejor_desvio = desvio_estimado
                mejor_ruta = dr_otra

        if mejor_ruta and mejor_desvio < cliente["desvio_km"]:
            print(f" -> reasignar a '{mejor_ruta['nombre']}' ({mejor_desvio} km)", flush=True)
            reasig = {
                "cliente_id": cliente["id"],
                "nombre": cliente["nombre"],
                "ruta_actual": dr_actual["nombre"],
                "desvio_actual": cliente["desvio_km"],
                "ruta_sugerida": mejor_ruta["nombre"],
                "desvio_nuevo": mejor_desvio,
                "ahorro_km": round(cliente["desvio_km"] - mejor_desvio, 2),
            }
        else:
            print(f" -> sin mejora", flush=True)
            reasig = None

        if reasig:
            reasignaciones.append(reasig)

            # actualizar en datos del cliente
            cliente["reasignacion_sugerida"] = {
                "ruta": mejor_ruta["nombre"],
                "desvio": mejor_desvio,
            }

    reasignaciones.sort(key=lambda x: -x["ahorro_km"])
    print(f"  → {len(reasignaciones)} reasignaciones sugeridas")
    return reasignaciones


# ─── OBTENER GEOMETRÍAS OSRM ─────────────────────────────────────

def obtener_geometrias(datos_rutas, osrm):
    """Obtiene geometrías de ruta real OSRM para mapas."""
    print("\nObteniendo geometrías de ruta OSRM para mapas...")
    for dr in datos_rutas:
        if len(dr["waypoints_full"]) >= 2:
            print(f"  Geometría ruta '{dr['nombre']}' (actual)...")
            dr["geometria_actual"] = osrm.get_route_geometry(dr["waypoints_full"])
            time.sleep(OSRM_DELAY)
        else:
            dr["geometria_actual"] = []

        if len(dr["waypoints_opt"]) >= 2:
            print(f"  Geometría ruta '{dr['nombre']}' (sin no rentables)...")
            dr["geometria_optimizada"] = osrm.get_route_geometry(dr["waypoints_opt"])
            time.sleep(OSRM_DELAY)
        else:
            dr["geometria_optimizada"] = []

        if len(dr["waypoints_strict"]) >= 2:
            print(f"  Geometría ruta '{dr['nombre']}' (solo rentables)...")
            dr["geometria_strict"] = osrm.get_route_geometry(dr["waypoints_strict"])
            time.sleep(OSRM_DELAY)
        else:
            dr["geometria_strict"] = []


# ─── GENERACIÓN HTML ─────────────────────────────────────────────

def generar_html(datos_rutas, reasignaciones, delegaciones):
    """Genera el HTML interactivo completo."""

    total_clientes = sum(d["total_clientes"] for d in datos_rutas)
    total_rent = sum(d["n_rentable"] for d in datos_rutas)
    total_rev = sum(d["n_revisar"] for d in datos_rutas)
    total_no = sum(d["n_no_rentable"] for d in datos_rutas)
    km_actual = round(sum(d["km_actual"] for d in datos_rutas), 1)
    km_opt = round(sum(d["km_optimizado"] for d in datos_rutas), 1)
    ahorro = round(km_actual - km_opt, 1)
    ahorro_pct = round((ahorro / km_actual * 100) if km_actual > 0 else 0, 1)
    ahorro_anual = round(ahorro * 250, 0)  # 250 días laborables

    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")

    # serializar datos para JS
    js_data = json.dumps({
        "rutas": [{
            "id": d["id"],
            "nombre": d["nombre"],
            "delegacion": d["delegacion"],
            "deleg_lat": d["delegacion_lat"],
            "deleg_lng": d["delegacion_lng"],
            "km_actual": d["km_actual"],
            "km_optimizado": d["km_optimizado"],
            "geometria_actual": d.get("geometria_actual", []),
            "geometria_optimizada": d.get("geometria_optimizada", []),
            "geometria_strict": d.get("geometria_strict", []),
            "km_solo_rentables": d.get("km_solo_rentables", 0),
            "clientes": d["clientes"],
            "color": RUTA_COLORS[i % len(RUTA_COLORS)],
        } for i, d in enumerate(datos_rutas)],
        "delegaciones": [{
            "id": d["id"], "nombre": d["name"],
            "lat": float(d["x"]), "lng": float(d["y"]),
        } for d in delegaciones],
    }, ensure_ascii=False)

    # ── construir tablas por ruta
    secciones_rutas = ""
    for idx, dr in enumerate(datos_rutas):
        color = RUTA_COLORS[idx % len(RUTA_COLORS)]
        ahorro_r = dr["ahorro_km"]
        pct_r = round((ahorro_r / dr["km_actual"] * 100) if dr["km_actual"] > 0 else 0, 1)

        filas = ""
        for i, c in enumerate(dr["clientes"]):
            bg = "#fef9f9" if c["clasificacion"] == "NO RENTABLE" else (
                "#fefbf3" if c["clasificacion"] == "REVISAR" else "#f0faf4"
            )
            badge_color = CLASIF_COLORS[c["clasificacion"]]
            reasig_cell = ""
            if c["reasignacion_sugerida"]:
                reasig_cell = f'<span class="badge" style="background:{RUTA_COLORS[0]}">{c["reasignacion_sugerida"]["ruta"]} ({c["reasignacion_sugerida"]["desvio"]} km)</span>'
            else:
                reasig_cell = "—"

            filas += f"""<tr style="background:{bg}">
                <td>{i+1}</td>
                <td><strong>{c["nombre"]}</strong></td>
                <td class="addr">{c["direccion"]}</td>
                <td class="num">{c["desvio_km"]}</td>
                <td class="num">{c["distancia_delegacion_km"]}</td>
                <td class="num">{c["vecino_cercano_km"]}</td>
                <td><span class="badge" style="background:{badge_color}">{c["clasificacion"]}</span></td>
                <td>{reasig_cell}</td>
            </tr>"""

        secciones_rutas += f"""
        <div class="ruta-section" id="ruta-{dr['id']}">
            <div class="ruta-header" style="border-left: 5px solid {color}">
                <h2>{dr['nombre']}</h2>
                <div class="ruta-meta">
                    <span>Delegación: <strong>{dr['delegacion']}</strong></span>
                    <span>Clientes: <strong>{dr['total_clientes']}</strong></span>
                    <span style="color:#2ecc71">Rentables: <strong>{dr['n_rentable']}</strong></span>
                    <span style="color:#f39c12">Revisar: <strong>{dr['n_revisar']}</strong></span>
                    <span style="color:#e74c3c">No rentables: <strong>{dr['n_no_rentable']}</strong></span>
                </div>
                <div class="ruta-kpis">
                    <div class="mini-kpi">
                        <span class="mini-val">{dr['km_actual']} km</span>
                        <span class="mini-label">Ruta actual</span>
                    </div>
                    <div class="mini-kpi">
                        <span class="mini-val">{dr['km_optimizado']} km</span>
                        <span class="mini-label">Sin no rentables</span>
                    </div>
                    <div class="mini-kpi highlight">
                        <span class="mini-val">-{ahorro_r} km</span>
                        <span class="mini-label">Ahorro ({pct_r}%)</span>
                    </div>
                </div>
            </div>
            <div class="map-container" id="map-ruta-{dr['id']}" style="height:500px"></div>
            <div class="map-controls">
                <label><input type="radio" name="ruta-view-{dr['id']}" class="toggle-vista" data-ruta="{dr['id']}" data-vista="actual" checked> <span style="color:{color}">&#9632;</span> Ruta actual ({dr['km_actual']} km)</label>
                &nbsp;&nbsp;
                <label><input type="radio" name="ruta-view-{dr['id']}" class="toggle-vista" data-ruta="{dr['id']}" data-vista="optimizada"> <span style="color:#2ecc71">&#9632;</span> Sin no rentables ({dr['km_optimizado']} km)</label>
                &nbsp;&nbsp;
                <label><input type="radio" name="ruta-view-{dr['id']}" class="toggle-vista" data-ruta="{dr['id']}" data-vista="strict"> <span style="color:#3498db">&#9632;</span> Solo rentables ({dr['km_solo_rentables']} km)</label>
            </div>
            <div class="table-wrapper">
                <input type="text" class="table-filter" data-table="table-{dr['id']}" placeholder="Buscar cliente...">
                <table class="data-table" id="table-{dr['id']}">
                    <thead>
                        <tr>
                            <th>#</th><th>Cliente</th><th>Dirección</th>
                            <th>Desvío (km)</th><th>Dist. Deleg. (km)</th>
                            <th>Vecino cercano (km)</th><th>Clasificación</th>
                            <th>Reasignación</th>
                        </tr>
                    </thead>
                    <tbody>{filas}</tbody>
                </table>
            </div>
        </div>"""

    # ── tabla reasignaciones
    filas_reasig = ""
    for r in reasignaciones:
        filas_reasig += f"""<tr>
            <td><strong>{r['nombre']}</strong></td>
            <td>{r['ruta_actual']}</td>
            <td class="num">{r['desvio_actual']}</td>
            <td style="color:#2ecc71"><strong>{r['ruta_sugerida']}</strong></td>
            <td class="num">{r['desvio_nuevo']}</td>
            <td class="num" style="color:#2ecc71"><strong>-{r['ahorro_km']}</strong></td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Informe de Rentabilidad de Rutas</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-polylinedecorator@1.6.0/dist/leaflet.polylineDecorator.js"></script>
<style>
:root {{
    --vz-negro: #10180e;
    --vz-marron1: #46331f;
    --vz-marron2: #85725e;
    --vz-crema: #e5e2dc;
    --vz-verde: #8e8b30;
    --vz-rojo: #c83c32;
    --vz-amarillo: #d4a830;
    --vz-blanco: #ffffff;
    --vz-verde-suave: rgba(142, 139, 48, 0.1);
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--vz-crema); color: var(--vz-negro); }}
.header {{
    background: var(--vz-verde);
    color: var(--vz-crema); padding: 40px 20px; text-align: center;
    border-bottom: 3px solid var(--vz-marron1);
    box-shadow: 0 2px 8px rgba(16, 24, 14, 0.15);
}}
.header h1 {{ font-size: 2em; margin-bottom: 8px; }}
.header .subtitle {{ opacity: 0.85; font-size: 1.1em; }}
.container {{ max-width: 1300px; margin: 0 auto; padding: 20px; }}

/* KPIs */
.kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 30px 0; }}
.kpi-card {{
    background: var(--vz-blanco); border-radius: 12px; padding: 24px 20px;
    text-align: center; box-shadow: 0 2px 8px rgba(16, 24, 14, 0.08);
    border: 1px solid var(--vz-marron2);
}}
.kpi-card .kpi-val {{ font-size: 2em; font-weight: 700; }}
.kpi-card .kpi-label {{ font-size: 0.85em; color: var(--vz-marron2); margin-top: 4px; }}
.kpi-card.green .kpi-val {{ color: var(--vz-verde); }}
.kpi-card.orange .kpi-val {{ color: var(--vz-amarillo); }}
.kpi-card.red .kpi-val {{ color: var(--vz-rojo); }}
.kpi-card.blue .kpi-val {{ color: var(--vz-marron1); }}

/* Mapa global */
.map-global {{ height: 550px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(16, 24, 14, 0.1); margin: 20px 0; border: 1px solid var(--vz-marron2); }}

/* Secciones ruta */
.ruta-section {{ background: var(--vz-blanco); border-radius: 12px; margin: 30px 0; box-shadow: 0 2px 8px rgba(16, 24, 14, 0.08); overflow: hidden; border: 1px solid var(--vz-marron2); }}
.ruta-header {{ padding: 24px; }}
.ruta-header h2 {{ font-size: 1.5em; margin-bottom: 10px; color: var(--vz-marron1); }}
.ruta-meta {{ display: flex; gap: 20px; flex-wrap: wrap; font-size: 0.95em; margin-bottom: 16px; }}
.ruta-kpis {{ display: flex; gap: 20px; flex-wrap: wrap; }}
.mini-kpi {{ background: var(--vz-crema); border-radius: 8px; padding: 12px 20px; text-align: center; border: 1px solid var(--vz-marron2); }}
.mini-kpi .mini-val {{ font-size: 1.3em; font-weight: 700; display: block; color: var(--vz-marron1); }}
.mini-kpi .mini-label {{ font-size: 0.8em; color: var(--vz-marron2); }}
.mini-kpi.highlight {{ background: var(--vz-verde-suave); border-color: var(--vz-verde); }}
.mini-kpi.highlight .mini-val {{ color: var(--vz-verde); }}

.map-container {{ border-top: 1px solid var(--vz-marron2); }}
.map-controls {{ padding: 10px 24px; background: var(--vz-crema); border-bottom: 1px solid var(--vz-marron2); font-size: 0.9em; }}

/* Tablas */
.table-wrapper {{ padding: 20px 24px; }}
.table-filter {{
    width: 100%; padding: 10px 16px; border: 1px solid var(--vz-marron2); border-radius: 8px;
    font-size: 0.95em; margin-bottom: 12px; outline: none; background: var(--vz-blanco);
}}
.table-filter:focus {{ border-color: var(--vz-verde); box-shadow: 0 0 0 3px rgba(142, 139, 48, 0.15); }}
.data-table {{ width: 100%; border-collapse: collapse; font-size: 0.9em; }}
.data-table th {{
    background: var(--vz-verde); color: var(--vz-crema); padding: 12px 10px; text-align: left;
    position: sticky; top: 0;
}}
.data-table td {{ padding: 10px; border-bottom: 1px solid var(--vz-crema); }}
.data-table .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
.data-table .addr {{ max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85em; color: var(--vz-marron2); }}
.badge {{
    display: inline-block; padding: 3px 10px; border-radius: 12px;
    color: white; font-size: 0.8em; font-weight: 600;
}}

/* Reasignaciones */
.reasig-section {{ background: var(--vz-blanco); border-radius: 12px; padding: 24px; margin: 30px 0; box-shadow: 0 2px 8px rgba(16, 24, 14, 0.08); border: 1px solid var(--vz-marron2); }}
.reasig-section h2 {{ margin-bottom: 16px; color: var(--vz-marron1); }}

/* Conclusiones */
.conclusiones {{ background: var(--vz-blanco); border-radius: 12px; padding: 30px; margin: 30px 0; box-shadow: 0 2px 8px rgba(16, 24, 14, 0.08); line-height: 1.7; border: 1px solid var(--vz-marron2); }}
.conclusiones h2 {{ margin-bottom: 16px; color: var(--vz-marron1); }}
.conclusiones .highlight-num {{ font-weight: 700; color: var(--vz-rojo); }}
.conclusiones .highlight-save {{ font-weight: 700; color: var(--vz-verde); }}

/* Nav rutas */
.nav-rutas {{ display: flex; gap: 10px; flex-wrap: wrap; margin: 20px 0; }}
.nav-rutas a {{
    padding: 8px 16px; border-radius: 8px; background: var(--vz-blanco);
    text-decoration: none; color: var(--vz-marron1); font-size: 0.9em;
    box-shadow: 0 1px 4px rgba(16, 24, 14, 0.08); border: 1px solid var(--vz-marron2); transition: all 0.2s;
}}
.nav-rutas a:hover {{ background: var(--vz-verde); color: var(--vz-crema); border-color: var(--vz-verde); }}

/* Print */
@media print {{
    .map-controls, .table-filter, .nav-rutas {{ display: none; }}
    .ruta-section, .kpi-card {{ break-inside: avoid; }}
}}

/* Leyenda */
.legend {{
    background: var(--vz-blanco); padding: 12px 16px; border-radius: 8px;
    box-shadow: 0 1px 6px rgba(16, 24, 14, 0.15); line-height: 1.8; font-size: 0.85em;
    border: 1px solid var(--vz-marron2);
}}
.legend-dot {{
    display: inline-block; width: 12px; height: 12px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
}}
</style>
</head>
<body>

<div class="header">
    <h1>Informe de Rentabilidad de Rutas</h1>
    <div class="subtitle">Análisis por distancia de desvío — Generado por Diego Lima González — {fecha}</div>
</div>

<div class="container">

    <!-- KPIs -->
    <div class="kpi-grid">
        <div class="kpi-card blue">
            <div class="kpi-val">{total_clientes}</div>
            <div class="kpi-label">Clientes analizados</div>
        </div>
        <div class="kpi-card green">
            <div class="kpi-val">{total_rent}</div>
            <div class="kpi-label">Rentables ({round(total_rent/total_clientes*100) if total_clientes else 0}%)</div>
        </div>
        <div class="kpi-card orange">
            <div class="kpi-val">{total_rev}</div>
            <div class="kpi-label">Revisar ({round(total_rev/total_clientes*100) if total_clientes else 0}%)</div>
        </div>
        <div class="kpi-card red">
            <div class="kpi-val">{total_no}</div>
            <div class="kpi-label">No rentables ({round(total_no/total_clientes*100) if total_clientes else 0}%)</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-val">{km_actual}</div>
            <div class="kpi-label">Km totales actuales</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-val">{km_opt}</div>
            <div class="kpi-label">Km sin no rentables</div>
        </div>
        <div class="kpi-card green">
            <div class="kpi-val">-{ahorro} km</div>
            <div class="kpi-label">Ahorro por jornada ({ahorro_pct}%)</div>
        </div>
        <div class="kpi-card green">
            <div class="kpi-val">-{int(ahorro_anual)} km</div>
            <div class="kpi-label">Ahorro estimado anual</div>
        </div>
    </div>

    <!-- Navegación rutas -->
    <h2>Rutas analizadas</h2>
    <div class="nav-rutas">
        {"".join(f'<a href="#ruta-{d["id"]}">{d["nombre"]} ({d["n_no_rentable"]} no rent.)</a>' for d in datos_rutas)}
    </div>

    <!-- Mapa global -->
    <h2 style="margin-top:30px">Mapa general</h2>
    <div class="map-global" id="map-global"></div>
    <div style="padding:10px 0">
        <label><input type="checkbox" id="toggle-global-norent" checked> Mostrar clientes no rentables</label>
    </div>

    <!-- Secciones por ruta -->
    {secciones_rutas}

    <!-- Reasignaciones -->
    <div class="reasig-section" id="reasignaciones">
        <h2>Reasignaciones sugeridas</h2>
        <p style="margin-bottom:16px; color:#7f8c8d;">Clientes que generarían menor desvío si se movieran a otra ruta.</p>
        {"<p><em>No se encontraron reasignaciones beneficiosas.</em></p>" if not reasignaciones else f'''
        <table class="data-table">
            <thead><tr>
                <th>Cliente</th><th>Ruta actual</th><th>Desvío actual (km)</th>
                <th>Ruta sugerida</th><th>Desvío nuevo (km)</th><th>Ahorro (km)</th>
            </tr></thead>
            <tbody>{filas_reasig}</tbody>
        </table>'''}
    </div>

    <!-- Conclusiones -->
    <div class="conclusiones">
        <h2>Conclusiones</h2>
        <p>Se han analizado <strong>{total_clientes} clientes activos</strong> distribuidos en <strong>{len(datos_rutas)} rutas comerciales</strong>.</p>
        <p>Se identificaron <span class="highlight-num">{total_no} clientes no rentables</span> que generan un sobrecoste de
           <span class="highlight-num">{ahorro} km adicionales por jornada</span> en las rutas de reparto.</p>
        <p>Eliminando estos clientes de las rutas, el <span class="highlight-save">ahorro anual estimado sería de {int(ahorro_anual)} km</span>
           (basado en 250 jornadas laborables).</p>
        {"<p>Además, se sugiere la <strong>reasignación de " + str(len(reasignaciones)) + " clientes</strong> a rutas donde generarían menor desvío, como alternativa a la paquetería.</p>" if reasignaciones else ""}
        <p>Los <span class="highlight-num">{total_no} clientes restantes</span> que no admiten reasignación deberían evaluarse para
           <strong>envío por paquetería</strong>, lo que reduciría costes de transporte sin perder cobertura comercial.</p>
        <p style="margin-top:16px; font-size:0.9em; color:#95a5a6;">
            Nota: Este análisis se basa exclusivamente en distancias por carretera (OSRM).
            No incluye datos de facturación, frecuencia de pedidos ni costes de paquetería.
            Los umbrales utilizados son: Rentable &lt; {UMBRAL_RENTABLE} km desvío,
            Revisar {UMBRAL_RENTABLE}-{UMBRAL_REVISAR} km, No rentable &gt; {UMBRAL_REVISAR} km.
        </p>
    </div>
</div>

<script>
const DATA = {js_data};
const CLASIF_COLORS = {json.dumps(CLASIF_COLORS)};

function createMarkerIcon(color, size) {{
    return L.divIcon({{
        className: '',
        html: '<div style="background:'+color+';width:'+size+'px;height:'+size+'px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
        popupAnchor: [0, -size/2],
    }});
}}

function createDepotIcon() {{
    return L.divIcon({{
        className: '',
        html: '<div style="background:#1a1a2e;width:20px;height:20px;border-radius:4px;border:3px solid #f1c40f;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -12],
    }});
}}

function addArrows(polyline, map, color) {{
    return L.polylineDecorator(polyline, {{
        patterns: [{{
            offset: 30, repeat: 120,
            symbol: L.Symbol.arrowHead({{
                pixelSize: 8, polygon: true, headAngle: 40,
                pathOptions: {{fillOpacity: 0.85, weight: 0, color: color, fillColor: color}}
            }})
        }}]
    }}).addTo(map);
}}

// ── Mapa Global ──
(function() {{
    const map = L.map('map-global').setView([42.3, -8.2], 9);
    L.tileLayer('https://{{s}}.basemaps.cartocdn.com/rastertiles/voyager/{{z}}/{{x}}/{{y}}{{r}}.png', {{
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }}).addTo(map);

    const allMarkers = [];
    const noRentMarkers = [];
    const routeLines = [];
    const routeLinesOpt = [];
    const routeArrows = [];
    const routeArrowsOpt = [];

    // delegaciones
    DATA.delegaciones.forEach(d => {{
        L.marker([d.lat, d.lng], {{icon: createDepotIcon()}})
         .bindPopup('<strong>'+d.nombre+'</strong><br>Delegación')
         .addTo(map);
    }});

    // rutas
    DATA.rutas.forEach((ruta, ri) => {{
        // polyline actual
        if (ruta.geometria_actual.length > 1) {{
            const line = L.polyline(ruta.geometria_actual, {{color: ruta.color, weight: 3, opacity: 0.7}}).addTo(map);
            routeLines.push(line);
            routeArrows.push(addArrows(line, map, ruta.color));
        }}
        // polyline optimizada (oculta inicialmente)
        if (ruta.geometria_optimizada.length > 1) {{
            const lineOpt = L.polyline(ruta.geometria_optimizada, {{color: ruta.color, weight: 4, opacity: 0.9, dashArray: '8,6'}});
            routeLinesOpt.push(lineOpt);
        }}

        ruta.clientes.forEach(c => {{
            const color = CLASIF_COLORS[c.clasificacion];
            let popupHtml =
                '<strong>'+c.nombre+'</strong><br>'+
                'Ruta: '+ruta.nombre+'<br>'+
                'Desvío: '+c.desvio_km+' km<br>'+
                'Clasificación: <span style="color:'+color+';font-weight:700">'+c.clasificacion+'</span>';
            if (c.explicacion && c.clasificacion !== 'RENTABLE') {{
                const e = c.explicacion;
                popupHtml +=
                    '<hr style="margin:6px 0;border:0;border-top:1px solid #ccc">'+
                    '<strong style="font-size:0.85em">Por qué este desvío:</strong><br>'+
                    '<span style="font-size:0.82em">'+
                    'Parada #'+c.orden_parada+' en la ruta<br>'+
                    'Anterior: <strong>'+e.anterior+'</strong><br>'+
                    'Siguiente: <strong>'+e.siguiente+'</strong><br>'+
                    e.anterior+' → este cliente: <strong>'+e.km_anterior_cliente+' km</strong><br>'+
                    'Este cliente → '+e.siguiente+': <strong>'+e.km_cliente_siguiente+' km</strong><br>'+
                    'Ruta directa sin parar: <strong>'+e.km_directo+' km</strong><br>'+
                    'Rodeo: <strong style="color:#c83c32">+'+e.km_rodeo+' km</strong>'+
                    '</span>';
            }}
            const m = L.marker([c.lat, c.lng], {{icon: createMarkerIcon(color, 12)}})
                .bindPopup(popupHtml, {{maxWidth: 320}})
                .addTo(map);
            allMarkers.push(m);
            if (c.clasificacion === 'NO RENTABLE') noRentMarkers.push(m);
        }});
    }});

    // leyenda
    const legend = L.control({{position: 'bottomright'}});
    legend.onAdd = function() {{
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML =
            '<strong>Clasificación</strong><br>'+
            '<span class="legend-dot" style="background:#2ecc71"></span>Rentable (&lt;{UMBRAL_RENTABLE} km)<br>'+
            '<span class="legend-dot" style="background:#f39c12"></span>Revisar ({UMBRAL_RENTABLE}-{UMBRAL_REVISAR} km)<br>'+
            '<span class="legend-dot" style="background:#e74c3c"></span>No rentable (&gt;{UMBRAL_REVISAR} km)<br>'+
            '<span class="legend-dot" style="background:#1a1a2e;border-radius:3px"></span>Delegación';
        return div;
    }};
    legend.addTo(map);

    // auto-fit
    const allPoints = [];
    DATA.rutas.forEach(r => r.clientes.forEach(c => allPoints.push([c.lat, c.lng])));
    DATA.delegaciones.forEach(d => allPoints.push([d.lat, d.lng]));
    if (allPoints.length) map.fitBounds(allPoints);

    // toggle no rentables global
    document.getElementById('toggle-global-norent').addEventListener('change', function() {{
        const show = this.checked;
        noRentMarkers.forEach(m => {{ if(show) m.addTo(map); else map.removeLayer(m); }});
        routeLines.forEach(l => {{ if(show) l.addTo(map); else map.removeLayer(l); }});
        routeArrows.forEach(a => {{ if(show) a.addTo(map); else map.removeLayer(a); }});
        routeLinesOpt.forEach(l => {{ if(show) map.removeLayer(l); else l.addTo(map); }});
        routeArrowsOpt.forEach(a => {{ if(show) map.removeLayer(a); else a.addTo(map); }});
    }});
}})();

// ── Mapas por ruta ──
DATA.rutas.forEach((ruta, ri) => {{
    const mapDiv = document.getElementById('map-ruta-' + ruta.id);
    if (!mapDiv) return;

    const map = L.map(mapDiv).setView([ruta.deleg_lat, ruta.deleg_lng], 10);
    L.tileLayer('https://{{s}}.basemaps.cartocdn.com/rastertiles/voyager/{{z}}/{{x}}/{{y}}{{r}}.png', {{
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }}).addTo(map);

    // delegación
    L.marker([ruta.deleg_lat, ruta.deleg_lng], {{icon: createDepotIcon()}})
     .bindPopup('<strong>'+ruta.delegacion+'</strong><br>Delegación')
     .addTo(map);

    const noRentMarkers = [];
    const revisarMarkers = [];
    const rentMarkers = [];
    let lineActual = null, arrowsActual = null;
    let lineOpt = null, arrowsOpt = null;
    let lineStrict = null, arrowsStrict = null;

    // polyline ruta actual (visible por defecto)
    if (ruta.geometria_actual.length > 1) {{
        lineActual = L.polyline(ruta.geometria_actual, {{color: ruta.color, weight: 4, opacity: 0.8}}).addTo(map);
        arrowsActual = addArrows(lineActual, map, ruta.color);
    }}
    // polyline sin no rentables (oculta)
    if (ruta.geometria_optimizada.length > 1) {{
        lineOpt = L.polyline(ruta.geometria_optimizada, {{color: '#2ecc71', weight: 4, opacity: 0.8}});
        arrowsOpt = addArrows(lineOpt, map, '#2ecc71');
        map.removeLayer(arrowsOpt);
    }}
    // polyline solo rentables (oculta)
    if (ruta.geometria_strict.length > 1) {{
        lineStrict = L.polyline(ruta.geometria_strict, {{color: '#3498db', weight: 4, opacity: 0.8}});
        arrowsStrict = addArrows(lineStrict, map, '#3498db');
        map.removeLayer(arrowsStrict);
    }}

    // clientes
    const bounds = [[ruta.deleg_lat, ruta.deleg_lng]];
    ruta.clientes.forEach(c => {{
        const color = CLASIF_COLORS[c.clasificacion];
        let popupHtml =
            '<strong>'+c.nombre+'</strong><br>'+
            'Desvío: <strong>'+c.desvio_km+' km</strong><br>'+
            'Dist. delegación: '+c.distancia_delegacion_km+' km<br>'+
            'Vecino cercano: '+c.vecino_cercano_km+' km<br>'+
            '<span style="color:'+color+';font-weight:700">'+c.clasificacion+'</span>'+
            (c.reasignacion_sugerida ? '<br>Reasignar a: <strong>'+c.reasignacion_sugerida.ruta+'</strong>' : '');
        if (c.explicacion) {{
            const e = c.explicacion;
            popupHtml +=
                '<hr style="margin:6px 0;border:0;border-top:1px solid #ccc">'+
                '<strong style="font-size:0.85em">Desglose del desvío:</strong><br>'+
                '<span style="font-size:0.82em">'+
                'Parada #'+c.orden_parada+' en la ruta<br>'+
                '<strong>'+e.anterior+'</strong> → este cliente: '+e.km_anterior_cliente+' km<br>'+
                'Este cliente → <strong>'+e.siguiente+'</strong>: '+e.km_cliente_siguiente+' km<br>'+
                'Ruta directa (sin parar aquí): '+e.km_directo+' km<br>'+
                '<strong style="color:#c83c32">Rodeo: +'+e.km_rodeo+' km</strong>'+
                '</span>';
        }}
        const m = L.marker([c.lat, c.lng], {{icon: createMarkerIcon(color, 14)}})
            .bindPopup(popupHtml, {{maxWidth: 320}})
            .addTo(map);
        bounds.push([c.lat, c.lng]);
        if (c.clasificacion === 'NO RENTABLE') noRentMarkers.push(m);
        else if (c.clasificacion === 'REVISAR') revisarMarkers.push(m);
        else rentMarkers.push(m);
    }});

    if (bounds.length > 1) map.fitBounds(bounds, {{padding: [30, 30]}});

    // helper: ocultar todas las rutas
    function hideAll() {{
        [lineActual, lineOpt, lineStrict].forEach(l => {{ if(l) map.removeLayer(l); }});
        [arrowsActual, arrowsOpt, arrowsStrict].forEach(a => {{ if(a) map.removeLayer(a); }});
    }}

    // radio buttons: alternar entre las 3 vistas
    document.querySelectorAll('.toggle-vista[data-ruta="'+ruta.id+'"]').forEach(radio => {{
        radio.addEventListener('change', function() {{
            const vista = this.dataset.vista;
            hideAll();

            if (vista === 'actual') {{
                if (lineActual) lineActual.addTo(map);
                if (arrowsActual) arrowsActual.addTo(map);
                noRentMarkers.forEach(m => m.addTo(map));
                revisarMarkers.forEach(m => m.addTo(map));
            }} else if (vista === 'optimizada') {{
                if (lineOpt) lineOpt.addTo(map);
                if (arrowsOpt) arrowsOpt.addTo(map);
                noRentMarkers.forEach(m => map.removeLayer(m));
                revisarMarkers.forEach(m => m.addTo(map));
            }} else if (vista === 'strict') {{
                if (lineStrict) lineStrict.addTo(map);
                if (arrowsStrict) arrowsStrict.addTo(map);
                noRentMarkers.forEach(m => map.removeLayer(m));
                revisarMarkers.forEach(m => map.removeLayer(m));
            }}
        }});
    }});
}});

// ── Filtro de tablas ──
document.querySelectorAll('.table-filter').forEach(input => {{
    input.addEventListener('input', function() {{
        const filter = this.value.toLowerCase();
        const tableId = this.dataset.table;
        const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
        rows.forEach(row => {{
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
        }});
    }});
}});
</script>
</body>
</html>"""

    return html


# ─── MAIN ─────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("INFORME DE RENTABILIDAD DE RUTAS — Análisis por Distancia")
    print("=" * 60)

    print("\nConectando a BD gestorrutas...")
    clientes, rutas, delegaciones = cargar_datos()
    print(f"Cargados: {len(clientes)} clientes activos, {len(rutas)} rutas, {len(delegaciones)} delegaciones")

    if not clientes:
        print("ERROR: No se encontraron clientes activos con coordenadas.")
        sys.exit(1)

    osrm = OSRMClient()
    optimizer = RouteOptimizer(osrm)

    # agrupar clientes por ruta
    clientes_por_ruta = {}
    sin_ruta = []
    for c in clientes:
        rid = c.get("ruta_id")
        if rid:
            clientes_por_ruta.setdefault(rid, []).append(c)
        else:
            sin_ruta.append(c)

    if sin_ruta:
        print(f"\n⚠ {len(sin_ruta)} clientes sin ruta asignada (se omiten del análisis)")

    datos_rutas = []

    for ruta in rutas:
        ruta_clientes = clientes_por_ruta.get(ruta["id"], [])
        if not ruta_clientes:
            print(f"\nRuta '{ruta['name']}': sin clientes, omitida.")
            continue

        print(f"\nAnalizando ruta '{ruta['name']}' ({len(ruta_clientes)} clientes)...")
        delegacion = asignar_delegacion(ruta_clientes, delegaciones, osrm)
        if not delegacion:
            print("  ⚠ Sin delegación disponible, omitida.")
            continue

        resultado = analizar_ruta(ruta, ruta_clientes, delegacion, osrm, optimizer)
        if resultado:
            datos_rutas.append(resultado)

    # ordenar por ahorro desc
    datos_rutas.sort(key=lambda d: -d["ahorro_km"])

    # reasignaciones
    reasignaciones = analizar_reasignaciones(datos_rutas, osrm, optimizer)

    # geometrías OSRM para mapas
    obtener_geometrias(datos_rutas, osrm)

    print(f"\nEstadísticas OSRM: {osrm.cache_hits} cache hits, {osrm.osrm_calls} llamadas OSRM")
    osrm.close()

    # generar JSON
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total_clientes = sum(d["total_clientes"] for d in datos_rutas)
    km_actual = round(sum(d["km_actual"] for d in datos_rutas), 1)
    km_opt = round(sum(d["km_optimizado"] for d in datos_rutas), 1)

    datos_json = {
        "fecha_generacion": datetime.now().isoformat(),
        "umbrales": {"rentable_km": UMBRAL_RENTABLE, "revisar_km": UMBRAL_REVISAR},
        "resumen": {
            "total_clientes": total_clientes,
            "rentables": sum(d["n_rentable"] for d in datos_rutas),
            "revisar": sum(d["n_revisar"] for d in datos_rutas),
            "no_rentables": sum(d["n_no_rentable"] for d in datos_rutas),
            "km_actuales": km_actual,
            "km_optimizados": km_opt,
            "ahorro_km": round(km_actual - km_opt, 1),
            "ahorro_pct": round(((km_actual - km_opt) / km_actual * 100) if km_actual else 0, 1),
        },
        "rutas": [{
            "id": d["id"],
            "nombre": d["nombre"],
            "delegacion": d["delegacion"],
            "km_actual": d["km_actual"],
            "km_optimizado": d["km_optimizado"],
            "ahorro_km": d["ahorro_km"],
            "clientes": d["clientes"],
        } for d in datos_rutas],
        "reasignaciones": reasignaciones,
    }

    json_path = os.path.join(OUTPUT_DIR, "datos_rentabilidad.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(datos_json, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Datos guardados en: {json_path}")

    # generar HTML
    print("Generando HTML...")
    html = generar_html(datos_rutas, reasignaciones, delegaciones)
    html_path = os.path.join(OUTPUT_DIR, "informe_rentabilidad_rutas.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✓ Informe guardado en: {html_path}")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()

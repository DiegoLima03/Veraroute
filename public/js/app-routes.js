// ── ROUTE PANEL RENDERING & EDITING ──────────────────────
// Valores por defecto, se actualizan desde settings del backend
let LUNCH_DURATION = 60;
let LUNCH_EARLIEST = 12 * 60;
let LUNCH_LATEST = 15.5 * 60;

function renderRoutePanel(result) {
  let html = '';
  result.routes.forEach((r, ri) => {
    const color = ROUTE_COLORS[ri % ROUTE_COLORS.length];
    const depTime = (r.delegation.open_time || '06:00').substring(0, 5);

    // Calcular hora de regreso como rango (salida temprana y tardia)
    let returnEta = '';
    if (r.stops.length && r.stops[r.stops.length - 1].eta) {
      const totalMin = parseFloat(r.total_time_h) * 60;
      const depEarlyMin = parseInt(depTime.split(':')[0]) * 60 + parseInt(depTime.split(':')[1] || 0);
      const retEarly = depEarlyMin + totalMin;
      const reh = Math.floor(retEarly / 60) % 24;
      const rem = Math.round(retEarly % 60);
      const retEarlyStr = String(reh).padStart(2, '0') + ':' + String(rem).padStart(2, '0');

      const depLateStr = r.departure_latest || depTime;
      const depLateMin = parseInt(depLateStr.split(':')[0]) * 60 + parseInt(depLateStr.split(':')[1] || 0);
      const retLate = depLateMin + totalMin;
      const rlh = Math.floor(retLate / 60) % 24;
      const rlm = Math.round(retLate % 60);
      const retLateStr = String(rlh).padStart(2, '0') + ':' + String(rlm).padStart(2, '0');

      returnEta = retEarlyStr !== retLateStr ? retEarlyStr + ' - ' + retLateStr : retEarlyStr;
    }

    html += '<div class="vehicle-route" data-route-idx="' + ri + '">'
      + '<div class="vr-header" style="border-left:3px solid ' + color + '">'
      +   '<span class="vr-name">' + r.vehicle.name + (r.vehicle.plate ? ' (' + r.vehicle.plate + ')' : '') + '</span>'
      +   '<span class="rm green vr-dist">' + parseFloat(r.total_distance_km).toFixed(1) + ' km</span>'
      +   '<span class="rm orange vr-time">' + parseFloat(r.total_time_h).toFixed(1) + ' h</span>'
      +   '<span class="pill">' + r.stops.length + ' paradas</span>'
      + '</div>';

    // Salida desde delegacion con rango de hora
    const depEarliest = r.departure_earliest || depTime;
    const depLatest = r.departure_latest || depTime;
    const hasRange = depEarliest !== depLatest;
    const depLabel = hasRange ? depEarliest + ' - ' + depLatest : depEarliest;

    html += '<div class="rstop-item depot-item">'
      + '<span class="depot-icon">&#9873;</span>'
      + '<span class="stop-name">' + r.delegation.name + '</span>'
      + '<span class="stop-eta">' + depLabel + '</span>'
      + '<span class="stop-unload">Salida</span>'
      + '</div>';

    html += '<div class="route-stops-list" id="sortable-' + ri + '">';

    const lunchPos = r.lunch_after_stop;
    const lunchEta = r.lunch_eta;

    r.stops.forEach((s, si) => {
      // Insertar almuerzo antes de esta parada si el backend lo indica
      if (lunchPos !== null && lunchPos !== undefined && si === lunchPos) {
        const lunchEnd = lunchEta ? addMinutes(lunchEta, LUNCH_DURATION) : '';
        html += '<div class="rstop-item lunch-break">'
          + '<span class="lunch-icon">&#9749;</span>'
          + '<span class="stop-name">Almuerzo</span>'
          + '<span class="stop-eta">' + (lunchEta || '') + ' - ' + lunchEnd + '</span>'
          + '</div>';
      }

      // Indicador de tiempo de trayecto
      const travelMin = Math.round(s.travel_min || 0);
      if (travelMin > 0) {
        html += '<div class="travel-indicator">&darr; ' + travelMin + ' min</div>';
      }

      const unloadTxt = Math.round(s.unload_min || 0) + ' min';
      const itemsTxt = s.items_count ? ' (' + s.items_count + ' uds)' : '';
      const stopStatus = s.status || 'pending';
      const STATUS_CLS = { pending: '', completed: ' stop-done', skipped: ' stop-skipped' };
      const STATUS_ICO = { pending: '&#9675;', completed: '&#9679;', skipped: '&#10005;' };
      const planId = r.plan_id || 0;
      html += '<div class="rstop-item' + (STATUS_CLS[stopStatus] || '') + '" data-stop-idx="' + si + '" data-client-id="' + s.id_cliente + '">'
        + (planId ? '<span class="stop-status" onclick="event.stopPropagation();toggleStopStatus(' + planId + ',' + (si + 1) + ',\'' + stopStatus + '\')" title="Click: cambiar estado">' + (STATUS_ICO[stopStatus] || '') + '</span>' : '')
        + '<span class="drag-handle">&#9776;</span>'
        + '<span class="stop-num" style="background:' + color + '">' + (si + 1) + '</span>'
        + '<span class="stop-name">' + s.name + '</span>'
        + '<span class="stop-eta">' + (s.eta || '') + '</span>'
        + '<span class="stop-unload">' + unloadTxt + itemsTxt + '</span>'
        + '<button type="button" class="stop-remove" onclick="removeStop(' + ri + ',' + si + ')" title="Quitar parada">&times;</button>'
        + '</div>';
    });

    // Almuerzo despues del ultimo stop
    if (lunchPos !== null && lunchPos !== undefined && lunchPos === r.stops.length) {
      const lunchEnd = lunchEta ? addMinutes(lunchEta, LUNCH_DURATION) : '';
      html += '<div class="rstop-item lunch-break">'
        + '<span class="lunch-icon">&#9749;</span>'
        + '<span class="stop-name">Almuerzo</span>'
        + '<span class="stop-eta">' + (lunchEta || '') + ' - ' + lunchEnd + '</span>'
        + '</div>';
    }

    html += '</div>';

    // Indicador de regreso
    const returnMin = Math.round(r.return_travel_min || 0);
    if (returnMin > 0) {
      html += '<div class="travel-indicator">&darr; ' + returnMin + ' min</div>';
    }

    // Regreso a delegacion
    html += '<div class="rstop-item depot-item">'
      + '<span class="depot-icon">&#9873;</span>'
      + '<span class="stop-name">' + r.delegation.name + '</span>'
      + '<span class="stop-eta">' + returnEta + '</span>'
      + '<span class="stop-unload">Regreso</span>'
      + '</div>';

    html += '</div>';
  });

  if (result.unassigned?.length) {
    html += '<div style="margin-top:8px;font-size:10px;color:var(--danger)">Sin asignar: '
      + result.unassigned.map(u => u.name + ' (' + u.reason + ')').join(', ') + '</div>';
  }

  document.getElementById('rStops').innerHTML = html;
  document.getElementById('routePanel').classList.add('visible');
}

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function initSortables() {
  if (!fleetRoutes) return;
  fleetRoutes.routes.forEach((r, ri) => {
    const el = document.getElementById('sortable-' + ri);
    if (!el) return;
    new Sortable(el, {
      group: 'routes',
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      filter: '.lunch-break,.travel-indicator',
      onEnd: function(evt) { handleStopMove(evt); }
    });
  });
}

function handleStopMove(evt) {
  const fromIdx = parseInt(evt.from.id.replace('sortable-', ''));
  const toIdx = parseInt(evt.to.id.replace('sortable-', ''));
  const oldI = evt.oldIndex;
  const newI = evt.newIndex;

  // Ajustar indices: descontar elementos no-stop (almuerzo, indicadores de trayecto)
  const nonStop = '.lunch-break,.travel-indicator';
  const fromExtra = evt.from.querySelectorAll(nonStop);
  const toExtra = evt.to.querySelectorAll(nonStop);
  let adjustOld = 0, adjustNew = 0;
  fromExtra.forEach(l => { if (Array.from(evt.from.children).indexOf(l) < oldI) adjustOld++; });
  toExtra.forEach(l => { if (Array.from(evt.to.children).indexOf(l) < newI) adjustNew++; });

  const realOld = oldI - adjustOld;
  const realNew = newI - adjustNew;

  const stop = fleetRoutes.routes[fromIdx].stops.splice(realOld, 1)[0];
  fleetRoutes.routes[toIdx].stops.splice(realNew, 0, stop);

  // Eliminar rutas vacias
  fleetRoutes.routes = fleetRoutes.routes.filter(r => r.stops.length > 0);

  recalcRouteAfterEdit();
}

function removeStop(routeIdx, stopIdx) {
  fleetRoutes.routes[routeIdx].stops.splice(stopIdx, 1);
  fleetRoutes.routes = fleetRoutes.routes.filter(r => r.stops.length > 0);
  recalcRouteAfterEdit();
}

let recalcTimer = null;
async function recalcRouteAfterEdit() {
  // Debounce 300ms
  if (recalcTimer) clearTimeout(recalcTimer);
  recalcTimer = setTimeout(async () => {
    await doRecalcRoutes();
  }, 300);
}

async function doRecalcRoutes() {
  for (const r of fleetRoutes.routes) {
    if (!r.stops.length) continue;

    const waypoints = [
      { x: parseFloat(r.delegation.x), y: parseFloat(r.delegation.y) },
      ...r.stops.map(s => ({ x: parseFloat(s.x), y: parseFloat(s.y) })),
      { x: parseFloat(r.delegation.x), y: parseFloat(r.delegation.y) },
    ];

    try {
      const coords = waypoints.map(p => p.y + ',' + p.x).join(';');
      const url = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson';
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok') continue;

      const route = data.routes[0];
      r.geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
      r.total_distance_km = route.distance / 1000;

      const legs = route.legs;
      const delOpen = r.delegation.open_time || '06:00';
      const startMin = parseInt(delOpen.split(':')[0]) * 60 + parseInt(delOpen.split(':')[1] || 0);

      // Encontrar posicion optima para almuerzo
      const lunchResult = findBestLunchPositionJS(r.stops, legs, startMin);
      r.lunch_after_stop = lunchResult.pos;
      r.lunch_eta = lunchResult.eta;

      // Recalcular ETAs con almuerzo en posicion optima
      let t = startMin;
      r.stops.forEach((s, si) => {
        if (r.lunch_after_stop !== null && si === r.lunch_after_stop) {
          t += LUNCH_DURATION;
        }
        const legMin = legs[si].duration / 60;
        s.travel_min = Math.round(legMin);
        t += legMin;
        const h = Math.floor(t / 60) % 24;
        const m = Math.round(t % 60);
        s.eta = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        t += parseFloat(s.unload_min || 0);
      });

      // Tiempo de regreso (ultimo leg = vuelta a delegacion)
      r.return_travel_min = Math.round(legs[legs.length - 1].duration / 60);

      if (r.lunch_after_stop !== null && r.lunch_after_stop === r.stops.length) {
        const h = Math.floor(t / 60) % 24;
        const m = Math.round(t % 60);
        r.lunch_eta = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }

      const totalUnload = r.stops.reduce((sum, s) => sum + parseFloat(s.unload_min || 0), 0);
      const lunchH = r.lunch_after_stop !== null ? LUNCH_DURATION / 60 : 0;
      r.total_time_h = (route.duration / 3600) + (totalUnload / 60) + lunchH;
    } catch (e) {
      console.warn('OSRM recalc fallo', e);
    }
  }

  // Actualizar totales
  let totalDist = 0, totalTime = 0;
  fleetRoutes.routes.forEach(r => {
    totalDist += parseFloat(r.total_distance_km);
    totalTime += parseFloat(r.total_time_h);
  });
  document.getElementById('rDist').textContent = totalDist.toFixed(1) + ' km';
  document.getElementById('rTime').textContent = totalTime.toFixed(1) + ' h';
  document.getElementById('sDist').textContent = totalDist.toFixed(1);
  document.getElementById('sTime').textContent = totalTime.toFixed(1) + 'h';

  renderRoutePanel(fleetRoutes);
  initSortables();
  refreshAll();
}

/** Encuentra la posicion optima para almuerzo en el frontend */
function findBestLunchPositionJS(stops, legs, startMin) {
  if (stops.length < 2) return { pos: null, eta: null };

  // Calcular tiempos sin almuerzo
  const departures = [];
  let t = startMin;
  for (let i = 0; i < stops.length; i++) {
    t += legs[i].duration / 60;
    t += parseFloat(stops[i].unload_min || 0);
    departures.push(t);
  }

  // Si la ruta acaba antes de las 12:00, no hace falta almuerzo
  if (departures[departures.length - 1] < LUNCH_EARLIEST) return { pos: null, eta: null };

  let bestPos = null;
  let bestCost = Infinity;
  let bestEta = null;

  for (let pos = 0; pos <= stops.length; pos++) {
    const lunchTime = pos === 0 ? startMin : departures[pos - 1];
    if (lunchTime < LUNCH_EARLIEST - 30 || lunchTime > LUNCH_LATEST) continue;

    // Simular con almuerzo en esta posicion
    let tSim = startMin;
    let tNoLunch = startMin;
    let valid = true;

    for (let i = 0; i < stops.length; i++) {
      if (i === pos) tSim += LUNCH_DURATION;
      tSim += legs[i].duration / 60;
      tNoLunch += legs[i].duration / 60;
      tSim += parseFloat(stops[i].unload_min || 0);
      tNoLunch += parseFloat(stops[i].unload_min || 0);
    }
    if (pos === stops.length) tSim += LUNCH_DURATION;

    const cost = tSim - tNoLunch;
    if (valid && cost < bestCost) {
      bestCost = cost;
      bestPos = pos;
      const lt = pos === 0 ? startMin : departures[pos - 1];
      const h = Math.floor(lt / 60) % 24;
      const m = Math.round(lt % 60);
      bestEta = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
  }

  return { pos: bestPos, eta: bestEta };
}

// ── EXPORT ROUTES ─────────────────────────────────────────
function exportRoutesPrint() {
  if (!fleetRoutes || !fleetRoutes.routes.length) { showToast('No hay rutas para exportar'); return; }
  const date = getDate();
  const DAY_ES = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
  const d = new Date(date + 'T12:00:00');
  const dateStr = DAY_ES[d.getDay()] + ' ' + date;

  let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rutas ' + date + '</title><style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;color:#333;margin:20px}'
    + 'h1{font-size:18px;margin-bottom:4px}'
    + '.date{color:#666;font-size:13px;margin-bottom:16px}'
    + '.route{page-break-inside:avoid;margin-bottom:24px;border:1px solid #ddd;border-radius:8px;padding:12px}'
    + '.route-title{font-size:14px;font-weight:700;margin-bottom:2px}'
    + '.route-meta{color:#666;font-size:11px;margin-bottom:8px}'
    + 'table{width:100%;border-collapse:collapse;font-size:11px}'
    + 'th{text-align:left;background:#f5f5f0;padding:5px 8px;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase}'
    + 'td{padding:5px 8px;border-bottom:1px solid #eee}'
    + 'tr.lunch{background:#fdf8e8;font-style:italic;color:#a07d10}'
    + '.footer{margin-top:20px;font-size:10px;color:#999;text-align:center}'
    + '@media print{.no-print{display:none}body{margin:10px}}'
    + '</style></head><body>';

  html += '<div class="no-print" style="margin-bottom:12px"><button onclick="window.print()" style="padding:8px 16px;font-size:13px;cursor:pointer">Imprimir / Guardar PDF</button></div>';
  html += '<h1>VeraRoute - Hojas de ruta</h1><div class="date">' + dateStr + '</div>';

  fleetRoutes.routes.forEach((r, ri) => {
    const totalUnload = r.stops.reduce((s, st) => s + parseFloat(st.unload_min || 0), 0);
    html += '<div class="route">';
    html += '<div class="route-title">' + r.vehicle.name + (r.vehicle.plate ? ' (' + r.vehicle.plate + ')' : '') + '</div>';
    html += '<div class="route-meta">Delegacion: ' + r.delegation.name
      + ' | ' + parseFloat(r.total_distance_km).toFixed(1) + ' km'
      + ' | ' + parseFloat(r.total_time_h).toFixed(1) + ' h'
      + ' | ' + r.stops.length + ' paradas'
      + ' | Descarga: ' + Math.round(totalUnload) + ' min</div>';
    html += '<table><thead><tr><th>#</th><th>Cliente</th><th>Direccion</th><th>Telefono</th><th>ETA</th><th>Descarga</th><th>Firma</th></tr></thead><tbody>';

    const lunchPos = r.lunch_after_stop;
    r.stops.forEach((s, si) => {
      if (lunchPos !== null && lunchPos !== undefined && si === lunchPos) {
        const lunchEnd = r.lunch_eta ? addMinutes(r.lunch_eta, LUNCH_DURATION) : '';
        html += '<tr class="lunch"><td></td><td colspan="4">Almuerzo ' + (r.lunch_eta || '') + ' - ' + lunchEnd + '</td><td></td><td></td></tr>';
      }
      const c = clients.find(x => x.id === s.id_cliente);
      html += '<tr><td>' + (si + 1) + '</td>'
        + '<td><strong>' + s.name + '</strong></td>'
        + '<td>' + (c?.addr || '') + '</td>'
        + '<td>' + (c?.phone || '') + '</td>'
        + '<td><strong>' + (s.eta || '') + '</strong></td>'
        + '<td>' + Math.round(s.unload_min || 0) + ' min' + (s.items_count ? ' (' + s.items_count + ' uds)' : '') + '</td>'
        + '<td style="width:80px;border-bottom:1px solid #ccc"></td></tr>';
    });

    html += '</tbody></table></div>';
  });

  if (fleetRoutes.unassigned?.length) {
    html += '<div style="margin-top:12px;color:#c83c32"><strong>Sin asignar:</strong> '
      + fleetRoutes.unassigned.map(u => u.name + ' (' + u.reason + ')').join(', ') + '</div>';
  }

  html += '<div class="footer">Generado por VeraRoute el ' + new Date().toLocaleString('es-ES') + '</div>';
  html += '</body></html>';

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function exportRoutesCSV() {
  if (!fleetRoutes || !fleetRoutes.routes.length) { showToast('No hay rutas para exportar'); return; }
  const date = getDate();
  const sep = ';';
  let csv = 'Vehiculo' + sep + 'Matricula' + sep + 'Delegacion' + sep + 'Parada' + sep + 'Cliente' + sep + 'Direccion' + sep + 'Telefono' + sep + 'ETA' + sep + 'Descarga (min)' + sep + 'Items' + sep + 'Lat' + sep + 'Lng\n';

  fleetRoutes.routes.forEach(r => {
    r.stops.forEach((s, si) => {
      const c = clients.find(x => x.id === s.id_cliente);
      csv += [
        r.vehicle.name,
        r.vehicle.plate || '',
        r.delegation.name,
        si + 1,
        '"' + s.name.replace(/"/g, '""') + '"',
        '"' + (c?.addr || '').replace(/"/g, '""') + '"',
        c?.phone || '',
        s.eta || '',
        Math.round(s.unload_min || 0),
        s.items_count || 0,
        s.x,
        s.y,
      ].join(sep) + '\n';
    });
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rutas_' + date + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado: rutas_' + date + '.csv');
}

// ── MULTI-VEHICLE ROUTE OPTIMIZATION ──────────────────────
async function optimizeFleetRoutes() {
  const date = getDate();
  const av = vehicles.filter(v => parseInt(v.active)).length;
  const ad = delegations.filter(d => parseInt(d.active)).length;

  if (!ad) { showToast('Configura al menos una delegacion en Flota'); switchTab('f'); return; }
  if (!av) { showToast('Configura al menos un vehiculo en Flota'); switchTab('f'); return; }

  showToast('Optimizando rutas para ' + av + ' vehiculos...');

  try {
    const result = await api('routes/optimize', 'POST', { date });
    fleetRoutes = result;
    currentRoute = null;
    routeGeometry = null;

    // Aplicar settings del backend
    if (result.settings) {
      LUNCH_DURATION = result.settings.almuerzo_duracion_min || 60;
      LUNCH_EARLIEST = t2m(result.settings.almuerzo_hora_min || '12:00');
      LUNCH_LATEST = t2m(result.settings.almuerzo_hora_max || '15:30');
    }

    if (!result.routes.length) {
      showToast('Sin pedidos para optimizar en ' + date);
      return;
    }

    // Calcular totales
    let totalDist = 0, totalTime = 0;
    result.routes.forEach(r => {
      totalDist += parseFloat(r.total_distance_km);
      totalTime += parseFloat(r.total_time_h);
    });

    document.getElementById('rDist').textContent = totalDist.toFixed(1) + ' km';
    document.getElementById('rTime').textContent = totalTime.toFixed(1) + ' h';
    document.getElementById('sDist').textContent = totalDist.toFixed(1);
    document.getElementById('sTime').textContent = totalTime.toFixed(1) + 'h';

    renderRoutePanel(result);
    initSortables();

    // Obtener geometria OSRM para cada ruta
    for (let ri = 0; ri < result.routes.length; ri++) {
      const r = result.routes[ri];
      try {
        const waypoints = [
          { x: parseFloat(r.delegation.x), y: parseFloat(r.delegation.y) },
          ...r.stops.map(s => ({ x: parseFloat(s.x), y: parseFloat(s.y) })),
          { x: parseFloat(r.delegation.x), y: parseFloat(r.delegation.y) },
        ];
        const osrm = await fetchOSRMRoute(waypoints);
        r.geometry = osrm.geometry;
        r.total_distance_km = osrm.distance;
        const totalUnload = r.stops.reduce((s, st) => s + parseFloat(st.unload_min || 0), 0);
        const lunchH = (r.lunch_after_stop !== null && r.lunch_after_stop !== undefined) ? LUNCH_DURATION / 60 : 0;
        r.total_time_h = osrm.duration + (totalUnload / 60) + lunchH;
      } catch (e) {
        console.warn('OSRM fallo para vehiculo ' + r.vehicle.name, e);
      }
    }

    // Recalcular totales con OSRM
    totalDist = 0; totalTime = 0;
    result.routes.forEach(r => {
      totalDist += parseFloat(r.total_distance_km);
      totalTime += parseFloat(r.total_time_h);
    });
    document.getElementById('rDist').textContent = totalDist.toFixed(1) + ' km';
    document.getElementById('rTime').textContent = totalTime.toFixed(1) + ' h';
    document.getElementById('sDist').textContent = totalDist.toFixed(1);
    document.getElementById('sTime').textContent = totalTime.toFixed(1) + 'h';

    refreshAll();
    showToast(result.routes.length + ' rutas optimizadas - ' + totalDist.toFixed(1) + ' km total');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── TIME ───────────────────────────────────────────────────
function nowMin() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function t2m(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
// dayOfWeek: 0=Lunes...6=Domingo (nuestra convencion)
function jsToDbDay(jsDay) { return jsDay === 0 ? 6 : jsDay - 1; } // JS: 0=Dom -> DB: 6=Dom

function clientOpenAt(c, nowM, dbDay) {
  // Si tiene horarios semanales, usar los del dia concreto
  const dayWindows = c.schedules?.[dbDay];
  if (dayWindows && dayWindows.length) {
    return dayWindows.some(w => t2m(w.open_time) <= nowM && nowM <= t2m(w.close_time));
  }
  // Fallback a open/close simples
  if (t2m(c.open) <= nowM && nowM <= t2m(c.close)) return true;
  if (c.open2 && c.close2 && t2m(c.open2) <= nowM && nowM <= t2m(c.close2)) return true;
  return false;
}

function clientOpen(c, nowM) {
  return clientOpenAt(c, nowM, jsToDbDay(new Date().getDay()));
}

// Texto resumen del horario del dia para pills
function clientHoursText(c, dbDay) {
  const dayWindows = c.schedules?.[dbDay];
  if (dayWindows && dayWindows.length) {
    return dayWindows.map(w => w.open_time + '-' + w.close_time).join(' / ');
  }
  return c.open + '-' + c.close + (c.open2 ? ' / ' + c.open2 + '-' + c.close2 : '');
}

// ── OPTIMIZE ───────────────────────────────────────────────
// Distancia haversine en km
function dist(a, b) {
  const R = 6371;
  const dLat = (b.x - a.x) * Math.PI / 180;
  const dLon = (b.y - a.y) * Math.PI / 180;
  const la = a.x * Math.PI / 180;
  const lb = b.x * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function gp(id) { return id === 0 ? delegation : clients.find(c => c.id === id); }

async function optimizeRoute() {
  const date = getDate(); const day = orders[date] || {};
  const eligible = Object.keys(day).map(Number).map(id => clients.find(c => c.id === id)).filter(c => c && c.active);
  if (!eligible.length) { showToast('Sin pedidos para esta fecha'); switchTab('p'); return; }

  let unv = [...eligible], route = [], cur = delegation, t = 8 * 60;
  while (unv.length) {
    let best = null, bd = Infinity, bi = -1;
    unv.forEach((c, i) => { const d = dist(cur, c); const arr = t + (d / 50) * 60; if (arr <= t2m(c.close) && d < bd) { bd = d; best = c; bi = i; } });
    if (!best) break;
    t += (bd / 50) * 60; if (t < t2m(best.open)) t = t2m(best.open); t += 15;
    route.push(best.id); unv.splice(bi, 1); cur = best;
  }
  route = twoOpt(route);
  currentRoute = route;
  routeGeometry = null;

  // Calcular distancia/tiempo estimados (linea recta) como fallback
  let td = 0, prev = delegation;
  route.forEach(id => { const c = gp(id); td += dist(prev, c); prev = c; }); td += dist(prev, delegation);
  let th = (td / 50) + (route.length * 15 / 60);

  const skipped = eligible.filter(c => !route.includes(c.id));
  let html = '<div class="rstop"><span class="slabel delegation">Base</span></div>';
  route.forEach((id, i) => { const c = gp(id); html += '<span class="sarrow">-></span><div class="rstop"><span class="slabel visit">' + (i + 1) + '. ' + c.name + '</span></div>'; });
  html += '<span class="sarrow">-></span><div class="rstop"><span class="slabel delegation">Base</span></div>';
  if (skipped.length) html += '<div style="margin-top:6px;font-size:10px;color:var(--danger)">Fuera de horario: ' + skipped.map(c => c.name).join(', ') + '</div>';

  document.getElementById('rStops').innerHTML = html;
  document.getElementById('routePanel').classList.add('visible');

  // Mostrar valores estimados mientras carga OSRM
  document.getElementById('rDist').textContent = td.toFixed(1) + ' km';
  document.getElementById('rTime').textContent = th.toFixed(1) + ' h';
  document.getElementById('sDist').textContent = td.toFixed(1);
  document.getElementById('sTime').textContent = th.toFixed(1) + 'h';
  refreshAll();
  showToast('Calculando ruta por carretera...');

  // Obtener ruta real por carretera via OSRM
  try {
    const waypoints = [delegation, ...route.map(gp), delegation];
    const osrm = await fetchOSRMRoute(waypoints);
    routeGeometry = osrm.geometry;
    td = osrm.distance;
    th = osrm.duration + (route.length * 15 / 60); // tiempo conduccion + 15 min por parada
    document.getElementById('rDist').textContent = td.toFixed(1) + ' km';
    document.getElementById('rTime').textContent = th.toFixed(1) + ' h';
    document.getElementById('sDist').textContent = td.toFixed(1);
    document.getElementById('sTime').textContent = th.toFixed(1) + 'h';
    refreshAll();
    showToast('Ruta: ' + route.length + ' paradas - ' + td.toFixed(1) + ' km por carretera');
  } catch (e) {
    console.warn('OSRM no disponible, usando linea recta:', e);
    showToast('Ruta: ' + route.length + ' paradas (sin datos de carretera)');
  }
}

function twoOpt(r) {
  if (r.length < 4) return r;
  let imp = true;
  while (imp) {
    imp = false;
    for (let i = 0; i < r.length - 1; i++) for (let j = i + 2; j < r.length; j++) {
      const a = i === 0 ? delegation : gp(r[i - 1]), b = gp(r[i]), c = gp(r[j]), d = j + 1 < r.length ? gp(r[j + 1]) : delegation;
      if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 0.001) { r = [...r.slice(0, i), ...r.slice(i, j + 1).reverse(), ...r.slice(j + 1)]; imp = true; }
    }
  }
  return r;
}

function clearRoute() {
  currentRoute = null; routeGeometry = null; fleetRoutes = null;
  routeLines.forEach(l => map.removeLayer(l)); routeLines = [];
  document.getElementById('routePanel').classList.remove('visible');
  document.getElementById('sDist').textContent = '—'; document.getElementById('sTime').textContent = '—'; refreshAll();
}

// ── SETTINGS MODAL ────────────────────────────────────────
// (openSettingsModal definida mas abajo en la seccion de catalogo de paqueteria)
function closeSettingsModal() { closeModal('settingsModal'); }

async function saveSettings() {
  try {
    await api('settings', 'PUT', {
      almuerzo_duracion_min: document.getElementById('sLunchDur').value,
      almuerzo_hora_min: document.getElementById('sLunchEarly').value,
      almuerzo_hora_max: document.getElementById('sLunchLate').value,
      descarga_min_base: document.getElementById('sBaseUnload').value,
      velocidad_defecto_kmh: document.getElementById('sSpeed').value,
    });

    if (typeof APP_USER !== 'undefined' && APP_USER.role === 'admin') {
      await api('shipping-config', 'PUT', {
        cp_origen: document.getElementById('shipOriginPostcode').value.trim(),
        pais_origen: document.getElementById('shipOriginCountry').value.trim().toUpperCase(),
        price_multiplier: document.getElementById('shipPriceMultiplier').value || '1.0000',
        gls_fuel_pct_current: document.getElementById('shipFuelPct').value || '0.00',
        prefijos_cp_remotos: document.getElementById('shipRemotePrefixes').value || '',
        default_weight_per_carro_kg: document.getElementById('shipWeightPerCarro').value,
        default_weight_per_caja_kg: document.getElementById('shipWeightPerCaja').value,
        default_parcels_per_carro: document.getElementById('shipParcelsPerCarro').value,
        default_parcels_per_caja: document.getElementById('shipParcelsPerCaja').value,
        default_volume_per_carro_cm3: document.getElementById('shipVolumePerCarro').value,
        default_volume_per_caja_cm3: document.getElementById('shipVolumePerCaja').value,
        usar_peso_volumetrico: document.getElementById('shipUseVolumetric').checked ? 1 : 0,
      });
    }

    closeSettingsModal();
    showToast('Configuracion guardada');
  } catch (e) { showToast('Error: ' + e.message); }
}

function applyShippingConfigToForm(gls) {
  const isAdmin = typeof APP_USER !== 'undefined' && APP_USER.role === 'admin';
  const defaults = gls || {
    cp_origen: '',
    pais_origen: 'ES',
    price_multiplier: '1.0000',
    gls_fuel_pct_current: '0.00',
    prefijos_cp_remotos: '',
    default_weight_per_carro_kg: '5.00',
    default_weight_per_caja_kg: '2.50',
    default_parcels_per_carro: '1.00',
    default_parcels_per_caja: '1.00',
    default_volume_per_carro_cm3: '0.00',
    default_volume_per_caja_cm3: '0.00',
    usar_peso_volumetrico: 0,
  };

  document.getElementById('shipOriginPostcode').value = defaults.cp_origen || '';
  document.getElementById('shipOriginCountry').value = defaults.pais_origen || 'ES';
  document.getElementById('shipPriceMultiplier').value = defaults.price_multiplier || '1.0000';
  document.getElementById('shipFuelPct').value = defaults.gls_fuel_pct_current || '0.00';
  document.getElementById('shipRemotePrefixes').value = defaults.prefijos_cp_remotos || '';
  document.getElementById('shipWeightPerCarro').value = defaults.default_weight_per_carro_kg || '5.00';
  document.getElementById('shipWeightPerCaja').value = defaults.default_weight_per_caja_kg || '2.50';
  document.getElementById('shipParcelsPerCarro').value = defaults.default_parcels_per_carro || '1.00';
  document.getElementById('shipParcelsPerCaja').value = defaults.default_parcels_per_caja || '1.00';
  document.getElementById('shipVolumePerCarro').value = defaults.default_volume_per_carro_cm3 || '0.00';
  document.getElementById('shipVolumePerCaja').value = defaults.default_volume_per_caja_cm3 || '0.00';
  document.getElementById('shipUseVolumetric').checked = !!parseInt(defaults.usar_peso_volumetrico || 0, 10);

  const settingsSection = document.getElementById('shippingSettingsSection');
  if (settingsSection) settingsSection.style.display = isAdmin ? '' : 'none';
  const ratesSection = document.getElementById('shippingRatesSection');
  if (ratesSection) ratesSection.style.display = isAdmin ? '' : 'none';
  const alertsSection = document.getElementById('shippingAlertsSection');
  if (alertsSection) alertsSection.style.display = isAdmin ? '' : 'none';

  ['shipOriginPostcode', 'shipOriginCountry', 'shipPriceMultiplier', 'shipFuelPct', 'shipRemotePrefixes', 'shipWeightPerCarro', 'shipWeightPerCaja', 'shipParcelsPerCarro', 'shipParcelsPerCaja', 'shipVolumePerCarro', 'shipVolumePerCaja', 'shipUseVolumetric']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isAdmin;
    });

  if (isAdmin) loadShippingAlerts();
}

async function updateFuelPctOnly() {
  const val = parseFloat(document.getElementById('shipFuelPct').value || 0);
  if (isNaN(val) || val < 0 || val > 100) return showToast('Combustible debe estar entre 0 y 100');

  if (!await appConfirm(`Aplicar nuevo recargo de combustible: <b>${val.toFixed(2)}%</b>?<br><span style="font-size:11px;color:var(--text-dim)">Las hojas calculadas hasta ahora mantendran sus costes; las nuevas usaran el nuevo %.</span>`, { title: 'Actualizar combustible GLS', okText: 'Aplicar', danger: false })) return;

  try {
    await api('shipping-config/fuel', 'PUT', { fuel_pct: val });
    showToast('Combustible actualizado: ' + val.toFixed(2) + '%');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── MODAL VARIABLES DE CALCULO (admin) ──
let varsVehiclesData = [];
let varsVehiclesEdited = {};
let varsRoutesData = [];

async function openVarsModal() {
  if (typeof APP_USER === 'undefined' || APP_USER.role !== 'admin') {
    return showToast('Solo admin');
  }

  try {
    const [appSettings, glsConfig, vehiclesList] = await Promise.all([
      api('settings'),
      api('shipping-config'),
      api('vehicles'),
    ]);
    await loadRutas();

    // App
    document.getElementById('vSpeed').value = appSettings.velocidad_defecto_kmh || 50;
    document.getElementById('vBaseUnload').value = appSettings.descarga_min_base || 5;
    document.getElementById('vLunchDur').value = appSettings.almuerzo_duracion_min || 60;
    document.getElementById('vLunchEarly').value = appSettings.almuerzo_hora_min || '12:00';
    document.getElementById('vLunchLate').value = appSettings.almuerzo_hora_max || '15:30';

    // GLS
    document.getElementById('vGlsOriginCp').value = glsConfig.cp_origen || '';
    document.getElementById('vGlsOriginCountry').value = glsConfig.pais_origen || 'ES';
    document.getElementById('vGlsMultiplier').value = glsConfig.price_multiplier || '1.0000';
    document.getElementById('vGlsFuelPct').value = glsConfig.gls_fuel_pct_current || '0.00';
    document.getElementById('vGlsRemotePrefixes').value = glsConfig.prefijos_cp_remotos || '';
    document.getElementById('vGlsKgCarro').value = glsConfig.default_weight_per_carro_kg || '5.00';
    document.getElementById('vGlsKgCaja').value = glsConfig.default_weight_per_caja_kg || '2.50';
    document.getElementById('vGlsParcCarro').value = glsConfig.default_parcels_per_carro || '1.00';
    document.getElementById('vGlsParcCaja').value = glsConfig.default_parcels_per_caja || '1.00';
    document.getElementById('vGlsVolCarro').value = glsConfig.default_volume_per_carro_cm3 || '0';
    document.getElementById('vGlsVolCaja').value = glsConfig.default_volume_per_caja_cm3 || '0';
    document.getElementById('vGlsUseVol').value = parseInt(glsConfig.usar_peso_volumetrico || 0, 10) ? '1' : '0';

    // Tiempos de parada
    document.getElementById('vStopRural').value = appSettings.parada_min_rural || 8;
    document.getElementById('vStopVilla').value = appSettings.parada_min_villa || 12;
    document.getElementById('vStopCiudad').value = appSettings.parada_min_ciudad || 18;
    document.getElementById('vStopPoligono').value = appSettings.parada_min_poligono || 6;
    document.getElementById('vStopExtra23').value = appSettings.parada_extra_2_3_cajas || 2;
    document.getElementById('vStopExtraCarros').value = appSettings.parada_extra_carros || 5;
    document.getElementById('vWaitAlmacen').value = appSettings.espera_min_almacen || 0;
    document.getElementById('vWaitTiendaEsp').value = appSettings.espera_min_tienda_especializada || 5;
    document.getElementById('vWaitTiendaCentro').value = appSettings.espera_min_tienda_centro || 8;
    document.getElementById('vWaitCoop').value = appSettings.espera_min_cooperativa || 3;
    document.getElementById('vMultApertura').value = appSettings.espera_mult_apertura || 0.5;
    document.getElementById('vMultNormal').value = appSettings.espera_mult_normal || 1.0;
    document.getElementById('vMultPunta').value = appSettings.espera_mult_punta || 1.5;
    document.getElementById('vFranjaAperturaInicio').value = appSettings.franja_apertura_inicio || '09:00';
    document.getElementById('vFranjaAperturaFin').value = appSettings.franja_apertura_fin || '10:00';
    document.getElementById('vFranjaNormalInicio').value = appSettings.franja_normal_inicio || '10:00';
    document.getElementById('vFranjaNormalFin').value = appSettings.franja_normal_fin || '12:00';
    document.getElementById('vFranjaPuntaInicio').value = appSettings.franja_punta_inicio || '12:00';
    document.getElementById('vFranjaPuntaFin').value = appSettings.franja_punta_fin || '13:30';
    document.getElementById('vStopExtraPuntaCiudad').value = appSettings.parada_extra_hora_punta_ciudad || 5;
    // Actualizar descripciones de franjas
    const fai = appSettings.franja_apertura_inicio || '09:00', faf = appSettings.franja_apertura_fin || '10:00';
    const fni = appSettings.franja_normal_inicio || '10:00', fnf = appSettings.franja_normal_fin || '12:00';
    const fpi = appSettings.franja_punta_inicio || '12:00', fpf = appSettings.franja_punta_fin || '13:30';
    document.getElementById('vFranjaAperturaDesc').textContent = fai + ' - ' + faf;
    document.getElementById('vFranjaNormalDesc').textContent = fni + ' - ' + fnf;
    document.getElementById('vFranjaPuntaDesc').textContent = fpi + ' - ' + fpf;

    // Vehiculos
    varsVehiclesData = Array.isArray(vehiclesList) ? vehiclesList : [];
    varsVehiclesEdited = {};
    renderVarsVehicles();
    varsRoutesData = Array.isArray(rutas) ? rutas.map(r => ({
      ...r,
      color: normalizeHexColor(r.color) || getRutaColor(r.id),
    })) : [];
    renderVarsRoutes();

    switchVarsTab('app');
    document.getElementById('varsModal').classList.add('open');
  } catch (e) {
    showToast('Error cargando variables: ' + e.message);
  }
}

function closeVarsModal() { closeModal('varsModal'); }

function switchVarsTab(tab) {
  document.querySelectorAll('.vars-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.varsTab === tab);
  });
  document.querySelectorAll('.vars-section').forEach(s => {
    s.classList.toggle('active', s.dataset.varsSection === tab);
  });
}

function renderVarsVehicles() {
  const el = document.getElementById('varsVehiclesList');
  if (!el) return;
  if (!varsVehiclesData.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">No hay vehiculos cargados.</div>';
    return;
  }
  let html = '';
  varsVehiclesData.forEach(v => {
    const cost = v.cost_per_km !== null && v.cost_per_km !== undefined ? v.cost_per_km : '0.00';
    const inactive = !parseInt(v.active) ? ' style="opacity:0.5"' : '';
    html += `<div class="vars-row"${inactive}>
      <div>
        <label><b>${esc(v.name)}</b>${v.plate ? ' · ' + esc(v.plate) : ''}${!parseInt(v.active) ? ' [INACTIVO]' : ''}</label>
        <div class="help">€/km recorrido</div>
      </div>
      <input type="number" min="0" step="0.01" value="${cost}" data-vehicle-id="${v.id}" oninput="onVehicleCostChange(${v.id}, this.value)">
    </div>`;
  });
  el.innerHTML = html;
}

function onVehicleCostChange(vehicleId, value) {
  varsVehiclesEdited[vehicleId] = parseFloat(value || 0);
}

function renderVarsRoutes() {
  const el = document.getElementById('varsRoutesList');
  if (!el) return;
  if (!varsRoutesData.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">No hay rutas cargadas.</div>';
    return;
  }

  el.innerHTML = varsRoutesData.map((route, index) => {
    const color = normalizeHexColor(route.color) || getRutaColor(route.id) || RUTA_COLORS[index % RUTA_COLORS.length];
    const count = parseInt(route.client_count, 10);
    return `<div class="vars-route-row" data-route-row="${route.id}">
      <div class="vars-route-main">
        <span class="vars-route-swatch" style="background:${color}"></span>
        <div class="vars-route-text">
          <div class="vars-route-name">${esc(route.name)}</div>
          <div class="vars-route-meta">${Number.isFinite(count) ? count : 0} clientes</div>
        </div>
      </div>
      <div class="vars-route-edit">
        <input type="color" class="vars-route-color" value="${color}" aria-label="Color de ${esc(route.name)}" oninput="onRouteColorChange(${route.id}, this.value)">
        <span class="vars-route-hex">${esc(color)}</span>
      </div>
    </div>`;
  }).join('');
}

function onRouteColorChange(routeId, value) {
  const color = normalizeHexColor(value);
  if (!color) return;

  const route = varsRoutesData.find(r => parseInt(r.id, 10) === parseInt(routeId, 10));
  if (route) route.color = color;

  const row = document.querySelector(`[data-route-row="${routeId}"]`);
  if (row) {
    const swatch = row.querySelector('.vars-route-swatch');
    const hex = row.querySelector('.vars-route-hex');
    if (swatch) swatch.style.background = color;
    if (hex) hex.textContent = color;
  }
}

async function saveVars() {
  try {
    // 1. App settings + tiempos de parada
    await api('settings', 'PUT', {
      velocidad_defecto_kmh: document.getElementById('vSpeed').value,
      descarga_min_base: document.getElementById('vBaseUnload').value,
      almuerzo_duracion_min: document.getElementById('vLunchDur').value,
      almuerzo_hora_min: document.getElementById('vLunchEarly').value,
      almuerzo_hora_max: document.getElementById('vLunchLate').value,
      parada_min_rural: document.getElementById('vStopRural').value,
      parada_min_villa: document.getElementById('vStopVilla').value,
      parada_min_ciudad: document.getElementById('vStopCiudad').value,
      parada_min_poligono: document.getElementById('vStopPoligono').value,
      parada_extra_2_3_cajas: document.getElementById('vStopExtra23').value,
      parada_extra_carros: document.getElementById('vStopExtraCarros').value,
      espera_min_almacen: document.getElementById('vWaitAlmacen').value,
      espera_min_tienda_especializada: document.getElementById('vWaitTiendaEsp').value,
      espera_min_tienda_centro: document.getElementById('vWaitTiendaCentro').value,
      espera_min_cooperativa: document.getElementById('vWaitCoop').value,
      espera_mult_apertura: document.getElementById('vMultApertura').value,
      espera_mult_normal: document.getElementById('vMultNormal').value,
      espera_mult_punta: document.getElementById('vMultPunta').value,
      franja_apertura_inicio: document.getElementById('vFranjaAperturaInicio').value,
      franja_apertura_fin: document.getElementById('vFranjaAperturaFin').value,
      franja_normal_inicio: document.getElementById('vFranjaNormalInicio').value,
      franja_normal_fin: document.getElementById('vFranjaNormalFin').value,
      franja_punta_inicio: document.getElementById('vFranjaPuntaInicio').value,
      franja_punta_fin: document.getElementById('vFranjaPuntaFin').value,
      parada_extra_hora_punta_ciudad: document.getElementById('vStopExtraPuntaCiudad').value,
    });

    // 2. GLS config
    await api('shipping-config', 'PUT', {
      cp_origen: document.getElementById('vGlsOriginCp').value.trim(),
      pais_origen: document.getElementById('vGlsOriginCountry').value.trim().toUpperCase(),
      price_multiplier: document.getElementById('vGlsMultiplier').value || '1.0000',
      gls_fuel_pct_current: document.getElementById('vGlsFuelPct').value || '0.00',
      prefijos_cp_remotos: document.getElementById('vGlsRemotePrefixes').value || '',
      default_weight_per_carro_kg: document.getElementById('vGlsKgCarro').value,
      default_weight_per_caja_kg: document.getElementById('vGlsKgCaja').value,
      default_parcels_per_carro: document.getElementById('vGlsParcCarro').value,
      default_parcels_per_caja: document.getElementById('vGlsParcCaja').value,
      default_volume_per_carro_cm3: document.getElementById('vGlsVolCarro').value,
      default_volume_per_caja_cm3: document.getElementById('vGlsVolCaja').value,
      usar_peso_volumetrico: document.getElementById('vGlsUseVol').value === '1' ? 1 : 0,
    });

    // 3. Vehiculos editados (solo los que cambiaron)
    const vehicleIds = Object.keys(varsVehiclesEdited);
    if (vehicleIds.length) {
      await Promise.all(vehicleIds.map(async (id) => {
        const veh = varsVehiclesData.find(v => parseInt(v.id) === parseInt(id));
        if (!veh) return;
        await api('vehicles/' + id, 'PUT', {
          name: veh.name,
          plate: veh.plate || '',
          id_delegacion: veh.id_delegacion || null,
          max_weight_kg: veh.max_weight_kg,
          max_volume_m3: veh.max_volume_m3,
          max_items: veh.max_items,
          cost_per_km: varsVehiclesEdited[id],
        });
      }));
    }

    // 4. Colores de rutas
    if (varsRoutesData.length) {
      await Promise.all(varsRoutesData.map(route => api('rutas/' + route.id, 'PUT', {
        name: route.name,
        color: normalizeHexColor(route.color) || getRutaColor(route.id),
      })));
    }

    showToast('Variables guardadas');
    closeVarsModal();
    // Recargar caches para que los colores y datos queden sincronizados
    await Promise.all([
      typeof loadVehicles === 'function' ? loadVehicles() : Promise.resolve(),
      typeof loadRutas === 'function' ? loadRutas() : Promise.resolve(),
      typeof loadClients === 'function' ? loadClients() : Promise.resolve(),
    ]);
    refreshAll();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}


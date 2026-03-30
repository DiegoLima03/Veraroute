// ── API HELPER ────────────────────────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('api/' + endpoint, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error ' + res.status);
  }
  return res.json();
}

// ── OSRM ROAD ROUTING ─────────────────────────────────────
async function fetchOSRMRoute(waypoints) {
  // waypoints = [{x: lat, y: lng}, ...] — OSRM needs lng,lat
  const coords = waypoints.map(p => p.y + ',' + p.x).join(';');
  const url = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson';
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM error ' + res.status);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('OSRM: ' + data.code);
  const route = data.routes[0];
  return {
    distance: route.distance / 1000,  // metros -> km
    duration: route.duration / 3600,   // segundos -> horas
    geometry: route.geometry.coordinates.map(c => [c[1], c[0]])  // [lng,lat] -> [lat,lng] para Leaflet
  };
}

// ── STATE ──────────────────────────────────────────────────
let clients = [];
let orders = {};
let delegations = [];
let vehicles = [];
let fleetRoutes = null; // { routes: [...], unassigned: [...] }
let currentRoute = null;
let routeGeometry = null;
let routeLines = []; // polylines por vehiculo en el mapa
let itemCnt = 0;
let searchQuery = '';
let filterMode = 'active';
// Colores para rutas de cada vehiculo
const ROUTE_COLORS = ['#d4a830', '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#0984e3', '#6c5ce7'];
const RUTA_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#0984e3', '#6c5ce7', '#d4a830'];
let rutas = [];

// Delegacion principal — retrocompatibilidad
let delegation = { name: 'Delegacion', x: 41.994524, y: -8.739887, address: '' };

async function loadDelegation() {
  try {
    const d = await api('delegation');
    delegation = { id: d.id, name: d.name || 'Delegacion', x: parseFloat(d.x), y: parseFloat(d.y), address: d.address || '' };
  } catch (e) { /* usa valores por defecto */ }
}

async function loadDelegations() {
  try { delegations = await api('delegations'); } catch (e) { delegations = []; }
}

function getRutaColor(rutaId) {
  const rIdx = rutas.findIndex(r => r.id == rutaId);
  return rIdx >= 0 ? RUTA_COLORS[rIdx % RUTA_COLORS.length] : '#85725e';
}

async function loadRutas() {
  try { rutas = await api('rutas'); } catch (e) { rutas = []; }
}

async function loadVehicles() {
  try { vehicles = await api('vehicles'); } catch (e) { vehicles = []; }
}

// ── LEAFLET MAP ───────────────────────────────────────────
const map = L.map('map').setView([40.0, -3.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap',
  maxZoom: 19,
}).addTo(map);

let mapMarkers = [];
let clientMarkerMap = {};
let mapRouteLine = null;
let mapPreviewMarker = null;

function delegationIcon(label) {
  return L.divIcon({ className: 'map-icon delegation-icon', html: '<div>' + label + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
}

function clientIcon(color, label) {
  return L.divIcon({
    className: 'map-icon',
    html: '<div style="background:' + color + ';color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">' + label + '</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Click en mapa para colocar ubicaciones
map.on('click', function (e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  const modalOpen = document.getElementById('cModal').classList.contains('open');
  if (modalOpen) {
    document.getElementById('cX').value = lat.toFixed(6);
    document.getElementById('cY').value = lng.toFixed(6);
    if (mapPreviewMarker) map.removeLayer(mapPreviewMarker);
    mapPreviewMarker = L.circleMarker([lat, lng], { radius: 8, color: '#8e8b30', fillColor: '#8e8b30', fillOpacity: 0.5 })
      .bindTooltip('Nueva ubicacion', { permanent: true, direction: 'top', offset: [0, -10] })
      .addTo(map);
    showToast('Lat: ' + lat.toFixed(6) + '  Lng: ' + lng.toFixed(6));
  } else {
    openClientModal();
    document.getElementById('cX').value = lat.toFixed(6);
    document.getElementById('cY').value = lng.toFixed(6);
  }
});

// Clientes filtrados por modo y busqueda
function filteredClients() {
  return clients.filter(c => {
    if (filterMode === 'active' && !c.active) return false;
    if (filterMode === 'inactive' && c.active) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.addr.toLowerCase().includes(q);
    }
    return true;
  });
}

// Clientes activos (para mapa y rutas)
function activeClients() {
  return clients.filter(c => c.active);
}

function focusClientOnMap(id) {
  const marker = clientMarkerMap[id];
  if (marker) {
    map.setView(marker.getLatLng(), 15, { animate: true });
    marker.openTooltip();
  }
}

function drawMap() {
  // Limpiar marcadores anteriores
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
  clientMarkerMap = {};
  routeLines.forEach(l => map.removeLayer(l));
  routeLines = [];
  if (mapRouteLine) { map.removeLayer(mapRouteLine); mapRouteLine = null; }
  if (mapPreviewMarker) { map.removeLayer(mapPreviewMarker); mapPreviewMarker = null; }

  const date = getDate();
  const day = orders[date] || {};
  const now = nowMin();
  const visibleClients = activeClients();

  // Marcadores de todas las delegaciones
  if (delegations.length) {
    delegations.forEach((d, i) => {
      if (!parseInt(d.active)) return;
      const marker = L.marker([parseFloat(d.x), parseFloat(d.y)], { icon: delegationIcon('D' + (i + 1)), zIndexOffset: 1000 })
        .bindTooltip(d.name, { permanent: true, direction: 'bottom', offset: [0, 10], className: 'delegation-tooltip' })
        .addTo(map);
      mapMarkers.push(marker);
    });
  } else {
    const marker = L.marker([delegation.x, delegation.y], { icon: delegationIcon('D'), zIndexOffset: 1000 })
      .bindTooltip('DELEGACION', { permanent: true, direction: 'bottom', offset: [0, 10], className: 'delegation-tooltip' })
      .addTo(map);
    mapMarkers.push(marker);
  }

  // Construir mapa de cliente->vehiculo para colores de ruta
  const clientVehicle = {};
  if (fleetRoutes?.routes) {
    fleetRoutes.routes.forEach((r, ri) => {
      r.stops.forEach(s => { clientVehicle[parseInt(s.client_id)] = ri; });
    });
  }

  // Marcadores clientes activos
  visibleClients.forEach((c, i) => {
    const isOpen = clientOpen(c, now);
    const hasOrd = !!day[c.id];
    const inRoute = clientVehicle[c.id] !== undefined || currentRoute?.includes(c.id);
    const vIdx = clientVehicle[c.id];

    let color = '#85725e';
    if (c.ruta_id) {
      const rIdx = rutas.findIndex(r => r.id == c.ruta_id);
      color = rIdx >= 0 ? RUTA_COLORS[rIdx % RUTA_COLORS.length] : '#85725e';
    }
    if (hasOrd) color = isOpen ? '#8e8b30' : '#c83c32';
    if (inRoute) color = vIdx !== undefined ? ROUTE_COLORS[vIdx % ROUTE_COLORS.length] : '#d4a830';

    let label = i + 1;
    if (vIdx !== undefined) {
      const route = fleetRoutes.routes[vIdx];
      const stopIdx = route.stops.findIndex(s => parseInt(s.client_id) === c.id);
      label = stopIdx >= 0 ? stopIdx + 1 : label;
    } else if (currentRoute?.includes(c.id)) {
      label = currentRoute.indexOf(c.id) + 1;
    }

    const marker = L.marker([c.x, c.y], { icon: clientIcon(color, label), zIndexOffset: inRoute ? 500 : 100 })
      .bindTooltip(c.name, { direction: 'top', offset: [0, -10] })
      .addTo(map);
    marker.on('click', () => openClientModal(c.id));
    mapMarkers.push(marker);
    clientMarkerMap[c.id] = marker;
  });

  // Lineas de ruta multi-vehiculo
  if (fleetRoutes?.routes) {
    fleetRoutes.routes.forEach((r, ri) => {
      const color = ROUTE_COLORS[ri % ROUTE_COLORS.length];
      const pts = [[parseFloat(r.delegation.x), parseFloat(r.delegation.y)]];
      r.stops.forEach(s => pts.push([parseFloat(s.x), parseFloat(s.y)]));
      pts.push([parseFloat(r.delegation.x), parseFloat(r.delegation.y)]);

      // Si tenemos geometria OSRM para esta ruta, usarla
      if (r.geometry) {
        routeLines.push(L.polyline(r.geometry, { color, weight: 4, opacity: 0.85 }).addTo(map));
      } else {
        routeLines.push(L.polyline(pts, { color, weight: 3, opacity: 0.7, dashArray: '8, 5' }).addTo(map));
      }
    });
  } else if (currentRoute?.length) {
    if (routeGeometry) {
      mapRouteLine = L.polyline(routeGeometry, { color: '#d4a830', weight: 4, opacity: 0.85 }).addTo(map);
    } else {
      const pts = [delegation, ...currentRoute.map(gp), delegation];
      const latlngs = pts.map(p => [p.x, p.y]);
      mapRouteLine = L.polyline(latlngs, { color: '#8e8b30', weight: 3, opacity: 0.7, dashArray: '8, 5' }).addTo(map);
    }
  }
}

function fitMapToMarkers() {
  const ac = activeClients();
  if (!ac.length) {
    map.setView([delegation.x, delegation.y], 12);
    return;
  }
  const points = ac.map(c => [c.x, c.y]);
  points.push([delegation.x, delegation.y]);
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, { padding: [40, 40] });
}

// ── DATA LOADING ──────────────────────────────────────────
async function loadClients() {
  try {
    const data = await api('clients');
    clients = data.map(c => ({
      id: c.id,
      name: c.name,
      addr: c.address || '',
      phone: c.phone || '',
      notes: c.notes || '',
      x: parseFloat(c.x),
      y: parseFloat(c.y),
      open: (c.open_time || '09:00').substring(0, 5),
      close: (c.close_time || '18:00').substring(0, 5),
      open2: c.open_time_2 ? c.open_time_2.substring(0, 5) : '',
      close2: c.close_time_2 ? c.close_time_2.substring(0, 5) : '',
      schedules: c.schedules || {},
      active: c.active !== undefined ? !!parseInt(c.active) : true,
      ruta_id: c.ruta_id ? parseInt(c.ruta_id) : null,
      ruta_name: c.ruta_name || '',
      delegation_id: c.delegation_id ? parseInt(c.delegation_id) : null,
      comercial_id: c.comercial_id ? parseInt(c.comercial_id) : null,
      comercial_name: c.comercial_name || '',
      al_contado: !!parseInt(c.al_contado || 0),
    }));
  } catch (e) {
    showToast('Error cargando clientes: ' + e.message);
  }
}

async function loadOrders() {
  try {
    const date = getDate();
    const data = await api('orders?date=' + date);
    orders = {};
    orders[date] = {};
    for (const [cid, ord] of Object.entries(data)) {
      orders[date][parseInt(cid)] = ord;
    }
  } catch (e) {
    showToast('Error cargando pedidos: ' + e.message);
  }
}

// ── DEMO DATA ──────────────────────────────────────────────
async function loadDemo() {
  try {
    await api('demo', 'POST');
    setToday();
    await loadClients();
    await loadOrders();
    currentRoute = null;
    refreshAll();
    fitMapToMarkers();
    showToast('Demo: ' + clients.length + ' clientes con pedidos hoy');
  } catch (e) {
    showToast('Error cargando demo: ' + e.message);
  }
}

// ── TABS ───────────────────────────────────────────────────
function switchTab(t) {
  document.getElementById('vc').style.display = t === 'c' ? 'flex' : 'none';
  document.getElementById('vhr').style.display = t === 'hr' ? 'flex' : 'none';
  document.getElementById('vf').style.display = t === 'f' ? 'flex' : 'none';
  document.getElementById('vh').style.display = t === 'h' ? 'flex' : 'none';
  document.getElementById('tab-c').classList.toggle('active', t === 'c');
  document.getElementById('tab-hr').classList.toggle('active', t === 'hr');
  document.getElementById('tab-f').classList.toggle('active', t === 'f');
  document.getElementById('tab-h').classList.toggle('active', t === 'h');
  if (t === 'f') renderFleetLists();
  if (t === 'h') { loadHistory(); loadDashboard(); }
  if (t === 'hr') loadHojasRuta();
}

// ── DATE ───────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function getDate() { return document.getElementById('rDate').value || todayStr(); }
function setToday() { document.getElementById('rDate').value = todayStr(); }

async function onDateChange() {
  await loadOrders();
  currentRoute = null;
  refreshAll();
}

// ── SEARCH & FILTER ────────────────────────────────────────
function onSearch(val) {
  searchQuery = val;
  renderClientList();
}

function setFilterMode(mode) {
  filterMode = mode;
  document.getElementById('btnFilterActive').classList.toggle('active-filter', mode === 'active');
  document.getElementById('btnFilterInactive').classList.toggle('active-filter', mode === 'inactive');
  renderClientList();
}

async function toggleClientActive(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;

  // Si se va a activar y no tiene coordenadas, pedir que las ponga primero
  if (!c.active && (c.x == null || c.y == null)) {
    showToast('Este cliente no tiene coordenadas. Edítalo y asigna ubicación antes de activarlo.');
    openClientModal(id);
    return;
  }

  try {
    await api('clients/' + id + '/toggle', 'PUT');
    c.active = !c.active;
    refreshAll();
    showToast(c.name + (c.active ? ' activado' : ' desactivado'));
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── CLIENT MODAL ───────────────────────────────────────────
const SCHED_DAY_NAMES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

function buildScheduleGrid(client) {
  const grid = document.getElementById('cScheduleGrid');
  let html = '';
  for (let d = 0; d < 7; d++) {
    const windows = (client?.schedules?.[d]) || [];
    html += '<div class="sched-day" data-day="' + d + '">';
    html += '<div class="sched-day-name">' + SCHED_DAY_NAMES[d] + '</div>';
    html += '<div class="sched-day-windows">';
    if (windows.length) {
      windows.forEach((w, i) => {
        html += schedWindowHtml(d, w.open_time, w.close_time);
      });
    } else {
      html += '<div class="sched-closed">Cerrado</div>';
    }
    html += '<button type="button" class="sched-add-window" onclick="addSchedWindow(' + d + ')">+ turno</button>';
    html += '</div></div>';
  }
  grid.innerHTML = html;
}

function schedWindowHtml(day, open, close) {
  return '<div class="sched-window">' +
    '<input type="time" value="' + (open || '') + '" data-field="open">' +
    '<span>-</span>' +
    '<input type="time" value="' + (close || '') + '" data-field="close">' +
    '<button type="button" class="rem-btn" onclick="removeSchedWindow(this)">&times;</button>' +
    '</div>';
}

function addSchedWindow(day) {
  const dayEl = document.querySelector('.sched-day[data-day="' + day + '"] .sched-day-windows');
  // Remove "Cerrado" label if present
  const closed = dayEl.querySelector('.sched-closed');
  if (closed) closed.remove();
  // Insert before the "+ turno" button
  const btn = dayEl.querySelector('.sched-add-window');
  const tmp = document.createElement('div');
  tmp.innerHTML = schedWindowHtml(day, '', '');
  btn.before(tmp.firstElementChild);
}

function removeSchedWindow(btn) {
  const windowEl = btn.closest('.sched-window');
  const dayWindows = btn.closest('.sched-day-windows');
  windowEl.remove();
  // If no windows left, show "Cerrado"
  if (!dayWindows.querySelector('.sched-window')) {
    const addBtn = dayWindows.querySelector('.sched-add-window');
    const closed = document.createElement('div');
    closed.className = 'sched-closed';
    closed.textContent = 'Cerrado';
    addBtn.before(closed);
  }
}

function collectScheduleData() {
  const schedule = {};
  document.querySelectorAll('.sched-day').forEach(dayEl => {
    const day = parseInt(dayEl.dataset.day);
    const windows = [];
    dayEl.querySelectorAll('.sched-window').forEach(wEl => {
      const open = wEl.querySelector('[data-field="open"]').value;
      const close = wEl.querySelector('[data-field="close"]').value;
      if (open && close) windows.push({ open_time: open, close_time: close });
    });
    if (windows.length) schedule[day] = windows;
  });
  return schedule;
}

function openClientModal(id = null) {
  const c = id ? clients.find(x => x.id === id) : null;
  document.getElementById('cModalTitle').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('cId').value = id || '';
  document.getElementById('cName').value  = c?.name  || '';
  document.getElementById('cAddr').value  = c?.addr  || '';
  document.getElementById('cPhone').value = c?.phone || '';
  document.getElementById('cNotes').value = c?.notes || '';
  document.getElementById('cX').value    = c?.x ?? '';
  document.getElementById('cY').value    = c?.y ?? '';
  // Ruta select
  const rutaSel = document.getElementById('cRuta');
  if (rutaSel) {
    rutaSel.innerHTML = '<option value="">Sin ruta</option>' + rutas.map(r => '<option value="' + r.id + '"' + (c?.ruta_id == r.id ? ' selected' : '') + '>' + r.name + '</option>').join('');
  }
  // Al contado
  document.getElementById('cContado').checked = c?.al_contado || false;
  // Horario semanal editable
  buildScheduleGrid(c);

  const toggleBtn = document.getElementById('cToggleBtn');
  const deleteBtn = document.getElementById('cDeleteBtn');
  if (c) {
    toggleBtn.style.display = '';
    toggleBtn.textContent = c.active ? 'Desactivar' : 'Activar';
    toggleBtn.className = 'btn ' + (c.active ? 'btn-danger' : 'btn-success');
    deleteBtn.style.display = '';
  } else {
    toggleBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
  }

  document.getElementById('cModal').classList.add('open');
}

async function toggleFromModal() {
  const id = parseInt(document.getElementById('cId').value);
  if (!id) return;
  await toggleClientActive(id);
  const c = clients.find(x => x.id === id);
  if (c) {
    const toggleBtn = document.getElementById('cToggleBtn');
    toggleBtn.textContent = c.active ? 'Desactivar' : 'Activar';
    toggleBtn.className = 'btn ' + (c.active ? 'btn-danger' : 'btn-success');
  }
}
async function deleteFromModal() {
  const id = parseInt(document.getElementById('cId').value);
  if (!id) return;
  const c = clients.find(x => x.id === id);
  if (!confirm('¿Eliminar el cliente "' + (c?.name || id) + '"? Esta acción no se puede deshacer.')) return;
  try {
    await api('clients/' + id, 'DELETE');
    showToast('Cliente eliminado');
    closeCModal();
    currentRoute = null;
    await loadClients();
    refreshAll();
  } catch (e) {
    showToast('Error eliminando: ' + e.message);
  }
}

function closeCModal() {
  document.getElementById('cModal').classList.remove('open');
  if (mapPreviewMarker) { map.removeLayer(mapPreviewMarker); mapPreviewMarker = null; }
}

async function saveClient() {
  const name = document.getElementById('cName').value.trim();
  const x = parseFloat(document.getElementById('cX').value);
  const y = parseFloat(document.getElementById('cY').value);
  if (!name || isNaN(x) || isNaN(y)) { showToast('Nombre y coordenadas son obligatorios'); return; }

  const schedule = collectScheduleData();

  // Use Monday as fallback for open_time/close_time
  const mon = schedule[0] || [];
  const rutaVal = document.getElementById('cRuta')?.value;
  const data = {
    name,
    address: document.getElementById('cAddr').value.trim(),
    phone: document.getElementById('cPhone').value.trim(),
    notes: document.getElementById('cNotes').value.trim(),
    x, y,
    open_time: mon[0]?.open_time || '09:00',
    close_time: mon[0]?.close_time || '18:00',
    open_time_2: mon[1]?.open_time || '',
    close_time_2: mon[1]?.close_time || '',
    ruta_id: rutaVal ? parseInt(rutaVal) : null,
    al_contado: document.getElementById('cContado').checked ? 1 : 0,
  };

  const eid = parseInt(document.getElementById('cId').value);

  try {
    if (eid) {
      await api('clients/' + eid, 'PUT', data);
      await api('clients/' + eid + '/schedules', 'PUT', { schedules: schedule });
      showToast('Cliente actualizado');
    } else {
      const created = await api('clients', 'POST', data);
      if (created?.id) {
        await api('clients/' + created.id + '/schedules', 'PUT', { schedules: schedule });
      }
      showToast('Cliente creado');
    }
    currentRoute = null;
    closeCModal();
    await loadClients();
    refreshAll();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteClient(id) {
  if (!confirm('Eliminar cliente? Se borraran tambien sus pedidos.')) return;
  try {
    await api('clients/' + id, 'DELETE');
    currentRoute = null;
    await loadClients();
    await loadOrders();
    refreshAll();
    showToast('Cliente eliminado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── ORDER MODAL ────────────────────────────────────────────
function openOrderModal(preId) {
  const sel = document.getElementById('pClientSel');
  sel.innerHTML = '<option value="">— Elige un cliente —</option>';
  activeClients().forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    if (preId && c.id === preId) o.selected = true;
    sel.appendChild(o);
  });
  sel.disabled = !!preId;
  document.getElementById('pClientIdFixed').value = preId || '';
  document.getElementById('pNotes').value = '';
  document.getElementById('itemsContainer').innerHTML = '';
  itemCnt = 0;

  if (preId) {
    const date = getDate();
    const ex = orders[date]?.[preId];
    document.getElementById('pModalTitle').textContent = ex ? 'Editar pedido' : 'Nuevo pedido';
    if (ex) {
      document.getElementById('pNotes').value = ex.notes || '';
      ex.items.forEach(it => addItemRow(it.name, it.qty));
    }
  } else {
    document.getElementById('pModalTitle').textContent = 'Registrar pedido';
  }
  if (document.getElementById('itemsContainer').children.length === 0) addItemRow();
  document.getElementById('pModal').classList.add('open');
}
function closePModal() { document.getElementById('pModal').classList.remove('open'); }

function addItemRow(name = '', qty = 1) {
  const id = itemCnt++;
  const row = document.createElement('div');
  row.className = 'item-row'; row.id = 'ir' + id;
  row.innerHTML = '<input type="text" placeholder="Producto / articulo" value="' + name + '"><input type="number" value="' + qty + '" min="1" class="qty-inp"><button class="rem-btn" onclick="document.getElementById(\'ir' + id + '\').remove()">x</button>';
  document.getElementById('itemsContainer').appendChild(row);
}

async function saveOrder() {
  const cid = parseInt(document.getElementById('pClientSel').value);
  if (!cid) { showToast('Selecciona un cliente'); return; }
  const items = [];
  document.querySelectorAll('#itemsContainer .item-row').forEach(row => {
    const n = row.querySelector('input[type=text]').value.trim();
    const q = parseInt(row.querySelector('input[type=number]').value) || 1;
    if (n) items.push({ name: n, qty: q });
  });
  const date = getDate();

  try {
    await api('orders', 'POST', {
      client_id: cid,
      date: date,
      items: items,
      notes: document.getElementById('pNotes').value.trim(),
    });
    closePModal();
    currentRoute = null;
    await loadOrders();
    refreshAll();
    switchTab('p');
    showToast('Pedido guardado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteOrder(cid) {
  const date = getDate();
  try {
    await api('orders?client_id=' + cid + '&date=' + date, 'DELETE');
    currentRoute = null;
    await loadOrders();
    refreshAll();
    showToast('Pedido eliminado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── RENDER ─────────────────────────────────────────────────
function refreshAll() {
  renderClientList(); updateStats(); drawMap();
}

function renderClientList() {
  const list = document.getElementById('clientList');
  const now = nowMin();
  const date = getDate();
  const day = orders[date] || {};
  const visible = filteredClients();
  const totalActive = clients.filter(c => c.active).length;
  const totalInactive = clients.length - totalActive;

  // Contador en la cabecera
  document.getElementById('filterCount').textContent = visible.length + ' de ' + clients.length;

  if (!visible.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">Clientes</div>' +
      (searchQuery ? 'Sin resultados para "' + searchQuery + '"' : (clients.length ? 'Todos los clientes estan inactivos.' : 'Sin clientes.<br>Pulsa "Demo" o "+ Nuevo".')) + '</div>';
    return;
  }

  const MAX_RENDER = 100;
  const toRender = visible.slice(0, MAX_RENDER);

  const todayDb = jsToDbDay(new Date().getDay());
  list.innerHTML = toRender.map((c, i) => {
    const isOpen = clientOpen(c, now);
    const hasOrd = !!day[c.id];
    const inRoute = currentRoute?.includes(c.id);
    const ri = inRoute ? currentRoute.indexOf(c.id) + 1 : null;
    const ord = day[c.id];
    const numCls = inRoute ? 'route' : (hasOrd ? 'order' : '');
    const inactiveCls = !c.active ? ' inactive' : '';
    return '<div class="client-card' + (hasOrd ? ' has-order' : '') + (inRoute ? ' in-route' : '') + inactiveCls + '" onclick="focusClientOnMap(' + c.id + '); openClientModal(' + c.id + ')">' +
      '<div class="card-top">' +
        '<div class="cnum ' + numCls + '">' + (inRoute ? ri : (i + 1)) + '</div>' +
        '<div class="cname">' + c.name + '</div>' +
      '</div>' +
      '<div class="card-sub">' +
        '<span class="card-addr">' + (c.addr || (c.x.toFixed(4) + ', ' + c.y.toFixed(4))) + '</span>' +
        (c.comercial_name ? '<span class="card-comercial">' + c.comercial_name + '</span>' : '') +
      '</div>' +
      '<div class="pills">' +
        '<span class="pill ' + (isOpen ? 'open' : 'closed') + '">' + (isOpen ? 'ABIERTO' : 'CERRADO') + ' ' + clientHoursText(c, todayDb) + '</span>' +
        (hasOrd ? '<span class="pill has-ord">PEDIDO</span>' : '') +
        (c.ruta_name ? '<span class="pill" style="border-color:' + getRutaColor(c.ruta_id) + '44;color:' + getRutaColor(c.ruta_id) + ';background:' + getRutaColor(c.ruta_id) + '18">' + c.ruta_name + '</span>' : '') +
        (!c.active ? '<span class="pill closed">INACTIVO</span>' : '') +
      '</div>' +
    '</div>';
  }).join('') + (visible.length > MAX_RENDER ? '<div class="empty" style="padding:14px">Mostrando ' + MAX_RENDER + ' de ' + visible.length + '. Usa el buscador para filtrar.</div>' : '');
}

function renderPedidosList() {
  const list = document.getElementById('pedidosList');
  const date = getDate();
  const day = orders[date] || {};
  const ids = Object.keys(day).map(Number);
  document.getElementById('bp').textContent = ids.length;
  if (!ids.length) { list.innerHTML = '<div class="empty"><div class="empty-icon">Pedidos</div>Sin pedidos para esta fecha.<br>Pulsa "+ Pedido" para registrar.</div>'; return; }
  const now = nowMin();
  const todayDb2 = jsToDbDay(new Date().getDay());
  list.innerHTML = ids.map(cid => {
    const c = clients.find(x => x.id === cid);
    if (!c) return '';
    const ord = day[cid];
    const isOpen = clientOpen(c, now);
    const inRoute = currentRoute?.includes(cid);
    const ri = inRoute ? currentRoute.indexOf(cid) + 1 : 'P';
    return '<div class="client-card' + (inRoute ? ' in-route' : '') + '">' +
      '<div class="card-top">' +
        '<div class="cnum ' + (inRoute ? 'route' : 'order') + '">' + ri + '</div>' +
        '<div class="cname">' + c.name + '</div>' +
        '<div class="card-actions">' +
          '<button class="icon-btn" onclick="openOrderModal(' + cid + ')" title="Editar pedido">Edit</button>' +
          '<button class="icon-btn danger" onclick="deleteOrder(' + cid + ')" title="Eliminar pedido">Del</button>' +
        '</div>' +
      '</div>' +
      '<div class="pills">' +
        (c.addr ? '<span class="pill">' + c.addr + '</span>' : '') +
        '<span class="pill ' + (isOpen ? 'open' : 'closed') + '">' + (isOpen ? 'ABIERTO' : 'CERRADO') + ' ' + clientHoursText(c, todayDb2) + '</span>' +
      '</div>' +
      '<div class="order-box">' +
        (ord.items.length ? ord.items.map(it => '<div class="order-box-line">' + it.qty + 'x ' + it.name + '</div>').join('') : '<div class="order-box-line" style="color:var(--text-dim)">Sin articulos</div>') +
        (ord.notes ? '<div class="order-box-note">' + ord.notes + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function updateStats() {
  const date = getDate(); const day = orders[date] || {};
  const np = Object.keys(day).length;
  const ac = activeClients().length;
  const av = vehicles.filter(v => parseInt(v.active)).length;
  document.getElementById('sClientes').textContent = ac;
  document.getElementById('sPedidos').textContent = np;
  document.getElementById('sVehicles').textContent = av;
  document.getElementById('bc').textContent = ac;
}

// ── FLEET MANAGEMENT ──────────────────────────────────────
function renderFleetLists() {
  // Delegaciones
  const dl = document.getElementById('delegationList');
  if (!delegations.length) {
    dl.innerHTML = '<div class="empty">Sin delegaciones. Pulsa "+ Delegacion" para crear.</div>';
  } else {
    dl.innerHTML = delegations.map((d, i) => {
      const active = parseInt(d.active);
      return '<div class="client-card' + (!active ? ' inactive' : '') + '" onclick="openDelegationModal(' + d.id + ')">' +
        '<div class="card-top">' +
          '<div class="cnum route">B' + (i + 1) + '</div>' +
          '<div class="cname">' + d.name + '</div>' +
        '</div>' +
        '<div class="pills">' +
          '<span class="pill">' + (d.address || (parseFloat(d.x).toFixed(4) + ', ' + parseFloat(d.y).toFixed(4))) + '</span>' +
          (!active ? '<span class="pill closed">INACTIVO</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Vehiculos
  const vl = document.getElementById('vehicleList');
  if (!vehicles.length) {
    vl.innerHTML = '<div class="empty">Sin vehiculos. Pulsa "+ Vehiculo" para crear.</div>';
  } else {
    vl.innerHTML = vehicles.map(v => {
      const active = parseInt(v.active);
      const caps = [];
      if (v.max_weight_kg) caps.push(parseFloat(v.max_weight_kg) + ' kg');
      if (v.max_volume_m3) caps.push(parseFloat(v.max_volume_m3) + ' m3');
      if (v.max_items) caps.push(v.max_items + ' items');
      return '<div class="client-card' + (!active ? ' inactive' : '') + '" onclick="openVehicleModal(' + v.id + ')">' +
        '<div class="card-top">' +
          '<div class="cnum order">' + (v.plate || 'V') + '</div>' +
          '<div class="cname">' + v.name + '</div>' +
        '</div>' +
        '<div class="pills">' +
          '<span class="pill">' + (v.delegation_name || 'Sin delegacion') + '</span>' +
          (caps.length ? '<span class="pill">' + caps.join(' | ') + '</span>' : '<span class="pill">Sin limites</span>') +
          (!active ? '<span class="pill closed">INACTIVO</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }
}

// ── DELEGATION MODAL ──────────────────────────────────────
function openDelegationModal(id = null) {
  const d = id ? delegations.find(x => parseInt(x.id) === id) : null;
  document.getElementById('dModalTitle').textContent = d ? 'Editar delegacion' : 'Nueva delegacion';
  document.getElementById('dId').value = id || '';
  document.getElementById('dName').value = d?.name || '';
  document.getElementById('dAddr').value = d?.address || '';
  document.getElementById('dPhone').value = d?.phone || '';
  document.getElementById('dX').value = d ? parseFloat(d.x) : '';
  document.getElementById('dY').value = d ? parseFloat(d.y) : '';
  document.getElementById('dOpen').value = (d?.open_time || '06:00').substring(0, 5);
  document.getElementById('dClose').value = (d?.close_time || '22:00').substring(0, 5);
  document.getElementById('dModal').classList.add('open');
}
function closeDModal() { document.getElementById('dModal').classList.remove('open'); }

async function saveDelegation() {
  const name = document.getElementById('dName').value.trim();
  const x = parseFloat(document.getElementById('dX').value);
  const y = parseFloat(document.getElementById('dY').value);
  if (!name || isNaN(x) || isNaN(y)) { showToast('Nombre y coordenadas obligatorios'); return; }

  const data = {
    name, x, y,
    address: document.getElementById('dAddr').value.trim(),
    phone: document.getElementById('dPhone').value.trim(),
    open_time: document.getElementById('dOpen').value,
    close_time: document.getElementById('dClose').value,
  };

  const eid = parseInt(document.getElementById('dId').value);
  try {
    if (eid) {
      await api('delegations/' + eid, 'PUT', data);
      showToast('Delegacion actualizada');
    } else {
      await api('delegations', 'POST', data);
      showToast('Delegacion creada');
    }
    closeDModal();
    await loadDelegations();
    await loadDelegation();
    renderFleetLists();
    drawMap();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── VEHICLE MODAL ─────────────────────────────────────────
function openVehicleModal(id = null) {
  const v = id ? vehicles.find(x => parseInt(x.id) === id) : null;
  document.getElementById('vModalTitle').textContent = v ? 'Editar vehiculo' : 'Nuevo vehiculo';
  document.getElementById('vId').value = id || '';
  document.getElementById('vName').value = v?.name || '';
  document.getElementById('vPlate').value = v?.plate || '';
  document.getElementById('vMaxWeight').value = v?.max_weight_kg || '';
  document.getElementById('vMaxVolume').value = v?.max_volume_m3 || '';
  document.getElementById('vMaxItems').value = v?.max_items || '';

  // Llenar select de delegaciones
  const sel = document.getElementById('vDelegationSel');
  sel.innerHTML = '<option value="">— Selecciona delegacion —</option>';
  delegations.forEach(d => {
    if (!parseInt(d.active)) return;
    const o = document.createElement('option');
    o.value = d.id; o.textContent = d.name;
    if (v && parseInt(v.delegation_id) === parseInt(d.id)) o.selected = true;
    sel.appendChild(o);
  });

  document.getElementById('vModal').classList.add('open');
}
function closeVModal() { document.getElementById('vModal').classList.remove('open'); }

async function saveVehicle() {
  const name = document.getElementById('vName').value.trim();
  const delegationId = parseInt(document.getElementById('vDelegationSel').value);
  if (!name || !delegationId) { showToast('Nombre y delegacion obligatorios'); return; }

  const data = {
    name,
    plate: document.getElementById('vPlate').value.trim(),
    delegation_id: delegationId,
    max_weight_kg: parseFloat(document.getElementById('vMaxWeight').value) || null,
    max_volume_m3: parseFloat(document.getElementById('vMaxVolume').value) || null,
    max_items: parseInt(document.getElementById('vMaxItems').value) || null,
  };

  const eid = parseInt(document.getElementById('vId').value);
  try {
    if (eid) {
      await api('vehicles/' + eid, 'PUT', data);
      showToast('Vehiculo actualizado');
    } else {
      await api('vehicles', 'POST', data);
      showToast('Vehiculo creado');
    }
    closeVModal();
    await loadVehicles();
    renderFleetLists();
    updateStats();
  } catch (e) { showToast('Error: ' + e.message); }
}

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
      html += '<div class="rstop-item' + (STATUS_CLS[stopStatus] || '') + '" data-stop-idx="' + si + '" data-client-id="' + s.client_id + '">'
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
      const c = clients.find(x => x.id === s.client_id);
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
      const c = clients.find(x => x.id === s.client_id);
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
      LUNCH_DURATION = result.settings.lunch_duration_min || 60;
      LUNCH_EARLIEST = t2m(result.settings.lunch_earliest || '12:00');
      LUNCH_LATEST = t2m(result.settings.lunch_latest || '15:30');
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
async function openSettingsModal() {
  try {
    const s = await api('settings');
    document.getElementById('sLunchDur').value = s.lunch_duration_min || 60;
    document.getElementById('sLunchEarly').value = s.lunch_earliest || '12:00';
    document.getElementById('sLunchLate').value = s.lunch_latest || '15:30';
    document.getElementById('sBaseUnload').value = s.base_unload_min || 5;
    document.getElementById('sSpeed').value = s.default_speed_kmh || 50;
  } catch (e) { /* usa valores por defecto del form */ }

  // Mostrar boton de guardar plantilla si hay rutas
  document.getElementById('btnSaveTemplate').style.display = fleetRoutes?.routes?.length ? 'block' : 'none';
  loadTemplates();
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('open'); }

async function saveSettings() {
  try {
    await api('settings', 'PUT', {
      lunch_duration_min: document.getElementById('sLunchDur').value,
      lunch_earliest: document.getElementById('sLunchEarly').value,
      lunch_latest: document.getElementById('sLunchLate').value,
      base_unload_min: document.getElementById('sBaseUnload').value,
      default_speed_kmh: document.getElementById('sSpeed').value,
    });
    closeSettingsModal();
    showToast('Configuracion guardada');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── TEMPLATES ─────────────────────────────────────────────
async function loadTemplates() {
  try {
    const templates = await api('templates');
    const el = document.getElementById('templateList');
    if (!templates.length) {
      el.innerHTML = '<div style="padding:6px;color:var(--text-dim);font-size:11px">Sin plantillas guardadas</div>';
      return;
    }
    const DAY_ES = ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'];
    el.innerHTML = templates.map(t => {
      const dayLabel = t.day_of_week !== null ? DAY_ES[t.day_of_week] : 'Todos';
      return '<div class="client-card" style="padding:7px 10px;margin-bottom:4px;cursor:default">'
        + '<div class="card-top">'
        +   '<div class="cname">' + t.name + '</div>'
        +   '<div class="card-actions" style="opacity:1">'
        +     '<button class="icon-btn" onclick="applyTemplate(' + t.id + ')" title="Cargar">&#9654;</button>'
        +     '<button class="icon-btn danger" onclick="deleteTemplate(' + t.id + ')" title="Eliminar">&times;</button>'
        +   '</div>'
        + '</div>'
        + '<div class="pills">'
        +   '<span class="pill">' + dayLabel + '</span>'
        +   '<span class="pill">' + t.stops.length + ' clientes</span>'
        +   (t.vehicle_name ? '<span class="pill">' + t.vehicle_name + '</span>' : '')
        + '</div>'
      + '</div>';
    }).join('');
  } catch (e) { /* silenciar */ }
}

async function saveCurrentAsTemplate() {
  if (!fleetRoutes?.routes?.length) return;
  const name = prompt('Nombre de la plantilla:');
  if (!name) return;

  // Guardar cada ruta como plantilla separada
  for (const r of fleetRoutes.routes) {
    const clientIds = r.stops.map(s => s.client_id);
    await api('templates', 'POST', {
      name: name + (fleetRoutes.routes.length > 1 ? ' - ' + r.vehicle.name : ''),
      vehicle_id: r.vehicle?.id || null,
      delegation_id: r.delegation?.id || null,
      client_ids: clientIds,
    });
  }
  showToast('Plantilla guardada');
  loadTemplates();
}

async function applyTemplate(templateId) {
  try {
    const templates = await api('templates');
    const t = templates.find(x => x.id === templateId);
    if (!t) return;

    const date = getDate();
    // Crear pedidos para los clientes de la plantilla que no tienen pedido
    const day = orders[date] || {};
    let created = 0;
    for (const stop of t.stops) {
      if (!day[stop.client_id]) {
        try {
          await api('orders', 'POST', { client_id: stop.client_id, date, items: [{ item_name: 'Pedido plantilla', quantity: 1 }] });
          created++;
        } catch (e) { /* ya existe o error */ }
      }
    }
    if (created) {
      await loadOrders();
      refreshAll();
    }
    closeSettingsModal();
    showToast('Plantilla aplicada: ' + created + ' pedidos creados. Optimiza rutas.');
  } catch (e) { showToast('Error: ' + e.message); }
}

async function deleteTemplate(id) {
  if (!confirm('Eliminar plantilla?')) return;
  await api('templates/' + id, 'DELETE');
  loadTemplates();
}

// ── HISTORIAL DE RUTAS ────────────────────────────────────
async function loadHistory() {
  const from = document.getElementById('hFrom').value;
  const to = document.getElementById('hTo').value;
  const el = document.getElementById('historyList');

  try {
    const days = await api('routes/history?from=' + from + '&to=' + to);
    if (!days.length) {
      el.innerHTML = '<div class="empty">Sin rutas en este periodo</div>';
      return;
    }
    const DAY_ES = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
    el.innerHTML = days.map(day => {
      const d = new Date(day.date + 'T12:00:00');
      const dayName = DAY_ES[d.getDay()];
      const STATUS_ICON = { draft: '&#9634;', confirmed: '&#10004;', in_progress: '&#9654;', completed: '&#9733;' };

      return '<div class="client-card" style="cursor:default;margin-bottom:6px">'
        + '<div class="card-top">'
        +   '<div class="cname">' + dayName + ' ' + day.date + '</div>'
        +   '<div class="pills" style="margin:0">'
        +     '<span class="pill">' + day.total_km.toFixed(1) + ' km</span>'
        +     '<span class="pill">' + day.total_h.toFixed(1) + ' h</span>'
        +   '</div>'
        + '</div>'
        + day.routes.map(r => {
          const pct = r.stop_count > 0 ? Math.round(r.completed_count / r.stop_count * 100) : 0;
          const statusIcon = STATUS_ICON[r.status] || '';
          return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;border-top:1px solid var(--border);margin-top:3px">'
            + '<span style="color:var(--accent)">' + statusIcon + '</span>'
            + '<span style="font-weight:600;flex:1">' + r.vehicle_name + '</span>'
            + '<span class="pill">' + r.stop_count + ' paradas</span>'
            + '<span class="pill">' + parseFloat(r.total_distance_km).toFixed(1) + ' km</span>'
            + (r.stop_count > 0 ? '<span class="pill' + (pct === 100 ? ' open' : '') + '">' + pct + '%</span>' : '')
            + '<button class="icon-btn" onclick="loadHistoryRoute(' + r.id + ')" title="Ver en mapa" style="padding:2px 6px;font-size:10px">&#128065;</button>'
            + '</div>';
        }).join('')
      + '</div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div class="empty">Error cargando historial</div>'; }
}

async function loadHistoryRoute(planId) {
  try {
    const plan = await api('routes/' + planId);
    if (!plan || !plan.stops?.length) { showToast('Sin datos'); return; }

    // Mostrar en mapa
    const del = delegations.find(d => parseInt(d.id) === parseInt(plan.delegation_id));
    if (!del) return;

    const waypoints = [
      { x: parseFloat(del.x), y: parseFloat(del.y) },
      ...plan.stops.map(s => ({ x: parseFloat(s.x), y: parseFloat(s.y) })),
      { x: parseFloat(del.x), y: parseFloat(del.y) },
    ];
    const osrm = await fetchOSRMRoute(waypoints);

    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];
    routeLines.push(L.polyline(osrm.geometry, { color: '#d4a830', weight: 4, opacity: 0.85 }).addTo(map));
    map.fitBounds(L.polyline(osrm.geometry).getBounds(), { padding: [30, 30] });
    showToast('Ruta historica: ' + plan.stops.length + ' paradas - ' + parseFloat(plan.total_distance_km).toFixed(1) + ' km');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── DASHBOARD ─────────────────────────────────────────────
async function loadDashboard() {
  const from = document.getElementById('hFrom').value;
  const to = document.getElementById('hTo').value;
  const el = document.getElementById('dashboardPanel');

  try {
    const s = await api('stats?from=' + from + '&to=' + to);
    el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
      + dashCard('Dias planificados', s.days)
      + dashCard('Rutas totales', s.total_routes)
      + dashCard('Km totales', parseFloat(s.total_km).toFixed(1) + ' km')
      + dashCard('Horas totales', parseFloat(s.total_hours).toFixed(1) + ' h')
      + dashCard('Media km/ruta', parseFloat(s.avg_km_per_route).toFixed(1) + ' km')
      + dashCard('Media h/ruta', parseFloat(s.avg_h_per_route).toFixed(1) + ' h')
      + dashCard('Paradas totales', s.total_stops)
      + dashCard('Completadas', s.completed_stops + ' (' + (s.total_stops > 0 ? Math.round(s.completed_stops / s.total_stops * 100) : 0) + '%)')
      + dashCard('Saltadas', s.skipped_stops || 0)
      + dashCard('Coste estimado', parseFloat(s.total_cost).toFixed(2) + ' EUR')
    + '</div>';
  } catch (e) { el.innerHTML = '<div style="padding:10px;color:var(--text-dim)">Sin datos</div>'; }
}

function dashCard(label, value) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px">'
    + '<div style="font-size:16px;font-weight:700;color:var(--text-bright)">' + value + '</div>'
    + '<div style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">' + label + '</div>'
  + '</div>';
}

// ── ESTADO DE RUTA (confirmar/marcar paradas) ─────────────
async function confirmRoutes() {
  if (!fleetRoutes?.routes?.length) return;
  for (const r of fleetRoutes.routes) {
    if (r.plan_id) {
      await api('routes/' + r.plan_id + '/status', 'PUT', { status: 'confirmed' });
    }
  }
  showToast('Rutas confirmadas');
}

async function toggleStopStatus(planId, stopOrder, currentStatus) {
  const next = currentStatus === 'pending' ? 'completed' : currentStatus === 'completed' ? 'skipped' : 'pending';
  try {
    await api('routes/' + planId + '/stop/' + stopOrder + '/status', 'PUT', { status: next });
    // Actualizar el estado local en la parada
    if (fleetRoutes) {
      for (const r of fleetRoutes.routes) {
        if (r.plan_id === planId) {
          const stop = r.stops.find((s, i) => (i + 1) === stopOrder);
          if (stop) stop.status = next;
        }
      }
      renderRoutePanel(fleetRoutes);
      initSortables();
    }
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── HOJAS DE RUTA ─────────────────────────────────────────
let hojasData = { hojas: [], rutas_sin_hoja: [] };
let currentHoja = null;
let comerciales = [];
let hrSortable = null;

function getHrDate() { return document.getElementById('hrDate').value || todayStr(); }
function setHrToday() { document.getElementById('hrDate').value = todayStr(); onHrDateChange(); }
function hrDateNav(delta) {
  const d = new Date(getHrDate());
  d.setDate(d.getDate() + delta);
  document.getElementById('hrDate').value = d.toISOString().slice(0, 10);
  onHrDateChange();
}
async function onHrDateChange() { await loadHojasRuta(); }

async function loadComerciales() {
  if (comerciales.length) return;
  try { comerciales = await api('comerciales'); } catch (e) { comerciales = []; }
}

async function loadHojasRuta() {
  const fecha = getHrDate();
  try {
    hojasData = await api('hojas-ruta?fecha=' + fecha);
  } catch (e) { hojasData = { hojas: [], rutas_sin_hoja: [] }; }
  renderHojasList();
  document.getElementById('bhr').textContent = hojasData.hojas.length;
}

function renderHojasList() {
  const el = document.getElementById('hrList');
  const { hojas, rutas_sin_hoja } = hojasData;

  if (!hojas.length && !rutas_sin_hoja.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>No hay hojas de ruta para esta fecha</div>';
    return;
  }

  // Resumen diario
  const totalClientes = hojas.reduce((s, h) => s + (h.lineas ? h.lineas.length : (h.num_lineas || 0)), 0);
  const totalCC = hojas.reduce((s, h) => s + parseFloat(h.total_cc || 0), 0);
  const porEstado = {};
  hojas.forEach(h => { porEstado[h.estado] = (porEstado[h.estado] || 0) + 1; });
  const estadoResumen = Object.entries(porEstado).map(([e, n]) => `${n} ${e}`).join(', ');

  let html = `<div style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:11px;display:flex;gap:14px;flex-wrap:wrap">
    <span><b>${hojas.length}</b> hojas</span>
    <span><b>${totalClientes}</b> clientes</span>
    <span><b>${totalCC.toFixed(1)}</b> CC</span>
    <span style="color:var(--text-dim)">${estadoResumen}</span>
  </div>`;
  hojas.forEach(h => {
    const numLineas = h.lineas ? h.lineas.length : (h.num_lineas || 0);
    html += `<div class="hr-card" onclick="openHojaDetail(${h.id})">
      <div class="hr-card-top">
        <div class="hr-card-ruta">${esc(h.ruta_name)}</div>
        <span class="hr-estado-badge hr-estado-${h.estado}">${h.estado}</span>
      </div>
      <div class="hr-card-bottom">
        <span>${esc(h.responsable || '—')}</span>
        <span>${numLineas} clientes</span>
        <span>${parseFloat(h.total_cc || 0).toFixed(1)} CC</span>
      </div>
    </div>`;
  });

  if (rutas_sin_hoja.length) {
    html += '<div style="margin-top:10px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Rutas sin hoja hoy</div>';
    rutas_sin_hoja.forEach(r => {
      html += `<div class="hr-sin-hoja">
        <span>${esc(r.name)}</span>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();quickCreateHoja(${r.id})">+ Crear</button>
      </div>`;
    });
  }

  el.innerHTML = html;
}

async function quickCreateHoja(rutaId) {
  try {
    await api('hojas-ruta', 'POST', { ruta_id: rutaId, fecha: getHrDate() });
    showToast('Hoja creada');
    await loadHojasRuta();
  } catch (e) { showToast('Error: ' + e.message); }
}

function openCreateHojaModal() {
  const sel = document.getElementById('hrNewRuta');
  sel.innerHTML = hojasData.rutas_sin_hoja.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (!sel.innerHTML) sel.innerHTML = '<option value="">Todas las rutas ya tienen hoja</option>';
  document.getElementById('hrNewResp').value = '';
  document.getElementById('hrNewNotas').value = '';
  document.getElementById('hrCreateModal').classList.add('open');
}
function closeHrCreateModal() { document.getElementById('hrCreateModal').classList.remove('open'); }

async function createHoja() {
  const rutaId = document.getElementById('hrNewRuta').value;
  if (!rutaId) return showToast('Selecciona una ruta');
  try {
    await api('hojas-ruta', 'POST', {
      ruta_id: parseInt(rutaId),
      fecha: getHrDate(),
      responsable: document.getElementById('hrNewResp').value,
      notas: document.getElementById('hrNewNotas').value,
    });
    closeHrCreateModal();
    showToast('Hoja creada');
    await loadHojasRuta();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Detalle de hoja ──
async function openHojaDetail(id) {
  try {
    currentHoja = await api('hojas-ruta/' + id);
  } catch (e) { return showToast('Error: ' + e.message); }

  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrRouteInfo').textContent = '';

  await loadComerciales();

  document.getElementById('hrListView').style.display = 'none';
  document.getElementById('hrDetailView').style.display = 'flex';
  renderHojaDetail();
  drawHojaOnMap();
}

function closeHojaDetail() {
  currentHoja = null;
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrDetailView').style.display = 'none';
  document.getElementById('hrListView').style.display = 'flex';
  drawMap();
}

function renderHojaDetail() {
  if (!currentHoja) return;
  const h = currentHoja;

  document.getElementById('hrDetailTitle').textContent = h.ruta_name + ' — ' + h.fecha;
  const badge = document.getElementById('hrDetailEstado');
  badge.textContent = h.estado;
  badge.className = 'hr-estado-badge hr-estado-' + h.estado;
  document.getElementById('hrEstadoSel').value = h.estado;

  const lineas = h.lineas || [];
  document.getElementById('hrTotalClientes').textContent = lineas.length;
  document.getElementById('hrTotalCC').textContent = lineas.reduce((s, l) => s + parseFloat(l.cc_aprox || 0), 0).toFixed(1);

  const el = document.getElementById('hrLineasList');
  if (!lineas.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>Sin clientes. Pulsa "+ Cliente" para añadir.</div>';
    return;
  }

  let html = '';
  lineas.forEach((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const estadoCls = l.estado === 'entregado' || l.estado === 'cancelado' ? l.estado : '';
    const estadoIcon = l.estado === 'entregado' ? '&#10004;' : l.estado === 'cancelado' ? '&#10008;' : l.estado === 'no_entregado' ? '!' : '';
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    const contado = cl?.al_contado ? '<span style="color:var(--danger);font-size:9px;font-weight:700;flex-shrink:0">CTD</span>' : '';
    html += `<div class="hr-linea ${estadoCls}" data-id="${l.id}" onclick="openEditLineaModal(${l.id})">
      <span class="hr-linea-handle" data-sortable-handle>&#9776;</span>
      <span class="hr-linea-num">${num}</span>
      <div class="hr-linea-body">
        <div class="hr-linea-row1">
          <span class="hr-linea-name">${esc(l.client_name)}</span>
          ${contado}
          <span class="hr-linea-cc">${parseFloat(l.cc_aprox || 0) > 0 ? parseFloat(l.cc_aprox).toFixed(1) + ' CC' : ''}</span>
          <span class="hr-linea-estado">${estadoIcon}</span>
        </div>
        <div class="hr-linea-row2">
          <span class="hr-linea-zona">${esc(l.zona || '')}</span>
          <span class="hr-linea-com">${esc(l.comercial_name || '')}</span>
        </div>
      </div>
    </div>`;
  });
  el.innerHTML = html;

  // Init Sortable drag&drop
  if (hrSortable) hrSortable.destroy();
  hrSortable = new Sortable(el, {
    handle: '.hr-linea-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async function () {
      const ids = Array.from(el.querySelectorAll('.hr-linea')).map(e => parseInt(e.dataset.id));
      try {
        currentHoja = await api('hojas-ruta/' + currentHoja.id + '/reordenar', 'PUT', { linea_ids: ids });
        renderHojaDetail();
        await fetchHojaOSRMRoute();
        drawHojaOnMap();
      } catch (e) { showToast('Error al reordenar: ' + e.message); }
    }
  });
}

async function changeHojaEstado(estado) {
  if (!currentHoja) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/estado', 'PUT', { estado });
    renderHojaDetail();
    showToast('Estado: ' + estado);
  } catch (e) { showToast('Error: ' + e.message); }
}

let hrOsrmGeometry = null; // polilínea real OSRM
let hrRouteDistance = null;
let hrRouteDuration = null;

async function autoOrdenarHoja() {
  if (!currentHoja) return;
  try {
    showToast('Ordenando...');
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/auto-ordenar', 'POST');
    renderHojaDetail();

    // Obtener ruta real OSRM
    await fetchHojaOSRMRoute();
    drawHojaOnMap();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function fetchHojaOSRMRoute() {
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrRouteInfo').textContent = '';

  if (!currentHoja || !currentHoja.lineas?.length) return;

  const lineas = currentHoja.lineas;
  const waypoints = [];

  // Buscar la delegación más común entre los clientes de la hoja
  const delCount = {};
  lineas.forEach(l => {
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    if (cl && cl.delegation_id) delCount[cl.delegation_id] = (delCount[cl.delegation_id] || 0) + 1;
  });
  let bestDelId = null;
  let bestDelN = 0;
  for (const [did, n] of Object.entries(delCount)) {
    if (n > bestDelN) { bestDelN = n; bestDelId = parseInt(did); }
  }
  const del = bestDelId ? delegations.find(d => d.id == bestDelId) : delegations.find(d => parseInt(d.active));
  if (del) {
    waypoints.push({ x: parseFloat(del.x), y: parseFloat(del.y) });
  } else if (delegation) {
    waypoints.push({ x: delegation.x, y: delegation.y });
  }

  // Añadir clientes en orden
  lineas.forEach(l => {
    const lat = parseFloat(l.client_x);
    const lng = parseFloat(l.client_y);
    if (lat && lng) waypoints.push({ x: lat, y: lng });
  });

  if (waypoints.length < 2) return;

  try {
    const result = await fetchOSRMRoute(waypoints);
    hrOsrmGeometry = result.geometry;
    hrRouteDistance = result.distance;
    hrRouteDuration = result.duration;

    const km = result.distance.toFixed(1);
    const h = Math.floor(result.duration);
    const m = Math.round((result.duration - h) * 60);
    const timeStr = h > 0 ? h + 'h ' + m + 'min' : m + ' min';
    document.getElementById('hrRouteInfo').textContent = km + ' km · ' + timeStr;
    showToast('Ruta: ' + km + ' km, ' + timeStr);
  } catch (e) {
    document.getElementById('hrRouteInfo').textContent = 'Error ruta';
    console.warn('OSRM error:', e);
  }
}

async function duplicarHoja() {
  if (!currentHoja) return;
  const fecha = prompt('Fecha para la nueva hoja (YYYY-MM-DD):', todayStr());
  if (!fecha) return;
  try {
    const newHoja = await api('hojas-ruta/' + currentHoja.id + '/duplicar', 'POST', { fecha });
    showToast('Hoja duplicada');
    await loadHojasRuta();
    openHojaDetail(newHoja.id);
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Modal añadir líneas ──
let lineaSelectedClients = new Set();

function openAddLineaModal() {
  if (!currentHoja) return;
  loadComerciales().then(() => {
    const comSel = document.getElementById('hrLineaComercial');
    comSel.innerHTML = '<option value="">—</option>' + comerciales.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  });
  document.getElementById('hrLineaCC').value = '';
  document.getElementById('hrLineaObs').value = '';
  document.getElementById('hrLineaSearch').value = '';
  lineaSelectedClients = new Set();
  filterLineaClients('');
  document.getElementById('hrAddLineaModal').classList.add('open');
}
function closeAddLineaModal() { document.getElementById('hrAddLineaModal').classList.remove('open'); }

function filterLineaClients(q) {
  const existingIds = new Set((currentHoja?.lineas || []).map(l => parseInt(l.client_id)));
  const rutaId = currentHoja?.ruta_id;
  q = q.toLowerCase();

  // Primero clientes de la ruta, luego el resto
  const rutaClients = clients.filter(c => c.active && c.ruta_id == rutaId && !existingIds.has(c.id));
  const otherClients = clients.filter(c => c.active && c.ruta_id != rutaId && !existingIds.has(c.id));

  let filtered = [...rutaClients, ...otherClients];
  if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || (c.addr || '').toLowerCase().includes(q));
  filtered = filtered.slice(0, 50);

  const el = document.getElementById('hrLineaClientList');
  if (!filtered.length) {
    el.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--text-dim)">Sin resultados</div>';
    return;
  }

  el.innerHTML = filtered.map(c => {
    const checked = lineaSelectedClients.has(c.id) ? 'checked' : '';
    const isRuta = c.ruta_id == rutaId;
    const badge = isRuta ? ' <span class="pill ruta" style="font-size:9px;vertical-align:middle">Ruta</span>' : '';
    const contadoChecked = c.al_contado ? 'checked' : '';
    const addr = c.addr ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;word-break:break-word">' + esc(c.addr) + '</div>' : '';
    return '<div class="hr-add-client-item" onclick="toggleLineaClient(' + c.id + ', this)">' +
      '<input type="checkbox" ' + checked + ' onclick="event.stopPropagation();toggleLineaClient(' + c.id + ', this.parentElement)" style="flex-shrink:0;width:16px;height:16px;margin-top:2px">' +
      '<div style="flex:1;min-width:0;overflow:hidden">' +
        '<div style="font-weight:600;font-size:12px;word-break:break-word">' + esc(c.name) + badge + '</div>' +
        addr +
      '</div>' +
      '<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;flex-shrink:0;cursor:pointer;font-size:9px;color:var(--danger);font-weight:700;white-space:nowrap;margin-top:2px">' +
        '<input type="checkbox" ' + contadoChecked + ' onchange="toggleContado(' + c.id + ', this.checked)" style="width:13px;height:13px;accent-color:var(--danger)"> CTD' +
      '</label>' +
    '</div>';
  }).join('');
}

function toggleLineaClient(id, row) {
  if (lineaSelectedClients.has(id)) {
    lineaSelectedClients.delete(id);
  } else {
    lineaSelectedClients.add(id);
  }
  const cb = row.querySelector('input[type=checkbox]');
  if (cb) cb.checked = lineaSelectedClients.has(id);
}

async function addLineasToHoja() {
  if (!currentHoja || !lineaSelectedClients.size) return showToast('Selecciona al menos un cliente');
  const comercialId = document.getElementById('hrLineaComercial').value || null;
  const cc = document.getElementById('hrLineaCC').value || 0;
  const obs = document.getElementById('hrLineaObs').value || '';

  try {
    for (const clientId of lineaSelectedClients) {
      const client = clients.find(c => c.id === clientId);
      await api('hojas-ruta/' + currentHoja.id + '/lineas', 'POST', {
        client_id: clientId,
        comercial_id: comercialId ? parseInt(comercialId) : (client?.comercial_id || null),
        cc_aprox: parseFloat(cc) || 0,
        zona: client?.addr || '',
        observaciones: obs,
      });
    }
    closeAddLineaModal();
    currentHoja = await api('hojas-ruta/' + currentHoja.id);
    renderHojaDetail();
    drawHojaOnMap();
    showToast(lineaSelectedClients.size + ' cliente(s) añadido(s)');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Modal editar línea ──
function openEditLineaModal(lineaId) {
  const linea = (currentHoja?.lineas || []).find(l => parseInt(l.id) === lineaId);
  if (!linea) return;

  loadComerciales().then(() => {
    const comSel = document.getElementById('hrEditComercial');
    comSel.innerHTML = '<option value="">—</option>' + comerciales.map(c =>
      `<option value="${c.id}" ${parseInt(linea.comercial_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  });

  document.getElementById('hrEditLineaId').value = lineaId;
  document.getElementById('hrEditLineaTitle').textContent = linea.client_name;
  document.getElementById('hrEditCC').value = linea.cc_aprox || '';
  document.getElementById('hrEditZona').value = linea.zona || '';
  document.getElementById('hrEditObs').value = linea.observaciones || '';
  document.getElementById('hrEditEstado').value = linea.estado || 'pendiente';
  document.getElementById('hrEditLineaModal').classList.add('open');
}
function closeEditLineaModal() { document.getElementById('hrEditLineaModal').classList.remove('open'); }

async function saveEditLinea() {
  const lineaId = document.getElementById('hrEditLineaId').value;
  if (!lineaId || !currentHoja) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'PUT', {
      comercial_id: document.getElementById('hrEditComercial').value || null,
      cc_aprox: parseFloat(document.getElementById('hrEditCC').value) || 0,
      zona: document.getElementById('hrEditZona').value,
      observaciones: document.getElementById('hrEditObs').value,
      estado: document.getElementById('hrEditEstado').value,
    });
    closeEditLineaModal();
    renderHojaDetail();
    drawHojaOnMap();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function removeLineaFromModal() {
  const lineaId = document.getElementById('hrEditLineaId').value;
  if (!lineaId || !currentHoja) return;
  if (!confirm('Quitar este cliente de la hoja?')) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'DELETE');
    closeEditLineaModal();
    renderHojaDetail();
    drawHojaOnMap();
    showToast('Cliente quitado');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Mapa para hoja de ruta ──
let hrMapMarkers = [];
let hrMapLine = null;

function drawHojaOnMap() {
  // Limpiar marcadores de hoja anteriores
  hrMapMarkers.forEach(m => map.removeLayer(m));
  hrMapMarkers = [];
  if (hrMapLine) { map.removeLayer(hrMapLine); hrMapLine = null; }

  if (!currentHoja || !currentHoja.lineas?.length) return;

  const lineas = currentHoja.lineas;
  const points = [];

  // Marcador de delegación si hay ruta OSRM
  if (hrOsrmGeometry && delegations.length) {
    const del = delegations.find(d => parseInt(d.active));
    if (del) {
      const dm = L.marker([parseFloat(del.x), parseFloat(del.y)], { icon: delegationIcon('D'), zIndexOffset: 1000 })
        .bindTooltip(del.name, { permanent: true, direction: 'bottom', offset: [0, 10], className: 'delegation-tooltip' })
        .addTo(map);
      hrMapMarkers.push(dm);
    }
  }

  lineas.forEach((l, i) => {
    const lat = parseFloat(l.client_x);
    const lng = parseFloat(l.client_y);
    if (!lat || !lng) return;

    const num = l.orden_descarga || (i + 1);
    const cc = parseFloat(l.cc_aprox || 0);
    const tooltip = l.client_name + (cc > 0 ? ' (' + cc.toFixed(1) + ' CC)' : '');
    const marker = L.marker([lat, lng], { icon: clientIcon('#8e8b30', num) })
      .bindTooltip(tooltip, { direction: 'top', offset: [0, -12] })
      .addTo(map);
    hrMapMarkers.push(marker);
    points.push([lat, lng]);
  });

  // Dibujar ruta: OSRM real si disponible, o línea recta como fallback
  if (hrOsrmGeometry && hrOsrmGeometry.length > 1) {
    hrMapLine = L.polyline(hrOsrmGeometry, { color: '#8e8b30', weight: 4, opacity: 0.8 }).addTo(map);
    map.fitBounds(hrMapLine.getBounds().pad(0.1));
  } else if (points.length > 1) {
    hrMapLine = L.polyline(points, { color: '#8e8b30', weight: 3, opacity: 0.7, dashArray: '8,6' }).addTo(map);
    map.fitBounds(L.latLngBounds(points).pad(0.15));
  } else if (points.length) {
    map.fitBounds(L.latLngBounds(points).pad(0.15));
  }
}

// ── Impresión ──
function printHoja() {
  if (!currentHoja) return;
  const h = currentHoja;
  const lineas = h.lineas || [];

  let rows = lineas.map((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    const contado = cl?.al_contado ? ' <span style="color:red;font-weight:700">[CTD]</span>' : '';
    return `<tr>
      <td style="text-align:center">${num}</td>
      <td><b>${esc(l.client_name)}</b>${contado}</td>
      <td>${esc(l.zona || '')}</td>
      <td>${esc(l.comercial_name || '')}</td>
      <td style="text-align:center">${parseFloat(l.cc_aprox || 0) > 0 ? parseFloat(l.cc_aprox).toFixed(1) : ''}</td>
      <td></td>
      <td>${esc(l.observaciones || '')}</td>
    </tr>`;
  }).join('');

  const totalCC = lineas.reduce((s, l) => s + parseFloat(l.cc_aprox || 0), 0).toFixed(1);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hoja de Ruta - ${esc(h.ruta_name)}</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; padding: 20px; font-size: 12px; }
    h1 { text-align: center; font-size: 18px; margin: 0; }
    h2 { text-align: center; font-size: 14px; color: #666; margin: 4px 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; font-size: 11px; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; }
    .totals { margin-top: 12px; font-size: 13px; font-weight: 700; text-align: center; }
    .firma { margin-top: 40px; display: flex; justify-content: space-between; }
    .firma div { border-top: 1px solid #999; width: 200px; text-align: center; padding-top: 4px; font-size: 10px; color: #666; }
    @media print { body { padding: 10px; } }
  </style></head><body>
  <h1>${esc(h.ruta_name)}</h1>
  <h2>${h.fecha} — ${esc(h.responsable || '')}</h2>
  <table>
    <thead><tr><th>Ord</th><th>Cliente</th><th>Zona</th><th>Com.</th><th>CC</th><th>Entregado</th><th>Observaciones</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">TOTALES: ${totalCC} CC &middot; ${lineas.length} clientes</div>
  <div class="firma"><div>Firma conductor</div><div>Firma almacen</div></div>
  <script>window.print();<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

async function toggleContado(clientId, checked) {
  const c = clients.find(x => x.id === clientId);
  if (c) c.al_contado = checked;
  try {
    await api('clients/' + clientId + '/contado', 'PUT', { al_contado: checked ? 1 : 0 });
  } catch (e) { showToast('Error: ' + e.message); }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── CLOCK ──────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  document.getElementById('clock').textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  refreshAll();
}

function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── INIT ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setToday();
  tickClock();
  setInterval(tickClock, 60000);

  // Inicializar fechas del historial (ultimos 30 dias)
  const today = todayStr();
  document.getElementById('hTo').value = today;
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  document.getElementById('hFrom').value = d30.toISOString().slice(0, 10);

  document.getElementById('hrDate').value = todayStr();

  await Promise.all([loadDelegation(), loadDelegations(), loadVehicles(), loadRutas()]);
  map.setView([delegation.x, delegation.y], 12);
  await loadClients();
  await loadOrders();
  refreshAll();
  fitMapToMarkers();
});

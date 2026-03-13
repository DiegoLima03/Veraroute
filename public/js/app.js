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

function drawMap() {
  // Limpiar marcadores anteriores
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
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

    let color = hasOrd ? (isOpen ? '#8e8b30' : '#c83c32') : '#85725e';
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
      schedules: c.schedules || {},  // {day_of_week: [{open_time, close_time}, ...]}
      active: c.active !== undefined ? !!parseInt(c.active) : true,
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
  document.getElementById('vp').style.display = t === 'p' ? 'flex' : 'none';
  document.getElementById('vf').style.display = t === 'f' ? 'flex' : 'none';
  document.getElementById('tab-c').classList.toggle('active', t === 'c');
  document.getElementById('tab-p').classList.toggle('active', t === 'p');
  document.getElementById('tab-f').classList.toggle('active', t === 'f');
  if (t === 'f') renderFleetLists();
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
  // Horario semanal editable
  buildScheduleGrid(c);

  const toggleBtn = document.getElementById('cToggleBtn');
  if (c) {
    toggleBtn.style.display = '';
    toggleBtn.textContent = c.active ? 'Desactivar' : 'Activar';
    toggleBtn.className = 'btn ' + (c.active ? 'btn-danger' : 'btn-success');
  } else {
    toggleBtn.style.display = 'none';
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
  renderClientList(); renderPedidosList(); updateStats(); drawMap();
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
    return '<div class="client-card' + (hasOrd ? ' has-order' : '') + (inRoute ? ' in-route' : '') + inactiveCls + '" onclick="openClientModal(' + c.id + ')">' +
      '<div class="card-top">' +
        '<div class="cnum ' + numCls + '">' + (inRoute ? ri : (i + 1)) + '</div>' +
        '<div class="cname">' + c.name + '</div>' +
      '</div>' +
      '<div class="pills">' +
        '<span class="pill">' + (c.addr || (c.x.toFixed(4) + ', ' + c.y.toFixed(4))) + '</span>' +
        '<span class="pill ' + (isOpen ? 'open' : 'closed') + '">' + (isOpen ? 'ABIERTO' : 'CERRADO') + ' ' + clientHoursText(c, todayDb) + '</span>' +
        (hasOrd ? '<span class="pill has-ord">PEDIDO</span>' : '') +
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
  document.getElementById('bp').textContent = np;
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

    // Render panel de rutas
    let html = '';
    result.routes.forEach((r, ri) => {
      const color = ROUTE_COLORS[ri % ROUTE_COLORS.length];
      html += '<div class="vehicle-route">' +
        '<div class="vr-header" style="border-left:3px solid ' + color + '">' +
          '<span class="vr-name">' + r.vehicle.name + (r.vehicle.plate ? ' (' + r.vehicle.plate + ')' : '') + '</span>' +
          '<span class="rm green">' + parseFloat(r.total_distance_km).toFixed(1) + ' km</span>' +
          '<span class="rm orange">' + parseFloat(r.total_time_h).toFixed(1) + ' h</span>' +
          '<span class="pill">' + r.stops.length + ' paradas</span>' +
        '</div>' +
        '<div class="route-stops">' +
          '<div class="rstop"><span class="slabel delegation">' + r.delegation.name + '</span></div>';
      r.stops.forEach((s, si) => {
        html += '<span class="sarrow">-></span><div class="rstop"><span class="slabel visit">' + (si + 1) + '. ' + s.name + ' <small>' + (s.eta || '') + '</small></span></div>';
      });
      html += '<span class="sarrow">-></span><div class="rstop"><span class="slabel delegation">' + r.delegation.name + '</span></div>' +
        '</div></div>';
    });

    if (result.unassigned?.length) {
      html += '<div style="margin-top:8px;font-size:10px;color:var(--danger)">Sin asignar: ' + result.unassigned.map(u => u.name + ' (' + u.reason + ')').join(', ') + '</div>';
    }

    document.getElementById('rStops').innerHTML = html;
    document.getElementById('routePanel').classList.add('visible');

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
        r.total_time_h = osrm.duration + (r.stops.length * parseFloat(r.total_unload_min || 0) / 60);
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
  await Promise.all([loadDelegation(), loadDelegations(), loadVehicles()]);
  map.setView([delegation.x, delegation.y], 12);
  await loadClients();
  await loadOrders();
  refreshAll();
  fitMapToMarkers();
});

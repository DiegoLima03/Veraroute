// ── LEAFLET MAP ───────────────────────────────────────────
const mapEl = document.getElementById('map');
const map = (mapEl && typeof L !== 'undefined') ? L.map('map').setView([40.0, -3.5], 6) : null;
if (map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
}

let mapMarkers = [];
let clientMarkerMap = {};
let mapRouteLine = null;
let mapPreviewMarker = null;

function delegationIcon(label) {
  return L.divIcon({ className: 'map-icon delegation-icon', html: '<div>' + label + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
}

function clientIcon(color, label) {
  const colors = Array.isArray(color)
    ? color.map(normalizeHexColor).filter(Boolean)
    : [normalizeHexColor(color)].filter(Boolean);
  const uniqueColors = [...new Set(colors)];
  const primaryColor = uniqueColors[0] || '#85725e';
  const split = uniqueColors.length > 1;

  let background = primaryColor;
  if (split) {
    if (uniqueColors.length === 2) {
      background = 'linear-gradient(90deg, ' + uniqueColors[0] + ' 0 50%, ' + uniqueColors[1] + ' 50% 100%)';
    } else {
      const step = 100 / uniqueColors.length;
      background = 'conic-gradient(' + uniqueColors
        .map((c, idx) => c + ' ' + (idx * step) + '% ' + ((idx + 1) * step) + '%')
        .join(', ') + ')';
    }
  }

  const labelColor = split ? '#ffffff' : getReadableTextColor(primaryColor);
  const borderColor = split ? 'rgba(255,255,255,0.92)' : (labelColor === '#ffffff' ? 'rgba(255,255,255,0.92)' : 'rgba(16,24,14,0.45)');
  const textShadow = split ? 'text-shadow:0 1px 2px rgba(0,0,0,0.8),0 0 1px rgba(0,0,0,0.8);' : '';
  return L.divIcon({
    className: 'map-icon',
    html: '<div style="background:' + background + ';color:' + labelColor + ';width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid ' + borderColor + ';box-shadow:0 2px 6px rgba(0,0,0,0.3);' + textShadow + '">' + label + '</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Click en mapa para colocar ubicaciones
if (map) map.on('click', function (e) {
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
  if (!map) return;
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
  const visibleClients = activeClients().filter(clientHasRenderableCoords);

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

  // Marcadores clientes activos — el color SOLO depende de la ruta comercial
  visibleClients.forEach((c, i) => {
    const inRoute = clientVehicle[c.id] !== undefined || currentRoute?.includes(c.id);
    const vIdx = clientVehicle[c.id];
    const routeColors = getClientRouteColors(c);

    let label = i + 1;
    if (vIdx !== undefined) {
      const route = fleetRoutes.routes[vIdx];
      const stopIdx = route.stops.findIndex(s => parseInt(s.client_id) === c.id);
      label = stopIdx >= 0 ? stopIdx + 1 : label;
    } else if (currentRoute?.includes(c.id)) {
      label = currentRoute.indexOf(c.id) + 1;
    }

    const marker = L.marker([c.x, c.y], { icon: clientIcon(routeColors.length ? routeColors : '#85725e', label), zIndexOffset: inRoute ? 500 : 100 })
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
      const validPts = pts.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

      // Si tenemos geometria OSRM para esta ruta, usarla
      if (r.geometry && Array.isArray(r.geometry) && r.geometry.length > 1) {
        routeLines.push(L.polyline(r.geometry, { color, weight: 4, opacity: 0.85 }).addTo(map));
      } else if (validPts.length > 1) {
        routeLines.push(L.polyline(validPts, { color, weight: 3, opacity: 0.7, dashArray: '8, 5' }).addTo(map));
      }
    });
  } else if (currentRoute?.length) {
    if (routeGeometry) {
      mapRouteLine = L.polyline(routeGeometry, { color: '#d4a830', weight: 4, opacity: 0.85 }).addTo(map);
    } else {
      const pts = [delegation, ...currentRoute.map(gp), delegation];
      const latlngs = pts
        .map(p => [p.x, p.y])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
      if (latlngs.length > 1) {
        mapRouteLine = L.polyline(latlngs, { color: '#8e8b30', weight: 3, opacity: 0.7, dashArray: '8, 5' }).addTo(map);
      }
    }
  }
}

function fitMapToMarkers() {
  if (!map) return;
  const ac = activeClients().filter(clientHasRenderableCoords);
  if (!ac.length) {
    map.setView([delegation.x, delegation.y], 12);
    return;
  }
  const points = ac.map(c => [c.x, c.y]);
  points.push([delegation.x, delegation.y]);
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, { padding: [40, 40] });
}

function clearGeneralMapLayers() {
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
  routeLines.forEach(l => map.removeLayer(l));
  routeLines = [];
  if (mapRouteLine) { map.removeLayer(mapRouteLine); mapRouteLine = null; }
  if (mapPreviewMarker) { map.removeLayer(mapPreviewMarker); mapPreviewMarker = null; }
}

// ── DATA LOADING ──────────────────────────────────────────
async function loadClients() {
  try {
    const data = await api('clients');
    clients = data.map(c => ({
      id: c.id,
      name: c.name,
      addr: c.address || '',
      postcode: c.postcode || '',
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
      rutas: (c.rutas || []).map(r => ({ id: parseInt(r.id), name: r.name, color: r.color || null })),
      delegation_id: c.delegation_id ? parseInt(c.delegation_id) : null,
      comercial_id: c.comercial_id ? parseInt(c.comercial_id) : null,
      comercial_planta_id: c.comercial_planta_id ? parseInt(c.comercial_planta_id) : null,
      comercial_flor_id: c.comercial_flor_id ? parseInt(c.comercial_flor_id) : null,
      comercial_accesorio_id: c.comercial_accesorio_id ? parseInt(c.comercial_accesorio_id) : null,
      comercial_ids: Array.isArray(c.comercial_ids)
        ? c.comercial_ids.map(id => parseInt(id, 10)).filter(Boolean)
        : getClientCommercialIds(c),
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


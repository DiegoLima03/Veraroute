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
let clusteringEnabled = localStorage.getItem('veraroute.clusterEnabled') !== 'false';
let clusterRadius = parseInt(localStorage.getItem('veraroute.clusterRadius') || '40', 10);
let clusterDisableZoom = parseInt(localStorage.getItem('veraroute.clusterZoom') || '15', 10);
let markerClusterGroup = (map && typeof L.markerClusterGroup === 'function')
  ? L.markerClusterGroup({ maxClusterRadius: clusterRadius, spiderfyOnMaxZoom: true, disableClusteringAtZoom: clusterDisableZoom, iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let size = 32, bg = '#8e8b30', border = 'rgba(255,255,255,0.9)';
      if (count >= 50) { size = 44; bg = '#46331f'; }
      else if (count >= 20) { size = 38; bg = '#6b6520'; }
      const fontSize = size < 38 ? 11 : 13;
      return L.divIcon({
        html: '<div style="background:' + bg + ';color:#fff;width:' + size + 'px;height:' + size + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:' + fontSize + 'px;font-weight:700;border:2.5px solid ' + border + ';box-shadow:0 2px 8px rgba(0,0,0,.35);">' + count + '</div>',
        className: 'map-cluster-icon',
        iconSize: [size, size],
      });
    }})
  : null;
if (markerClusterGroup && map && clusteringEnabled) map.addLayer(markerClusterGroup);

// Control de ajustes de mapa (esquina superior derecha)
function clusterIcon(cluster) {
  const count = cluster.getChildCount();
  let size = 32, bg = '#8e8b30', border = 'rgba(255,255,255,0.9)';
  if (count >= 50) { size = 44; bg = '#46331f'; }
  else if (count >= 20) { size = 38; bg = '#6b6520'; }
  const fontSize = size < 38 ? 11 : 13;
  return L.divIcon({
    html: '<div style="background:' + bg + ';color:#fff;width:' + size + 'px;height:' + size + 'px;'
      + 'border-radius:50%;display:flex;align-items:center;justify-content:center;'
      + 'font-size:' + fontSize + 'px;font-weight:700;border:2.5px solid ' + border + ';'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.35);">' + count + '</div>',
    className: 'map-cluster-icon',
    iconSize: [size, size],
  });
}

function rebuildClusterGroup() {
  if (!map) return;
  if (markerClusterGroup) map.removeLayer(markerClusterGroup);
  markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: clusterRadius,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: clusterDisableZoom,
    iconCreateFunction: clusterIcon
  });
  if (clusteringEnabled) map.addLayer(markerClusterGroup);
  drawMap();
}

if (map && markerClusterGroup) {
  const MapSettings = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const wrapper = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-settings-ctrl');
      wrapper.style.cssText = 'position:relative;';
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      // Boton rueda
      const btn = L.DomUtil.create('a', 'map-settings-btn', wrapper);
      btn.href = '#';
      btn.title = 'Ajustes del mapa';
      btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:18px;text-decoration:none;color:#333;';
      btn.innerHTML = '\u2699';

      // Panel desplegable
      const panel = L.DomUtil.create('div', 'map-settings-panel', wrapper);
      panel.style.cssText = 'display:none;position:absolute;top:38px;right:0;background:#fff;border-radius:8px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,.18);padding:14px 16px;width:220px;font-size:11px;color:#333;z-index:1000;';

      panel.innerHTML = ''
        // Toggle agrupar
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        + '  <span style="font-weight:700;font-size:12px;">Agrupar marcadores</span>'
        + '  <label style="position:relative;display:inline-block;width:36px;height:20px;margin:0;cursor:pointer;">'
        + '    <input type="checkbox" id="mcToggle"' + (clusteringEnabled ? ' checked' : '') + ' style="opacity:0;width:0;height:0;">'
        + '    <span id="mcTrack" style="position:absolute;inset:0;background:' + (clusteringEnabled ? '#2d7d2d' : '#ccc') + ';border-radius:10px;transition:background .2s;"></span>'
        + '    <span id="mcKnob" style="position:absolute;top:3px;left:' + (clusteringEnabled ? '19' : '3') + 'px;width:14px;height:14px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 2px rgba(0,0,0,.3);"></span>'
        + '  </label>'
        + '</div>'
        // Slider radio
        + '<div id="mcRadiusGroup" style="margin-bottom:10px;">'
        + '  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">'
        + '    <span>Radio de agrupacion</span><span id="mcRadiusVal" style="font-weight:600;">' + clusterRadius + ' px</span>'
        + '  </div>'
        + '  <input type="range" id="mcRadius" min="20" max="120" step="5" value="' + clusterRadius + '"'
        + '    style="width:100%;accent-color:#8e8b30;cursor:pointer;">'
        + '  <div style="display:flex;justify-content:space-between;color:#999;font-size:9px;"><span>Poco</span><span>Mucho</span></div>'
        + '</div>'
        // Slider zoom
        + '<div id="mcZoomGroup" style="margin-bottom:4px;">'
        + '  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">'
        + '    <span>Desagrupar a zoom</span><span id="mcZoomVal" style="font-weight:600;">' + clusterDisableZoom + '</span>'
        + '  </div>'
        + '  <input type="range" id="mcZoom" min="10" max="19" step="1" value="' + clusterDisableZoom + '"'
        + '    style="width:100%;accent-color:#8e8b30;cursor:pointer;">'
        + '  <div style="display:flex;justify-content:space-between;color:#999;font-size:9px;"><span>Lejos</span><span>Cerca</span></div>'
        + '</div>';

      // Toggle abrir/cerrar
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const open = panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
      });

      // Cerrar al clicar fuera
      document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) panel.style.display = 'none';
      });

      // Eventos del panel
      setTimeout(function () {
        const toggle = document.getElementById('mcToggle');
        const track = document.getElementById('mcTrack');
        const knob = document.getElementById('mcKnob');
        const radiusSlider = document.getElementById('mcRadius');
        const radiusVal = document.getElementById('mcRadiusVal');
        const zoomSlider = document.getElementById('mcZoom');
        const zoomVal = document.getElementById('mcZoomVal');
        const radiusGroup = document.getElementById('mcRadiusGroup');
        const zoomGroup = document.getElementById('mcZoomGroup');

        function updateDisabledState() {
          const disabled = !clusteringEnabled;
          radiusGroup.style.opacity = disabled ? '0.4' : '1';
          zoomGroup.style.opacity = disabled ? '0.4' : '1';
          radiusSlider.disabled = disabled;
          zoomSlider.disabled = disabled;
        }

        if (toggle) toggle.addEventListener('change', function () {
          clusteringEnabled = this.checked;
          localStorage.setItem('veraroute.clusterEnabled', clusteringEnabled);
          track.style.background = clusteringEnabled ? '#2d7d2d' : '#ccc';
          knob.style.left = clusteringEnabled ? '19px' : '3px';
          updateDisabledState();
          if (clusteringEnabled) {
            map.addLayer(markerClusterGroup);
          } else {
            map.removeLayer(markerClusterGroup);
          }
          drawMap();
        });

        if (radiusSlider) radiusSlider.addEventListener('input', function () {
          clusterRadius = parseInt(this.value, 10);
          radiusVal.textContent = clusterRadius + ' px';
        });
        if (radiusSlider) radiusSlider.addEventListener('change', function () {
          localStorage.setItem('veraroute.clusterRadius', clusterRadius);
          rebuildClusterGroup();
        });

        if (zoomSlider) zoomSlider.addEventListener('input', function () {
          clusterDisableZoom = parseInt(this.value, 10);
          zoomVal.textContent = clusterDisableZoom;
        });
        if (zoomSlider) zoomSlider.addEventListener('change', function () {
          localStorage.setItem('veraroute.clusterZoom', clusterDisableZoom);
          rebuildClusterGroup();
        });

        updateDisabledState();
      }, 0);

      return wrapper;
    }
  });
  map.addControl(new MapSettings());
}

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
      return c.name.toLowerCase().includes(q) || (c.fiscal_name || '').toLowerCase().includes(q) || c.addr.toLowerCase().includes(q);
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
  if (markerClusterGroup) markerClusterGroup.clearLayers();
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
      r.stops.forEach(s => { clientVehicle[parseInt(s.id_cliente)] = ri; });
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
      const stopIdx = route.stops.findIndex(s => parseInt(s.id_cliente) === c.id);
      label = stopIdx >= 0 ? stopIdx + 1 : label;
    } else if (currentRoute?.includes(c.id)) {
      label = currentRoute.indexOf(c.id) + 1;
    }

    const marker = L.marker([c.x, c.y], { icon: clientIcon(routeColors.length ? routeColors : '#85725e', label), zIndexOffset: inRoute ? 500 : 100 })
      .bindTooltip(c.name, { direction: 'top', offset: [0, -10] });
    marker.on('click', () => openClientModal(c.id));
    if (clusteringEnabled && markerClusterGroup) {
      markerClusterGroup.addLayer(marker);
    } else {
      marker.addTo(map);
    }
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
  if (markerClusterGroup) markerClusterGroup.clearLayers();
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
      fiscal_name: c.fiscal_name || '',
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
      id_ruta: c.id_ruta ? parseInt(c.id_ruta) : null,
      ruta_name: c.ruta_name || '',
      rutas: (c.rutas || []).map(r => ({ id: parseInt(r.id), name: r.name, color: r.color || null })),
      id_delegacion: c.id_delegacion ? parseInt(c.id_delegacion) : null,
      id_comercial: c.id_comercial ? parseInt(c.id_comercial) : null,
      id_comercial_planta: c.id_comercial_planta ? parseInt(c.id_comercial_planta) : null,
      id_comercial_flor: c.id_comercial_flor ? parseInt(c.id_comercial_flor) : null,
      id_comercial_accesorio: c.id_comercial_accesorio ? parseInt(c.id_comercial_accesorio) : null,
      comercial_ids: Array.isArray(c.comercial_ids)
        ? c.comercial_ids.map(id => parseInt(id, 10)).filter(Boolean)
        : getClientCommercialIds(c),
      comercial_name: c.comercial_name || '',
      al_contado: !!parseInt(c.al_contado || 0),
      tipo_zona: c.tipo_zona || 'villa',
      tipo_negocio: c.tipo_negocio || 'tienda_especializada',
      direcciones: c.direcciones || [],
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


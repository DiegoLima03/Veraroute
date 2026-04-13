// ── API HELPER ────────────────────────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && typeof CSRF_TOKEN !== 'undefined') {
    headers['X-CSRF-TOKEN'] = CSRF_TOKEN;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('api/' + endpoint, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error ' + res.status);
  }
  return res.json();
}

// ── MODAL HELPER ──────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
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
// Hojas de ruta
let hojasData = { hojas: [], rutas_sin_hoja: [] };
let currentHoja = null;
let comerciales = [];
let hrSortable = null;
let hrOsrmGeometry = null;
let hrRouteDistance = null;
let hrRouteDuration = null;
let hrClientSearchQuery = '';
let hrQuickClientSearchQuery = '';
let hrClientSearchTimer = null;
let hrQuickClientSearchTimer = null;
let hrQuickSaveTimers = {};
let lineaSelectedClients = new Set();
let hrMapMarkers = [];
let hrMapLine = null;
let hrAutoOrderFocusMode = false;
let hrGlsAutoCalcTimer = null;
let hrGlsAutoCalcRunning = false;
let lastGlsCalcResult = null; // { hojaId, total_route_km, total_route_cost, optimized_savings, line_recommendations, ... }
let simulationOverrides = {}; // lineaId -> 'fleet' | 'externalize'  (override local del simulador)
let lastSimResult = null; // { hojaId, fleet_km, fleet_cost, gls_total, total }
let simulationDebounceTimer = null;
let simulationInFlight = false;
let glsConfigState = null;
let shippingRates = [];
let rentabilityData = null;
let rentabilitySortKey = 'savings';
let rentabilitySortDir = 'desc';
const SIDEBAR_WIDTH_STORAGE_KEY = 'veraroute.sidebarWidth';

function getUserComercialIds() {
  if (typeof APP_USER === 'undefined') return [];

  const ids = Array.isArray(APP_USER.comercial_ids)
    ? APP_USER.comercial_ids.map(id => parseInt(id, 10)).filter(Boolean)
    : [];

  if (!ids.length && APP_USER.comercial_id) {
    ids.push(parseInt(APP_USER.comercial_id, 10));
  }

  return Array.from(new Set(ids));
}

function getClientCommercialIds(client) {
  if (!client) return [];

  const source = Array.isArray(client.comercial_ids) && client.comercial_ids.length
    ? client.comercial_ids
    : [client.comercial_id, client.comercial_planta_id, client.comercial_flor_id, client.comercial_accesorio_id];

  return Array.from(new Set(source.map(id => parseInt(id, 10)).filter(Boolean)));
}

function normalizeHexColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return ('#' + value.slice(1).split('').map(ch => ch + ch).join('')).toLowerCase();
  }
  return null;
}

function getReadableTextColor(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 165 ? '#10180e' : '#ffffff';
}

function clientMatchesCommercialIds(client, ids) {
  const commercialIds = Array.isArray(ids)
    ? ids.map(id => parseInt(id, 10)).filter(Boolean)
    : [];
  if (!commercialIds.length) return false;

  return getClientCommercialIds(client).some(id => commercialIds.includes(id));
}

function pickClientCommercialId(client, allowedIds) {
  const commercialIds = getClientCommercialIds(client);
  const allowed = Array.isArray(allowedIds)
    ? allowedIds.map(id => parseInt(id, 10)).filter(Boolean)
    : [];

  for (const id of commercialIds) {
    if (!allowed.length || allowed.includes(id)) {
      return id;
    }
  }

  return allowed[0] || commercialIds[0] || null;
}

function clientHasRenderableCoords(client) {
  return Number.isFinite(client?.x) && Number.isFinite(client?.y);
}

function shouldHideComercialSelector() {
  return typeof APP_USER !== 'undefined'
    && APP_USER.role === 'comercial'
    && getUserComercialIds().length > 0;
}

function numVal(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatQty(value) {
  const n = numVal(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function formatMoney(value) {
  const n = numVal(value);
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
}

function formatLineaUnits(linea) {
  const carros = numVal(linea?.carros);
  const cajas = numVal(linea?.cajas);
  const parts = [];
  if (carros > 0) parts.push(formatQty(carros) + ' carro' + (carros === 1 ? '' : 's'));
  if (cajas > 0) parts.push(formatQty(cajas) + ' caja' + (cajas === 1 ? '' : 's'));
  return parts.join(' · ');
}

function hojaLineaHasCarga(linea) {
  return numVal(linea?.carros) > 0 || numVal(linea?.cajas) > 0;
}

function hasLineaCostData(linea) {
  return linea?.detour_km !== null
    || linea?.cost_own_route !== null
    || linea?.cost_gls_adjusted !== null
    || !!linea?.gls_recommendation
    || !!linea?.gls_notes;
}

function getHojaActiveLineas(hoja) {
  return (hoja?.lineas || []).filter(hojaLineaHasCarga);
}

function getHojaVisibleLineas(hoja, isComercialView) {
  return isComercialView ? (hoja?.lineas || []) : getHojaActiveLineas(hoja);
}

function getHojaSummaryLineCount(hoja) {
  if (Array.isArray(hoja?.lineas)) {
    return getHojaActiveLineas(hoja).length;
  }
  return parseInt(hoja?.num_lineas_activas ?? hoja?.num_lineas ?? 0, 10) || 0;
}

function getHojaRouteDelegation(lineas) {
  const delCount = {};
  (lineas || []).forEach(l => {
    const cl = clients.find(c => c.id === parseInt(l.client_id, 10));
    if (cl?.delegation_id) {
      delCount[cl.delegation_id] = (delCount[cl.delegation_id] || 0) + 1;
    }
  });

  let bestDelId = null;
  let bestDelN = 0;
  for (const [did, n] of Object.entries(delCount)) {
    if (n > bestDelN) {
      bestDelN = n;
      bestDelId = parseInt(did, 10);
    }
  }

  return (bestDelId ? delegations.find(d => parseInt(d.id, 10) === bestDelId) : null)
    || delegations.find(d => parseInt(d.active, 10))
    || delegation
    || null;
}

function glsRecommendationMeta(recommendation) {
  const rec = recommendation || 'unavailable';
  const isOptimal = typeof rec === 'string' && rec.endsWith('_optimal');
  const baseRec = isOptimal ? rec.slice(0, -'_optimal'.length) : rec;
  const star = isOptimal ? ' \u2605' : '';
  if (baseRec === 'own_route') return { cls: 'own', label: 'Ruta propia' + star, optimal: isOptimal };
  if (baseRec === 'externalize') return { cls: 'externalize', label: 'Enviar por paqueteria' + star, optimal: isOptimal };
  if (baseRec === 'break_even') return { cls: 'break_even', label: 'Empate tecnico', optimal: false };
  return { cls: 'unavailable', label: 'No calculable', optimal: false };
}

function isExternalizeRecommendation(rec) {
  const r = rec || '';
  return r === 'externalize' || r === 'externalize_optimal';
}

function getEffectiveLineaRecommendation(linea) {
  return linea?.gls_recommendation_effective || linea?.gls_recommendation || 'unavailable';
}

function getEffectiveLineaRecommendationNote(linea) {
  return (linea?.gls_recommendation_effective_note || '').trim();
}

function getGlobalGlsRecommendationMeta(summary) {
  const recommendation = summary?.globalRecommendation || 'unavailable';
  const totalRouteCost = numVal(summary?.totalRouteCost);
  const totalGlsAllClients = numVal(summary?.totalGlsAllClients);
  const globalSavings = numVal(summary?.globalSavings);

  if (recommendation === 'externalize_all') {
    return {
      bannerHtml: `<div class="hr-gls-banner externalize">
        <div class="hr-gls-banner-title">Externaliza TODOS los clientes - ahorro real: ${esc(formatMoney(globalSavings))}</div>
        <div class="hr-gls-banner-sub">El camion no merece salir. Flota: ${esc(formatMoney(totalRouteCost))} · GLS: ${esc(formatMoney(totalGlsAllClients))}</div>
      </div>`,
      note: 'Las recomendaciones por linea asumen que el resto de la ruta se mantiene. Para la decision de toda la hoja, mira el banner de arriba.',
      savingsLabel: 'Ahorro real',
      savingsValue: globalSavings,
      systemTotalCost: totalGlsAllClients,
    };
  }

  if (recommendation === 'do_route') {
    return {
      bannerHtml: `<div class="hr-gls-banner do-route">
        <div class="hr-gls-banner-title">La ruta merece la pena en flota propia - ahorro: ${esc(formatMoney(globalSavings))} vs GLS</div>
        <div class="hr-gls-banner-sub">Flota: ${esc(formatMoney(totalRouteCost))} · GLS si todo externalizado: ${esc(formatMoney(totalGlsAllClients))}</div>
      </div>`,
      note: 'Las recomendaciones por linea asumen que el resto de la ruta se mantiene. Para la decision de toda la hoja, mira el banner de arriba.',
      savingsLabel: 'Ahorro real',
      savingsValue: globalSavings,
      systemTotalCost: totalRouteCost,
    };
  }

  return {
    bannerHtml: '',
    note: '',
    savingsLabel: 'Ahorro potencial',
    savingsValue: numVal(summary?.savings),
    systemTotalCost: numVal(summary?.optimalTotalCost) > 0
      ? numVal(summary.optimalTotalCost)
      : (numVal(summary?.optimizedTotalCost) > 0 ? numVal(summary.optimizedTotalCost) : totalRouteCost),
  };
}

function applyLastGlsPlanToHoja(hoja) {
  if (!hoja || !Array.isArray(hoja.lineas)) return hoja;
  if (!lastGlsCalcResult || parseInt(lastGlsCalcResult.hojaId, 10) !== parseInt(hoja.id, 10)) {
    return hoja;
  }

  const recommendations = lastGlsCalcResult.line_recommendations || {};
  const notes = lastGlsCalcResult.line_recommendation_notes || {};
  return {
    ...hoja,
    lineas: hoja.lineas.map(linea => ({
      ...linea,
      gls_recommendation_effective: recommendations[linea.id] ?? recommendations[String(linea.id)] ?? null,
      gls_recommendation_effective_note: notes[linea.id] ?? notes[String(linea.id)] ?? '',
    })),
  };
}

function friendlyGlsNote(note) {
  const value = (note || '').trim();
  if (!value) return '';
  if (value === 'postcode_missing') return 'Falta codigo postal';
  if (value === 'missing_coords') return 'Faltan coordenadas';
  if (value === 'vehicle_cost_missing') return 'Falta coste por km del vehiculo';
  if (value === 'carrier_rate_missing') return 'No hay tarifa cargada para ese destino o peso';
  if (value.startsWith('gls_error:')) return value.substring('gls_error:'.length).trim() || 'Error GLS';
  return value;
}

function getComercialQuickSearchClients() {
  const ids = getUserComercialIds();
  let rows = activeClients().filter(c => c.ruta_id);
  if (ids.length) {
    rows = rows.filter(c => clientMatchesCommercialIds(c, ids));
  }

  const q = hrQuickClientSearchQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter(c => {
      const haystack = [c.name, c.addr, c.ruta_name, c.comercial_name].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  rows.sort((a, b) => {
    const byRoute = (a.ruta_name || '').localeCompare(b.ruta_name || '', 'es');
    return byRoute || a.name.localeCompare(b.name, 'es');
  });

  return rows.slice(0, 12);
}

function getQuickHojaAndLineaForClient(clientId) {
  for (const hoja of hojasData.hojas || []) {
    const linea = (hoja.lineas || []).find(l => parseInt(l.client_id, 10) === parseInt(clientId, 10));
    if (linea) return { hoja, linea };
  }
  return { hoja: null, linea: null };
}

function setHrQuickClientSearch(value) {
  hrQuickClientSearchQuery = value || '';
  if (hrQuickClientSearchTimer) clearTimeout(hrQuickClientSearchTimer);
  hrQuickClientSearchTimer = setTimeout(() => {
    hrQuickClientSearchTimer = null;
    const results = document.getElementById('hrQuickSearchResults');
    if (results) {
      results.innerHTML = renderComercialQuickSearchResults();
    } else {
      renderHojasList();
    }
  }, 120);
}

function queueQuickHojaLineSave(clientId) {
  if (hrQuickSaveTimers[clientId]) clearTimeout(hrQuickSaveTimers[clientId]);
  hrQuickSaveTimers[clientId] = setTimeout(() => {
    delete hrQuickSaveTimers[clientId];
    saveQuickHojaLine(clientId);
  }, 700);
}

function renderComercialQuickSearchResults() {
  const matches = getComercialQuickSearchClients();
  let html = '';

  if (!hrQuickClientSearchQuery.trim()) {
    html += '<div style="padding:0 14px 6px;font-size:11px;color:var(--text-dim)">Busca un cliente y escribe carros o cajas para generar la hoja automaticamente.</div>';
    return html;
  }

  if (!matches.length) {
    html += '<div style="padding:0 14px 6px;font-size:11px;color:var(--text-dim)">Sin clientes para esa busqueda.</div>';
    return html;
  }

  html += '<div style="display:flex;flex-direction:column;gap:8px;padding:0 4px 4px">';
  matches.forEach(client => {
    const { hoja, linea } = getQuickHojaAndLineaForClient(client.id);
    const status = hoja ? `<span class="hr-estado-badge hr-estado-${hoja.estado}" style="margin-left:auto">${esc(hoja.estado)}</span>` : '';
    html += `<div class="hr-card" style="cursor:default">
      <div class="hr-card-top" style="align-items:flex-start;gap:10px">
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
          <div class="hr-card-ruta">${esc(client.name)}</div>
          <div style="font-size:11px;color:var(--text-dim)">${esc(client.addr || '')}</div>
          <div style="font-size:10px;color:var(--accent);font-weight:700;display:flex;gap:8px;flex-wrap:wrap">
            <span>${esc(client.ruta_name || 'Sin ruta')}</span>
            ${client.comercial_name ? `<span>${esc(client.comercial_name)}</span>` : ''}
          </div>
        </div>
        ${status}
      </div>
      <div class="hr-card-bottom" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="number" id="hrQuickCarros-${client.id}" value="${numVal(linea?.carros) > 0 ? formatQty(linea.carros) : ''}" min="0" step="1" placeholder="Carros" oninput="queueQuickHojaLineSave(${client.id})" style="width:96px;text-align:right;padding:6px 8px;font-size:12px;border-radius:8px" inputmode="numeric">
          <input type="number" id="hrQuickCajas-${client.id}" value="${numVal(linea?.cajas) > 0 ? formatQty(linea.cajas) : ''}" min="0" step="1" placeholder="Cajas" oninput="queueQuickHojaLineSave(${client.id})" style="width:96px;text-align:right;padding:6px 8px;font-size:12px;border-radius:8px" inputmode="numeric">
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

function renderComercialQuickSearchSection() {
  return `<div style="padding:12px 14px 6px;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Buscar cliente</div>
    <div style="padding:0 0 10px">
      <div class="search-bar" style="margin:0 0 10px">
        <input type="search" id="hrQuickClientSearch" placeholder="Buscar cliente por nombre, direccion o ruta..." value="${esc(hrQuickClientSearchQuery)}" oninput="setHrQuickClientSearch(this.value)">
      </div>
      <div id="hrQuickSearchResults">${renderComercialQuickSearchResults()}</div>
    </div>`;
}

async function saveQuickHojaLine(clientId) {
  const client = clients.find(c => c.id === parseInt(clientId, 10));
  if (!client || !client.ruta_id) return;

  const carrosInput = document.getElementById(`hrQuickCarros-${clientId}`);
  const cajasInput = document.getElementById(`hrQuickCajas-${clientId}`);
  if (!carrosInput || !cajasInput) return;

  const carros = numVal(carrosInput.value);
  const cajas = numVal(cajasInput.value);
  const existing = getQuickHojaAndLineaForClient(clientId);

  if (carros <= 0 && cajas <= 0 && !existing.linea) {
    return;
  }

  try {
    let hoja = existing.hoja;
    let linea = existing.linea;

    if (!hoja) {
      const created = await api('hojas-ruta', 'POST', { ruta_id: client.ruta_id, fecha: getHrDate() });
      hoja = await api('hojas-ruta/' + created.id);
      linea = (hoja.lineas || []).find(l => parseInt(l.client_id, 10) === client.id) || null;
    }

    if (!linea) {
      await api('hojas-ruta/' + hoja.id + '/lineas', 'POST', {
        client_id: client.id,
        comercial_id: pickClientCommercialId(client, getUserComercialIds()),
        carros: 0,
        cajas: 0,
        zona: client.addr || '',
        observaciones: '',
      });
      hoja = await api('hojas-ruta/' + hoja.id);
      linea = (hoja.lineas || []).find(l => parseInt(l.client_id, 10) === client.id) || null;
    }

    if (!linea) throw new Error('No se pudo preparar la linea del cliente');

    await api('hojas-ruta/' + hoja.id + '/lineas/' + linea.id, 'PUT', {
      carros,
      cajas,
    });

    await loadHojasRuta();
  } catch (e) {
    showToast('Error guardando cliente: ' + e.message);
  }
}

function getSidebarWidthBounds(mainEl) {
  const mainWidth = mainEl?.getBoundingClientRect().width || window.innerWidth;
  const minWidth = 320;
  const maxWidth = Math.max(minWidth, Math.min(760, Math.round(mainWidth - 280)));
  return { minWidth, maxWidth };
}

function clampSidebarWidth(width, mainEl) {
  const { minWidth, maxWidth } = getSidebarWidthBounds(mainEl);
  return Math.min(Math.max(Math.round(width), minWidth), maxWidth);
}

function syncMapAfterSidebarResize() {
  if (!map) return;
  window.requestAnimationFrame(() => map.invalidateSize());
}

function applySidebarWidth(width, mainEl) {
  const nextWidth = clampSidebarWidth(width, mainEl);
  document.documentElement.style.setProperty('--sidebar-width', nextWidth + 'px');
  return nextWidth;
}

function initMainResizer() {
  const mainEl = document.getElementById('appMain');
  const resizerEl = document.getElementById('mainResizer');
  if (!mainEl || !resizerEl) return;

  try {
    const savedWidth = parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || '', 10);
    if (savedWidth) {
      applySidebarWidth(savedWidth, mainEl);
      syncMapAfterSidebarResize();
    }
  } catch (e) { /* localStorage no disponible */ }

  let isDragging = false;

  const updateWidthFromPointer = (clientX) => {
    const rect = mainEl.getBoundingClientRect();
    const nextWidth = applySidebarWidth(clientX - rect.left, mainEl);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch (e) { /* ignorar */ }
    syncMapAfterSidebarResize();
  };

  const stopDragging = (pointerId) => {
    if (!isDragging) return;
    isDragging = false;
    mainEl.classList.remove('resizing');
    if (pointerId !== undefined && resizerEl.hasPointerCapture?.(pointerId)) {
      resizerEl.releasePointerCapture(pointerId);
    }
    syncMapAfterSidebarResize();
  };

  resizerEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    mainEl.classList.add('resizing');
    resizerEl.setPointerCapture?.(e.pointerId);
    updateWidthFromPointer(e.clientX);
    e.preventDefault();
  });

  resizerEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    updateWidthFromPointer(e.clientX);
  });

  resizerEl.addEventListener('pointerup', (e) => stopDragging(e.pointerId));
  resizerEl.addEventListener('pointercancel', (e) => stopDragging(e.pointerId));
  resizerEl.addEventListener('dblclick', () => {
    const resetWidth = applySidebarWidth(400, mainEl);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(resetWidth));
    } catch (e) { /* ignorar */ }
    syncMapAfterSidebarResize();
  });

  window.addEventListener('resize', () => {
    const currentWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10) || 400;
    applySidebarWidth(currentWidth, mainEl);
    syncMapAfterSidebarResize();
  });
}

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
  const route = rutas.find(r => r.id == rutaId);
  const explicitColor = normalizeHexColor(route?.color);
  if (explicitColor) return explicitColor;

  const rIdx = rutas.findIndex(r => r.id == rutaId);
  return rIdx >= 0 ? RUTA_COLORS[rIdx % RUTA_COLORS.length] : '#85725e';
}

// Devuelve el id de ruta que se usara para colorear al cliente.
// Prioriza la asignacion N:M (c.rutas[]) sobre el legacy c.ruta_id, y entre
// varias rutas escoge la que tenga menor indice en el array global `rutas`,
// para que dos clientes de la misma ruta siempre salgan del mismo color.
function pickClientRutaIdForColor(c) {
  if (c && Array.isArray(c.rutas) && c.rutas.length) {
    let bestId = null;
    let bestIdx = Infinity;
    c.rutas.forEach(r => {
      const idx = rutas.findIndex(gr => gr.id == r.id);
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx;
        bestId = r.id;
      }
    });
    if (bestId !== null) return bestId;
  }
  return c && c.ruta_id ? c.ruta_id : null;
}

// Devuelve los colores de todas las rutas asociadas al cliente, ordenados por
// el orden global de rutas, para poder pintar marcadores divididos.
function getClientRouteColors(c) {
  const routeItems = [];

  if (c && Array.isArray(c.rutas)) {
    c.rutas.forEach(r => {
      const id = parseInt(r.id, 10);
      if (Number.isFinite(id) && !routeItems.some(item => item.id === id)) {
        routeItems.push({ id, color: r.color || null });
      }
    });
  }

  const legacyId = parseInt(c?.ruta_id, 10);
  if (Number.isFinite(legacyId) && !routeItems.some(item => item.id === legacyId)) {
    routeItems.push({ id: legacyId, color: null });
  }

  const routeOrder = Array.isArray(rutas) ? rutas : [];
  routeItems.sort((a, b) => {
    const ai = routeOrder.findIndex(r => r.id == a.id);
    const bi = routeOrder.findIndex(r => r.id == b.id);
    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
  });

  return routeItems.map(item => normalizeHexColor(item.color) || getRutaColor(item.id)).filter(Boolean);
}

async function loadRutas() {
  try { rutas = await api('rutas'); } catch (e) { rutas = []; }
  return rutas;
}

async function loadVehicles() {
  try { vehicles = await api('vehicles'); } catch (e) { vehicles = []; }
}

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

// ── TABS ───────────────────────────────────────────────────
function switchTab(t) {
  document.getElementById('vc').style.display = t === 'c' ? 'flex' : 'none';
  document.getElementById('vhr').style.display = t === 'hr' ? 'flex' : 'none';
  document.getElementById('vf').style.display = t === 'f' ? 'flex' : 'none';
  document.getElementById('vh').style.display = t === 'h' ? 'flex' : 'none';
  const vu = document.getElementById('vu');
  if (vu) vu.style.display = t === 'u' ? 'flex' : 'none';
  document.getElementById('tab-c').classList.toggle('active', t === 'c');
  document.getElementById('tab-hr').classList.toggle('active', t === 'hr');
  document.getElementById('tab-f').classList.toggle('active', t === 'f');
  document.getElementById('tab-h').classList.toggle('active', t === 'h');
  const tabU = document.getElementById('tab-u');
  if (tabU) tabU.classList.toggle('active', t === 'u');
  document.querySelector('.optimize-bar').style.display = 'none';
  if (t === 'f') renderFleetLists();
  if (t === 'h') { loadHistory(); loadDashboard(); }
  if (t === 'hr') loadHojasRuta();
  if (t === 'u') loadUsers();
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

async function openClientModal(id = null) {
  const c = id ? clients.find(x => x.id === id) : null;
  document.getElementById('cModalTitle').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('cId').value = id || '';
  document.getElementById('cName').value  = c?.name  || '';
  document.getElementById('cAddr').value  = c?.addr  || '';
  document.getElementById('cPostcode').value = c?.postcode || '';
  document.getElementById('cPhone').value = c?.phone || '';
  document.getElementById('cNotes').value = c?.notes || '';
  document.getElementById('cX').value    = c?.x ?? '';
  document.getElementById('cY').value    = c?.y ?? '';
  // Rutas checkboxes (N:M)
  const clientRutaIds = c ? c.rutas.map(r => r.id) : [];
  const rutasGrid = document.getElementById('cRutasGrid');
  rutasGrid.innerHTML = rutas.map(r => {
    const checked = clientRutaIds.includes(r.id) ? 'checked' : '';
    const color = normalizeHexColor(r.color) || getRutaColor(r.id);
    return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;padding:3px 8px;border:1px solid ' + color + '44;border-radius:6px;background:' + color + '14;white-space:nowrap">' +
      '<input type="checkbox" class="cRutaCb" value="' + r.id + '" ' + checked + ' style="width:auto;margin:0">' +
      '<span style="display:inline-flex;align-items:center;gap:6px;min-width:0">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';border:1px solid rgba(0,0,0,0.12);flex-shrink:0"></span>' +
        '<span>' + esc(r.name) + '</span>' +
      '</span>' +
    '</label>';
  }).join('');
  await loadComerciales();
  const comSel = document.getElementById('cComercial');
  if (comSel) {
    comSel.innerHTML = '<option value="">Sin comercial</option>' + comerciales.map(com => '<option value="' + com.id + '"' + (c?.comercial_id == com.id ? ' selected' : '') + '>' + esc(com.name) + '</option>').join('');
  }
  // Al contado
  document.getElementById('cContado').checked = c?.al_contado || false;
  // Horario semanal editable
  buildScheduleGrid(c);
  updateClientPostcodeHint();
  await loadClientGlsHistory(id);

  const toggleBtn = document.getElementById('cToggleBtn');
  const deleteBtn = document.getElementById('cDeleteBtn');
  const duplicateBtn = document.getElementById('cDuplicateBtn');
  if (c) {
    toggleBtn.style.display = '';
    toggleBtn.textContent = c.active ? 'Desactivar' : 'Activar';
    toggleBtn.className = 'btn ' + (c.active ? 'btn-danger' : 'btn-success');
    deleteBtn.style.display = '';
    duplicateBtn.style.display = '';
  } else {
    toggleBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
    duplicateBtn.style.display = 'none';
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
async function duplicateFromModal() {
  const id = parseInt(document.getElementById('cId').value);
  if (!id) return;
  try {
    const newClient = await api('clients/' + id + '/duplicate', 'POST');
    showToast('Cliente duplicado como "' + newClient.name + '"');
    closeCModal();
    await loadClients();
    refreshAll();
    openClientModal(newClient.id);
  } catch (e) {
    showToast('Error duplicando: ' + e.message);
  }
}
async function deleteFromModal() {
  const id = parseInt(document.getElementById('cId').value);
  if (!id) return;
  const c = clients.find(x => x.id === id);
  if (!await appConfirm('¿Eliminar el cliente <b>' + esc(c?.name || id) + '</b>?<br><span style="font-size:11px;color:var(--text-dim)">Esta accion no se puede deshacer.</span>', { title: 'Eliminar cliente', okText: 'Eliminar' })) return;
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

function updateClientPostcodeHint() {
  const hint = document.getElementById('cPostcodeHint');
  const value = (document.getElementById('cPostcode')?.value || '').trim();
  if (!hint) return;
  hint.textContent = value
    ? 'Este codigo postal se usara para cotizar paqueteria.'
    : 'Sin codigo postal no se puede cotizar paqueteria.';
  hint.style.color = value ? 'var(--accent)' : 'var(--text-dim)';
}

async function loadClientGlsHistory(id) {
  const el = document.getElementById('cGlsHistory');
  if (!el) return;

  if (!id) {
    el.innerHTML = 'Sin historial de comparativa todavia.';
    return;
  }

  el.innerHTML = '<div class="rent-note">Cargando historial de paqueteria...</div>';
  try {
    const rows = await api('shipping-costs/client/' + id);
    if (!rows.length) {
      el.innerHTML = 'Sin historial de comparativa todavia.';
      return;
    }

    el.innerHTML = `<div style="overflow:auto">
      <table class="history-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Carros</th>
            <th>Cajas</th>
            <th>Km</th>
            <th>Propio</th>
            <th>Paqueteria</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 10).map(row => {
            const meta = glsRecommendationMeta(row.recommendation);
            return `<tr>
              <td>${esc(row.fecha)}</td>
              <td>${formatQty(row.carros)}</td>
              <td>${formatQty(row.cajas)}</td>
              <td>${row.detour_km !== null && row.detour_km !== undefined ? formatQty(row.detour_km) : '—'}</td>
              <td>${row.cost_own_route !== null && row.cost_own_route !== undefined ? formatMoney(row.cost_own_route) : '—'}</td>
              <td>${row.cost_gls_adjusted !== null && row.cost_gls_adjusted !== undefined ? formatMoney(row.cost_gls_adjusted) : '—'}</td>
              <td><span class="rent-badge ${meta.cls}">${meta.label}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  } catch (e) {
    el.innerHTML = '<div class="rent-note">No se pudo cargar el historial de paqueteria.</div>';
  }
}

async function saveClient() {
  const name = document.getElementById('cName').value.trim();
  const x = parseFloat(document.getElementById('cX').value);
  const y = parseFloat(document.getElementById('cY').value);
  if (!name || isNaN(x) || isNaN(y)) { showToast('Nombre y coordenadas son obligatorios'); return; }

  const schedule = collectScheduleData();

  // Use Monday as fallback for open_time/close_time
  const mon = schedule[0] || [];
  const rutaIds = Array.from(document.querySelectorAll('.cRutaCb:checked')).map(cb => parseInt(cb.value));
  const comercialVal = document.getElementById('cComercial')?.value;
  const data = {
    name,
    address: document.getElementById('cAddr').value.trim(),
    postcode: document.getElementById('cPostcode').value.trim(),
    phone: document.getElementById('cPhone').value.trim(),
    notes: document.getElementById('cNotes').value.trim(),
    x, y,
    open_time: mon[0]?.open_time || '09:00',
    close_time: mon[0]?.close_time || '18:00',
    open_time_2: mon[1]?.open_time || '',
    close_time_2: mon[1]?.close_time || '',
    comercial_id: comercialVal ? parseInt(comercialVal, 10) : null,
    ruta_id: rutaIds.length ? rutaIds[0] : null,
    ruta_ids: rutaIds,
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
  if (!await appConfirm('Eliminar cliente?<br><span style="font-size:11px;color:var(--text-dim)">Se borraran tambien sus pedidos.</span>', { title: 'Eliminar cliente', okText: 'Eliminar' })) return;
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
function closePModal() { closeModal('pModal'); }

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
        (c.rutas && c.rutas.length ? c.rutas.map(r => {
          const color = normalizeHexColor(r.color) || getRutaColor(r.id);
          const textColor = getReadableTextColor(color);
          return '<span class="pill" style="border-color:' + color + '66;color:' + textColor + ';background:' + color + '18">' + r.name + '</span>';
        }).join('') : '') +
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
  if (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial') return;
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
    vl.innerHTML = vehicles.map((v, index) => {
      const active = parseInt(v.active);
      const caps = [];
      if (v.max_weight_kg) caps.push(parseFloat(v.max_weight_kg) + ' kg');
      if (v.max_volume_m3) caps.push(parseFloat(v.max_volume_m3) + ' m3');
      if (v.max_items) caps.push(v.max_items + ' items');
      return '<div class="client-card' + (!active ? ' inactive' : '') + '" onclick="openVehicleModal(' + v.id + ')">' +
        '<div class="card-top">' +
          '<div class="cnum order">V' + (index + 1) + '</div>' +
          '<div class="cname">' + v.name + '</div>' +
        '</div>' +
        (v.plate ? '<div class="card-sub"><span class="card-addr">' + esc(v.plate) + '</span></div>' : '') +
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
function closeDModal() { closeModal('dModal'); }

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
function closeVModal() { closeModal('vModal'); }

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
// (openSettingsModal definida mas abajo en la seccion de catalogo de paqueteria)
function closeSettingsModal() { closeModal('settingsModal'); }

async function saveSettings() {
  try {
    await api('settings', 'PUT', {
      lunch_duration_min: document.getElementById('sLunchDur').value,
      lunch_earliest: document.getElementById('sLunchEarly').value,
      lunch_latest: document.getElementById('sLunchLate').value,
      base_unload_min: document.getElementById('sBaseUnload').value,
      default_speed_kmh: document.getElementById('sSpeed').value,
    });

    if (typeof APP_USER !== 'undefined' && APP_USER.role === 'admin') {
      await api('shipping-config', 'PUT', {
        origin_postcode: document.getElementById('shipOriginPostcode').value.trim(),
        origin_country: document.getElementById('shipOriginCountry').value.trim().toUpperCase(),
        price_multiplier: document.getElementById('shipPriceMultiplier').value || '1.0000',
        gls_fuel_pct_current: document.getElementById('shipFuelPct').value || '0.00',
        remote_postcode_prefixes: document.getElementById('shipRemotePrefixes').value || '',
        default_weight_per_carro_kg: document.getElementById('shipWeightPerCarro').value,
        default_weight_per_caja_kg: document.getElementById('shipWeightPerCaja').value,
        default_parcels_per_carro: document.getElementById('shipParcelsPerCarro').value,
        default_parcels_per_caja: document.getElementById('shipParcelsPerCaja').value,
        default_volume_per_carro_cm3: document.getElementById('shipVolumePerCarro').value,
        default_volume_per_caja_cm3: document.getElementById('shipVolumePerCaja').value,
        use_volumetric_weight: document.getElementById('shipUseVolumetric').checked ? 1 : 0,
      });
    }

    closeSettingsModal();
    showToast('Configuracion guardada');
  } catch (e) { showToast('Error: ' + e.message); }
}

function applyShippingConfigToForm(gls) {
  const isAdmin = typeof APP_USER !== 'undefined' && APP_USER.role === 'admin';
  const defaults = gls || {
    origin_postcode: '',
    origin_country: 'ES',
    price_multiplier: '1.0000',
    gls_fuel_pct_current: '0.00',
    remote_postcode_prefixes: '',
    default_weight_per_carro_kg: '5.00',
    default_weight_per_caja_kg: '2.50',
    default_parcels_per_carro: '1.00',
    default_parcels_per_caja: '1.00',
    default_volume_per_carro_cm3: '0.00',
    default_volume_per_caja_cm3: '0.00',
    use_volumetric_weight: 0,
  };

  document.getElementById('shipOriginPostcode').value = defaults.origin_postcode || '';
  document.getElementById('shipOriginCountry').value = defaults.origin_country || 'ES';
  document.getElementById('shipPriceMultiplier').value = defaults.price_multiplier || '1.0000';
  document.getElementById('shipFuelPct').value = defaults.gls_fuel_pct_current || '0.00';
  document.getElementById('shipRemotePrefixes').value = defaults.remote_postcode_prefixes || '';
  document.getElementById('shipWeightPerCarro').value = defaults.default_weight_per_carro_kg || '5.00';
  document.getElementById('shipWeightPerCaja').value = defaults.default_weight_per_caja_kg || '2.50';
  document.getElementById('shipParcelsPerCarro').value = defaults.default_parcels_per_carro || '1.00';
  document.getElementById('shipParcelsPerCaja').value = defaults.default_parcels_per_caja || '1.00';
  document.getElementById('shipVolumePerCarro').value = defaults.default_volume_per_carro_cm3 || '0.00';
  document.getElementById('shipVolumePerCaja').value = defaults.default_volume_per_caja_cm3 || '0.00';
  document.getElementById('shipUseVolumetric').checked = !!parseInt(defaults.use_volumetric_weight || 0, 10);

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
    document.getElementById('vSpeed').value = appSettings.default_speed_kmh || 50;
    document.getElementById('vBaseUnload').value = appSettings.base_unload_min || 5;
    document.getElementById('vLunchDur').value = appSettings.lunch_duration_min || 60;
    document.getElementById('vLunchEarly').value = appSettings.lunch_earliest || '12:00';
    document.getElementById('vLunchLate').value = appSettings.lunch_latest || '15:30';

    // GLS
    document.getElementById('vGlsOriginCp').value = glsConfig.origin_postcode || '';
    document.getElementById('vGlsOriginCountry').value = glsConfig.origin_country || 'ES';
    document.getElementById('vGlsMultiplier').value = glsConfig.price_multiplier || '1.0000';
    document.getElementById('vGlsFuelPct').value = glsConfig.gls_fuel_pct_current || '0.00';
    document.getElementById('vGlsRemotePrefixes').value = glsConfig.remote_postcode_prefixes || '';
    document.getElementById('vGlsKgCarro').value = glsConfig.default_weight_per_carro_kg || '5.00';
    document.getElementById('vGlsKgCaja').value = glsConfig.default_weight_per_caja_kg || '2.50';
    document.getElementById('vGlsParcCarro').value = glsConfig.default_parcels_per_carro || '1.00';
    document.getElementById('vGlsParcCaja').value = glsConfig.default_parcels_per_caja || '1.00';
    document.getElementById('vGlsVolCarro').value = glsConfig.default_volume_per_carro_cm3 || '0';
    document.getElementById('vGlsVolCaja').value = glsConfig.default_volume_per_caja_cm3 || '0';
    document.getElementById('vGlsUseVol').value = parseInt(glsConfig.use_volumetric_weight || 0, 10) ? '1' : '0';

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
    // 1. App settings
    await api('settings', 'PUT', {
      default_speed_kmh: document.getElementById('vSpeed').value,
      base_unload_min: document.getElementById('vBaseUnload').value,
      lunch_duration_min: document.getElementById('vLunchDur').value,
      lunch_earliest: document.getElementById('vLunchEarly').value,
      lunch_latest: document.getElementById('vLunchLate').value,
    });

    // 2. GLS config
    await api('shipping-config', 'PUT', {
      origin_postcode: document.getElementById('vGlsOriginCp').value.trim(),
      origin_country: document.getElementById('vGlsOriginCountry').value.trim().toUpperCase(),
      price_multiplier: document.getElementById('vGlsMultiplier').value || '1.0000',
      gls_fuel_pct_current: document.getElementById('vGlsFuelPct').value || '0.00',
      remote_postcode_prefixes: document.getElementById('vGlsRemotePrefixes').value || '',
      default_weight_per_carro_kg: document.getElementById('vGlsKgCarro').value,
      default_weight_per_caja_kg: document.getElementById('vGlsKgCaja').value,
      default_parcels_per_carro: document.getElementById('vGlsParcCarro').value,
      default_parcels_per_caja: document.getElementById('vGlsParcCaja').value,
      default_volume_per_carro_cm3: document.getElementById('vGlsVolCarro').value,
      default_volume_per_caja_cm3: document.getElementById('vGlsVolCaja').value,
      use_volumetric_weight: document.getElementById('vGlsUseVol').value === '1' ? 1 : 0,
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
          delegation_id: veh.delegation_id || null,
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

// ── INFORME DE RENTABILIDAD GLS ──
function openRentabilityReport() {
  const today = todayStr();
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const fromStr = monthAgo.toISOString().slice(0, 10);

  document.getElementById('rentFrom').value = fromStr;
  document.getElementById('rentTo').value = today;
  document.getElementById('rentReportContent').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">Pulsa "Calcular" para generar el informe.</div>';
  document.getElementById('rentReportModal').classList.add('open');
}

function closeRentabilityReport() {
  document.getElementById('rentReportModal').classList.remove('open');
}

async function loadRentabilityReport() {
  const from = document.getElementById('rentFrom').value;
  const to = document.getElementById('rentTo').value;
  if (!from || !to) return showToast('Selecciona fechas');

  const el = document.getElementById('rentReportContent');
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">Cargando...</div>';

  try {
    const r = await api(`shipping-costs/range-report?from=${from}&to=${to}`);
    renderRentabilityReport(r);
  } catch (e) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);text-align:center">Error: ' + esc(e.message) + '</div>';
  }
}

function renderRentabilityReport(r) {
  const el = document.getElementById('rentReportContent');
  const t = r.totals || {};
  const entregas = parseInt(t.entregas || 0);

  if (!entregas) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-dim)">
      No hay datos de coste calculados en el rango ${esc(r.from)} a ${esc(r.to)}.<br>
      <span style="font-size:10px">Calcula la paqueteria de las hojas primero (boton "Calcular paqueteria" en cada hoja).</span>
    </div>`;
    return;
  }

  const totalKm = numVal(t.total_km);
  const totalOwn = numVal(t.total_own);
  const totalGls = numVal(t.total_gls);
  const ahorro = numVal(t.ahorro_potencial);
  const nExt = parseInt(t.n_externalize || 0);
  const nOwn = parseInt(t.n_own || 0);
  const pctExt = entregas > 0 ? Math.round(100 * nExt / entregas) : 0;

  let html = '';

  // ── Resumen totales ──
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
    <div style="padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;color:var(--text-dim)">Entregas</div>
      <div style="font-size:20px;font-weight:800">${entregas}</div>
    </div>
    <div style="padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;color:var(--text-dim)">Total km flota</div>
      <div style="font-size:20px;font-weight:800">${formatQty(totalKm)}</div>
    </div>
    <div style="padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;color:var(--text-dim)">Coste flota propia</div>
      <div style="font-size:20px;font-weight:800;color:var(--accent3)">${formatMoney(totalOwn)}</div>
    </div>
    <div style="padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;color:var(--text-dim)">Coste GLS estimado</div>
      <div style="font-size:20px;font-weight:800;color:var(--accent2)">${formatMoney(totalGls)}</div>
    </div>
    <div style="padding:10px;background:rgba(45,125,45,0.1);border:1px solid #2d7d2d;border-radius:8px">
      <div style="font-size:10px;color:#2d7d2d">Ahorro potencial si se externaliza lo barato</div>
      <div style="font-size:20px;font-weight:800;color:#2d7d2d">${formatMoney(ahorro)}</div>
    </div>
  </div>`;

  html += `<div style="margin-bottom:10px;font-size:11px;color:var(--text-dim)">
    <b>${nExt}</b> entregas (${pctExt}%) saldrian mas baratas por GLS · <b>${nOwn}</b> mejor en flota propia
  </div>`;

  // ── Por dia ──
  if (r.daily && r.daily.length) {
    html += '<div style="font-weight:700;margin:14px 0 6px;color:var(--accent)">Por dia</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--surface)">'
      + '<th style="padding:5px;text-align:left;border-bottom:1px solid var(--border)">Fecha</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Entregas</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Km</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Flota</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">GLS</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Ahorro</th>'
      + '</tr></thead><tbody>';
    r.daily.forEach(d => {
      html += `<tr>
        <td style="padding:4px 5px;border-bottom:1px solid var(--border)">${esc(d.fecha)}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${d.entregas}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatQty(numVal(d.total_km))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(d.total_own))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(d.total_gls))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);color:#2d7d2d;font-weight:700">${formatMoney(numVal(d.ahorro_potencial))}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  // ── Por ruta ──
  if (r.by_ruta && r.by_ruta.length) {
    html += '<div style="font-weight:700;margin:14px 0 6px;color:var(--accent)">Por ruta comercial</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--surface)">'
      + '<th style="padding:5px;text-align:left;border-bottom:1px solid var(--border)">Ruta</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Entregas</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Km flota</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Flota</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">GLS</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Ahorro</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">% Ext</th>'
      + '</tr></thead><tbody>';
    r.by_ruta.forEach(ru => {
      const pct = ru.entregas > 0 ? Math.round(100 * ru.n_externalize / ru.entregas) : 0;
      html += `<tr>
        <td style="padding:4px 5px;border-bottom:1px solid var(--border)"><b>${esc(ru.ruta_name)}</b></td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${ru.entregas}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatQty(numVal(ru.total_km))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(ru.total_own))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(ru.total_gls))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);color:#2d7d2d;font-weight:700">${formatMoney(numVal(ru.ahorro_potencial))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${pct}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  // ── Top clientes ──
  if (r.top_externalize && r.top_externalize.length) {
    html += '<div style="font-weight:700;margin:14px 0 6px;color:var(--accent)">Top 25 clientes a externalizar (mas ahorro)</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--surface)">'
      + '<th style="padding:5px;text-align:left;border-bottom:1px solid var(--border)">#</th>'
      + '<th style="padding:5px;text-align:left;border-bottom:1px solid var(--border)">Cliente</th>'
      + '<th style="padding:5px;text-align:left;border-bottom:1px solid var(--border)">CP</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Entregas</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Km medio</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Flota</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">GLS</th>'
      + '<th style="padding:5px;text-align:right;border-bottom:1px solid var(--border)">Ahorro</th>'
      + '</tr></thead><tbody>';
    r.top_externalize.forEach((c, i) => {
      html += `<tr>
        <td style="padding:4px 5px;border-bottom:1px solid var(--border);color:var(--text-dim)">${i+1}</td>
        <td style="padding:4px 5px;border-bottom:1px solid var(--border)"><b>${esc(c.client_name)}</b></td>
        <td style="padding:4px 5px;border-bottom:1px solid var(--border)">${esc(c.postcode || '')}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${c.entregas}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatQty(numVal(c.avg_km))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(c.total_own))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border)">${formatMoney(numVal(c.total_gls))}</td>
        <td style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);color:#2d7d2d;font-weight:700">${formatMoney(numVal(c.ahorro_potencial))}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  el.innerHTML = html;
}

async function loadShippingAlerts() {
  const el = document.getElementById('shippingAlertsContent');
  if (!el) return;
  el.innerHTML = 'Cargando alertas...';
  try {
    const data = await api('shipping-config/alerts');
    const stats = data.stats || {};
    const unmapped = data.unmapped_postcodes || [];

    let html = '';
    html += `<div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap">`;
    html += `<span><b>${stats.total_clientes || 0}</b> clientes activos</span>`;
    if (stats.sin_cp) html += `<span style="color:var(--danger)"><b>${stats.sin_cp}</b> sin codigo postal</span>`;
    if (stats.sin_coords) html += `<span style="color:var(--accent2)"><b>${stats.sin_coords}</b> sin coordenadas</span>`;
    html += `</div>`;

    if (unmapped.length === 0) {
      html += '<div style="color:#2d7d2d">✓ Todos los CP de clientes activos tienen zona GLS asignada.</div>';
    } else {
      html += `<div style="color:var(--danger);font-weight:700;margin-bottom:4px">⚠ ${unmapped.length} codigos postales sin zona GLS:</div>`;
      html += '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px">';
      unmapped.forEach(u => {
        html += `<div style="padding:3px 6px;border-bottom:1px solid var(--border);font-size:10px">`
          + `<b>${esc(u.postcode)}</b> · ${u.num_clientes} cliente${u.num_clientes > 1 ? 's' : ''}`
          + (u.ejemplos ? ` · <span style="color:var(--text-dim)">${esc(u.ejemplos)}</span>` : '')
          + `</div>`;
      });
      html += '</div>';
      html += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">Anade prefijos en la tabla de tarifas para que estos CP tengan zona asignada.</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="color:var(--danger)">Error cargando alertas: ' + esc(e.message) + '</div>';
  }
}

function renderShippingRatesList() {
  const el = document.getElementById('shippingRatesList');
  if (!el) return;

  if (typeof APP_USER === 'undefined' || APP_USER.role !== 'admin') {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Solo admin puede editar tarifas.</div>';
    return;
  }

  if (!shippingRates.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Sin tarifas cargadas todavia.</div>';
    return;
  }

  el.innerHTML = shippingRates.map(rate => {
    const prefix = rate.postcode_prefix ? `CP ${esc(rate.postcode_prefix)}*` : 'Todos los CP';
    const parcels = (rate.parcel_min !== null || rate.parcel_max !== null)
      ? ` · bultos ${rate.parcel_min ?? 0}-${rate.parcel_max ?? '∞'}`
      : '';
    const service = rate.service_name ? ` · ${esc(rate.service_name)}` : '';
    const status = parseInt(rate.active, 10) ? '<span class="pill open">Activa</span>' : '<span class="pill closed">Inactiva</span>';
    return `<div class="client-card" style="padding:8px 10px;margin-bottom:6px;cursor:default">
      <div class="card-top">
        <div class="cname">${esc(rate.carrier_name)} <span style="font-size:10px;color:var(--text-dim)">(${esc(rate.carrier_code)})</span></div>
        <div class="card-actions" style="opacity:1">
          <button class="icon-btn" onclick="openShippingRateModal(${rate.id})" title="Editar">&#9998;</button>
          <button class="icon-btn danger" onclick="deleteShippingRate(${rate.id})" title="Eliminar">&times;</button>
        </div>
      </div>
      <div class="card-sub">
        <span>${prefix}</span>
        <span>${esc(formatQty(rate.weight_min_kg))}-${esc(formatQty(rate.weight_max_kg))} kg${parcels}</span>
        <span>${esc(formatMoney(rate.price))}</span>
      </div>
      <div class="pills">
        ${status}
        <span class="pill">${esc(rate.country_code || 'ES')}${service}</span>
        <span class="pill">Prioridad ${esc(String(rate.priority ?? 100))}</span>
      </div>
      ${rate.notes ? `<div class="card-sub" style="padding-left:0;margin-top:6px">${esc(rate.notes)}</div>` : ''}
    </div>`;
  }).join('');
}

function openShippingRateModal(rateId = null) {
  const rate = rateId ? shippingRates.find(r => parseInt(r.id, 10) === parseInt(rateId, 10)) : null;
  document.getElementById('shippingRateModalTitle').textContent = rate ? 'Editar tarifa' : 'Nueva tarifa';
  document.getElementById('shippingRateId').value = rate ? rate.id : '';
  document.getElementById('shippingCarrierCode').value = rate?.carrier_code || '';
  document.getElementById('shippingCarrierName').value = rate?.carrier_name || '';
  document.getElementById('shippingServiceName').value = rate?.service_name || '';
  document.getElementById('shippingCountryCode').value = rate?.country_code || 'ES';
  document.getElementById('shippingPostcodePrefix').value = rate?.postcode_prefix || '';
  document.getElementById('shippingWeightMin').value = rate ? formatQty(rate.weight_min_kg) : '0';
  document.getElementById('shippingWeightMax').value = rate ? formatQty(rate.weight_max_kg) : '1';
  document.getElementById('shippingParcelMin').value = rate?.parcel_min ?? '';
  document.getElementById('shippingParcelMax').value = rate?.parcel_max ?? '';
  document.getElementById('shippingPrice').value = rate ? numVal(rate.price) : '';
  document.getElementById('shippingPriority').value = rate?.priority ?? 100;
  document.getElementById('shippingActive').checked = rate ? !!parseInt(rate.active, 10) : true;
  document.getElementById('shippingNotes').value = rate?.notes || '';
  document.getElementById('shippingDeleteBtn').style.display = rate ? '' : 'none';
  document.getElementById('shippingRateModal').classList.add('open');
}

function closeShippingRateModal() { closeModal('shippingRateModal'); }

async function saveShippingRate() {
  const rateId = document.getElementById('shippingRateId').value;
  const payload = {
    carrier_code: document.getElementById('shippingCarrierCode').value.trim().toUpperCase(),
    carrier_name: document.getElementById('shippingCarrierName').value.trim(),
    service_name: document.getElementById('shippingServiceName').value.trim(),
    country_code: document.getElementById('shippingCountryCode').value.trim().toUpperCase(),
    postcode_prefix: document.getElementById('shippingPostcodePrefix').value.trim(),
    weight_min_kg: document.getElementById('shippingWeightMin').value,
    weight_max_kg: document.getElementById('shippingWeightMax').value,
    parcel_min: document.getElementById('shippingParcelMin').value,
    parcel_max: document.getElementById('shippingParcelMax').value,
    price: document.getElementById('shippingPrice').value,
    priority: document.getElementById('shippingPriority').value,
    active: document.getElementById('shippingActive').checked ? 1 : 0,
    notes: document.getElementById('shippingNotes').value.trim(),
  };

  try {
    const saved = rateId
      ? await api('shipping-rates/' + rateId, 'PUT', payload)
      : await api('shipping-rates', 'POST', payload);

    if (rateId) {
      shippingRates = shippingRates.map(rate => parseInt(rate.id, 10) === parseInt(rateId, 10) ? saved : rate);
    } else {
      shippingRates.push(saved);
    }

    shippingRates.sort((a, b) => {
      const activeCmp = parseInt(b.active, 10) - parseInt(a.active, 10);
      if (activeCmp !== 0) return activeCmp;
      const carrierCmp = (a.carrier_name || '').localeCompare(b.carrier_name || '', 'es');
      if (carrierCmp !== 0) return carrierCmp;
      return numVal(a.weight_min_kg) - numVal(b.weight_min_kg);
    });

    renderShippingRatesList();
    closeShippingRateModal();
    showToast(rateId ? 'Tarifa actualizada' : 'Tarifa creada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteShippingRate(rateId = null) {
  const id = rateId || document.getElementById('shippingRateId').value;
  if (!id) return;
  if (!await appConfirm('¿Eliminar esta tarifa?', { title: 'Eliminar tarifa', okText: 'Eliminar' })) return;

  try {
    await api('shipping-rates/' + id, 'DELETE');
    shippingRates = shippingRates.filter(rate => parseInt(rate.id, 10) !== parseInt(id, 10));
    renderShippingRatesList();
    closeShippingRateModal();
    showToast('Tarifa eliminada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
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
  if (!await appConfirm('¿Eliminar esta plantilla?', { title: 'Eliminar plantilla', okText: 'Eliminar' })) return;
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
function getRentabilityDate() {
  return document.getElementById('rentDate')?.value || todayStr();
}

function setRentabilityToday() {
  const input = document.getElementById('rentDate');
  if (input) input.value = todayStr();
  onRentabilityDateChange();
}

function rentabilityDateNav(delta) {
  const d = new Date(getRentabilityDate());
  d.setDate(d.getDate() + delta);
  const input = document.getElementById('rentDate');
  if (input) input.value = d.toISOString().slice(0, 10);
  onRentabilityDateChange();
}

function onRentabilityDateChange() {
  loadRentabilityReport();
}

async function loadRentabilityReport() {
  const wrap = document.getElementById('rentabilityTableWrap');
  const summary = document.getElementById('rentabilitySummary');
  const status = document.getElementById('rentabilityStatus');
  if (!wrap || !summary) return;

  wrap.innerHTML = '<div class="empty">Cargando comparativa de costes...</div>';
  summary.innerHTML = '';
  if (status) status.textContent = '';

  try {
    rentabilityData = await api('shipping-costs/daily-report?date=' + getRentabilityDate());
    renderRentabilityPanel();
  } catch (e) {
    rentabilityData = null;
    wrap.innerHTML = '<div class="empty">Sin comparativas calculadas para esa fecha.</div>';
    if (status) status.textContent = 'Sin datos';
  }
}

async function recalculateRentability(force = true) {
  if (typeof APP_USER !== 'undefined' && APP_USER.role !== 'admin') {
    showToast('Solo admin puede recalcular toda la comparativa de paqueteria');
    return;
  }

  const status = document.getElementById('rentabilityStatus');
  if (status) status.textContent = 'Recalculando costes de paqueteria...';
  try {
    await api('shipping-costs/recalculate', 'POST', { date: getRentabilityDate(), force: force ? 1 : 0 });
    await loadRentabilityReport();
    showToast('Comparativa de paqueteria recalculada');
  } catch (e) {
    if (status) status.textContent = 'Error al recalcular';
    showToast('Error paqueteria: ' + e.message);
  }
}

function setRentabilitySort(key) {
  if (rentabilitySortKey === key) {
    rentabilitySortDir = rentabilitySortDir === 'asc' ? 'desc' : 'asc';
  } else {
    rentabilitySortKey = key;
    rentabilitySortDir = key === 'client_name' || key === 'ruta_name' ? 'asc' : 'desc';
  }
  renderRentabilityPanel();
}

function getSortedRentabilityLines() {
  const lines = Array.isArray(rentabilityData?.lines) ? [...rentabilityData.lines] : [];
  const dir = rentabilitySortDir === 'asc' ? 1 : -1;

  lines.sort((a, b) => {
    let va = a[rentabilitySortKey];
    let vb = b[rentabilitySortKey];

    if (rentabilitySortKey === 'client_name' || rentabilitySortKey === 'ruta_name' || rentabilitySortKey === 'recommendation' || rentabilitySortKey === 'client_postcode' || rentabilitySortKey === 'vehicle_name') {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    }

    va = numVal(va);
    vb = numVal(vb);
    return (va - vb) * dir;
  });

  return lines;
}

function renderRentabilityPanel() {
  const wrap = document.getElementById('rentabilityTableWrap');
  const summary = document.getElementById('rentabilitySummary');
  const status = document.getElementById('rentabilityStatus');
  if (!wrap || !summary) return;

  if (!rentabilityData || !Array.isArray(rentabilityData.lines) || !rentabilityData.lines.length) {
    summary.innerHTML = [
      rentCard('Clientes', 0),
      rentCard('Ruta propia', 0),
      rentCard('Externalizar', 0),
      rentCard('Ahorro potencial', formatMoney(0)),
    ].join('');
    wrap.innerHTML = '<div class="empty">Sin comparativas calculadas para esa fecha.</div>';
    if (status) status.textContent = 'Sin datos';
    return;
  }

  summary.innerHTML = [
    rentCard('Total clientes', rentabilityData.total_clients || 0),
    rentCard('Ruta propia', rentabilityData.recommend_own_route || 0),
    rentCard('Externalizar', rentabilityData.recommend_externalize || 0),
    rentCard('Ahorro potencial', formatMoney(rentabilityData.potential_savings || 0)),
  ].join('');

  if (status) {
    status.textContent = rentabilityData.last_calculated_at
      ? 'Ultimo calculo: ' + rentabilityData.last_calculated_at.replace(' ', ' · ')
      : 'Sin timestamp de calculo';
  }

  const lines = getSortedRentabilityLines();
  wrap.innerHTML = `<div class="rent-table-scroll">
    <table class="rent-table">
      <thead>
        <tr>
          <th onclick="setRentabilitySort('client_name')">Cliente</th>
          <th onclick="setRentabilitySort('client_postcode')">CP</th>
          <th onclick="setRentabilitySort('ruta_name')">Ruta</th>
          <th onclick="setRentabilitySort('vehicle_name')">Vehiculo</th>
          <th onclick="setRentabilitySort('carros')">Carros</th>
          <th onclick="setRentabilitySort('cajas')">Cajas</th>
          <th onclick="setRentabilitySort('detour_km')">Km desvio</th>
          <th onclick="setRentabilitySort('cost_own_route')">Coste propio</th>
          <th onclick="setRentabilitySort('cost_gls_adjusted')">Coste paqueteria</th>
          <th onclick="setRentabilitySort('savings')">Dif.</th>
          <th onclick="setRentabilitySort('recommendation')">Recomendacion</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(row => {
          const meta = glsRecommendationMeta(row.recommendation);
          const note = friendlyGlsNote(row.notes);
          const rowCls = row.recommendation === 'own_route'
            ? 'rent-row-own'
            : row.recommendation === 'externalize'
              ? 'rent-row-externalize'
              : 'rent-row-unavailable';
          const diff = row.savings_if_externalized ?? row.savings ?? 0;
          return `<tr class="${rowCls}">
            <td><b>${esc(row.client_name)}</b></td>
            <td>${esc(row.client_postcode || '—')}</td>
            <td>${esc(row.ruta_name || '—')}</td>
            <td>${esc(row.vehicle_name ? row.vehicle_name + (row.vehicle_plate ? ' · ' + row.vehicle_plate : '') : '—')}</td>
            <td>${formatQty(row.carros)}</td>
            <td>${formatQty(row.cajas)}</td>
            <td>${row.detour_km !== null && row.detour_km !== undefined ? formatQty(row.detour_km) : '—'}</td>
            <td>${row.cost_own_route !== null && row.cost_own_route !== undefined ? formatMoney(row.cost_own_route) : '—'}</td>
            <td>${row.cost_gls_adjusted !== null && row.cost_gls_adjusted !== undefined ? formatMoney(row.cost_gls_adjusted) : '—'}</td>
            <td>${(row.cost_own_route !== null && row.cost_own_route !== undefined) || (row.cost_gls_adjusted !== null && row.cost_gls_adjusted !== undefined) ? formatMoney(diff) : '—'}</td>
            <td><span class="rent-badge ${meta.cls}">${meta.label}</span></td>
            <td><span class="rent-note">${esc(note || 'OK')}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="7"><b>Totales</b></td>
          <td><b>${formatMoney(rentabilityData.total_cost_own_all || 0)}</b></td>
          <td><b>${formatMoney(rentabilityData.total_cost_gls_all || 0)}</b></td>
          <td><b>${formatMoney(rentabilityData.potential_savings || 0)}</b></td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

function rentCard(label, value) {
  return `<div class="rent-card">
    <div class="rent-card-label">${esc(label)}</div>
    <div class="rent-card-value">${esc(String(value))}</div>
  </div>`;
}

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
function getHrDate() { return document.getElementById('hrDate').value || todayStr(); }
function setHrToday() { document.getElementById('hrDate').value = todayStr(); onHrDateChange(); }
function hrDateNav(delta) {
  const d = new Date(getHrDate());
  d.setDate(d.getDate() + delta);
  document.getElementById('hrDate').value = d.toISOString().slice(0, 10);
  onHrDateChange();
}
async function onHrDateChange() {
  await loadHojasRuta();
  if (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial') {
    await loadComercialPedidos();
  }
}

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
  updateHojasRutaBadge();
  loadPedidosResumen();
}

function updateHojasRutaBadge() {
  const badge = document.getElementById('bhr');
  if (!badge) return;

  const borradorCount = hojasData.hojas.filter(h => h.estado === 'borrador').length;
  const cerradaCount = hojasData.hojas.filter(h => h.estado === 'cerrada').length;
  const otherCount = hojasData.hojas.length - borradorCount - cerradaCount;

  badge.classList.remove('green', 'orange', 'red');

  if (borradorCount && cerradaCount) {
    badge.textContent = `B${borradorCount} C${cerradaCount}`;
    badge.classList.add('orange');
  } else if (borradorCount) {
    badge.textContent = `B${borradorCount}`;
    badge.classList.add('red');
  } else if (cerradaCount) {
    badge.textContent = `C${cerradaCount}`;
    badge.classList.add('green');
  } else {
    badge.textContent = hojasData.hojas.length;
  }

  const titleParts = [
    `Borradores: ${borradorCount}`,
    `Cerradas: ${cerradaCount}`,
  ];
  if (otherCount > 0) titleParts.push(`Otras: ${otherCount}`);
  badge.title = titleParts.join(' · ');
}

// ── Panel logistica: resumen pedidos del dia ──
let hrPedidosResumen = null;

async function loadPedidosResumen() {
  const isComercial = typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial';
  const panel = document.getElementById('hrPedidosPanel');
  if (isComercial || !panel) return;

  const fecha = getHrDate();
  try {
    hrPedidosResumen = await api('orders/resumen-por-ruta?date=' + fecha);
  } catch (e) {
    hrPedidosResumen = null;
    panel.style.display = 'none';
    return;
  }

  renderPedidosPanel();
}

function renderPedidosPanel() {
  const panel = document.getElementById('hrPedidosPanel');
  if (!panel || !hrPedidosResumen) { if (panel) panel.style.display = 'none'; return; }

  const { resumen_estado, rutas, sin_ruta, alertas, total_pedidos } = hrPedidosResumen;
  const totalConfirmados = resumen_estado.confirmado || 0;
  const totalPendientes = resumen_estado.pendiente || 0;
  const totalAnulados = resumen_estado.anulado || 0;

  // Si no hay pedidos de ningun tipo, no mostrar el panel
  if (!totalConfirmados && !totalPendientes && !totalAnulados) {
    panel.style.display = 'none';
    document.getElementById('btnGenerarDesde').style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  document.getElementById('btnGenerarDesde').style.display = totalConfirmados > 0 ? '' : 'none';

  let html = '<div style="padding:8px 10px;background:var(--accent-soft);border:1px solid rgba(142,139,48,0.25);border-radius:8px;margin:8px 0 4px;font-size:11px">';
  html += '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:6px">';
  html += '<b style="color:var(--accent)">Pedidos del dia</b>';
  if (totalConfirmados) html += `<span style="color:#2d7d2d"><b>${totalConfirmados}</b> confirmados</span>`;
  if (totalPendientes) html += `<span style="color:var(--accent2)"><b>${totalPendientes}</b> pendientes</span>`;
  if (totalAnulados) html += `<span style="color:var(--text-dim)"><b>${totalAnulados}</b> anulados</span>`;
  html += '</div>';

  // Resumen por ruta
  if (rutas.length) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">';
    rutas.forEach(r => {
      const n = r.pedidos.length;
      // Comprobar si ya existe hoja para esta ruta
      const hojaExiste = hojasData.hojas.some(h => parseInt(h.ruta_id) === r.ruta_id);
      const badge = hojaExiste
        ? '<span style="color:#2d7d2d;font-size:9px" title="Hoja ya generada"> ✓</span>'
        : '<span style="color:var(--accent2);font-size:9px" title="Hoja sin generar"> ○</span>';
      html += `<span style="padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px">${esc(r.ruta_name)} <b>${n}</b>${badge}</span>`;
    });
    html += '</div>';
  }

  // Alertas
  const alertasTipos = {};
  (alertas || []).forEach(a => {
    alertasTipos[a.tipo] = (alertasTipos[a.tipo] || 0) + 1;
  });

  const alertaLines = [];
  if (alertasTipos.sin_ruta) alertaLines.push(`${alertasTipos.sin_ruta} pedidos de clientes sin ruta asignada`);
  if (alertasTipos.sin_coordenadas) alertaLines.push(`${alertasTipos.sin_coordenadas} clientes sin coordenadas`);
  if (alertasTipos.sin_cp) alertaLines.push(`${alertasTipos.sin_cp} clientes sin codigo postal`);

  if (alertaLines.length || sin_ruta.length) {
    html += '<div style="margin-top:4px;padding:4px 8px;background:rgba(212,168,48,0.12);border:1px solid rgba(212,168,48,0.3);border-radius:4px;font-size:10px;color:#8a6d10">';
    alertaLines.forEach(l => { html += `<div>⚠ ${l}</div>`; });
    if (sin_ruta.length) {
      html += '<div style="margin-top:2px;font-size:9px;color:var(--text-dim)">Sin ruta: ';
      html += sin_ruta.map(p => esc(p.client_name)).join(', ');
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  panel.innerHTML = html;
}

async function generarHojasFromPedidos() {
  const fecha = getHrDate();

  // Primero cargar resumen si no esta cargado
  if (!hrPedidosResumen) {
    await loadPedidosResumen();
  }

  const confirmados = hrPedidosResumen?.resumen_estado?.confirmado || 0;
  if (!confirmados) {
    showToast('No hay pedidos confirmados para ' + fecha);
    return;
  }

  const numRutas = hrPedidosResumen?.rutas?.length || 0;
  if (!await appConfirm(`Generar hojas para <b>${fecha}</b>?<br><br><b>${confirmados}</b> pedidos confirmados en <b>${numRutas}</b> rutas.<br><span style="font-size:11px;color:var(--text-dim)">Se crearan las hojas que no existan y se anadiran las lineas de pedido.</span>`, { title: 'Generar hojas', okText: 'Generar', danger: false })) {
    return;
  }

  const btn = document.getElementById('btnGenerarDesde');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando...';

  try {
    const result = await api('hojas-ruta/generar-desde-pedidos', 'POST', { fecha });

    let msg = `Generadas ${result.hojas_created.length} hojas con ${result.total_lines} lineas`;
    if (result.total_skipped) msg += ` (${result.total_skipped} ya existian)`;

    // Mostrar alertas si las hay
    if (result.alertas?.length) {
      const sinRutaCount = result.alertas.filter(a => a.tipo === 'sin_ruta').length;
      if (sinRutaCount) msg += `\n⚠ ${sinRutaCount} pedidos sin ruta (no se incluyeron)`;
    }

    showToast(msg);
    await loadHojasRuta();
    await loadPedidosResumen();
  } catch (e) {
    showToast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function renderHojasList() {
  const el = document.getElementById('hrList');
  const { hojas, rutas_sin_hoja } = hojasData;
  const isComercial = typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial';

  if (!hojas.length && !rutas_sin_hoja.length && !isComercial) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div>No hay hojas de ruta para esta fecha</div>';
    return;
  }

  let html = '';

  if (isComercial) {
    html += renderComercialQuickSearchSection();
    // ── Vista comercial: rutas disponibles como tarjetas grandes + hojas creadas ──
    if (rutas_sin_hoja.length) {
      html += '<div style="padding:12px 14px 6px;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Crear hoja de ruta</div>';
      rutas_sin_hoja.forEach(r => {
        html += `<div class="hr-card" style="cursor:pointer;border:2px dashed var(--accent);background:var(--accent-soft)" onclick="quickCreateHoja(${r.id})">
          <div class="hr-card-top">
            <div class="hr-card-ruta">${esc(r.name)}</div>
            <span class="btn btn-primary btn-sm" style="pointer-events:none">+ Crear hoja</span>
          </div>
        </div>`;
      });
    }
    if (hojas.length) {
      html += '<div style="padding:12px 14px 6px;font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Mis hojas de hoy</div>';
      hojas.forEach(h => {
        const numLineas = getHojaSummaryLineCount(h);
        const totalCarros = numVal(h.total_carros);
        const totalCajas = numVal(h.total_cajas);
        html += `<div class="hr-card" onclick="openHojaDetail(${h.id})">
          <div class="hr-card-top">
            <div class="hr-card-ruta">${esc(h.ruta_name)}</div>
            <span class="hr-estado-badge hr-estado-${h.estado}">${h.estado}</span>
          </div>
          <div class="hr-card-bottom">
            <span>${numLineas} clientes</span>
            <span>${formatQty(totalCarros)} carros</span>
            <span>${formatQty(totalCajas)} cajas</span>
          </div>
        </div>`;
      });
    }
  } else {
    // ── Vista admin/logistica ──
    const totalClientes = hojas.reduce((s, h) => s + getHojaSummaryLineCount(h), 0);
    const totalCarros = hojas.reduce((s, h) => s + numVal(h.total_carros), 0);
    const totalCajas = hojas.reduce((s, h) => s + numVal(h.total_cajas), 0);
    const porEstado = {};
    hojas.forEach(h => { porEstado[h.estado] = (porEstado[h.estado] || 0) + 1; });
    const estadoResumen = Object.entries(porEstado).map(([e, n]) => `${n} ${e}`).join(', ');

    html += `<div style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:11px;display:flex;gap:14px;flex-wrap:wrap">
      <span><b>${hojas.length}</b> hojas</span>
      <span><b>${totalClientes}</b> clientes</span>
      <span><b>${formatQty(totalCarros)}</b> carros</span>
      <span><b>${formatQty(totalCajas)}</b> cajas</span>
      <span style="color:var(--text-dim)">${estadoResumen}</span>
    </div>`;
    hojas.forEach(h => {
      const numLineas = getHojaSummaryLineCount(h);
      html += `<div class="hr-card" onclick="openHojaDetail(${h.id})">
        <div class="hr-card-top">
          <div class="hr-card-ruta">${esc(h.ruta_name)}</div>
          <span class="hr-estado-badge hr-estado-${h.estado}">${h.estado}</span>
        </div>
        <div class="hr-card-bottom">
          <span>${esc(h.responsable || '—')}</span>
          <span>${numLineas} clientes</span>
          <span>${formatQty(numVal(h.total_carros))} carros</span>
          <span>${formatQty(numVal(h.total_cajas))} cajas</span>
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
  }

  el.innerHTML = html;
}

async function quickCreateHoja(rutaId) {
  try {
    const hoja = await api('hojas-ruta', 'POST', { ruta_id: rutaId, fecha: getHrDate() });
    await loadHojasRuta();
    await openHojaDetail(hoja.id);
    showToast('Hoja abierta');
  } catch (e) { showToast('Error: ' + e.message); }
}

async function openCreateHojaModal() {
  try {
    // Asegurar que los datos están cargados
    if (!hojasData.rutas_sin_hoja || !hojasData.rutas_sin_hoja.length) {
      await loadHojasRuta();
    }
    const sel = document.getElementById('hrNewRuta');
    sel.innerHTML = hojasData.rutas_sin_hoja.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    if (!sel.innerHTML) sel.innerHTML = '<option value="">Todas las rutas ya tienen hoja</option>';
    document.getElementById('hrNewResp').value = '';
    document.getElementById('hrNewNotas').value = '';
    document.getElementById('hrCreateModal').classList.add('open');
  } catch (e) { showToast('Error abriendo modal: ' + e.message); }
}
function closeHrCreateModal() { closeModal('hrCreateModal'); }

async function createHoja() {
  const rutaId = document.getElementById('hrNewRuta').value;
  if (!rutaId) return showToast('Selecciona una ruta');
  try {
    const hoja = await api('hojas-ruta', 'POST', {
      ruta_id: parseInt(rutaId),
      fecha: getHrDate(),
      responsable: document.getElementById('hrNewResp').value,
      notas: document.getElementById('hrNewNotas').value,
    });
    closeHrCreateModal();
    await loadHojasRuta();
    await openHojaDetail(hoja.id);
    showToast('Hoja abierta');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Detalle de hoja ──
async function openHojaDetail(id) {
  if (!vehicles.length) await loadVehicles();
  try {
    currentHoja = await api('hojas-ruta/' + id);
  } catch (e) { return showToast('Error: ' + e.message); }

  lastGlsCalcResult = null;
  hrAutoOrderFocusMode = false;
  hrClientSearchQuery = '';
  if (hrClientSearchTimer) {
    clearTimeout(hrClientSearchTimer);
    hrClientSearchTimer = null;
  }
  if (hrGlsAutoCalcTimer) {
    clearTimeout(hrGlsAutoCalcTimer);
    hrGlsAutoCalcTimer = null;
  }
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrRouteInfo').textContent = '';

  await loadComerciales();

  document.getElementById('hrListView').style.display = 'none';
  document.getElementById('hrDetailView').style.display = 'flex';
  const hrClientSearch = document.getElementById('hrClientSearch');
  if (hrClientSearch) hrClientSearch.value = '';
  currentHoja = applyLastGlsPlanToHoja(currentHoja);
  renderHojaDetail();
  drawHojaOnMap();
  if (!(typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial')) {
    scheduleHojaGlsAutoCalc(false, 250);
  }
}

function closeHojaDetail() {
  currentHoja = null;
  hrAutoOrderFocusMode = false;
  hrClientSearchQuery = '';
  if (hrClientSearchTimer) {
    clearTimeout(hrClientSearchTimer);
    hrClientSearchTimer = null;
  }
  if (hrGlsAutoCalcTimer) {
    clearTimeout(hrGlsAutoCalcTimer);
    hrGlsAutoCalcTimer = null;
  }
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrDetailView').style.display = 'none';
  document.getElementById('hrListView').style.display = 'flex';
  drawMap();
}

function setHojaClientSearch(value) {
  hrClientSearchQuery = value || '';
  if (hrClientSearchTimer) clearTimeout(hrClientSearchTimer);
  hrClientSearchTimer = setTimeout(() => {
    hrClientSearchTimer = null;
    renderHojaLineas();
  }, 120);
}

function getFilteredHojaLineas(hoja, isComercialView) {
  const allLineas = getHojaVisibleLineas(hoja, isComercialView);
  const query = (hrClientSearchQuery || '').trim().toLowerCase();
  if (!isComercialView || !query) return allLineas;

  return allLineas.filter(l => {
    const haystack = [l.client_name, l.client_address, l.zona, l.comercial_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function renderHojaLineas() {
  renderHojaDetail();
}

function getHojaGlsSummary(hoja) {
  const lineas = getHojaActiveLineas(hoja);
  const ownRoute = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'own_route').length;
  const externalize = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'externalize').length;
  const breakEven = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'break_even').length;
  const unavailable = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'unavailable' || (!getEffectiveLineaRecommendation(l) && !hasLineaCostData(l))).length;
  let savings = lineas.reduce((sum, line) => {
    if (getEffectiveLineaRecommendation(line) !== 'externalize') return sum;
    if (line.cost_own_route === null || line.cost_gls_adjusted === null) return sum;
    return sum + Math.max(0, numVal(line.cost_own_route) - numVal(line.cost_gls_adjusted));
  }, 0);

  // Datos del ultimo calculo del backend (solo si pertenecen a esta hoja)
  let totalRouteKm = 0;
  let totalRouteCost = 0;
  let totalGlsAllClients = 0;
  let globalRecommendation = null;
  let globalSavings = 0;
  let optimizationMode = null;
  let optimizedRouteCost = 0;
  let optimizedGlsCost = 0;
  let optimizedTotalCost = 0;
  let optimizationUsed = null;
  let optimalCombo = [];
  let optimalTotalCost = 0;
  let optimalFleetCost = 0;
  let optimalGlsCost = 0;
  let osrmWarning = null;
  if (lastGlsCalcResult && hoja && parseInt(lastGlsCalcResult.hojaId, 10) === parseInt(hoja.id, 10)) {
    totalRouteKm = numVal(lastGlsCalcResult.total_route_km);
    totalRouteCost = numVal(lastGlsCalcResult.total_route_cost);
    totalGlsAllClients = numVal(lastGlsCalcResult.total_gls_all_clients);
    globalRecommendation = lastGlsCalcResult.global_recommendation || null;
    globalSavings = numVal(lastGlsCalcResult.global_savings);
    optimizationMode = lastGlsCalcResult.optimization_mode || null;
    optimizedRouteCost = numVal(lastGlsCalcResult.optimized_route_cost);
    optimizedGlsCost = numVal(lastGlsCalcResult.optimized_gls_cost);
    optimizedTotalCost = numVal(lastGlsCalcResult.optimized_total_cost);
    optimizationUsed = lastGlsCalcResult.optimization_used || null;
    optimalCombo = Array.isArray(lastGlsCalcResult.optimal_combo) ? lastGlsCalcResult.optimal_combo : [];
    optimalTotalCost = numVal(lastGlsCalcResult.optimal_total_cost);
    optimalFleetCost = numVal(lastGlsCalcResult.optimal_fleet_cost);
    optimalGlsCost = numVal(lastGlsCalcResult.optimal_gls_cost);
    osrmWarning = lastGlsCalcResult.osrm_warning || null;
    if (optimizedTotalCost > 0 || optimizationMode === 'externalize_all' || optimizationMode === 'do_route' || optimizationMode === 'mixed') {
      savings = numVal(lastGlsCalcResult.optimized_savings);
    }
  }

  let systemSavings = savings;
  let systemSavingsLabel = 'Ahorro potencial';
  let systemTotalCost = totalRouteCost;
  if (globalRecommendation === 'externalize_all') {
    systemSavings = globalSavings;
    systemSavingsLabel = 'Ahorro real';
    systemTotalCost = totalGlsAllClients;
  } else if (globalRecommendation === 'do_route') {
    systemSavings = globalSavings;
    systemSavingsLabel = 'Ahorro real';
    systemTotalCost = totalRouteCost;
  } else if (
    (optimizationUsed === 'combinatorial' || optimizationUsed === 'greedy' || optimizationMode === 'mixed')
    && optimalTotalCost > 0
  ) {
    systemSavings = numVal(lastGlsCalcResult.optimized_savings);
    systemSavingsLabel = 'Ahorro real';
    systemTotalCost = optimalTotalCost;
  } else if (optimizationUsed === 'combinatorial' || optimizationUsed === 'greedy' || optimizedTotalCost > 0) {
    systemSavings = numVal(lastGlsCalcResult.optimized_savings);
    systemSavingsLabel = 'Ahorro real';
    systemTotalCost = optimizedTotalCost > 0 ? optimizedTotalCost : totalRouteCost;
  }

  return {
    total: lineas.length,
    ownRoute,
    externalize,
    breakEven,
    unavailable,
    savings,
    totalRouteKm,
    totalRouteCost,
    totalGlsAllClients,
    globalRecommendation,
    globalSavings,
    optimizationMode,
    optimizedRouteCost,
    optimizedGlsCost,
    optimizedTotalCost,
    optimizationUsed,
    optimalCombo,
    optimalTotalCost,
    optimalFleetCost,
    optimalGlsCost,
    systemSavings,
    systemSavingsLabel,
    systemTotalCost,
    osrmWarning,
  };
}

function renderHojaGlsSummary(hoja, isComercialView) {
  const el = document.getElementById('hrGlsSummary');
  if (!el) return;

  if (isComercialView || !hoja) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const summary = getHojaGlsSummary(hoja);
  const globalMeta = getGlobalGlsRecommendationMeta(summary);
  let note = 'La comparativa se refresca sola al cambiar clientes, orden o vehiculo.';
  if (!summary.total) {
    note = 'Anade carros o cajas para que la hoja compare ruta propia frente a paqueteria.';
  } else if (!hoja.vehicle_id) {
    note = 'Asigna un vehiculo para poder medir el coste real de la ruta propia.';
  } else if (hrGlsAutoCalcRunning) {
    note = 'Actualizando automaticamente la comparativa de paqueteria...';
  } else if (summary.unavailable > 0) {
    note = 'Hay clientes sin codigo postal o con datos incompletos; se marcan como no calculables.';
  }
  if (globalMeta.note) {
    note = globalMeta.note;
  }

  el.style.display = 'block';
  const rutaTotalCard = summary.totalRouteKm > 0
    ? `<div class="hr-gls-card" title="Distancia y coste real de toda la ruta (depot -> clientes -> depot) usando el coste/km del vehiculo asignado.">
        <div class="hr-gls-card-label">Ruta total</div>
        <div class="hr-gls-card-value">${esc(formatQty(summary.totalRouteKm))} km</div>
        <div class="hr-gls-card-sub">${esc(formatMoney(summary.totalRouteCost))}</div>
      </div>`
    : '';
  const savingsLabel = summary.systemSavingsLabel || 'Ahorro potencial';
  const savingsValue = numVal(summary.systemSavings ?? summary.savings);

  let optimizationBanner = '';
  if (summary.optimizationUsed === 'combinatorial' || summary.optimizationUsed === 'greedy') {
    const algoLabel = summary.optimizationUsed === 'combinatorial'
      ? 'Optimo combinatorio (busqueda exacta 2^N)'
      : 'Optimo voraz (heuristica greedy)';
    const numExt = (summary.optimalCombo || []).length;
    const sub = `Coste total optimo: ${formatMoney(summary.optimalTotalCost)} `
      + `(flota ${formatMoney(summary.optimalFleetCost)} + paqueteria ${formatMoney(summary.optimalGlsCost)}). `
      + `Externalizar ${numExt} cliente${numExt === 1 ? '' : 's'}.`;
    optimizationBanner = `<div class="hr-gls-banner optimization">
        <div class="hr-gls-banner-title">\u2605 ${esc(algoLabel)}</div>
        <div class="hr-gls-banner-sub">${esc(sub)}</div>
      </div>`;
  }

  let osrmBanner = '';
  if (summary.osrmWarning === 'fallback_haversine') {
    osrmBanner = `<div class="hr-gls-banner osrm-warn">
        <div class="hr-gls-banner-title">OSRM no disponible - distancias aproximadas</div>
        <div class="hr-gls-banner-sub">El servicio de rutas no responde. Las distancias se han estimado en linea recta (haversine). Los costes pueden no ser exactos.</div>
      </div>`;
  } else if (summary.osrmWarning === 'partial_haversine') {
    osrmBanner = `<div class="hr-gls-banner osrm-warn">
        <div class="hr-gls-banner-title">OSRM parcialmente disponible</div>
        <div class="hr-gls-banner-sub">Algunas distancias se estimaron en linea recta porque OSRM no respondio para todos los tramos.</div>
      </div>`;
  }

  el.innerHTML = `${osrmBanner}${globalMeta.bannerHtml}${optimizationBanner}<div class="hr-gls-summary-grid">
      <div class="hr-gls-card">
        <div class="hr-gls-card-label">Clientes cargados</div>
        <div class="hr-gls-card-value">${esc(String(summary.total))}</div>
      </div>
      ${rutaTotalCard}
      <div class="hr-gls-card">
        <div class="hr-gls-card-label">Compensa ruta propia</div>
        <div class="hr-gls-card-value ok">${esc(String(summary.ownRoute))}</div>
      </div>
      <div class="hr-gls-card">
        <div class="hr-gls-card-label">Compensa paqueteria</div>
        <div class="hr-gls-card-value warn">${esc(String(summary.externalize))}</div>
      </div>
      <div class="hr-gls-card">
        <div class="hr-gls-card-label">${esc(savingsLabel)}</div>
        <div class="hr-gls-card-value">${esc(formatMoney(savingsValue))}</div>
      </div>
    </div>
    <div class="hr-gls-summary-note">${esc(note)}${summary.breakEven ? ` Empate tecnico: ${summary.breakEven}.` : ''}</div>`;
}

function scheduleHojaGlsAutoCalc(force = false, delay = 500) {
  if (!currentHoja || (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial')) return;

  if (hrGlsAutoCalcTimer) {
    clearTimeout(hrGlsAutoCalcTimer);
    hrGlsAutoCalcTimer = null;
  }

  const lineas = getHojaActiveLineas(currentHoja);
  const status = document.getElementById('hrGlsCalcStatus');
  if (!lineas.length) {
    if (status) status.textContent = 'Anade carga real para comparar paqueteria';
    renderHojaGlsSummary(currentHoja, false);
    return;
  }

  if (!currentHoja.vehicle_id) {
    if (status) status.textContent = 'Asigna vehiculo para comparar paqueteria';
    renderHojaGlsSummary(currentHoja, false);
    return;
  }

  if (hrGlsAutoCalcRunning) return;

  if (status) status.textContent = 'Actualizando comparativa de paqueteria...';
  hrGlsAutoCalcTimer = setTimeout(() => {
    hrGlsAutoCalcTimer = null;
    calculateHojaGlsCosts(force, { showToast: false, background: true });
  }, delay);
}

function renderHojaDetailLegacy() {
  if (!currentHoja) return;
  const h = currentHoja;
  const isComercialView = typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial';
  const addLineaBtn = document.getElementById('btnAddLinea');
  const calcBtn = document.getElementById('btnCalcGlsCosts');
  const calcStatus = document.getElementById('hrGlsCalcStatus');

  document.getElementById('hrDetailTitle').textContent = h.ruta_name + ' — ' + h.fecha;
  const badge = document.getElementById('hrDetailEstado');
  if (badge) {
    badge.textContent = h.estado;
    badge.className = 'hr-estado-badge hr-estado-' + h.estado;
  }
  const estadoSel = document.getElementById('hrEstadoSel');
  if (estadoSel) estadoSel.value = h.estado;
  if (addLineaBtn) addLineaBtn.style.display = isComercialView ? 'none' : '';
  if (calcBtn) calcBtn.style.display = isComercialView ? 'none' : '';
  if (calcStatus) {
    if (isComercialView) {
      calcStatus.textContent = '';
    } else if (!getHojaActiveLineas(h).length) {
      calcStatus.textContent = 'Anade carga real para comparar paqueteria';
    } else if (!h.vehicle_id) {
      calcStatus.textContent = 'Asigna vehiculo para comparar paqueteria';
    } else if ((h.lineas || []).some(hasLineaCostData)) {
      calcStatus.textContent = hrGlsAutoCalcRunning ? 'Actualizando comparativa de paqueteria...' : 'Comparativa de paqueteria al dia';
    } else {
      calcStatus.textContent = 'Comparativa pendiente';
    }
  }
  renderHojaGlsSummary(h, isComercialView);
  renderHojaVehicleSearch();
  if (vehicleSel) {
    const options = ['<option value="">Vehiculo...</option>'];
    vehicles.forEach(v => {
      const suffix = parseInt(v.active) ? '' : ' [INACTIVO]';
      const label = esc(v.name + (v.plate ? ' · ' + v.plate : '') + suffix);
      options.push(`<option value="${v.id}">${label}</option>`);
    });
    vehicleSel.innerHTML = options.join('');
    vehicleSel.value = h.vehicle_id ? String(h.vehicle_id) : '';
  }
  const allLineas = getHojaVisibleLineas(h, isComercialView);
  const query = (hrClientSearchQuery || '').trim();
  const lineas = getFilteredHojaLineas({ ...h, lineas: allLineas }, isComercialView);
  document.getElementById('hrTotalClientes').textContent = allLineas.length;
  document.getElementById('hrTotalCarros').textContent = formatQty(allLineas.reduce((s, l) => s + numVal(l.carros), 0));
  document.getElementById('hrTotalCajas').textContent = formatQty(allLineas.reduce((s, l) => s + numVal(l.cajas), 0));

  if (!lineas.length && isComercialView && query) {
    document.getElementById('hrLineasList').innerHTML = '<div class="empty"><div class="empty-icon">📋</div>No hay clientes para esa busqueda.</div>';
    return;
  }

  const el = document.getElementById('hrLineasList');
  if (!lineas.length) {
    el.innerHTML = isComercialView
      ? '<div class="empty"><div class="empty-icon">📋</div>No hay clientes asociados a esta ruta para tus comerciales.</div>'
      : '<div class="empty"><div class="empty-icon">📋</div>Solo se muestran clientes con pedido o carga para esta fecha.</div>';
    return;
  }

  let html = '';
  lineas.forEach((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const estadoCls = l.estado === 'entregado' || l.estado === 'cancelado' ? l.estado : '';
    const estadoIcon = l.estado === 'entregado' ? '&#10004;' : l.estado === 'cancelado' ? '&#10008;' : l.estado === 'no_entregado' ? '!' : '';
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    const contado = cl?.al_contado ? '<span style="color:var(--danger);font-size:9px;font-weight:700;flex-shrink:0">CTD</span>' : '';
    const rowOnClick = isComercialView ? '' : ` onclick="openEditLineaModal(${l.id})"`;
    const handleHtml = isComercialView ? '' : '<span class="hr-linea-handle" data-sortable-handle>&#9776;</span>';
    const cantidadHtml = isComercialView
      ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="number" value="${numVal(l.carros) > 0 ? formatQty(l.carros) : ''}" min="0" step="1" placeholder="Carros" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'carros', this.value)" style="width:88px;text-align:right;padding:4px 6px;font-size:11px;border-radius:6px">
          <input type="number" value="${numVal(l.cajas) > 0 ? formatQty(l.cajas) : ''}" min="0" step="1" placeholder="Cajas" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'cajas', this.value)" style="width:88px;text-align:right;padding:4px 6px;font-size:11px;border-radius:6px">
        </div>`
      : `<span class="hr-linea-cc"${hojaLineaHasCarga(l) ? '' : ' style="color:var(--text-dim)"'}>${esc(hojaLineaHasCarga(l) ? formatLineaUnits(l) : 'Sin carga')}</span>`;
    const carrierLabel = esc(l.gls_service || 'Paqueteria');
    const meta = glsRecommendationMeta(getEffectiveLineaRecommendation(l));
    const note = friendlyGlsNote(l.gls_notes);
    const effectiveNote = getEffectiveLineaRecommendationNote(l);
    const simCheckbox = !isComercialView && hojaLineaHasCarga(l) && l.cost_gls_adjusted !== null
      ? renderSimulationCheckbox(l)
      : '';
    const costHtml = !isComercialView && hasLineaCostData(l)
      ? `<div class="hr-linea-costs">
          ${simCheckbox}
          <span class="hr-linea-cost-item" title="Km extra que anade este cliente a la ruta">+${l.detour_km !== null ? esc(formatQty(l.detour_km)) : '—'} km</span>
          <span class="hr-linea-cost-item" title="Lo que ahorras si externalizas este cliente. Calculado como km marginales (los que se añaden a la ruta por incluirlo) x coste/km del vehiculo.">Coste extra: ${l.cost_own_route !== null ? esc(formatMoney(l.cost_own_route)) : '—'}</span>
          <span class="hr-linea-cost-item">${carrierLabel} ${l.cost_gls_adjusted !== null ? esc(formatMoney(l.cost_gls_adjusted)) : '—'}</span>
          <span class="hr-linea-cost-item reco-${meta.cls}">${esc(meta.label)}</span>
          ${note ? `<span class="hr-linea-cost-item reco-unavailable">${esc(note)}</span>` : ''}
        </div>`
      : '';
    const renderedCostHtml = costHtml
      ? costHtml
        .replace('Coste extra:', 'Coste marginal:')
        .replace('</div>', `${effectiveNote ? `<span class="hr-linea-cost-item reco-unavailable">${esc(effectiveNote)}</span>` : ''}</div>`)
      : '';
    html += `<div class="hr-linea ${estadoCls}" data-id="${l.id}"${rowOnClick}>
      ${handleHtml}
      <span class="hr-linea-num">${num}</span>
      <div class="hr-linea-body">
        <div class="hr-linea-row1">
          <span class="hr-linea-name">${esc(l.client_name)}</span>
          ${contado}
          ${cantidadHtml}
          <span class="hr-linea-estado">${estadoIcon}</span>
        </div>
        <div class="hr-linea-row2">
          <span class="hr-linea-zona">${esc(l.zona || '')}</span>
          <span class="hr-linea-com">${esc(l.comercial_name || '')}</span>
        </div>
        ${renderedCostHtml}
      </div>
    </div>`;
  });
  el.innerHTML = html;

  // Init Sortable drag&drop
  if (hrSortable) {
    hrSortable.destroy();
    hrSortable = null;
  }
  if (isComercialView) return;

  hrSortable = new Sortable(el, {
    handle: '.hr-linea-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async function () {
      const visibleIds = Array.from(el.querySelectorAll('.hr-linea')).map(e => parseInt(e.dataset.id, 10));
      const hiddenIds = (currentHoja?.lineas || [])
        .map(l => parseInt(l.id, 10))
        .filter(id => !visibleIds.includes(id));
      const ids = visibleIds.concat(hiddenIds);
      try {
        currentHoja = await api('hojas-ruta/' + currentHoja.id + '/reordenar', 'PUT', { linea_ids: ids });
        renderHojaDetail();
        await fetchHojaOSRMRoute();
        drawHojaOnMap();
      } catch (e) { showToast('Error al reordenar: ' + e.message); }
    }
  });

  renderSimulationPanel();
}

function renderHojaDetail() {
  if (!currentHoja) return;
  const h = currentHoja;
  const isComercialView = typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial';
  const addLineaBtn = document.getElementById('btnAddLinea');
  const calcBtn = document.getElementById('btnCalcGlsCosts');
  const calcStatus = document.getElementById('hrGlsCalcStatus');

  document.getElementById('hrDetailTitle').textContent = h.ruta_name + ' - ' + h.fecha;
  const badge = document.getElementById('hrDetailEstado');
  if (badge) {
    badge.textContent = h.estado;
    badge.className = 'hr-estado-badge hr-estado-' + h.estado;
  }
  const estadoSel = document.getElementById('hrEstadoSel');
  if (estadoSel) estadoSel.value = h.estado;
  if (addLineaBtn) addLineaBtn.style.display = isComercialView ? 'none' : '';
  if (calcBtn) calcBtn.style.display = isComercialView ? 'none' : '';

  if (calcStatus) {
    if (isComercialView) {
      calcStatus.textContent = '';
    } else if (!getHojaActiveLineas(h).length) {
      calcStatus.textContent = 'Anade carga real para comparar paqueteria';
    } else if (!h.vehicle_id) {
      calcStatus.textContent = 'Asigna vehiculo para comparar paqueteria';
    } else if ((h.lineas || []).some(hasLineaCostData)) {
      calcStatus.textContent = hrGlsAutoCalcRunning ? 'Actualizando comparativa de paqueteria...' : 'Comparativa de paqueteria al dia';
    } else {
      calcStatus.textContent = 'Comparativa pendiente';
    }
  }

  renderHojaGlsSummary(h, isComercialView);
  renderHojaVehicleSearch();

  const allLineas = getHojaVisibleLineas(h, isComercialView);
  const query = (hrClientSearchQuery || '').trim();
  const lineas = getFilteredHojaLineas({ ...h, lineas: allLineas }, isComercialView);
  document.getElementById('hrTotalClientes').textContent = allLineas.length;
  document.getElementById('hrTotalCarros').textContent = formatQty(allLineas.reduce((s, l) => s + numVal(l.carros), 0));
  document.getElementById('hrTotalCajas').textContent = formatQty(allLineas.reduce((s, l) => s + numVal(l.cajas), 0));

  if (!lineas.length && isComercialView && query) {
    document.getElementById('hrLineasList').innerHTML = '<div class="empty"><div class="empty-icon">&#128203;</div>No hay clientes para esa busqueda.</div>';
    return;
  }

  const el = document.getElementById('hrLineasList');
  if (!lineas.length) {
    el.innerHTML = isComercialView
      ? '<div class="empty"><div class="empty-icon">&#128203;</div>No hay clientes asociados a esta ruta para tus comerciales.</div>'
      : '<div class="empty"><div class="empty-icon">&#128203;</div>Solo se muestran clientes con pedido o carga para esta fecha.</div>';
    return;
  }

  let html = '';
  lineas.forEach((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const estadoCls = l.estado === 'entregado' || l.estado === 'cancelado' ? l.estado : '';
    const estadoIcon = l.estado === 'entregado' ? '&#10004;' : l.estado === 'cancelado' ? '&#10008;' : l.estado === 'no_entregado' ? '!' : '';
    const cl = clients.find(c => c.id === parseInt(l.client_id, 10));
    const contado = cl?.al_contado ? '<span style="color:var(--danger);font-size:9px;font-weight:700;flex-shrink:0">CTD</span>' : '';
    const rowOnClick = isComercialView ? '' : ` onclick="openEditLineaModal(${l.id})"`;
    const handleHtml = isComercialView ? '' : '<span class="hr-linea-handle" data-sortable-handle>&#9776;</span>';
    const cantidadHtml = isComercialView
      ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="number" value="${numVal(l.carros) > 0 ? formatQty(l.carros) : ''}" min="0" step="1" placeholder="Carros" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'carros', this.value)" style="width:88px;text-align:right;padding:6px 8px;font-size:13px;border-radius:8px">
          <input type="number" value="${numVal(l.cajas) > 0 ? formatQty(l.cajas) : ''}" min="0" step="1" placeholder="Cajas" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'cajas', this.value)" style="width:88px;text-align:right;padding:6px 8px;font-size:13px;border-radius:8px">
        </div>`
      : `<span class="hr-linea-cc"${hojaLineaHasCarga(l) ? '' : ' style="color:var(--text-dim)"'}>${esc(hojaLineaHasCarga(l) ? formatLineaUnits(l) : 'Sin carga')}</span>`;
    const meta = glsRecommendationMeta(getEffectiveLineaRecommendation(l));
    const note = friendlyGlsNote(l.gls_notes);
    const effectiveNote = getEffectiveLineaRecommendationNote(l);
    const simCheckbox = !isComercialView && hojaLineaHasCarga(l) && l.cost_gls_adjusted !== null
      ? renderSimulationCheckbox(l)
      : '';
    const costHtml = !isComercialView && hasLineaCostData(l)
      ? `<div class="hr-linea-costs">
          ${simCheckbox}
          <span class="hr-linea-cost-item" title="Km extra que anade este cliente a la ruta">+${l.detour_km !== null ? esc(formatQty(l.detour_km)) : '-'} km</span>
          <span class="hr-linea-cost-item" title="Lo que ahorras si externalizas este cliente. Calculado como km marginales (los que se añaden a la ruta por incluirlo) x coste/km del vehiculo.">Coste extra: ${l.cost_own_route !== null ? esc(formatMoney(l.cost_own_route)) : '-'}</span>
          <span class="hr-linea-cost-item">${esc(l.gls_service || 'Paqueteria')} ${l.cost_gls_adjusted !== null ? esc(formatMoney(l.cost_gls_adjusted)) : '-'}</span>
          <span class="hr-linea-cost-item reco-${meta.cls}">${esc(meta.label)}</span>
          ${note ? `<span class="hr-linea-cost-item reco-unavailable">${esc(note)}</span>` : ''}
        </div>`
      : '';
    const renderedCostHtml = costHtml
      ? costHtml
        .replace('Coste extra:', 'Coste marginal:')
        .replace('</div>', `${effectiveNote ? `<span class="hr-linea-cost-item reco-unavailable">${esc(effectiveNote)}</span>` : ''}</div>`)
      : '';
    html += `<div class="hr-linea ${estadoCls}" data-id="${l.id}"${rowOnClick}>
      ${handleHtml}
      <span class="hr-linea-num">${num}</span>
      <div class="hr-linea-body">
        <div class="hr-linea-row1">
          <span class="hr-linea-name">${esc(l.client_name)}</span>
          ${contado}
          ${cantidadHtml}
          <span class="hr-linea-estado">${estadoIcon}</span>
        </div>
        <div class="hr-linea-row2">
          <span class="hr-linea-zona">${esc(l.zona || '')}</span>
          <span class="hr-linea-com">${esc(l.comercial_name || '')}</span>
        </div>
        ${renderedCostHtml}
      </div>
    </div>`;
  });
  el.innerHTML = html;

  if (hrSortable) {
    hrSortable.destroy();
    hrSortable = null;
  }
  if (isComercialView) return;

  hrSortable = new Sortable(el, {
    handle: '.hr-linea-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async function () {
      const visibleIds = Array.from(el.querySelectorAll('.hr-linea')).map(e => parseInt(e.dataset.id, 10));
      const hiddenIds = (currentHoja?.lineas || [])
        .map(l => parseInt(l.id, 10))
        .filter(id => !visibleIds.includes(id));
      const ids = visibleIds.concat(hiddenIds);
      try {
        currentHoja = await api('hojas-ruta/' + currentHoja.id + '/reordenar', 'PUT', { linea_ids: ids });
        renderHojaDetail();
        await fetchHojaOSRMRoute();
        drawHojaOnMap();
        scheduleHojaGlsAutoCalc(false, 250);
      } catch (e) { showToast('Error al reordenar: ' + e.message); }
    }
  });

  renderSimulationPanel();
}

async function updateHojaLineaCantidad(lineaId, field, value) {
  if (!currentHoja || !lineaId) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'PUT', {
      [field]: numVal(value),
    });
    renderHojaDetail();
    scheduleHojaGlsAutoCalc(false, 250);
  } catch (e) {
    showToast('Error guardando cantidad: ' + e.message);
  }
}

async function calculateHojaGlsCosts(force = true, opts = {}) {
  if (!currentHoja) return;

  const { showToast: shouldToast = true, background = false } = opts;
  const hojaId = currentHoja.id;
  const btn = document.getElementById('btnCalcGlsCosts');
  const status = document.getElementById('hrGlsCalcStatus');
  const previousText = btn ? btn.textContent : '';

  if (hrGlsAutoCalcTimer) {
    clearTimeout(hrGlsAutoCalcTimer);
    hrGlsAutoCalcTimer = null;
  }

  try {
    hrGlsAutoCalcRunning = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Calculando...';
    }
    if (status) {
      status.textContent = background
        ? 'Actualizando comparativa de paqueteria...'
        : 'Calculando comparativa de paqueteria...';
    }
    renderHojaGlsSummary(currentHoja, false);

    const calcResult = await api('shipping-costs/calculate', 'POST', {
      hoja_ruta_id: hojaId,
      force: force ? 1 : 0,
    });
    lastGlsCalcResult = {
      hojaId: hojaId,
      total_route_km: numVal(calcResult?.total_route_km),
      total_route_cost: numVal(calcResult?.total_route_cost),
      total_gls_all_clients: numVal(calcResult?.total_gls_all_clients),
      global_recommendation: calcResult?.global_recommendation || null,
      global_savings: numVal(calcResult?.global_savings),
      optimization_mode: calcResult?.optimization_mode || null,
      optimized_route_cost: numVal(calcResult?.optimized_route_cost),
      optimized_gls_cost: numVal(calcResult?.optimized_gls_cost),
      optimized_total_cost: numVal(calcResult?.optimized_total_cost),
      optimized_savings: numVal(calcResult?.optimized_savings),
      optimization_used: calcResult?.optimization_used || null,
      optimal_combo: Array.isArray(calcResult?.optimal_combo) ? calcResult.optimal_combo.map(x => parseInt(x, 10)) : [],
      optimal_total_cost: numVal(calcResult?.optimal_total_cost),
      optimal_fleet_cost: numVal(calcResult?.optimal_fleet_cost),
      optimal_gls_cost: numVal(calcResult?.optimal_gls_cost),
      line_recommendations: calcResult?.line_recommendations || {},
      line_recommendation_notes: calcResult?.line_recommendation_notes || {},
      osrm_warning: calcResult?.osrm_warning || null,
    };
    // Resetear simulacion al recibir nuevos costes del backend
    simulationOverrides = {};
    lastSimResult = null;

    const refreshedHoja = await api('hojas-ruta/' + hojaId);
    hrGlsAutoCalcRunning = false;
    if (currentHoja && parseInt(currentHoja.id, 10) === parseInt(hojaId, 10)) {
      currentHoja = applyLastGlsPlanToHoja(refreshedHoja);
      renderHojaDetail();
    } else if (currentHoja) {
      scheduleHojaGlsAutoCalc(false, 250);
    }
    if (shouldToast) showToast('Costes de paqueteria calculados');
  } catch (e) {
    hrGlsAutoCalcRunning = false;
    if (status) status.textContent = 'Error paqueteria: ' + e.message;
    if (currentHoja && parseInt(currentHoja.id, 10) === parseInt(hojaId, 10)) {
      renderHojaGlsSummary(currentHoja, false);
    }
    if (shouldToast) showToast('Error paqueteria: ' + e.message);
  } finally {
    hrGlsAutoCalcRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = previousText || 'Calcular paqueteria';
    }
  }
}

// ── SIMULADOR INTERACTIVO DE COSTES ─────────────────────────
function isLineaSimExternalized(linea) {
  if (!linea) return false;
  const id = parseInt(linea.id, 10);
  const override = simulationOverrides[id];
  if (override === 'externalize') return true;
  if (override === 'fleet') return false;
  // Sin override: respetar la recomendacion del sistema
  return isExternalizeRecommendation(getEffectiveLineaRecommendation(linea));
}

function renderSimulationCheckbox(linea) {
  const checked = isLineaSimExternalized(linea) ? 'checked' : '';
  const tooltip = 'Marcar para externalizar este cliente en la simulacion';
  return `<label class="hr-linea-sim-toggle" title="${tooltip}" onclick="event.stopPropagation()">
      <input type="checkbox" ${checked} onchange="onSimulationToggle(${linea.id}, this.checked); event.stopPropagation();"> Externalizar
    </label>`;
}

function onSimulationToggle(lineaId, isChecked) {
  const id = parseInt(lineaId, 10);
  if (!Number.isFinite(id)) return;
  simulationOverrides[id] = isChecked ? 'externalize' : 'fleet';
  if (simulationDebounceTimer) clearTimeout(simulationDebounceTimer);
  simulationDebounceTimer = setTimeout(() => {
    simulationDebounceTimer = null;
    recalcSimulationLive();
  }, 200);
}

function buildSimulationFleetClientIds() {
  if (!currentHoja) return { fleetClientIds: [], externalizedLineas: [] };
  const lineas = getHojaActiveLineas(currentHoja).filter(l => l.cost_gls_adjusted !== null);
  const fleetClientIds = [];
  const externalizedLineas = [];
  lineas.forEach(l => {
    if (isLineaSimExternalized(l)) {
      externalizedLineas.push(l);
    } else {
      fleetClientIds.push(parseInt(l.client_id, 10));
    }
  });
  return { fleetClientIds, externalizedLineas, lineas };
}

async function recalcSimulationLive() {
  if (!currentHoja) return;
  if (simulationInFlight) return;
  const hojaId = parseInt(currentHoja.id, 10);
  const { fleetClientIds, externalizedLineas, lineas } = buildSimulationFleetClientIds();
  if (!lineas || !lineas.length) {
    lastSimResult = null;
    renderSimulationPanel();
    return;
  }
  simulationInFlight = true;
  try {
    const result = await api('shipping-costs/simulate', 'POST', {
      hoja_ruta_id: hojaId,
      client_ids_in_fleet: fleetClientIds,
    });
    const glsTotal = externalizedLineas.reduce((sum, l) => sum + numVal(l.cost_gls_adjusted), 0);
    lastSimResult = {
      hojaId,
      fleet_km: numVal(result?.fleet_km),
      fleet_cost: numVal(result?.fleet_cost),
      gls_total: glsTotal,
      total: numVal(result?.fleet_cost) + glsTotal,
      num_externalized: externalizedLineas.length,
      num_in_fleet: fleetClientIds.length,
    };
    renderSimulationPanel();
  } catch (e) {
    showToast('Error simulacion: ' + e.message);
  } finally {
    simulationInFlight = false;
  }
}

function getSystemTotalCost(summary) {
  // Coste total de referencia del sistema para comparar con la simulacion
  if (numVal(summary?.systemTotalCost) > 0) return numVal(summary.systemTotalCost);
  if (numVal(summary?.optimalTotalCost) > 0) return numVal(summary.optimalTotalCost);
  if (numVal(summary?.optimizedTotalCost) > 0) return numVal(summary.optimizedTotalCost);
  if (numVal(summary?.totalRouteCost) > 0) return numVal(summary.totalRouteCost);
  return numVal(summary?.totalGlsAllClients);
}

function renderSimulationPanel() {
  const el = document.getElementById('hrSimulationPanel');
  if (!el) return;
  if (!currentHoja) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const isComercialView = typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial';
  if (isComercialView) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const lineas = getHojaActiveLineas(currentHoja).filter(l => l.cost_gls_adjusted !== null);
  if (!lineas.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const summary = getHojaGlsSummary(currentHoja);
  const systemTotal = getSystemTotalCost(summary);
  const systemLabel = summary.globalRecommendation === 'externalize_all'
    ? 'Sistema: externaliza toda la hoja'
    : summary.globalRecommendation === 'do_route'
      ? 'Sistema: hacer la ruta propia'
      : summary.globalRecommendation === 'mixed'
        ? 'Sistema: caso mixto'
        : 'Sistema: no calculable';

  let body = '';
  if (!lastSimResult || parseInt(lastSimResult.hojaId, 10) !== parseInt(currentHoja.id, 10)) {
    body = `<div class="hr-sim-info">SIMULACION lista. Marca/desmarca clientes para ver el coste en vivo.</div>`;
  } else {
    const sim = lastSimResult;
    const diff = sim.total - systemTotal;
    const diffSign = diff >= 0 ? '+' : '';
    const diffCls = diff <= -0.005 ? 'sim-better' : (diff >= 0.005 ? 'sim-worse' : 'sim-equal');
    const diffTxt = systemTotal > 0
      ? `(vs sistema: ${diffSign}${formatMoney(diff).replace(' EUR', '')} EUR)`
      : '';
    body = `<div class="hr-sim-row">
        <span class="hr-sim-tag">${esc(systemLabel)}</span>
        <span class="hr-sim-tag"><b>${esc(formatQty(sim.fleet_km))}</b> km flota</span>
        <span class="hr-sim-tag"><b>${esc(formatMoney(sim.fleet_cost))}</b> flota</span>
        <span class="hr-sim-tag"><b>${esc(formatMoney(sim.gls_total))}</b> GLS</span>
        <span class="hr-sim-tag hr-sim-total"><b>TOTAL ${esc(formatMoney(sim.total))}</b></span>
        ${diffTxt ? `<span class="hr-sim-diff ${diffCls}">${esc(diffTxt)}</span>` : ''}
        <span class="hr-sim-counts">${sim.num_in_fleet} en flota / ${sim.num_externalized} externalizados</span>
      </div>`;
  }

  el.style.display = 'block';
  el.innerHTML = `<div class="hr-sim-title">Simulacion interactiva</div>
    ${body}
    <div class="hr-sim-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="resetSimulationToSystem()">Resetear a recomendacion del sistema</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="applySimulationAsRecommendation()">Aplicar simulacion como recomendacion fija</button>
    </div>`;
}

function resetSimulationToSystem() {
  simulationOverrides = {};
  lastSimResult = null;
  renderHojaDetail();
  recalcSimulationLive();
}

function applySimulationAsRecommendation() {
  showToast('Funcionalidad pendiente: aun no se persiste la simulacion');
}

async function changeHojaEstado(estado) {
  if (!currentHoja) return;
  const prevEstado = currentHoja.estado;
  const estadoSel = document.getElementById('hrEstadoSel');
  if (estado === 'cerrada' && !currentHoja.vehicle_id) {
    showToast('Asigna un vehiculo antes de cerrar la ruta');
    if (estadoSel) estadoSel.value = prevEstado;
    document.getElementById('hrVehicleSearch')?.focus();
    return;
  }
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/estado', 'PUT', { estado });
    await loadHojasRuta();
    renderHojaDetail();
    showToast('Estado: ' + estado);
  } catch (e) {
    if (estadoSel) estadoSel.value = prevEstado;
    showToast('Error: ' + e.message);
  }
}

function getHojaVehicleLabel(vehicle) {
  if (!vehicle) return '';
  const suffix = parseInt(vehicle.active) ? '' : ' [INACTIVO]';
  return vehicle.name + (vehicle.plate ? ' · ' + vehicle.plate : '') + suffix;
}

function findVehicleBySearchValue(value) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;
  const exact = vehicles.find(v => getHojaVehicleLabel(v).toLowerCase() === normalized);
  if (exact) return exact;

  const partialMatches = vehicles.filter(v => getHojaVehicleLabel(v).toLowerCase().includes(normalized));
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

function renderHojaVehicleSearch() {
  const input = document.getElementById('hrVehicleSearch');
  const hidden = document.getElementById('hrVehicleId');
  const list = document.getElementById('hrVehicleOptions');
  if (!input || !hidden || !list) return;

  list.innerHTML = vehicles.map(v => `<option value="${esc(getHojaVehicleLabel(v))}"></option>`).join('');

  const selectedVehicle = currentHoja?.vehicle_id
    ? vehicles.find(v => parseInt(v.id, 10) === parseInt(currentHoja.vehicle_id, 10))
    : null;

  input.value = selectedVehicle ? getHojaVehicleLabel(selectedVehicle) : '';
  hidden.value = selectedVehicle ? String(selectedVehicle.id) : '';
  input.disabled = !vehicles.length;
}

function syncHojaVehicleSearch(value) {
  const hidden = document.getElementById('hrVehicleId');
  if (!hidden) return;

  const trimmed = (value || '').trim();
  if (!trimmed) {
    hidden.value = '';
    return;
  }

  const matchedVehicle = findVehicleBySearchValue(trimmed);
  hidden.value = matchedVehicle ? String(matchedVehicle.id) : '';
}

async function submitHojaVehicleSearch() {
  if (!currentHoja) return;

  const input = document.getElementById('hrVehicleSearch');
  const hidden = document.getElementById('hrVehicleId');
  if (!input || !hidden) return;

  const searchValue = input.value.trim();
  if (!searchValue) {
    await changeHojaVehicle('');
    return;
  }

  const matchedVehicle = hidden.value
    ? vehicles.find(v => parseInt(v.id, 10) === parseInt(hidden.value, 10))
    : findVehicleBySearchValue(searchValue);

  if (!matchedVehicle) {
    showToast('Selecciona un vehiculo de la lista');
    renderHojaVehicleSearch();
    input.focus();
    input.select();
    return;
  }

  if (parseInt(currentHoja.vehicle_id || 0, 10) === parseInt(matchedVehicle.id, 10)) {
    input.value = getHojaVehicleLabel(matchedVehicle);
    hidden.value = String(matchedVehicle.id);
    return;
  }

  await changeHojaVehicle(String(matchedVehicle.id));
}

async function changeHojaVehicle(vehicleId) {
  if (!currentHoja) return;
  const normalizedVehicleId = vehicleId ? parseInt(vehicleId, 10) : null;

  if (currentHoja.estado === 'cerrada' && !normalizedVehicleId) {
    showToast('Una ruta cerrada debe tener vehiculo asignado');
    renderHojaVehicleSearch();
    return;
  }

  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id, 'PUT', { vehicle_id: normalizedVehicleId });
    await loadHojasRuta();
    renderHojaDetail();
    scheduleHojaGlsAutoCalc(false, 250);
    showToast(normalizedVehicleId ? 'Vehiculo asignado' : 'Vehiculo quitado');
  } catch (e) {
    renderHojaVehicleSearch();
    showToast('Error: ' + e.message);
  }
}

// (variables movidas al bloque STATE)

async function autoOrdenarHoja() {
  if (!currentHoja) return;
  try {
    showToast('Ordenando...');
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/auto-ordenar', 'POST');
    hrAutoOrderFocusMode = true;
    renderHojaDetail();

    // Obtener ruta real OSRM
    await fetchHojaOSRMRoute();
    drawHojaOnMap();
    scheduleHojaGlsAutoCalc(false, 250);
  } catch (e) { showToast('Error: ' + e.message); }
}

async function fetchHojaOSRMRoute() {
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrRouteInfo').textContent = '';

  if (!currentHoja) return;

  const lineas = getHojaActiveLineas(currentHoja);
  if (!lineas.length) return;
  const waypoints = [];
  const routeDelegation = getHojaRouteDelegation(lineas);
  const depotPoint = routeDelegation
    ? { x: parseFloat(routeDelegation.x), y: parseFloat(routeDelegation.y) }
    : null;

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

// Override para que la ruta incluya salida y vuelta a delegacion.
async function fetchHojaOSRMRoute() {
  hrOsrmGeometry = null;
  hrRouteDistance = null;
  hrRouteDuration = null;
  document.getElementById('hrRouteInfo').textContent = '';

  if (!currentHoja) return;

  const lineas = getHojaActiveLineas(currentHoja);
  if (!lineas.length) return;

  const routeDelegation = getHojaRouteDelegation(lineas);
  const depotPoint = routeDelegation
    ? { x: parseFloat(routeDelegation.x), y: parseFloat(routeDelegation.y) }
    : null;
  const waypoints = [];

  if (depotPoint) {
    waypoints.push(depotPoint);
  }

  lineas.forEach(l => {
    const lat = parseFloat(l.client_x);
    const lng = parseFloat(l.client_y);
    if (lat && lng) waypoints.push({ x: lat, y: lng });
  });

  if (depotPoint) {
    waypoints.push(depotPoint);
  }

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

function openAddLineaModal() {
  if (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial') {
    showToast('Tus clientes de la ruta se cargan automaticamente');
    return;
  }
  if (!currentHoja) return;
  document.getElementById('hrLineaCarros').value = '';
  document.getElementById('hrLineaCajas').value = '';
  document.getElementById('hrLineaObs').value = '';
  document.getElementById('hrLineaSearch').value = '';
  lineaSelectedClients = new Set();
  filterLineaClients('');
  document.getElementById('hrAddLineaModal').classList.add('open');
}
function closeAddLineaModal() { closeModal('hrAddLineaModal'); }

function filterLineaClients(q) {
  const existingIds = new Set((currentHoja?.lineas || []).map(l => parseInt(l.client_id)));
  const rutaId = currentHoja?.ruta_id;
  const userComercialIds = getUserComercialIds();
  q = q.toLowerCase();

  let visibleClients = clients.filter(c => c.active);
  if (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial') {
    visibleClients = userComercialIds.length
      ? visibleClients.filter(c => clientMatchesCommercialIds(c, userComercialIds))
      : [];
  }

  // Primero clientes que tengan la ruta de la hoja (N:M), luego el resto
  const clientHasRuta = c => c.rutas && c.rutas.some(r => r.id == rutaId);
  const rutaClients = visibleClients.filter(c => clientHasRuta(c) && !existingIds.has(c.id));
  const otherClients = visibleClients.filter(c => !clientHasRuta(c) && !existingIds.has(c.id));

  let filtered = [...rutaClients, ...otherClients];
  if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || (c.addr || '').toLowerCase().includes(q));
  filtered = filtered.slice(0, 50);

  const el = document.getElementById('hrLineaClientList');
  if (!filtered.length) {
    el.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--text-dim)">Sin resultados</div>';
    return;
  }

  el.innerHTML = filtered.map(c => {
    const alreadyIn = existingIds.has(c.id);
    const checked = alreadyIn || lineaSelectedClients.has(c.id) ? 'checked' : '';
    const disabled = alreadyIn ? 'disabled' : '';
    const dimStyle = alreadyIn ? 'opacity:0.5;' : '';
    const inHojaBadge = alreadyIn ? ' <span style="font-size:9px;background:#2563eb;color:#fff;padding:1px 5px;border-radius:3px;vertical-align:middle">En hoja</span>' : '';
    const contadoChecked = c.al_contado ? 'checked' : '';
    const addr = c.addr ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;word-break:break-word">' + esc(c.addr) + '</div>' : '';
    return '<div class="hr-add-client-item" style="' + dimStyle + '" ' + (alreadyIn ? '' : 'onclick="toggleLineaClient(' + c.id + ', this)"') + '>' +
      '<input type="checkbox" ' + checked + ' ' + disabled + ' ' + (alreadyIn ? '' : 'onclick="event.stopPropagation();toggleLineaClient(' + c.id + ', this.parentElement)"') + ' style="flex-shrink:0;width:16px;height:16px;margin-top:2px">' +
      '<div style="flex:1;min-width:0;overflow:hidden">' +
        '<div style="font-weight:600;font-size:12px;word-break:break-word">' + esc(c.name) + inHojaBadge + '</div>' +
        addr +
      '</div>' +
      (alreadyIn ? '' : '<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;flex-shrink:0;cursor:pointer;font-size:9px;color:var(--danger);font-weight:700;white-space:nowrap;margin-top:2px">' +
        '<input type="checkbox" ' + contadoChecked + ' onchange="toggleContado(' + c.id + ', this.checked)" style="width:13px;height:13px;accent-color:var(--danger)"> CTD' +
      '</label>') +
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
  const userComercialIds = getUserComercialIds();
  const defaultUserComercialId = userComercialIds.length === 1 ? userComercialIds[0] : null;
  const carros = document.getElementById('hrLineaCarros').value || 0;
  const cajas = document.getElementById('hrLineaCajas').value || 0;
  const obs = document.getElementById('hrLineaObs').value || '';

  try {
    for (const clientId of lineaSelectedClients) {
      const client = clients.find(c => c.id === clientId);
      const clientComercialId = pickClientCommercialId(client, userComercialIds);
      await api('hojas-ruta/' + currentHoja.id + '/lineas', 'POST', {
        client_id: clientId,
        comercial_id: clientComercialId || defaultUserComercialId || null,
        carros: numVal(carros),
        cajas: numVal(cajas),
        zona: client?.addr || '',
        observaciones: obs,
      });
    }
    closeAddLineaModal();
    currentHoja = await api('hojas-ruta/' + currentHoja.id);
    renderHojaDetail();
    drawHojaOnMap();
    scheduleHojaGlsAutoCalc(false, 250);
    showToast(lineaSelectedClients.size + ' cliente(s) añadido(s)');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Modal editar línea ──
function openEditLineaModal(lineaId) {
  const linea = (currentHoja?.lineas || []).find(l => parseInt(l.id) === lineaId);
  if (!linea) return;
  const comWrap = document.getElementById('hrEditComercialWrap');

  if (comWrap) {
    comWrap.style.display = shouldHideComercialSelector() ? 'none' : '';
  }

  loadComerciales().then(() => {
    const comSel = document.getElementById('hrEditComercial');
    comSel.innerHTML = '<option value="">—</option>' + comerciales.map(c =>
      `<option value="${c.id}" ${parseInt(linea.comercial_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  });

  document.getElementById('hrEditLineaId').value = lineaId;
  document.getElementById('hrEditLineaTitle').textContent = linea.client_name;
  document.getElementById('hrEditCarros').value = numVal(linea.carros) > 0 ? formatQty(linea.carros) : '';
  document.getElementById('hrEditCajas').value = numVal(linea.cajas) > 0 ? formatQty(linea.cajas) : '';
  document.getElementById('hrEditZona').value = linea.zona || '';
  document.getElementById('hrEditObs').value = linea.observaciones || '';
  document.getElementById('hrEditEstado').value = linea.estado || 'pendiente';
  document.getElementById('hrEditLineaModal').classList.add('open');
}
function closeEditLineaModal() { closeModal('hrEditLineaModal'); }

async function saveEditLinea() {
  const lineaId = document.getElementById('hrEditLineaId').value;
  if (!lineaId || !currentHoja) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'PUT', {
      comercial_id: document.getElementById('hrEditComercial').value || null,
      carros: numVal(document.getElementById('hrEditCarros').value),
      cajas: numVal(document.getElementById('hrEditCajas').value),
      zona: document.getElementById('hrEditZona').value,
      observaciones: document.getElementById('hrEditObs').value,
      estado: document.getElementById('hrEditEstado').value,
    });
    closeEditLineaModal();
    renderHojaDetail();
    drawHojaOnMap();
    scheduleHojaGlsAutoCalc(false, 250);
  } catch (e) { showToast('Error: ' + e.message); }
}

async function removeLineaFromModal() {
  const lineaId = document.getElementById('hrEditLineaId').value;
  if (!lineaId || !currentHoja) return;
  if (!await appConfirm('¿Quitar este cliente de la hoja?', { title: 'Quitar cliente', okText: 'Quitar' })) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'DELETE');
    closeEditLineaModal();
    renderHojaDetail();
    drawHojaOnMap();
    scheduleHojaGlsAutoCalc(false, 250);
    showToast('Cliente quitado');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── Mapa para hoja de ruta ──

function drawHojaOnMap() {
  // Limpiar marcadores de hoja anteriores
  hrMapMarkers.forEach(m => map.removeLayer(m));
  hrMapMarkers = [];
  if (hrMapLine) { map.removeLayer(hrMapLine); hrMapLine = null; }

  if (!currentHoja) return;

  const lineas = getHojaActiveLineas(currentHoja);
  if (!lineas.length) return;
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
    const units = formatLineaUnits(l);
    const tooltip = l.client_name + (units ? ' (' + units + ')' : '');
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
// Override para mostrar salida y vuelta a delegacion tambien en el fallback del mapa.
function drawHojaOnMap() {
  // Restaurar markers generales que se habían ocultado
  hrMapMarkers.forEach(m => map.removeLayer(m));
  hrMapMarkers = [];
  if (hrMapLine) { map.removeLayer(hrMapLine); hrMapLine = null; }

  if (!currentHoja) { drawMap(); return; }

  if (hrAutoOrderFocusMode) {
    clearGeneralMapLayers();
  }

  const lineas = getHojaActiveLineas(currentHoja);
  if (!lineas.length) return;

  const routeDelegation = getHojaRouteDelegation(lineas);
  const depotLat = routeDelegation ? parseFloat(routeDelegation.x) : NaN;
  const depotLng = routeDelegation ? parseFloat(routeDelegation.y) : NaN;
  const points = [];

  if (Number.isFinite(depotLat) && Number.isFinite(depotLng)) {
    const dm = L.marker([depotLat, depotLng], { icon: delegationIcon('D'), zIndexOffset: 1000 })
      .bindTooltip(routeDelegation.name || 'Delegacion', { permanent: true, direction: 'bottom', offset: [0, 10], className: 'delegation-tooltip' })
      .addTo(map);
    hrMapMarkers.push(dm);
    points.push([depotLat, depotLng]);
  }

  lineas.forEach((l, i) => {
    const lat = parseFloat(l.client_x);
    const lng = parseFloat(l.client_y);
    if (!lat || !lng) return;

    const num = l.orden_descarga || (i + 1);
    const units = formatLineaUnits(l);
    const tooltip = l.client_name + (units ? ' (' + units + ')' : '');
    // Ocultar el marker general de este cliente si existe
    if (clientMarkerMap[l.client_id]) {
      map.removeLayer(clientMarkerMap[l.client_id]);
    }
    const marker = L.marker([lat, lng], { icon: clientIcon('#2563eb', num), zIndexOffset: 900 })
      .bindTooltip(tooltip, { direction: 'top', offset: [0, -12] })
      .addTo(map);
    hrMapMarkers.push(marker);
    points.push([lat, lng]);
  });

  if (Number.isFinite(depotLat) && Number.isFinite(depotLng)) {
    points.push([depotLat, depotLng]);
  }

  if (hrOsrmGeometry && hrOsrmGeometry.length > 1) {
    hrMapLine = L.polyline(hrOsrmGeometry, { color: '#e63946', weight: 5, opacity: 0.9 }).addTo(map);
    map.fitBounds(hrMapLine.getBounds().pad(0.1));
  } else if (points.length > 1) {
    hrMapLine = L.polyline(points, { color: '#e63946', weight: 4, opacity: 0.85, dashArray: '8,6' }).addTo(map);
    map.fitBounds(L.latLngBounds(points).pad(0.15));
  } else if (points.length) {
    map.fitBounds(L.latLngBounds(points).pad(0.15));
  }
}

function printHoja() {
  if (!currentHoja) return;
  const h = currentHoja;
  const lineas = getHojaActiveLineas(h);
  const hasCostColumns = lineas.some(l => l.cost_own_route !== null || l.cost_gls_adjusted !== null || l.gls_recommendation);
  const externalizable = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'externalize' && l.cost_gls_adjusted !== null);
  const summary = getHojaGlsSummary(h);
  const showPlanSummary = hasCostColumns && (
    externalizable.length > 0
    || summary.globalRecommendation === 'externalize_all'
    || summary.globalRecommendation === 'do_route'
    || summary.systemSavingsLabel === 'Ahorro real'
  );
  const planHeadline = summary.globalRecommendation === 'externalize_all'
    ? 'DECISION GLOBAL: EXTERNALIZA TODOS LOS CLIENTES'
    : summary.globalRecommendation === 'do_route'
      ? 'DECISION GLOBAL: HAZ LA RUTA EN FLOTA PROPIA'
      : 'CLIENTES RECOMENDADOS PARA PAQUETERIA';

  let rows = lineas.map((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    const contado = cl?.al_contado ? ' <span style="color:red;font-weight:700">[CTD]</span>' : '';
    const meta = glsRecommendationMeta(getEffectiveLineaRecommendation(l));
    return `<tr>
      <td style="text-align:center">${num}</td>
      <td><b>${esc(l.client_name)}</b>${contado}</td>
      <td>${esc(l.zona || '')}</td>
      <td>${esc(l.comercial_name || '')}</td>
      <td style="text-align:center">${numVal(l.carros) > 0 ? formatQty(l.carros) : ''}</td>
      <td style="text-align:center">${numVal(l.cajas) > 0 ? formatQty(l.cajas) : ''}</td>
      ${hasCostColumns ? `<td style="text-align:right">${l.cost_own_route !== null ? esc(formatMoney(l.cost_own_route)) : '—'}</td>` : ''}
      ${hasCostColumns ? `<td style="text-align:right">${l.cost_gls_adjusted !== null ? esc(formatMoney(l.cost_gls_adjusted)) : '—'}</td>` : ''}
      ${hasCostColumns ? `<td>${esc(meta.label)}</td>` : ''}
      <td></td>
      <td>${esc(l.observaciones || '')}</td>
    </tr>`;
  }).join('');

  const totalCarros = formatQty(lineas.reduce((s, l) => s + numVal(l.carros), 0));
  const totalCajas = formatQty(lineas.reduce((s, l) => s + numVal(l.cajas), 0));
  const totalPotentialSavings = numVal(summary.systemSavings ?? summary.savings);
  const savingsLabel = summary.systemSavingsLabel || 'Ahorro potencial';

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
    <thead><tr><th>Ord</th><th>Cliente</th><th>Zona</th><th>Com.</th><th>Carros</th><th>Cajas</th>${hasCostColumns ? '<th>Coste propio</th><th>Coste paqueteria</th><th>Decision</th>' : ''}<th>Entregado</th><th>Observaciones</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">TOTALES: ${totalCarros} carros &middot; ${totalCajas} cajas &middot; ${lineas.length} clientes</div>
  ${showPlanSummary ? `<div style="margin-top:16px;font-size:11px">
    <div style="font-weight:700;margin-bottom:6px">${esc(planHeadline)}</div>
    ${externalizable.length
      ? externalizable.map(line => `<div>- ${esc(line.client_name)} - GLS ${esc(formatMoney(numVal(line.cost_gls_adjusted)))}</div>`).join('')
      : `<div>${summary.globalRecommendation === 'externalize_all'
        ? 'La hoja completa sale mejor por paqueteria.'
        : summary.globalRecommendation === 'do_route'
          ? 'La ruta completa sale mejor en flota propia.'
          : 'La recomendacion global queda en caso mixto; las lineas siguen siendo orientativas.'}</div>`
    }
    <div style="margin-top:6px;font-weight:700">${esc(savingsLabel)} estimado del plan: ${esc(formatMoney(totalPotentialSavings))}</div>
  </div>` : ''}
  <div class="firma"><div>Firma conductor</div><div>Firma almacen</div></div>
  <script>window.print();<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

function exportHojaHtml() {
  if (!currentHoja) return;
  const h = currentHoja;
  const lineas = getHojaActiveLineas(h);

  const totalCarros = formatQty(lineas.reduce((s, l) => s + numVal(l.carros), 0));
  const totalCajas = formatQty(lineas.reduce((s, l) => s + numVal(l.cajas), 0));
  const routeInfo = hrRouteDistance ? `${hrRouteDistance} km · ${hrRouteDuration}` : '';

  let rows = lineas.map((l, i) => {
    const num = l.orden_descarga || (i + 1);
    const cl = clients.find(c => c.id === parseInt(l.client_id));
    const contado = cl?.al_contado ? ' <span style="color:#c00;font-weight:700">[CTD]</span>' : '';
    const carros = numVal(l.carros) > 0 ? formatQty(l.carros) : '';
    const cajas = numVal(l.cajas) > 0 ? formatQty(l.cajas) : '';
    const obs = l.observaciones ? esc(l.observaciones) : '';
    const addr = l.client_address || l.zona || '';
    return `<tr>
      <td style="text-align:center;font-weight:700;color:#8e6b00">${num}</td>
      <td><b>${esc(l.client_name)}</b>${contado}<br><span style="color:#888;font-size:11px">${esc(addr)}</span></td>
      <td>${esc(l.comercial_name || '')}</td>
      <td style="text-align:center">${carros}</td>
      <td style="text-align:center">${cajas}</td>
      <td style="color:#666">${obs}</td>
    </tr>`;
  }).join('');

  const html = `<div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:700px;margin:0 auto">
  <h2 style="margin:0 0 2px;color:#46331f;font-size:18px">${esc(h.ruta_name)}</h2>
  <p style="margin:0 0 12px;color:#888;font-size:13px">${esc(h.fecha)} · ${esc(h.responsable || '')}${routeInfo ? ' · ' + routeInfo : ''}</p>
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f5f0e6">
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:10px">N</th>
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:10px">CLIENTE</th>
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:10px">COMERCIAL</th>
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:10px">CARROS</th>
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:10px">CAJAS</th>
      <th style="border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:10px">OBS.</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="background:#f5f0e6;font-weight:700">
      <td style="border:1px solid #ddd;padding:6px 8px" colspan="3">TOTAL: ${lineas.length} clientes</td>
      <td style="border:1px solid #ddd;padding:6px 8px;text-align:center">${totalCarros}</td>
      <td style="border:1px solid #ddd;padding:6px 8px;text-align:center">${totalCajas}</td>
      <td style="border:1px solid #ddd;padding:6px 8px"></td>
    </tr></tfoot>
  </table>
</div>`;

  // Preparar datos del mapa
  const routeDelegation = getHojaRouteDelegation(lineas);
  const depotLat = routeDelegation ? parseFloat(routeDelegation.x) : null;
  const depotLng = routeDelegation ? parseFloat(routeDelegation.y) : null;
  const depotName = routeDelegation ? (routeDelegation.name || 'Delegacion') : null;

  const markers = lineas.map((l, i) => {
    const num = l.orden_descarga || (i + 1);
    return { lat: parseFloat(l.client_x), lng: parseFloat(l.client_y), num, name: l.client_name, units: formatLineaUnits(l) };
  }).filter(m => m.lat && m.lng);

  const routeCoords = hrOsrmGeometry && hrOsrmGeometry.length > 1
    ? JSON.stringify(hrOsrmGeometry)
    : JSON.stringify(markers.map(m => [m.lat, m.lng]));
  const hasOsrm = !!(hrOsrmGeometry && hrOsrmGeometry.length > 1);

  const full = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${esc(h.ruta_name)} - ${esc(h.fecha)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  * { box-sizing:border-box; }
  body { font-family:'Segoe UI',Tahoma,sans-serif; margin:0; padding:0; background:#fafaf6; color:#333; }
  .layout { display:flex; height:100vh; }
  .left { width:50%; overflow-y:auto; padding:20px; }
  #map { width:50%; height:100vh; position:fixed; right:0; top:0; }
  .depot-icon { background:#46331f; color:#fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:11px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.3); }
  .stop-icon { background:#8e6b00; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:11px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.3); }
  @media print { .layout { display:block; } .left { width:100%; padding:10px; } #map { position:relative; width:100%; height:400px; } }
  @media (max-width:768px) { .layout { flex-direction:column; } .left { width:100%; } #map { position:relative; width:100%; height:50vh; } }
</style>
</head><body>
<div class="layout">
<div class="left">${html}</div>
<div id="map"></div>
</div>
<script>
  var map = L.map('map');
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:'&copy; OpenStreetMap &copy; CARTO', maxZoom:19, subdomains:'abcd'
  }).addTo(map);

  var depot = ${depotLat ? JSON.stringify({lat: depotLat, lng: depotLng, name: depotName}) : 'null'};
  var stops = ${JSON.stringify(markers)};
  var routeCoords = ${routeCoords};
  var hasOsrm = ${hasOsrm};
  var bounds = [];

  if (depot) {
    var di = L.divIcon({className:'',html:'<div class="depot-icon">D</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([depot.lat,depot.lng],{icon:di,zIndexOffset:1000}).bindTooltip(depot.name,{permanent:true,direction:'bottom',offset:[0,10]}).addTo(map);
    bounds.push([depot.lat,depot.lng]);
  }

  stops.forEach(function(s){
    var si = L.divIcon({className:'',html:'<div class="stop-icon">'+s.num+'</div>',iconSize:[26,26],iconAnchor:[13,13]});
    var tip = s.name + (s.units ? ' ('+s.units+')' : '');
    L.marker([s.lat,s.lng],{icon:si}).bindTooltip(tip,{direction:'top',offset:[0,-12]}).addTo(map);
    bounds.push([s.lat,s.lng]);
  });

  if (routeCoords.length > 1) {
    var pts = routeCoords;
    if (depot && !hasOsrm) { pts = [[depot.lat,depot.lng]].concat(pts).concat([[depot.lat,depot.lng]]); }
    L.polyline(pts,{color:'#c0392b',weight:4,opacity:0.85}).addTo(map);
  }

  if (bounds.length) map.fitBounds(bounds,{padding:[30,30]});
<\/script>
</body></html>`;

  const blob = new Blob([full], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (h.ruta_name || 'hoja') + '_' + h.fecha + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('HTML descargado');
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
  const el = document.getElementById('clock');
  if (el) el.textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  if (typeof APP_USER === 'undefined' || APP_USER.role !== 'comercial') refreshAll();
}

function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── MODAL DE CONFIRMACION (reemplaza confirm() nativo) ──
let _confirmResolve = null;

function appConfirm(message, opts = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = opts.title || 'Confirmar';
    document.getElementById('confirmMsg').innerHTML = message;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = opts.okText || 'Confirmar';
    okBtn.className = 'btn ' + (opts.danger !== false ? 'btn-danger' : 'btn-primary');
    document.getElementById('confirmCancelBtn').textContent = opts.cancelText || 'Cancelar';
    modal.classList.add('open');
    okBtn.focus();
  });
}

function closeConfirmModal(result) {
  document.getElementById('confirmModal').classList.remove('open');
  if (_confirmResolve) {
    _confirmResolve(result);
    _confirmResolve = null;
  }
}

// ── GESTIÓN DE USUARIOS ──────────────────────────────────
let appUsers = [];
let allComerciales = [];

async function loadUsers() {
  try {
    appUsers = await api('users');
    if (!allComerciales.length) allComerciales = await api('comerciales');
  } catch (e) { appUsers = []; }
  renderUserList();
}

function renderUserList() {
  const el = document.getElementById('userList');
  if (!el) return;
  if (!appUsers.length) {
    el.innerHTML = '<div class="empty">No hay usuarios</div>';
    return;
  }
  const roleLabels = { admin: 'Admin', logistica: 'Logistica', comercial: 'Comercial' };
  const roleColors = { admin: '#c83c32', logistica: '#3498db', comercial: '#8e8b30' };
  let html = '';
  appUsers.forEach(u => {
    const comNames = u.comercial_ids && u.comercial_ids.length
      ? u.comercial_ids.map(cid => { const c = allComerciales.find(x => x.id === cid); return c ? c.name : ''; }).filter(Boolean).join(', ')
      : '';
    html += `<div class="hr-card" onclick="openUserModal(${u.id})" style="cursor:pointer">
      <div class="hr-card-top">
        <div class="hr-card-ruta">${esc(u.full_name || u.username)}</div>
        <span style="background:${roleColors[u.role] || '#888'};color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase">${roleLabels[u.role] || u.role}</span>
      </div>
      <div class="hr-card-bottom">
        <span style="color:var(--text-dim)">@${esc(u.username)}</span>
        ${!u.active ? '<span style="color:var(--danger);font-weight:700">INACTIVO</span>' : ''}
        ${u.locked ? '<span style="color:var(--danger);font-weight:700">BLOQUEADO</span>' : ''}
        ${comNames ? '<span style="font-size:10px;color:var(--text-dim)">' + esc(comNames) + '</span>' : ''}
      </div>
    </div>`;
  });
  el.innerHTML = html;
}

function openUserModal(id) {
  const isEdit = !!id;
  document.getElementById('uModalTitle').textContent = isEdit ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('uId').value = id || '';
  document.getElementById('uDeleteBtn').style.display = isEdit ? '' : 'none';
  document.getElementById('uPassLabel').textContent = isEdit ? 'Nueva contraseña (dejar vacio para no cambiar)' : 'Contraseña *';

  const u = isEdit ? appUsers.find(x => x.id === id) : null;
  document.getElementById('uUsername').value = u ? u.username : '';
  document.getElementById('uFullName').value = u ? u.full_name : '';
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = u ? u.role : 'comercial';

  renderComercialesCheckboxes(u ? u.comercial_ids : []);
  onUserRoleChange();
  document.getElementById('uModal').classList.add('open');
}

function closeUserModal() { closeModal('uModal'); }

function onUserRoleChange() {
  const role = document.getElementById('uRole').value;
  document.getElementById('uComercialesSection').style.display = role === 'comercial' ? '' : 'none';
}

function renderComercialesCheckboxes(selectedIds) {
  const el = document.getElementById('uComercialesList');
  if (!allComerciales.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">No hay comerciales en la base de datos</div>';
    return;
  }
  const ids = selectedIds || [];
  el.innerHTML = allComerciales.map(c => {
    const checked = ids.includes(c.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border)">
      <input type="checkbox" value="${c.id}" ${checked} style="width:auto;flex-shrink:0">
      <span style="flex:1">${esc(c.name)}</span>
      <span style="color:var(--text-dim);font-size:10px">${esc(c.code)}</span>
    </label>`;
  }).join('');
}

function getSelectedComercialIds() {
  return Array.from(document.querySelectorAll('#uComercialesList input[type=checkbox]:checked'))
    .map(cb => parseInt(cb.value));
}

async function saveUser() {
  const id = document.getElementById('uId').value;
  const username = document.getElementById('uUsername').value.trim();
  const password = document.getElementById('uPassword').value;
  const fullName = document.getElementById('uFullName').value.trim();
  const role = document.getElementById('uRole').value;

  if (!username) return showToast('El usuario es obligatorio');
  if (!id && !password) return showToast('La contraseña es obligatoria');
  if (password && password.length < 4) return showToast('Minimo 4 caracteres');

  const body = {
    username,
    full_name: fullName,
    role,
    comercial_ids: role === 'comercial' ? getSelectedComercialIds() : [],
    active: 1,
    locked: 0,
  };
  if (password) body.password = password;

  try {
    if (id) {
      await api('users/' + id, 'PUT', body);
      showToast('Usuario actualizado');
    } else {
      await api('users', 'POST', body);
      showToast('Usuario creado');
    }
    closeUserModal();
    await loadUsers();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function deleteUser() {
  const id = document.getElementById('uId').value;
  if (!id || !await appConfirm('¿Eliminar este usuario?', { title: 'Eliminar usuario', okText: 'Eliminar' })) return;
  try {
    await api('users/' + id, 'DELETE');
    showToast('Usuario eliminado');
    closeUserModal();
    await loadUsers();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── INIT ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (document.getElementById('rDate')) setToday();
  initMainResizer();
  tickClock();
  setInterval(tickClock, 60000);

  document.getElementById('hrDate').value = todayStr();
  const rentDateInput = document.getElementById('rentDate');
  if (rentDateInput) rentDateInput.value = todayStr();
  const recalcBtn = document.getElementById('btnRecalculateRentability');
  if (recalcBtn && (typeof APP_USER === 'undefined' || APP_USER.role !== 'admin')) {
    recalcBtn.style.display = 'none';
  }

  if (typeof APP_USER !== 'undefined' && APP_USER.role === 'comercial') {
    await loadClients();
    await loadRutas();
    await loadVehicles();
    await loadHojasRuta();
    await loadComercialPedidos();
    comQoFilterClients('');
  } else {
    const today = todayStr();
    document.getElementById('hTo').value = today;
    const d30 = new Date(); d30.setDate(d30.getDate() - 30);
    document.getElementById('hFrom').value = d30.toISOString().slice(0, 10);

    await Promise.all([loadDelegation(), loadDelegations(), loadVehicles(), loadRutas()]);
    map.setView([delegation.x, delegation.y], 12);
    await loadClients();
    await loadOrders();
    await loadHojasRuta();
    refreshAll();
    fitMapToMarkers();
  }
});

let shippingCarriers = [];
let shippingZones = [];
let shippingSurcharges = [];

function ensureShippingCatalogUi() {
  const section = document.getElementById('shippingRatesSection');
  if (!section || section.dataset.catalogUiReady === '1') return;

  section.dataset.catalogUiReady = '1';
  section.innerHTML = `
    <div class="msec-title">Catalogo de paqueteria</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
      <div style="border:1px solid var(--border);border-radius:10px;padding:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>Transportistas</strong>
          <button class="btn btn-primary btn-sm" type="button" onclick="openShippingCarrierModal()">+ Transportista</button>
        </div>
        <div id="shippingCarriersList" style="max-height:190px;overflow:auto"></div>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>Zonas por CP</strong>
          <button class="btn btn-primary btn-sm" type="button" onclick="openShippingZoneModal()">+ Zona</button>
        </div>
        <div id="shippingZonesList" style="max-height:190px;overflow:auto"></div>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>Tarifas base</strong>
          <button class="btn btn-primary btn-sm" type="button" onclick="openShippingRateBandModal()">+ Tarifa</button>
        </div>
        <div id="shippingRateBandsList" style="max-height:220px;overflow:auto"></div>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>Recargos</strong>
          <button class="btn btn-primary btn-sm" type="button" onclick="openShippingSurchargeModal()">+ Recargo</button>
        </div>
        <div id="shippingSurchargesList" style="max-height:220px;overflow:auto"></div>
      </div>
    </div>`;

  ensureShippingCatalogModals();
}

function ensureShippingCatalogModals() {
  if (document.getElementById('shippingCarrierModalV2')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="overlay" id="shippingCarrierModalV2">
      <div class="modal" style="width:460px">
        <div class="mhead">
          <div class="mtitle" id="shippingCarrierModalTitle">Nuevo transportista</div>
          <button class="mclose" onclick="closeShippingCarrierModal()">x</button>
        </div>
        <div class="mbody">
          <input type="hidden" id="shippingCarrierId">
          <div class="ff"><label>Nombre *</label><input id="shippingCarrierNombre" placeholder="GLS, SEUR, MRW..."></div>
          <div class="fg">
            <div><label>Factor volumetrico</label><input type="number" id="shippingCarrierDivisor" min="1" step="1" value="167"></div>
            <div><label>Fuel %</label><input type="number" id="shippingCarrierFuel" min="0" step="0.01" value="0"></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:8px">
            <input type="checkbox" id="shippingCarrierActivo" checked style="width:auto">
            <label for="shippingCarrierActivo" style="margin:0;cursor:pointer">Activo</label>
          </div>
        </div>
        <div class="mfoot">
          <button class="btn btn-danger" id="shippingCarrierDeleteBtn" onclick="deleteShippingCarrier()" style="display:none;margin-right:auto">Eliminar</button>
          <button class="btn btn-secondary" onclick="closeShippingCarrierModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveShippingCarrier()">Guardar</button>
        </div>
      </div>
    </div>

    <div class="overlay" id="shippingZoneModalV2">
      <div class="modal" style="width:480px">
        <div class="mhead">
          <div class="mtitle" id="shippingZoneModalTitle">Nueva zona</div>
          <button class="mclose" onclick="closeShippingZoneModal()">x</button>
        </div>
        <div class="mbody">
          <input type="hidden" id="shippingZoneId">
          <div class="ff"><label>Transportista *</label><select id="shippingZoneCarrier"></select></div>
          <div class="fg">
            <div><label>Prefijo CP *</label><input id="shippingZonePrefix" maxlength="5" placeholder="36"></div>
            <div><label>Zona *</label><input type="number" id="shippingZoneNumber" min="1" step="1" value="1"></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:8px">
            <input type="checkbox" id="shippingZoneRemote" style="width:auto">
            <label for="shippingZoneRemote" style="margin:0;cursor:pointer">Destino remoto</label>
          </div>
        </div>
        <div class="mfoot">
          <button class="btn btn-danger" id="shippingZoneDeleteBtn" onclick="deleteShippingZone()" style="display:none;margin-right:auto">Eliminar</button>
          <button class="btn btn-secondary" onclick="closeShippingZoneModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveShippingZone()">Guardar</button>
        </div>
      </div>
    </div>

    <div class="overlay" id="shippingRateBandModalV2">
      <div class="modal" style="width:520px">
        <div class="mhead">
          <div class="mtitle" id="shippingRateBandModalTitle">Nueva tarifa</div>
          <button class="mclose" onclick="closeShippingRateBandModal()">x</button>
        </div>
        <div class="mbody">
          <input type="hidden" id="shippingRateBandId">
          <div class="fg">
            <div><label>Transportista *</label><select id="shippingRateCarrier"></select></div>
            <div><label>Zona *</label><input type="number" id="shippingRateZone" min="1" step="1" value="1"></div>
          </div>
          <div class="fg">
            <div><label>Peso min *</label><input type="number" id="shippingRatePesoMin" min="0" step="0.01" value="0"></div>
            <div><label>Peso max *</label><input type="number" id="shippingRatePesoMax" min="0" step="0.01" value="1"></div>
          </div>
          <div class="fg">
            <div><label>Precio base *</label><input type="number" id="shippingRatePrecioBase" min="0" step="0.01"></div>
            <div><label>Vigencia desde *</label><input type="date" id="shippingRateDesde"></div>
          </div>
          <div class="ff"><label>Vigencia hasta</label><input type="date" id="shippingRateHasta"></div>
        </div>
        <div class="mfoot">
          <button class="btn btn-danger" id="shippingRateBandDeleteBtn" onclick="deleteShippingRateBand()" style="display:none;margin-right:auto">Eliminar</button>
          <button class="btn btn-secondary" onclick="closeShippingRateBandModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveShippingRateBand()">Guardar</button>
        </div>
      </div>
    </div>

    <div class="overlay" id="shippingSurchargeModalV2">
      <div class="modal" style="width:500px">
        <div class="mhead">
          <div class="mtitle" id="shippingSurchargeModalTitle">Nuevo recargo</div>
          <button class="mclose" onclick="closeShippingSurchargeModal()">x</button>
        </div>
        <div class="mbody">
          <input type="hidden" id="shippingSurchargeId">
          <div class="ff"><label>Transportista *</label><select id="shippingSurchargeCarrier"></select></div>
          <div class="ff"><label>Tipo *</label><input id="shippingSurchargeTipo" placeholder="remoto, sabado, reembolso..."></div>
          <div class="fg">
            <div><label>Importe fijo</label><input type="number" id="shippingSurchargeImporte" min="0" step="0.01"></div>
            <div><label>Porcentaje</label><input type="number" id="shippingSurchargePct" min="0" step="0.01"></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:8px">
            <input type="checkbox" id="shippingSurchargeActivo" checked style="width:auto">
            <label for="shippingSurchargeActivo" style="margin:0;cursor:pointer">Activo</label>
          </div>
        </div>
        <div class="mfoot">
          <button class="btn btn-danger" id="shippingSurchargeDeleteBtn" onclick="deleteShippingSurcharge()" style="display:none;margin-right:auto">Eliminar</button>
          <button class="btn btn-secondary" onclick="closeShippingSurchargeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveShippingSurcharge()">Guardar</button>
        </div>
      </div>
    </div>`);
}

function shippingCarrierOptions(selectedId = '') {
  const options = ['<option value="">Selecciona...</option>'];
  shippingCarriers.forEach(carrier => {
    const selected = String(selectedId) === String(carrier.id) ? ' selected' : '';
    options.push(`<option value="${carrier.id}"${selected}>${esc(carrier.nombre)}</option>`);
  });
  return options.join('');
}

async function loadShippingCatalog() {
  const catalog = await api('shipping-rates');
  shippingCarriers = Array.isArray(catalog.carriers) ? catalog.carriers : [];
  shippingZones = Array.isArray(catalog.zones) ? catalog.zones : [];
  shippingRates = Array.isArray(catalog.rates) ? catalog.rates : [];
  shippingSurcharges = Array.isArray(catalog.surcharges) ? catalog.surcharges : [];
}

function renderShippingCatalogLists() {
  renderShippingCarriersListV2();
  renderShippingZonesListV2();
  renderShippingRateBandsListV2();
  renderShippingSurchargesListV2();
}

function renderShippingCarriersListV2() {
  const el = document.getElementById('shippingCarriersList');
  if (!el) return;
  if (!shippingCarriers.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Sin transportistas todavia.</div>';
    return;
  }
  el.innerHTML = shippingCarriers.map(carrier => `
    <div class="client-card" style="padding:8px 10px;margin-bottom:6px;cursor:default">
      <div class="card-top">
        <div class="cname">${esc(carrier.nombre)}</div>
        <div class="card-actions" style="opacity:1">
          <button class="icon-btn" onclick="openShippingCarrierModal(${carrier.id})" title="Editar">&#9998;</button>
        </div>
      </div>
      <div class="card-sub">
        <span>Factor ${esc(String(carrier.divisor_vol))}</span>
        <span>Fuel ${esc(formatQty(carrier.fuel_pct))}%</span>
      </div>
      <div class="pills">
        <span class="pill ${parseInt(carrier.activo, 10) ? 'open' : 'closed'}">${parseInt(carrier.activo, 10) ? 'Activo' : 'Inactivo'}</span>
      </div>
    </div>`).join('');
}

function renderShippingZonesListV2() {
  const el = document.getElementById('shippingZonesList');
  if (!el) return;
  if (!shippingZones.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Sin zonas configuradas.</div>';
    return;
  }
  el.innerHTML = shippingZones.map(zone => `
    <div class="client-card" style="padding:8px 10px;margin-bottom:6px;cursor:default">
      <div class="card-top">
        <div class="cname">${esc(zone.carrier_name)} · CP ${esc(zone.cp_prefix)}</div>
        <div class="card-actions" style="opacity:1">
          <button class="icon-btn" onclick="openShippingZoneModal(${zone.id})" title="Editar">&#9998;</button>
        </div>
      </div>
      <div class="card-sub">
        <span>Zona ${esc(String(zone.zona))}</span>
        <span>${parseInt(zone.remoto, 10) ? 'Remoto' : 'Normal'}</span>
      </div>
    </div>`).join('');
}

function renderShippingRateBandsListV2() {
  const el = document.getElementById('shippingRateBandsList');
  if (!el) return;
  if (!shippingRates.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Sin tarifas base.</div>';
    return;
  }
  el.innerHTML = shippingRates.map(rate => `
    <div class="client-card" style="padding:8px 10px;margin-bottom:6px;cursor:default">
      <div class="card-top">
        <div class="cname">${esc(rate.carrier_name)} · Zona ${esc(String(rate.zona))}</div>
        <div class="card-actions" style="opacity:1">
          <button class="icon-btn" onclick="openShippingRateBandModal(${rate.id})" title="Editar">&#9998;</button>
        </div>
      </div>
      <div class="card-sub">
        <span>${esc(formatQty(rate.peso_min))}-${esc(formatQty(rate.peso_max))} kg</span>
        <span>${esc(formatMoney(rate.precio_base))}</span>
      </div>
      <div class="card-sub" style="padding-left:0">
        <span>${esc(rate.vigencia_desde)}${rate.vigencia_hasta ? ' a ' + esc(rate.vigencia_hasta) : ' en adelante'}</span>
      </div>
    </div>`).join('');
}

function renderShippingSurchargesListV2() {
  const el = document.getElementById('shippingSurchargesList');
  if (!el) return;
  if (!shippingSurcharges.length) {
    el.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:11px">Sin recargos configurados.</div>';
    return;
  }
  el.innerHTML = shippingSurcharges.map(row => {
    const amount = row.importe !== null && row.importe !== undefined && row.importe !== '' ? formatMoney(row.importe) : '';
    const pct = row.porcentaje !== null && row.porcentaje !== undefined && row.porcentaje !== '' ? formatQty(row.porcentaje) + '%' : '';
    return `
      <div class="client-card" style="padding:8px 10px;margin-bottom:6px;cursor:default">
        <div class="card-top">
          <div class="cname">${esc(row.carrier_name)} · ${esc(row.tipo)}</div>
          <div class="card-actions" style="opacity:1">
            <button class="icon-btn" onclick="openShippingSurchargeModal(${row.id})" title="Editar">&#9998;</button>
          </div>
        </div>
        <div class="card-sub">
          <span>${amount || '-'}</span>
          <span>${pct || '-'}</span>
        </div>
        <div class="pills">
          <span class="pill ${parseInt(row.activo, 10) ? 'open' : 'closed'}">${parseInt(row.activo, 10) ? 'Activo' : 'Inactivo'}</span>
        </div>
      </div>`;
  }).join('');
}

function openShippingCarrierModal(id = null) {
  ensureShippingCatalogModals();
  const carrier = id ? shippingCarriers.find(row => parseInt(row.id, 10) === parseInt(id, 10)) : null;
  document.getElementById('shippingCarrierModalTitle').textContent = carrier ? 'Editar transportista' : 'Nuevo transportista';
  document.getElementById('shippingCarrierId').value = carrier?.id || '';
  document.getElementById('shippingCarrierNombre').value = carrier?.nombre || '';
  document.getElementById('shippingCarrierDivisor').value = carrier?.divisor_vol || 167;
  document.getElementById('shippingCarrierFuel').value = carrier?.fuel_pct || 0;
  document.getElementById('shippingCarrierActivo').checked = carrier ? !!parseInt(carrier.activo, 10) : true;
  document.getElementById('shippingCarrierDeleteBtn').style.display = carrier ? '' : 'none';
  document.getElementById('shippingCarrierModalV2').classList.add('open');
}

function closeShippingCarrierModal() {
  document.getElementById('shippingCarrierModalV2')?.classList.remove('open');
}

async function saveShippingCarrier() {
  const id = document.getElementById('shippingCarrierId').value;
  const payload = {
    entity_type: 'carrier',
    nombre: document.getElementById('shippingCarrierNombre').value.trim(),
    divisor_vol: document.getElementById('shippingCarrierDivisor').value,
    fuel_pct: document.getElementById('shippingCarrierFuel').value,
    activo: document.getElementById('shippingCarrierActivo').checked ? 1 : 0,
  };
  try {
    await api(id ? 'shipping-rates/' + id : 'shipping-rates', id ? 'PUT' : 'POST', payload);
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingCarrierModal();
    showToast(id ? 'Transportista actualizado' : 'Transportista creado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteShippingCarrier() {
  const id = document.getElementById('shippingCarrierId').value;
  if (!id || !await appConfirm('¿Eliminar este transportista y todo su catalogo?', { title: 'Eliminar transportista', okText: 'Eliminar' })) return;
  try {
    await api('shipping-rates/' + id + '?entity_type=carrier', 'DELETE');
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingCarrierModal();
    showToast('Transportista eliminado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function openShippingZoneModal(id = null) {
  ensureShippingCatalogModals();
  if (!shippingCarriers.length) {
    showToast('Crea primero un transportista');
    return;
  }
  const zone = id ? shippingZones.find(row => parseInt(row.id, 10) === parseInt(id, 10)) : null;
  document.getElementById('shippingZoneModalTitle').textContent = zone ? 'Editar zona' : 'Nueva zona';
  document.getElementById('shippingZoneId').value = zone?.id || '';
  document.getElementById('shippingZoneCarrier').innerHTML = shippingCarrierOptions(zone?.carrier_id || '');
  document.getElementById('shippingZonePrefix').value = zone?.cp_prefix || '';
  document.getElementById('shippingZoneNumber').value = zone?.zona || 1;
  document.getElementById('shippingZoneRemote').checked = zone ? !!parseInt(zone.remoto, 10) : false;
  document.getElementById('shippingZoneDeleteBtn').style.display = zone ? '' : 'none';
  document.getElementById('shippingZoneModalV2').classList.add('open');
}

function closeShippingZoneModal() {
  document.getElementById('shippingZoneModalV2')?.classList.remove('open');
}

async function saveShippingZone() {
  const id = document.getElementById('shippingZoneId').value;
  const payload = {
    entity_type: 'zone',
    carrier_id: document.getElementById('shippingZoneCarrier').value,
    cp_prefix: document.getElementById('shippingZonePrefix').value.trim(),
    zona: document.getElementById('shippingZoneNumber').value,
    remoto: document.getElementById('shippingZoneRemote').checked ? 1 : 0,
  };
  try {
    await api(id ? 'shipping-rates/' + id : 'shipping-rates', id ? 'PUT' : 'POST', payload);
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingZoneModal();
    showToast(id ? 'Zona actualizada' : 'Zona creada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteShippingZone() {
  const id = document.getElementById('shippingZoneId').value;
  if (!id || !await appConfirm('¿Eliminar esta zona?', { title: 'Eliminar zona', okText: 'Eliminar' })) return;
  try {
    await api('shipping-rates/' + id + '?entity_type=zone', 'DELETE');
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingZoneModal();
    showToast('Zona eliminada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function openShippingRateBandModal(id = null) {
  ensureShippingCatalogModals();
  if (!shippingCarriers.length) {
    showToast('Crea primero un transportista');
    return;
  }
  const rate = id ? shippingRates.find(row => parseInt(row.id, 10) === parseInt(id, 10)) : null;
  document.getElementById('shippingRateBandModalTitle').textContent = rate ? 'Editar tarifa' : 'Nueva tarifa';
  document.getElementById('shippingRateBandId').value = rate?.id || '';
  document.getElementById('shippingRateCarrier').innerHTML = shippingCarrierOptions(rate?.carrier_id || '');
  document.getElementById('shippingRateZone').value = rate?.zona || 1;
  document.getElementById('shippingRatePesoMin').value = rate?.peso_min || 0;
  document.getElementById('shippingRatePesoMax').value = rate?.peso_max || 1;
  document.getElementById('shippingRatePrecioBase').value = rate?.precio_base || '';
  document.getElementById('shippingRateDesde').value = rate?.vigencia_desde || todayStr();
  document.getElementById('shippingRateHasta').value = rate?.vigencia_hasta || '';
  document.getElementById('shippingRateBandDeleteBtn').style.display = rate ? '' : 'none';
  document.getElementById('shippingRateBandModalV2').classList.add('open');
}

function closeShippingRateBandModal() {
  document.getElementById('shippingRateBandModalV2')?.classList.remove('open');
}

async function saveShippingRateBand() {
  const id = document.getElementById('shippingRateBandId').value;
  const payload = {
    entity_type: 'rate',
    carrier_id: document.getElementById('shippingRateCarrier').value,
    zona: document.getElementById('shippingRateZone').value,
    peso_min: document.getElementById('shippingRatePesoMin').value,
    peso_max: document.getElementById('shippingRatePesoMax').value,
    precio_base: document.getElementById('shippingRatePrecioBase').value,
    vigencia_desde: document.getElementById('shippingRateDesde').value,
    vigencia_hasta: document.getElementById('shippingRateHasta').value,
  };
  try {
    await api(id ? 'shipping-rates/' + id : 'shipping-rates', id ? 'PUT' : 'POST', payload);
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingRateBandModal();
    showToast(id ? 'Tarifa actualizada' : 'Tarifa creada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteShippingRateBand() {
  const id = document.getElementById('shippingRateBandId').value;
  if (!id || !await appConfirm('¿Eliminar esta tarifa?', { title: 'Eliminar tarifa', okText: 'Eliminar' })) return;
  try {
    await api('shipping-rates/' + id + '?entity_type=rate', 'DELETE');
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingRateBandModal();
    showToast('Tarifa eliminada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function openShippingSurchargeModal(id = null) {
  ensureShippingCatalogModals();
  if (!shippingCarriers.length) {
    showToast('Crea primero un transportista');
    return;
  }
  const surcharge = id ? shippingSurcharges.find(row => parseInt(row.id, 10) === parseInt(id, 10)) : null;
  document.getElementById('shippingSurchargeModalTitle').textContent = surcharge ? 'Editar recargo' : 'Nuevo recargo';
  document.getElementById('shippingSurchargeId').value = surcharge?.id || '';
  document.getElementById('shippingSurchargeCarrier').innerHTML = shippingCarrierOptions(surcharge?.carrier_id || '');
  document.getElementById('shippingSurchargeTipo').value = surcharge?.tipo || '';
  document.getElementById('shippingSurchargeImporte').value = surcharge?.importe ?? '';
  document.getElementById('shippingSurchargePct').value = surcharge?.porcentaje ?? '';
  document.getElementById('shippingSurchargeActivo').checked = surcharge ? !!parseInt(surcharge.activo, 10) : true;
  document.getElementById('shippingSurchargeDeleteBtn').style.display = surcharge ? '' : 'none';
  document.getElementById('shippingSurchargeModalV2').classList.add('open');
}

function closeShippingSurchargeModal() {
  document.getElementById('shippingSurchargeModalV2')?.classList.remove('open');
}

async function saveShippingSurcharge() {
  const id = document.getElementById('shippingSurchargeId').value;
  const payload = {
    entity_type: 'surcharge',
    carrier_id: document.getElementById('shippingSurchargeCarrier').value,
    tipo: document.getElementById('shippingSurchargeTipo').value.trim(),
    importe: document.getElementById('shippingSurchargeImporte').value,
    porcentaje: document.getElementById('shippingSurchargePct').value,
    activo: document.getElementById('shippingSurchargeActivo').checked ? 1 : 0,
  };
  try {
    await api(id ? 'shipping-rates/' + id : 'shipping-rates', id ? 'PUT' : 'POST', payload);
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingSurchargeModal();
    showToast(id ? 'Recargo actualizado' : 'Recargo creado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteShippingSurcharge() {
  const id = document.getElementById('shippingSurchargeId').value;
  if (!id || !await appConfirm('¿Eliminar este recargo?', { title: 'Eliminar recargo', okText: 'Eliminar' })) return;
  try {
    await api('shipping-rates/' + id + '?entity_type=surcharge', 'DELETE');
    await loadShippingCatalog();
    renderShippingCatalogLists();
    closeShippingSurchargeModal();
    showToast('Recargo eliminado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function openSettingsModal() {
  ensureShippingCatalogUi();
  try {
    const requests = [api('settings')];
    if (typeof APP_USER !== 'undefined' && APP_USER.role === 'admin') {
      requests.push(api('shipping-config').catch(() => null));
      requests.push(api('shipping-rates').catch(() => ({ carriers: [], zones: [], rates: [], surcharges: [] })));
    }

    const results = await Promise.all(requests);
    const s = results[0];
    const shippingConfig = typeof APP_USER !== 'undefined' && APP_USER.role === 'admin' ? (results[1] || null) : null;
    const shippingCatalog = typeof APP_USER !== 'undefined' && APP_USER.role === 'admin'
      ? (results[2] || { carriers: [], zones: [], rates: [], surcharges: [] })
      : { carriers: [], zones: [], rates: [], surcharges: [] };

    document.getElementById('sLunchDur').value = s.lunch_duration_min || 60;
    document.getElementById('sLunchEarly').value = s.lunch_earliest || '12:00';
    document.getElementById('sLunchLate').value = s.lunch_latest || '15:30';
    document.getElementById('sBaseUnload').value = s.base_unload_min || 5;
    document.getElementById('sSpeed').value = s.default_speed_kmh || 50;

    glsConfigState = shippingConfig;
    applyShippingConfigToForm(shippingConfig);

    shippingCarriers = Array.isArray(shippingCatalog.carriers) ? shippingCatalog.carriers : [];
    shippingZones = Array.isArray(shippingCatalog.zones) ? shippingCatalog.zones : [];
    shippingRates = Array.isArray(shippingCatalog.rates) ? shippingCatalog.rates : [];
    shippingSurcharges = Array.isArray(shippingCatalog.surcharges) ? shippingCatalog.surcharges : [];
    renderShippingCatalogLists();
  } catch (e) { /* usa valores por defecto del form */ }

  document.getElementById('btnSaveTemplate').style.display = fleetRoutes?.routes?.length ? 'block' : 'none';
  loadTemplates();
  document.getElementById('settingsModal').classList.add('open');
}

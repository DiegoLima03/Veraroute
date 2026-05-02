// ── HELPERS GLOBALES ──────────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function showToast(msg) {
  const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show');
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
  closeModal('confirmModal');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

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
  if (el) {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }
}

function openModalA11y(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  // Focus al primer input visible o al boton de cerrar
  setTimeout(() => {
    const focusable = el.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
  }, 50);
}

// D2: Accesibilidad — aria-modal, Escape, focus trap en todos los overlays
(function initModalA11y() {
  document.querySelectorAll('.overlay').forEach(function (overlay) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
  });

  // Cierre global con Escape
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const openModals = document.querySelectorAll('.overlay.open');
    if (openModals.length) {
      const last = openModals[openModals.length - 1];
      // Buscar el boton de cierre del modal y hacer click
      const closeBtn = last.querySelector('.mhead button, .mhead [onclick*="close"]');
      if (closeBtn) { closeBtn.click(); return; }
      // Fallback: quitar open
      last.classList.remove('open');
      last.setAttribute('aria-hidden', 'true');
    }
  });

  // Focus trap: Tab dentro del modal abierto
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    const openModal = document.querySelector('.overlay.open');
    if (!openModal) return;
    const focusable = openModal.querySelectorAll('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();

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
let simulationOverrides = {}; // lineaId -> 'fleet' | 'externalizar'  (override local del simulador)
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

  if (!ids.length && APP_USER.id_comercial) {
    ids.push(parseInt(APP_USER.id_comercial, 10));
  }

  return Array.from(new Set(ids));
}

function getClientCommercialIds(client) {
  if (!client) return [];

  const source = Array.isArray(client.comercial_ids) && client.comercial_ids.length
    ? client.comercial_ids
    : [client.id_comercial, client.id_comercial_planta, client.id_comercial_flor, client.id_comercial_accesorio];

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
  return linea?.desvio_km !== null
    || linea?.coste_ruta_propia !== null
    || linea?.coste_gls_ajustado !== null
    || !!linea?.recomendacion_gls
    || !!linea?.notas_gls;
}

function getHojaActiveLineas(hoja) {
  return (hoja?.lineas || []).filter(hojaLineaHasCarga);
}

function getHojaVisibleLineas(hoja, isComercialView) {
  return hoja?.lineas || [];
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente, 10));
    if (cl?.id_delegacion) {
      delCount[cl.id_delegacion] = (delCount[cl.id_delegacion] || 0) + 1;
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

function glsRecommendationMeta(recomendacion) {
  const rec = recomendacion || 'no_disponible';
  const isOptimal = typeof rec === 'string' && rec.endsWith('_optimal');
  const baseRec = isOptimal ? rec.slice(0, -'_optimal'.length) : rec;
  const star = isOptimal ? ' \u2605' : '';
  if (baseRec === 'ruta_propia') return { cls: 'own', label: 'Ruta propia' + star, optimal: isOptimal };
  if (baseRec === 'externalizar') return { cls: 'externalizar', label: 'Enviar por paqueteria' + star, optimal: isOptimal };
  if (baseRec === 'equilibrio') return { cls: 'equilibrio', label: 'Empate tecnico', optimal: false };
  return { cls: 'no_disponible', label: 'No calculable', optimal: false };
}

function isExternalizeRecommendation(rec) {
  const r = rec || '';
  return r === 'externalizar' || r === 'externalize_optimal';
}

function getEffectiveLineaRecommendation(linea) {
  return linea?.gls_recommendation_effective || linea?.recomendacion_gls || 'no_disponible';
}

function getEffectiveLineaRecommendationNote(linea) {
  return (linea?.gls_recommendation_effective_note || '').trim();
}

function getGlobalGlsRecommendationMeta(summary) {
  const recomendacion = summary?.globalRecommendation || 'no_disponible';
  const totalRouteCost = numVal(summary?.totalRouteCost);
  const totalGlsAllClients = numVal(summary?.totalGlsAllClients);
  const globalSavings = numVal(summary?.globalSavings);

  if (recomendacion === 'externalize_all') {
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

  if (recomendacion === 'do_route') {
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
  let rows = activeClients().filter(c => c.id_ruta);
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
    const linea = (hoja.lineas || []).find(l => parseInt(l.id_cliente, 10) === parseInt(clientId, 10));
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
  if (!client || !client.id_ruta) return;

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
      const created = await api('hojas-ruta', 'POST', { id_ruta: client.id_ruta, fecha: getHrDate() });
      hoja = await api('hojas-ruta/' + created.id);
      linea = (hoja.lineas || []).find(l => parseInt(l.id_cliente, 10) === client.id) || null;
    }

    if (!linea) {
      await api('hojas-ruta/' + hoja.id + '/lineas', 'POST', {
        id_cliente: client.id,
        id_comercial: pickClientCommercialId(client, getUserComercialIds()),
        carros: 0,
        cajas: 0,
        zona: client.addr || '',
        observaciones: '',
      });
      hoja = await api('hojas-ruta/' + hoja.id);
      linea = (hoja.lineas || []).find(l => parseInt(l.id_cliente, 10) === client.id) || null;
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
// Prioriza la asignacion N:M (c.rutas[]) sobre el legacy c.id_ruta, y entre
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
  return c && c.id_ruta ? c.id_ruta : null;
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

  const legacyId = parseInt(c?.id_ruta, 10);
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


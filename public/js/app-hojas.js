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
      const hojaExiste = hojasData.hojas.some(h => parseInt(h.id_ruta) === r.id_ruta);
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
    const hoja = await api('hojas-ruta', 'POST', { id_ruta: rutaId, fecha: getHrDate() });
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
      id_ruta: parseInt(rutaId),
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

  document.getElementById('hrListView').classList.add('d-none');
  document.getElementById('hrDetailView').classList.remove('d-none');
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
  document.getElementById('hrDetailView').classList.add('d-none');
  document.getElementById('hrListView').classList.remove('d-none');
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
  const ownRoute = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'ruta_propia').length;
  const externalize = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'externalizar').length;
  const breakEven = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'equilibrio').length;
  const unavailable = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'no_disponible' || (!getEffectiveLineaRecommendation(l) && !hasLineaCostData(l))).length;
  let savings = lineas.reduce((sum, line) => {
    if (getEffectiveLineaRecommendation(line) !== 'externalizar') return sum;
    if (line.coste_ruta_propia === null || line.coste_gls_ajustado === null) return sum;
    return sum + Math.max(0, numVal(line.coste_ruta_propia) - numVal(line.coste_gls_ajustado));
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
  } else if (!hoja.id_vehiculo) {
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
  // L5: distinguir visualmente entre "ahorro marginal estimado" (suma de marginales individuales,
  // que se solapan) y "ahorro real" (consolidado con la combinatoria/greedy). Si el cálculo no
  // ha producido un coste real, se etiqueta como "marginal" y se acompaña de tooltip explicativo.
  const rawSavingsLabel = summary.systemSavingsLabel || 'Ahorro potencial';
  const isMarginalSavings = (rawSavingsLabel === 'Ahorro potencial');
  const savingsLabel = isMarginalSavings ? 'Ahorro marginal estimado' : rawSavingsLabel;
  const savingsValue = numVal(summary.systemSavings ?? summary.savings);
  const savingsCardTip = isMarginalSavings
    ? 'Suma de los ahorros marginales de cada cliente. ATENCION: los desvíos se solapan, así que esta cifra puede ser MAYOR que el ahorro real al externalizar varios clientes a la vez. Para obtener el ahorro real del conjunto óptimo, ejecuta el cálculo GLS desde el botón superior (lanza la búsqueda combinatoria/greedy).'
    : 'Ahorro real consolidado: coste de la ruta completa con flota propia menos coste del subconjunto óptimo a externalizar más coste de los clientes que quedan en ruta. Calculado por la búsqueda combinatoria o greedy.';

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
      <div class="hr-gls-card" title="${esc(savingsCardTip)}">
        <div class="hr-gls-card-label">${esc(savingsLabel)}${isMarginalSavings ? ' (con solape)' : ''}</div>
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

  if (!currentHoja.id_vehiculo) {
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
    } else if (!h.id_vehiculo) {
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
    vehicleSel.value = h.id_vehiculo ? String(h.id_vehiculo) : '';
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente));
    const contado = cl?.al_contado ? '<span style="color:var(--danger);font-size:9px;font-weight:700;flex-shrink:0">CTD</span>' : '';
    const rowOnClick = isComercialView ? '' : ` onclick="openEditLineaModal(${l.id})"`;
    const handleHtml = isComercialView ? '' : '<span class="hr-linea-handle" data-sortable-handle>&#9776;</span>';
    const cantidadHtml = isComercialView
      ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="number" value="${numVal(l.carros) > 0 ? formatQty(l.carros) : ''}" min="0" step="1" placeholder="Carros" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'carros', this.value)" style="width:88px;text-align:right;padding:4px 6px;font-size:11px;border-radius:6px">
          <input type="number" value="${numVal(l.cajas) > 0 ? formatQty(l.cajas) : ''}" min="0" step="1" placeholder="Cajas" onclick="event.stopPropagation()" onchange="updateHojaLineaCantidad(${l.id}, 'cajas', this.value)" style="width:88px;text-align:right;padding:4px 6px;font-size:11px;border-radius:6px">
        </div>`
      : `<span class="hr-linea-cc"${hojaLineaHasCarga(l) ? '' : ' style="color:var(--text-dim)"'}>${esc(hojaLineaHasCarga(l) ? formatLineaUnits(l) : 'Sin carga')}</span>`;
    const carrierLabel = esc(l.servicio_gls || 'Paqueteria');
    const meta = glsRecommendationMeta(getEffectiveLineaRecommendation(l));
    const note = friendlyGlsNote(l.notas_gls);
    const effectiveNote = getEffectiveLineaRecommendationNote(l);
    const simCheckbox = !isComercialView && hojaLineaHasCarga(l) && l.coste_gls_ajustado !== null
      ? renderSimulationCheckbox(l)
      : '';
    const costHtml = !isComercialView && hasLineaCostData(l)
      ? `<div class="hr-linea-costs">
          ${simCheckbox}
          <span class="hr-linea-cost-item" title="Km extra que anade este cliente a la ruta">+${l.desvio_km !== null ? esc(formatQty(l.desvio_km)) : '—'} km</span>
          <span class="hr-linea-cost-item" title="Lo que ahorras si externalizas SOLO este cliente. Calculado como km marginales (los que se añaden a la ruta por incluirlo) x coste/km del vehiculo. OJO: los desvíos de varios clientes se solapan, así que la suma de costes extra individuales NO es el coste extra de quitarlos a todos a la vez. Para el ahorro real del conjunto, mira la card 'Ahorro' del resumen.">Coste extra: ${l.coste_ruta_propia !== null ? esc(formatMoney(l.coste_ruta_propia)) : '—'}</span>
          <span class="hr-linea-cost-item">${carrierLabel} ${l.coste_gls_ajustado !== null ? esc(formatMoney(l.coste_gls_ajustado)) : '—'}</span>
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
          ${cl?.fiscal_name && cl.fiscal_name.toLowerCase() !== l.client_name.toLowerCase() ? `<span class="hr-linea-fiscal">${esc(cl.fiscal_name)}</span>` : ''}
          ${contado}
          ${cantidadHtml}
          <span class="hr-linea-estado">${estadoIcon}</span>
        </div>
        <div class="hr-linea-row2">
          <span class="hr-linea-zona">${esc(l.zona || '')}${l.direccion_descripcion ? ' (' + esc(l.direccion_descripcion) + ')' : ''}</span>
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
    } else if (!h.id_vehiculo) {
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente, 10));
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
    const note = friendlyGlsNote(l.notas_gls);
    const effectiveNote = getEffectiveLineaRecommendationNote(l);
    const simCheckbox = !isComercialView && hojaLineaHasCarga(l) && l.coste_gls_ajustado !== null
      ? renderSimulationCheckbox(l)
      : '';
    const costHtml = !isComercialView && hasLineaCostData(l)
      ? `<div class="hr-linea-costs">
          ${simCheckbox}
          <span class="hr-linea-cost-item" title="Km extra que anade este cliente a la ruta">+${l.desvio_km !== null ? esc(formatQty(l.desvio_km)) : '-'} km</span>
          <span class="hr-linea-cost-item" title="Lo que ahorras si externalizas SOLO este cliente. Calculado como km marginales (los que se añaden a la ruta por incluirlo) x coste/km del vehiculo. OJO: los desvíos de varios clientes se solapan, así que la suma de costes extra individuales NO es el coste extra de quitarlos a todos a la vez. Para el ahorro real del conjunto, mira la card 'Ahorro' del resumen.">Coste extra: ${l.coste_ruta_propia !== null ? esc(formatMoney(l.coste_ruta_propia)) : '-'}</span>
          <span class="hr-linea-cost-item">${esc(l.servicio_gls || 'Paqueteria')} ${l.coste_gls_ajustado !== null ? esc(formatMoney(l.coste_gls_ajustado)) : '-'}</span>
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
          ${cl?.fiscal_name && cl.fiscal_name.toLowerCase() !== l.client_name.toLowerCase() ? `<span class="hr-linea-fiscal">${esc(cl.fiscal_name)}</span>` : ''}
          ${contado}
          ${cantidadHtml}
          <span class="hr-linea-estado">${estadoIcon}</span>
        </div>
        <div class="hr-linea-row2">
          <span class="hr-linea-zona">${esc(l.zona || '')}${l.direccion_descripcion ? ' (' + esc(l.direccion_descripcion) + ')' : ''}</span>
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
      id_hoja_ruta: hojaId,
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
  if (override === 'externalizar') return true;
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
  simulationOverrides[id] = isChecked ? 'externalizar' : 'fleet';
  if (simulationDebounceTimer) clearTimeout(simulationDebounceTimer);
  simulationDebounceTimer = setTimeout(() => {
    simulationDebounceTimer = null;
    recalcSimulationLive();
  }, 200);
}

function buildSimulationFleetClientIds() {
  if (!currentHoja) return { fleetClientIds: [], externalizedLineas: [] };
  const lineas = getHojaActiveLineas(currentHoja).filter(l => l.coste_gls_ajustado !== null);
  const fleetClientIds = [];
  const externalizedLineas = [];
  lineas.forEach(l => {
    if (isLineaSimExternalized(l)) {
      externalizedLineas.push(l);
    } else {
      fleetClientIds.push(parseInt(l.id_cliente, 10));
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
      id_hoja_ruta: hojaId,
      client_ids_in_fleet: fleetClientIds,
    });
    const glsTotal = externalizedLineas.reduce((sum, l) => sum + numVal(l.coste_gls_ajustado), 0);
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
  const lineas = getHojaActiveLineas(currentHoja).filter(l => l.coste_gls_ajustado !== null);
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
  if (estado === 'cerrada' && !currentHoja.id_vehiculo) {
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

  const selectedVehicle = currentHoja?.id_vehiculo
    ? vehicles.find(v => parseInt(v.id, 10) === parseInt(currentHoja.id_vehiculo, 10))
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

  if (parseInt(currentHoja.id_vehiculo || 0, 10) === parseInt(matchedVehicle.id, 10)) {
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
    currentHoja = await api('hojas-ruta/' + currentHoja.id, 'PUT', { id_vehiculo: normalizedVehicleId });
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente));
    if (cl && cl.id_delegacion) delCount[cl.id_delegacion] = (delCount[cl.id_delegacion] || 0) + 1;
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
  const existingIds = new Set((currentHoja?.lineas || []).map(l => parseInt(l.id_cliente)));
  const rutaId = currentHoja?.id_ruta;
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
  if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || (c.fiscal_name || '').toLowerCase().includes(q) || (c.addr || '').toLowerCase().includes(q));
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
    // Selector de direccion si el cliente tiene multiples direcciones
    const dirs = c.direcciones || [];
    let addrSelect = '';
    if (dirs.length > 1 && !alreadyIn) {
      addrSelect = '<div onclick="event.stopPropagation()" style="margin-top:3px"><select data-addr-client="' + c.id + '" style="font-size:10px;padding:2px 4px;width:100%;border-radius:4px">' +
        dirs.map(d => {
          const dLabel = d.descripcion ? esc(d.descripcion) : esc([d.direccion, d.localidad].filter(Boolean).join(', '));
          return '<option value="' + d.id + '"' + (d.principal == 1 ? ' selected' : '') + '>' + dLabel + (d.principal == 1 ? ' \u2605' : '') + '</option>';
        }).join('') + '</select></div>';
    }
    return '<div class="hr-add-client-item" style="' + dimStyle + '" ' + (alreadyIn ? '' : 'onclick="toggleLineaClient(' + c.id + ', this)"') + '>' +
      '<input type="checkbox" ' + checked + ' ' + disabled + ' ' + (alreadyIn ? '' : 'onclick="event.stopPropagation();toggleLineaClient(' + c.id + ', this.parentElement)"') + ' style="flex-shrink:0;width:16px;height:16px;margin-top:2px">' +
      '<div style="flex:1;min-width:0;overflow:hidden">' +
        '<div style="font-weight:600;font-size:12px;word-break:break-word">' + esc(c.name) + inHojaBadge + '</div>' +
        addr +
        addrSelect +
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
      // Obtener direccion seleccionada si el cliente tiene multiples
      const addrSel = document.querySelector('select[data-addr-client="' + clientId + '"]');
      const idDireccion = addrSel ? addrSel.value : null;
      await api('hojas-ruta/' + currentHoja.id + '/lineas', 'POST', {
        id_cliente: clientId,
        id_comercial: clientComercialId || defaultUserComercialId || null,
        id_direccion: idDireccion || null,
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
      `<option value="${c.id}" ${parseInt(linea.id_comercial) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  });

  document.getElementById('hrEditLineaId').value = lineaId;
  document.getElementById('hrEditLineaTitle').textContent = linea.client_name;
  document.getElementById('hrEditCarros').value = numVal(linea.carros) > 0 ? formatQty(linea.carros) : '';
  document.getElementById('hrEditCajas').value = numVal(linea.cajas) > 0 ? formatQty(linea.cajas) : '';
  document.getElementById('hrEditZona').value = linea.zona || '';
  document.getElementById('hrEditObs').value = linea.observaciones || '';
  document.getElementById('hrEditEstado').value = linea.estado || 'pendiente';
  // Selector de direccion de entrega
  const cl = clients.find(c => c.id === parseInt(linea.id_cliente, 10));
  const dirs = cl?.direcciones || [];
  const editDirWrap = document.getElementById('hrEditDireccionWrap');
  const editDirSel = document.getElementById('hrEditDireccion');
  if (editDirWrap && editDirSel) {
    if (dirs.length > 1) {
      editDirWrap.style.display = '';
      editDirSel.innerHTML = dirs.map(d => {
        const dLabel = d.descripcion ? esc(d.descripcion) : esc([d.direccion, d.localidad].filter(Boolean).join(', '));
        const selected = linea.id_direccion == d.id ? ' selected' : (d.principal == 1 && !linea.id_direccion ? ' selected' : '');
        return '<option value="' + d.id + '"' + selected + '>' + dLabel + (d.principal == 1 ? ' \u2605' : '') + '</option>';
      }).join('');
    } else {
      editDirWrap.style.display = 'none';
      editDirSel.innerHTML = '<option value="">Direccion principal</option>';
    }
  }
  document.getElementById('hrEditLineaModal').classList.add('open');
}
function closeEditLineaModal() { closeModal('hrEditLineaModal'); }

async function saveEditLinea() {
  const lineaId = document.getElementById('hrEditLineaId').value;
  if (!lineaId || !currentHoja) return;
  try {
    currentHoja = await api('hojas-ruta/' + currentHoja.id + '/lineas/' + lineaId, 'PUT', {
      id_comercial: document.getElementById('hrEditComercial').value || null,
      id_direccion: document.getElementById('hrEditDireccion')?.value || null,
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
    if (clientMarkerMap[l.id_cliente]) {
      map.removeLayer(clientMarkerMap[l.id_cliente]);
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
  const hasCostColumns = lineas.some(l => l.coste_ruta_propia !== null || l.coste_gls_ajustado !== null || l.recomendacion_gls);
  const externalizable = lineas.filter(l => getEffectiveLineaRecommendation(l) === 'externalizar' && l.coste_gls_ajustado !== null);
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente));
    const contado = cl?.al_contado ? ' <span style="color:red;font-weight:700">[CTD]</span>' : '';
    const meta = glsRecommendationMeta(getEffectiveLineaRecommendation(l));
    return `<tr>
      <td style="text-align:center">${num}</td>
      <td><b>${esc(l.client_name)}</b>${contado}</td>
      <td>${esc(l.zona || '')}</td>
      <td>${esc(l.comercial_name || '')}</td>
      <td style="text-align:center">${numVal(l.carros) > 0 ? formatQty(l.carros) : ''}</td>
      <td style="text-align:center">${numVal(l.cajas) > 0 ? formatQty(l.cajas) : ''}</td>
      ${hasCostColumns ? `<td style="text-align:right">${l.coste_ruta_propia !== null ? esc(formatMoney(l.coste_ruta_propia)) : '—'}</td>` : ''}
      ${hasCostColumns ? `<td style="text-align:right">${l.coste_gls_ajustado !== null ? esc(formatMoney(l.coste_gls_ajustado)) : '—'}</td>` : ''}
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
      ? externalizable.map(line => `<div>- ${esc(line.client_name)} - GLS ${esc(formatMoney(numVal(line.coste_gls_ajustado)))}</div>`).join('')
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
    const cl = clients.find(c => c.id === parseInt(l.id_cliente));
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

// esc(), showToast(), appConfirm(), closeConfirmModal() movidas a app-core.js

// ── CLOCK ──────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  const el = document.getElementById('clock');
  if (el) el.textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  if (typeof APP_USER === 'undefined' || APP_USER.role !== 'comercial') refreshAll();
}

// ── GESTIÓN DE USUARIOS ──────────────────────────────────
let appUsers = [];
let allComerciales = [];

async function openUsersPanel() {
  await loadUsers();
  document.getElementById('usersPanel').classList.add('open');
}
function closeUsersPanel() { closeModal('usersPanel'); }

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
    initUploadDropzone();
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
        <div class="cname">${esc(zone.carrier_name)} · CP ${esc(zone.prefijo_cp)}</div>
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
  document.getElementById('shippingZoneCarrier').innerHTML = shippingCarrierOptions(zone?.id_transportista || '');
  document.getElementById('shippingZonePrefix').value = zone?.prefijo_cp || '';
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
    id_transportista: document.getElementById('shippingZoneCarrier').value,
    prefijo_cp: document.getElementById('shippingZonePrefix').value.trim(),
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
  document.getElementById('shippingRateCarrier').innerHTML = shippingCarrierOptions(rate?.id_transportista || '');
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
    id_transportista: document.getElementById('shippingRateCarrier').value,
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
  document.getElementById('shippingSurchargeCarrier').innerHTML = shippingCarrierOptions(surcharge?.id_transportista || '');
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
    id_transportista: document.getElementById('shippingSurchargeCarrier').value,
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

    document.getElementById('sLunchDur').value = s.almuerzo_duracion_min || 60;
    document.getElementById('sLunchEarly').value = s.almuerzo_hora_min || '12:00';
    document.getElementById('sLunchLate').value = s.almuerzo_hora_max || '15:30';
    document.getElementById('sBaseUnload').value = s.descarga_min_base || 5;
    document.getElementById('sSpeed').value = s.velocidad_defecto_kmh || 50;

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

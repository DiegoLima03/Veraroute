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


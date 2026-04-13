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


// ── TABS ───────────────────────────────────────────────────
function switchTab(t) {
  document.getElementById('vc').classList.toggle('d-none', t !== 'c');
  document.getElementById('vhr').classList.toggle('d-none', t !== 'hr');
  document.getElementById('vf').classList.toggle('d-none', t !== 'f');
  document.getElementById('vh').classList.toggle('d-none', t !== 'h');
  const vup = document.getElementById('vup');
  if (vup) vup.classList.toggle('d-none', t !== 'up');
  document.getElementById('tab-c').classList.toggle('active', t === 'c');
  document.getElementById('tab-hr').classList.toggle('active', t === 'hr');
  document.getElementById('tab-f').classList.toggle('active', t === 'f');
  document.getElementById('tab-h').classList.toggle('active', t === 'h');
  const tabUp = document.getElementById('tab-up');
  if (tabUp) tabUp.classList.toggle('active', t === 'up');
  document.querySelector('.optimize-bar').style.display = 'none';
  if (t === 'f') renderFleetLists();
  if (t === 'h') { loadHistory(); loadDashboard(); }
  if (t === 'hr') loadHojasRuta();
  if (t === 'up') loadUploadedFiles();
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
    comSel.innerHTML = '<option value="">Sin comercial</option>' + comerciales.map(com => '<option value="' + com.id + '"' + (c?.id_comercial == com.id ? ' selected' : '') + '>' + esc(com.name) + '</option>').join('');
  }
  // Direcciones de entrega
  editingClientId = c?.id || null;
  renderClientAddresses(c?.direcciones || []);
  cancelAddressForm();
  // Tipo de zona y tipo de negocio
  document.getElementById('cTipoZona').value = c?.tipo_zona || 'villa';
  document.getElementById('cTipoNegocio').value = c?.tipo_negocio || 'tienda_especializada';
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
            const meta = glsRecommendationMeta(row.recomendacion);
            return `<tr>
              <td>${esc(row.fecha)}</td>
              <td>${formatQty(row.carros)}</td>
              <td>${formatQty(row.cajas)}</td>
              <td>${row.desvio_km !== null && row.desvio_km !== undefined ? formatQty(row.desvio_km) : '—'}</td>
              <td>${row.coste_ruta_propia !== null && row.coste_ruta_propia !== undefined ? formatMoney(row.coste_ruta_propia) : '—'}</td>
              <td>${row.coste_gls_ajustado !== null && row.coste_gls_ajustado !== undefined ? formatMoney(row.coste_gls_ajustado) : '—'}</td>
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
    id_comercial: comercialVal ? parseInt(comercialVal, 10) : null,
    id_ruta: rutaIds.length ? rutaIds[0] : null,
    ruta_ids: rutaIds,
    al_contado: document.getElementById('cContado').checked ? 1 : 0,
    tipo_zona: document.getElementById('cTipoZona').value,
    tipo_negocio: document.getElementById('cTipoNegocio').value,
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
  // Actualizar selector de direccion de entrega
  updateOrderAddressSelect(preId || '');

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
      id_cliente: cid,
      date: date,
      items: items,
      notes: document.getElementById('pNotes').value.trim(),
      id_direccion: document.getElementById('pDireccion')?.value || null,
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
    await api('orders?id_cliente=' + cid + '&date=' + date, 'DELETE');
    currentRoute = null;
    await loadOrders();
    refreshAll();
    showToast('Pedido eliminado');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── RENDER ─────────────────────────────────────────────────
let _refreshTimer = null;
function refreshAll() {
  if (_refreshTimer) return; // ya programado
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    renderClientList(); updateStats(); drawMap();
  }, 50);
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
      (c.fiscal_name && c.fiscal_name.toLowerCase() !== c.name.toLowerCase() ? '<div class="card-fiscal">' + esc(c.fiscal_name) + '</div>' : '') +
      '<div class="card-sub">' +
        '<span class="card-addr">' + (c.addr || (c.x.toFixed(4) + ', ' + c.y.toFixed(4))) + '</span>' +
        (c.comercial_name ? '<span class="card-comercial">' + c.comercial_name + '</span>' : '') +
      '</div>' +
        '<div class="pills">' +
        '<span class="pill ' + (isOpen ? 'open' : 'closed') + '">' + (isOpen ? 'ABIERTO' : 'CERRADO') + ' ' + clientHoursText(c, todayDb) + '</span>' +
        (hasOrd ? '<span class="pill has-ord">PEDIDO</span>' : '') +
        (c.rutas && c.rutas.length ? c.rutas.map(r => {
          const color = normalizeHexColor(r.color) || getRutaColor(r.id);
          return '<span class="pill" style="border-color:' + color + '66;color:#333;background:' + color + '18">' + r.name + '</span>';
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
    if (v && parseInt(v.id_delegacion) === parseInt(d.id)) o.selected = true;
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
    id_delegacion: delegationId,
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

// ── ARCHIVOS (subida) ─────────────────────────────────────
let uploadedFilesList = [];

function initUploadDropzone() {
  const dropzone = document.getElementById('uploadDropzone');
  if (!dropzone) return;
  dropzone.addEventListener('click', () => document.getElementById('uploadFileInput').click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
  });
}

function handleFileSelect(files) {
  if (!files.length) return;
  Array.from(files).forEach(f => uploadFile(f));
}

async function uploadFile(file) {
  const queue = document.getElementById('uploadQueue');
  const item = document.createElement('div');
  item.className = 'upload-item';
  item.innerHTML = '<span class="upload-item-name">' + esc(file.name) + '</span><span class="upload-item-status">Subiendo...</span>';
  queue.appendChild(item);

  try {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch('api/files', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': CSRF_TOKEN },
      body: form,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    item.querySelector('.upload-item-status').textContent = 'OK';
    item.querySelector('.upload-item-status').classList.add('upload-ok');
    await loadUploadedFiles();
    // Si es Excel, procesar automaticamente
    const ext = data.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls'].includes(ext)) {
      await parseExcelFile(data.name);
    }
  } catch (e) {
    item.querySelector('.upload-item-status').textContent = e.message;
    item.querySelector('.upload-item-status').classList.add('upload-err');
  }
}

async function loadUploadedFiles() {
  const el = document.getElementById('uploadedFiles');
  if (!el) return;
  try {
    uploadedFilesList = await api('files');
  } catch (e) { uploadedFilesList = []; }
  renderUploadedFiles();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderUploadedFiles() {
  const el = document.getElementById('uploadedFiles');
  if (!el) return;
  if (!uploadedFilesList.length) {
    el.innerHTML = '<div class="empty" style="padding:20px"><div class="empty-icon">&#128193;</div>No hay archivos subidos</div>';
    return;
  }
  el.innerHTML = uploadedFilesList.map(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    const icon = { pdf: '&#128196;', xlsx: '&#128202;', xls: '&#128202;' }[ext] || '&#128196;';
    const isExcel = ['xlsx', 'xls'].includes(ext);
    const safeName = f.name.replace(/'/g, "\\'");
    return '<div class="upload-file-card">' +
      '<span class="upload-file-icon">' + icon + '</span>' +
      '<div class="upload-file-info">' +
        '<div class="upload-file-name">' + esc(f.name) + '</div>' +
        '<div class="upload-file-meta">' + formatFileSize(f.size) + ' &middot; ' + f.modified + '</div>' +
      '</div>' +
      '<div class="upload-file-actions">' +
        (isExcel ? '<button class="btn btn-primary btn-sm" onclick="parseExcelFile(\'' + esc(safeName) + '\')" title="Procesar pedidos">Procesar</button>' : '') +
        '<a class="btn btn-secondary btn-sm" href="api/files/' + encodeURIComponent(f.name) + '/download" title="Descargar">&#11015;</a>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteUploadedFile(\'' + esc(safeName) + '\')" title="Eliminar">&#10005;</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function deleteUploadedFile(name) {
  if (!await appConfirm('Eliminar <b>' + esc(name) + '</b>?', { title: 'Eliminar archivo', okText: 'Eliminar', danger: true })) return;
  try {
    await api('files/' + encodeURIComponent(name), 'DELETE');
    showToast('Archivo eliminado');
    await loadUploadedFiles();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── PROCESAR EXCEL (pedidos) ──────────────────────────────
let excelParseData = null;

async function parseExcelFile(name) {
  const body = document.getElementById('excelParseBody');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">Procesando Excel...</div>';
  document.getElementById('excelParseTitle').textContent = 'Procesar: ' + name;
  document.getElementById('excelParseModal').classList.add('open');

  try {
    excelParseData = await api('files/' + encodeURIComponent(name) + '/parse-pedidos', 'POST');
  } catch (e) {
    body.innerHTML = '<div style="padding:20px;color:var(--danger)">Error: ' + esc(e.message) + '</div>';
    return;
  }

  renderExcelParseResults();
}

function renderExcelParseResults() {
  const body = document.getElementById('excelParseBody');
  const found = excelParseData.found || [];
  const not_found = excelParseData.not_found || [];
  const total_rows = excelParseData.total_rows || 0;

  let html = '<div style="padding:12px 16px;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--border)">' +
    total_rows + ' filas en el Excel &middot; ' +
    '<b style="color:#3b7a2a">' + found.length + ' clientes encontrados</b>' +
    (not_found.length ? ' &middot; <b style="color:var(--danger)">' + not_found.length + ' no encontrados</b>' : '') +
  '</div>';

  if (not_found.length) {
    html += '<div class="excel-parse-section">';
    html += '<div class="excel-parse-section-title" style="color:var(--danger)">Clientes NO encontrados en la base de datos</div>';
    not_found.forEach(nf => {
      html += '<div class="excel-parse-row excel-parse-notfound">' +
        '<span class="excel-parse-name">' + esc(nf.excel_name) + '</span>' +
        '<span class="excel-parse-badge-err">No encontrado</span>' +
      '</div>';
    });
    html += '</div>';
  }

  if (found.length) {
    // Agrupar por ruta
    const sinRuta = found.filter(f => !f.id_ruta);
    const conRuta = found.filter(f => f.id_ruta);
    const rutaGroups = {};
    conRuta.forEach(f => {
      if (!rutaGroups[f.id_ruta]) rutaGroups[f.id_ruta] = { name: f.ruta_name, clients: [] };
      rutaGroups[f.id_ruta].clients.push(f);
    });

    html += '<div class="excel-parse-section">';
    html += '<div class="excel-parse-section-title">Asignar carros y cajas por cliente</div>';

    Object.entries(rutaGroups).forEach(([rutaId, ruta]) => {
      html += '<div style="margin:10px 0 4px;font-size:11px;font-weight:700;color:var(--accent);border-bottom:1px solid var(--border);padding-bottom:4px">' + esc(ruta.name) + '</div>';
      html += '<div class="excel-parse-header"><span class="excel-parse-col-name">Cliente</span><span class="excel-parse-col-input">Carros</span><span class="excel-parse-col-input">Cajas</span></div>';
      ruta.clients.forEach(f => {
        const idx = found.indexOf(f);
        const inactiveBadge = !f.active ? ' <span class="excel-parse-badge-warn">Inactivo</span>' : '';
        // Selector de direccion si el cliente tiene varias
        const cl = clients.find(c => c.id === f.id);
        const dirs = cl?.direcciones || [];
        let addrSelect = '';
        if (dirs.length > 1) {
          addrSelect = '<div style="margin-top:2px"><select id="exDir_' + idx + '" style="font-size:11px;padding:2px 4px;max-width:220px">';
          dirs.forEach(d => {
            const lbl = (d.descripcion || d.direccion || '').substring(0, 40) + (d.localidad ? ' - ' + d.localidad : '');
            addrSelect += '<option value="' + d.id + '"' + (d.principal == 1 ? ' selected' : '') + '>' + esc(lbl) + (d.principal == 1 ? ' ★' : '') + '</option>';
          });
          addrSelect += '</select></div>';
        }
        html += '<div class="excel-parse-row">' +
          '<div class="excel-parse-col-name">' +
            '<div style="font-weight:600;font-size:12px">' + esc(f.name) + inactiveBadge + '</div>' +
            (f.fiscal_name && f.fiscal_name.toLowerCase() !== f.name.toLowerCase() ? '<div style="font-size:10px;color:var(--text-dim);font-style:italic">' + esc(f.fiscal_name) + '</div>' : '') +
            addrSelect +
          '</div>' +
          '<div class="excel-parse-col-input"><input type="number" id="exCarros_' + idx + '" min="0" step="1" placeholder="0" class="input-compact-sm"></div>' +
          '<div class="excel-parse-col-input"><input type="number" id="exCajas_' + idx + '" min="0" step="1" placeholder="0" class="input-compact-sm"></div>' +
        '</div>';
      });
    });

    if (sinRuta.length) {
      const allRutasList = (typeof rutas !== 'undefined' && Array.isArray(rutas)) ? rutas : [];
      const rutaOpts = allRutasList
        .filter(r => r.active && r.active !== '0')
        .map(r => '<option value="' + r.id + '">' + esc(r.name) + '</option>')
        .join('');
      html += '<div style="margin:10px 0 4px;font-size:11px;font-weight:700;color:var(--danger);border-bottom:1px solid var(--border);padding-bottom:4px">Sin ruta asignada</div>';
      html += '<div class="excel-parse-header"><span class="excel-parse-col-name">Cliente</span><span class="excel-parse-col-ruta">Ruta</span><span class="excel-parse-col-input">Carros</span><span class="excel-parse-col-input">Cajas</span></div>';
      sinRuta.forEach(f => {
        const idx = found.indexOf(f);
        const inactiveBadge = !f.active ? ' <span class="excel-parse-badge-warn">Inactivo</span>' : '';
        // Selector de direccion si el cliente tiene varias
        const cl = clients.find(c => c.id === f.id);
        const dirs = cl?.direcciones || [];
        let addrSelect = '';
        if (dirs.length > 1) {
          addrSelect = '<div style="margin-top:2px"><select id="exDir_' + idx + '" style="font-size:11px;padding:2px 4px;max-width:220px">';
          dirs.forEach(d => {
            const lbl = (d.descripcion || d.direccion || '').substring(0, 40) + (d.localidad ? ' - ' + d.localidad : '');
            addrSelect += '<option value="' + d.id + '"' + (d.principal == 1 ? ' selected' : '') + '>' + esc(lbl) + (d.principal == 1 ? ' ★' : '') + '</option>';
          });
          addrSelect += '</select></div>';
        }
        html += '<div class="excel-parse-row">' +
          '<div class="excel-parse-col-name">' +
            '<div style="font-weight:600;font-size:12px">' + esc(f.name) + inactiveBadge + '</div>' +
            (f.fiscal_name && f.fiscal_name.toLowerCase() !== f.name.toLowerCase() ? '<div style="font-size:10px;color:var(--text-dim);font-style:italic">' + esc(f.fiscal_name) + '</div>' : '') +
            addrSelect +
          '</div>' +
          '<div class="excel-parse-col-ruta"><select id="exRuta_' + idx + '" onchange="excelAssignRuta(' + idx + ', this.value)"><option value="">-- Ruta --</option>' + rutaOpts + '</select></div>' +
          '<div class="excel-parse-col-input"><input type="number" id="exCarros_' + idx + '" min="0" step="1" placeholder="0" class="input-compact-sm"></div>' +
          '<div class="excel-parse-col-input"><input type="number" id="exCajas_' + idx + '" min="0" step="1" placeholder="0" class="input-compact-sm"></div>' +
        '</div>';
      });
    }

    html += '</div>';
    html += '<div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-primary" onclick="submitExcelPedidos()">Crear lineas en hojas de ruta</button>' +
    '</div>';
  }

  body.innerHTML = html;
}

async function excelAssignRuta(idx, rutaId) {
  const f = excelParseData.found[idx];
  if (!f || !rutaId) return;
  try {
    await api('clients/' + f.id, 'PUT', { name: f.name, id_ruta: parseInt(rutaId) });
    f.id_ruta = parseInt(rutaId);
    const ruta = (Array.isArray(rutas) ? rutas : []).find(r => r.id == rutaId);
    f.ruta_name = ruta ? ruta.name : '';
    // Actualizar cliente local
    const local = clients.find(c => c.id === f.id);
    if (local) local.id_ruta = parseInt(rutaId);
    showToast(f.name + ' asignado a ' + f.ruta_name);
  } catch (e) {
    showToast('Error asignando ruta: ' + e.message);
  }
}

async function submitExcelPedidos() {
  if (!excelParseData || !excelParseData.found.length) return;

  // Recoger datos del formulario
  const lineas = [];
  excelParseData.found.forEach((f, i) => {
    const el = document.getElementById('exCarros_' + i);
    if (!el) return; // clientes sin ruta no tienen inputs
    const carros = parseFloat(el.value) || 0;
    const cajas = parseFloat(document.getElementById('exCajas_' + i).value) || 0;
    if (carros > 0 || cajas > 0) {
      const dirSel = document.getElementById('exDir_' + i);
      const id_direccion = dirSel ? (parseInt(dirSel.value) || null) : null;
      lineas.push({ id_cliente: f.id, id_ruta: f.id_ruta, carros, cajas, id_direccion });
    }
  });

  if (!lineas.length) {
    showToast('Introduce carros o cajas en al menos un cliente');
    return;
  }

  // Activar clientes inactivos que vayan a recibir carga
  let activated = 0;
  for (const linea of lineas) {
    const cf = excelParseData.found.find(f => f.id === linea.id_cliente);
    if (cf && !cf.active) {
      try {
        await api('clients/' + cf.id + '/toggle', 'PUT');
        cf.active = true;
        activated++;
        const local = clients.find(c => c.id === cf.id);
        if (local) local.active = true;
      } catch (e) { /* se intentara crear la linea igualmente */ }
    }
  }

  // Agrupar lineas por ruta
  const porRuta = {};
  lineas.forEach(l => {
    if (!l.id_ruta) return;
    if (!porRuta[l.id_ruta]) porRuta[l.id_ruta] = [];
    porRuta[l.id_ruta].push(l);
  });

  const fecha = getHrDate();
  let added = 0;
  let hojasCreadas = 0;
  let errors = [];

  // Para cada ruta: buscar o crear la hoja del dia, luego anadir lineas
  for (const [rutaId, rutaLineas] of Object.entries(porRuta)) {
    let hojaId = null;

    // Buscar hoja existente para esta ruta y fecha
    try {
      const data = await api('hojas-ruta?fecha=' + fecha);
      const existing = (data.hojas || []).find(h => parseInt(h.id_ruta) === parseInt(rutaId));
      if (existing) {
        hojaId = existing.id;
      }
    } catch (e) { /* seguimos intentando crear */ }

    // Si no existe, crear la hoja
    if (!hojaId) {
      try {
        const newHoja = await api('hojas-ruta', 'POST', { id_ruta: parseInt(rutaId), fecha });
        hojaId = newHoja.id;
        hojasCreadas++;
      } catch (e) {
        // Puede ser duplicado (409), intentar buscar de nuevo
        if (e.message.includes('Ya existe')) {
          try {
            const data = await api('hojas-ruta?fecha=' + fecha);
            const existing = (data.hojas || []).find(h => parseInt(h.id_ruta) === parseInt(rutaId));
            if (existing) hojaId = existing.id;
          } catch (e2) { /* nada mas que hacer */ }
        }
        if (!hojaId) {
          const rn = excelParseData.found.find(f => f.id_ruta == rutaId)?.ruta_name || 'Ruta ' + rutaId;
          errors.push('No se pudo crear hoja para ' + rn + ': ' + e.message);
          continue;
        }
      }
    }

    // Anadir cada linea a la hoja
    for (const linea of rutaLineas) {
      try {
        await api('hojas-ruta/' + hojaId + '/lineas', 'POST', {
          id_cliente: linea.id_cliente,
          id_direccion: linea.id_direccion || null,
          carros: linea.carros,
          cajas: linea.cajas,
        });
        added++;
      } catch (e) {
        const client = excelParseData.found.find(f => f.id === linea.id_cliente);
        errors.push((client ? client.name : 'ID ' + linea.id_cliente) + ': ' + e.message);
      }
    }
  }

  closeModal('excelParseModal');
  await loadHojasRuta();

  let msg = added + ' lineas anadidas';
  if (hojasCreadas) msg += ', ' + hojasCreadas + ' hoja(s) creada(s)';
  if (activated) msg += ', ' + activated + ' cliente(s) activado(s)';
  if (errors.length) msg += '. Errores: ' + errors.join('; ');
  showToast(msg);
}

// ── DIRECCIONES DE ENTREGA (multi-address) ─────────────────
let currentClientAddresses = [];
let editingClientId = null;

function renderClientAddresses(addresses) {
  currentClientAddresses = addresses;
  const el = document.getElementById('cAddressList');
  if (!el) return;

  if (!addresses.length) {
    el.innerHTML = '<div style="padding:8px; color:var(--text-dim); font-size:13px">Sin direcciones de entrega registradas. Se usara la direccion fiscal.</div>';
    return;
  }

  el.innerHTML = addresses.map(a => {
    const star = a.principal == 1 ? '\u2605' : '\u2606';
    const starClass = a.principal == 1 ? 'color:#f59e0b' : 'color:#ccc; cursor:pointer';
    const addr = [a.direccion, a.codigo_postal, a.localidad].filter(Boolean).join(', ');
    return '<div class="vars-row" style="display:flex;align-items:flex-start; padding:6px 0; border-bottom:1px solid #eee">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600; font-size:13px">' + esc(a.descripcion || a.direccion) + '</div>' +
        '<div style="font-size:12px; color:#777">' + esc(addr) + '</div>' +
        (a.x ? '<div style="font-size:11px; color:#aaa">GPS: ' + Number(a.x).toFixed(4) + ', ' + Number(a.y).toFixed(4) + '</div>' : '<div style="font-size:11px; color:#e53e3e">\u26a0 Sin coordenadas</div>') +
      '</div>' +
      '<div style="display:flex; gap:4px; align-items:center">' +
        '<span style="' + starClass + '; font-size:18px" title="' + (a.principal == 1 ? 'Principal' : 'Marcar como principal') + '" ' +
          (a.principal != 1 ? 'onclick="setAddrPrincipal(' + a.id + ')"' : '') + '>' + star + '</span>' +
        '<button class="btn btn-secondary btn-sm" onclick="editAddress(' + a.id + ')" title="Editar">\u270e</button>' +
        (a.principal != 1 ? '<button class="btn btn-secondary btn-sm" onclick="deleteAddress(' + a.id + ')" title="Eliminar">\u2715</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function openAddressForm() {
  const form = document.getElementById('cAddressForm');
  form.classList.remove('d-none');
  document.getElementById('caId').value = '';
  document.getElementById('caDesc').value = '';
  document.getElementById('caAddr').value = '';
  document.getElementById('caCp').value = '';
  document.getElementById('caLoc').value = '';
  document.getElementById('caProv').value = '';
  document.getElementById('caPhone').value = '';
  document.getElementById('caX').value = '';
  document.getElementById('caY').value = '';
  document.getElementById('caTipoZona').value = 'villa';
  document.getElementById('caTipoNegocio').value = 'tienda_especializada';
}

function editAddress(id) {
  const a = currentClientAddresses.find(x => x.id == id);
  if (!a) return;
  const form = document.getElementById('cAddressForm');
  form.classList.remove('d-none');
  document.getElementById('caId').value = a.id;
  document.getElementById('caDesc').value = a.descripcion || '';
  document.getElementById('caAddr').value = a.direccion || '';
  document.getElementById('caCp').value = a.codigo_postal || '';
  document.getElementById('caLoc').value = a.localidad || '';
  document.getElementById('caProv').value = a.provincia || '';
  document.getElementById('caPhone').value = a.telefono || '';
  document.getElementById('caX').value = a.x || '';
  document.getElementById('caY').value = a.y || '';
  document.getElementById('caTipoZona').value = a.tipo_zona || 'villa';
  document.getElementById('caTipoNegocio').value = a.tipo_negocio || 'tienda_especializada';
}

function cancelAddressForm() {
  document.getElementById('cAddressForm').classList.add('d-none');
}

async function saveAddress() {
  const clientId = editingClientId;
  if (!clientId) return showToast('Error: no hay cliente seleccionado');

  const addrId = document.getElementById('caId').value;
  const data = {
    descripcion: document.getElementById('caDesc').value,
    direccion: document.getElementById('caAddr').value,
    codigo_postal: document.getElementById('caCp').value,
    localidad: document.getElementById('caLoc').value,
    provincia: document.getElementById('caProv').value,
    telefono: document.getElementById('caPhone').value,
    x: document.getElementById('caX').value || null,
    y: document.getElementById('caY').value || null,
    tipo_zona: document.getElementById('caTipoZona').value,
    tipo_negocio: document.getElementById('caTipoNegocio').value,
  };

  try {
    let addresses;
    if (addrId) {
      addresses = await api('clients/' + clientId + '/addresses/' + addrId, 'PUT', data);
    } else {
      addresses = await api('clients/' + clientId + '/addresses', 'POST', data);
    }
    renderClientAddresses(addresses);
    cancelAddressForm();
    showToast('Direccion guardada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteAddress(id) {
  const clientId = editingClientId;
  if (!clientId) return;
  appConfirm('\u00bfEliminar esta direccion de entrega?', async () => {
    try {
      const addresses = await api('clients/' + clientId + '/addresses/' + id, 'DELETE');
      renderClientAddresses(addresses);
      showToast('Direccion eliminada');
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  });
}

async function setAddrPrincipal(id) {
  const clientId = editingClientId;
  if (!clientId) return;
  try {
    const addresses = await api('clients/' + clientId + '/addresses/' + id + '/principal', 'PUT');
    renderClientAddresses(addresses);
    showToast('Direccion principal actualizada');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── SELECTOR DIRECCION EN PEDIDOS ──────────────────────────
function onOrderClientChange(clientId) {
  updateOrderAddressSelect(clientId);
}

function updateOrderAddressSelect(clientId) {
  const wrap = document.getElementById('pDireccionWrap');
  const sel = document.getElementById('pDireccion');
  if (!wrap || !sel) return;

  const client = clients.find(c => c.id == clientId);
  const dirs = client?.direcciones || [];

  if (dirs.length <= 1) {
    wrap.style.display = 'none';
    sel.innerHTML = '<option value="">Direccion principal</option>';
    return;
  }

  wrap.style.display = '';
  sel.innerHTML = dirs.map(d => {
    const addr = [d.direccion, d.localidad].filter(Boolean).join(', ');
    const label = d.descripcion ? d.descripcion + ' \u2014 ' + addr : addr;
    return '<option value="' + d.id + '"' + (d.principal == 1 ? ' selected' : '') + '>' + esc(label) + (d.principal == 1 ? ' \u2605' : '') + '</option>';
  }).join('');
}


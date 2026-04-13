// ═══════════════════════════════════════════════════════════════
// ═══ MODULO COMERCIAL: Pedidos del dia, pedido rapido, etc. ═══
// ═══════════════════════════════════════════════════════════════

let comercialPedidos = [];
let comQoSelectedClientId = null;
let comQoSearchQuery = '';

function switchComercialTab(tab) {
  const tabs = ['pedidos', 'nuevo', 'hojas'];
  tabs.forEach(function(t) {
    const key = t.charAt(0).toUpperCase() + t.slice(1);
    const view = document.getElementById('comView' + key);
    const btn = document.getElementById('comTab-' + t);
    if (view) view.style.display = t === tab ? 'flex' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'pedidos') loadComercialPedidos();
  if (tab === 'hojas') loadHojasRuta();
  if (tab === 'nuevo') comQoFilterClients(comQoSearchQuery);
}

// ── Mis Pedidos del dia ──

async function loadComercialPedidos() {
  const date = getHrDate();
  try {
    comercialPedidos = await api('orders/comercial-day?date=' + date);
  } catch (e) {
    comercialPedidos = [];
  }
  renderComercialPedidos();
}

function findHojaLineaForClient(clientId) {
  for (const hoja of hojasData.hojas || []) {
    const linea = (hoja.lineas || []).find(function(l) {
      return parseInt(l.client_id, 10) === parseInt(clientId, 10);
    });
    if (linea) return linea;
  }
  return null;
}

function renderComercialPedidos() {
  const el = document.getElementById('comPedidosList');
  if (!el) return;

  // Resumen: solo pedidos no anulados
  const activos = comercialPedidos.filter(function(p) { return p.estado !== 'anulado'; });
  let sumCarros = 0, sumCajas = 0;
  activos.forEach(function(p) {
    const hl = findHojaLineaForClient(p.client_id);
    if (hl) {
      sumCarros += numVal(hl.carros);
      sumCajas += numVal(hl.cajas);
    }
  });

  const sumEl = document.getElementById('comSumClientes');
  if (sumEl) sumEl.textContent = activos.length;
  const sumCarrosEl = document.getElementById('comSumCarros');
  if (sumCarrosEl) sumCarrosEl.textContent = formatQty(sumCarros);
  const sumCajasEl = document.getElementById('comSumCajas');
  if (sumCajasEl) sumCajasEl.textContent = formatQty(sumCajas);

  // Badges
  const badge = document.getElementById('comBadgePedidos');
  if (badge) {
    badge.textContent = activos.length;
    badge.classList.toggle('green', activos.length > 0);
  }
  const hojasBadge = document.getElementById('comBadgeHojas');
  if (hojasBadge) hojasBadge.textContent = hojasData.hojas.length;

  if (!comercialPedidos.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#128230;</div>No tienes pedidos para este dia.<br>Pulsa <b>+ Pedido</b> para crear uno.</div>';
    return;
  }

  const isToday = getHrDate() === todayStr();
  let html = '';
  comercialPedidos.forEach(function(p) {
    const estadoCls = 'com-pedido-estado-' + (p.estado || 'pendiente');
    const cardCls = p.estado === 'anulado' ? 'anulado' : '';
    const hl = findHojaLineaForClient(p.client_id);
    const carros = hl ? numVal(hl.carros) : 0;
    const cajas = hl ? numVal(hl.cajas) : 0;

    let itemsHtml = '';
    if (carros > 0) itemsHtml += '<span class="pill open">' + formatQty(carros) + ' carros</span>';
    if (cajas > 0) itemsHtml += '<span class="pill open">' + formatQty(cajas) + ' cajas</span>';
    (p.items || []).forEach(function(it) {
      if (it.name) itemsHtml += '<span class="pill">' + esc(it.name) + ': ' + it.qty + '</span>';
    });

    let actionsHtml = '';
    if (isToday && p.estado !== 'anulado') {
      actionsHtml = '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();comAnularPedido(' + p.id + ')">Anular</button>';
    } else if (isToday && p.estado === 'anulado') {
      actionsHtml = '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();comReactivarPedido(' + p.id + ')">Reactivar</button>';
    }

    html += '<div class="com-pedido-card ' + esc(cardCls) + '">'
      + '<div class="com-pedido-card-top">'
      + '<div class="com-pedido-card-name">' + esc(p.client_name) + '</div>'
      + '<span class="com-pedido-card-estado ' + estadoCls + '">' + esc(p.estado || 'pendiente') + '</span>'
      + '</div>'
      + (p.client_address ? '<div class="com-pedido-card-addr">' + esc(p.client_address) + '</div>' : '')
      + (itemsHtml ? '<div class="com-pedido-card-items">' + itemsHtml + '</div>' : '')
      + (p.observaciones ? '<div class="com-pedido-card-obs">' + esc(p.observaciones) + '</div>' : '')
      + (actionsHtml ? '<div class="com-pedido-card-actions">' + actionsHtml + '</div>' : '')
      + '</div>';
  });

  el.innerHTML = html;
}

// ── Anular / Reactivar pedido ──

async function comAnularPedido(orderId) {
  var p = comercialPedidos.find(function(x) { return x.id === orderId; });
  var name = p ? p.client_name : 'este pedido';
  var ok = await appConfirm('¿Anular el pedido de <b>' + esc(name) + '</b>?<br><span style="font-size:11px;color:var(--text-dim)">Podras reactivarlo mas tarde si lo necesitas.</span>', {
    title: 'Anular pedido',
    okText: 'Anular',
    danger: true,
  });
  if (!ok) return;
  try {
    await api('orders/' + orderId + '/estado', 'PUT', { estado: 'anulado' });
    showToast('Pedido anulado');
    await loadComercialPedidos();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function comReactivarPedido(orderId) {
  try {
    await api('orders/' + orderId + '/estado', 'PUT', { estado: 'pendiente' });
    showToast('Pedido reactivado');
    await loadComercialPedidos();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── Pedido rapido (Quick Order) ──

function comQoFilterClients(query) {
  comQoSearchQuery = query || '';
  const el = document.getElementById('comQoClientList');
  if (!el) return;

  const ids = getUserComercialIds();
  let rows = activeClients().filter(function(c) { return c.ruta_id; });
  if (ids.length) {
    rows = rows.filter(function(c) { return clientMatchesCommercialIds(c, ids); });
  }

  const q = comQoSearchQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter(function(c) {
      const haystack = [c.name, c.addr, c.ruta_name].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  rows.sort(function(a, b) { return a.name.localeCompare(b.name, 'es'); });
  const shown = rows.slice(0, 20);

  if (!shown.length && q) {
    el.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-dim);font-size:12px">Sin resultados</div>';
    return;
  }
  if (!shown.length) {
    el.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-dim);font-size:12px">Escribe para buscar clientes</div>';
    return;
  }

  let html = '';
  shown.forEach(function(c) {
    html += '<div class="comercial-qo-client-item" onclick="comQoSelectClient(' + c.id + ')">'
      + '<div class="comercial-qo-client-item-name">' + esc(c.name) + '</div>'
      + (c.addr ? '<div class="comercial-qo-client-item-addr">' + esc(c.addr) + '</div>' : '')
      + '<div class="comercial-qo-client-item-ruta">' + esc(c.ruta_name || 'Sin ruta') + '</div>'
      + '</div>';
  });
  el.innerHTML = html;
}

function comQoSelectClient(clientId) {
  const c = clients.find(function(cl) { return cl.id === clientId; });
  if (!c) return;

  comQoSelectedClientId = clientId;

  document.getElementById('comQoClientSearch').style.display = 'none';
  document.getElementById('comQoClientList').style.display = 'none';
  const sel = document.getElementById('comQoSelectedClient');
  sel.style.display = 'flex';
  document.getElementById('comQoSelectedName').textContent = c.name;
  document.getElementById('comQoSelectedAddr').textContent = c.addr || '';

  // Show form fields
  document.getElementById('comQoFormFields').style.display = 'block';
  document.getElementById('comQoCarros').value = '';
  document.getElementById('comQoCajas').value = '';
  document.getElementById('comQoObs').value = '';
  document.getElementById('comQoCarros').focus();
}

function comQoClearClient() {
  comQoSelectedClientId = null;
  document.getElementById('comQoClientSearch').style.display = '';
  document.getElementById('comQoClientList').style.display = '';
  document.getElementById('comQoSelectedClient').style.display = 'none';
  document.getElementById('comQoFormFields').style.display = 'none';
  const searchInput = document.getElementById('comQoClientSearch');
  if (searchInput) comQoFilterClients(searchInput.value);
}

async function comQoSave() {
  if (!comQoSelectedClientId) return showToast('Selecciona un cliente');

  const client = clients.find(function(c) { return c.id === comQoSelectedClientId; });
  if (!client) return showToast('Cliente no encontrado');

  const carros = numVal(document.getElementById('comQoCarros').value);
  const cajas = numVal(document.getElementById('comQoCajas').value);
  const obs = (document.getElementById('comQoObs').value || '').trim();

  if (carros <= 0 && cajas <= 0) return showToast('Indica al menos carros o cajas');

  const date = getHrDate();
  const comercialIds = getUserComercialIds();
  const comercialId = pickClientCommercialId(client, comercialIds);

  try {
    // 1. Crear pedido en orders
    await api('orders', 'POST', {
      client_id: client.id,
      date: date,
      items: [],
      notes: '',
      comercial_id: comercialId,
      observaciones: obs,
      estado: 'pendiente',
    });

    // 2. Crear/actualizar linea en hoja de ruta
    if (client.ruta_id) {
      let hoja = null;
      for (let i = 0; i < (hojasData.hojas || []).length; i++) {
        if (parseInt(hojasData.hojas[i].ruta_id, 10) === client.ruta_id) {
          hoja = hojasData.hojas[i];
          break;
        }
      }
      if (!hoja) {
        const created = await api('hojas-ruta', 'POST', { ruta_id: client.ruta_id, fecha: date });
        hoja = await api('hojas-ruta/' + created.id);
      }

      const existingLinea = (hoja.lineas || []).find(function(l) {
        return parseInt(l.client_id, 10) === client.id;
      });
      if (existingLinea) {
        await api('hojas-ruta/' + hoja.id + '/lineas/' + existingLinea.id, 'PUT', {
          carros: carros, cajas: cajas, observaciones: obs,
        });
      } else {
        await api('hojas-ruta/' + hoja.id + '/lineas', 'POST', {
          client_id: client.id,
          comercial_id: comercialId,
          carros: carros, cajas: cajas,
          zona: client.addr || '',
          observaciones: obs,
        });
      }
    }

    showToast('Pedido guardado');

    // Reset form
    comQoClearClient();
    const searchInput = document.getElementById('comQoClientSearch');
    if (searchInput) searchInput.value = '';
    comQoFilterClients('');

    // Reload data
    await loadHojasRuta();
    await loadComercialPedidos();

    // Switch to pedidos tab
    switchComercialTab('pedidos');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ── Boton "+" inline en hojas de ruta para pedido rapido ──

function comQuickAddFromHoja(clientId) {
  comQoSelectClient(clientId);
  switchComercialTab('nuevo');
}

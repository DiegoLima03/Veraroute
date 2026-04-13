<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VeraRoute — Gestor de Rutas</title>
<link rel="stylesheet" href="public/vendor/leaflet/leaflet.css" />
<link rel="stylesheet" href="public/css/app.css?v=<?= time() ?>">
<link rel="stylesheet" href="public/vendor/bootstrap-icons/bootstrap-icons.min.css">
</head>
<body>
<?php $u = Auth::currentUser(); ?>
<script>
  var APP_USER = <?= json_encode([
    'id'           => $u['id'] ?? null,
    'username'     => $u['username'] ?? '',
    'full_name'    => $u['full_name'] ?? '',
    'role'         => $u['role'] ?? '',
    'comercial_id' => $u['comercial_id'] ?? null,
    'comercial_ids'=> Auth::comercialIds(),
  ]) ?>;
  var CSRF_TOKEN = <?= json_encode(Auth::csrfToken()) ?>;
</script>

<header class="header">
  <div class="logo">Vera<span>Route</span></div>
  <div class="badge">v3.0</div>
  <?php if ($u['role'] === 'admin'): ?>
  <button class="btn-vars" onclick="openVarsModal()" title="Variables de calculo">&#9881; Variables</button>
  <?php endif; ?>
  <?php if ($u['role'] !== 'comercial'): ?>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val" id="sClientes">0</div><div class="stat-label">Clientes</div></div>
    <div class="stat"><div class="stat-val" id="sPedidos">0</div><div class="stat-label">Con pedido</div></div>
    <div class="stat"><div class="stat-val" id="sVehicles">0</div><div class="stat-label">Vehiculos</div></div>
    <div class="stat"><div class="stat-val" id="sDist">—</div><div class="stat-label">Km total</div></div>
    <div class="stat"><div class="stat-val" id="sTime">—</div><div class="stat-label">Horas</div></div>
  </div>
  <?php endif; ?>
  <?php if ($u): ?>
  <div class="user-info">
    <span class="user-name"><?= htmlspecialchars($u['full_name'] ?: $u['username']) ?></span>
    <span class="user-role-badge"><?= htmlspecialchars(strtoupper($u['role'])) ?></span>
    <a href="logout" class="btn-logout" title="Cerrar sesion">Salir</a>
  </div>
  <?php endif; ?>
</header>

<?php if ($u['role'] === 'comercial'): ?>
<!-- ═══ VISTA COMERCIAL: mobile-first con pestanas ═══ -->
<div class="main comercial-main">
  <div class="panel comercial-panel">
    <input type="hidden" id="rDate" value="">
    <span id="bhr" style="display:none">0</span>

    <!-- Tabs comercial -->
    <div class="tabs comercial-tabs">
      <button class="tab active" id="comTab-pedidos" onclick="switchComercialTab('pedidos')">Mis Pedidos <span class="tab-badge" id="comBadgePedidos">0</span></button>
      <button class="tab" id="comTab-nuevo" onclick="switchComercialTab('nuevo')">+ Pedido</button>
      <button class="tab" id="comTab-hojas" onclick="switchComercialTab('hojas')">Hojas Ruta <span class="tab-badge" id="comBadgeHojas">0</span></button>
    </div>

    <!-- Barra fecha compartida -->
    <div class="date-bar comercial-date-bar">
      <div class="comercial-date-stack">
        <button class="btn btn-secondary btn-sm comercial-date-today" onclick="setHrToday()">Hoy</button>
        <div class="comercial-date-nav">
          <button class="btn btn-secondary btn-sm" onclick="hrDateNav(-1)">&larr;</button>
          <input type="date" id="hrDate" onchange="onHrDateChange()">
          <button class="btn btn-secondary btn-sm" onclick="hrDateNav(1)">&rarr;</button>
        </div>
      </div>
    </div>

    <!-- ══ TAB: MIS PEDIDOS DEL DIA ══ -->
    <div id="comViewPedidos" class="comercial-view">
      <!-- Resumen del dia -->
      <div class="comercial-summary" id="comDaySummary">
        <div class="comercial-summary-card">
          <div class="comercial-summary-val" id="comSumClientes">0</div>
          <div class="comercial-summary-label">Clientes</div>
        </div>
        <div class="comercial-summary-card">
          <div class="comercial-summary-val" id="comSumCarros">0</div>
          <div class="comercial-summary-label">Carros</div>
        </div>
        <div class="comercial-summary-card">
          <div class="comercial-summary-val" id="comSumCajas">0</div>
          <div class="comercial-summary-label">Cajas</div>
        </div>
      </div>
      <div class="scroll-list" id="comPedidosList">
        <div class="empty"><div class="empty-icon">&#128230;</div>Cargando pedidos...</div>
      </div>
    </div>

    <!-- ══ TAB: NUEVO PEDIDO RAPIDO ══ -->
    <div id="comViewNuevo" class="comercial-view" style="display:none">
      <div class="comercial-quick-order">
        <!-- Paso 1: Seleccionar cliente -->
        <div class="comercial-qo-section comercial-qo-section-fill">
          <div class="comercial-qo-label">Cliente</div>
          <input type="search" id="comQoClientSearch" placeholder="Buscar cliente por nombre..." oninput="comQoFilterClients(this.value)" autocomplete="off">
          <div id="comQoClientList" class="comercial-qo-client-list"></div>
          <div id="comQoSelectedClient" class="comercial-qo-selected" style="display:none">
            <div class="comercial-qo-selected-name" id="comQoSelectedName"></div>
            <div class="comercial-qo-selected-addr" id="comQoSelectedAddr"></div>
            <button class="btn btn-secondary btn-sm" onclick="comQoClearClient()">Cambiar</button>
          </div>
        </div>
        <!-- Paso 2: Cantidades -->
        <div class="comercial-qo-section" id="comQoFormFields" style="display:none">
          <div class="comercial-qo-label">Cantidades</div>
          <div class="comercial-qo-fields">
            <div class="comercial-qo-field">
              <label>Carros</label>
              <input type="number" id="comQoCarros" min="0" step="1" placeholder="0" inputmode="numeric">
            </div>
            <div class="comercial-qo-field">
              <label>Cajas</label>
              <input type="number" id="comQoCajas" min="0" step="1" placeholder="0" inputmode="numeric">
            </div>
          </div>
          <div class="comercial-qo-field" style="margin-top:8px">
            <label>Observaciones</label>
            <textarea id="comQoObs" placeholder="Notas del pedido..." rows="2"></textarea>
          </div>
          <button class="btn btn-primary comercial-qo-save" onclick="comQoSave()">Guardar pedido</button>
        </div>
      </div>
    </div>

    <!-- ══ TAB: HOJAS DE RUTA ══ -->
    <div id="comViewHojas" class="comercial-view" style="display:none">
      <!-- Vista listado (principal) -->
      <div id="hrListView" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
        <div class="scroll-list" id="hrList" style="flex:1">
          <div style="padding:40px 20px;text-align:center;color:var(--text-dim)">Cargando rutas...</div>
        </div>
      </div>

      <!-- Vista detalle de una hoja -->
      <div id="hrDetailView" style="display:none;flex-direction:column;flex:1;overflow:hidden">
        <div class="panel-header" style="gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="closeHojaDetail()">&larr; Volver</button>
          <div class="panel-title" id="hrDetailTitle" style="flex:1">--</div>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap;background:var(--surface);flex-shrink:0">
          <div style="display:flex;align-items:center;gap:4px;min-width:0;flex:1">
            <input id="hrClientSearch" type="search" placeholder="Buscar cliente..." autocomplete="off" oninput="setHojaClientSearch(this.value)" style="min-width:0;width:100%;padding:6px 10px;font-size:12px;border-radius:8px">
          </div>
        </div>
        <div class="scroll-list" id="hrLineasList" style="flex:1"></div>
        <div style="padding:10px 14px;border-top:1px solid var(--border);background:var(--surface);font-size:12px;display:flex;gap:16px;flex-shrink:0">
          <span><b id="hrTotalClientes">0</b> clientes</span>
          <span><b id="hrTotalCarros">0</b> carros</span>
          <span><b id="hrTotalCajas">0</b> cajas</span>
          <span id="hrRouteInfo" style="margin-left:auto;color:var(--accent);font-weight:700"></span>
        </div>
      </div>
    </div>

  </div>
</div>

<?php else: ?>
<!-- ═══ VISTA ADMIN / LOGISTICA ═══ -->
<div class="main main-resizable" id="appMain">
  <div class="panel">
    <div class="tabs">
      <button class="tab active" id="tab-c" onclick="switchTab('c')">Clientes <span class="tab-badge green" id="bc">0</span></button>
      <button class="tab" id="tab-hr" onclick="switchTab('hr')">Hojas Ruta <span class="tab-badge" id="bhr">0</span></button>
      <button class="tab" id="tab-f" onclick="switchTab('f')">Flota</button>
      <button class="tab" id="tab-h" onclick="switchTab('h')">Historial</button>
      <?php if ($u['role'] === 'admin'): ?>
      <button class="tab" id="tab-u" onclick="switchTab('u')">Usuarios</button>
      <?php endif; ?>
    </div>

    <!-- CLIENTES -->
    <div id="vc" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
      <div class="panel-header">
        <div class="panel-title">Cartera de clientes</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary" onclick="openClientModal()">+ Nuevo</button>
        </div>
      </div>
      <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Buscar cliente por nombre o direccion..." oninput="onSearch(this.value)">
        <div class="search-meta">
          <span id="filterCount">0</span>
          <div class="filter-btns">
            <button class="btn btn-secondary btn-sm active-filter" id="btnFilterActive" onclick="setFilterMode('active')">Activos</button>
            <button class="btn btn-secondary btn-sm" id="btnFilterInactive" onclick="setFilterMode('inactive')">Inactivos</button>
          </div>
        </div>
      </div>
      <div class="scroll-list" id="clientList"></div>
    </div>

    <!-- Fecha interna para pedidos/mapa (oculto) -->
    <input type="hidden" id="rDate" value="">

    <!-- HOJAS DE RUTA -->
    <div id="vhr" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="date-bar">
        <div class="date-label">Fecha</div>
        <input type="date" id="hrDate" onchange="onHrDateChange()">
        <button class="btn btn-secondary btn-sm" onclick="hrDateNav(-1)" title="Dia anterior">&larr;</button>
        <button class="btn btn-secondary btn-sm" onclick="setHrToday()">Hoy</button>
        <button class="btn btn-secondary btn-sm" onclick="hrDateNav(1)" title="Dia siguiente">&rarr;</button>
      </div>
      <!-- Panel listado de hojas (vista principal) -->
      <div id="hrListView" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
        <div class="panel-header">
          <div class="panel-title">Hojas del dia</div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-sm" id="btnGenerarDesde" onclick="generarHojasFromPedidos()" title="Generar hojas automaticamente desde pedidos confirmados" style="background:var(--accent2);border-color:var(--accent2)">Generar desde pedidos</button>
            <button class="btn btn-primary" onclick="openCreateHojaModal()">+ Nueva hoja</button>
          </div>
        </div>
        <!-- Panel resumen logistica: pedidos del dia -->
        <div id="hrPedidosPanel" style="display:none"></div>
        <div class="scroll-list" id="hrList"></div>
      </div>
      <!-- Vista detalle de una hoja -->
      <div id="hrDetailView" style="display:none;flex-direction:column;flex:1;overflow:hidden">
        <div class="panel-header" style="gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="closeHojaDetail()">&larr; Volver</button>
          <div class="panel-title" id="hrDetailTitle" style="flex:1">—</div>
          <span class="hr-estado-badge" id="hrDetailEstado"></span>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap;background:var(--surface);flex-shrink:0">
          <button class="btn btn-primary btn-sm" id="btnAddLinea" onclick="openAddLineaModal()">+ Cliente</button>
          <button class="btn btn-secondary btn-sm" onclick="autoOrdenarHoja()">Auto-ordenar</button>
          <button class="btn btn-secondary btn-sm" onclick="printHoja()">Imprimir</button>
          <button class="btn btn-secondary btn-sm" onclick="exportHojaHtml()">Email HTML</button>
          <button class="btn btn-secondary btn-sm" onclick="duplicarHoja()">Duplicar</button>
          <button class="btn btn-secondary btn-sm" id="btnCalcGlsCosts" onclick="calculateHojaGlsCosts()">Calcular paqueteria</button>
          <span id="hrGlsCalcStatus" style="align-self:center;font-size:10px;color:var(--text-dim)"></span>
          <div style="display:flex;align-items:center;gap:4px;min-width:220px;flex:0 1 280px">
            <input id="hrVehicleSearch" type="search" list="hrVehicleOptions" placeholder="Buscar vehiculo..." autocomplete="off" oninput="syncHojaVehicleSearch(this.value)" onchange="submitHojaVehicleSearch()" onkeydown="if(event.key==='Enter'){event.preventDefault();submitHojaVehicleSearch()}" style="min-width:0;padding:4px 8px;font-size:10px;border-radius:6px">
            <input type="hidden" id="hrVehicleId" value="">
            <datalist id="hrVehicleOptions"></datalist>
          </div>
          <select id="hrEstadoSel" onchange="changeHojaEstado(this.value)" style="width:auto;padding:4px 8px;font-size:10px;border-radius:6px">
            <option value="borrador">Borrador</option>
            <option value="cerrada">Cerrada</option>
            <option value="en_reparto">En reparto</option>
            <option value="completada">Completada</option>
          </select>
        </div>
        <div id="hrGlsSummary" class="hr-gls-summary" style="display:none"></div>
        <div class="scroll-list" id="hrLineasList" style="flex:1"></div>
        <div id="hrSimulationPanel" class="hr-sim-panel" style="display:none"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);background:var(--surface);font-size:11px;display:flex;gap:16px;flex-shrink:0">
          <span><b id="hrTotalClientes">0</b> clientes</span>
          <span><b id="hrTotalCarros">0</b> carros</span>
          <span><b id="hrTotalCajas">0</b> cajas</span>
          <span id="hrRouteInfo" style="margin-left:auto;color:var(--accent);font-weight:700"></span>
        </div>
      </div>
    </div>

    <!-- FLOTA -->
    <div id="vf" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="panel-header">
        <div class="panel-title">Delegaciones</div>
        <button class="btn btn-primary" onclick="openDelegationModal()">+ Delegacion</button>
      </div>
      <div class="scroll-list fleet-list" id="delegationList"></div>

      <div class="panel-header">
        <div class="panel-title">Vehiculos</div>
        <button class="btn btn-primary" onclick="openVehicleModal()">+ Vehiculo</button>
      </div>
      <div class="scroll-list fleet-list" id="vehicleList"></div>
    </div>

    <!-- HISTORIAL -->
    <div id="vh" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="panel-header">
        <div class="panel-title">Historial de rutas</div>
        <button class="btn btn-primary btn-sm" onclick="openRentabilityReport()" title="Informe rentabilidad GLS vs flota">Rentabilidad GLS</button>
      </div>
      <div class="date-bar" style="gap:6px;flex-wrap:wrap">
        <input type="date" id="hFrom" style="flex:1;min-width:110px;padding:4px 6px;font-size:11px">
        <span style="font-size:10px;color:var(--text-dim)">a</span>
        <input type="date" id="hTo" style="flex:1;min-width:110px;padding:4px 6px;font-size:11px">
        <button class="btn btn-secondary btn-sm" onclick="loadHistory()">Buscar</button>
      </div>
      <div class="scroll-list" id="historyList"></div>
      <div class="panel-header" style="border-top:1px solid var(--border)">
        <div class="panel-title">Dashboard</div>
        <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">Actualizar</button>
      </div>
      <div id="dashboardPanel" style="padding:10px;font-size:11px;overflow-y:auto;flex:0.5"></div>
    </div>

    <?php if ($u['role'] === 'admin'): ?>
    <!-- USUARIOS -->
    <div id="vu" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="panel-header">
        <div class="panel-title">Gestion de usuarios</div>
        <button class="btn btn-primary" onclick="openUserModal()">+ Nuevo usuario</button>
      </div>
      <div class="scroll-list" id="userList"></div>
    </div>
    <?php endif; ?>

    <div class="optimize-bar" style="display:none">
      <button class="btn btn-primary" onclick="optimizeFleetRoutes()">Optimizar rutas</button>
      <button class="btn btn-secondary" onclick="clearRoute()" title="Limpiar">Limpiar</button>
      <button class="icon-btn" onclick="openSettingsModal()" title="Configuracion">&#9881;</button>
      <div class="clock" id="clock">--:--</div>
    </div>
  </div>

  <div class="main-resizer" id="mainResizer" role="separator" aria-orientation="vertical" title="Arrastra para ajustar el ancho del panel"></div>

  <div class="map-area">
    <div id="map"></div>
    <div class="legend">
      <div class="legend-item"><div class="ldot" style="background:#46331f"></div>Delegacion</div>
      <div class="legend-item"><div class="ldot" style="background:#8e8b30"></div>Con pedido (abierto)</div>
      <div class="legend-item"><div class="ldot" style="background:#d4a830"></div>En ruta optimizada</div>
      <div class="legend-item"><div class="ldot" style="background:#c83c32"></div>Cerrado / No visitable</div>
      <div class="legend-item"><div class="ldot" style="background:#85725e"></div>Sin pedido hoy</div>
    </div>
    <div class="route-panel" id="routePanel">
      <div class="route-header">
        <div class="rt">Rutas del dia</div>
        <div class="rm green" id="rDist">— km</div>
        <div class="rm orange" id="rTime">— h</div>
        <button class="btn-export" onclick="exportRoutesPrint()" title="Imprimir / PDF">&#128438;</button>
        <button class="btn-export" onclick="exportRoutesCSV()" title="Exportar CSV">&#128462;</button>
        <button class="btn-export" onclick="confirmRoutes()" title="Confirmar rutas" id="btnConfirm">&#10004;</button>
      </div>
      <div id="rStops"></div>
    </div>
  </div>
</div>
<?php endif; ?>

<!-- MODAL CLIENTE -->
<div class="overlay" id="cModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle" id="cModalTitle">Nuevo cliente</div>
      <button class="mclose" onclick="closeCModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="cId">
      <div class="msection">
        <div class="msec-title">Informacion del cliente</div>
        <div class="ff"><label>Nombre *</label><input id="cName" placeholder="Farmacia Central, Supermercado..."></div>
        <div class="fg">
          <div><label>Direccion / Referencia</label><input id="cAddr" placeholder="Calle, numero..."></div>
          <div><label>Codigo postal</label><input id="cPostcode" placeholder="ej. 36700" maxlength="10" oninput="updateClientPostcodeHint()"></div>
        </div>
        <div class="ff" id="cPostcodeHint" style="font-size:10px;color:var(--text-dim)">Sin codigo postal no se puede cotizar paqueteria.</div>
        <div class="fg">
          <div><label>Telefono</label><input id="cPhone" placeholder="600 000 000"></div>
          <div></div>
        </div>
        <div class="ff"><label>Notas internas</label><textarea id="cNotes" placeholder="Instrucciones de entrega, acceso, contacto..."></textarea></div>
        <div class="ff">
          <label>Rutas <span style="font-weight:400;text-transform:none;letter-spacing:0">(puede tener varias)</span></label>
          <div id="cRutasGrid" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px"></div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <input type="checkbox" id="cContado" style="width:auto"><label for="cContado" style="margin:0;cursor:pointer">Al contado</label>
        </div>
        <div class="ff">
          <label>Comercial asignado</label>
          <select id="cComercial"><option value="">Sin comercial</option></select>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Ubicacion (click en el mapa o introduce coordenadas)</div>
        <div class="fg">
          <div><label>Latitud *</label><input type="number" id="cX" placeholder="40.4168" step="0.000001"></div>
          <div><label>Longitud *</label><input type="number" id="cY" placeholder="-3.7038" step="0.000001"></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Horario semanal</div>
        <div id="cScheduleGrid" style="font-size:12px"></div>
      </div>
      <div class="msection">
        <div class="msec-title">Historial paqueteria</div>
        <div id="cGlsHistory" style="font-size:11px;color:var(--text-dim)">Sin historial de comparativa todavia.</div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-danger" id="cDeleteBtn" onclick="deleteFromModal()" style="display:none">Eliminar</button>
      <button class="btn btn-danger" id="cToggleBtn" onclick="toggleFromModal()" style="display:none">Desactivar</button>
      <button class="btn btn-secondary" id="cDuplicateBtn" onclick="duplicateFromModal()" style="margin-right:auto;display:none">Duplicar</button>
      <button class="btn btn-secondary" onclick="closeCModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveClient()">Guardar cliente</button>
    </div>
  </div>
</div>

<!-- MODAL DELEGACION -->
<div class="overlay" id="dModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle" id="dModalTitle">Nueva delegacion</div>
      <button class="mclose" onclick="closeDModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="dId">
      <div class="msection">
        <div class="msec-title">Informacion de la delegacion</div>
        <div class="ff"><label>Nombre *</label><input id="dName" placeholder="Delegacion Madrid, Delegacion Norte..."></div>
        <div class="fg">
          <div><label>Direccion</label><input id="dAddr" placeholder="Calle, numero..."></div>
          <div><label>Telefono</label><input id="dPhone" placeholder="600 000 000"></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Ubicacion (click en el mapa)</div>
        <div class="fg">
          <div><label>Latitud *</label><input type="number" id="dX" step="0.000001"></div>
          <div><label>Longitud *</label><input type="number" id="dY" step="0.000001"></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Horario de operacion</div>
        <div class="fg">
          <div><label>Apertura</label><input type="time" id="dOpen" value="06:00"></div>
          <div><label>Cierre</label><input type="time" id="dClose" value="22:00"></div>
        </div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeDModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveDelegation()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL VEHICULO -->
<div class="overlay" id="vModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle" id="vModalTitle">Nuevo vehiculo</div>
      <button class="mclose" onclick="closeVModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="vId">
      <div class="msection">
        <div class="msec-title">Informacion del vehiculo</div>
        <div class="fg">
          <div><label>Nombre *</label><input id="vName" placeholder="Camion 1, Furgoneta azul..."></div>
          <div><label>Matricula</label><input id="vPlate" placeholder="1234 ABC"></div>
        </div>
        <div class="ff"><label>Delegacion *</label><select id="vDelegationSel"></select></div>
      </div>
      <div class="msection">
        <div class="msec-title">Capacidad</div>
        <div class="fg">
          <div><label>Peso max (kg)</label><input type="number" id="vMaxWeight" placeholder="Sin limite" step="0.01"></div>
          <div><label>Volumen max (m3)</label><input type="number" id="vMaxVolume" placeholder="Sin limite" step="0.01"></div>
        </div>
        <div class="fg">
          <div><label>Max items</label><input type="number" id="vMaxItems" placeholder="Sin limite"></div>
        </div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeVModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveVehicle()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL SETTINGS -->
<div class="overlay" id="settingsModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle">Configuracion</div>
      <button class="mclose" onclick="closeSettingsModal()">x</button>
    </div>
    <div class="mbody">
      <div class="msection">
        <div class="msec-title">Almuerzo</div>
        <div class="fg">
          <div><label>Duracion (min)</label><input type="number" id="sLunchDur" value="60" min="0" max="120"></div>
          <div><label>Hora minima</label><input type="time" id="sLunchEarly" value="12:00"></div>
        </div>
        <div class="fg">
          <div><label>Hora maxima</label><input type="time" id="sLunchLate" value="15:30"></div>
          <div></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Tiempos</div>
        <div class="fg">
          <div><label>Tiempo base descarga (min)</label><input type="number" id="sBaseUnload" value="5" min="0" step="0.5"></div>
          <div><label>Velocidad media fallback (km/h)</label><input type="number" id="sSpeed" value="50" min="10" max="120"></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Plantillas guardadas</div>
        <div id="templateList" style="max-height:150px;overflow-y:auto"></div>
        <button class="add-item" onclick="saveCurrentAsTemplate()" id="btnSaveTemplate" style="display:none">+ Guardar ruta actual como plantilla</button>
      </div>
      <div class="msection" id="shippingSettingsSection">
        <div class="msec-title">Paqueteria por tablas</div>
        <div class="fg">
          <div><label>CP origen</label><input id="shipOriginPostcode" placeholder="36780"></div>
          <div><label>Pais origen</label><input id="shipOriginCountry" value="ES" maxlength="2"></div>
        </div>
        <div class="fg">
          <div>
            <label>Descuento negociado (multiplicador)</label>
            <input id="shipPriceMultiplier" type="number" min="0" max="5" step="0.0001" value="1.0000">
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px">1.0000 = sin descuento, 0.85 = 15% descuento</div>
          </div>
          <div>
            <label>Recargo combustible GLS (%)</label>
            <div style="display:flex;gap:4px">
              <input id="shipFuelPct" type="number" min="0" max="100" step="0.01" value="0.00" style="flex:1">
              <button type="button" class="btn btn-secondary btn-sm" onclick="updateFuelPctOnly()" title="Solo actualizar combustible">Aplicar</button>
            </div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Actualizable mensualmente. Consultar en viagalicia.com/tasa-energetica/</div>
          </div>
        </div>
        <div class="fg">
          <div style="grid-column:1/-1">
            <label>Codigos postales remotos (separados por coma)</label>
            <input id="shipRemotePrefixes" placeholder="07XX, 35XX, 38XX, ...">
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Prefijos de CP donde GLS aplica recargo de zona remota</div>
          </div>
        </div>
        <div class="fg">
          <div><label>Peso por carro (kg)</label><input id="shipWeightPerCarro" type="number" min="0" step="0.1" value="5.0"></div>
          <div><label>Peso por caja (kg)</label><input id="shipWeightPerCaja" type="number" min="0" step="0.1" value="2.5"></div>
        </div>
        <div class="msec-title" style="margin-top:14px">Variables de calculo</div>
        <div class="fg">
          <div><label>Bultos por carro</label><input id="shipParcelsPerCarro" type="number" min="0" step="0.01" value="1.00"></div>
          <div><label>Bultos por caja</label><input id="shipParcelsPerCaja" type="number" min="0" step="0.01" value="1.00"></div>
        </div>
        <div class="fg">
          <div><label>Volumen por carro (m3)</label><input id="shipVolumePerCarro" type="number" min="0" step="0.01" value="0"></div>
          <div><label>Volumen por caja (m3)</label><input id="shipVolumePerCaja" type="number" min="0" step="0.01" value="0"></div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
          <input type="checkbox" id="shipUseVolumetric" style="width:auto">
          <label for="shipUseVolumetric" style="margin:0;cursor:pointer">Usar peso volumetrico segun divisor del transportista</label>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px">
          Estas variables alimentan el peso facturable y el numero de bultos antes de consultar la tabla de tarifas. Si activas el volumetrico, el sistema usara el volumen en m3 multiplicado por el factor del transportista.
        </div>
      </div>
      <div class="msection" id="shippingRatesSection">
        <div class="msec-title">Tabla de tarifas</div>
        <div id="shippingRatesList" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px;background:var(--surface2)"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-primary btn-sm" type="button" onclick="openShippingRateModal()">+ Tarifa</button>
        </div>
      </div>
      <div class="msection" id="shippingAlertsSection">
        <div class="msec-title">Alertas de cobertura GLS</div>
        <div id="shippingAlertsContent" style="font-size:11px;color:var(--text-dim)">Cargando...</div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeSettingsModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveSettings()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL TARIFA PAQUETERIA -->
<div class="overlay" id="shippingRateModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:560px">
    <div class="mhead">
      <div class="mtitle" id="shippingRateModalTitle">Nueva tarifa</div>
      <button class="mclose" onclick="closeShippingRateModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="shippingRateId">
      <div class="fg">
        <div><label>Codigo transportista *</label><input id="shippingCarrierCode" placeholder="GLS, SEUR..."></div>
        <div><label>Nombre transportista *</label><input id="shippingCarrierName" placeholder="GLS, SEUR..."></div>
      </div>
      <div class="fg">
        <div><label>Servicio</label><input id="shippingServiceName" placeholder="24H, Economy..."></div>
        <div><label>Pais *</label><input id="shippingCountryCode" value="ES" maxlength="2"></div>
      </div>
      <div class="fg">
        <div><label>Prefijo postal</label><input id="shippingPostcodePrefix" placeholder="36 o 2800"></div>
        <div><label>Prioridad</label><input type="number" id="shippingPriority" value="100" step="1"></div>
      </div>
      <div class="fg">
        <div><label>Peso minimo (kg) *</label><input type="number" id="shippingWeightMin" value="0" min="0" step="0.01"></div>
        <div><label>Peso maximo (kg) *</label><input type="number" id="shippingWeightMax" value="1" min="0" step="0.01"></div>
      </div>
      <div class="fg">
        <div><label>Bultos min</label><input type="number" id="shippingParcelMin" min="0" step="1" placeholder="Opcional"></div>
        <div><label>Bultos max</label><input type="number" id="shippingParcelMax" min="0" step="1" placeholder="Opcional"></div>
      </div>
      <div class="fg">
        <div><label>Precio EUR *</label><input type="number" id="shippingPrice" min="0" step="0.0001"></div>
        <div style="display:flex;align-items:center;gap:6px;padding-top:18px">
          <input type="checkbox" id="shippingActive" checked style="width:auto">
          <label for="shippingActive" style="margin:0;cursor:pointer">Activa</label>
        </div>
      </div>
      <div class="ff"><label>Notas</label><input id="shippingNotes" placeholder="Observaciones opcionales"></div>
    </div>
    <div class="mfoot">
      <button class="btn btn-danger" id="shippingDeleteBtn" onclick="deleteShippingRate()" style="display:none;margin-right:auto">Eliminar</button>
      <button class="btn btn-secondary" onclick="closeShippingRateModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveShippingRate()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL CREAR HOJA -->
<div class="overlay" id="hrCreateModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:380px">
    <div class="mhead">
      <div class="mtitle">Nueva hoja de ruta</div>
      <button class="mclose" onclick="closeHrCreateModal()">x</button>
    </div>
    <div class="mbody">
      <div class="ff"><label>Ruta *</label><select id="hrNewRuta"></select></div>
      <div class="ff"><label>Responsable</label><input id="hrNewResp" placeholder="Fran, Jose, Elvis..."></div>
      <div class="ff"><label>Notas</label><textarea id="hrNewNotas" placeholder="Notas generales..."></textarea></div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeHrCreateModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createHoja()">Crear</button>
    </div>
  </div>
</div>

<!-- MODAL AÑADIR CLIENTE A HOJA -->
<div class="overlay" id="hrAddLineaModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:440px">
    <div class="mhead">
      <div class="mtitle">Añadir cliente a la hoja</div>
      <button class="mclose" onclick="closeAddLineaModal()">x</button>
    </div>
    <div class="mbody">
      <div class="ff"><label>Buscar cliente</label><input id="hrLineaSearch" placeholder="Nombre del cliente..." oninput="filterLineaClients(this.value)"></div>
      <div id="hrLineaClientList" style="max-height:200px;overflow-y:auto;overflow-x:hidden;margin-bottom:10px"></div>
      <div class="fg">
        <div><label>Carros</label><input type="number" id="hrLineaCarros" step="1" min="0" placeholder="0"></div>
        <div><label>Cajas</label><input type="number" id="hrLineaCajas" step="1" min="0" placeholder="0"></div>
      </div>
      <div class="ff"><label>Observaciones</label><input id="hrLineaObs" placeholder="Direccion, llamar antes..."></div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeAddLineaModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="addLineasToHoja()">Añadir</button>
    </div>
  </div>
</div>

<!-- MODAL EDITAR LINEA -->
<div class="overlay" id="hrEditLineaModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:380px">
    <div class="mhead">
      <div class="mtitle" id="hrEditLineaTitle">Editar linea</div>
      <button class="mclose" onclick="closeEditLineaModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="hrEditLineaId">
      <div class="fg">
        <div id="hrEditComercialWrap"><label>Comercial</label><select id="hrEditComercial"><option value="">—</option></select></div>
        <div><label>Carros</label><input type="number" id="hrEditCarros" step="1" min="0"></div>
        <div><label>Cajas</label><input type="number" id="hrEditCajas" step="1" min="0"></div>
      </div>
      <div class="ff"><label>Zona</label><input id="hrEditZona"></div>
      <div class="ff"><label>Observaciones</label><input id="hrEditObs"></div>
      <div class="ff"><label>Estado</label>
        <select id="hrEditEstado">
          <option value="pendiente">Pendiente</option>
          <option value="entregado">Entregado</option>
          <option value="cancelado">Cancelado</option>
          <option value="no_entregado">No entregado</option>
        </select>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-danger" onclick="removeLineaFromModal()">Quitar</button>
      <button class="btn btn-secondary" onclick="closeEditLineaModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveEditLinea()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL USUARIO -->
<div class="overlay" id="uModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:520px">
    <div class="mhead">
      <div class="mtitle" id="uModalTitle">Nuevo usuario</div>
      <button class="mclose" onclick="closeUserModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="uId">
      <div class="msection">
        <div class="msec-title">Datos de acceso</div>
        <div class="fg">
          <div><label>Usuario *</label><input id="uUsername" placeholder="nombre.usuario"></div>
          <div><label>Nombre completo</label><input id="uFullName" placeholder="Pedro Garcia"></div>
        </div>
        <div class="fg">
          <div><label id="uPassLabel">Contraseña *</label><input type="password" id="uPassword" placeholder="Min. 4 caracteres"></div>
          <div><label>Rol *</label>
            <select id="uRole" onchange="onUserRoleChange()">
              <option value="comercial">Comercial</option>
              <option value="logistica">Logistica</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>
      </div>
      <div class="msection" id="uComercialesSection">
        <div class="msec-title">Comerciales asociados</div>
        <div id="uComercialesList" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px"></div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-danger" id="uDeleteBtn" onclick="deleteUser()" style="display:none;margin-right:auto">Eliminar</button>
      <button class="btn btn-secondary" onclick="closeUserModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveUser()">Guardar</button>
    </div>
  </div>
</div>

<!-- MODAL VARIABLES DE CALCULO (admin only) -->
<div class="overlay" id="varsModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:840px;max-width:96vw">
    <div class="mhead">
      <div class="mtitle">Variables de calculo</div>
      <button class="mclose" onclick="closeVarsModal()">x</button>
    </div>
    <div class="mbody" style="max-height:75vh;overflow-y:auto">
      <div class="vars-tabs">
        <button type="button" class="vars-tab active" data-vars-tab="app" onclick="switchVarsTab('app')">App</button>
        <button type="button" class="vars-tab" data-vars-tab="gls" onclick="switchVarsTab('gls')">Paqueteria GLS</button>
        <button type="button" class="vars-tab" data-vars-tab="vehicles" onclick="switchVarsTab('vehicles')">Vehiculos</button>
        <button type="button" class="vars-tab" data-vars-tab="routes" onclick="switchVarsTab('routes')">Colores rutas</button>
      </div>

      <!-- ── APP ── -->
      <div class="vars-section active" data-vars-section="app">
        <div class="vars-group">
          <div class="vars-group-title">Optimizacion de rutas</div>
          <div class="vars-row">
            <div>
              <label>Velocidad media (km/h)</label>
              <div class="help">Usado para calcular tiempo cuando no hay datos OSRM</div>
            </div>
            <input type="number" id="vSpeed" min="1" step="1">
          </div>
          <div class="vars-row">
            <div>
              <label>Tiempo base de descarga (min)</label>
              <div class="help">Minutos por parada antes de carga adicional</div>
            </div>
            <input type="number" id="vBaseUnload" min="0" step="1">
          </div>
        </div>
        <div class="vars-group">
          <div class="vars-group-title">Pausa de comida</div>
          <div class="vars-row">
            <div><label>Duracion (min)</label></div>
            <input type="number" id="vLunchDur" min="0" step="5">
          </div>
          <div class="vars-row">
            <div><label>Hora minima</label></div>
            <input type="time" id="vLunchEarly">
          </div>
          <div class="vars-row">
            <div><label>Hora maxima</label></div>
            <input type="time" id="vLunchLate">
          </div>
        </div>
      </div>

      <!-- ── GLS ── -->
      <div class="vars-section" data-vars-section="gls">
        <div class="vars-group">
          <div class="vars-group-title">Origen y descuento negociado</div>
          <div class="vars-row">
            <div><label>CP origen</label><div class="help">CP del almacen de salida</div></div>
            <input type="text" id="vGlsOriginCp" placeholder="36214">
          </div>
          <div class="vars-row">
            <div><label>Pais origen</label></div>
            <input type="text" id="vGlsOriginCountry" maxlength="2" placeholder="ES">
          </div>
          <div class="vars-row">
            <div>
              <label>Descuento (multiplicador)</label>
              <div class="help">1.0000 = sin descuento, 0.85 = 15% descuento</div>
            </div>
            <input type="number" id="vGlsMultiplier" min="0" max="5" step="0.0001">
          </div>
          <div class="vars-row">
            <div>
              <label>Recargo combustible (%)</label>
              <div class="help">Actualizable mensualmente</div>
            </div>
            <input type="number" id="vGlsFuelPct" min="0" max="100" step="0.01">
          </div>
          <div class="vars-row">
            <div>
              <label>Codigos postales remotos</label>
              <div class="help">Prefijos separados por coma</div>
            </div>
            <input type="text" id="vGlsRemotePrefixes" placeholder="07XX, 35XX, ...">
          </div>
        </div>
        <div class="vars-group">
          <div class="vars-group-title">Equivalencia carga -> peso (para tarifas)</div>
          <div class="vars-row">
            <div><label>Peso por carro (kg)</label></div>
            <input type="number" id="vGlsKgCarro" min="0" step="0.1">
          </div>
          <div class="vars-row">
            <div><label>Peso por caja (kg)</label></div>
            <input type="number" id="vGlsKgCaja" min="0" step="0.1">
          </div>
          <div class="vars-row">
            <div><label>Bultos por carro</label></div>
            <input type="number" id="vGlsParcCarro" min="0" step="0.01">
          </div>
          <div class="vars-row">
            <div><label>Bultos por caja</label></div>
            <input type="number" id="vGlsParcCaja" min="0" step="0.01">
          </div>
          <div class="vars-row">
            <div><label>Volumen por carro (cm³)</label></div>
            <input type="number" id="vGlsVolCarro" min="0" step="1">
          </div>
          <div class="vars-row">
            <div><label>Volumen por caja (cm³)</label></div>
            <input type="number" id="vGlsVolCaja" min="0" step="1">
          </div>
          <div class="vars-row">
            <div>
              <label>Usar peso volumetrico</label>
              <div class="help">Aplica el divisor del transportista (180 kg/m³ para GLS)</div>
            </div>
            <select id="vGlsUseVol">
              <option value="0">No</option>
              <option value="1">Si</option>
            </select>
          </div>
        </div>
      </div>

      <!-- ── VEHICULOS ── -->
      <div class="vars-section" data-vars-section="vehicles">
        <div class="vars-group">
          <div class="vars-group-title">Coste por km de cada vehiculo</div>
          <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">
            Es la base del calculo de coste de flota propia. Si esta a 0 el vehiculo no tendra coste y la comparativa con GLS no funcionara.
          </div>
          <div id="varsVehiclesList" style="max-height:380px;overflow-y:auto"></div>
        </div>
      </div>

      <!-- â”€â”€ COLORES RUTAS â”€â”€ -->
      <div class="vars-section" data-vars-section="routes">
        <div class="vars-group">
          <div class="vars-group-title">Colores de rutas</div>
          <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">
            Este color se usa en los circulitos de los clientes, las etiquetas y los chips de ruta.
          </div>
          <div id="varsRoutesList" class="vars-route-list" style="max-height:380px;overflow-y:auto"></div>
        </div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeVarsModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveVars()">Guardar todo</button>
    </div>
  </div>
</div>

<!-- MODAL INFORME DE RENTABILIDAD GLS -->
<div class="overlay" id="rentReportModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:880px;max-width:96vw">
    <div class="mhead">
      <div class="mtitle">Informe de rentabilidad: flota propia vs GLS</div>
      <button class="mclose" onclick="closeRentabilityReport()">x</button>
    </div>
    <div class="mbody" style="max-height:75vh;overflow-y:auto">
      <div class="fg" style="margin-bottom:10px">
        <div><label>Desde</label><input type="date" id="rentFrom"></div>
        <div><label>Hasta</label><input type="date" id="rentTo"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="loadRentabilityReport()">Calcular</button></div>
      </div>
      <div id="rentReportContent" style="font-size:11px"></div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeRentabilityReport()">Cerrar</button>
    </div>
  </div>
</div>

<!-- MODAL CONFIRMACION GLOBAL -->
<div class="overlay" id="confirmModal" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal" style="width:360px">
    <div class="mhead">
      <div class="mtitle" id="confirmTitle">Confirmar</div>
      <button class="mclose" onclick="closeConfirmModal(false)">x</button>
    </div>
    <div class="mbody">
      <p id="confirmMsg" style="margin:0;font-size:13px;line-height:1.5;color:var(--text-main)"></p>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" id="confirmCancelBtn" onclick="closeConfirmModal(false)">Cancelar</button>
      <button class="btn btn-danger" id="confirmOkBtn" onclick="closeConfirmModal(true)">Confirmar</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<?php if ($u['role'] !== 'comercial'): ?>
<script src="public/vendor/leaflet/leaflet.js"></script>
<link rel="stylesheet" href="public/vendor/leaflet-markercluster/MarkerCluster.css">
<script src="public/vendor/leaflet-markercluster/leaflet.markercluster.js"></script>
<script src="public/vendor/sortable/Sortable.min.js"></script>
<?php endif; ?>
<script src="public/js/app-core.js?v=<?= time() ?>"></script>
<script src="public/js/app-map.js?v=<?= time() ?>"></script>
<script src="public/js/app-entities.js?v=<?= time() ?>"></script>
<script src="public/js/app-routes.js?v=<?= time() ?>"></script>
<script src="public/js/app-gls.js?v=<?= time() ?>"></script>
<script src="public/js/app-hojas.js?v=<?= time() ?>"></script>
<?php if (($u['role'] ?? '') === 'comercial'): ?>
<script src="public/js/comercial.js?v=<?= time() ?>"></script>
<?php endif; ?>
</body>
</html>

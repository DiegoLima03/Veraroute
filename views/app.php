<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VeraRoute — Gestor de Rutas</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="public/css/app.css">
</head>
<body>

<header class="header">
  <div class="logo">Vera<span>Route</span></div>
  <div class="badge">v3.0</div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val" id="sClientes">0</div><div class="stat-label">Clientes</div></div>
    <div class="stat"><div class="stat-val" id="sPedidos">0</div><div class="stat-label">Con pedido</div></div>
    <div class="stat"><div class="stat-val" id="sVehicles">0</div><div class="stat-label">Vehiculos</div></div>
    <div class="stat"><div class="stat-val" id="sDist">—</div><div class="stat-label">Km total</div></div>
    <div class="stat"><div class="stat-val" id="sTime">—</div><div class="stat-label">Horas</div></div>
  </div>
</header>

<div class="main">
  <div class="panel">
    <div class="tabs">
      <button class="tab active" id="tab-c" onclick="switchTab('c')">Clientes <span class="tab-badge green" id="bc">0</span></button>
      <button class="tab" id="tab-p" onclick="switchTab('p')">Pedidos <span class="tab-badge orange" id="bp">0</span></button>
      <button class="tab" id="tab-f" onclick="switchTab('f')">Flota</button>
      <button class="tab" id="tab-h" onclick="switchTab('h')">Historial</button>
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

    <!-- PEDIDOS -->
    <div id="vp" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="date-bar">
        <div class="date-label">Fecha</div>
        <input type="date" id="rDate" onchange="onDateChange()">
        <button class="btn btn-secondary" onclick="setToday();onDateChange()">Hoy</button>
      </div>
      <div class="panel-header">
        <div class="panel-title">Pedidos registrados</div>
        <button class="btn btn-primary" onclick="openOrderModal(null)">+ Pedido</button>
      </div>
      <div class="scroll-list" id="pedidosList"></div>
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

    <div class="optimize-bar">
      <button class="btn btn-primary" onclick="optimizeFleetRoutes()">Optimizar rutas</button>
      <button class="btn btn-secondary" onclick="clearRoute()" title="Limpiar">Limpiar</button>
      <button class="icon-btn" onclick="openSettingsModal()" title="Configuracion">&#9881;</button>
      <div class="clock" id="clock">--:--</div>
    </div>
  </div>

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

<!-- MODAL CLIENTE -->
<div class="overlay" id="cModal">
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
          <div><label>Telefono</label><input id="cPhone" placeholder="600 000 000"></div>
        </div>
        <div class="ff"><label>Notas internas</label><textarea id="cNotes" placeholder="Instrucciones de entrega, acceso, contacto..."></textarea></div>
        <div class="ff"><label>Ruta</label><select id="cRuta"><option value="">Sin ruta</option></select></div>
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
    </div>
    <div class="mfoot">
      <button class="btn btn-danger" id="cDeleteBtn" onclick="deleteFromModal()" style="display:none">Eliminar</button>
      <button class="btn btn-danger" id="cToggleBtn" onclick="toggleFromModal()" style="margin-right:auto;display:none">Desactivar</button>
      <button class="btn btn-secondary" onclick="closeCModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveClient()">Guardar cliente</button>
    </div>
  </div>
</div>

<!-- MODAL PEDIDO -->
<div class="overlay" id="pModal">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle" id="pModalTitle">Registrar pedido</div>
      <button class="mclose" onclick="closePModal()">x</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="pClientIdFixed">
      <div class="msection">
        <div class="msec-title">Cliente</div>
        <div class="ff"><label>Seleccionar cliente *</label><select id="pClientSel"></select></div>
      </div>
      <div class="msection">
        <div class="msec-title">Articulos del pedido</div>
        <div id="itemsContainer"></div>
        <button class="add-item" onclick="addItemRow()">+ Anadir articulo</button>
      </div>
      <div class="msection">
        <div class="msec-title">Notas del pedido</div>
        <textarea id="pNotes" placeholder="Urgente, fragil, horario especifico de entrega..."></textarea>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closePModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveOrder()">Guardar pedido</button>
    </div>
  </div>
</div>

<!-- MODAL DELEGACION -->
<div class="overlay" id="dModal">
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
<div class="overlay" id="vModal">
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
<div class="overlay" id="settingsModal">
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
    </div>
    <div class="mfoot">
      <button class="btn btn-secondary" onclick="closeSettingsModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveSettings()">Guardar</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
<script src="public/js/app.js"></script>
</body>
</html>

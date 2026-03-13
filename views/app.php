<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RouteFlow — Gestor de Rutas</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="public/css/app.css">
</head>
<body>

<header class="header">
  <div class="logo">Route<span>Flow</span></div>
  <div class="badge">v2.0</div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val" id="sClientes">0</div><div class="stat-label">Clientes</div></div>
    <div class="stat"><div class="stat-val" id="sPedidos">0</div><div class="stat-label">Con pedido</div></div>
    <div class="stat"><div class="stat-val" id="sDist">—</div><div class="stat-label">Km ruta</div></div>
    <div class="stat"><div class="stat-val" id="sTime">—</div><div class="stat-label">Horas</div></div>
  </div>
</header>

<div class="main">
  <div class="panel">
    <div class="tabs">
      <button class="tab active" id="tab-c" onclick="switchTab('c')">Clientes <span class="tab-badge green" id="bc">0</span></button>
      <button class="tab" id="tab-p" onclick="switchTab('p')">Pedidos del dia <span class="tab-badge orange" id="bp">0</span></button>
    </div>

    <!-- CLIENTES -->
    <div id="vc" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
      <div class="panel-header">
        <div class="panel-title">Cartera de clientes</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary" onclick="loadDemo()">Demo</button>
          <button class="btn btn-primary" onclick="openClientModal()">+ Nuevo</button>
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

    <div class="optimize-bar">
      <button class="btn btn-primary" onclick="optimizeRoute()">Optimizar ruta</button>
      <button class="btn btn-secondary" onclick="clearRoute()" title="Limpiar">Limpiar</button>
      <div class="clock" id="clock">--:--</div>
    </div>
  </div>

  <div class="map-area">
    <div id="map"></div>
    <div class="legend">
      <div class="legend-item"><div class="ldot" style="background:#46331f"></div>Base</div>
      <div class="legend-item"><div class="ldot" style="background:#8e8b30"></div>Con pedido (abierto)</div>
      <div class="legend-item"><div class="ldot" style="background:#d4a830"></div>En ruta optimizada</div>
      <div class="legend-item"><div class="ldot" style="background:#c83c32"></div>Cerrado / No visitable</div>
      <div class="legend-item"><div class="ldot" style="background:#85725e"></div>Sin pedido hoy</div>
    </div>
    <div class="route-panel" id="routePanel">
      <div class="route-header">
        <div class="rt">Ruta del dia</div>
        <div class="rm green" id="rDist">— km</div>
        <div class="rm orange" id="rTime">— h</div>
      </div>
      <div class="route-stops" id="rStops"></div>
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
      </div>
      <div class="msection">
        <div class="msec-title">Ubicacion (click en el mapa o introduce coordenadas)</div>
        <div class="fg">
          <div><label>Latitud *</label><input type="number" id="cX" placeholder="40.4168" step="0.000001"></div>
          <div><label>Longitud *</label><input type="number" id="cY" placeholder="-3.7038" step="0.000001"></div>
        </div>
      </div>
      <div class="msection">
        <div class="msec-title">Horario de atencion</div>
        <div class="fg">
          <div><label>Apertura</label><input type="time" id="cOpen" value="09:00"></div>
          <div><label>Cierre</label><input type="time" id="cClose" value="18:00"></div>
        </div>
      </div>
    </div>
    <div class="mfoot">
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

<div class="toast" id="toast"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="public/js/app.js"></script>
</body>
</html>

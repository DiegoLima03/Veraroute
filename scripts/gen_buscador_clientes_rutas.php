<?php
// Genera output/buscador_clientes_rutas.html — snapshot estatico con todos
// los clientes y la(s) ruta(s) a las que pertenecen. Filtros por texto,
// ruta y delegacion. Se regenera ejecutando este script desde CLI.

declare(strict_types=1);

$pdo = new PDO(
    'mysql:host=127.0.0.1;port=3308;dbname=gestorrutas;charset=utf8mb4',
    'root',
    '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$rutas = $pdo->query('SELECT id, nombre, color FROM rutas ORDER BY nombre')
             ->fetchAll(PDO::FETCH_ASSOC);

$delegaciones = $pdo->query('SELECT id, nombre FROM delegaciones ORDER BY nombre')
                    ->fetchAll(PDO::FETCH_ASSOC);

$sql = "
SELECT c.id,
       c.nombre,
       COALESCE(c.codigo_postal,'')        AS cp,
       COALESCE(c.direccion,'')            AS direccion,
       COALESCE(d.nombre,'')               AS delegacion,
       c.activo,
       COALESCE(
         GROUP_CONCAT(DISTINCT r.id ORDER BY r.nombre SEPARATOR ','),
         ''
       ) AS rutas_ids,
       COALESCE(
         GROUP_CONCAT(DISTINCT r.nombre ORDER BY r.nombre SEPARATOR '|'),
         ''
       ) AS rutas_nombres
FROM clientes c
LEFT JOIN delegaciones d ON d.id = c.id_delegacion
LEFT JOIN (
    SELECT id_cliente, id_ruta FROM cliente_rutas
    UNION
    SELECT id, id_ruta FROM clientes WHERE id_ruta IS NOT NULL
) cr ON cr.id_cliente = c.id
LEFT JOIN rutas r ON r.id = cr.id_ruta
GROUP BY c.id
ORDER BY c.nombre
";

$rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

$clientes = [];
$sinRuta = 0;
foreach ($rows as $r) {
    $rIds = $r['rutas_ids'] === '' ? [] : array_map('intval', explode(',', $r['rutas_ids']));
    $rNombres = $r['rutas_nombres'] === '' ? [] : explode('|', $r['rutas_nombres']);
    if (!$rIds) {
        $sinRuta++;
    }
    $clientes[] = [
        'id'         => (int)$r['id'],
        'n'          => $r['nombre'],
        'cp'         => $r['cp'],
        'd'          => $r['direccion'],
        'del'        => $r['delegacion'],
        'a'          => (int)$r['activo'],
        'rIds'       => $rIds,
        'rN'         => $rNombres,
    ];
}

$payload = [
    'generado'     => date('Y-m-d H:i:s'),
    'rutas'        => array_map(fn($x) => [
        'id'     => (int)$x['id'],
        'nombre' => $x['nombre'],
        'color'  => $x['color'] ?: '#888',
    ], $rutas),
    'delegaciones' => array_map(fn($x) => [
        'id'     => (int)$x['id'],
        'nombre' => $x['nombre'],
    ], $delegaciones),
    'clientes'     => $clientes,
    'totales'      => [
        'clientes'     => count($clientes),
        'sin_ruta'     => $sinRuta,
        'con_ruta'     => count($clientes) - $sinRuta,
        'rutas'        => count($rutas),
        'delegaciones' => count($delegaciones),
    ],
];

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$html = <<<'HTML'
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Buscador de clientes por ruta - VeraRoute</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f7fa;
    color: #2c3e50;
    font-size: 14px;
  }
  header {
    background: #2c3e50;
    color: #fff;
    padding: 14px 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header .meta { font-size: 12px; opacity: 0.8; margin-top: 4px; }
  .container { padding: 16px 20px; }
  .filtros {
    background: #fff;
    border-radius: 6px;
    padding: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    margin-bottom: 14px;
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto;
    gap: 10px;
    align-items: end;
  }
  .filtros label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    color: #7f8c8d;
    font-weight: 600;
    margin-bottom: 4px;
    letter-spacing: 0.3px;
  }
  .filtros input, .filtros select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #d0d7de;
    border-radius: 4px;
    font-size: 14px;
    background: #fff;
  }
  .filtros input:focus, .filtros select:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52,152,219,0.15);
  }
  .filtros button {
    padding: 8px 14px;
    background: #ecf0f1;
    border: 1px solid #d0d7de;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  .filtros button:hover { background: #d0d7de; }
  .stats {
    display: flex;
    gap: 14px;
    margin-bottom: 12px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .stat {
    background: #fff;
    padding: 8px 14px;
    border-radius: 4px;
    border-left: 3px solid #3498db;
  }
  .stat strong { color: #2c3e50; font-size: 16px; }
  .stat.warn { border-left-color: #e67e22; }
  .tabla-wrap {
    background: #fff;
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #34495e;
    color: #fff;
    text-align: left;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    cursor: pointer;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  thead th:hover { background: #2c3e50; }
  thead th .arrow { font-size: 10px; opacity: 0.6; margin-left: 4px; }
  tbody tr { border-top: 1px solid #ecf0f1; }
  tbody tr:hover { background: #f8fafc; }
  tbody tr.inactivo { color: #95a5a6; font-style: italic; }
  tbody td { padding: 8px 12px; vertical-align: top; }
  td.id { color: #7f8c8d; font-family: ui-monospace, "SF Mono", Monaco, Consolas, monospace; font-size: 12px; }
  td.cp { font-family: ui-monospace, "SF Mono", Monaco, Consolas, monospace; font-size: 12px; }
  td.dir { color: #5d6d7e; font-size: 12px; max-width: 320px; }
  .ruta-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    margin: 1px 3px 1px 0;
    white-space: nowrap;
  }
  .sin-ruta {
    color: #e67e22;
    font-style: italic;
    font-size: 12px;
  }
  .inactivo-pill {
    display: inline-block;
    background: #bdc3c7;
    color: #fff;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 6px;
    text-transform: uppercase;
  }
  .paginacion {
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #fafbfc;
    border-top: 1px solid #ecf0f1;
    font-size: 13px;
  }
  .paginacion button {
    padding: 5px 12px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 4px;
    cursor: pointer;
    margin: 0 2px;
  }
  .paginacion button:disabled { opacity: 0.4; cursor: not-allowed; }
  .empty {
    padding: 40px;
    text-align: center;
    color: #95a5a6;
  }
  @media (max-width: 800px) {
    .filtros { grid-template-columns: 1fr; }
    td.dir, th.dir { display: none; }
  }
</style>
</head>
<body>
<header>
  <h1>Buscador de clientes por ruta</h1>
  <div class="meta">VeraRoute - snapshot generado el <span id="genFecha"></span></div>
</header>

<div class="container">
  <div class="filtros">
    <div>
      <label for="q">Buscar (nombre, CP, direccion, ID)</label>
      <input id="q" type="search" placeholder="escriba para filtrar...">
    </div>
    <div>
      <label for="fRuta">Ruta</label>
      <select id="fRuta">
        <option value="">Todas</option>
        <option value="__sin__">-- Sin ruta asignada --</option>
      </select>
    </div>
    <div>
      <label for="fDel">Delegacion</label>
      <select id="fDel">
        <option value="">Todas</option>
      </select>
    </div>
    <div>
      <button id="btnReset" type="button">Limpiar</button>
    </div>
  </div>

  <div class="stats" id="stats"></div>

  <div class="tabla-wrap">
    <table>
      <thead>
        <tr>
          <th data-col="id">ID<span class="arrow"></span></th>
          <th data-col="n">Cliente<span class="arrow"></span></th>
          <th data-col="cp">CP<span class="arrow"></span></th>
          <th class="dir" data-col="d">Direccion<span class="arrow"></span></th>
          <th data-col="del">Delegacion<span class="arrow"></span></th>
          <th data-col="rN">Ruta(s)<span class="arrow"></span></th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
    <div class="paginacion">
      <div id="paginaInfo"></div>
      <div>
        <button id="prev" type="button">Anterior</button>
        <span id="paginaNum" style="margin: 0 8px;"></span>
        <button id="next" type="button">Siguiente</button>
      </div>
    </div>
  </div>
</div>

<script id="datos" type="application/json">__DATOS__</script>
<script>
(function () {
  const datos = JSON.parse(document.getElementById('datos').textContent);
  const PAGE_SIZE = 100;

  const rutaPorId = new Map(datos.rutas.map(r => [r.id, r]));
  document.getElementById('genFecha').textContent = datos.generado;

  // Poblar selects
  const selRuta = document.getElementById('fRuta');
  datos.rutas.forEach(r => {
    const o = document.createElement('option');
    o.value = String(r.id);
    o.textContent = r.nombre;
    selRuta.appendChild(o);
  });
  const selDel = document.getElementById('fDel');
  datos.delegaciones.forEach(d => {
    const o = document.createElement('option');
    o.value = d.nombre;
    o.textContent = d.nombre;
    selDel.appendChild(o);
  });

  // Estado
  let pagina = 1;
  let orden = { col: 'n', dir: 1 };

  // Normalizador (sin acentos, lowercase)
  const norm = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Filtrado
  function filtrar() {
    const q = norm(document.getElementById('q').value.trim());
    const fr = document.getElementById('fRuta').value;
    const fd = document.getElementById('fDel').value;

    return datos.clientes.filter(c => {
      if (fr === '__sin__') {
        if (c.rIds.length > 0) return false;
      } else if (fr !== '') {
        if (!c.rIds.includes(parseInt(fr, 10))) return false;
      }
      if (fd !== '' && c.del !== fd) return false;
      if (q !== '') {
        const blob = norm(c.n + ' ' + c.cp + ' ' + c.d + ' ' + c.id);
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }

  function ordenar(arr) {
    const { col, dir } = orden;
    return arr.slice().sort((a, b) => {
      let va = a[col], vb = b[col];
      if (col === 'rN') { va = (a.rN[0] || '~'); vb = (b.rN[0] || '~'); }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function pintar() {
    const filtrados = ordenar(filtrar());
    const total = filtrados.length;
    const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pagina > paginas) pagina = paginas;
    const ini = (pagina - 1) * PAGE_SIZE;
    const slice = filtrados.slice(ini, ini + PAGE_SIZE);

    // Stats
    const conRuta = filtrados.filter(c => c.rIds.length > 0).length;
    const sinRuta = total - conRuta;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><strong>${total.toLocaleString('es')}</strong> clientes filtrados</div>
      <div class="stat"><strong>${conRuta.toLocaleString('es')}</strong> con ruta</div>
      <div class="stat warn"><strong>${sinRuta.toLocaleString('es')}</strong> sin ruta</div>
      <div class="stat"><strong>${datos.totales.clientes.toLocaleString('es')}</strong> en BD</div>
    `;

    // Tabla
    const tb = document.getElementById('tbody');
    if (!slice.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty">Sin resultados</td></tr>';
    } else {
      tb.innerHTML = slice.map(c => {
        const badges = c.rIds.length
          ? c.rIds.map(rid => {
              const r = rutaPorId.get(rid);
              if (!r) return '';
              return `<span class="ruta-badge" style="background:${escapeHtml(r.color)}">${escapeHtml(r.nombre)}</span>`;
            }).join('')
          : '<span class="sin-ruta">- sin ruta -</span>';
        const inact = c.a ? '' : '<span class="inactivo-pill">inactivo</span>';
        const trClass = c.a ? '' : ' class="inactivo"';
        return `<tr${trClass}>
          <td class="id">${c.id}</td>
          <td>${escapeHtml(c.n)}${inact}</td>
          <td class="cp">${escapeHtml(c.cp)}</td>
          <td class="dir">${escapeHtml(c.d)}</td>
          <td>${escapeHtml(c.del)}</td>
          <td>${badges}</td>
        </tr>`;
      }).join('');
    }

    // Paginacion
    document.getElementById('paginaInfo').textContent =
      total ? `Mostrando ${ini + 1}-${Math.min(ini + PAGE_SIZE, total)} de ${total.toLocaleString('es')}`
            : '';
    document.getElementById('paginaNum').textContent = `Pagina ${pagina} / ${paginas}`;
    document.getElementById('prev').disabled = pagina <= 1;
    document.getElementById('next').disabled = pagina >= paginas;

    // Cabeceras: marcar orden
    document.querySelectorAll('thead th').forEach(th => {
      const col = th.dataset.col;
      const arrow = th.querySelector('.arrow');
      arrow.textContent = (col === orden.col) ? (orden.dir === 1 ? '▲' : '▼') : '';
    });
  }

  // Listeners
  let debounce;
  document.getElementById('q').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { pagina = 1; pintar(); }, 120);
  });
  document.getElementById('fRuta').addEventListener('change', () => { pagina = 1; pintar(); });
  document.getElementById('fDel').addEventListener('change', () => { pagina = 1; pintar(); });
  document.getElementById('btnReset').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('fRuta').value = '';
    document.getElementById('fDel').value = '';
    pagina = 1; pintar();
  });
  document.getElementById('prev').addEventListener('click', () => { if (pagina > 1) { pagina--; pintar(); } });
  document.getElementById('next').addEventListener('click', () => { pagina++; pintar(); });
  document.querySelectorAll('thead th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (orden.col === col) orden.dir = -orden.dir;
      else { orden.col = col; orden.dir = 1; }
      pintar();
    });
  });

  pintar();
})();
</script>
</body>
</html>
HTML;

$html = str_replace('__DATOS__', $json, $html);

$out = __DIR__ . '/../output/buscador_clientes_rutas.html';
file_put_contents($out, $html);

echo "OK -> $out\n";
echo "  Clientes:     {$payload['totales']['clientes']}\n";
echo "  Con ruta:     {$payload['totales']['con_ruta']}\n";
echo "  Sin ruta:     {$payload['totales']['sin_ruta']}\n";
echo "  Rutas:        {$payload['totales']['rutas']}\n";
echo "  Delegaciones: {$payload['totales']['delegaciones']}\n";
echo "  Tamano HTML:  " . number_format(strlen($html) / 1024, 1) . " KB\n";

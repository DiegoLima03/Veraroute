<?php
// login.php — versión UI corporativa con redirección por dispositivo (solo móviles a versión móvil)
declare(strict_types=1);
ini_set('display_errors','1'); error_reporting(E_ALL);

require_once __DIR__ . '/conexion.php';
require_once __DIR__ . '/auth.php';

// ====== LOG A CSV (nuevo destino: ../private/logs_veratrack.log) ======
// 3. Ruta base real
// Apunta a c:/wamp64/www/private/
$baseDir = realpath(__DIR__ . '/../private');
if ($baseDir === false) {
  $baseDir = __DIR__ . '/../private';
}
$LOGIN_TXT_PATH = rtrim($baseDir, "/\\") . DIRECTORY_SEPARATOR . 'logs_veratrack.log';

// Asegura que la carpeta exista
$logDir = dirname($LOGIN_TXT_PATH);
if (!is_dir($logDir)) {
  @mkdir($logDir, 0755, true);
}

function getClientIp(): string {
  $candidates = [
    'HTTP_CF_CONNECTING_IP',   // Cloudflare
    'HTTP_X_FORWARDED_FOR',    // proxy
    'HTTP_X_REAL_IP',
    'REMOTE_ADDR'
  ];

  foreach ($candidates as $key) {
    if (empty($_SERVER[$key])) continue;

    if ($key === 'HTTP_X_FORWARDED_FOR') {
      $parts = array_map('trim', explode(',', (string)$_SERVER[$key]));
      foreach ($parts as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
      }
    } else {
      $ip = trim((string)$_SERVER[$key]);
      if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
    }
  }
  return '0.0.0.0';
}

function geo_country_from_ip(string $ip): array {
  // Localhost / loopback no tiene pais real
  if ($ip === '::1' || $ip === '127.0.0.1') {
    return ['Local', 'LOCAL'];
  }

  $url = 'https://free.freeipapi.com/api/json/' . rawurlencode($ip);
  $ctx = stream_context_create([
    'http' => [
      'method'  => 'GET',
      'timeout' => 2,
      'header'  => "Accept: application/json\r\n",
    ],
  ]);

  $raw = @file_get_contents($url, false, $ctx);
  if ($raw === false) return ['', ''];

  $data = json_decode($raw, true);
  if (!is_array($data)) return ['', ''];

  $countryName = (string)($data['countryName'] ?? '');
  $countryCode = (string)($data['countryCode'] ?? '');

  return [$countryName, $countryCode];
}

function append_login_txt(string $file, string $username, int $userId, bool $success, string $tipo = 'user'): void {
  $date = date('Y-m-d H:i:s');
  $ip   = getClientIp();
  $ua   = $_SERVER['HTTP_USER_AGENT'] ?? '';
  [$countryName, $countryCode] = geo_country_from_ip($ip);

  // limpiar para que no rompa el CSV
  $username = str_replace(["\r","\n","\t"], ' ', $username);
  $ua       = str_replace(["\r","\n","\t"], ' ', $ua);

  $isNew = (!file_exists($file) || @filesize($file) === 0);

  $fh = @fopen($file, 'ab');
  if ($fh === false) return;
  if (@flock($fh, LOCK_EX)) {
    if ($isNew) {
      @fputcsv($fh, ['date','tipo','user_id','user','success','ip','ua','country','country_code'], ';');
    }
    @fputcsv($fh, [
      $date,
      $tipo,
      $userId,
      $username,
      $success ? 1 : 0,
      $ip,
      $ua,
      $countryName,
      $countryCode
    ], ';');
    @flock($fh, LOCK_UN);
  }
  @fclose($fh);
}

// === NAVIDAD: activar/desactivar nieve ===
// Opción A (recomendado): por rango de fechas (01/12 a 07/01)
$SNOW_ENABLED = (date('n') == 12) || (date('n') == 1 && date('j') <= 7);

// Opción B (manual): fuerza ON/OFF comentando lo anterior
// $SNOW_ENABLED = true;  // ON
// $SNOW_ENABLED = false; // OFF


// === Control de login ===
if (!defined('MAX_FAILED_LOGINS')) {
  define('MAX_FAILED_LOGINS', 5); // umbral de bloqueos
}

/**
 * Devuelve true SOLO para teléfonos.
 *
 * Reglas:
 *  - iPhone / iPod → móvil
 *  - Android con "Mobile" → móvil (teléfono)
 *  - Windows Phone / IEMobile / Opera Mini / BlackBerry → móvil
 *  - iPad, tablets Android (Android sin "Mobile"), y cualquier desktop → NO móvil
 */
function is_phone_device(): bool {
  $ua = strtolower($_SERVER['HTTP_USER_AGENT'] ?? '');
  if ($ua === '') return false;

  // pistas de escritorio para evitar falsos positivos
  $isDesktopHints = (
      strpos($ua, 'windows nt') !== false
      || strpos($ua, 'macintosh') !== false
      || strpos($ua, 'x11') !== false
  ) && strpos($ua, 'mobile') === false;

  if ($isDesktopHints) return false;

  // Teléfonos comunes
  if (preg_match('/iphone|ipod|windows phone|iemobile|opera mini|blackberry|bb10/i', $ua)) {
    return true;
  }

  // Android: solo si lleva "mobile" (tablets Android suelen ir sin "mobile")
  if (strpos($ua, 'android') !== false && strpos($ua, 'mobile') !== false) {
    return true;
  }

  // iPad/tablet NO son móviles aquí (queremos vista escritorio)
  return false;
}

$login_success = !empty($_SESSION['login_success']);
unset($_SESSION['login_success']);


// --- Si ya está logueado, redirige según dispositivo ---
if (is_logged_in() && !$login_success) {
  $currentUser = current_user();
  // Si es chofer, redirigir a menu_chofer.php
  if (isset($currentUser['is_chofer']) && $currentUser['is_chofer']) {
    header('Location: menu_chofer.php');
    exit;
  }
  // Si es usuario normal, redirigir según dispositivo
  $target = is_current_user_limited_taller_profile($pdo) ? 'menu_taller.php' : (is_phone_device() ? 'vehiculos_movil.php' : 'vehiculos.php');
  header('Location: ' . $target);
  exit;
}


$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $username = trim($_POST['username'] ?? '');
  $password = (string)($_POST['password'] ?? '');
  $ip       = getClientIp(); // ✅ mejor que REMOTE_ADDR directamente

  // Traemos solo lo necesario y evitamos * para no mezclar columnas
  $stmt = $pdo->prepare("
    SELECT id, username, pass_hash, full_name, is_admin, failed_logins, locked
    FROM app_users
    WHERE username = ?
    LIMIT 1
  ");
  $stmt->execute([$username]);
  $user = $stmt->fetch();

  // Usuario inexistente => buscar en chofers
  if (!$user) {
    // Buscar en tabla chofers por nombre
    $stmtChofer = $pdo->prepare("
      SELECT id, nombre, nombre_completo, pass, vehiculo_id
      FROM chofers
      WHERE nombre = ?
      LIMIT 1
    ");
    $stmtChofer->execute([$username]);
    $chofer = $stmtChofer->fetch(PDO::FETCH_ASSOC);

    // Si encontramos un chofer, verificar contraseña
    if ($chofer && password_verify($password, $chofer['pass'])) {
      // Actualizar ult_log
      $updateLog = $pdo->prepare("
        UPDATE chofers
        SET ult_log = NOW()
        WHERE id = ?
        LIMIT 1
      ");
      $updateLog->execute([(int)$chofer['id']]);

      // Crear sesión para chofer
      session_regenerate_id(true);
      $_SESSION['user'] = [
        'id'           => (int)$chofer['id'],
        'username'     => $chofer['nombre'],
        'full_name'    => $chofer['nombre_completo'] ?? $chofer['nombre'],
        'is_admin'     => 0,
        'is_chofer'    => true,
        'vehiculo_id'  => $chofer['vehiculo_id']
      ];

      // Flag para animación SOLO en login correcto
      $_SESSION['login_success'] = true;

      // ✅ LOG (chofer OK)
      append_login_txt($LOGIN_TXT_PATH, (string)$username, (int)$chofer['id'], true, 'chofer');

      // Redirigir a mis_tickets.php para chofers
      header('Location: login.php');
      exit;
    } else {
      // No es usuario ni chofer válido
      usleep(200000); // 200ms

      // ✅ LOG (unknown FAIL)
      append_login_txt($LOGIN_TXT_PATH, (string)$username, 0, false, 'unknown');

      $error = 'Usuario o contraseña incorrectos';
    }
  }
  // Usuario bloqueado
  elseif ((int)$user['locked'] === 1) {

    // ✅ LOG (user bloqueado)
    append_login_txt($LOGIN_TXT_PATH, (string)$username, (int)$user['id'], false, 'user_locked');

    $error = 'Tu usuario está bloqueado por intentos fallidos. Contacta con un administrador.';
  }
  // Comprobación de contraseña
  elseif (password_verify($password, $user['pass_hash'])) {
    // Éxito: resetear contador y sellar último login
    $ok = $pdo->prepare("
      UPDATE app_users
      SET failed_logins = 0,
          last_login_at = NOW(),
          last_login_ip = :ip
      WHERE id = :id
      LIMIT 1
    ");
    $ok->execute([':ip' => $ip, ':id' => (int)$user['id']]);

    session_regenerate_id(true);
    $_SESSION['user'] = [
      'id'        => (int)$user['id'],
      'username'  => $user['username'],
      'full_name' => $user['full_name'],
      'is_admin'  => (int)$user['is_admin'],
    ];

    // ✅ Flag para animación SOLO en login correcto
    $_SESSION['login_success'] = true;

    // ✅ LOG (user OK)
    append_login_txt($LOGIN_TXT_PATH, (string)$user['username'], (int)$user['id'], true, 'user');

    // ✅ Volvemos al login para reproducir animación y redirigir después
    header('Location: login.php');
    exit;
  }
  // Fallo de contraseña: incrementamos y bloqueamos con lógica determinista (2 pasos, transacción)
  else {
    $userId = (int)$user['id'];

    $pdo->beginTransaction();
    try {
      // 1) Bloqueamos la fila y leemos estado actual
      $st = $pdo->prepare("
        SELECT
          COALESCE(failed_logins, 0) AS failed_logins,
          COALESCE(locked, 0)        AS locked,
          locked_at
        FROM app_users
        WHERE id = ?
        FOR UPDATE
      ");
      $st->execute([$userId]);
      $cur = $st->fetch(PDO::FETCH_ASSOC);

      $failed = (int)($cur['failed_logins'] ?? 0);
      $locked = (int)($cur['locked'] ?? 0);
      $lockedAtIsNull = ($cur['locked_at'] === null);

      $newFailed = min($failed + 1, MAX_FAILED_LOGINS);
      $willLock  = ($newFailed >= MAX_FAILED_LOGINS) ? 1 : 0;

      // Sella locked_at SOLO la primera vez que pasa a bloqueado
      $setLockAt = ($willLock === 1 && $locked === 0 && $lockedAtIsNull) ? 1 : 0;

      // 2) Actualizamos exactamente lo calculado
      $upd = $pdo->prepare("
        UPDATE app_users
           SET failed_logins     = :fl,
               last_failed_login = NOW(),
               locked            = :lk,
               locked_at         = IF(:setla = 1, NOW(), locked_at)
         WHERE id = :id
         LIMIT 1
      ");
      $upd->execute([
        ':fl'    => $newFailed,
        ':lk'    => $willLock ? 1 : $locked,  // si no llega al umbral, conserva estado anterior
        ':setla' => $setLockAt,
        ':id'    => $userId,
      ]);

      $pdo->commit();

      // ✅ LOG (user FAIL)
      append_login_txt($LOGIN_TXT_PATH, (string)$user['username'], (int)$userId, false, 'user');

      // Mensaje de error para la UI
      if ($willLock === 1) {
        $error = 'Has alcanzado 5 intentos fallidos. Tu usuario ha sido bloqueado.';
      } else {
        $restantes = MAX_FAILED_LOGINS - $newFailed;
        if ($restantes < 0) $restantes = 0;
        $error = "Usuario o contraseña incorrectos. Intentos restantes: {$restantes}";
      }
    } catch (Throwable $e) {
      $pdo->rollBack();
      throw $e;
    }
  }
}
?>

<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Acceso · Veraleza</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- Bootstrap + Poppins -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;600&display=swap" rel="stylesheet">
 <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
	    <link rel="icon" type="image/png" href="img/logo.png">
	<link rel="manifest" href="/manifest.webmanifest?v=1">
	<meta name="theme-color" content="#8E8B30">

	<!-- Recomendado para iPhone/iPad -->
	<link rel="apple-touch-icon" href="/img/pwa/apple-touch-icon.png?v=1">

<meta name="theme-color" content="#7a7617">

  <style>
    /* Paleta Veraleza */
    :root{
      --vz-negro:#10180E;
      --vz-marron1:#46331F;
      --vz-marron2:#85725E;
      --vz-crema:#E5E2DC;
      --vz-verde:#8E8B30;
    }
    html,body{height:100%}
    body{
      font-family:'Poppins',sans-serif;
      background: var(--vz-crema);
      color: var(--vz-negro);
		margin:0;
		overflow:hidden;
    }

    /* Layout responsivo: columna única en móvil, split en >= md */
    .login-wrap{
      min-height:100%;
      display:grid;
      grid-template-columns: 1fr;
    }
    @media (min-width: 768px){
      .login-wrap{
        grid-template-columns: 1.1fr 1fr; /* imagen / formulario */
      }
    }

    /* Panel imagen (oculto en xs si no cabe bien) */
	.login-hero{
	  position:relative;
	  display:none;
	  background: var(--vz-marron2);
	  opacity:0;
	}

    @media (min-width:768px){
		.login-hero{
		  display:block;
		  background: url('img/login-hero.png') center/cover no-repeat, var(--vz-marron2);
		  animation: heroFadeIn .8s ease 0.15s forwards;
		}

      .login-hero::after{
        content:"";
        position:absolute; inset:0;
        background: linear-gradient(135deg, rgba(16,24,14,.55), rgba(142,139,48,.35));
      }
      .brand-watermark{
        position:absolute; left:2rem; bottom:2rem;
        color:#fff; font-weight:600; letter-spacing:.5px;
        text-shadow:0 1px 3px rgba(0,0,0,.4);
      }
    }

    /* Panel formulario */
    .login-card{
      display:flex;
      align-items:center;
      justify-content:center;
      padding: clamp(1.25rem, 3vw, 2.5rem);
    }
	.card-ui{
	  width:min(440px, 100%);
	  background:#fff;
	  border:0;
	  border-radius:1rem;
	  box-shadow:0 12px 28px rgba(16,24,14,.15);
	  overflow:hidden;

	  opacity:0;
	  transform: scale(.96);
	  animation: cardIn 0.7s cubic-bezier(.18,.89,.32,1.28) 0.2s forwards;
	}

    .card-ui .header{
      display:flex; align-items:center; gap:.75rem;
      padding:1rem 1.25rem;
      background: linear-gradient(180deg, #fff, #f9f7f2);
      border-bottom:1px solid #ece8df;
    }
    .brand-logo{
      height:40px; width:auto;
    }
    .brand-title{
      margin:0; font-weight:600; font-size:1.1rem; color:var(--vz-marron1);
      line-height:1.1;
    }

    .card-ui .body{ padding:1.25rem; }
    .form-label{ font-weight:600; color:var(--vz-marron1); }
    .form-control{
      border-radius:.75rem;
      border-color:#e2ded6;
      padding:.65rem .9rem;
    }
    .form-control:focus{
      border-color: var(--vz-verde);
      box-shadow: 0 0 0 .2rem rgba(142,139,48,.15);
    }

    /* Botón corporativo */
    .btn-vz{
      --bs-btn-bg: var(--vz-verde);
      --bs-btn-border-color: var(--vz-verde);
      --bs-btn-color:#fff;
      --bs-btn-hover-bg:#7c7a2a;
      --bs-btn-hover-border-color:#7c7a2a;
      --bs-btn-focus-shadow-rgb:142,139,48;
      border-radius:.75rem;
      font-weight:600;
      padding:.7rem 1rem;
    }

    /* Aviso/Error */
    .alert-vz{
      background:#fff7f7; border-color:#ffd3d3; color:#7a2a2a;
      border-radius:.75rem;
      padding:.5rem .75rem;
    }

    /* Pie */
    .foot{
      color:#6b665e; font-size:.85rem; text-align:center; padding:.75rem 1.25rem 1.25rem;
    }
    .foot a{ color:var(--vz-marron2); text-decoration:none }
    .foot a:hover{ text-decoration:underline }
  </style>
  <style>
 .btn-success{
  background-color: var(--vz-verde) !important;
  border-color: var(--vz-verde) !important;
  color:#fff;
  font-weight:600;
  border-radius:.75rem;
  padding:.7rem 1rem;
  transition: background-color 120ms ease-in-out;
}
.btn-success:hover,
.btn-success:focus{
  background-color:#146c43 !important;
  border-color:#146c43 !important;
  box-shadow:none !important;
}
.btn-success:active{
  background-color: var(--vz-verde) !important;
  border-color: var(--vz-verde) !important;
  transition: background-color 50ms ease-in-out;
}

/* ESTADO "LOGGING IN" */
body.logging-in .card-ui{ animation: cardOut 0.45s ease-in forwards; }
body.logging-in .login-hero{ animation: heroOut 0.5s ease-in forwards; }

/* Overlay */
.logging-overlay{
  pointer-events:none;
  position:fixed;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  z-index:10;
  opacity:0;
  transition: opacity .25s ease-in;
}
body.logging-in .logging-overlay{ opacity:1; }

.logging-overlay-inner{
  background:rgba(16,24,14,.25);
  backdrop-filter:blur(3px);
  border-radius:999px;
  padding:.6rem 1.3rem;
  display:flex;
  align-items:center;
  gap:.5rem;
  color:#fff;
  font-weight:600;
  font-size:.9rem;
  box-shadow:0 8px 24px rgba(0,0,0,.25);
}

.logging-logo{
  width: 64px;
  opacity: .95;
  animation: veralezaRotate 1.6s ease-in-out infinite;
  transform-origin:center;
}

/* KEYFRAMES */
@keyframes cardIn{
  0%{ opacity:0; transform: scale(.92); }
  60%{ opacity:1; transform: scale(1.02); }
  100%{ opacity:1; transform: scale(1); }
}
@keyframes heroFadeIn{
  0%{ opacity:0; }
  100%{ opacity:1; }
}
@keyframes cardOut{
  0%{ opacity:1; transform: scale(1); }
  100%{ opacity:0; transform: scale(.96); }
}
@keyframes heroOut{
  0%{ opacity:1; }
  100%{ opacity:0; }
}
@keyframes veralezaRotate{
  0%{ transform: rotate(0deg) scale(1); }
  40%{ transform: rotate(180deg) scale(1.03); }
  60%{ transform: rotate(180deg) scale(1.03); }
  100%{ transform: rotate(360deg) scale(1); }
}

	  /* =========================
   COPOS DE NIEVE (NAVIDAD)
   ========================= */
.snow-layer{
  position: fixed;
  inset: 0;
  z-index: 2;            /* por encima del fondo, por debajo del card */
  pointer-events: none;  /* no bloquea clicks */
  overflow: hidden;
}

/* Asegura que el formulario queda encima */
.login-card{ position: relative; z-index: 3; }
.login-hero{ position: relative; z-index: 1; }

/* Copo individual */
.snowflake{
  position: absolute;
  top: -10vh;
  left: 0;
  color: #ffffff;
  opacity: 1;
  will-change: transform;

  /* SOMBRA AVANZADA */
  text-shadow:
    0 1px 2px rgba(0,0,0,.35),
    0 3px 6px rgba(0,0,0,.25);

  filter:
    drop-shadow(0 3px 4px rgba(0,0,0,.35))
    drop-shadow(0 6px 10px rgba(0,0,0,.20));

  animation-name: snowFall, snowSway;
  animation-timing-function: linear, ease-in-out;
  animation-iteration-count: infinite, infinite;
}



/* Caída vertical */
@keyframes snowFall{
  0%   { transform: translate3d(0,-12vh,0); }
  100% { transform: translate3d(0,112vh,0); }
}

/* Balanceo lateral */
@keyframes snowSway{
  0%,100% { margin-left: 0; }
  50%     { margin-left: 28px; }
}

/* Reduce animaciones si el usuario lo pide */
@media (prefers-reduced-motion: reduce){
  .snowflake{ animation: none !important; }
}
	  
  </style>
  
</head>
<body>
<?php if (!empty($SNOW_ENABLED)): ?>
  <div class="snow-layer" id="snowLayer" aria-hidden="true"></div>
<?php endif; ?>
	
  <div class="login-wrap">
    <!-- Lado imagen -->
    <aside class="login-hero">
      <div class="brand-watermark">
        Control de cámaras y flota · Veraleza
      </div>
    </aside>

    <!-- Lado formulario -->
    <main class="login-card">
      <div class="card-ui">
        <div class="header" style="display:flex; justify-content:center; align-items:center;">
  <img src="img/logo_login.png" alt="Veraleza" class="brand-logo">
</div>


        <div class="body">
			<?php if (!empty($_GET['error']) && $_GET['error'] === 'bloqueado'): ?>
			  <div class="alert alert-vz mb-3">Tu usuario está bloqueado por intentos fallidos. Contacta con un administrador.</div>
			<?php endif; ?>

          <?php if ($error): ?>
            <div class="alert alert-vz mb-3"><?=htmlspecialchars($error)?></div>
          <?php endif; ?>

          <form method="post" autocomplete="off" novalidate>
                      <div class="mb-3">
  <label for="user" class="form-label">Usuario</label>
  <div class="input-group">
    <input id="user" name="username" class="form-control" required autofocus>
	      <span class="input-group-text">
      <i class="bi bi-person"></i>
    </span>
  </div>
</div>

<div class="mb-3">
  <label for="pass" class="form-label">Contraseña</label>
  <div class="input-group">
    <input id="pass" type="password" name="password" class="form-control" required>
    <button type="button" class="btn btn-outline-secondary" onclick="togglePass()" aria-label="Mostrar/Ocultar contraseña">
      <i class="bi bi-eye-slash" id="togglePassIcon"></i>
    </button>
  </div>
</div>

            <button class="btn btn-success w-100 mb-2">Entrar</button>

          </form>
        </div>

        <div class="foot">
          © <?=date('Y')?> Veraleza
        </div>
      </div>
    </main>
  </div>
<div class="logging-overlay">
  <div class="logging-overlay-inner">
    <img src="img/logo.png" alt="Veraleza" class="logging-logo">
    <span>Iniciando sesión...</span>
  </div>
</div>

  <script>
  function togglePass(){
    const input = document.getElementById('pass');
    const icon  = document.getElementById('togglePassIcon');
    const isPwd = input.type === 'password';
    input.type  = isPwd ? 'text' : 'password';
    icon.classList.toggle('bi-eye-slash', !isPwd);
    icon.classList.toggle('bi-eye', isPwd);
  }
  if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

  </script>
	
	<?php if (!empty($SNOW_ENABLED)): ?>
<script>
(function(){
  const layer = document.getElementById('snowLayer');
  if (!layer) return;

	const COUNT = 18;
	const MIN_SIZE = 12;
	const MAX_SIZE = 26;
	const MIN_DURATION = 9;
	const MAX_DURATION = 18;


  layer.innerHTML = '';

  const rand = (min, max) => Math.random() * (max - min) + min;

  for (let i = 0; i < COUNT; i++){
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    flake.textContent = '❄';

    const size = rand(MIN_SIZE, MAX_SIZE);
    const left = rand(0, 100);
    const fallDuration = rand(MIN_DURATION, MAX_DURATION);
    const swayDuration = rand(2.5, 5.5);
    const delay = rand(-MAX_DURATION, 0);

    flake.style.left = left + 'vw';
    flake.style.fontSize = size + 'px';
    flake.style.opacity = rand(0.35, 0.95).toFixed(2);
    flake.style.animationDuration = fallDuration + 's, ' + swayDuration + 's';
    flake.style.animationDelay = delay + 's, ' + rand(-5, 0) + 's';

    layer.appendChild(flake);
  }
})();
</script>
<?php endif; ?>
	
	<?php if (!empty($login_success)): ?>
<script>
  document.addEventListener('DOMContentLoaded', function(){
    document.body.classList.add('logging-in');
    setTimeout(function(){
      <?php 
      $currentUser = current_user();
      if (isset($currentUser['is_chofer']) && $currentUser['is_chofer']) {
        echo "window.location.href = 'menu_chofer.php';";
      } else {
        $target = is_current_user_limited_taller_profile($pdo) ? 'menu_taller.php' : (is_phone_device() ? 'vehiculos_movil.php' : 'vehiculos.php');
        echo "window.location.href = " . json_encode($target) . ";";
      }
      ?>
    }, 650);
  });
</script>
<?php endif; ?>

    <!-- Boton volver arriba -->
    <button type="button" id="backToTopBtn" class="back-to-top" aria-label="Volver arriba">
        <span aria-hidden="true" style="font-size:20px;line-height:1;">&#8593;</span>
    </button>
    <script>
        (function () {
            var btn = document.getElementById('backToTopBtn');
            if (!btn) return;

            var styleId = 'back-to-top-style';
            if (!document.getElementById(styleId)) {
                var style = document.createElement('style');
                style.id = styleId;
                style.textContent = '.back-to-top{position:fixed;right:18px;bottom:24px;width:44px;height:44px;border:none;border-radius:999px;background:#8E8B30;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.25);opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease,visibility .2s ease;z-index:2200}.back-to-top.show{opacity:1;visibility:visible;transform:translateY(0)}.back-to-top:hover{background:#7c7a2a}.back-to-top:focus{outline:2px solid #fff;outline-offset:2px}@media (max-width:576px){.back-to-top{right:14px;bottom:120px}}';
                document.head.appendChild(style);
            }

            function hasScrollableContent() {
                var doc = document.documentElement;
                var body = document.body;
                var scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
                return scrollHeight > (window.innerHeight + 20);
            }

            function toggleBackToTop() {
                var y = window.pageYOffset || document.documentElement.scrollTop;
                btn.classList.toggle('show', y > 220 && hasScrollableContent());
            }

            btn.addEventListener('click', function () {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            window.addEventListener('scroll', toggleBackToTop, { passive: true });
            window.addEventListener('resize', toggleBackToTop);
            window.addEventListener('load', toggleBackToTop);
            toggleBackToTop();
        })();
    </script>
</body>
</html>


<?php
declare(strict_types=1);

require_once __DIR__ . '/config/env.php';
Env::load();

if (Env::bool('APP_DEBUG', false)) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }
    ini_set('error_log', $logDir . '/error.log');
}

require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/core/Auth.php';

$pdo = Database::connect();

define('MAX_FAILED_LOGINS', 5);

// === NAVIDAD: activar/desactivar nieve ===
$SNOW_ENABLED = (date('n') == 12) || (date('n') == 1 && date('j') <= 7);

$login_success = !empty($_SESSION['login_success']);
unset($_SESSION['login_success']);

// Si ya está logueado, redirigir a la app
if (Auth::isLoggedIn() && !$login_success) {
    // Acción de logout
    if (isset($_GET['logout'])) {
        Auth::logout();
        header('Location: login.php');
        exit;
    }
    header('Location: /Gestor de Rutas/');
    exit;
}

$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Rate limiting: max 10 intentos por minuto por sesion
    Auth::init();
    $now = time();
    $attempts = $_SESSION['login_attempts'] ?? [];
    $attempts = array_filter($attempts, fn($t) => $t > $now - 60);
    if (count($attempts) >= 10) {
        $error = 'Demasiados intentos. Espera un minuto.';
    } else {
        $attempts[] = $now;
    }
    $_SESSION['login_attempts'] = $attempts;

    // Validar CSRF
    $csrfOk = Auth::validateCsrf($_POST['_csrf'] ?? null);
    if (!$csrfOk && !$error) {
        $error = 'Sesion expirada. Recarga la pagina e intentalo de nuevo.';
    }

    $username = trim($_POST['username'] ?? '');
    $password = (string) ($_POST['password'] ?? '');
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    if (!$error) {
    $stmt = $pdo->prepare("
        SELECT id, username, pass_hash, full_name, role, comercial_id, failed_logins, locked
        FROM app_users
        WHERE username = ? AND active = 1
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user) {
        usleep(200000);
        $error = 'Usuario o contraseña incorrectos';
    } elseif ((int) $user['locked'] === 1) {
        $error = 'Tu usuario está bloqueado por intentos fallidos. Contacta con un administrador.';
    } elseif (password_verify($password, $user['pass_hash'])) {
        // Login OK
        $pdo->prepare("
            UPDATE app_users SET failed_logins = 0, last_login_at = NOW(), last_login_ip = ? WHERE id = ?
        ")->execute([$ip, (int) $user['id']]);

        Auth::login($user);
        $_SESSION['login_success'] = true;
        header('Location: login.php');
        exit;
    } else {
        // Fallo: incrementar contador
        $userId = (int) $user['id'];
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare("SELECT COALESCE(failed_logins,0) AS failed_logins, COALESCE(locked,0) AS locked FROM app_users WHERE id = ? FOR UPDATE");
            $st->execute([$userId]);
            $cur = $st->fetch();

            $newFailed = min((int) $cur['failed_logins'] + 1, MAX_FAILED_LOGINS);
            $willLock = $newFailed >= MAX_FAILED_LOGINS ? 1 : 0;

            $pdo->prepare("
                UPDATE app_users
                SET failed_logins = ?, last_failed_login = NOW(), locked = ?,
                    locked_at = IF(? = 1 AND locked = 0, NOW(), locked_at)
                WHERE id = ?
            ")->execute([$newFailed, $willLock, $willLock, $userId]);

            $pdo->commit();

            if ($willLock) {
                $error = 'Has alcanzado 5 intentos fallidos. Tu usuario ha sido bloqueado.';
            } else {
                $restantes = MAX_FAILED_LOGINS - $newFailed;
                $error = "Usuario o contraseña incorrectos. Intentos restantes: {$restantes}";
            }
        } catch (\Throwable $e) {
            $pdo->rollBack();
            $error = 'Error interno. Inténtalo de nuevo.';
        }
    }
    } // fin if (!$error) — CSRF
}
?>

<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Acceso · Veraleza</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- Bootstrap + Poppins -->
  <link href="public/vendor/bootstrap/bootstrap.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;600&display=swap" rel="stylesheet">
  <link href="public/vendor/bootstrap-icons/bootstrap-icons.min.css" rel="stylesheet">
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
        Gestor de Rutas · Veraleza
      </div>
    </aside>

    <!-- Lado formulario -->
    <main class="login-card">
      <div class="card-ui">
        <div class="header" style="display:flex; justify-content:center; align-items:center;">
  <img src="img/logo_login.png" alt="Veraleza" class="brand-logo">
</div>


        <div class="body">
          <?php if ($error): ?>
            <div class="alert alert-vz mb-3"><?=htmlspecialchars($error)?></div>
          <?php endif; ?>

          <form method="post" autocomplete="off" novalidate>
            <input type="hidden" name="_csrf" value="<?= htmlspecialchars(Auth::csrfToken()) ?>">
                      <div class="mb-3">
  <label for="user" class="form-label">Usuario</label>
  <div class="input-group">
    <input id="user" name="username" class="form-control" required autofocus
           value="<?= htmlspecialchars($_POST['username'] ?? '') ?>">
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
          &copy; <?=date('Y')?> Veraleza
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
    flake.textContent = '\u2744';

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
      window.location.href = '/Gestor de Rutas/';
    }, 650);
  });
</script>
<?php endif; ?>

</body>
</html>

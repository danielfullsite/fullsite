# ─── Instalar / reparar el servicio de huella en ESTA caja ─────────────────────
# Ejecuta el jueves (o cuando tengas acceso a la caja). Idempotente: puedes correrlo
# varias veces sin dañar nada. Hace exactamente lo que hicimos a mano el 12-jul.
#
# Uso (PowerShell como admin, desde la carpeta que tenga los binarios):
#   powershell -ExecutionPolicy Bypass -File install-fingerprint.ps1
#
# Requiere en la carpeta actual: fingerprint-service.exe + DPUruNet.dll
# (o que ya existan en C:\fullsite\).

$ErrorActionPreference = 'Stop'
$target = 'C:\fullsite'
$exe = Join-Path $target 'fingerprint-service.exe'
$dll = Join-Path $target 'DPUruNet.dll'

Write-Host '=== Fullsite — instalar/reparar huella ===' -ForegroundColor Cyan

# 1) Asegurar C:\fullsite\ y copiar binarios si están junto al script
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($f in @('fingerprint-service.exe','DPUruNet.dll')) {
  $src = Join-Path $PSScriptRoot $f
  $dst = Join-Path $target $f
  if ((Test-Path $src) -and -not (Test-Path $dst)) {
    Copy-Item $src $dst -Force
    Write-Host "[copiado] $f -> $target" -ForegroundColor Green
  }
}

if (-not (Test-Path $exe) -or -not (Test-Path $dll)) {
  Write-Host "[ERROR] Faltan binarios en $target. Compila con build-fingerprint.bat y vuelve a correr." -ForegroundColor Red
  exit 1
}
Write-Host "[ok] Binarios presentes en $target" -ForegroundColor Green

# 1b) El DLL tiene que ser EL autorizado — fail-closed
# No se commitea por licencia, pero «no está en el repo» no puede significar
# «cualquier DLL vale»: esto habla con el lector y devuelve identidades.
$listaDeps = Join-Path $PSScriptRoot 'dependencias-esperadas.txt'
if (Test-Path $listaDeps) {
  $esperado = $null
  foreach ($linea in Get-Content $listaDeps) {
    if ($linea -match '^\s*#' -or $linea -match '^\s*$') { continue }
    $campos = $linea -split '\s+'
    if ($campos[0] -ieq 'DPUruNet.dll') { $esperado = $campos[1].ToLowerInvariant(); break }
  }
  $medido = (Get-FileHash -Path $dll -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($esperado -and $medido -ne $esperado) {
    Write-Host '[ERROR] DPUruNet.dll NO es el autorizado.' -ForegroundColor Red
    Write-Host "        esperado: $esperado" -ForegroundColor Red
    Write-Host "        medido  : $medido"   -ForegroundColor Red
    Write-Host '        Si es una version nueva legitima, agregala a dependencias-esperadas.txt.' -ForegroundColor Red
    exit 1
  }
  Write-Host "[ok] DPUruNet.dll coincide con la identidad autorizada" -ForegroundColor Green
} else {
  Write-Host '[WARN] No hay dependencias-esperadas.txt junto al script: el DLL no se valido.' -ForegroundColor Yellow
}

# 1c) El secreto IPC: se VERIFICA, no se crea.
# Electron es el unico creador (prepareFingerprintIpcSecret). Si este script lo
# generara habria DOS autoridades y la primera vez que difieran la huella muere
# sin que nadie sepa cual mando. Aqui solo se mira si existe y se dice que hacer.
$rutasUserData = @(
  (Join-Path $env:APPDATA 'fullsite-pos'),
  (Join-Path $env:APPDATA 'Fullsite POS')
)
$secretoEncontrado = $false
foreach ($base in $rutasUserData) {
  $rutaSecreto = Join-Path $base 'fingerprint\fingerprint-ipc-secret'
  if (Test-Path $rutaSecreto) {
    # NUNCA se imprime el valor: solo su forma y su tamano.
    $contenido = (Get-Content $rutaSecreto -Raw).Trim()
    if ($contenido -match '^[a-f0-9]{64}$') {
      Write-Host "[ok] Secreto IPC presente y bien formado en $base" -ForegroundColor Green
      $secretoEncontrado = $true
    } else {
      Write-Host "[ERROR] El secreto en $base esta malformado ($($contenido.Length) chars)." -ForegroundColor Red
      Write-Host '        Borra ese archivo y abre el POS una vez: Electron lo regenera.' -ForegroundColor Red
      exit 1
    }
    break
  }
}
if (-not $secretoEncontrado) {
  Write-Host '[PENDIENTE] Todavia no hay secreto IPC de huella.' -ForegroundColor Yellow
  Write-Host '            Es lo esperado en una instalacion nueva: lo crea Electron al' -ForegroundColor Yellow
  Write-Host '            arrancar el POS por primera vez. Abre el POS una vez y vuelve' -ForegroundColor Yellow
  Write-Host '            a correr este script para confirmar.' -ForegroundColor Yellow
}

# 2) BUG #1 de campo: quitar cualquier start-bridge.bat del Startup (acapara 7717)
$startup = [Environment]::GetFolderPath('Startup')
Get-ChildItem -Path $startup -Filter '*bridge*.bat' -ErrorAction SilentlyContinue | ForEach-Object {
  $bak = "$($_.FullName).disabled"
  Move-Item $_.FullName $bak -Force
  Write-Host "[quitado del Startup] $($_.Name) -> $bak (ese .bat es el que dejaba 'solo PIN, sin huella')" -ForegroundColor Yellow
}

# 3) ¿Está ocupado el 7718 por algo raro? (debería ser SOLO el servicio de huella)
$p = Get-NetTCPConnection -LocalPort 7718 -State Listen -ErrorAction SilentlyContinue
if ($p) { Write-Host "[info] 7718 ya escuchando (PID $($p.OwningProcess)). Si no es la huella, ciérralo." -ForegroundColor DarkYellow }

# 4) Arrancar el servicio (Electron también lo arranca solo; esto es para probar YA)
if (-not $p) {
  Write-Host '[start] Lanzando fingerprint-service.exe...' -ForegroundColor Cyan
  Start-Process -FilePath $exe -WorkingDirectory $target -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 5) Health check — OJO: este sondeo va SIN FIRMAR, a proposito.
#
# Este script no tiene el secreto y no debe tenerlo. Contra el servicio nuevo,
# una peticion sin firma recibe 401 — y eso es la BUENA noticia: prueba que el
# binario con HMAC esta vivo y exigiendo identidad. La version anterior de este
# bloque interpretaba cualquier no-200 como «no responde» y habria reportado
# FALLO sobre una instalacion sana. Es el mismo error de lectura que costo horas
# el 13-sep en AMALAY.
$respuesta = try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:7718/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
} catch { $_.Exception.Response }

if (-not $respuesta) {
  Write-Host '[FAIL] 7718 no contesta. Revisa que el .exe arrancara y el lector este conectado.' -ForegroundColor Red
} elseif ([int]$respuesta.StatusCode -eq 401) {
  Write-Host '[PASS] 7718 responde 401 a una peticion sin firmar.' -ForegroundColor Green
  Write-Host '       Es lo CORRECTO: el servicio con HMAC esta vivo y exige identidad.' -ForegroundColor Green
  Write-Host '       Quien lo consulta de verdad es Pedro, que si firma.' -ForegroundColor Green
} elseif ([int]$respuesta.StatusCode -eq 200) {
  Write-Host '[ATENCION] 7718 acepto una peticion SIN FIRMAR.' -ForegroundColor Yellow
  Write-Host '           Eso es el binario VIEJO (el del 8-jul, sin HMAC), o otro proceso.' -ForegroundColor Yellow
  Write-Host '           Es exactamente el defecto D-01. Reemplaza el exe por el compilado' -ForegroundColor Yellow
  Write-Host '           con build-fingerprint.ps1 antes de dar la huella por buena.' -ForegroundColor Yellow
} else {
  Write-Host "[WARN] 7718 respondio $([int]$respuesta.StatusCode); no es 200 ni 401." -ForegroundColor Yellow
}

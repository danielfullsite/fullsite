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

# 5) Health check
try {
  $h = Invoke-RestMethod -Uri 'http://127.0.0.1:7718/health' -TimeoutSec 3
  if ($h.ok) {
    Write-Host "[PASS] /health ok. reader=$($h.reader)" -ForegroundColor Green
    if (-not $h.reader) { Write-Host '       (conecta el lector HID DigitalPersona 4500 por USB)' -ForegroundColor Yellow }
    Write-Host '       -> El POS mostrara "Entrar con huella" en cuanto recargue.' -ForegroundColor Green
  } else {
    Write-Host '[WARN] /health respondio pero ok=false.' -ForegroundColor Yellow
  }
} catch {
  Write-Host '[FAIL] 7718 no responde. Revisa que el .exe arrancara y el lector este conectado.' -ForegroundColor Red
}

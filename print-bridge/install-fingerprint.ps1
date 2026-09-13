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
$ipcSecretDirectory = Join-Path $env:APPDATA 'Fullsite POS\fingerprint'
$ipcSecretFile = Join-Path $ipcSecretDirectory 'fingerprint-ipc-secret'
$ipcAuthVersion = 'fullsite-fingerprint-hmac-v1'

function Convert-HexToBytes([string]$hex) {
  $result = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $result.Length; $i++) {
    $result[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
  }
  return $result
}

function Convert-BytesToHex([byte[]]$bytes) {
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return Convert-BytesToHex ($sha.ComputeHash($bytes)) } finally { $sha.Dispose() }
}

function Get-HmacHex([string]$text, [string]$secretHex) {
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = Convert-HexToBytes $secretHex
  try { return Convert-BytesToHex ($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))) } finally { $hmac.Dispose() }
}

function New-IpcNonce {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return Convert-BytesToHex $bytes
}

Write-Host '=== Fullsite — instalar/reparar huella ===' -ForegroundColor Cyan

# 1) Asegurar C:\fullsite\ y copiar binarios si están junto al script
New-Item -ItemType Directory -Force -Path $target | Out-Null
New-Item -ItemType Directory -Force -Path $ipcSecretDirectory | Out-Null
if (-not (Test-Path $ipcSecretFile)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  [System.IO.File]::WriteAllText($ipcSecretFile, $secret, [System.Text.Encoding]::ASCII)
}
& icacls.exe $ipcSecretFile /inheritance:r /grant:r "$($env:USERNAME):(F)" "SYSTEM:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[ERROR] No se pudo restringir el secreto IPC al usuario de la caja y SYSTEM.' -ForegroundColor Red
  exit 1
}
$ipcSecret = (Get-Content -Raw $ipcSecretFile).Trim()
if ($ipcSecret -notmatch '^[a-f0-9]{64}$') {
  Write-Host '[ERROR] fingerprint-ipc-secret inválido. No se arranca un servicio abierto.' -ForegroundColor Red
  exit 1
}
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
  $env:FULLSITE_FINGERPRINT_IPC_SECRET = $ipcSecret
  try {
    Start-Process -FilePath $exe -WorkingDirectory $target -WindowStyle Hidden
  } finally {
    Remove-Item Env:\FULLSITE_FINGERPRINT_IPC_SECRET -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

# 5) Health check
try {
  $method = 'GET'
  $requestPath = '/health'
  $timestamp = [string][int64](([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalMilliseconds)
  $nonce = New-IpcNonce
  $emptyHash = Get-Sha256Hex ([System.Text.Encoding]::UTF8.GetBytes(''))
  $requestCanonical = [string]::Join("`n", @($ipcAuthVersion, $timestamp, $nonce, $method, $requestPath, $emptyHash))
  $requestHeaders = @{
    'X-Fullsite-Fingerprint-Timestamp' = $timestamp
    'X-Fullsite-Fingerprint-Nonce' = $nonce
    'X-Fullsite-Fingerprint-Signature' = Get-HmacHex $requestCanonical $ipcSecret
  }
  $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7718/health' -Headers $requestHeaders -TimeoutSec 3
  $responseBody = [string]$response.Content
  $responseHash = Get-Sha256Hex ([System.Text.Encoding]::UTF8.GetBytes($responseBody))
  $responseCanonical = [string]::Join("`n", @($ipcAuthVersion + '-response', $timestamp, $nonce, $method, $requestPath, [string]$response.StatusCode, $responseHash))
  $expectedSignature = Get-HmacHex $responseCanonical $ipcSecret
  $presentedSignature = [string]$response.Headers['X-Fullsite-Fingerprint-Response-Signature']
  if (-not ($presentedSignature -ceq $expectedSignature)) {
    throw 'El proceso en 7718 no demostró conocer el secreto IPC.'
  }
  $h = $responseBody | ConvertFrom-Json
  if ($h.ok -and $h.ipc_auth_required -eq $true -and $h.ipc_auth_scheme -eq 'hmac-sha256-v1') {
    Write-Host "[PASS] /health ok. reader=$($h.reader)" -ForegroundColor Green
    if (-not $h.reader) { Write-Host '       (conecta el lector HID DigitalPersona 4500 por USB)' -ForegroundColor Yellow }
    Write-Host '       -> El POS mostrara "Entrar con huella" en cuanto recargue.' -ForegroundColor Green
  } else {
    Write-Host '[FAIL] El servicio en 7718 es viejo, impostor o no usa HMAC mutuo. Deténlo, reemplaza el .exe y repite.' -ForegroundColor Red
    exit 1
  }
} catch {
  Write-Host '[FAIL] 7718 no responde. Revisa que el .exe arrancara y el lector este conectado.' -ForegroundColor Red
  exit 1
}

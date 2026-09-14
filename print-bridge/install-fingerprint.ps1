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
$ipcAuthVersion = 'fullsite-fingerprint-hmac-v1'

function Find-FullsiteUserData {
  $candidates = @()
  if ($env:FULLSITE_USER_DATA_DIR) { $candidates += $env:FULLSITE_USER_DATA_DIR }
  $candidates += @(
    (Join-Path $env:APPDATA 'fullsite-pos'),
    (Join-Path $env:APPDATA 'Fullsite POS')
  )
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $configFile = Join-Path $candidate 'config.json'
    if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { continue }
    try {
      $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
      $restaurant = $config.restaurant_id
      if (-not $restaurant) { $restaurant = $config.restaurantId }
      if (-not $restaurant) { $restaurant = $config.client_id }
      if (-not $restaurant) { $restaurant = $config.clientId }
      if ($restaurant -and ([string]$restaurant -match '^[a-zA-Z0-9_-]{1,40}$')) { return $candidate }
    } catch {
      # No se imprime el JSON ni el error completo: el archivo puede traer secretos.
    }
  }
  throw 'No se encontró el userData válido de Electron (config.json con restaurant_id). Abre Fullsite POS una vez y vuelve a intentar.'
}

$userDataDirectory = Find-FullsiteUserData
$ipcSecretDirectory = Join-Path $userDataDirectory 'fingerprint'
$ipcSecretFile = Join-Path $ipcSecretDirectory 'fingerprint-ipc-secret'

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

function Get-FileSha256([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ExactFingerprintProcesses {
  $targetPath = [System.IO.Path]::GetFullPath($exe)
  return @(Get-CimInstance Win32_Process -Filter "Name = 'fingerprint-service.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $targetPath)
    })
}

function Assert-PortOwnerIsExpected {
  $listeners = @(Get-NetTCPConnection -LocalPort 7718 -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $ownerId = [int]$listener.OwningProcess
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
    if (-not $owner -or -not $owner.ExecutablePath -or
      -not ([System.IO.Path]::GetFullPath($owner.ExecutablePath) -ieq [System.IO.Path]::GetFullPath($exe))) {
      throw "El puerto 7718 pertenece a otro proceso (PID $ownerId). No se detuvo ni reemplazó nada."
    }
  }
}

function Install-VerifiedBinaries {
  $sourceExe = Join-Path $PSScriptRoot 'fingerprint-service.exe'
  $sourceDll = Join-Path $PSScriptRoot 'DPUruNet.dll'
  if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceDll -PathType Leaf)) {
    if ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $dll -PathType Leaf)) { return }
    throw 'Faltan fingerprint-service.exe y DPUruNet.dll junto al instalador.'
  }

  $sourceExeHash = Get-FileSha256 $sourceExe
  $sourceDllHash = Get-FileSha256 $sourceDll
  $alreadyCurrent = (Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $dll -PathType Leaf) -and
    ((Get-FileSha256 $exe) -eq $sourceExeHash) -and ((Get-FileSha256 $dll) -eq $sourceDllHash)
  if ($alreadyCurrent) {
    Write-Host '[ok] Los binarios instalados ya coinciden por SHA-256.' -ForegroundColor Green
    return
  }

  Assert-PortOwnerIsExpected
  foreach ($process in (Get-ExactFingerprintProcesses)) {
    Write-Host "[stop] Deteniendo sólo $($process.ExecutablePath) (PID $($process.ProcessId))" -ForegroundColor Yellow
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }

  $stage = Join-Path $target ('.fingerprint-stage-' + [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $target ('fingerprint-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  try {
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stage 'fingerprint-service.exe') -Force
    Copy-Item -LiteralPath $sourceDll -Destination (Join-Path $stage 'DPUruNet.dll') -Force
    if ((Get-FileSha256 (Join-Path $stage 'fingerprint-service.exe')) -ne $sourceExeHash -or
      (Get-FileSha256 (Join-Path $stage 'DPUruNet.dll')) -ne $sourceDllHash) {
      throw 'La copia temporal no coincide por SHA-256.'
    }
    if (Test-Path -LiteralPath $exe) { Move-Item -LiteralPath $exe -Destination (Join-Path $backup 'fingerprint-service.exe') -Force }
    if (Test-Path -LiteralPath $dll) { Move-Item -LiteralPath $dll -Destination (Join-Path $backup 'DPUruNet.dll') -Force }
    Move-Item -LiteralPath (Join-Path $stage 'fingerprint-service.exe') -Destination $exe -Force
    Move-Item -LiteralPath (Join-Path $stage 'DPUruNet.dll') -Destination $dll -Force
    if ((Get-FileSha256 $exe) -ne $sourceExeHash -or (Get-FileSha256 $dll) -ne $sourceDllHash) {
      throw 'Los binarios instalados no coinciden por SHA-256.'
    }
    Write-Host "[actualizado] Binarios verificados. Respaldo recuperable: $backup" -ForegroundColor Green
  } catch {
    Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath (Join-Path $backup 'fingerprint-service.exe')) {
      Move-Item -LiteralPath (Join-Path $backup 'fingerprint-service.exe') -Destination $exe -Force
    }
    if (Test-Path -LiteralPath (Join-Path $backup 'DPUruNet.dll')) {
      Move-Item -LiteralPath (Join-Path $backup 'DPUruNet.dll') -Destination $dll -Force
    }
    throw
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host '=== Fullsite — instalar/reparar huella ===' -ForegroundColor Cyan
Write-Host "[ok] userData de Electron: $userDataDirectory" -ForegroundColor Green

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
$windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $ipcSecretFile /inheritance:r /grant:r "$windowsIdentity`:(F)" "SYSTEM:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[ERROR] No se pudo restringir el secreto IPC al usuario de la caja y SYSTEM.' -ForegroundColor Red
  exit 1
}
$ipcSecret = (Get-Content -Raw $ipcSecretFile).Trim()
if ($ipcSecret -notmatch '^[a-f0-9]{64}$') {
  Write-Host '[ERROR] fingerprint-ipc-secret inválido. No se arranca un servicio abierto.' -ForegroundColor Red
  exit 1
}
Install-VerifiedBinaries

if (-not (Test-Path $exe) -or -not (Test-Path $dll)) {
  Write-Host "[ERROR] Faltan binarios en $target. Compila con build-fingerprint.bat y vuelve a correr." -ForegroundColor Red
  exit 1
}
Write-Host "[ok] Binarios presentes en $target" -ForegroundColor Green

# 2) ¿Está ocupado el 7718 por el binario exacto esperado?
$p = Get-NetTCPConnection -LocalPort 7718 -State Listen -ErrorAction SilentlyContinue
if ($p) {
  Assert-PortOwnerIsExpected
  Write-Host "[info] Servicio exacto ya escucha en 7718 (PID $($p.OwningProcess))." -ForegroundColor DarkYellow
}

# 3) Arrancar el servicio (Electron también lo arranca solo; esto es para probar YA)
if (-not $p) {
  Write-Host '[start] Lanzando fingerprint-service.exe...' -ForegroundColor Cyan
  $env:FULLSITE_FINGERPRINT_IPC_SECRET = $ipcSecret
  $env:FULLSITE_USER_DATA_DIR = $userDataDirectory
  try {
    Start-Process -FilePath $exe -WorkingDirectory $target -WindowStyle Hidden
  } finally {
    Remove-Item Env:\FULLSITE_FINGERPRINT_IPC_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:\FULLSITE_USER_DATA_DIR -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

# 4) Health check HMAC mutuo
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

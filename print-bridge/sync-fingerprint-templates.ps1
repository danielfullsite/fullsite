# Transferencia administrativa de plantillas: Caja -> POS secundario.
#
# No usa la credencial LAN ni Supabase. El bundle sale cifrado y autenticado;
# el JSON biometrico nunca se escribe en claro. Ejecutar como administrador y
# con Fullsite POS cerrado en ambos equipos.
#
# Caja:
#   .\sync-fingerprint-templates.ps1 -Mode Export -BundlePath C:\Temp\amalay.fpsync
# POS secundario (copiar el .fpsync por TeamViewer/Tailscale; la clave se pide
# de forma interactiva y no queda en el historial de PowerShell):
#   .\sync-fingerprint-templates.ps1 -Mode Import -BundlePath C:\Temp\amalay.fpsync
# El destino debe declarar terminal_role=pos. Si una secundaria dice server_pos,
# corrige primero su aprovisionamiento; relajar esta comprobacion haria que una
# Caja equivocada pudiera ser reemplazada con biometria de otra maquina.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Export', 'Import')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$BundlePath
)

$ErrorActionPreference = 'Stop'
$bundleVersion = 'fullsite-fingerprint-transfer-v1'
$maxTemplateBytes = 65536
$maxTemplates = 500
$maxBundleAgeHours = 24
$maxEncryptedBundleBytes = 16MB
$fingerprintExe = 'C:\fullsite\fingerprint-service.exe'
$TemplatesDirectory = 'C:\fullsite\fingerprints'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta PowerShell como administrador.'
  }
}

function Find-FullsiteConfig {
  $candidates = @(
    (Join-Path $env:APPDATA 'fullsite-pos\config.json'),
    (Join-Path $env:APPDATA 'Fullsite POS\config.json'),
    'C:\fullsite\config.json'
  )
  foreach ($path in ($candidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    try {
      $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      $clientId = [string]$config.restaurant_id
      if (-not $clientId) { $clientId = [string]$config.restaurantId }
      if (-not $clientId) { $clientId = [string]$config.client_id }
      if (-not $clientId) { $clientId = [string]$config.clientId }
      $terminalRole = [string]$config.terminal_role
      if (-not $terminalRole) { $terminalRole = [string]$config.terminalRole }
      if ($clientId -match '^[a-zA-Z0-9_-]{1,40}$' -and $terminalRole) {
        return @{ Path = $path; ClientId = $clientId.ToLowerInvariant(); TerminalRole = $terminalRole }
      }
    } catch {
      # El config puede contener secretos. No imprimir contenido ni excepcion.
    }
  }
  throw 'No se encontro un config.json aprovisionado con restaurant_id y terminal_role.'
}

function Assert-Role([hashtable]$configInfo, [string]$expected) {
  if ($configInfo.TerminalRole -eq 'kds') {
    throw 'Un KDS jamas recibe ni exporta plantillas biometricas.'
  }
  if ($configInfo.TerminalRole -ne $expected) {
    throw "Modo $Mode requiere terminal_role=$expected; esta maquina declara $($configInfo.TerminalRole)."
  }
}

function Convert-BytesToHex([byte[]]$bytes) {
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return Convert-BytesToHex ($sha.ComputeHash($bytes)) } finally { $sha.Dispose() }
}

function Get-HmacBytes([byte[]]$key, [string]$text) {
  $hmac = New-Object Security.Cryptography.HMACSHA256
  $hmac.Key = $key
  try { return $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) } finally { $hmac.Dispose() }
}

function Test-ConstantTimeEqual([byte[]]$left, [byte[]]$right) {
  if ($null -eq $left -or $null -eq $right) { return $false }
  $different = $left.Length -bxor $right.Length
  $length = [Math]::Max($left.Length, $right.Length)
  for ($i = 0; $i -lt $length; $i++) {
    $a = if ($i -lt $left.Length) { $left[$i] } else { 0 }
    $b = if ($i -lt $right.Length) { $right[$i] } else { 0 }
    $different = $different -bor ($a -bxor $b)
  }
  return $different -eq 0
}

function New-RandomBytes([int]$length) {
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return $bytes
}

function Read-TransferKey {
  $secure = Read-Host 'Pega la clave efimera de transferencia' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $encoded = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  try { $key = [Convert]::FromBase64String($encoded) } catch { throw 'TransferKey no es Base64 valido.' }
  if ($key.Length -ne 32) { throw 'TransferKey debe representar exactamente 32 bytes.' }
  return $key
}

function Derive-Key([byte[]]$master, [string]$purpose) {
  return Get-HmacBytes $master ($bundleVersion + "`n" + $purpose)
}

function Protect-Payload([string]$plainText, [byte[]]$masterKey) {
  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256
  $aes.BlockSize = 128
  $aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = Derive-Key $masterKey 'encryption'
  $aes.GenerateIV()
  try {
    $encryptor = $aes.CreateEncryptor()
    try { $cipher = $encryptor.TransformFinalBlock([Text.Encoding]::UTF8.GetBytes($plainText), 0, [Text.Encoding]::UTF8.GetByteCount($plainText)) }
    finally { $encryptor.Dispose() }
    $iv = [Convert]::ToBase64String($aes.IV)
    $cipherText = [Convert]::ToBase64String($cipher)
    $macInput = [string]::Join("`n", @($bundleVersion, $iv, $cipherText))
    $mac = [Convert]::ToBase64String((Get-HmacBytes (Derive-Key $masterKey 'authentication') $macInput))
    return @{ version = $bundleVersion; algorithm = 'AES-256-CBC+HMAC-SHA256'; iv = $iv; ciphertext = $cipherText; mac = $mac }
  } finally { $aes.Dispose() }
}

function Unprotect-Payload($envelope, [byte[]]$masterKey) {
  if ($envelope.version -ne $bundleVersion -or $envelope.algorithm -ne 'AES-256-CBC+HMAC-SHA256') {
    throw 'Formato de bundle no soportado.'
  }
  try {
    $iv = [Convert]::FromBase64String([string]$envelope.iv)
    $cipher = [Convert]::FromBase64String([string]$envelope.ciphertext)
    $presentedMac = [Convert]::FromBase64String([string]$envelope.mac)
  } catch { throw 'Bundle cifrado malformado.' }
  $macInput = [string]::Join("`n", @($bundleVersion, [string]$envelope.iv, [string]$envelope.ciphertext))
  $expectedMac = Get-HmacBytes (Derive-Key $masterKey 'authentication') $macInput
  if (-not (Test-ConstantTimeEqual $presentedMac $expectedMac)) { throw 'Bundle alterado o TransferKey incorrecta.' }

  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256
  $aes.BlockSize = 128
  $aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = Derive-Key $masterKey 'encryption'
  $aes.IV = $iv
  try {
    $decryptor = $aes.CreateDecryptor()
    try { $plain = $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length) }
    finally { $decryptor.Dispose() }
    return [Text.Encoding]::UTF8.GetString($plain)
  } finally { $aes.Dispose() }
}

function Assert-FullsiteClosedAndStopFingerprint {
  $fullsite = @(Get-CimInstance Win32_Process -Filter "Name = 'Fullsite POS.exe'" -ErrorAction SilentlyContinue)
  if ($fullsite.Count -gt 0) { throw 'Cierra Fullsite POS antes de transferir huellas; podria reiniciar el servicio durante el cambio.' }

  $expected = [IO.Path]::GetFullPath($fingerprintExe)
  $listeners = @(Get-NetTCPConnection -LocalPort 7718 -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $owner -or -not $owner.ExecutablePath -or ([IO.Path]::GetFullPath($owner.ExecutablePath) -ine $expected)) {
      throw "Puerto 7718 pertenece a otro proceso (PID $($listener.OwningProcess)); no se detuvo nada."
    }
  }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'fingerprint-service.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $expected) })
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  }
  $stillRunning = @(Get-CimInstance Win32_Process -Filter "Name = 'fingerprint-service.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $expected) })
  if ($stillRunning.Count -gt 0) { throw 'El servicio de huella no se detuvo; no se modificaron las plantillas.' }
}

function Protect-TemplateDirectory([string]$path) {
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  if (-not $account) { throw 'No se pudo resolver la cuenta Windows que ejecuta la transferencia.' }
  & icacls.exe $path /inheritance:r /grant:r "$($account):(OI)(CI)(F)" 'SYSTEM:(OI)(CI)(F)' /T /C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo restringir el ACL de $path." }
}

function Export-Templates([hashtable]$configInfo) {
  if (-not (Test-Path -LiteralPath $TemplatesDirectory -PathType Container)) { throw "No existe $TemplatesDirectory." }
  $resolvedBundle = [IO.Path]::GetFullPath($BundlePath)
  if (Test-Path -LiteralPath $resolvedBundle) { throw 'El bundle ya existe; usa otra ruta. No se sobrescribio nada.' }
  $parent = Split-Path -Parent $resolvedBundle
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "No existe la carpeta destino $parent." }

  Protect-TemplateDirectory $TemplatesDirectory
  $items = @()
  $files = @(Get-ChildItem -LiteralPath $TemplatesDirectory -File -Filter '*.b64')
  if ($files.Count -gt $maxTemplates) { throw "Hay mas de $maxTemplates plantillas; exportacion abortada." }
  foreach ($file in $files) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "No se exportan enlaces: $($file.Name)." }
    $id = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    if ($id -notmatch '^[a-zA-Z0-9_-]{1,128}$') { throw "Nombre de plantilla invalido: $($file.Name)." }
    $base64 = (Get-Content -LiteralPath $file.FullName -Raw).Trim()
    try { $bytes = [Convert]::FromBase64String($base64) } catch { throw "Plantilla $($file.Name) no es Base64 valida." }
    if ($bytes.Length -eq 0 -or $bytes.Length -gt $maxTemplateBytes) { throw "Tamano de plantilla invalido: $($file.Name)." }
    $items += @{ id = $id; template = $base64; sha256 = Get-Sha256Hex $bytes }
  }
  if ($items.Count -eq 0) { throw 'Caja no tiene plantillas locales para exportar.' }

  $manifest = @{
    version = $bundleVersion
    client_id = $configInfo.ClientId
    source_role = 'server_pos'
    created_at = [DateTime]::UtcNow.ToString('o')
    templates = $items
  } | ConvertTo-Json -Depth 5 -Compress
  $master = New-RandomBytes 32
  try {
    $envelope = Protect-Payload $manifest $master
    [IO.File]::WriteAllText($resolvedBundle, ($envelope | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    $shownKey = [Convert]::ToBase64String($master)
  } finally {
    [Array]::Clear($master, 0, $master.Length)
  }
  Write-Host "[PASS] Bundle cifrado con $($items.Count) plantilla(s): $resolvedBundle" -ForegroundColor Green
  Write-Host "[CLAVE EFIMERA DE TRANSFERENCIA] $shownKey" -ForegroundColor Yellow
  Write-Host 'Transfiere bundle y clave por canales separados si es posible. No guardes la clave en config.json.' -ForegroundColor Yellow
}

function Import-Templates([hashtable]$configInfo) {
  $resolvedBundle = [IO.Path]::GetFullPath($BundlePath)
  if (-not (Test-Path -LiteralPath $resolvedBundle -PathType Leaf)) { throw "No existe el bundle $resolvedBundle." }
  $bundleInfo = Get-Item -LiteralPath $resolvedBundle
  if ($bundleInfo.Length -le 0 -or $bundleInfo.Length -gt $maxEncryptedBundleBytes) {
    throw 'Tamano de bundle cifrado fuera de limite.'
  }
  try { $envelope = Get-Content -LiteralPath $resolvedBundle -Raw | ConvertFrom-Json } catch { throw 'Bundle no es JSON valido.' }
  $master = Read-TransferKey
  try { $plain = Unprotect-Payload $envelope $master }
  finally { [Array]::Clear($master, 0, $master.Length) }
  try { $manifest = $plain | ConvertFrom-Json } catch { throw 'Contenido autenticado del bundle no es JSON valido.' }
  if ($manifest.version -ne $bundleVersion -or $manifest.source_role -ne 'server_pos') { throw 'Bundle no fue emitido por una Caja compatible.' }
  if ([string]$manifest.client_id -ne $configInfo.ClientId) { throw 'Bundle pertenece a otro restaurante.' }
  try { $created = [DateTime]::Parse([string]$manifest.created_at).ToUniversalTime() } catch { throw 'Bundle no tiene fecha valida.' }
  if ($created -gt [DateTime]::UtcNow.AddMinutes(5) -or $created -lt [DateTime]::UtcNow.AddHours(-$maxBundleAgeHours)) {
    throw "Bundle vencido; exporta uno nuevo (vigencia $maxBundleAgeHours horas)."
  }
  $templates = @($manifest.templates)
  if ($templates.Count -eq 0 -or $templates.Count -gt $maxTemplates) { throw 'Cantidad de plantillas fuera de limite.' }

  $validated = @()
  $seen = @{}
  foreach ($item in $templates) {
    $id = [string]$item.id
    if ($id -notmatch '^[a-zA-Z0-9_-]{1,128}$' -or $seen.ContainsKey($id)) { throw 'Bundle contiene IDs invalidos o duplicados.' }
    $seen[$id] = $true
    try { $bytes = [Convert]::FromBase64String([string]$item.template) } catch { throw "Template $id no es Base64 valido." }
    if ($bytes.Length -eq 0 -or $bytes.Length -gt $maxTemplateBytes) { throw "Template $id tiene tamano invalido." }
    if ((Get-Sha256Hex $bytes) -cne [string]$item.sha256) { throw "Hash de template $id no coincide." }
    $validated += @{ id = $id; template = [string]$item.template; sha256 = [string]$item.sha256 }
  }

  $parent = Split-Path -Parent $TemplatesDirectory
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $stage = Join-Path $parent ('.fingerprints-stage-' + [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $parent ('fingerprints-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  $movedExisting = $false
  try {
    foreach ($item in $validated) {
      [IO.File]::WriteAllText((Join-Path $stage ($item.id + '.b64')), $item.template, [Text.Encoding]::ASCII)
    }
    Protect-TemplateDirectory $stage
    foreach ($item in $validated) {
      $stored = [Convert]::FromBase64String((Get-Content -LiteralPath (Join-Path $stage ($item.id + '.b64')) -Raw).Trim())
      if ((Get-Sha256Hex $stored) -cne $item.sha256) { throw "Verificacion local fallo para $($item.id)." }
    }
    if (Test-Path -LiteralPath $TemplatesDirectory) {
      Move-Item -LiteralPath $TemplatesDirectory -Destination $backup
      $movedExisting = $true
      Protect-TemplateDirectory $backup
    }
    Move-Item -LiteralPath $stage -Destination $TemplatesDirectory
    Write-Host "[PASS] $($validated.Count) plantilla(s) instaladas para $($configInfo.ClientId)." -ForegroundColor Green
    if ($movedExisting) { Write-Host "[BACKUP] Copia anterior recuperable: $backup" -ForegroundColor Yellow }
    Write-Host 'Abre Fullsite POS y verifica /health antes de borrar el bundle cifrado.' -ForegroundColor Green
  } catch {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    if ($movedExisting -and -not (Test-Path -LiteralPath $TemplatesDirectory) -and (Test-Path -LiteralPath $backup)) {
      Move-Item -LiteralPath $backup -Destination $TemplatesDirectory
    }
    throw
  }
}

Assert-Administrator
$configInfo = Find-FullsiteConfig
if ($Mode -eq 'Export') { Assert-Role $configInfo 'server_pos' } else { Assert-Role $configInfo 'pos' }
Assert-FullsiteClosedAndStopFingerprint
if ($Mode -eq 'Export') { Export-Templates $configInfo } else { Import-Templates $configInfo }

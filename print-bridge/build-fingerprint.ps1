# ─── Compilar el servicio de huella, con identidad comprobable ────────────────
#
# SOBRE LA PALABRA «REPRODUCIBLE»
#
# El csc.exe de .NET Framework 4.x es el compilador legacy: no acepta
# /deterministic y escribe un MVID y una marca de tiempo nuevos en cada corrida.
# Dos compilaciones del MISMO fuente dan un EXE con SHA-256 DISTINTO. Eso no es
# un defecto que este script pueda arreglar, y fingirlo sería peor que decirlo.
#
# Aquí «reproducible» significa lo único que este toolchain sostiene:
#   entradas fijadas por hash + toolchain declarado + salida registrada.
# La identidad del artefacto la da el MANIFIESTO, no un rebuild bit-idéntico.
# Si algún día hace falta lo segundo, hay que pasar a Roslyn (csc de VS/MSBuild)
# con /deterministic y fijar también esa versión.
#
# Uso:
#   .\build-fingerprint.ps1                 # compila
#   .\build-fingerprint.ps1 -SoloVerificar  # sólo valida entradas, no compila

[CmdletBinding()]
param(
  [switch]$SoloVerificar,
  [string]$GitSha = ''
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Parar($mensaje) { Write-Host "[ERROR] $mensaje" -ForegroundColor Red; exit 1 }
function Sha256($ruta) { (Get-FileHash -Path $ruta -Algorithm SHA256).Hash.ToLowerInvariant() }

Write-Host '=== Fullsite — build del servicio de huella ===' -ForegroundColor Cyan

# ── Entradas obligatorias ─────────────────────────────────────────────────────
foreach ($f in @('fingerprint-service.cs','dependencias-esperadas.txt')) {
  if (-not (Test-Path $f)) { Parar "Falta $f en $PSScriptRoot" }
}
if (-not (Test-Path 'DPUruNet.dll')) {
  Parar @'
Falta DPUruNet.dll.

No se commitea por licencia (SDK propietario DigitalPersona U.are.U), así que
hay que traerlo del SDK autorizado y ponerlo en esta carpeta. `electron-app\fingerprint\`
está vacío a propósito por la misma razón.
'@
}

# ── Puerta 1 · el DLL tiene que ser EL autorizado ─────────────────────────────
# Un binario que habla con el lector y devuelve identidades de empleados no se
# acepta por nombre de archivo. Si no coincide, se para: fail-closed.
$esperado = $null
foreach ($linea in Get-Content 'dependencias-esperadas.txt') {
  if ($linea -match '^\s*#' -or $linea -match '^\s*$') { continue }
  $campos = $linea -split '\s+'
  if ($campos[0] -ieq 'DPUruNet.dll') { $esperado = $campos[1].ToLowerInvariant(); break }
}
if (-not $esperado) { Parar 'dependencias-esperadas.txt no declara DPUruNet.dll.' }

$dllHash = Sha256 'DPUruNet.dll'
if ($dllHash -ne $esperado) {
  Parar @"
DPUruNet.dll NO es el autorizado.
  esperado: $esperado
  medido  : $dllHash

Si es una versión nueva legítima, agrégala a dependencias-esperadas.txt con su
procedencia. No se compila contra un DLL sin identidad.
"@
}
Write-Host "[ok] DPUruNet.dll coincide con la identidad autorizada ($($dllHash.Substring(0,16))…)" -ForegroundColor Green

# ── Puerta 2 · compilador presente ────────────────────────────────────────────
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { Parar 'No se encontró csc.exe (.NET Framework 4.x).' }
Write-Host "[ok] Compilador: $csc" -ForegroundColor Green

if ($SoloVerificar) {
  Write-Host '[OK] Entradas verificadas. No se compiló (-SoloVerificar).' -ForegroundColor Cyan
  exit 0
}

# ── Compilar ──────────────────────────────────────────────────────────────────
# /platform:x64 se fija a propósito: el SDK de DigitalPersona es nativo y un
# AnyCPU puede cargarse como x86 y fallar al enlazar el lector EN LA CAJA —
# un fallo que no sale en el build, sale en el restaurante.
$argumentos = @('/nologo','/platform:x64','/r:DPUruNet.dll','/out:fingerprint-service.exe','fingerprint-service.cs')
Write-Host '[build] Compilando fingerprint-service.exe…' -ForegroundColor Cyan
& $csc @argumentos
if ($LASTEXITCODE -ne 0) { Parar 'La compilación falló.' }
if (-not (Test-Path 'fingerprint-service.exe')) { Parar 'csc terminó bien pero no hay EXE.' }

# ── Manifiesto ────────────────────────────────────────────────────────────────
$versionCsc = try { (& $csc '/help' | Select-String -Pattern 'ompiler version' | Select-Object -First 1).ToString().Trim() } catch { 'desconocida' }
$exeHash = Sha256 'fingerprint-service.exe'
$srcHash = Sha256 'fingerprint-service.cs'
$psHash  = if (Test-Path 'install-fingerprint.ps1') { Sha256 'install-fingerprint.ps1' } else { 'ausente' }
if (-not $GitSha) {
  $GitSha = try { (& git -C $PSScriptRoot rev-parse HEAD).Trim() } catch { '(rellenar: git rev-parse HEAD)' }
}

@"
# Manifiesto del servicio de huella — generado por build-fingerprint.ps1
#
# NO es prueba de rebuild bit-idéntico: csc de .NET Framework no es determinista.
# Es la identidad de ESTE artefacto, para poder decir después qué fue exactamente
# lo que se instaló — que es justo lo que faltó en AMALAY con los «1.3.8».

build_timestamp_utc  = $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
build_host           = $env:COMPUTERNAME
toolchain_csc        = $csc
toolchain_version    = $versionCsc
platform_target      = x64
compile_command      = csc $($argumentos -join ' ')

source_git_sha       = $GitSha
source_cs_sha256     = $srcHash
dpurunet_dll_sha256  = $dllHash
install_ps1_sha256   = $psHash
output_exe_sha256    = $exeHash

secret_provisioning  = Electron es el ÚNICO creador (prepareFingerprintIpcSecret).
                       El servicio sólo LEE. Ruta: <userData>\fingerprint\fingerprint-ipc-secret
                       Electron pasa FULLSITE_USER_DATA_DIR al lanzar el servicio.
                       Sin secreto válido, el servicio falla cerrado y Pedro devuelve 503.
"@ | Set-Content -Path 'fingerprint-service.manifest.txt' -Encoding UTF8

Write-Host '[OK] fingerprint-service.exe compilado.' -ForegroundColor Green
Write-Host "     exe sha256 : $exeHash"
Write-Host "     manifiesto : fingerprint-service.manifest.txt"
Write-Host '[siguiente] Copia fingerprint-service.exe + DPUruNet.dll a:' -ForegroundColor Cyan
Write-Host '            electron-app\fingerprint\   (para empaquetar en la app)'
Write-Host '            y/o  C:\fullsite\           (para usar en ESTA caja ya mismo)'

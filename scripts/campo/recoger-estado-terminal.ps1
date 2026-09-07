# Recoge el estado de UNA terminal de Fullsite y lo deja en un archivo en el
# Escritorio. Correr en las cuatro máquinas: Caja, Entrada, Escondite y Cocina.
#
# NO instala, NO cambia nada, NO reinicia nada. Sólo lee.
#
# Cómo correrlo: clic derecho sobre el archivo, "Ejecutar con PowerShell".
# Si Windows lo bloquea, abrir PowerShell y pegar:
#   powershell -ExecutionPolicy Bypass -File .\recoger-estado-terminal.ps1
#
# El secreto de la red local NUNCA se escribe en el reporte: sólo si existe y
# cuántos caracteres tiene.

$ErrorActionPreference = 'Continue'

$carpeta = Join-Path $env:APPDATA 'Fullsite POS'
$salida  = Join-Path ([Environment]::GetFolderPath('Desktop')) ("fullsite-estado-$env:COMPUTERNAME.txt")
$r = New-Object System.Collections.ArrayList

function Anotar($texto) { [void]$r.Add($texto) }

Anotar "==============================================="
Anotar " Estado de terminal Fullsite"
Anotar " Equipo:  $env:COMPUTERNAME"
Anotar " Fecha:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Anotar " Usuario: $env:USERNAME"
Anotar "==============================================="
Anotar ""

# ── 1. Direcciones de red de este equipo ─────────────────────────────────────
Anotar "--- DIRECCIONES DE ESTE EQUIPO ---"
try {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' } |
    ForEach-Object { Anotar ("  {0}  ({1})" -f $_.IPAddress, $_.InterfaceAlias) }
} catch { Anotar "  no se pudieron leer: $($_.Exception.Message)" }
Anotar ""

# ── 2. Configuración instalada ───────────────────────────────────────────────
Anotar "--- CONFIGURACION ---"
Anotar "Carpeta de datos: $carpeta"
$rutaConfig = Join-Path $carpeta 'config.json'
if (Test-Path $rutaConfig) {
  try {
    $crudo = Get-Content $rutaConfig -Raw -Encoding UTF8
    # La marca invisible al principio del archivo ya rompió una instalación antes.
    $bytes = [System.IO.File]::ReadAllBytes($rutaConfig)
    $tieneMarca = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    Anotar ("  marca invisible al inicio (BOM): {0}" -f $(if ($tieneMarca) { 'SI — HAY QUE ARREGLARLO' } else { 'no' }))
    $cfg = $crudo | ConvertFrom-Json
    Anotar "  restaurant_id:   $($cfg.restaurant_id)"
    Anotar "  terminal_id:     $($cfg.terminal_id)"
    Anotar "  terminal_name:   $($cfg.terminal_name)"
    Anotar "  terminal_role:   $($cfg.terminal_role)      <-- server_pos = Caja, pos = secundaria, kds = cocina"
    Anotar "  kds_only:        $($cfg.kds_only)"
    Anotar "  local_server_port: $($cfg.local_server_port)"
    Anotar "  pos_server_ip:   $($cfg.pos_server_ip)      <-- a quien le pregunta (vacio = es la Caja)"
    Anotar "  pos_server_port: $($cfg.pos_server_port)"
    Anotar "  config_version:  $($cfg.config_version)"
    Anotar "  localAuthorityEnabled: $($cfg.localAuthorityEnabled)"
    $sec = $cfg.lan_secret
    if ([string]::IsNullOrWhiteSpace($sec)) {
      Anotar "  lan_secret:      NO TIENE"
    } else {
      Anotar ("  lan_secret:      si, {0} caracteres (no se copia aqui a proposito)" -f $sec.Length)
    }
    Anotar "  impresoras configuradas: $(@($cfg.printers).Count)"
  } catch {
    Anotar "  NO SE PUDO LEER: $($_.Exception.Message)"
    Anotar "  (esto ya seria un hallazgo: el archivo esta corrupto)"
  }
} else {
  Anotar "  NO EXISTE config.json — esta terminal no esta configurada"
}
Anotar ""

# ── 3. Secreto propio de la red local ────────────────────────────────────────
$rutaSecreto = Join-Path $carpeta 'lan-secret'
if (Test-Path $rutaSecreto) {
  $largo = (Get-Content $rutaSecreto -Raw).Trim().Length
  Anotar "--- SECRETO PROPIO ---"
  Anotar "  existe archivo lan-secret, $largo caracteres (solo lo genera la Caja)"
} else {
  Anotar "--- SECRETO PROPIO ---"
  Anotar "  no hay archivo lan-secret propio (normal en una terminal secundaria)"
}
Anotar ""

# ── 4. Version instalada ─────────────────────────────────────────────────────
Anotar "--- VERSION INSTALADA ---"
$encontrado = $false
foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if (-not $base) { continue }
  Get-ChildItem -Path $base -Filter '*.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*Fullsite*' } |
    ForEach-Object {
      $encontrado = $true
      Anotar ("  {0}" -f $_.FullName)
      Anotar ("     version: {0}   modificado: {1}" -f $_.VersionInfo.ProductVersion, $_.LastWriteTime)
    }
}
if (-not $encontrado) { Anotar "  no se encontro el programa instalado en las rutas habituales" }
Anotar ""

# ── 5. Que dice el servidor local ────────────────────────────────────────────
Anotar "--- SERVIDOR LOCAL (Pedro) ---"
$puerto = 7717
try { if ($cfg -and $cfg.local_server_port) { $puerto = $cfg.local_server_port } } catch {}
try {
  $salud = Invoke-RestMethod -Uri "http://127.0.0.1:$puerto/health" -TimeoutSec 5
  Anotar "  responde en el puerto $puerto"
  Anotar "  version:            $($salud.version)"
  Anotar "  restaurant_id:      $($salud.restaurant_id)"
  Anotar "  encendido hace:     $($salud.uptime_s) segundos"
  Anotar "  direccion en la red: $($salud.lan_ip)"
  Anotar "  terminales conectadas: $($salud.clients_connected)"
  Anotar "  ultimo evento:      $($salud.last_sequence)"
  Anotar "  pendientes de subir: $($salud.sync_queue_size)"
  Anotar "  impresiones fallidas: $($salud.print_jobs_failed)"
  Anotar "  estaciones:         $($salud.stations -join ', ')"
  # Estos dos campos sólo existen en la version nueva; si vienen vacios es la vieja.
  Anotar "  emparejada:         $($salud.emparejada)"
  if ($salud.enlace) {
    Anotar "  enlace con la Caja: conectado=$($salud.enlace.conectado) motivo=$($salud.enlace.ultimo_motivo)"
  } else {
    Anotar "  enlace con la Caja: (sin dato: es la Caja, o es la version anterior)"
  }
} catch {
  Anotar "  NO RESPONDE en el puerto $puerto"
  Anotar "  $($_.Exception.Message)"
}
Anotar ""

# ── 6. Tamaño del registro de eventos ────────────────────────────────────────
Anotar "--- REGISTRO DE EVENTOS ---"
$posibles = @('events.ndjson','event-log.ndjson','events.log')
$hallado = $false
foreach ($n in $posibles) {
  $ruta = Join-Path $carpeta $n
  if (Test-Path $ruta) {
    $hallado = $true
    $f = Get-Item $ruta
    $lineas = (Get-Content $ruta -ReadCount 0 | Measure-Object -Line).Lines
    Anotar ("  {0}: {1:N0} KB, {2:N0} lineas, modificado {3}" -f $f.Name, ($f.Length/1KB), $lineas, $f.LastWriteTime)
  }
}
if (-not $hallado) {
  Anotar "  no se encontro con los nombres habituales. Contenido de la carpeta:"
  Get-ChildItem $carpeta -ErrorAction SilentlyContinue |
    ForEach-Object { Anotar ("    {0}  ({1:N0} KB)" -f $_.Name, ($_.Length/1KB)) }
}
Anotar ""

# ── 7. Servicio del lector de huella ─────────────────────────────────────────
Anotar "--- LECTOR DE HUELLA ---"
try {
  $fp = Invoke-RestMethod -Uri "http://127.0.0.1:7718/health" -TimeoutSec 3
  Anotar "  el servicio responde: ok=$($fp.ok)"
  try {
    $lista = Invoke-RestMethod -Uri "http://127.0.0.1:7718/list" -TimeoutSec 3
    Anotar "  huellas registradas en esta terminal: $($lista.count)"
  } catch { Anotar "  no se pudo leer la lista: $($_.Exception.Message)" }
} catch {
  Anotar "  el servicio NO responde en el puerto 7718"
  Anotar "  $($_.Exception.Message)"
}
Anotar ""

Anotar "==============================================="
Anotar " Fin. Manda este archivo completo."
Anotar "==============================================="

$r -join "`r`n" | Out-File -FilePath $salida -Encoding UTF8
Write-Host ""
Write-Host "Listo. El reporte quedo en:" -ForegroundColor Green
Write-Host "  $salida" -ForegroundColor Green
Write-Host ""
Write-Host "Abrelo y mandalo. No trae el secreto ni datos de clientes."
Write-Host ""
$r -join "`r`n" | Write-Host

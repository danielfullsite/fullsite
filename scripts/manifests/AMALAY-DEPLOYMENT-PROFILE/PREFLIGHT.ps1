#Requires -Version 5.1
<#
  PREFLIGHT.ps1 — AMALAY one-command field preflight (5-10 min objetivo)
  Autodetección con evidencia. Read-only salvo el snapshot de rollback (opcional).
  Uso: powershell -NoProfile -ExecutionPolicy Bypass -File .\PREFLIGHT.ps1 [-TakeBackup]
#>
param([switch]$TakeBackup)
$ErrorActionPreference = 'Continue'
$out = @{}

# --- Deployment type (Branch A: NSIS / Branch B: legacy) ---
$nsis = $null
foreach ($b in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
                 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
  foreach ($k in @(Get-ChildItem $b -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if ($p -and $p.DisplayName -like 'Fullsite*') { $nsis = $p; break } }
  if ($nsis) { break } }
$legacy = Test-Path 'C:\fullsite'
$out.DEPLOY = if ($nsis -and $legacy) { 'MIXED' } elseif ($nsis) { 'NSIS' } elseif ($legacy) { 'LEGACY' } else { 'UNKNOWN' }

# --- Executable / versión (proceso vivo primero, luego registro) ---
$proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'Fullsite|electron' } | Select-Object -First 1
$out.EXE = if ($proc) { $proc.ExecutablePath } elseif ($nsis) { Join-Path $nsis.InstallLocation 'Fullsite POS.exe' } else { 'NO PROCESS / NO NSIS ENTRY' }
$out.VER = if ($nsis) { $nsis.DisplayVersion } else { 'UNKNOWN (legacy sin registro — comparar SHA del exe vs known-good 2932000)' }

# --- Data path ---
$ud = Join-Path $env:APPDATA 'Fullsite POS'
$out.DATA = (@( @{p=$ud;t='userData'}, @{p='C:\fullsite';t='legacy'} ) |
  Where-Object { Test-Path $_.p } | ForEach-Object { "$($_.t)=$($_.p)" }) -join ' ; '
if (-not $out.DATA) { $out.DATA = 'NINGUNO (instalación limpia)' }

# --- Bridge 7717 / Fingerprint 7718 ---
function PortOwner($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return 'NOT BOUND' }
  $pp = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  "$($pp.Name) PID $($c.OwningProcess)"
}
$out.BRIDGE = PortOwner 7717
try { $h = Invoke-RestMethod 'http://127.0.0.1:7717/health' -TimeoutSec 4
      $out.BRIDGE += " | health OK v$($h.version) tenant=$($h.restaurant_id) lan_ip=$($h.lan_ip)" } catch { $out.BRIDGE += ' | health NO RESPONDE' }
$out.FP = PortOwner 7718

# --- printers.json (v1 legacy y v2 userData) ---
$pj = @()
foreach ($cand in @('C:\fullsite\printers.json', (Join-Path $ud 'printers.json'))) {
  if (Test-Path $cand) {
    $hash = (Get-FileHash $cand -Algorithm SHA256).Hash.Substring(0,12)
    $pj += "$cand sha:$hash" } }
$out.PRINTERS = if ($pj) { $pj -join ' ; ' } else { 'NO ENCONTRADO' }

# --- KDS type ---
$cfg = Join-Path $ud 'config.json'
$out.KDS = 'N/A (no config)'
if (Test-Path $cfg) {
  try { $c = Get-Content $cfg -Raw | ConvertFrom-Json
        $out.KDS = "role=$($c.terminal_role) kds_only=$($c.kds_only) client_id=$($c.client_id)"
        if ($c.client_id -cne ($c.client_id.ToLower())) { $out.KDS += ' [WARN: client_id NO minúsculas]' } } catch { $out.KDS = 'config.json ilegible' } }

# --- Rollback snapshot ---
$bk = Get-ChildItem (Join-Path $PSScriptRoot '..\..\03-RELEASE-1.3.3\backups') -Directory -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $bk) { $bk = Get-ChildItem 'C:\Fullsite-Field\03-RELEASE-1.3.3\backups' -Directory -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime | Select-Object -Last 1 }
if ($TakeBackup -and -not $bk) {
  $script = 'C:\Fullsite-Field\03-RELEASE-1.3.3\PRE-INSTALL-BACKUP.ps1'
  if (Test-Path $script) { & powershell -NoProfile -ExecutionPolicy Bypass -File $script | Out-Null
    $bk = Get-ChildItem 'C:\Fullsite-Field\03-RELEASE-1.3.3\backups' -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1 } }
$out.ROLLBACK = if ($bk) { $bk.FullName } else { 'SIN SNAPSHOT (correr PRE-INSTALL-BACKUP.ps1 antes de instalar)' }

# --- Turno abierto (NG-7) ---
$turno = 'DESCONOCIDO'
try { $s = Invoke-RestMethod 'http://127.0.0.1:7717/state' -TimeoutSec 4
      $turno = if ($s.turno -and $s.turno.status -eq 'open') { 'ABIERTO — NO INSTALAR' } else { 'CERRADO' } } catch {}

# --- start-bridge.bat prohibido (root cause Jul-12) ---
$badBat = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter '*bridge*' -ErrorAction SilentlyContinue).Count -gt 0

# --- Veredicto ---
$safe = ($out.DEPLOY -ne 'UNKNOWN' -or -not $proc) -and ($turno -ne 'ABIERTO — NO INSTALAR') -and (-not $badBat) -and ($bk -ne $null)
$verdict = if ($safe) { 'YES' } else { 'NO' }
$reasons = @()
if ($turno -like 'ABIERTO*') { $reasons += 'turno abierto' }
if ($badBat) { $reasons += 'start-bridge.bat presente en Startup (eliminar primero)' }
if (-not $bk) { $reasons += 'sin snapshot de rollback' }
if ($out.DEPLOY -eq 'UNKNOWN' -and $proc) { $reasons += 'proceso vivo con deployment no identificado' }

$bar = '=' * 60
Write-Host $bar
Write-Host "DEPLOYMENT TYPE:    $($out.DEPLOY)"
Write-Host "CURRENT EXECUTABLE: $($out.EXE)"
Write-Host "CURRENT VERSION:    $($out.VER)"
Write-Host "LOCAL DATA PATH:    $($out.DATA)"
Write-Host "BRIDGE:             $($out.BRIDGE)"
Write-Host "FINGERPRINT:        $($out.FP)"
Write-Host "PRINTER CONFIG:     $($out.PRINTERS)"
Write-Host "KDS TYPE:           $($out.KDS)"
Write-Host "ROLLBACK SNAPSHOT:  $($out.ROLLBACK)"
Write-Host "TURNO:              $turno"
Write-Host "INSTALLATION SAFE:  $verdict $(if ($reasons) { '(' + ($reasons -join '; ') + ')' })"
Write-Host $bar
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path $PSScriptRoot "PREFLIGHT-$($env:COMPUTERNAME)-$stamp.txt"
$out.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" } | Set-Content $report -Encoding UTF8
Add-Content $report "TURNO: $turno"
Add-Content $report "INSTALLATION SAFE: $verdict $($reasons -join '; ')"
Write-Host "Reporte: $report"
if ($verdict -eq 'YES') { exit 0 } else { exit 1 }

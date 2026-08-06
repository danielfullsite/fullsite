#Requires -Version 5.1
<#
.SYNOPSIS
    ROLLBACK.ps1 — Restore a machine to its pre-install state from a
    PRE-INSTALL-BACKUP.ps1 backup folder.

.DESCRIPTION
    Closes gap #7 (PARTIAL) of INSTALLER-VERIFICATION.md. Sequence:
      1. Validate the backup folder (BACKUP-INFO.txt, MANIFEST.csv, SOURCES.csv,
         files\ or backup.zip).
      2. CONFIRMATION PROMPT (destructive — skipped only with -Force).
      3. Stop Fullsite processes (Electron app + fingerprint-service.exe).
      4. Silently uninstall the NSIS app ("Fullsite POS", registry-discovered,
         QuietUninstallString or UninstallString + /S). Uninstall preserves
         %APPDATA% (nsis.deleteAppDataOnUninstall not set → default false).
      5. Restore backed-up directories (C:\fullsite, %APPDATA%\Fullsite POS/KDS,
         %LOCALAPPDATA% variants) with robocopy /MIR — the destination becomes
         EXACTLY the backup (files created after the backup are deleted).
      6. Optionally reinstall a previous installer exe (-PreviousInstaller) with
         /S and launch it once (autostart re-registration, main.js:822-825).
      7. Verify restored files against MANIFEST.csv SHA-256 hashes.

    Requires Administrator (perMachine uninstaller + C:\fullsite restore).

.PARAMETER BackupDir
    Path to the backup folder created by PRE-INSTALL-BACKUP.ps1
    (e.g. .\backups\SERVER1-20260806-091500).

.PARAMETER PreviousInstaller
    Optional path to a previous known-good "Fullsite POS Setup X.Y.Z.exe" to
    reinstall after the restore.

.PARAMETER Force
    Skip the confirmation prompt (unattended rollback).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ROLLBACK.ps1 -BackupDir ".\backups\SERVER1-20260806-091500"
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ROLLBACK.ps1 -BackupDir ".\backups\PDV3-20260806-091500" -PreviousInstaller "D:\usb\Fullsite POS Setup 1.3.2.exe"
#>
param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [string]$PreviousInstaller = '',
    [switch]$Force
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'
$WarningPreference     = 'SilentlyContinue'

function Write-Section { param([string]$Title)
    $bar = '-' * 60
    Write-Host "`n$bar`n  $Title`n$bar"
}

# ── Admin check ───────────────────────────────────────────────────────────────
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host '[ERROR] Administrator privileges required (uninstaller + C:\fullsite restore).'
    exit 1
}

# =============================================================================
# 1. VALIDATE BACKUP FOLDER
# =============================================================================
Write-Section '1. Validating backup'

$BackupDir = (Resolve-Path $BackupDir -ErrorAction SilentlyContinue).Path
if (-not $BackupDir -or -not (Test-Path $BackupDir)) {
    Write-Host "[ERROR] Backup folder not found: $BackupDir"
    exit 1
}
$manifestPath = Join-Path $BackupDir 'MANIFEST.csv'
$sourcesPath  = Join-Path $BackupDir 'SOURCES.csv'
$filesDir     = Join-Path $BackupDir 'files'
$zipPath      = Join-Path $BackupDir 'backup.zip'

foreach ($req in @($manifestPath, $sourcesPath)) {
    if (-not (Test-Path $req)) { Write-Host "[ERROR] Missing $req — not a valid backup folder."; exit 1 }
}

$restoreRoot = $null
if (Test-Path $filesDir) {
    $restoreRoot = $filesDir
    Write-Host "Restore source: staged files\ folder"
} elseif (Test-Path $zipPath) {
    Write-Host "Staged files\ absent — extracting backup.zip..."
    $restoreRoot = Join-Path $BackupDir "restore-extract-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $restoreRoot)
        Write-Host "Extracted to $restoreRoot"
    } catch {
        Write-Host "[ERROR] Could not extract backup.zip: $($_.Exception.Message)"; exit 1
    }
} else {
    Write-Host '[ERROR] Neither files\ nor backup.zip present — nothing to restore.'; exit 1
}

$sources  = @(Import-Csv $sourcesPath | Where-Object { $_.Existed -eq 'True' })
$manifest = @(Import-Csv $manifestPath)
Write-Host "Backup contains $($sources.Count) source dir(s), $($manifest.Count) manifest entries."
Get-Content (Join-Path $BackupDir 'BACKUP-INFO.txt') -ErrorAction SilentlyContinue | Write-Host

# =============================================================================
# 2. CONFIRMATION (destructive)
# =============================================================================
if (-not $Force) {
    Write-Host ''
    Write-Host 'ESTE ROLLBACK VA A:' -ForegroundColor Yellow
    Write-Host '  - Cerrar la app Fullsite POS y el servicio de huella'
    Write-Host '  - Desinstalar la version NSIS instalada'
    foreach ($s in $sources) { Write-Host "  - Restaurar (SOBREESCRIBIR/BORRAR extras) : $($s.OriginalPath)" }
    Write-Host '  Los datos creados DESPUES del respaldo se PERDERAN en esas carpetas.'
    $answer = Read-Host 'Escribe SI (mayusculas) para continuar'
    if ($answer -cne 'SI') { Write-Host 'Cancelado.'; exit 1 }
}

# =============================================================================
# 3. STOP FULLSITE PROCESSES
# =============================================================================
Write-Section '3. Stopping Fullsite processes'

$targets = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name           -like '*ullsite*' -or
        $_.ExecutablePath -like '*ullsite*' -or
        $_.Name           -eq   'fingerprint-service.exe'
    }
foreach ($t in @($targets)) {
    Write-Host "Stopping pid $($t.ProcessId) $($t.Name)"
    try { Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop } catch { Write-Host "  [WARN] $($_.Exception.Message)" }
}
Start-Sleep -Seconds 3

# =============================================================================
# 4. NSIS SILENT UNINSTALL (registry-discovered)
#    productName "Fullsite POS" (electron-app/package.json), perMachine → HKLM.
# =============================================================================
Write-Section '4. Uninstalling NSIS app'

$uninstallBases = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
$entry = $null
foreach ($base in $uninstallBases) {
    foreach ($k in @(Get-ChildItem $base -ErrorAction SilentlyContinue)) {
        $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        if ($p -and $p.DisplayName -like 'Fullsite POS*') { $entry = $p; break }
    }
    if ($entry) { break }
}

if (-not $entry) {
    Write-Host '[WARN] No "Fullsite POS" uninstall entry found — nothing to uninstall (LEGACY-only machine?). Continuing to restore.'
} else {
    $cmdStr = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
    Write-Host "Uninstall entry: $($entry.DisplayName) v$($entry.DisplayVersion)"
    Write-Host "Command        : $cmdStr"
    # Parse "quoted exe" + args
    $exe = $null; $unArgs = ''
    if ($cmdStr -match '^"([^"]+)"\s*(.*)$') { $exe = $Matches[1]; $unArgs = $Matches[2] }
    else { $parts = $cmdStr -split '\s+', 2; $exe = $parts[0]; if ($parts.Count -gt 1) { $unArgs = $parts[1] } }

    if ($exe -and (Test-Path $exe)) {
        if ($unArgs -notmatch '/S\b') { $unArgs = "$unArgs /S".Trim() }
        # NSIS uninstallers self-copy to %TEMP% and return immediately; the
        # _?=<installdir> switch makes them run in place and synchronously.
        if ($entry.InstallLocation -and (Test-Path $entry.InstallLocation)) {
            $unArgs = "$unArgs _?=$($entry.InstallLocation)"
        }
        Write-Host "Running: `"$exe`" $unArgs"
        $proc = Start-Process -FilePath $exe -ArgumentList $unArgs -Wait -PassThru
        Write-Host "Uninstaller exit code: $($proc.ExitCode)"
        Start-Sleep -Seconds 3
        # Leftover in-place uninstaller exe/dir may remain due to _?= — harmless.
    } else {
        Write-Host "[WARN] Uninstaller exe not found on disk: $exe — continuing to restore."
    }
}

# =============================================================================
# 5. RESTORE DIRECTORIES FROM BACKUP (robocopy /MIR = exact mirror of backup)
# =============================================================================
Write-Section '5. Restoring directories'

$restoreProblems = 0
foreach ($s in $sources) {
    $src = Join-Path $restoreRoot $s.Label
    if (-not (Test-Path $src)) {
        Write-Host "[WARN] Backup has no staged copy for $($s.Label) — skipping $($s.OriginalPath)"
        continue
    }
    Write-Host "Restoring $($s.OriginalPath)  <=  $src"
    & robocopy $src $s.OriginalPath /MIR /R:1 /W:1 /COPY:DAT /DCOPY:T /NP /NFL /NDL `
        "/LOG+:$BackupDir\rollback-robocopy.log" | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Host "  [ERROR] robocopy exit $LASTEXITCODE — see rollback-robocopy.log"
        $restoreProblems++
    }
}

# =============================================================================
# 6. OPTIONAL: REINSTALL PREVIOUS VERSION + FIRST LAUNCH
# =============================================================================
if ($PreviousInstaller) {
    Write-Section '6. Reinstalling previous version'
    if (Test-Path $PreviousInstaller) {
        Write-Host "Running: `"$PreviousInstaller`" /S"
        $proc = Start-Process -FilePath $PreviousInstaller -ArgumentList '/S' -Wait -PassThru
        Write-Host "Installer exit code: $($proc.ExitCode)"
        # First launch registers autostart (main.js:822-825 setLoginItemSettings)
        $appExe = 'C:\Program Files\Fullsite POS\Fullsite POS.exe'
        if (Test-Path $appExe) {
            Write-Host "Launching once for autostart registration: $appExe"
            Start-Process -FilePath $appExe | Out-Null
        } else {
            Write-Host "[WARN] Installed exe not found at $appExe — launch manually once."
        }
    } else {
        Write-Host "[ERROR] Previous installer not found: $PreviousInstaller"
        $restoreProblems++
    }
}

# =============================================================================
# 7. VERIFY RESTORED FILES vs MANIFEST HASHES
# =============================================================================
Write-Section '7. Verifying restore against MANIFEST.csv'

$checked = 0; $ok = 0; $mismatch = 0; $missing = 0
$problems = [System.Collections.Generic.List[string]]::new()
foreach ($row in $manifest) {
    if ($row.SHA256 -eq 'SKIPPED-BIOMETRIC' -or -not $row.SHA256) { continue }
    $checked++
    if (-not (Test-Path $row.OriginalPath)) {
        $missing++; $problems.Add("MISSING  $($row.OriginalPath)"); continue
    }
    $h = ''
    try { $h = (Get-FileHash $row.OriginalPath -Algorithm SHA256).Hash.ToLower() } catch {}
    if ($h -eq $row.SHA256) { $ok++ }
    else { $mismatch++; $problems.Add("MISMATCH $($row.OriginalPath)") }
}
$problems | Out-File "$BackupDir\rollback-verification.txt" -Encoding UTF8
foreach ($p in $problems | Select-Object -First 30) { Write-Host "  $p" }

$verdict = if (($mismatch + $missing) -eq 0 -and $restoreProblems -eq 0) { 'ROLLBACK VERIFIED' } else { 'ROLLBACK COMPLETED WITH ERRORS' }
$bar = '=' * 60
Write-Host ''
Write-Host $bar
Write-Host "Files checked  : $checked"
Write-Host "Hash OK        : $ok"
Write-Host "Mismatched     : $mismatch"
Write-Host "Missing        : $missing"
Write-Host "Copy errors    : $restoreProblems"
Write-Host "RESULT         : $verdict"
Write-Host "Details        : $BackupDir\rollback-verification.txt"
Write-Host $bar
Write-Host 'Siguiente: reiniciar la maquina y correr RUN-CERT-CAPTURE.cmd rollback'

exit $(if ($verdict -eq 'ROLLBACK VERIFIED') { 0 } else { 1 })

#Requires -Version 5.1
<#
.SYNOPSIS
    PRE-INSTALL-BACKUP.ps1 — Restorable, timestamped backup before installing/upgrading Fullsite POS.

.DESCRIPTION
    Closes gap #2 (FAIL) of INSTALLER-VERIFICATION.md: the diagnostic only hashes
    files; this script COPIES them so ROLLBACK.ps1 can restore.

    Backs up (whichever exist):
      - C:\fullsite                       (legacy deployment + fingerprint exe/DLL)
      - %APPDATA%\Fullsite POS            (Electron userData: config.json, printers.json,
                                           events.ndjson, print-queue.json, logs, IndexedDB)
      - %APPDATA%\Fullsite KDS            (dedicated KDS build userData)
      - %LOCALAPPDATA%\Fullsite POS / KDS (installer caches, if present)

    Produces in .\backups\<machine>-<timestamp>\ :
      files\<label>\...        staged copy (robocopy, tolerant of locked files)
      backup.zip               ZIP of files\ — integrity-verified after creation
      MANIFEST.csv             every file: original path, size, SHA-256
      SOURCES.csv              label → original directory mapping (used by ROLLBACK.ps1)
      REGISTRY-UNINSTALL.csv   Fullsite/POS/KDS uninstall entries (HKLM+WOW6432Node+HKCU)
      AUTOSTART.csv            Fullsite Run-key + Startup-folder entries
      robocopy.log             copy details (locked/skipped files visible here)
      BACKUP-INFO.txt          summary + zip SHA-256 + verification result
      transcript.log

    Privacy: biometric template files (.dat .bio .fp .fng .template) are EXCLUDED
    by default (same rule as DIAGNOSTIC-ONLY.ps1) and listed in MANIFEST.csv as
    SKIPPED-BIOMETRIC. Pass -IncludeBiometric for a full-fidelity restore backup
    (keep that ZIP off shared USBs).

    Read-only towards the app: never stops processes, never writes outside
    .\backups\. Offline-safe. Exit code 0 = backup verified, 1 = verification failed.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\PRE-INSTALL-BACKUP.ps1
#>
param(
    [switch]$IncludeBiometric
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'
$WarningPreference     = 'SilentlyContinue'

$BIOMETRIC_EXTS = @('*.dat', '*.bio', '*.fp', '*.fng', '*.template')

$ts        = Get-Date -Format 'yyyyMMdd-HHmmss'
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$outDir    = Join-Path $scriptDir "backups\$($env:COMPUTERNAME)-$ts"
$filesDir  = Join-Path $outDir 'files'
New-Item -ItemType Directory -Path $filesDir -Force | Out-Null

Start-Transcript -Path "$outDir\transcript.log" -Append -ErrorAction SilentlyContinue

function Write-Section { param([string]$Title)
    $bar = '-' * 60
    Write-Host "`n$bar`n  $Title`n$bar"
}

# =============================================================================
# 1. STAGE FILE COPIES (robocopy — tolerant of locked files while app runs)
#    Sources grounded in electron-app/main.js (C:\fullsite legacy + userData
#    for productName "Fullsite POS" / dedicated "Fullsite KDS" build).
# =============================================================================
Write-Section '1. Copying source folders'

$sources = @(
    @{ Label = 'C_fullsite';               Path = 'C:\fullsite' },
    @{ Label = 'APPDATA_Fullsite_POS';     Path = "$env:APPDATA\Fullsite POS" },
    @{ Label = 'APPDATA_Fullsite_KDS';     Path = "$env:APPDATA\Fullsite KDS" },
    @{ Label = 'LOCALAPPDATA_Fullsite_POS';Path = "$env:LOCALAPPDATA\Fullsite POS" },
    @{ Label = 'LOCALAPPDATA_Fullsite_KDS';Path = "$env:LOCALAPPDATA\Fullsite KDS" }
)

$sourceRows   = [System.Collections.Generic.List[object]]::new()
$copyProblems = 0

foreach ($s in $sources) {
    if (-not (Test-Path $s.Path -ErrorAction SilentlyContinue)) {
        Write-Host "Absent  : $($s.Path)"
        $sourceRows.Add([PSCustomObject]@{ Label = $s.Label; OriginalPath = $s.Path; Existed = $false })
        continue
    }
    Write-Host "Copying : $($s.Path)"
    $dest = Join-Path $filesDir $s.Label
    $roboArgs = @($s.Path, $dest, '/E', '/R:1', '/W:1', '/COPY:DAT', '/DCOPY:T',
                  '/NP', '/NFL', '/NDL', "/LOG+:$outDir\robocopy.log")
    if (-not $IncludeBiometric) { $roboArgs += '/XF'; $roboArgs += $BIOMETRIC_EXTS }
    & robocopy @roboArgs | Out-Null
    $rc = $LASTEXITCODE
    # robocopy: 0-7 = success (with/without extras); >=8 = failures
    if ($rc -ge 8) {
        Write-Host "  [WARN] robocopy exit $rc for $($s.Path) — see robocopy.log"
        $copyProblems++
    }
    $sourceRows.Add([PSCustomObject]@{ Label = $s.Label; OriginalPath = $s.Path; Existed = $true })
}
$sourceRows | Export-Csv "$outDir\SOURCES.csv" -NoTypeInformation

# =============================================================================
# 2. MANIFEST — original path, size, SHA-256 of every staged file
#    + biometric files listed (not copied) unless -IncludeBiometric
# =============================================================================
Write-Section '2. Manifest (SHA-256)'

$manifest = [System.Collections.Generic.List[object]]::new()
foreach ($s in $sourceRows | Where-Object { $_.Existed }) {
    $stageRoot = Join-Path $filesDir $s.Label
    if (Test-Path $stageRoot -ErrorAction SilentlyContinue) {
        Get-ChildItem $stageRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel  = $_.FullName.Substring($stageRoot.Length).TrimStart('\')
            $hash = ''
            try { $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } catch {}
            $manifest.Add([PSCustomObject]@{
                Label        = $s.Label
                OriginalPath = (Join-Path $s.OriginalPath $rel)
                RelativePath = $rel
                SizeBytes    = $_.Length
                SHA256       = $hash
            })
        }
    }
    if (-not $IncludeBiometric) {
        foreach ($pat in $BIOMETRIC_EXTS) {
            Get-ChildItem $s.OriginalPath -Recurse -File -Filter $pat -ErrorAction SilentlyContinue | ForEach-Object {
                $manifest.Add([PSCustomObject]@{
                    Label        = $s.Label
                    OriginalPath = $_.FullName
                    RelativePath = $_.FullName.Substring($s.OriginalPath.Length).TrimStart('\')
                    SizeBytes    = $_.Length
                    SHA256       = 'SKIPPED-BIOMETRIC'
                })
            }
        }
    }
}
$manifest | Export-Csv "$outDir\MANIFEST.csv" -NoTypeInformation
$copied  = @($manifest | Where-Object { $_.SHA256 -ne 'SKIPPED-BIOMETRIC' })
$skipped = @($manifest | Where-Object { $_.SHA256 -eq 'SKIPPED-BIOMETRIC' })
Write-Host "Files copied: $($copied.Count)   Biometric skipped: $($skipped.Count)"

# =============================================================================
# 3. REGISTRY UNINSTALL ENTRIES + AUTOSTART (needed by ROLLBACK.ps1)
#    Same sweep pattern as DIAGNOSTIC-ONLY.ps1. NSIS entry expected for
#    productName "Fullsite POS" (electron-app/package.json, perMachine).
# =============================================================================
Write-Section '3. Registry uninstall + autostart entries'

$uninstallBases = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)
$uninstallEntries = foreach ($base in $uninstallBases) {
    if (-not (Test-Path $base -ErrorAction SilentlyContinue)) { continue }
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $p  = Get-ItemProperty $_.PSPath -ErrorAction Stop
            $dn = [string]$p.DisplayName
            if ($dn -like '*ullsite*' -or $dn -like '*POS*' -or $dn -like '*KDS*') {
                [PSCustomObject]@{
                    Hive                 = $base
                    KeyName              = $_.PSChildName
                    DisplayName          = $dn
                    DisplayVersion       = $p.DisplayVersion
                    InstallLocation      = $p.InstallLocation
                    UninstallString      = $p.UninstallString
                    QuietUninstallString = $p.QuietUninstallString
                }
            }
        } catch {}
    }
}
$uninstallEntries | Export-Csv "$outDir\REGISTRY-UNINSTALL.csv" -NoTypeInformation
@($uninstallEntries) | Format-Table DisplayName, DisplayVersion, InstallLocation -AutoSize

$runKeyPaths = @(
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
)
$autoRows = [System.Collections.Generic.List[object]]::new()
foreach ($keyPath in $runKeyPaths) {
    if (-not (Test-Path $keyPath -ErrorAction SilentlyContinue)) { continue }
    try {
        (Get-ItemProperty $keyPath -ErrorAction Stop).PSObject.Properties |
            Where-Object { $_.Name -notlike 'PS*' -and ($_.Name -like '*ullsite*' -or $_.Value -like '*ullsite*') } |
            ForEach-Object {
                $autoRows.Add([PSCustomObject]@{ Type = 'RunKey'; Location = $keyPath; Name = $_.Name; Value = $_.Value })
            }
    } catch {}
}
$wshell = $null
try { $wshell = New-Object -ComObject WScript.Shell -ErrorAction Stop } catch {}
foreach ($sf in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
                  'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp')) {
    if (-not (Test-Path $sf -ErrorAction SilentlyContinue)) { continue }
    Get-ChildItem $sf -ErrorAction SilentlyContinue | ForEach-Object {
        $target = ''
        if ($_.Extension -ieq '.lnk' -and $wshell) {
            try { $target = $wshell.CreateShortcut($_.FullName).TargetPath } catch {}
        }
        if ($_.Name -like '*ullsite*' -or $target -like '*ullsite*') {
            $autoRows.Add([PSCustomObject]@{ Type = 'StartupFolder'; Location = $sf; Name = $_.Name; Value = $target })
        }
    }
}
$autoRows | Export-Csv "$outDir\AUTOSTART.csv" -NoTypeInformation
Write-Host "Autostart entries captured: $($autoRows.Count)"

# =============================================================================
# 4. ZIP + INTEGRITY VERIFICATION
# =============================================================================
Write-Section '4. ZIP + verification'

$zipPath = Join-Path $outDir 'backup.zip'
$zipOk   = $false
$zipHash = ''
$stagedCount = @(Get-ChildItem $filesDir -Recurse -File -ErrorAction SilentlyContinue).Count

if ($stagedCount -eq 0) {
    Write-Host '[WARN] Nothing staged — no source folders existed on this machine.'
} else {
    try {
        Compress-Archive -Path "$filesDir\*" -DestinationPath $zipPath -CompressionLevel Optimal -Force
    } catch {
        Write-Host "[ERROR] Compress-Archive failed: $($_.Exception.Message)"
    }
    if (Test-Path $zipPath -ErrorAction SilentlyContinue) {
        # Integrity: open the archive, enumerate every entry, compare file count
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
            $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
            $entryCount = @($zip.Entries | Where-Object { $_.Name }).Count   # skip pure directory entries
            $zip.Dispose()
            if ($entryCount -eq $stagedCount) {
                $zipOk = $true
                Write-Host "ZIP verified: $entryCount entries == $stagedCount staged files"
            } else {
                Write-Host "[ERROR] ZIP entry count $entryCount != staged $stagedCount"
            }
        } catch {
            Write-Host "[ERROR] ZIP verification failed: $($_.Exception.Message)"
        }
        try { $zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower() } catch {}
    }
}

# =============================================================================
# 5. BACKUP-INFO.txt + result
# =============================================================================
$overall = if (($stagedCount -gt 0 -and $zipOk) -or $stagedCount -eq 0) {
    if ($stagedCount -eq 0) { 'EMPTY (no sources present)' }
    elseif ($copyProblems -gt 0) { 'VERIFIED-WITH-COPY-WARNINGS' }
    else { 'VERIFIED' }
} else { 'FAILED' }

@"
FULLSITE PRE-INSTALL BACKUP
===========================
Machine        : $env:COMPUTERNAME
Timestamp      : $((Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'))
Backup folder  : $outDir
Files copied   : $($copied.Count)
Biometric skip : $($skipped.Count) $(if ($IncludeBiometric) { '(included by -IncludeBiometric)' } else { '(excluded — privacy rule)' })
Robocopy warns : $copyProblems (see robocopy.log)
ZIP            : $zipPath
ZIP SHA-256    : $zipHash
ZIP verified   : $zipOk
RESULT         : $overall

Restore with:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\ROLLBACK.ps1 -BackupDir "$outDir"
"@ | Out-File "$outDir\BACKUP-INFO.txt" -Encoding UTF8
Get-Content "$outDir\BACKUP-INFO.txt" | Write-Host

Stop-Transcript -ErrorAction SilentlyContinue

if ($overall -eq 'FAILED') { exit 1 } else { exit 0 }

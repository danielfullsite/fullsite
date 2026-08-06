#Requires -Version 5.1
<#
.SYNOPSIS
    CERT-CAPTURE.ps1 — Read-only certification evidence capture for PDV3 / SERVER1.

.DESCRIPTION
    100% read-only against the Fullsite POS / Bridge (Local Server).
    Only GET requests are issued (never /print, /test, /drawer, POST /events,
    POST /config). Never writes outside its own .\evidence\ folder.
    Works fully offline (all targets are localhost / LAN).
    Idempotent: every run creates a fresh timestamped folder; app state is
    never mutated.

    What it captures (grounded in electron-app/local-server sources):
      - ISO timestamps (local + UTC)
      - Listening ports filtered to 7717 (Bridge HTTP+WS) and 7718 (fingerprint)
      - Running Fullsite / Electron / fingerprint processes
      - GET /health, /state, /identity, /events?since=0  (port 7717)
      - Event store snapshot: events.ndjson + processed-commands.ndjson
      - Order events (ORDER_*) and KDS events (KDS_ITEM_STATUS) extracted
      - Print queue state (print-queue.json) with per-status counts
      - Local persistence files: path, size, LastWriteTime, SHA-256
      - Terminal config summary (config.json) with secrets ***REDACTED***
      - Sync status (sync_queue_size, synced:false count, last_supabase_sync)
      - Duplicate detection: repeated event ids / sequences / command keys
      - ERROR lines from rotating logs (server.log, server.1..5.log)
      - SUMMARY.txt with PASS / WARN / FAIL heuristics per capture

.PARAMETER Label
    Step label for this capture (e.g. "paso07-orden"). Included in the
    evidence folder name and SUMMARY.txt so evidence maps 1:1 to runbook steps.

.PARAMETER BridgeHost
    Host of the Bridge to query. Default 127.0.0.1 (every provisioned terminal
    runs its own Local Server on 7717). Pass the SERVER1 LAN IP when capturing
    remote-Bridge evidence from PDV3.

.PARAMETER RemoteBridge
    Optional second host (e.g. SERVER1 IP when running on PDV3). Captures
    additional 90-remote-health.json / 91-remote-state.json without changing
    the primary local capture.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso07-orden
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\CERT-CAPTURE.ps1 -Label paso23-multiterminal -RemoteBridge 192.168.1.71
#>
param(
    [string]$Label        = 'manual',
    [string]$BridgeHost   = '127.0.0.1',
    [string]$RemoteBridge = ''
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'
$WarningPreference     = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

$BRIDGE_PORT      = 7717   # Local Server HTTP + WS (/ws) — local-server/index.js
$FINGERPRINT_PORT = 7718   # fingerprint-service.exe — electron-app/main.js

# ── Output folder: .\evidence\<machine>-<timestamp>-<label>\ ──────────────────
$safeLabel = ($Label -replace '[^\w\-\.]', '_')
$ts        = Get-Date -Format 'yyyyMMdd-HHmmss'
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$outDir    = Join-Path $scriptDir "evidence\$($env:COMPUTERNAME)-$ts-$safeLabel"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Start-Transcript -Path "$outDir\transcript.log" -Append -ErrorAction SilentlyContinue

function Write-Section { param([string]$Title)
    $bar = '-' * 60
    Write-Host "`n$bar`n  $Title`n$bar"
}

# PASS/WARN/FAIL registry for SUMMARY.txt
$summary = [System.Collections.Generic.List[object]]::new()
function Add-Check { param([string]$Name, [string]$Result, [string]$Detail)
    $summary.Add([PSCustomObject]@{ Check = $Name; Result = $Result; Detail = $Detail })
    Write-Host ("[{0}] {1} — {2}" -f $Result, $Name, $Detail)
}

# GET helper — read-only, offline-safe, short timeout
function Get-BridgeRaw { param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
        return $r.Content
    } catch { return $null }
}

# =============================================================================
# 0. METADATA — ISO timestamps, machine, label
# =============================================================================
Write-Section '0. Metadata'
$now = Get-Date
@"
Label            : $Label
ComputerName     : $env:COMPUTERNAME
UserName         : $env:USERNAME
TimestampLocal   : $($now.ToString('yyyy-MM-ddTHH:mm:sszzz'))
TimestampUTC     : $($now.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
OSVersion        : $([System.Environment]::OSVersion.VersionString)
PSVersion        : $($PSVersionTable.PSVersion)
BridgeHost       : $BridgeHost
RemoteBridge     : $(if ($RemoteBridge) { $RemoteBridge } else { '(none)' })
"@ | Out-File "$outDir\00-metadata.txt" -Encoding UTF8
Get-Content "$outDir\00-metadata.txt" | Write-Host

# =============================================================================
# 1. LISTENING PORTS — filtered to 7717 / 7718 (Bridge + fingerprint)
# =============================================================================
Write-Section "1. Ports $BRIDGE_PORT / $FINGERPRINT_PORT"

$portData = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @($BRIDGE_PORT, $FINGERPRINT_PORT) } |
    ForEach-Object {
        $conn      = $_
        $ownerProc = Get-CimInstance -ClassName Win32_Process `
            -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        [PSCustomObject]@{
            LocalAddress   = $conn.LocalAddress
            LocalPort      = $conn.LocalPort
            OwningProcess  = $conn.OwningProcess
            ProcessName    = if ($ownerProc) { $ownerProc.Name }           else { '' }
            ExecutablePath = if ($ownerProc) { $ownerProc.ExecutablePath } else { '' }
        }
    }
$portData | Export-Csv "$outDir\01-ports.csv" -NoTypeInformation
$portData | Format-Table -AutoSize

# Raw netstat as second source (belt and braces)
try {
    netstat -ano | Select-String ":$BRIDGE_PORT|:$FINGERPRINT_PORT" |
        Out-File "$outDir\01-netstat.txt" -Encoding UTF8
} catch {}

$p7717 = @($portData) | Where-Object { $_.LocalPort -eq $BRIDGE_PORT } | Select-Object -First 1
if ($p7717) { Add-Check 'PORT_7717_LISTENING' 'PASS' "$($p7717.ProcessName) PID $($p7717.OwningProcess) on $($p7717.LocalAddress)" }
else        { Add-Check 'PORT_7717_LISTENING' 'FAIL' 'Bridge port 7717 not bound on this machine' }

$p7718 = @($portData) | Where-Object { $_.LocalPort -eq $FINGERPRINT_PORT } | Select-Object -First 1
if ($p7718) { Add-Check 'PORT_7718_FINGERPRINT' 'PASS' "$($p7718.ProcessName) PID $($p7718.OwningProcess)" }
else        { Add-Check 'PORT_7718_FINGERPRINT' 'WARN' 'Fingerprint service not bound (only needed for huella login)' }

# =============================================================================
# 2. PROCESSES — electron / fullsite / fingerprint
# =============================================================================
Write-Section '2. Processes'

$procs = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name           -like '*ullsite*' -or
        $_.ExecutablePath -like '*ullsite*' -or
        $_.Name           -eq   'fingerprint-service.exe' -or
        ($_.Name -like 'electron*' -and $_.CommandLine -like '*ullsite*')
    } |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine, CreationDate
$procs | Export-Csv "$outDir\02-processes.csv" -NoTypeInformation
$procs | Format-Table ProcessId, Name, ExecutablePath -AutoSize

if (@($procs).Count -gt 0) { Add-Check 'APP_PROCESS_RUNNING' 'PASS' "$(@($procs).Count) Fullsite process(es)" }
else                       { Add-Check 'APP_PROCESS_RUNNING' 'FAIL' 'No Fullsite processes found' }

# =============================================================================
# 3. BRIDGE HTTP — GET /health, /state, /identity, /events?since=0
#    (read-only endpoints; POST endpoints are never touched)
# =============================================================================
Write-Section "3. Bridge HTTP (http://${BridgeHost}:$BRIDGE_PORT)"

$base = "http://${BridgeHost}:$BRIDGE_PORT"

$healthRaw = Get-BridgeRaw "$base/health"
if ($healthRaw) { $healthRaw | Out-File "$outDir\03-health.json" -Encoding UTF8 }
$health = $null
if ($healthRaw) { try { $health = $healthRaw | ConvertFrom-Json } catch {} }

if ($health -and $health.ok) {
    Add-Check 'HEALTH_OK' 'PASS' "v$($health.version) proto $($health.protocol_version) uptime $($health.uptime_s)s seq $($health.last_sequence) clients $($health.clients_connected)"
} elseif ($healthRaw) {
    Add-Check 'HEALTH_OK' 'FAIL' '/health responded but ok != true'
} else {
    Add-Check 'HEALTH_OK' 'FAIL' "/health unreachable at $base"
}

$stateRaw = Get-BridgeRaw "$base/state"
if ($stateRaw) { $stateRaw | Out-File "$outDir\04-state.json" -Encoding UTF8 }
$state = $null
if ($stateRaw) { try { $state = $stateRaw | ConvertFrom-Json } catch {} }
if ($state) {
    $mesaCount = 0; try { $mesaCount = @($state.mesas.PSObject.Properties).Count } catch {}
    $kdsCount  = 0; try { $kdsCount  = @($state.kds_orders).Count } catch {}
    $turnoStr  = if ($state.turno) { "turno=$($state.turno.id)" } else { 'turno=none' }
    Add-Check 'STATE_OK' 'PASS' "seq $($state.sequence) mesas $mesaCount kds_orders $kdsCount $turnoStr"
} else {
    Add-Check 'STATE_OK' 'FAIL' "/state unreachable or invalid at $base"
}

$identityRaw = Get-BridgeRaw "$base/identity"
if ($identityRaw) { $identityRaw | Out-File "$outDir\05-identity.json" -Encoding UTF8 }

$eventsApiRaw = Get-BridgeRaw "$base/events?since=0"
if ($eventsApiRaw) { $eventsApiRaw | Out-File "$outDir\06-events-api.json" -Encoding UTF8 }

# Optional remote Bridge (e.g. SERVER1 seen from PDV3)
if ($RemoteBridge) {
    Write-Section "3b. Remote Bridge (http://${RemoteBridge}:$BRIDGE_PORT)"
    $rHealth = Get-BridgeRaw "http://${RemoteBridge}:$BRIDGE_PORT/health"
    if ($rHealth) {
        $rHealth | Out-File "$outDir\90-remote-health.json" -Encoding UTF8
        Add-Check 'REMOTE_BRIDGE_REACHABLE' 'PASS' "SERVER1 $RemoteBridge :$BRIDGE_PORT reachable"
    } else {
        Add-Check 'REMOTE_BRIDGE_REACHABLE' 'FAIL' "$RemoteBridge :$BRIDGE_PORT unreachable from this terminal"
    }
    $rState = Get-BridgeRaw "http://${RemoteBridge}:$BRIDGE_PORT/state"
    if ($rState) { $rState | Out-File "$outDir\91-remote-state.json" -Encoding UTF8 }
}

# =============================================================================
# 4. DATA DIR DISCOVERY
#    Priority (grounded in local-server/adapters/process.js + main.js):
#      1. /health.log_file → dataDir = parent of "logs" dir  (authoritative)
#      2. FULLSITE_DATA_DIR env var
#      3. %APPDATA%\Fullsite POS   (Electron userData, productName "Fullsite POS")
#      4. %APPDATA%\Fullsite KDS   (dedicated KDS build)
#      5. %USERPROFILE%\.fullsite\local-server  (standalone fallback)
# =============================================================================
Write-Section '4. Data Dir Discovery'

$candidates = [System.Collections.Generic.List[string]]::new()
if ($health -and $health.log_file) {
    try {
        $logDir = Split-Path -Parent $health.log_file
        $dd     = Split-Path -Parent $logDir
        if ($dd) { $candidates.Add($dd) }
    } catch {}
}
if ($env:FULLSITE_DATA_DIR) { $candidates.Add($env:FULLSITE_DATA_DIR) }
$candidates.Add("$env:APPDATA\Fullsite POS")
$candidates.Add("$env:APPDATA\Fullsite KDS")
$candidates.Add("$env:USERPROFILE\.fullsite\local-server")

$dataDir = $null
foreach ($c in ($candidates | Select-Object -Unique)) {
    if (Test-Path $c -ErrorAction SilentlyContinue) {
        if (-not $dataDir) { $dataDir = $c }
        Write-Host "Candidate exists: $c"
    } else {
        Write-Host "Candidate absent: $c"
    }
}
# Prefer a candidate that actually holds events.ndjson
foreach ($c in ($candidates | Select-Object -Unique)) {
    if (Test-Path (Join-Path $c 'events.ndjson') -ErrorAction SilentlyContinue) { $dataDir = $c; break }
}

if ($dataDir) { Add-Check 'DATA_DIR_FOUND' 'PASS' $dataDir }
else          { Add-Check 'DATA_DIR_FOUND' 'FAIL' 'No Fullsite data directory found on this machine' }

# =============================================================================
# 5. EVENT STORE SNAPSHOT + ORDER / KDS EVENT EXTRACTION
#    Files (adapters/process.js): <dataDir>\events.ndjson,
#                                 <dataDir>\processed-commands.ndjson
# =============================================================================
Write-Section '5. Event Store'

$eventsPath = $null
$cmdsPath   = $null
$eventLines = @()

if ($dataDir) {
    $eventsPath = Join-Path $dataDir 'events.ndjson'
    $cmdsPath   = Join-Path $dataDir 'processed-commands.ndjson'

    if (Test-Path $eventsPath -ErrorAction SilentlyContinue) {
        $evSize = (Get-Item $eventsPath).Length
        if ($evSize -le 50MB) {
            Copy-Item $eventsPath "$outDir\07-events.ndjson" -ErrorAction SilentlyContinue
        } else {
            Get-Content $eventsPath -Tail 10000 | Out-File "$outDir\07-events.ndjson" -Encoding UTF8
            Write-Host "events.ndjson > 50MB — captured last 10000 lines only"
        }
        $eventLines = Get-Content $eventsPath -ErrorAction SilentlyContinue | Where-Object { $_ }
        Add-Check 'EVENT_STORE_PRESENT' 'PASS' "$eventsPath ($evSize bytes, $(@($eventLines).Count) lines)"
    } else {
        Add-Check 'EVENT_STORE_PRESENT' 'WARN' "events.ndjson not found in $dataDir (no events processed yet?)"
    }

    if (Test-Path $cmdsPath -ErrorAction SilentlyContinue) {
        Copy-Item $cmdsPath "$outDir\08-processed-commands.ndjson" -ErrorAction SilentlyContinue
    }
}

# Extract order and KDS events (protocol.js EVENT types)
if (@($eventLines).Count -gt 0) {
    $orderEvents = $eventLines | Where-Object { $_ -match '"type":"ORDER_(UPSERTED|SENT|CLOSED|CANCELLED)"' }
    $kdsEvents   = $eventLines | Where-Object { $_ -match '"type":"KDS_ITEM_STATUS"' }
    $turnoEvents = $eventLines | Where-Object { $_ -match '"type":"TURNO_(OPENED|CLOSED)"' }
    $printEvents = $eventLines | Where-Object { $_ -match '"type":"PRINT_COMMAND"' }

    $orderEvents | Out-File "$outDir\09-order-events.ndjson" -Encoding UTF8
    $kdsEvents   | Out-File "$outDir\10-kds-events.ndjson"   -Encoding UTF8

    Write-Host ("Events by family: ORDER_*={0}  KDS={1}  TURNO_*={2}  PRINT={3}  total={4}" -f `
        @($orderEvents).Count, @($kdsEvents).Count, @($turnoEvents).Count, @($printEvents).Count, @($eventLines).Count)
}

# =============================================================================
# 6. PRINT QUEUE STATE — <userData>\print-queue.json (main.js queueFilePath)
# =============================================================================
Write-Section '6. Print Queue'

$pqPath = if ($dataDir) { Join-Path $dataDir 'print-queue.json' } else { $null }
if ($pqPath -and (Test-Path $pqPath -ErrorAction SilentlyContinue)) {
    Copy-Item $pqPath "$outDir\11-print-queue.json" -ErrorAction SilentlyContinue
    $pqSummaryLines = @()
    $stuck = 0
    try {
        $jobs = Get-Content $pqPath -Raw | ConvertFrom-Json
        # Statuses (adapters/print-queue.js): pending printing printed retrying failed recoverable cancelled
        $byStatus = @($jobs) | Group-Object status
        foreach ($g in $byStatus) { $pqSummaryLines += "{0,-12} : {1}" -f $g.Name, $g.Count }
        $stuck = @(@($jobs) | Where-Object { $_.status -in @('pending','retrying','failed','recoverable') }).Count
        $pqSummaryLines += "TOTAL        : $(@($jobs).Count)"
    } catch { $pqSummaryLines += "ERROR parsing print-queue.json: $($_.Exception.Message)" }
    $pqSummaryLines | Out-File "$outDir\11-print-queue-summary.txt" -Encoding UTF8
    $pqSummaryLines | Write-Host

    if ($stuck -eq 0) { Add-Check 'PRINT_QUEUE_CLEAN' 'PASS' 'No pending/retrying/failed/recoverable jobs' }
    else              { Add-Check 'PRINT_QUEUE_CLEAN' 'WARN' "$stuck job(s) not in printed/cancelled state (expected mid-test during printer-offline steps)" }
} else {
    Add-Check 'PRINT_QUEUE_CLEAN' 'WARN' 'print-queue.json not found (no print jobs enqueued yet)'
}

$failedJobs = if ($health) { $health.print_jobs_failed } else { $null }
if ($failedJobs -ne $null) {
    if ([int]$failedJobs -eq 0) { Add-Check 'PRINT_JOBS_FAILED' 'PASS' 'print_jobs_failed = 0 since Bridge startup' }
    else                        { Add-Check 'PRINT_JOBS_FAILED' 'WARN' "print_jobs_failed = $failedJobs since Bridge startup" }
}

# =============================================================================
# 7. PERSISTENCE FILES — path, size, LastWriteTime, SHA-256
#    config.json is HASHED, never copied (may contain keys). Summary is redacted.
# =============================================================================
Write-Section '7. Persistence Files'

$persistRows = [System.Collections.Generic.List[object]]::new()
$persistNames = @('events.ndjson', 'processed-commands.ndjson', 'print-queue.json',
                  'config.json', 'printers.json', 'server-id')
$dirsToScan = @($candidates | Select-Object -Unique) + @('C:\fullsite')  # legacy config source (main.js)

foreach ($d in ($dirsToScan | Select-Object -Unique)) {
    foreach ($n in $persistNames) {
        $p = Join-Path $d $n
        if (Test-Path $p -ErrorAction SilentlyContinue) {
            $f = Get-Item $p
            $hash = ''
            try { $hash = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower() } catch {}
            $persistRows.Add([PSCustomObject]@{
                Path          = $p
                SizeBytes     = $f.Length
                LastWriteTime = $f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:sszzz')
                SHA256        = $hash
            })
        }
    }
    # Rotating logs live in <dataDir>\logs (logger.js)
    $ld = Join-Path $d 'logs'
    if (Test-Path $ld -ErrorAction SilentlyContinue) {
        Get-ChildItem $ld -Filter 'server*.log' -ErrorAction SilentlyContinue | ForEach-Object {
            $hash = ''
            try { $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } catch {}
            $persistRows.Add([PSCustomObject]@{
                Path          = $_.FullName
                SizeBytes     = $_.Length
                LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:sszzz')
                SHA256        = $hash
            })
        }
    }
}
$persistRows | Export-Csv "$outDir\12-persistence.csv" -NoTypeInformation
$persistRows | Format-Table Path, SizeBytes, LastWriteTime -AutoSize

# Redacted config summary — never print key/token/secret values
$configSummary = @()
foreach ($d in ($dirsToScan | Select-Object -Unique)) {
    $cp = Join-Path $d 'config.json'
    if (Test-Path $cp -ErrorAction SilentlyContinue) {
        $configSummary += "--- $cp ---"
        try {
            $cfg = Get-Content $cp -Raw | ConvertFrom-Json
            foreach ($prop in $cfg.PSObject.Properties) {
                if ($prop.Name -match '(?i)key|token|secret|password|supabase') {
                    $configSummary += "$($prop.Name) = ***REDACTED***"
                } else {
                    $configSummary += "$($prop.Name) = $($prop.Value)"
                }
            }
        } catch { $configSummary += "ERROR parsing: $($_.Exception.Message)" }
    }
}
$configSummary | Out-File "$outDir\13-config-summary.txt" -Encoding UTF8

# =============================================================================
# 8. SYNC STATUS
#    sync_queue_size (/health) = events with synced:false in events.ndjson.
#    NOTE Phase 1: the web app writes to Supabase directly; the Bridge observes
#    via 5s poll (STATE_SYNC → last_supabase_sync in /state). markSynced() has
#    no production caller yet, so sync_queue_size grows with local commands —
#    it is telemetry, NOT a certification failure by itself.
# =============================================================================
Write-Section '8. Sync Status'

$unsyncedInFile = 0
if (@($eventLines).Count -gt 0) {
    $unsyncedInFile = @($eventLines | Where-Object { $_ -match '"synced":false' }).Count
}
$lastSync = if ($state) { $state.last_supabase_sync } else { $null }
$syncQueue = if ($health) { $health.sync_queue_size } else { 'n/a' }
@"
sync_queue_size (/health)        : $syncQueue
events synced:false (file scan)  : $unsyncedInFile
last_supabase_sync (/state)      : $(if ($lastSync) { $lastSync } else { 'null (no internet sync yet)' })
"@ | Out-File "$outDir\14-sync-status.txt" -Encoding UTF8
Get-Content "$outDir\14-sync-status.txt" | Write-Host

if ($lastSync) { Add-Check 'SUPABASE_SYNC_SEEN' 'PASS' "last_supabase_sync = $lastSync" }
else           { Add-Check 'SUPABASE_SYNC_SEEN' 'WARN' 'No STATE_SYNC from Supabase yet (expected while offline)' }

# =============================================================================
# 9. DUPLICATE DETECTION — zero duplicated order/event IDs is a hard gate
#    Event id = command_id (core/event-store.js idempotent pairing).
# =============================================================================
Write-Section '9. Duplicate Detection'

$dupReport = @()
$dupIdCount = 0; $dupSeqCount = 0; $dupCmdCount = 0

if (@($eventLines).Count -gt 0) {
    $ids  = foreach ($l in $eventLines) { if ($l -match '"id":"([^"]+)"')    { $Matches[1] } }
    $seqs = foreach ($l in $eventLines) { if ($l -match '"sequence":(\d+)')  { $Matches[1] } }

    $dupIds  = @($ids  | Group-Object | Where-Object { $_.Count -gt 1 })
    $dupSeqs = @($seqs | Group-Object | Where-Object { $_.Count -gt 1 })
    $dupIdCount  = $dupIds.Count
    $dupSeqCount = $dupSeqs.Count

    $dupReport += "events.ndjson lines            : $(@($eventLines).Count)"
    $dupReport += "distinct event ids             : $(@($ids | Select-Object -Unique).Count)"
    $dupReport += "DUPLICATE event ids            : $dupIdCount"
    foreach ($g in $dupIds  | Select-Object -First 20) { $dupReport += "  dup id  x$($g.Count): $($g.Name)" }
    $dupReport += "DUPLICATE sequences            : $dupSeqCount"
    foreach ($g in $dupSeqs | Select-Object -First 20) { $dupReport += "  dup seq x$($g.Count): $($g.Name)" }
} else {
    $dupReport += 'No event lines available for duplicate analysis.'
}

if ($cmdsPath -and (Test-Path $cmdsPath -ErrorAction SilentlyContinue)) {
    $cmdLines = Get-Content $cmdsPath -ErrorAction SilentlyContinue | Where-Object { $_ }
    $keys = foreach ($l in $cmdLines) { if ($l -match '"key":"([^"]+)"') { $Matches[1] } }
    $dupKeys = @($keys | Group-Object | Where-Object { $_.Count -gt 1 })
    $dupCmdCount = $dupKeys.Count
    $dupReport += "processed-commands lines       : $(@($cmdLines).Count)"
    $dupReport += "DUPLICATE command keys         : $dupCmdCount"
    foreach ($g in $dupKeys | Select-Object -First 20) { $dupReport += "  dup key x$($g.Count): $($g.Name)" }
}

$dupReport | Out-File "$outDir\15-duplicates.txt" -Encoding UTF8
$dupReport | Write-Host

if (@($eventLines).Count -eq 0) {
    Add-Check 'ZERO_DUPLICATES' 'WARN' 'No events to analyze'
} elseif (($dupIdCount + $dupSeqCount + $dupCmdCount) -eq 0) {
    Add-Check 'ZERO_DUPLICATES' 'PASS' 'No duplicate event ids, sequences, or command keys'
} else {
    Add-Check 'ZERO_DUPLICATES' 'FAIL' "dup ids=$dupIdCount dup seqs=$dupSeqCount dup cmd keys=$dupCmdCount — see 15-duplicates.txt"
}

# =============================================================================
# 10. LOG ERRORS — [ERROR] lines from rotating logs (logger.js format:
#     "<ISO> [ERROR] msg"; series server.log, server.1.log … server.5.log)
# =============================================================================
Write-Section '10. Log Errors'

$errLines = [System.Collections.Generic.List[string]]::new()
$logDirScanned = $null
if ($dataDir) {
    $logDirScanned = Join-Path $dataDir 'logs'
    if (Test-Path $logDirScanned -ErrorAction SilentlyContinue) {
        Get-ChildItem $logDirScanned -Filter 'server*.log' -ErrorAction SilentlyContinue |
            Sort-Object Name | ForEach-Object {
                $file = $_.FullName
                Get-Content $file -ErrorAction SilentlyContinue |
                    Where-Object { $_ -match '\[ERROR' } |
                    ForEach-Object { $errLines.Add("$($file): $_") }
            }
        # Tail of active log for context
        $active = Join-Path $logDirScanned 'server.log'
        if (Test-Path $active -ErrorAction SilentlyContinue) {
            Get-Content $active -Tail 200 -ErrorAction SilentlyContinue |
                Out-File "$outDir\17-server-log-tail.txt" -Encoding UTF8
        }
    }
}
$errLines | Out-File "$outDir\16-log-errors.txt" -Encoding UTF8

if (-not $logDirScanned -or -not (Test-Path $logDirScanned -ErrorAction SilentlyContinue)) {
    Add-Check 'LOG_ERRORS' 'WARN' 'Log directory not found'
} elseif ($errLines.Count -eq 0) {
    Add-Check 'LOG_ERRORS' 'PASS' "0 ERROR lines in $logDirScanned\server*.log"
} else {
    Add-Check 'LOG_ERRORS' 'WARN' "$($errLines.Count) ERROR line(s) — see 16-log-errors.txt"
}

# =============================================================================
# SUMMARY.txt — PASS/FAIL heuristics per capture
# =============================================================================
Write-Section 'SUMMARY'

$fails = @($summary | Where-Object { $_.Result -eq 'FAIL' }).Count
$warns = @($summary | Where-Object { $_.Result -eq 'WARN' }).Count
$overall = if ($fails -gt 0) { 'FAIL' } elseif ($warns -gt 0) { 'PASS-WITH-WARNINGS' } else { 'PASS' }

$sumLines = [System.Collections.Generic.List[string]]::new()
$sumLines.Add('FULLSITE CERT-CAPTURE SUMMARY')
$sumLines.Add('=============================')
$sumLines.Add("Label     : $Label")
$sumLines.Add("Machine   : $env:COMPUTERNAME")
$sumLines.Add("Timestamp : $($now.ToString('yyyy-MM-ddTHH:mm:sszzz'))")
$sumLines.Add("Bridge    : http://${BridgeHost}:$BRIDGE_PORT")
$sumLines.Add("Evidence  : $outDir")
$sumLines.Add('')
foreach ($c in $summary) { $sumLines.Add(("[{0,-4}] {1,-24} {2}" -f $c.Result, $c.Check, $c.Detail)) }
$sumLines.Add('')
$sumLines.Add("OVERALL   : $overall   (FAIL=$fails WARN=$warns)")
$sumLines.Add('')
$sumLines.Add('Notes:')
$sumLines.Add(' - WARN is informational; several WARNs are expected mid-test')
$sumLines.Add('   (e.g. printer-offline steps, offline steps before internet returns).')
$sumLines.Add(' - FAIL on ZERO_DUPLICATES, HEALTH_OK, or PORT_7717_LISTENING during a')
$sumLines.Add('   certification step is a P0 — use the P0 template in THURSDAY-RUNBOOK.md.')

$sumLines | Out-File "$outDir\SUMMARY.txt" -Encoding UTF8

$bar = '=' * 60
Write-Host ''
Write-Host $bar
foreach ($l in $sumLines) { Write-Host $l }
Write-Host $bar

Stop-Transcript -ErrorAction SilentlyContinue

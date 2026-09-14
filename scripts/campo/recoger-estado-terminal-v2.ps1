# Fullsite field inventory for Windows PowerShell 5.
# Read-only: does not install, stop, start, delete, or modify Fullsite.

$ErrorActionPreference = 'Continue'
$desktop = [Environment]::GetFolderPath('Desktop')
$output = Join-Path $desktop ("fullsite-estado-v2-$env:COMPUTERNAME.txt")
$lines = New-Object System.Collections.ArrayList

function Add-Line([string]$text) { [void]$lines.Add($text) }
function Value-Or-Empty($obj, [string]$name) {
  if ($null -eq $obj) { return '' }
  $property = $obj.PSObject.Properties[$name]
  if ($null -eq $property -or $null -eq $property.Value) { return '' }
  return [string]$property.Value
}

Add-Line '==============================================='
Add-Line ' Fullsite terminal inventory v2'
Add-Line (" Computer: {0}" -f $env:COMPUTERNAME)
Add-Line (" Date:     {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line (" User:     {0}" -f $env:USERNAME)
Add-Line '==============================================='
Add-Line ''

Add-Line '--- NETWORK ---'
try {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' } |
    ForEach-Object { Add-Line ("  {0} ({1})" -f $_.IPAddress, $_.InterfaceAlias) }
} catch { Add-Line ("  ERROR: {0}" -f $_.Exception.Message) }
Add-Line ''

$dataDirs = @(
  (Join-Path $env:APPDATA 'Fullsite POS'),
  (Join-Path $env:APPDATA 'fullsite-pos'),
  (Join-Path $env:APPDATA 'Fullsite KDS'),
  (Join-Path $env:APPDATA 'fullsite-kds')
)
$configs = New-Object System.Collections.ArrayList
$ports = New-Object System.Collections.ArrayList

Add-Line '--- DATA DIRECTORIES ---'
foreach ($dir in $dataDirs) {
  if (-not (Test-Path $dir)) { continue }
  Add-Line ("FOUND: {0}" -f $dir)
  $configPath = Join-Path $dir 'config.json'
  if (Test-Path $configPath) {
    try {
      $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      [void]$configs.Add($cfg)
      $portText = Value-Or-Empty $cfg 'local_server_port'
      if ($portText) { [void]$ports.Add([int]$portText) }
      Add-Line ("  config_version={0}" -f (Value-Or-Empty $cfg 'config_version'))
      Add-Line ("  restaurant_id={0}" -f (Value-Or-Empty $cfg 'restaurant_id'))
      Add-Line ("  client_id={0}" -f (Value-Or-Empty $cfg 'client_id'))
      Add-Line ("  terminal_id={0}" -f (Value-Or-Empty $cfg 'terminal_id'))
      Add-Line ("  terminal_name={0}" -f (Value-Or-Empty $cfg 'terminal_name'))
      Add-Line ("  terminal_role={0}" -f (Value-Or-Empty $cfg 'terminal_role'))
      Add-Line ("  kds_only={0}" -f (Value-Or-Empty $cfg 'kds_only'))
      Add-Line ("  pos_server_ip={0}" -f (Value-Or-Empty $cfg 'pos_server_ip'))
      Add-Line ("  pos_server_port={0}" -f (Value-Or-Empty $cfg 'pos_server_port'))
      Add-Line ("  local_server_port={0}" -f $portText)
      Add-Line ("  localAuthorityEnabled={0}" -f (Value-Or-Empty $cfg 'localAuthorityEnabled'))
      $secret = Value-Or-Empty $cfg 'lan_secret'
      if (-not $secret) { $secret = Value-Or-Empty $cfg 'lanSecret' }
      $secretPath = Join-Path $dir 'lan-secret'
      $secretLength = 0
      if ($secret) {
        $secretLength = $secret.Length
      } elseif (Test-Path $secretPath) {
        try {
          $secretLength = (Get-Content $secretPath -Raw -ErrorAction Stop).Trim().Length
        } catch {}
      }
      Add-Line ("  lan_secret_present={0}" -f [bool]($secretLength -gt 0))
      if ($secretLength -gt 0) { Add-Line ("  lan_secret_length={0}" -f $secretLength) }
    } catch { Add-Line ("  CONFIG_ERROR: {0}" -f $_.Exception.Message) }
  } else { Add-Line '  config.json=missing' }

  foreach ($fileName in @('events.ndjson','event-log.ndjson','processed-commands.ndjson','print-queue.json','printers.json','server-id')) {
    $filePath = Join-Path $dir $fileName
    if (-not (Test-Path $filePath)) { continue }
    $item = Get-Item $filePath
    Add-Line ("  file={0} bytes={1} modified={2}" -f $fileName, $item.Length, $item.LastWriteTime)
    if ($fileName -like '*events.ndjson') {
      $eventCount = 0
      $unsyncedCount = 0
      Get-Content $filePath | ForEach-Object {
        if (-not $_) { return }
        $eventCount++
        try {
          $event = $_ | ConvertFrom-Json
          if ($event.PSObject.Properties['synced'] -and $event.synced -ne $true) { $unsyncedCount++ }
        } catch {}
      }
      Add-Line ("  events_count={0} events_unsynced={1}" -f $eventCount, $unsyncedCount)
    }
    if ($fileName -eq 'print-queue.json') {
      try {
        $parsedJobs = Get-Content $filePath -Raw | ConvertFrom-Json
        if ($null -eq $parsedJobs) {
          $jobs = @()
        } elseif ($parsedJobs -is [System.Array]) {
          $jobs = @($parsedJobs)
        } else {
          $jobs = @($parsedJobs)
        }
        $pending = @($jobs | Where-Object { $_.status -notin @('printed','cancelled') }).Count
        Add-Line ("  print_jobs={0} print_unresolved={1}" -f $jobs.Count, $pending)
      } catch { Add-Line ("  PRINT_QUEUE_ERROR: {0}" -f $_.Exception.Message) }
    }
  }
}
if ($configs.Count -eq 0) { Add-Line 'NO CONFIGURED FULLSITE DATA DIRECTORY FOUND' }
Add-Line ''

Add-Line '--- FULLSITE SHORTCUTS AND EXECUTABLES ---'
try {
  $shell = New-Object -ComObject WScript.Shell
  Get-ChildItem (Join-Path $desktop '*.lnk') -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*Fullsite*' } |
    ForEach-Object {
      $shortcut = $shell.CreateShortcut($_.FullName)
      Add-Line ("shortcut={0}" -f $_.FullName)
      Add-Line ("  target={0}" -f $shortcut.TargetPath)
      Add-Line ("  arguments={0}" -f $shortcut.Arguments)
      Add-Line ("  working_directory={0}" -f $shortcut.WorkingDirectory)
      if (Test-Path $shortcut.TargetPath) {
        $exe = Get-Item $shortcut.TargetPath
        Add-Line ("  product_version={0}" -f $exe.VersionInfo.ProductVersion)
        Add-Line ("  file_version={0}" -f $exe.VersionInfo.FileVersion)
        Add-Line ("  exe_modified={0}" -f $exe.LastWriteTime)
        Add-Line ("  exe_sha256={0}" -f (Get-FileHash $exe.FullName -Algorithm SHA256).Hash)
      } else { Add-Line '  target_exists=false' }
    }
} catch { Add-Line ("SHORTCUT_ERROR: {0}" -f $_.Exception.Message) }
Add-Line ''

Add-Line '--- RUNNING FULLSITE PROCESSES ---'
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'Fullsite|electron' })
if ($running.Count -eq 0) { Add-Line 'none' }
foreach ($process in $running) {
  Add-Line ("process={0} pid={1} path={2}" -f $process.ProcessName, $process.Id, $process.Path)
}
Add-Line ''

if ($ports.Count -eq 0) { [void]$ports.Add(7717) }
$ports = @($ports | Select-Object -Unique)
foreach ($port in $ports) {
  Add-Line ("--- LOCAL SERVER PORT {0} ---" -f $port)
  try {
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $port) -TimeoutSec 5
    Add-Line 'health=responding'
    Add-Line ("  version={0}" -f (Value-Or-Empty $health 'version'))
    Add-Line ("  restaurant_id={0}" -f (Value-Or-Empty $health 'restaurant_id'))
    Add-Line ("  clients_connected={0}" -f (Value-Or-Empty $health 'clients_connected'))
    Add-Line ("  last_sequence={0}" -f (Value-Or-Empty $health 'last_sequence'))
    Add-Line ("  sync_queue_size={0}" -f (Value-Or-Empty $health 'sync_queue_size'))
    Add-Line ("  print_jobs_failed={0}" -f (Value-Or-Empty $health 'print_jobs_failed'))
    try {
      $state = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/state" -f $port) -TimeoutSec 5
      $salon = @($state.salon_orders).Count
      $kds = @($state.kds_orders).Count
      $financial = @($state.financial_orders)
      $unresolvedPayments = @($financial | ForEach-Object { $_.payments } | Where-Object { $_.status -in @('pending','unknown') }).Count
      $occupied = 0
      if ($state.mesas -is [System.Array]) {
        $occupied = @($state.mesas | Where-Object { $_.status -and $_.status -ne 'libre' }).Count
      } elseif ($state.mesas) {
        $occupied = @($state.mesas.PSObject.Properties.Value | Where-Object { $_.status -and $_.status -ne 'libre' }).Count
      }
      Add-Line ("  state_turn_open={0}" -f [bool]$state.turno)
      Add-Line ("  state_salon_orders={0}" -f $salon)
      Add-Line ("  state_kds_orders={0}" -f $kds)
      Add-Line ("  state_financial_orders={0}" -f $financial.Count)
      Add-Line ("  state_unresolved_payments={0}" -f $unresolvedPayments)
      Add-Line ("  state_occupied_tables={0}" -f $occupied)
    } catch { Add-Line ("  state=unavailable ({0})" -f $_.Exception.Message) }
  } catch { Add-Line ("health=not_responding ({0})" -f $_.Exception.Message) }
  Add-Line ''
}

Add-Line '--- FINGERPRINT PORT 7718 ---'
try {
  $fp = Invoke-RestMethod -Uri 'http://127.0.0.1:7718/health' -TimeoutSec 3
  Add-Line ("responding=true ok={0} reader={1}" -f (Value-Or-Empty $fp 'ok'), (Value-Or-Empty $fp 'reader'))
} catch { Add-Line ("responding=false ({0})" -f $_.Exception.Message) }
Add-Line ''
Add-Line 'END - send this complete report.'

$text = $lines -join "`r`n"
$text | Out-File -FilePath $output -Encoding UTF8
Write-Host ''
Write-Host ("REPORT READY: {0}" -f $output) -ForegroundColor Green
Write-Host ''
$text | Write-Host

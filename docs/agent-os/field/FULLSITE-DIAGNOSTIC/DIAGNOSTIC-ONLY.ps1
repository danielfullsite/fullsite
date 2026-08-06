#Requires -Version 5.1
<#
.SYNOPSIS
    DIAGNOSTIC-ONLY.ps1 — Read-only evidence capture for PDV3 / SERVER1 pre-install audit.

.DESCRIPTION
    100% read-only. No registry writes, no process stops, no firewall changes,
    no installs, no service/task modifications, no biometric data copied.

    Run as Administrator for full CIM/WMI access.
    Output: Desktop\fullsite-diag-<timestamp>\ + ZIP + SHA-256

    Finishes cleanly even when no Fullsite processes, folders, or ports are found.
#>

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'
$WarningPreference     = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

$date   = Get-Date -Format 'yyyyMMdd-HHmm'
$outDir = "$env:USERPROFILE\Desktop\fullsite-diag-$date"
New-Item -ItemType Directory -Path $outDir                    -Force | Out-Null
New-Item -ItemType Directory -Path "$outDir\5-scheduled-tasks" -Force | Out-Null

# Transcript — captures full stdout/stderr to a log file alongside the ZIP
Start-Transcript -Path "$outDir\transcript.log" -Append -ErrorAction SilentlyContinue

function Write-Section {
    param([string]$Title)
    $bar = '-' * 60
    Write-Host "`n$bar`n  $Title`n$bar"
}


# =============================================================================
# 0. METADATA — computer name, OS, capture time
# =============================================================================
$metaRow = [PSCustomObject]@{
    ComputerName = $env:COMPUTERNAME
    UserName     = $env:USERNAME
    CaptureDate  = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    OSVersion    = [System.Environment]::OSVersion.VersionString
    PSVersion    = $PSVersionTable.PSVersion.ToString()
}
$metaRow | Export-Csv "$outDir\0-metadata.csv" -NoTypeInformation
Write-Host "Terminal: $env:COMPUTERNAME  |  $([System.Environment]::OSVersion.VersionString)"


# =============================================================================
# 1. PROCESSES  —  Win32_Process via CIM
# =============================================================================
Write-Section '1. Processes'

$allProcs = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name           -like '*ullsite*' -or
        $_.Name           -like '*Fullsite*' -or
        $_.Name           -eq   'fingerprint-service.exe' -or
        $_.ExecutablePath -like '*ullsite*'
    } |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine, CreationDate

$allProcs | Export-Csv "$outDir\1-processes.csv" -NoTypeInformation
$allProcs | Format-Table ProcessId, Name, ExecutablePath -AutoSize
Write-Host "Processes found: $(@($allProcs).Count)"


# =============================================================================
# 2. UNINSTALL REGISTRY  —  HKLM + WOW6432Node + HKCU
# =============================================================================
Write-Section '2. Uninstall Registry'

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
                    Hive            = $base
                    KeyName         = $_.PSChildName
                    DisplayName     = $dn
                    DisplayVersion  = $p.DisplayVersion
                    Publisher       = $p.Publisher
                    InstallLocation = $p.InstallLocation
                    UninstallString = $p.UninstallString
                    InstallDate     = $p.InstallDate
                }
            }
        } catch {}
    }
}

$uninstallEntries | Export-Csv "$outDir\2-uninstall-registry.csv" -NoTypeInformation
if (@($uninstallEntries).Count -gt 0) {
    $uninstallEntries | Format-List
} else {
    Write-Host 'No NSIS/MSI uninstall records found for Fullsite/POS/KDS'
}


# =============================================================================
# 3. PORTS 7717 AND 7718
# =============================================================================
Write-Section '3. Ports 7717 / 7718'

$portData = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(7717, 7718) } |
    ForEach-Object {
        $conn      = $_
        $ownerProc = Get-CimInstance -ClassName Win32_Process `
            -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        [PSCustomObject]@{
            LocalAddress   = $conn.LocalAddress
            LocalPort      = $conn.LocalPort
            OwningProcess  = $conn.OwningProcess
            ProcessName    = if ($ownerProc) { $ownerProc.Name }          else { '' }
            ExecutablePath = if ($ownerProc) { $ownerProc.ExecutablePath } else { '' }
        }
    }

$portData | Export-Csv "$outDir\3-ports.csv" -NoTypeInformation
if (@($portData).Count -gt 0) {
    $portData | Format-Table -AutoSize
} else {
    Write-Host 'Ports 7717 and 7718 are not bound'
}


# =============================================================================
# 4. SERVICES
# =============================================================================
Write-Section '4. Services'

$services = Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name        -like '*ullsite*' -or
        $_.DisplayName -like '*ullsite*' -or
        $_.PathName    -like '*ullsite*' -or
        $_.Name        -like '*fingerprint*' -or
        $_.DisplayName -like '*fingerprint*'
    } |
    Select-Object Name, DisplayName, State, StartMode, StartName, PathName

$services | Export-Csv "$outDir\4-services.csv" -NoTypeInformation
if (@($services).Count -gt 0) {
    $services | Format-List
} else {
    Write-Host 'No matching Windows services found'
}


# =============================================================================
# 5. SCHEDULED TASKS  —  CSV summary + individual XML
# =============================================================================
Write-Section '5. Scheduled Tasks'

$scheduledTasks = Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object {
        $_.TaskName -like '*ullsite*' -or
        $_.TaskName -like '*POS*'     -or
        $_.TaskName -like '*KDS*'     -or
        $_.TaskName -like '*fingerprint*'
    }

$scheduledTasks |
    Select-Object TaskName, TaskPath, State, Description |
    Export-Csv "$outDir\5-scheduled-tasks\tasks-summary.csv" -NoTypeInformation

foreach ($t in $scheduledTasks) {
    $safeName = $t.TaskName -replace '[\\/:*?"<>|]', '_'
    try {
        Export-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath |
            Out-File "$outDir\5-scheduled-tasks\$safeName.xml" -Encoding UTF8
    } catch {}
}

Write-Host "Scheduled tasks found: $(@($scheduledTasks).Count)"
if (@($scheduledTasks).Count -gt 0) {
    $scheduledTasks | Select-Object TaskName, State | Format-Table -AutoSize
}


# =============================================================================
# 6. RUN KEYS + STARTUP FOLDERS
# =============================================================================
Write-Section '6. Run Keys + Startup Folders'

$runKeyPaths = @(
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
)

$runEntries = foreach ($keyPath in $runKeyPaths) {
    if (-not (Test-Path $keyPath -ErrorAction SilentlyContinue)) { continue }
    try {
        $props = Get-ItemProperty $keyPath -ErrorAction Stop
        $props.PSObject.Properties |
            Where-Object { $_.Name -notlike 'PS*' } |
            ForEach-Object {
                [PSCustomObject]@{
                    RegKey = $keyPath
                    Name   = $_.Name
                    Value  = $_.Value
                }
            }
    } catch {}
}

$runEntries | Export-Csv "$outDir\6a-run-keys.csv" -NoTypeInformation
Write-Host "Total Run entries across all hives: $(@($runEntries).Count)"

$fsRunEntries = @($runEntries) | Where-Object {
    $_.Name  -like '*ullsite*' -or
    $_.Value -like '*ullsite*'
}
if ($fsRunEntries) {
    $fsRunEntries | Format-Table -AutoSize
} else {
    Write-Host 'No Fullsite entries in Run keys'
}

# Startup folders — read-only; resolve .lnk targets via WScript.Shell COM
$startupFolderPaths = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp'
)

$wshell = $null
try { $wshell = New-Object -ComObject WScript.Shell -ErrorAction Stop } catch {}

$startupItems = foreach ($sf in $startupFolderPaths) {
    if (-not (Test-Path $sf -ErrorAction SilentlyContinue)) { continue }
    Get-ChildItem $sf -ErrorAction SilentlyContinue | ForEach-Object {
        $target = ''
        if ($_.Extension -ieq '.lnk' -and $wshell) {
            try { $target = $wshell.CreateShortcut($_.FullName).TargetPath } catch {}
        }
        [PSCustomObject]@{
            Folder        = $sf
            Name          = $_.Name
            FullPath      = $_.FullName
            LnkTarget     = $target
            LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        }
    }
}

$startupItems | Export-Csv "$outDir\6b-startup-folder.csv" -NoTypeInformation
Write-Host "Startup folder items: $(@($startupItems).Count)"
if (@($startupItems).Count -gt 0) {
    $startupItems | Format-Table -AutoSize
}


# =============================================================================
# 7. FOLDER INVENTORY  —  sizes, timestamps, hashes of exe/config only
#    Biometric data files (.dat, .bio, .fp, .fng, .template) are NOT read.
# =============================================================================
Write-Section '7. Folder Inventory'

$foldersToScan = @(
    'C:\fullsite',
    "$env:APPDATA\Fullsite POS",
    "$env:APPDATA\Fullsite KDS",
    "$env:LOCALAPPDATA\Fullsite POS",
    "$env:LOCALAPPDATA\Fullsite KDS"
)

$hashExts = @('.exe', '.dll', '.json', '.js', '.config', '.ini', '.cmd', '.bat', '.xml')
$skipExts = @('.dat', '.bio', '.fp', '.fng', '.template')

$folderInventory = foreach ($folder in $foldersToScan) {
    if (-not (Test-Path $folder -ErrorAction SilentlyContinue)) {
        [PSCustomObject]@{
            Folder        = $folder
            Exists        = $false
            File          = ''
            SizeBytes     = 0
            LastWriteTime = ''
            SHA256        = ''
            FileVersion   = ''
        }
        continue
    }
    Get-ChildItem $folder -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object {
            $f    = $_
            $ext  = $f.Extension.ToLower()
            $hash = ''
            $ver  = ''

            if ($ext -in $skipExts) {
                $hash = 'SKIPPED-BIOMETRIC'
            } elseif ($ext -in $hashExts) {
                try { $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower() } catch {}
                if ($ext -in @('.exe', '.dll')) {
                    try { $ver = $f.VersionInfo.FileVersion } catch {}
                }
            }

            [PSCustomObject]@{
                Folder        = $folder
                Exists        = $true
                File          = $f.FullName.Substring($folder.Length)
                SizeBytes     = $f.Length
                LastWriteTime = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                SHA256        = $hash
                FileVersion   = $ver
            }
        }
}

$folderInventory | Export-Csv "$outDir\7-folder-inventory.csv" -NoTypeInformation

foreach ($folder in $foldersToScan) {
    $exists   = Test-Path $folder -ErrorAction SilentlyContinue
    $entries  = @($folderInventory) | Where-Object { $_.Folder -eq $folder -and $_.File -ne '' }
    $count    = $entries.Count
    $sumBytes = ($entries | Measure-Object -Property SizeBytes -Sum).Sum
    $sizeKB   = if ($sumBytes) { [math]::Round($sumBytes / 1KB, 1) } else { 0 }
    Write-Host "$folder  exists=$exists  files=$count  size=${sizeKB}KB"
}


# =============================================================================
# 8. NETWORK  —  adapters, IP, gateway, routes, PDV3 → SERVER1:7717
# =============================================================================
Write-Section '8. Network'

$adapters = Get-NetAdapter -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Up' } |
    Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed, Status

$adapters | Export-Csv "$outDir\8a-adapters.csv" -NoTypeInformation
$adapters | Format-Table -AutoSize

$ipConfig = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' } |
    Select-Object InterfaceAlias, IPAddress, PrefixLength

$ipConfig | Export-Csv "$outDir\8b-ipconfig.csv" -NoTypeInformation
$ipConfig | Format-Table -AutoSize

$gateways = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Select-Object InterfaceAlias, NextHop, RouteMetric

$gateways | Export-Csv "$outDir\8c-gateways.csv" -NoTypeInformation
$gateways | Format-Table -AutoSize

Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Select-Object DestinationPrefix, NextHop, InterfaceAlias, RouteMetric |
    Export-Csv "$outDir\8d-routes.csv" -NoTypeInformation

# PDV3 → SERVER1:7717 — try candidates; field tech should confirm actual SERVER1 IP
$server1Candidates = @('192.168.1.71', '192.168.0.71', '192.168.1.1')
$server1Reachable  = $false
$server1IP         = 'NOT FOUND'

foreach ($ip in $server1Candidates) {
    $ok = Test-NetConnection -ComputerName $ip -Port 7717 `
        -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($ok) { $server1Reachable = $true; $server1IP = $ip; break }
}

$thisIP    = ($ipConfig | Select-Object -First 1 -ExpandProperty IPAddress)
$netResult = [PSCustomObject]@{
    ThisHostIP      = $thisIP
    Server1Tested   = ($server1Candidates -join ', ')
    Server1IP       = $server1IP
    Server1Port7717 = $server1Reachable
}
$netResult | Export-Csv "$outDir\8e-connectivity.csv" -NoTypeInformation
$netResult | Format-List


# =============================================================================
# 9. EXECUTABLE VERSIONS + HASHES
# =============================================================================
Write-Section '9. Executable Versions'

$rawExePaths = [System.Collections.Generic.List[string]]::new()

foreach ($p in @($allProcs)) {
    if ($p.ExecutablePath) { $rawExePaths.Add($p.ExecutablePath) }
}
foreach ($fi in @($folderInventory)) {
    if ($fi.File -like '*.exe' -and $fi.Exists -and
        $fi.SHA256 -ne '' -and $fi.SHA256 -ne 'SKIPPED-BIOMETRIC') {
        $rawExePaths.Add("$($fi.Folder)$($fi.File)")
    }
}
foreach ($u in @($uninstallEntries)) {
    if ($u.InstallLocation -and (Test-Path $u.InstallLocation -ErrorAction SilentlyContinue)) {
        Get-ChildItem $u.InstallLocation -Filter '*.exe' -ErrorAction SilentlyContinue |
            ForEach-Object { $rawExePaths.Add($_.FullName) }
    }
}

$exeDetails = $rawExePaths | Sort-Object -Unique | ForEach-Object {
    $path = $_
    if (-not $path -or -not (Test-Path $path -ErrorAction SilentlyContinue)) { return }
    $fvi  = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path)
    $hash = ''
    try { $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower() } catch {}
    $lw   = ''
    try { $lw = (Get-Item $path -EA SilentlyContinue).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } catch {}
    [PSCustomObject]@{
        Path        = $path
        FileVersion = $fvi.FileVersion
        ProductName = $fvi.ProductName
        SHA256      = $hash
        LastWrite   = $lw
    }
}

$exeDetails | Export-Csv "$outDir\9-executables.csv" -NoTypeInformation
if (@($exeDetails).Count -gt 0) {
    $exeDetails | Format-Table Path, FileVersion, SHA256 -AutoSize
} else {
    Write-Host 'No Fullsite executables found'
}


# =============================================================================
# 10. COMPUTE SUMMARY VALUES
# =============================================================================
$nsisFound   = (@($uninstallEntries) |
    Where-Object { $_.UninstallString -ne '' }).Count -gt 0
$legacyFound = (Test-Path 'C:\fullsite' -ErrorAction SilentlyContinue) -and
    ((@($folderInventory) | Where-Object { $_.Folder -eq 'C:\fullsite' -and $_.Exists }).Count -gt 0)

$deployType = if     ($nsisFound -and $legacyFound) { 'MIXED'   }
              elseif ($nsisFound)                   { 'NSIS'    }
              elseif ($legacyFound)                 { 'LEGACY'  }
              else                                  { 'UNKNOWN' }

$currentExe = $allProcs | Select-Object -First 1 -ExpandProperty ExecutablePath
if (-not $currentExe) { $currentExe = 'NOT RUNNING' }

$currentVer = ''
if ($currentExe -ne 'NOT RUNNING' -and (Test-Path $currentExe -ErrorAction SilentlyContinue)) {
    $currentVer = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($currentExe).FileVersion
}

$p7717row = @($portData) | Where-Object { $_.LocalPort -eq 7717 } | Select-Object -First 1
$p7718row = @($portData) | Where-Object { $_.LocalPort -eq 7718 } | Select-Object -First 1
$p7717str = if ($p7717row) {
    "$($p7717row.ProcessName) PID $($p7717row.OwningProcess) @ $($p7717row.ExecutablePath)"
} else { 'NOT BOUND' }
$p7718str = if ($p7718row) {
    "$($p7718row.ProcessName) PID $($p7718row.OwningProcess) @ $($p7718row.ExecutablePath)"
} else { 'NOT BOUND' }

$autoMethods = [System.Collections.Generic.List[string]]::new()
foreach ($re in @($fsRunEntries)) {
    $autoMethods.Add("Registry:Run name=$($re.Name)")
}
foreach ($si in @($startupItems)) {
    if ($si.LnkTarget -like '*ullsite*') {
        $autoMethods.Add("StartupFolder:$($si.Name) -> $($si.LnkTarget)")
    }
}
foreach ($st in @($scheduledTasks)) {
    $autoMethods.Add("ScheduledTask:$($st.TaskName)")
}
$autoStartStr = if ($autoMethods.Count -gt 0) { $autoMethods -join ' | ' } else { 'NONE DETECTED' }

$udFound = [System.Collections.Generic.List[string]]::new()
foreach ($folder in @(
    "$env:APPDATA\Fullsite POS",
    "$env:APPDATA\Fullsite KDS",
    "$env:LOCALAPPDATA\Fullsite POS",
    "$env:LOCALAPPDATA\Fullsite KDS"
)) {
    if (Test-Path $folder -ErrorAction SilentlyContinue) { $udFound.Add($folder) }
}
$udStr = if ($udFound.Count -gt 0) { $udFound -join ' | ' } else { 'NONE FOUND' }


# =============================================================================
# ZIP + SHA-256
# =============================================================================
Write-Section 'Creating ZIP'

# Stop transcript before compressing so the log is complete inside the ZIP
Stop-Transcript -ErrorAction SilentlyContinue

$zipPath = "$outDir.zip"
Compress-Archive -Path $outDir -DestinationPath $zipPath -CompressionLevel Optimal

$zipHash = ''
if (Test-Path $zipPath) {
    $zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
}
$rollbackInputsCaptured = (Test-Path $zipPath) -and ($zipHash -ne '')


# =============================================================================
# FINAL TERMINAL OUTPUT
# =============================================================================
$bar = '=' * 60
Write-Host ''
Write-Host $bar
Write-Host "TERMINAL                  = $env:COMPUTERNAME"
Write-Host "CURRENT DEPLOYMENT TYPE   = $deployType"
Write-Host "CURRENT EXECUTABLE        = $currentExe"
Write-Host "CURRENT VERSION           = $(if ($currentVer) { $currentVer } else { 'UNKNOWN' })"
Write-Host "PORT 7717 OWNER           = $p7717str"
Write-Host "PORT 7718 OWNER           = $p7718str"
Write-Host "AUTO-START METHOD         = $autoStartStr"
Write-Host "USER DATA PATHS           = $udStr"
Write-Host "ROLLBACK INPUTS CAPTURED  = $(if ($rollbackInputsCaptured) { 'YES' } else { 'NO' })"
Write-Host $bar
Write-Host "ZIP  : $zipPath"
Write-Host "SHA  : $zipHash"
Write-Host $bar
Write-Host 'Copy ZIP to USB before leaving the terminal.'

@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  FULLSITE POS -- LOGGED INSTALL WRAPPER
::  Closes gaps #2/#3/#6 of INSTALLER-VERIFICATION.md:
::    backup -> pre-state -> NSIS /S -> post-state -> firewall
::    -> first launch (autostart registration, main.js:822-825)
::  Everything is logged to .\install-logs\install-<timestamp>.log
::
::  Usage (double-click asks for admin):
::      INSTALL.cmd "D:\usb\Fullsite POS Setup 1.3.3.exe"
:: ============================================================

set "INSTALLER=%~1"
if "%INSTALLER%"=="" (
    echo.
    echo [ERROR] Falta el instalador. Uso:
    echo         INSTALL.cmd "ruta\Fullsite POS Setup X.Y.Z.exe"
    echo.
    pause
    exit /b 1
)
if not exist "%INSTALLER%" (
    echo.
    echo [ERROR] No existe el archivo: %INSTALLER%
    echo.
    pause
    exit /b 1
)

:: -- UAC elevation check (fltmc requires admin) ---------------
fltmc >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Requesting administrator privileges...
    echo [INFO] Click "Yes" in the Windows prompt that appears.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\" \"\"%INSTALLER%\"\"' -Verb RunAs"
    exit /b
)

set "SCRIPT_DIR=%~dp0"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
if not exist "%SCRIPT_DIR%install-logs" mkdir "%SCRIPT_DIR%install-logs"
set "LOG=%SCRIPT_DIR%install-logs\install-%TS%.log"
set "FS_LOG=%LOG%"

call :log ============================================================
call :log FULLSITE POS -- INSTALL  %date% %time%
call :log Machine   : %COMPUTERNAME%
call :log Installer : %INSTALLER%
call :log Log       : %LOG%
call :log ============================================================

:: ============================================================
:: 1. PRE-INSTALL BACKUP (aborts install if backup not verified)
:: ============================================================
call :log.
call :log [1/6] Pre-install backup (PRE-INSTALL-BACKUP.ps1)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%SCRIPT_DIR%PRE-INSTALL-BACKUP.ps1' 2>&1 | Tee-Object -FilePath $env:FS_LOG -Append; exit $LASTEXITCODE"
if %errorlevel% neq 0 (
    call :log [ERROR] El respaldo NO se verifico. Instalacion ABORTADA.
    call :log         Revisa la carpeta backups\ y el log: %LOG%
    pause
    exit /b 2
)
call :log [OK] Backup verificado.

:: ============================================================
:: 2. PRE-STATE (registry, processes, ports -- RUN-DIAGNOSTIC style)
:: ============================================================
call :log.
call :log [2/6] Capturando estado PREVIO...
call :state PRE-INSTALL

:: ============================================================
:: 3. RUN NSIS INSTALLER SILENTLY
::    electron-builder NSIS oneClick perMachine supports /S
:: ============================================================
call :log.
call :log [3/6] Ejecutando instalador NSIS en modo silencioso (/S)...
start "" /wait "%INSTALLER%" /S
set "INST_EXIT=%errorlevel%"
call :log Installer exit code: %INST_EXIT%
if %INST_EXIT% neq 0 (
    call :log [ERROR] El instalador devolvio codigo %INST_EXIT%. Revisa el log.
    call :log         El respaldo del paso 1 permite ROLLBACK.ps1 si es necesario.
    pause
    exit /b 3
)

:: ============================================================
:: 4. POST-STATE
:: ============================================================
call :log.
call :log [4/6] Capturando estado POSTERIOR...
call :state POST-INSTALL

:: ============================================================
:: 5. FIREWALL (TCP 7717 Bridge + UDP 5353 mDNS, LocalSubnet)
:: ============================================================
call :log.
call :log [5/6] Configurando firewall (FIREWALL-SETUP.ps1)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%SCRIPT_DIR%FIREWALL-SETUP.ps1' 2>&1 | Tee-Object -FilePath $env:FS_LOG -Append; exit $LASTEXITCODE"
if %errorlevel% neq 0 (
    call :log [WARN] Firewall no quedo configurado. Correr FIREWALL-SETUP.ps1 a mano.
)

:: ============================================================
:: 6. FIRST LAUNCH -- required for autostart registration
::    (main.js:822-825 app.setLoginItemSettings runs at app startup)
:: ============================================================
call :log.
call :log [6/6] Lanzando la app una vez (registra el auto-arranque)...
set "APP_EXE="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$loc=$null;$icon=$null; foreach($b in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')){ foreach($k in @(Get-ChildItem $b -EA SilentlyContinue)){ $p=Get-ItemProperty $k.PSPath -EA SilentlyContinue; if($p -and $p.DisplayName -like 'Fullsite POS*'){ $loc=$p.InstallLocation; $icon=$p.DisplayIcon } } }; if($loc -and (Test-Path (Join-Path $loc 'Fullsite POS.exe'))){ Join-Path $loc 'Fullsite POS.exe' } elseif($icon){ ($icon -split ',')[0].Trim([string][char]34) } else { 'C:\Program Files\Fullsite POS\Fullsite POS.exe' }"') do set "APP_EXE=%%i"

call :log App exe: !APP_EXE!
if exist "!APP_EXE!" (
    start "" "!APP_EXE!"
    call :log [OK] App lanzada. Verificar que abre en kiosco y luego capturar evidencia:
    call :log      RUN-CERT-CAPTURE.cmd install
) else (
    call :log [ERROR] No se encontro el ejecutable instalado en: !APP_EXE!
    call :log         Buscar en "C:\Program Files\Fullsite POS\" y lanzar a mano.
)

call :log.
call :log ============================================================
call :log INSTALACION COMPLETA. Log: %LOG%
call :log Siguiente: RUN-CERT-CAPTURE.cmd install   (verificacion)
call :log Rollback : ROLLBACK.ps1 -BackupDir "backups\[carpeta de hoy]"
call :log ============================================================
echo.
pause
endlocal
exit /b 0

:: ------------------------------------------------------------
:: :log  -- echo to console AND append to %LOG%
::         "call :log." prints a blank line
:: ------------------------------------------------------------
:log
if "%~1"=="." goto :log_blank
echo %*
>> "%LOG%" echo %*
goto :eof
:log_blank
echo.
>> "%LOG%" echo.
goto :eof

:: ------------------------------------------------------------
:: :state <TAG> -- capture registry uninstall entries, Fullsite
::                 processes and ports 7717/7718 into the log
:: ------------------------------------------------------------
:state
set "TAG=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Continue'; $o=@(); $o+='----- %TAG% STATE ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + ' -----'; $o+='[registry uninstall]'; foreach($b in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')){ foreach($k in @(Get-ChildItem $b -EA SilentlyContinue)){ $p=Get-ItemProperty $k.PSPath -EA SilentlyContinue; if($p -and $p.DisplayName -like '*ullsite*'){ $o+=('  ' + $p.DisplayName + ' - v' + $p.DisplayVersion + ' - ' + $p.InstallLocation + ' - ' + $p.UninstallString) } } }; $o+='[processes]'; foreach($pr in @(Get-CimInstance Win32_Process -EA SilentlyContinue)){ if($pr.Name -like '*ullsite*' -or $pr.ExecutablePath -like '*ullsite*' -or $pr.Name -eq 'fingerprint-service.exe'){ $o+=('  pid ' + $pr.ProcessId + ' ' + $pr.Name + ' ' + $pr.ExecutablePath) } }; $o+='[ports 7717/7718]'; foreach($c in @(Get-NetTCPConnection -State Listen -EA SilentlyContinue)){ if($c.LocalPort -eq 7717 -or $c.LocalPort -eq 7718){ $o+=('  ' + $c.LocalAddress + ':' + $c.LocalPort + ' pid ' + $c.OwningProcess) } }; Tee-Object -InputObject ($o -join [Environment]::NewLine) -FilePath $env:FS_LOG -Append"
goto :eof

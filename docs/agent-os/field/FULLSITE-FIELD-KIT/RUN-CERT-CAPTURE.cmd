@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  FULLSITE POS -- CERTIFICATION EVIDENCE CAPTURE LAUNCHER
::  Read-only. No system changes. No prints. No app-state writes.
::  Double-click to run. Click Yes when Windows asks for admin.
::
::  Optional argument: step label, e.g.
::      RUN-CERT-CAPTURE.cmd paso07-orden
::  Without argument the capture is labeled "manual".
:: ============================================================

set "LABEL=%~1"
if "%LABEL%"=="" set "LABEL=manual"

:: -- UAC elevation check --------------------------------------
:: fltmc (filter manager) requires admin; non-zero = not elevated
fltmc >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Requesting administrator privileges...
    echo [INFO] Click "Yes" in the Windows prompt that appears.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\" %LABEL%' -Verb RunAs"
    exit /b
)

:: -- Locate CERT-CAPTURE.ps1 ----------------------------------
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%CERT-CAPTURE.ps1"

if not exist "%PS1%" (
    echo.
    echo [ERROR] CERT-CAPTURE.ps1 not found in:
    echo         %SCRIPT_DIR%
    echo.
    echo  Make sure RUN-CERT-CAPTURE.cmd and CERT-CAPTURE.ps1
    echo  are in the same folder.
    echo.
    pause
    exit /b 1
)

:: -- Run ------------------------------------------------------
echo.
echo ============================================================
echo   FULLSITE POS -- CERTIFICATION EVIDENCE CAPTURE
echo   %date%  %time%
echo   Label  : %LABEL%
echo ============================================================
echo.
echo   Script : %PS1%
echo   Output : %SCRIPT_DIR%evidence\[machine]-[timestamp]-%LABEL%\
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Label "%LABEL%"
set "PS_EXIT=%errorlevel%"

echo.
echo ============================================================
if %PS_EXIT% neq 0 (
    echo   [ERROR] Capture exited with code %PS_EXIT%
    echo.
    echo   Review the output above for details.
    echo   The partial evidence folder may still exist under evidence\
    echo ============================================================
    echo.
    pause
    exit /b %PS_EXIT%
)

echo   Capture complete.
echo.
echo   Next steps:
echo     1. Read the SUMMARY block above (PASS / WARN / FAIL).
echo     2. If any FAIL: stop and follow the P0 template in the runbook.
echo     3. At end of day, copy the whole evidence\ folder to USB.
echo ============================================================
echo.
pause
endlocal

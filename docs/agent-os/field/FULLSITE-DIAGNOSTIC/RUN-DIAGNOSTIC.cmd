@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  FULLSITE POS -- DIAGNOSTIC CAPTURE LAUNCHER
::  Read-only. No system changes.
::  Double-click to run. Click Yes when Windows asks for admin.
:: ============================================================

:: ── UAC elevation check ──────────────────────────────────────
:: fltmc (filter manager) requires admin; non-zero = not elevated
fltmc >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Requesting administrator privileges...
    echo [INFO] Click "Yes" in the Windows prompt that appears.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: ── Locate DIAGNOSTIC-ONLY.ps1 ───────────────────────────────
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%DIAGNOSTIC-ONLY.ps1"

if not exist "%PS1%" (
    echo.
    echo [ERROR] DIAGNOSTIC-ONLY.ps1 not found in:
    echo         %SCRIPT_DIR%
    echo.
    echo  Make sure RUN-DIAGNOSTIC.cmd and DIAGNOSTIC-ONLY.ps1
    echo  are in the same folder.
    echo.
    pause
    exit /b 1
)

:: ── Run ──────────────────────────────────────────────────────
echo.
echo ============================================================
echo   FULLSITE POS -- DIAGNOSTIC CAPTURE
echo   %date%  %time%
echo ============================================================
echo.
echo   Script : %PS1%
echo   Output : %USERPROFILE%\Desktop\fullsite-diag-[timestamp]\
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "PS_EXIT=%errorlevel%"

echo.
echo ============================================================
if %PS_EXIT% neq 0 (
    echo   [ERROR] Diagnostic exited with code %PS_EXIT%
    echo.
    echo   Review the output above for details.
    echo   The partial output folder may still be on the Desktop.
    echo ============================================================
    echo.
    pause
    exit /b %PS_EXIT%
)

echo   Diagnostic complete.
echo.
echo   Next steps:
echo     1. Note the ZIP path and SHA shown above.
echo     2. Copy the ZIP file to your USB drive.
echo     3. Do NOT close this window until the copy is done.
echo ============================================================
echo.
pause
endlocal

@echo off
REM ─── Compilar el servicio de huella (Windows, sin Visual Studio) ───────────────
REM
REM Este .bat es solo el arranque. El trabajo real —validar el DLL autorizado,
REM compilar y escribir el manifiesto— vive en build-fingerprint.ps1, porque
REM PowerShell hashea de forma nativa (Get-FileHash) y el parseo de certutil en
REM batch es fragil y silencioso cuando falla.
REM
REM Uso:  colocar DPUruNet.dll junto a este .bat y correr:
REM         build-fingerprint.bat
REM Salida: fingerprint-service.exe + fingerprint-service.manifest.txt

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-fingerprint.ps1" %*
exit /b %ERRORLEVEL%

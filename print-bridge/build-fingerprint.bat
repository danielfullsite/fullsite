@echo off
REM ─── Compilar el servicio de huella (Windows, sin Visual Studio) ───────────────
REM Usa el compilador de C# que YA viene con Windows (.NET Framework). Requiere que
REM DPUruNet.dll (SDK DigitalPersona U.are.U) esté en esta misma carpeta.
REM
REM Uso:  colocar DPUruNet.dll junto a este .bat y a fingerprint-service.cs, y correr:
REM         build-fingerprint.bat
REM Salida: fingerprint-service.exe (en esta carpeta).

setlocal
cd /d "%~dp0"

set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe

if not exist "%CSC%" (
  echo [ERROR] No se encontro csc.exe ^(.NET Framework^). Instala .NET Framework 4.x.
  exit /b 1
)
if not exist "DPUruNet.dll" (
  echo [ERROR] Falta DPUruNet.dll en esta carpeta ^(SDK DigitalPersona U.are.U^).
  exit /b 1
)
if not exist "fingerprint-service.cs" (
  echo [ERROR] Falta fingerprint-service.cs en esta carpeta.
  exit /b 1
)

echo [build] Compilando fingerprint-service.exe...
"%CSC%" /nologo /r:DPUruNet.dll /out:fingerprint-service.exe fingerprint-service.cs
if errorlevel 1 (
  echo [ERROR] La compilacion fallo.
  exit /b 1
)

echo [OK] fingerprint-service.exe compilado.
echo [siguiente] Copia fingerprint-service.exe + DPUruNet.dll a:
echo             electron-app\fingerprint\   (para empaquetar en la app)
echo             y/o  C:\fullsite\           (para usar en ESTA caja ya mismo)
endlocal

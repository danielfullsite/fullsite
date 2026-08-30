# Servicio de huella — binarios para empaquetar

Deja aquí los dos archivos y el instalador (NSIS) los llevará dentro de la app:

- `fingerprint-service.exe`  — compilado de `print-bridge/fingerprint-service.cs`
- `DPUruNet.dll`             — SDK DigitalPersona U.are.U (HID, propietario)

## Cómo se obtienen
- `DPUruNet.dll`: viene del SDK **DigitalPersona U.are.U** (o ya está en la caja de AMALAY en `C:\fullsite\`).
- `fingerprint-service.exe`: compilar con `print-bridge/build-fingerprint.bat` (usa `csc.exe`, no necesita Visual Studio).

## Qué pasa al instalar la app
`electron-app/main.js` → `startFingerprintService()` copia estos binarios a `C:\fullsite\`
la primera vez (si no existen) y los arranca en `127.0.0.1:7718`. Así **ya no hay que
copiarlos a mano** en cada caja — es el camino clonable a N clientes.

> Estos binarios **NO se commitean** (`.exe`/`.dll` propietario). El `.gitkeep` mantiene la carpeta.
> El build sólo los empaqueta si están presentes localmente al correr `electron-builder`.

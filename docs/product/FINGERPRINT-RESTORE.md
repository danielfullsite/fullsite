# Huella (DigitalPersona) — qué es y cómo reactivarla

> Revisión completa 2026-08-18. Complementa `DESIGN-HUELLAS-PIN.md`.
> **No hay que construir de cero — el servicio ya existió, es NUESTRO, y funcionaba.**

## Qué es el servicio de huella
- Un **servicio C# hecho a la medida** (`fingerprint-service.exe`) que envuelve el **SDK DigitalPersona
  U.are.U** (`DPUruNet.dll`) y el lector **HID DigitalPersona 4500** (USB). Sirve un API HTTP en
  **`127.0.0.1:7718`** con match **1:N** (pon el dedo → sabe cuál mesero).
- `electron-app/main.js` (`startFingerprintService`, ~línea 565) lo **lanza solo** si existen
  `C:\fullsite\fingerprint-service.exe` + `C:\fullsite\DPUruNet.dll`. Si no están → "fingerprint login no disponible".
- El POS (login) lo llama; el KDS/otros vía el proxy `/fp/*` del local-server (7717→7718).

## Historia (del git + notas de campo)
- **2026-07-08** (`eb448e5a`): *"replace WebAuthn with native DigitalPersona fingerprint service"* — **Daniel** metió el cambio al servicio nativo. O sea el `.exe` se construyó por esas fechas (con quien lo haya escrito).
- **2026-07-12** (`docs/customers/amalay/DEBRIEF-JUL12.md`): *"Fingerprint login funciona en Caja (SERVER1) — lector HID DigitalPersona 4500 detectado, huella visible en cold start, autenticación exitosa."* → **FUNCIONABA en AMALAY.**
- `docs/customers/amalay/WANSOFT-EXIT-AUDIT.md`: *"Huella digital: pos_fingerprint_templates, **servicio C# DPUruNet**, proxy Electron."*
- **NO está en el repo** (ni el `.exe` ni la fuente C#). Vive en las cajas (`C:\fullsite\`) y/o en la máquina donde se compiló.
- ⚠️ **Caveat de campo:** un doc marca la huella como "legacy" por **problemas de lectura del lector USB** en AMALAY. O sea, además del `.exe`, hay que revisar la **confiabilidad física del lector 4500**.

## Contrato del servicio (para recompilar si hiciera falta)
`http://127.0.0.1:7718`
- `GET /health` → `{ ok:true, reader:true|false }`
- `GET /enroll?id=<staffId>` (captura 4x) → `{ ok:true, staffId, template? }` | `{ ok:false, error }`
- `GET /identify` (captura 1x, match 1:N) → `{ ok:true, staffId }` | `{ ok:false, error }`
- `GET /list` → lista de enrolados (usado por KDS/monitor)

## ✅ FUENTE RECUPERADA (2026-08-18)
La fuente C# completa (**`print-bridge/fingerprint-service.cs`**, 547 líneas) se recuperó del transcript
de la sesión de julio (`363a0548`) y **YA ESTÁ COMMITEADA** (`be129f8a`). Nunca se había commiteado y
se había borrado del disco. **Ya no dependemos del `.exe` suelto de la caja.**

Del encabezado del archivo:
- **Compila en Windows con UNA línea** (el compilador ya viene con Windows, NO necesita Visual Studio):
  ```
  C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /r:DPUruNet.dll /out:fingerprint-service.exe fingerprint-service.cs
  ```
- **Prerrequisito:** `DPUruNet.dll` (del SDK **DigitalPersona U.are.U** de HID) junto al `.cs`.
- Lee `C:\fullsite\config.json` (restaurant_id, supabaseUrl, supabaseAnonKey).
- Guarda templates **local + Supabase** → multi-terminal.

## Cómo reactivarla — el camino AHORA (fácil)
1. **Compilar** (en cualquier Windows, ~5 min): conseguir `DPUruNet.dll` (SDK U.are.U de HID; probablemente ya está en la caja o en el SDK), poner junto al `.cs`, correr la línea `csc.exe` de arriba → sale `fingerprint-service.exe`.
2. **Instalar**: copiar `fingerprint-service.exe` + `DPUruNet.dll` a `C:\fullsite\` en la caja + `config.json`. Conectar el lector HID 4500 + drivers.
3. **Desplegar el web** (el login ya usa el 7718). La opción "Entrar con huella" sale sola cuando `/health` responde.
4. **Revisar** la confiabilidad del lector USB (los problemas reportados).

> Fallback si se pierde el `.cs` otra vez: está en git (`be129f8a`) y en el transcript. Y un `.exe` de C# se decompila limpio (ILSpy/dnSpy).

## Estado del código (ya listo)
- El login **ya usa el 7718** (se revirtió el desvío a WebAuthn, commit `34618598`).
- La opción "Entrar con huella" **saldrá sola** en cuanto el `.exe` responda en `/health` en la caja.
- Fase 1 (PIN 10 díg + API de staff) lista; falta desplegar + aplicar migración `013`.

## Pendiente / decisión
- **Buscar el `.exe` en la caja de AMALAY** (TeamViewer o el jueves físicamente) → respaldarlo YA.
- **Buscar la fuente C#** (¿en la máquina de Daniel/quien la escribió? ¿sesión de IA?) → commitearla.
- Revisar la **confiabilidad del lector 4500** (los problemas de lectura reportados).

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

## Revisión de la fuente (2026-08-18) — hallazgos
**Veredicto: código completo y sólido.** HttpListener :7718, captura vía DPUruNet, enroll 4x →
`CreateEnrollmentFmd`, identify 1:N con umbral de falso-positivo, thread-safe, config-driven (sin
secretos hardcodeados), templates local (`C:\fullsite\fingerprints\*.b64`) + Supabase. El contrato
concuerda con el POS (`/health` ok, `/identify` staffId, `/enroll` ok). **Compila tal cual** (con DPUruNet.dll).

Cosas a arreglar (no bloquean la compilación, sí el uso correcto):
1. **Tabla correcta = `pos_fingerprint_templates`** (ya existe en prod: `id, client_id, template, updated_at`;
   RLS service_role + authenticated SELECT, **sin anon**). Mi migración `013` creaba `pos_staff_biometrics`
   por error → **corregido** (013 ahora solo amplía el PIN a 10 díg).
2. **✅ Sync multi-terminal — RESUELTO (2026-08-18) del modo correcto.** Antes el servicio usaba la **anon
   key** contra `pos_fingerprint_templates` (que no da acceso anon → 403), así que los templates quedaban
   **solo locales por terminal.** La tentación fácil era meter el **service_role en la caja** — NO se hizo:
   el service_role es la **llave maestra de TODOS los clientes** y jamás debe vivir en una terminal (una caja
   comprometida = toda la BD). En vez de eso:
   - **Nuevo endpoint `POST/GET/DELETE /api/pos/fingerprint`** (`dashboard-app/src/app/api/pos/fingerprint/route.ts`).
     Corre en el servidor, hace la escritura con **service_role del lado servidor**, y se autentica con un
     **secreto acotado** `FINGERPRINT_SYNC_SECRET` (header `x-fp-secret`, ≥16 chars). El biométrico nunca se
     expone al navegador.
   - **El C# ahora sincroniza contra ese endpoint** (no contra Supabase directo). `SyncFromSupabase` (GET),
     `SyncToSupabase` (POST), `SyncDeleteFromSupabase` (DELETE) usan `CreateSyncClient()` con el header
     `x-fp-secret`. Si no hay `syncSecret` configurado → opera **solo local** (no rompe nada).
   - **Config necesaria (Fase 2, en la caja):** `C:\fullsite\config.json` agrega
     `"apiBaseUrl": "https://app.fullsite.mx"` y `"fingerprintSyncSecret": "<secreto>"`. En Vercel:
     env `FINGERPRINT_SYNC_SECRET` (mismo valor, ≥16 chars). Sin esto → local-only, seguro por defecto.
3. **Template sin cifrar** (base64 plano local + Supabase). Es dato biométrico → cifrar at-rest (Fase 3).

**Para compilar/usar hoy:** basta con lo local (no toca el sync). El multi-terminal seguro ya está cableado
(endpoint + C#); solo falta poner `apiBaseUrl`+`fingerprintSyncSecret` en el `config.json` de la caja y el
env en Vercel. Cifrado del template = Fase 3.

## Kit llave-en-mano (2026-08-18) — para que el jueves sea de 10 min

**Hallazgo del checkeo full de git:** la huella **funcionó en las 3 terminales el 12-jul**
(`FIELD-NOTES-PREFLIGHT-JUL12.md`: "Huella visible cold start = PASS" en Caja/Entrada/Escondite).
El `.exe` **nunca estuvo en git** — siempre se puso a mano en `C:\fullsite\`. El código de hoy pega
`127.0.0.1:7718/health` y muestra el botón si responde — **idéntico** al known-good. O sea: cuando no
sale huella, **siempre** es que el servicio 7718 no responde, no el código.

**Bug #1 de campo (mismo síntoma que hoy):** "POS solo PIN, sin huella" → un `start-bridge.bat` en el
Startup de Windows ocupaba el 7717 antes que Electron. Fix: quitarlo del Startup.

**Lo que quedó listo desde aquí (commit del kit):**
1. **`electron-app` empaqueta el servicio** (`build.extraResources` → `fingerprint/`). Al instalar la app,
   `startFingerprintService()` **copia** `fingerprint-service.exe` + `DPUruNet.dll` a `C:\fullsite\` la
   primera vez (si no existen) y los arranca. **Fin del copiar-a-mano** = camino clonable a N clientes.
   *(Los binarios NO se commitean; se dejan en `electron-app/fingerprint/` antes de `electron-builder`.)*
2. **`print-bridge/build-fingerprint.bat`** — compila el `.exe` con `csc.exe` (sin Visual Studio). Necesita
   `DPUruNet.dll` junto al `.cs`.
3. **`print-bridge/install-fingerprint.ps1`** — instala/repara en la caja: copia binarios, **quita el
   `start-bridge.bat` intruso del Startup**, arranca el servicio y hace `/health`. Idempotente.
4. **`main.js` grita** si el 7717 está ocupado por otro proceso (antes lo callaba) → diagnóstico instantáneo.

**Procedimiento jueves (físico en AMALAY):**
1. En la caja: `dir C:\fullsite\fingerprint-service.exe` — ¿sobrevivió al reinstall?
   - **Sí** → correr `install-fingerprint.ps1` (quita `.bat`, arranca, `/health`). Conectar lector. Listo.
   - **No** → poner `DPUruNet.dll` junto al `.cs`, correr `build-fingerprint.bat`, luego `install-fingerprint.ps1`.
2. Copiar los 2 binarios a `electron-app/fingerprint/` y rebuild → de ahí en adelante **toda** instalación los trae.

## Estado del código (ya listo)
- El login **ya usa el 7718** (se revirtió el desvío a WebAuthn, commit `34618598`).
- La opción "Entrar con huella" **saldrá sola** en cuanto el `.exe` responda en `/health` en la caja.
- Fase 1 (PIN 10 díg + API de staff) lista; falta desplegar + aplicar migración `013`.

## Pendiente / decisión
- **Buscar el `.exe` en la caja de AMALAY** (TeamViewer o el jueves físicamente) → respaldarlo YA.
- **Buscar la fuente C#** (¿en la máquina de Daniel/quien la escribió? ¿sesión de IA?) → commitearla.
- Revisar la **confiabilidad del lector 4500** (los problemas de lectura reportados).

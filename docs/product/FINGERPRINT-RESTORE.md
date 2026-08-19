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

## Cómo reactivarla — caminos (rápido → lento)
1. **Localizar el `.exe` en las cajas (RÁPIDO, ~30 min).** En la caja de AMALAY (SERVER1, y quizá PDV2/PDV3),
   revisar `C:\fullsite\fingerprint-service.exe` + `DPUruNet.dll`. Estaban ahí el 12-jul. Si están:
   copiarlos, **respaldarlos en el repo** (como artefacto/release, no en git normal) + documentar hash/origen.
   Luego basta con conectar el lector + desplegar el web (el login ya usa el 7718).
2. **Encontrar la FUENTE C#** (donde se compiló ~8-jul) → recompilar y **commitear la fuente** para no volver a perderla.
3. **Rehacer el servicio** desde el contrato de arriba (con el SDK U.are.U de HID) — ~2-4 semanas, pero sabemos exactamente qué debe hacer. Solo si 1 y 2 fallan.

## Estado del código (ya listo)
- El login **ya usa el 7718** (se revirtió el desvío a WebAuthn, commit `34618598`).
- La opción "Entrar con huella" **saldrá sola** en cuanto el `.exe` responda en `/health` en la caja.
- Fase 1 (PIN 10 díg + API de staff) lista; falta desplegar + aplicar migración `013`.

## Pendiente / decisión
- **Buscar el `.exe` en la caja de AMALAY** (TeamViewer o el jueves físicamente) → respaldarlo YA.
- **Buscar la fuente C#** (¿en la máquina de Daniel/quien la escribió? ¿sesión de IA?) → commitearla.
- Revisar la **confiabilidad del lector 4500** (los problemas de lectura reportados).

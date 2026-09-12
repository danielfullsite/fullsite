# Electron 44 / builder 26 — evidencia de migración

Fecha: 2026-09-12  
Base: `codex/bug-sweep-20260912` en `2b2750dd`  
Rama aislada: `codex/electron-upgrade-20260912`

## Resultado

La migración es técnicamente viable para el objetivo de campo actual, Windows
10/11 x64. Electron quedó fijado en `44.3.0` y electron-builder en `26.15.3`.
No se publicó, firmó, instaló ni ejecutó ningún artefacto en AMALAY.

Fuentes revisadas:

- [Electron 44](https://www.electronjs.org/blog/electron-44-0)
- [cambios incompatibles de Electron](https://www.electronjs.org/docs/latest/breaking-changes)
- [documentación de electron-builder v26](https://www.electron.build/v26/docs/configuration/)

Electron 44 embebe Chromium 152 y Node 24. Sus cambios pertinentes aquí son:
macOS mínimo 13, retiro de Windows x86, retiro del acceso renderer a `clipboard`,
retiro de `PrinterInfo.isDefault` y la firma nueva del evento `console-message`.
Fullsite ya construía Windows x64, no usa `clipboard` ni `BrowserView`, y mantiene
`nodeIntegration: false` con `contextIsolation: true`.

Cambios de compatibilidad aplicados:

- `PrinterInfo.isDefault` ya no se lee durante provisioning. La interfaz sólo usa
  la cantidad de impresoras; conserva `name` y `displayName`.
- El diagnóstico KDS consume `event.message` en `console-message`.
- Los workflows Electron, offline y multi-terminal usan Node 24 en vez de Node 20.
- El requisito de herramientas queda explícito como Node `>=22.12.0`.
- Las tres configuraciones usan `icon.png` para macOS. El primer dry-run descubrió
  que builder 26 rechaza `icon.ico` al generar ICNS.

## Seguridad de dependencias

`npm audit --package-lock-only --json` sobre el lock original:

- 14 vulnerabilidades: 1 crítica y 13 altas.
- Incluía advisories directos de Electron y cadenas vulnerables de
  `electron-builder` / `app-builder-lib` / `builder-util-runtime` / `tar`.

Después de la migración y de un `npm ci` limpio:

- 0 vulnerabilidades.
- `@electron/rebuild 4.2.0`, `builder-util-runtime 9.7.0`, `tar 7.5.22` y
  `@electron-internal/extract-zip 1.0.5`.

## Pruebas

- Suite Electron/local-server/offline UI: **663/663**.
- Deployment kit: **5/5**.
- Smoke con binario Electron real: Electron `44.3.0`, Chromium `152.0.7977.78`,
  Node `24.20.0`; creación de BrowserWindow oculta, evento de consola y enumeración
  de impresoras correctos.
- `npm ci` desde lock limpio: correcto.
- Build estático sintético: 321 archivos, 33 rutas, manifiesto verificado. Es sólo
  laboratorio y no puede confundirse con un candidato de campo.

Empaquetado sin credenciales:

- POS Windows x64 unpacked: PE x64 y ASAR inspeccionado; 473 archivos de app y 19
  rutas/módulos obligatorios presentes.
- KDS Windows x64 unpacked: PE x64; `preload-kds.js`, runtime local, updater y UI
  presentes en ASAR.
- POS macOS x64 unpacked: Mach-O x86_64, ASAR correcto y sin firma.
- NSIS sintético x64: 113,498,055 bytes, SHA-256
  `b3523aa5dd22ab28f5cabb0fc94b4f9b2ad63b81797cc95cf6a289275cf38daa`.
  No fue instalado ni ejecutado.

## Límites antes de campo

Esto valida código, dependencias y empaquetado; no sustituye aceptación física.
Antes de promover un release se necesita:

1. Ejecutar el portable en una Windows 10/11 x64 de laboratorio y probar arranque,
   POS, KDS, LAN, impresión, cajón, huella y reinicio sin internet.
2. Confirmar el auto-update de un piloto y su rollback con paquetes firmados.
3. Reconstruir con el UI y configuración pública reales; el bundle usado aquí es
   sintético.
4. Incluir y probar los binarios propietarios de huella, ausentes del checkout.
5. Mantener equipos macOS de prueba en Ventura (13) o posterior.

Hasta completar ese piloto, la migración es integrable al código pero no es una
autorización de despliegue a terminales en operación.

# Paquete candidato de Windows

Estado: preparación local del candidato. No cambia versión, no publica release, no modifica configuración de AMALAY y no activa `localAuthorityEnabled` ni `business_sync`.

## Contenido del instalador

Los tres builders —default POS, POS explícito y KDS explícito— usan la misma lista permitida: main, preloads, HTML del asistente y fallback, iconos, runtime del servidor local, contrato de permisos, KDS local, runtime del paquete UI, paquete UI íntegro y updater. Electron Builder agrega `package.json` y las dependencias de producción. Se excluyen pruebas, laboratorio, harness de latencia, logs y `.env`; los perfiles, configuración de terminal y registros de negocio no tienen un patrón de inclusión.

`beforePack` verifica todos los hashes del paquete `ui-bundle`, sus rutas HTML/RSC y recursos. Ejecutar Electron Builder directamente también pasa por ese control. Los scripts npm construyen la UI primero; Windows declara `--x64 --publish never` para que un Mac arm64 no produzca por defecto Windows arm64 ni publique accidentalmente.

`build-offline-ui.cjs` exige `NEXT_PUBLIC_SUPABASE_URL` HTTPS y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Son configuración pública del navegador, incorporada durante la compilación. No se toman de `.env` del checkout y no se incluyen service role, PIN, credencial LAN ni configuración de restaurante. Un paquete compilado con configuración sintética es exclusivamente laboratorio; cambiar variables después de compilar no lo convierte en candidato instalable.

## Construcción local reproducible

Desde `electron-app`, después de instalar las dependencias de Electron y dashboard y definir explícitamente la configuración pública del destino:

```sh
npm run build:win
```

Esto produce el instalador POS default de la versión declarada en `package.json`; no publica. Para los productos explícitos, después de `npm run build:ui`:

```sh
npx electron-builder --win --x64 --config electron-builder-pos.json --publish never
npx electron-builder --win --x64 --config electron-builder-kds.json --publish never
```

Los workflows locales ahora instalan también las dependencias de dashboard y compilan la UI. Exigen variables GitHub públicas `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`; su existencia no se ha confirmado remotamente. La publicación por etiqueta conserva su control existente y no se ha ejecutado. Los artefactos del workflow de release se toman de `dist-pos` y `dist-kds`, donde los builders realmente escriben.

## Verificación aislada del paquete

Desde la raíz, usando una UI ya construida:

```sh
node electron-app/scripts/verify-windows-package.cjs /ruta/absoluta/ui-bundle
```

El script prepara una copia temporal con los archivos permitidos e instala allí las dependencias de producción desde lock. Por defecto construye **sólo un directorio Windows x64 sin instalador**, fuerza `--publish never` y descarta credenciales heredadas de firma/publicación. Inspecciona el encabezado PE de la aplicación, el contenido real de `app.asar`, módulos indispensables y la revisión de UI. También verifica que la lista permitida de POS/KDS/default rechace rutas de perfiles y datos locales. Conserva evidencia en un directorio nuevo `output/closure/windows-package-smoke`; rechaza sobrescribir un candidato anterior.

El resultado se marca `NOT-FOR-INSTALLATION`. No ejecuta Windows, no instala en la Mac ni transfiere datos a AMALAY. Una carpeta empaquetada correctamente todavía necesita la prueba del instalador y del runtime en Windows.

La opción explícita `--installer-lab` construye un NSIS **técnico y sintético** con versión temporal `1.4.1-offline.1`, nombre `Fullsite POS LAB SYNTHETIC` y appId independiente `mx.fullsite.pos.lab`. No cambia la versión del repositorio. Mantiene publicación y firma deshabilitadas y genera hash SHA256 del artefacto. No debe instalarse en AMALAY ni anunciarse como su candidato.

## Resultado ejecutado

El directorio Windows x64 pasó la inspección PE y ASAR: 17 archivos/módulos indispensables y ningún perfil, configuración de instalación, log, prueba o laboratorio dentro de la app. Electron real en esta Mac también verificó e instaló el paquete UI desde `app.asar` a un perfil temporal, y cargó el módulo del servidor local y `electron-updater`. Esa verificación cubre acceso a ASAR; no equivale a ejecutar Windows.

El laboratorio encontró dos errores de preparación: el hook de Electron Builder 25 expone el directorio fuente en `context.packager.info.appDir`, y el `node_modules` compartido no contenía `electron-updater` aunque estaba en el lock. Se corrigió el acceso al contexto y el script instala 23 dependencias de producción en su propio staging; no altera dependencias del checkout en uso.

Se reconstruyó el NSIS técnico final de 83,875,655 bytes, sin firma ni publicación, en `output/closure/windows-package-smoke/1788599079771`. Nombre: `Fullsite-POS-LAB-SYNTHETIC-1.4.1-offline.1-x64.exe`. SHA256:

```text
7b91c50894e23879d019b9314dfe9896bfd1a732486f6e073f0f0db7b0867cd2
```

UI sintética final incorporada: `956010a8d72fb426125651b64e112e08c0c8c51c2c3a5245b09216cd2414e9fb`. Evidencia estructurada en `verification.json`; log en `output/closure/windows-lab-installer-final.log`. Se compararon los hashes de 43 archivos de runtime y contrato de permisos dentro del ASAR contra el código final del checkout; coincidieron todos, incluidos los bloqueos financieros añadidos durante la revisión. La comparación quedó en `runtime-source-verification.json` junto al instalador. La verificación de lectura e instalación temporal del paquete desde ASAR se repitió sobre este artefacto final (`output/closure/windows-final-asar-runtime.log`). El instalador no fue ejecutado en Windows.

## Disponibilidad comprobada en esta Mac

El 5 de septiembre de 2026: host arm64, Node `24.14.1`, Electron `33.4.11`, Electron Builder `25.1.8`. Existe caché de Electron `win32-x64` y `win32-arm64`; se debe seleccionar x64 explícitamente para las terminales Intel/AMD. Wine `4.0.1` y NSIS `3.04` de la caché ejecutan sus consultas de versión. NSIS necesita su directorio de recursos mediante `NSISDIR`; ejecutarlo directamente sin eso falla al buscar el stub. Es disponibilidad de herramientas, no evidencia de funcionamiento de la aplicación en Windows.

La edición de recursos Windows utiliza Wine en este host; la firma requiere certificado y configuración de firma del destino, que esta verificación no solicita ni consulta. No se ha certificado firma Authenticode, reputación SmartScreen, instalación/elevación NSIS, migración y conservación de userData en Windows, drivers de impresora ni huella. El instalador configurado es por máquina y de un clic: esa parte debe probarse con privilegios reales en Windows antes del corte.

La guía oficial de [contenido de Electron Builder](https://www.electron.build/contents/) describe la selección de archivos. Para este candidato también se revisó el código instalado de `app-builder-lib/out/fileMatcher.js`, `winPackager.js` y `targets/nsis/NsisTarget.js`, para no asumir el comportamiento de otra versión de la herramienta.

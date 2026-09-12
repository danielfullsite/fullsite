# Barrido 3 — Instalador / arranque / actualización (Electron + Pedro, Windows)

Base: worktree solo-lectura `wt-barrido3` = `origin/main` `f9f8965c`.
Contraste: `docs/pos/INSTALACION-CANDIDATO-2026-09-11.md` (§1.3, §2, §3, §5, §6).
Todas las rutas son relativas a la raíz del repo salvo donde diga `electron-app/`.

---

### [P0] El instalador que se PUBLICA no lleva `build-info.json`: el sello de identidad no viaja

`electron-app/electron-builder-pos.json:8-9` · `electron-app/electron-builder-kds.json:8-9` ·
`electron-app/package.json:30` · `.github/workflows/electron-release.yml:95-103` ·
`electron-app/scripts/verify-windows-package.cjs:28-29`

**confianza 0.9** (comprobado ejecutando la comparación, no leyendo)

**escenario.** `npm run sellar` escribe `electron-app/build-info.json` con el commit. La lista
`files` de `package.json.build` lo incluye (línea 30), pero las dos configuraciones dedicadas
**no**: su `files` es idéntica salvo por esa entrada. Y `electron-release.yml` compila con
`--config electron-builder-pos.json` / `--config electron-builder-kds.json`, que reemplazan el
bloque `build` de `package.json`. Resultado: el `.exe` publicado sella un archivo que nunca se
empaqueta, `core/identidad-de-build.js:44-49` no lo encuentra y `/health` responde
`1.4.0 (sin sellar)`.

Eso rompe dos cosas del procedimiento de instalación:
- §1.3 («`build-info.json` dentro del ASAR con el commit exacto, `limpio: true`») es imposible
  de cumplir con el artefacto de release.
- §2 y el rollback §6 dependen de «misma versión en las cuatro terminales», y sin sello dos
  ejecutables distintos dicen exactamente `1.4.0` (ver P1 de versión congelada).

Colateral: `verify-windows-package.cjs:29` hace
`assert.deepEqual(config.files, pkg.build.files, 'Every product must use the same runtime allowlist')`
sobre las tres configuraciones → **ese humo local ya no puede pasar**; truena antes de empaquetar.

No aplica al instalador de CI `electron-build.yml:120-123`, que compila sin `--config` (usa
`package.json.build`) y sí incluye el sello — es decir, el candidato `4e81b93e` que el doc §7
declara «el candidato» tiene sello, y el flujo de release no. Dos artefactos con identidad
distinta saliendo del mismo commit.

**cómo probar.**
```
cd electron-app && node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('package.json')).build.files;for(const n of ['electron-builder-pos.json','electron-builder-kds.json'])console.log(n,JSON.parse(f.readFileSync(n)).files.length,p.length)"
# y sobre un .exe instalado:  npx @electron/asar list "C:\Program Files\Fullsite POS\resources\app.asar" | findstr build-info
```

**fix mínimo.** Añadir `"build-info.json"` a `files` en `electron-builder-pos.json` y
`electron-builder-kds.json` (segunda entrada, junto a `main.js`). Alternativa mejor: que ambos
usen `"extends": "package.json"` para que no vuelvan a divergir.

---

### [P1] Si Pedro no arranca, una terminal `kds_only` se queda en pantalla de error a pantalla completa

`electron-app/main.js:313-318` · `electron-app/main.js:1133-1152` ·
`electron-app/local-server/index.js:884-888` · `electron-app/local-server/adapters/storage/ndjson.js` (`load()`, ~línea 70)

**confianza 0.8**

**escenario.** `startLocalServer()` envuelve todo en `try/catch` y ante cualquier fallo sólo
imprime (`[main] Local server failed to start:` / `Port 7717 already in use — skipping`),
dejando `localServer = null` sin propagar nada a la UI. Los fallos posibles después de
actualizar no son teóricos, están en el mismo árbol:

- `EVENT_LOG_CORRUPT` desde `ndjson.load()` (cualquier línea comprometida del `events.ndjson`
  heredado — es justo el caso que §5 del doc de instalación manda diagnosticar);
- `LOCAL_AUTHORITY_CUTOVER_REQUIRED` (`index.js:884-888`) si el log ya trae escritura de Caja y
  el `config.json` de esa terminal quedó sin `localAuthorityEnabled` — exactamente el riesgo de
  un `config.json` pisado o restaurado de un respaldo viejo;
- `EADDRINUSE` con un Pedro zombi de la versión anterior todavía escuchando 7717.

En modo caja el POS abre igual (degradado: sin impresión, sin KDS, sin reenvío). En
`kds_only` el flujo hace `createKdsWindow(..., 'http://127.0.0.1:7717/kds')` y `return`: si el
servidor local de ESA máquina no levantó, la pantalla de cocina carga una URL muerta →
`ERR_CONNECTION_REFUSED` a pantalla completa en modo kiosco. La única salida es el
`Ctrl+Shift+Q` de `main.js:1059`, que nadie en cocina conoce. Es la prueba #1 de la matriz §3
(«arranque en frío sin pantalla negra») fallando por una causa que el código ya contempla.

Con `EADDRINUSE` el síntoma es peor que negro: la ventana carga el KDS del OTRO proceso, que
puede ser la versión anterior y otra identidad.

**cómo probar.** En una terminal `kds_only`, meter una línea basura al final de
`%APPDATA%\fullsite-pos\events.ndjson` **seguida de salto de línea** (un final sin `\n` se
trata como cola rota y se trunca, no sirve para reproducir) y arrancar. Alternativa: ocupar el
7717 con `node -e "require('http').createServer().listen(7717)"` antes de abrir Electron.

**fix mínimo.** En `main.js`, tras `await startLocalServer()`: si `localServer` es `null`,
cargar `offline.html` con el motivo (y el `console.error` ya capturado) en vez de la URL del
KDS; y no tragar `EADDRINUSE` — si el `/identity` del proceso que ocupa el puerto no es el
propio, abortar con mensaje.

---

### [P1] Producción y candidato dicen `1.4.0`: sin sello, la identidad del build no es verificable, y el auto-update no dispara

`electron-app/package.json:3` · `electron-app/local-server/core/identidad-de-build.js:8-12` ·
`electron-app/local-server/update/politica.js` (`compararVersiones`)

**confianza 0.8**

**escenario.** El propio comentario de `identidad-de-build.js:8-10` lo dice: «`package.json`
dice 1.4.0 tanto en producción como en el candidato». La solución diseñada fue el sello — que
el release no empaqueta (P0). Encima, `electron-updater` compara versiones: dos releases con
la misma versión no se propagan, así que el candidato sólo puede instalarse a mano y el
mecanismo de canal/piloto de `politica.js` queda inerte para este salto.

**cómo probar.** `curl http://127.0.0.1:7717/health` en dos terminales con ejecutables
distintos → misma cadena. Y comparar SHA-256 de los `.exe` (paso §1.3): distintos, con el
mismo número dentro.

**fix mínimo.** Subir `version` en `electron-app/package.json` (y `package-lock.json`, que
`local-server/tests/electron-package-identity.test.js:22-25` exige que coincidan) para el
candidato. Es el cambio de una línea que vuelve verificable todo el §1.3.

---

### [P2] El build dedicado de KDS no se reconoce a sí mismo: la detección por nombre de producto no puede ser cierta

`electron-app/main.js:1054` · `electron-app/electron-builder-kds.json:3` ·
`electron-app/scripts/verify-windows-package.cjs:56-57`

**confianza 0.7**

**escenario.** `if (app.getName() === 'Fullsite KDS' || appConfig.terminal_role === 'kds')`.
`app.getName()` lee `productName` del `package.json` empaquetado, y ahí `productName` sólo
existe **dentro del bloque `build`**, no en la raíz; en el config de KDS ni siquiera está en
`package.json`. Sin `extraMetadata`, el `package.json` que viaja en el ASAR no tiene
`productName` de raíz → `app.getName()` devuelve `fullsite-pos` y la primera condición nunca
es verdadera. La única red que queda es `terminal_role === 'kds'` del `config.json`.

Consecuencia práctica: una máquina con el instalador KDS pero con `config.json` traído de un
respaldo con `terminal_role: "pos"` abre la ventana del POS y arranca un segundo Pedro con rol
de POS — el escenario «dos Pedros por rol mal puesto».

**Intento de refutación:** `verify-windows-package.cjs:56-57` hace `delete pkg.build` y escribe
el `package.json` de la etapa sin `productName`, lo que confirma el comportamiento en esa ruta.
No pude comprobar en un Windows real si electron-builder 25 inyecta `productName` en el
`package.json` del ASAR; de ahí 0.7 y no 0.85.

**cómo probar.** Instalar el KDS dedicado con un `config.json` de rol `pos` y ver si abre POS o
cocina. O desde la consola de Electron: `require('electron').app.getName()`.

**fix mínimo.** Añadir `"extraMetadata": { "productName": "Fullsite KDS" }` al config de KDS —
o borrar la rama por nombre y declarar que el rol del `config.json` es la única fuente.

---

### [P2] `C:\fullsite` sigue siendo ruta dura para la huella, y el instalador es `perMachine`

`electron-app/main.js:661-662` · `electron-app/main.js:681-684` · `electron-app/main.js:708` ·
`electron-app/main.js:359-361` · `electron-app/package.json` (`nsis.perMachine: true`, `oneClick: true`)

**confianza 0.75**

**escenario.** La app se instala en Program Files (perMachine) pero copia el servicio de huella
desde `process.resourcesPath/fingerprint` a `C:\fullsite\` con `fs.mkdirSync('C:\\fullsite')` y
lo lanza con `cwd: 'C:\\fullsite'`. Crear un directorio en la raíz de `C:` requiere permisos que
un usuario de mostrador no siempre tiene (y que algunos antivirus bloquean por política). El
`try/catch` de alrededor hace que el fallo sea silencioso: la terminal queda sin huella y el
log lo dice una vez, en una consola que nadie mira. Es coherente con lo que el doc §3 fila 10
ya marca como bloqueo conocido, pero la causa que se asume («faltan los binarios») no es la
única: también falla cuando **sí** están y no se pueden escribir.

Además la ruta no es configurable por terminal ni por sucursal — no es clonable a una máquina
con otra letra de unidad o un perfil restringido.

**cómo probar.** Instalar con un usuario estándar (no admin) en un Windows con la raíz de `C:`
protegida y buscar `[fingerprint] Servicio instalado desde el paquete` en el log; luego
`dir C:\fullsite`.

**fix mínimo.** Usar `app.getPath('userData')/fingerprint` como destino, con `C:\fullsite` sólo
como origen de migración (es exactamente lo que ya se hizo con `config.json` y `printers.json`
en `main.js:95` y `:178`).

---

### [P2] El `config.json` legacy puede resucitar una identidad vieja después de reinstalar, en silencio

`electron-app/main.js:126-150` · `electron-app/local-server/config-schema.js:117-125`

**confianza 0.7**

**escenario.** `loadAndValidateConfig()` intenta `userData/config.json`; si existe pero **no
valida** (un esquema que cambió, un archivo a medias por un apagón, un respaldo restaurado
parcialmente), sigue al paso 2 y lee `C:\fullsite\config.json`, lo auto-migra y **lo escribe
encima del primario**. `fromLegacy` rellena el rol con `'server_pos'` cuando el valor no está
en `VALID_ROLES` (`config-schema.js:117-118`). O sea: una terminal secundaria cuyo config nuevo
se corrompió puede reaparecer como **caja** apuntando al `restaurantId` de una instalación
anterior, sin preguntar nada. La única señal es una línea de `console.log`.

Esto cruza con la §1.1 del doc, que manda respaldar ambas rutas antes de instalar: el respaldo
de `C:\fullsite\` es precisamente el que puede ganarle al config bueno.

**cómo probar.** Poner un `C:\fullsite\config.json` viejo (otro `restaurantId`, sin
`terminal_role`), truncar el `userData\config.json` y arrancar. Leer `/identity` de Pedro.

**fix mínimo.** Si `userData/config.json` **existía** (aunque inválido), no caer a legacy: ir a
`NOT_PROVISIONED` y abrir el asistente. Y si el `restaurant_id` migrado difiere del que el
primario traía, exigir confirmación explícita en el wizard.

---

### [P2] La compactación achica el archivo, no el arranque: el log completo sigue viviendo en RAM

`electron-app/local-server/index.js:884` · `electron-app/local-server/adapters/storage/ndjson.js:85-94` ·
`ndjson.js:105-112` (`_adopt`) · `ndjson.js:216`

**confianza 0.75**

**escenario.** La compactación resuelve el problema de **bytes** (y con él el
`ERR_STRING_TOO_LONG` que documenta el propio archivo), pero `load()` conserva el arreglo
completo de eventos, `_adopt` construye además un `Map` con **una entrada por evento**
(`_processedCommands`), e `index.js:884` hace `readAfter(0)` y reproduce todo. El costo de
arranque y la memoria siguen creciendo linealmente con los meses — y el doc §2 ya admite
«1-2 min» en la primera carga sin decir cuál es el techo. No hay archivado por día de venta ni
por corte.

**cómo probar.** Generar un `events.ndjson` sintético con 300k eventos no compactables (no
`STATE_SYNC`) y medir `[server] Replaying N events` hasta `[server] State ready.` y el RSS del
proceso.

**fix mínimo.** Medir y publicar el umbral en el doc de instalación; después, archivar el log
por corte (mover a `events-YYYYMMDD.ndjson` y arrancar desde un snapshot sellado).

---

## Descartados

- **`electron-builder-kds.json` sin `extraResources` de la huella.** Intencional: un KDS no lee
  huellas, y `local-server/tests/instalador-lleva-la-huella.test.js:50` sólo exige la copia en
  `electron-builder-pos.json` y `package.json`.
- **«El test de `/health` exige 1.5.0 y `package.json` dice 1.4.0».** Refutado ejecutándolo: el
  test inyecta `version: '1.5.0'` en su servidor falso
  (`local-server/tests/health-dice-si-esta-emparejada.test.js:25`). Corrí
  `node --test local-server/tests/health-dice-si-esta-emparejada.test.js` → 8/8 pasan. Lo que sí
  queda es que la versión real no subió (ver P1).
- **Reescritura no atómica del log al compactar.** Refutado: `ndjson.js:100-107` escribe a
  `.tmp` con `fsync`, hace `rename` y luego `syncDirectory`.
- **Escritura en Program Files.** Refutado para config, impresoras, cola y log: todos salen de
  `app.getPath('userData')` (`main.js:95`, `main.js:178`, `main.js:269`). La excepción es la
  huella (ver P2 de `C:\fullsite`).
- **Dos Pedros en la misma máquina por doble arranque.** Hay `requestSingleInstanceLock()`
  (`main.js:1186-1193`) y el `userData` separado sólo se aplica en el laboratorio
  (`main.js:38-52`, detrás de una variable de entorno).
- **Autoupdate a media operación.** No lo encontré: `local-server/update/politica.js`
  (`puedeInstalarAhora`) falla cerrado ante snapshot ausente o incompleto, exige turno y mesas,
  `commands_in_flight === 0`, almacenamiento durable, autoridad de Caja y cola de impresión
  resuelta; `main.js:1104-1126` sólo instala con ese permiso y consulta
  `local_server_blocked_versions` con timeout, lanzando si no puede consultar. Es de las piezas
  mejor argumentadas del árbol.
- **`ws://` vs `http` para ORDER_SENT / mixed content.** No revisado a fondo en este barrido;
  no afirmo nada sobre ello.

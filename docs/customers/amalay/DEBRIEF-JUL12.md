# POST-FIELD-TEST DEBRIEF — AMALAY Jul 12, 2026

> Sesion fisica domingo. 3 terminales POS + 1 KDS configurados via TeamViewer.
> Duracion aprox: 4+ horas (llegada AMALAY ~17:00, ultimo commit 21:29).
> Operador remoto: Claude. Operador fisico: Daniel Ramonfaur.

---

## CRONOLOGIA DE INCIDENTES

### 1. Caja fingerprint PIN-only

| Campo | Valor |
|---|---|
| Timestamp | ~17:00–17:30 |
| Observed | POS muestra solo campo PIN, no aparece opcion de huella digital |
| Initial hypothesis | Fingerprint service no esta corriendo o no detecta lector HID |
| Evidence | `netstat` o health check: puerto 7717 ocupado por proceso externo, 7718 sin respuesta |
| Real root cause | `start-bridge.bat` en Windows Startup lanzaba `node bridge.js` standalone en puerto 7717 ANTES de que Electron arrancara. Bridge standalone no tiene proxy /fp/ → fingerprint service nunca se expone |
| Fix | Eliminar start-bridge.bat del Startup folder en las 3 terminales |
| Artifact/commit | Config local Windows, no commit |
| Physical validation | PASS — huella visible en cold start despues de eliminar .bat |
| Remaining risk | Si alguien re-agrega el .bat al Startup, regresa el problema |

### 2. Standalone bridge ocupando 7717

| Campo | Valor |
|---|---|
| Timestamp | ~17:00–17:30 (mismo incidente que #1) |
| Observed | Bridge HTTP en 7717 responde pero /fp/* devuelve 404 |
| Initial hypothesis | Bridge corriendo pero fingerprint service caido |
| Real root cause | El bridge standalone (bridge.js via .bat) no tiene el proxy /fp/ que si tiene main.js del Electron app. Electron ve EADDRINUSE y dice "external bridge running, skipping" — nunca levanta su propio bridge con /fp/ proxy |
| Fix | Eliminar start-bridge.bat; Electron ahora es el unico que levanta bridge con /fp/ proxy |
| Artifact/commit | Config local Windows |
| Physical validation | PASS — /fp/health responde 200 despues del fix |
| Remaining risk | Ninguno si .bat no se restaura |

### 3. /fp/health "Ruta no permitida"

| Campo | Valor |
|---|---|
| Timestamp | ~17:30 |
| Observed | Navegador o health check a localhost:7717/fp/health devuelve error "ruta no permitida" |
| Initial hypothesis | Fingerprint service no esta corriendo |
| Real root cause | Mismo que #2: bridge standalone sin proxy /fp/. Cuando Electron toma el puerto, el proxy funciona |
| Fix | Mismo que #2 |
| Artifact/commit | N/A |
| Physical validation | PASS post-fix |
| Remaining risk | N/A |

### 4. Entrada como old Fullsite baseline

| Campo | Valor |
|---|---|
| Timestamp | ~18:00 |
| Observed | Daniel pidio comparar build viejo vs nuevo. Entrada (PDV3) tenia build anterior funcionando |
| Initial hypothesis | N/A — se uso como baseline de referencia |
| Evidence | Extraccion de app.asar de Entrada para comparar codigo efectivo: build viejo tenia STATIONS hardcoded en main.js, sin loadStations(), sin array support |
| Real root cause | N/A — ejercicio de baseline comparison |
| Fix | N/A |
| Artifact/commit | Comparativa documentada en FIELD-NOTES |
| Physical validation | Entrada usada como baseline para validar que new build es superset |
| Remaining risk | Entrada quedo con build viejo hasta que se instale el nuevo |

### 5. Old hardcoded STATIONS vs new dynamic printers.json

| Campo | Valor |
|---|---|
| Timestamp | ~18:00–18:30 |
| Observed | Build viejo (Jul 8): `STATIONS = { cocina: {host:'192.168.1.21'}, barra: {host:'192.168.1.30'}, caja: {names:['TICKET','EC01','EC TICKET']} }` hardcoded. Build nuevo: lee de printers.json |
| Initial hypothesis | Dynamic config es mejor — permite cambiar IPs sin rebuild |
| Evidence | /health endpoint del new build mostraba station names como "port", "stations", "default" en vez de "cocina", "barra", "caja" |
| Real root cause | loadStations() hacia `return data` en vez de `return data.stations || data` — retornaba el wrapper object {port, stations, default} completo como si fueran stations |
| Fix | `return data.stations || data` |
| Artifact/commit | `6e07167` fix(electron): loadStations parses wrapper printers.json correctly |
| Physical validation | PASS — /health muestra cocina, barra, caja correctamente post-fix |
| Remaining risk | Si printers.json no tiene key "stations", fallback a data directo funciona |

### 6. loadStations() wrapper parsing bug

| Campo | Valor |
|---|---|
| Timestamp | ~18:30–19:00 |
| Observed | /health mostraba `port → undefined:undefined`, `stations → [object Object]`, `default → tickets` como station names |
| Initial hypothesis | printers.json schema incorrecto |
| Real root cause | loadStations() retornaba `{port:7717, stations:{cocina:..., barra:...}, default:"tickets"}` completo. El bridge iteraba esas keys como station names |
| Fix | Commit `6e07167`: `return data.stations \|\| data` |
| Artifact/commit | `6e07167` |
| Physical validation | PASS |
| Remaining risk | Sin schema validation — un printers.json malformado no da error claro |

### 7. Cocina fria + caliente multi-target

| Campo | Valor |
|---|---|
| Timestamp | ~19:00–19:30 |
| Observed | Comanda a cocina solo imprime en una impresora. AMALAY tiene DOS impresoras de cocina: fria (192.168.1.21) y caliente (192.168.1.40) |
| Initial hypothesis | printers.json necesita soportar multiples destinos por station |
| Evidence | printers.json de Caja: `"cocina": [{"type":"tcp","host":"192.168.1.21","port":9100}, {"type":"tcp","host":"192.168.1.40","port":9100}]` — formato array |
| Real root cause | printToStation() no manejaba Array.isArray(cfg). Intentaba `cfg.host` sobre un array → undefined |
| Fix | Added Array.isArray(cfg) check: itera sobre todos los printers del array, error solo si TODOS fallan |
| Artifact/commit | `2932000` fix(electron): support array of printers per station |
| Physical validation | PASS — comanda imprime en AMBAS impresoras de cocina |
| Remaining risk | Si una impresora esta caida, la otra sigue imprimiendo (graceful degradation). Si ambas caidas, error |

### 8. Windows vs USB printer schema mismatch

| Campo | Valor |
|---|---|
| Timestamp | ~19:00–19:30 |
| Observed | printers.json de Caja tenia `"type": "windows"` para caja y tickets |
| Initial hypothesis | Bridge soporta type "windows" |
| Real root cause | Bridge solo soporta "tcp" y "usb". "windows" es un tipo inexistente — caeria al else de TCP y fallaria sin host/port |
| Fix | Editar printers.json: cambiar `type: "windows"` a `type: "usb"` con `names: [...]` |
| Artifact/commit | Config local, no commit. printers.json editado en Caja y Entrada |
| Physical validation | PASS — ticket imprime via USB raw despues del fix |
| Remaining risk | Sin schema validation — un type desconocido falla silenciosamente |

### 9. PANADERIA/EC01 physical printer resolution

| Campo | Valor |
|---|---|
| Timestamp | ~19:15–19:30 |
| Observed | Ticket de cobro imprime basura (numeros/texto raw) en impresora PANADERIA |
| Initial hypothesis | Driver incorrecto o encoding |
| Evidence | PANADERIA no estaba compartida en Windows (Shared=FALSE). `copy /b` a `\\COMPUTERNAME\PANADERIA` fallaba, PowerShell GDI fallback imprimia ESC/POS raw como texto |
| Real root cause | USB raw print via shared printer name requiere que la impresora este compartida. Sin compartir, fallback a PowerShell Out-Printer que interpreta bytes como texto |
| Fix | `Set-Printer -Name "PANADERIA" -Shared $true` |
| Artifact/commit | Config local Windows |
| Physical validation | PASS en Caja. EC01/EC TICKET no se pudieron compartir (Access denied, usuario Cliente sin admin) |
| Remaining risk | EC01/EC TICKET requieren acceso admin para compartir. Escondite no tiene impresora de tickets USB local |

### 10. Payment ticket pending/retry (Escondite)

| Campo | Valor |
|---|---|
| Timestamp | ~19:30 |
| Observed | Escondite (PDV1) puede tomar ordenes y enviar comandas pero NO puede imprimir ticket de cobro |
| Initial hypothesis | Impresora TCP en 192.168.1.250 deberia funcionar |
| Evidence | `ping 192.168.1.250` → host unreachable. No hay impresora USB de tickets local. Windows sharing a SERVER1\PANADERIA requiere credenciales no disponibles (password "1234" incorrecta) |
| Real root cause | 192.168.1.250 es unreachable en la red. Escondite no tiene alternativa local |
| Fix | PENDIENTE — requiere acceso fisico para resolver credenciales de red o instalar impresora USB |
| Artifact/commit | N/A |
| Physical validation | FAIL |
| Remaining risk | Escondite no puede cobrar con ticket impreso. Solo puede tomar ordenes y enviar comandas |

### 11. Conflict false positive por local timestamp

| Campo | Valor |
|---|---|
| Timestamp | ~17:30–18:00 (pre-field, durante desarrollo) |
| Observed | Toast "Conflicto detectado" aparece en CADA cobro exitoso |
| Initial hypothesis | Bug en checkOrderConflict() |
| Evidence | Frontend guardaba `loadedUpdatedAt = new Date().toISOString()` (client time). DB trigger `trg_pos_orders_updated_at` seteaba server time. Diferencia de milisegundos → siempre detecta "conflicto" |
| Real root cause | Client time vs server trigger time. El frontend no lee el updated_at real del servidor despues de guardar |
| Fix | Despues de saveOrder(), leer el updated_at del servidor y actualizar loadedUpdatedAt con ese valor |
| Artifact/commit | `c29e75e` hotfix: read server updated_at after save to prevent false conflict |
| Physical validation | PASS — cobros sin toast de conflicto falso. Deploy Vercel pre-sesion fisica |
| Remaining risk | Ninguno |

### 12. Server updated_at baseline fix

| Campo | Valor |
|---|---|
| Timestamp | ~17:37 (commit timestamp) |
| Observed | Mismo que #11 |
| Real root cause | Mismo que #11 |
| Fix | Commit `c29e75e`: lee pos_orders.updated_at del servidor post-save |
| Artifact/commit | `c29e75e` |
| Physical validation | PASS en Caja |
| Remaining risk | Ninguno |

### 13. KDS-RC1 audit/build

| Campo | Valor |
|---|---|
| Timestamp | ~20:30–21:00 |
| Observed | Electron KDS construido y desplegado en PDV2 como build RC1 |
| Initial hypothesis | KDS deberia funcionar como appliance de solo-lectura |
| Evidence | Build `8e3e441` con auto-start Windows. Carga https://app.fullsite.mx/pos/cocina en kiosk mode |
| Real root cause | N/A — build inicial |
| Fix | N/A |
| Artifact/commit | `8e3e441` feat(kds): add Windows auto-start for KDS appliance mode |
| Physical validation | KDS carga /pos/cocina. Pero se encontraron 2 bugs: counter cross-station (#15) y escape to /pos (#16) |
| Remaining risk | Superado por RC2 |

### 14. KDS realtime card — apparent failure then success

| Campo | Valor |
|---|---|
| Timestamp | ~21:00 |
| Observed | Primeras ordenes enviadas no aparecian inmediatamente en KDS, luego aparecieron |
| Initial hypothesis | Realtime no funciona, polling es lento |
| Evidence | Las ordenes SI aparecian — el polling interval (POLL_INTERVAL_KITCHEN, ~2s) las traia. La "demora" percibida era solo el primer poll cycle |
| Real root cause | No era un failure — el sistema usa polling cada 2s, no WebSocket realtime. La percepcion de "instantaneo" se confirmo en tests posteriores |
| Fix | N/A — funciona como disenado |
| Artifact/commit | N/A |
| Physical validation | PASS — 3 ordenes consecutivas aparecieron sin refresh manual |
| Remaining risk | Polling cada 2s es funcional pero no es true realtime. KDS V2 spec pide evaluar WebSocket/Supabase Realtime |

### 15. Counter cross-station bug

| Campo | Valor |
|---|---|
| Timestamp | ~21:00 |
| Observed | Tab Cocina mostraba Nuevas(1) pero 0 cards visibles. Orden tenia solo items de barra |
| Initial hypothesis | Bug en counter |
| Evidence | Counter usaba `orders.filter(o => o.status === 'enviada').length` — contaba TODAS las ordenes sin importar station. Cards filtraban por station con `getStationByName()`. Semantica divergente |
| Real root cause | Counter y cards usaban logica de filtrado diferente. Counter = global, cards = station-aware |
| Fix | Extraer `orderHasItemsForStation()` como funcion compartida. Counters usan la misma semantica que cards |
| Artifact/commit | `fa70b6e` fix(kds): station-aware counters + route isolation (KDS-RC2) |
| Physical validation | PASS — Tab Barra: Nuevas(0) cuando no hay items de barra. Tab Cocina: counter coincide con cards visibles |
| Remaining risk | Batch counter (barra de platillos arriba) NO filtra por tab — muestra items globales. Detalle identificado, no corregido |

### 16. KDS escape to /pos

| Campo | Valor |
|---|---|
| Timestamp | ~21:00 (identificado pre-field, confirmado en audit) |
| Observed | `<Link href="/pos">` back button en /pos/cocina permite navegar al POS completo desde el KDS |
| Initial hypothesis | KDS necesita isolation — cocina no debe acceder a Mesas/Cobrar |
| Evidence | Codigo: linea 465 de cocina/page.tsx tiene `<Link href="/pos">`. Electron no tenia route guards |
| Real root cause | Sin surface marker ni route guards, el KDS es simplemente un browser apuntando a una URL — puede navegar a cualquier parte |
| Fix | 4 capas: (1) `surface: 'kds'` en preload.js, (2) back button hidden cuando surface=kds, (3) `isAllowedKdsUrl()` con origin + exact pathname, (4) will-navigate + did-navigate-in-page guards |
| Artifact/commit | `fa70b6e` |
| Physical validation | PASS — back button no visible en KDS Electron. Route guards en codigo pero no probados con DevTools (DevTools bloqueados en produccion) |
| Remaining risk | Route guards no validados fisicamente via DevTools. Defense-in-depth presente pero no proven. Programado para siguiente sesion |

### 17. surface='kds' marker

| Campo | Valor |
|---|---|
| Timestamp | 21:29 (commit) |
| Observed | N/A — nueva feature |
| Real root cause | KDS y POS comparten el mismo frontend (/pos/cocina). Sin marker, el frontend no sabe si esta en KDS appliance o en browser normal |
| Fix | `window.fullsiteApp.surface = 'kds'` expuesto via preload.js. Frontend condiciona UI: back button hidden, etc. |
| Artifact/commit | `fa70b6e` |
| Physical validation | PASS — back button no visible en KDS Electron. Visible en POS normal (browser) |
| Remaining risk | surface marker NO es security boundary — solo adapta UI. Los route guards en main.js son el boundary real |

### 18. Electron route isolation design

| Campo | Valor |
|---|---|
| Timestamp | 21:29 (commit) |
| Observed | N/A — nueva feature |
| Real root cause | Sin guards, client-side JavaScript o SPA routing podria escapar de /pos/cocina |
| Fix | `isAllowedKdsUrl(url)`: valida `parsed.origin === KDS_ORIGIN && KDS_ALLOWED_PATHNAMES.includes(parsed.pathname)`. will-navigate: preventDefault si URL no permitida. did-navigate-in-page: restaura KDS_URL si SPA cambia pathname. setWindowOpenHandler: deny |
| Artifact/commit | `fa70b6e` |
| Physical validation | NOT PROVEN — DevTools bloqueados en produccion. Intento con --remote-debugging-port=9222 iniciado pero no completado (Daniel se fue) |
| Remaining risk | Guards estan en codigo pero nunca se ejecutaron en prueba fisica. Pendiente para siguiente sesion |

### 19. KDS-RC2 field validation

| Campo | Valor |
|---|---|
| Timestamp | 21:33–21:51 |
| Observed | KDS-RC2 instalado en PDV2 |
| Evidence | Hash verified on PDV2: `9459DB14...F96FEA4` matches build. PIN entry → /pos/cocina loads. Back button absent. Orders appear realtime. Station-aware counters correct. Item clicks work. Modifiers visible |
| Physical validation | 10/10 functional tests PASS. Route isolation NOT PROVEN |
| Remaining risk | Route isolation untested. Batch counter not station-aware |

### 20. Physical routing topology

| Campo | Valor |
|---|---|
| Timestamp | ~21:46–21:48 |
| Observed | Daniel confirmo operacion fisica de AMALAY |
| Evidence | Cocina: KDS PDV2 + impresoras TCP (fria 192.168.1.21, caliente 192.168.1.40). Barra: comanda impresa (192.168.1.30), NO KDS. Market/Caja: ticket USB, NO KDS. Panaderia: comunicacion VERBAL desde cocina, NO KDS, NO impresora dedicada |
| Real root cause | N/A — descubrimiento de topologia operacional |
| Fix | N/A — registrado para disenar KDS V2 sobre operacion real |
| Physical validation | Confirmado por Daniel en campo |
| Remaining risk | KDS tabs (Panaderia, Barra, Market) existen en UI pero solo Cocina es operacionalmente relevante para el unico KDS fisico. Batch counter muestra items de todas las estaciones |

---

## A. WHAT WE PROVED TODAY

Solo hechos fisicamente validados en hardware AMALAY.

1. **Fingerprint login funciona en Caja (SERVER1)** — lector HID DigitalPersona 4500 detectado, huella visible en cold start, autenticacion exitosa
2. **Fingerprint login funciona en Entrada (PDV3)** — mismo resultado
3. **Fingerprint login funciona en Escondite (PDV1)** — mismo resultado
4. **Print bridge embebido reemplaza bridge standalone** — eliminar start-bridge.bat resuelve conflicto de puerto 7717
5. **Dynamic printers.json funciona con wrapper schema** — `data.stations || data` parsea correctamente
6. **Array multi-target funciona** — cocina fria + caliente ambas reciben comanda desde una sola station "cocina"
7. **USB raw printing funciona con shared printers** — PANADERIA compartida imprime tickets correctos en Caja
8. **Conflict detection funciona sin false positives** — server updated_at como source of truth post-save
9. **KDS carga /pos/cocina en kiosk mode** — PDV2, Electron, fullscreen, sin frame
10. **KDS recibe ordenes en ~2s sin refresh manual** — polling POLL_INTERVAL_KITCHEN funcional
11. **3 ordenes consecutivas aparecen sin interaccion** — realtime stability confirmada
12. **Station-aware counters coinciden con cards** — Tab Cocina: solo items cocina. Tab Barra: solo items barra
13. **Item-level click state flow funciona** — preparando → listo → card desaparece → auto-advance
14. **Modificadores visibles en KDS** — "LECHE DESLACTOSADA 14OZ" visible en card
15. **Back button NO visible en KDS Electron** — surface='kds' condiciona UI correctamente
16. **KDS auto-start Windows configurado** — loginItemSettings registrado
17. **Hash integrity verificado** — EXE SHA-256 match entre Mac build y PDV2 post-transfer
18. **Comanda cocina fria (192.168.1.21)** — PASS en Caja, Entrada, Escondite
19. **Comanda cocina caliente (192.168.1.40)** — PASS en Caja, Entrada, Escondite
20. **Comanda barra (192.168.1.30)** — PASS en Caja, Entrada
21. **Ticket caja USB (PANADERIA)** — PASS en Caja

## B. WHAT WE DID NOT PROVE

Codigo presente pero no validado fisicamente.

1. **Route isolation via will-navigate guard** — codigo en main.js, nunca se ejecuto en prueba. DevTools bloqueados; intento con remote debugging port no completado
2. **Route isolation via did-navigate-in-page guard** — mismo
3. **window.open deny** — setWindowOpenHandler({action:'deny'}) en codigo, no probado
4. **isAllowedKdsUrl() con external origin** — nunca se probo navegar a otro dominio
5. **Cold start completo (power cycle)** — nunca se apago/prendio una PC completa
6. **Auto-start Windows post-reboot** — loginItemSettings registrado pero no validado con reboot real
7. **Offline page (offline.html)** — existe en el build, nunca se desconecto internet para probar
8. **Ticket en Entrada (PDV3)** — no se testeo explicitamente (campo de FIELD-NOTES)
9. **Ticket en Escondite (PDV1)** — FAIL conocido, 192.168.1.250 unreachable
10. **Render-process-gone auto-recovery** — codigo presente, nunca se crasheo el renderer
11. **Batch counter station-aware** — no existe, bug identificado
12. **EC01/EC TICKET sharing** — Access denied, requiere admin
13. **Concurrent orders from multiple terminals** — solo se creo desde Caja
14. **Turno close with sync barrier on KDS terminal** — no probado
15. **KDS behavior when no turno is open** — no probado

## C. REGRESSIONS INTRODUCED BY GENERALIZATION

### C1. Hardcoded STATIONS → dynamic printers.json

| Build viejo (Jul 8) | Build nuevo (Jul 12) | Regresion |
|---|---|---|
| `STATIONS = {cocina: {host:'192.168.1.21',...}}` hardcoded en main.js | `loadStations()` lee C:\fullsite\printers.json | Wrapper schema `{port, stations, default}` parseado incorrectamente → /health muestra keys del wrapper como station names. Fix: `6e07167` |
| Solo TCP, solo 1 printer por station | Soporta TCP, USB, Array | Array no manejado → `cfg.host` sobre array = undefined → cocina no imprime. Fix: `2932000` |
| N/A | `type: "windows"` en printers.json | Bridge no reconoce type "windows" → fallthrough silencioso. Fix: edicion manual a type "usb" |

**Principio violado:** La generalizacion (dynamic config) se desplego sin schema validation ni tests de las nuevas combinaciones. El build viejo simple funcionaba porque no tenia configuracion que parsear mal.

### C2. Auto-update trigger → conflict false positive

| Antes | Despues | Regresion |
|---|---|---|
| Sin trigger updated_at | Trigger `trg_pos_orders_updated_at` en DB | Frontend guardaba client timestamp como baseline. Server trigger generaba timestamp diferente → SIEMPRE detecta conflicto en el siguiente check. Fix: `c29e75e` |

**Principio violado:** Server-side effect (trigger) sin actualizar el client-side read. El server version debe venir del server.

### C3. KDS multi-station tabs → counter/card divergence

| Antes (no existia KDS) | KDS RC1 | Regresion |
|---|---|---|
| N/A | Counters cuentan TODAS las ordenes, cards filtran por station | Nuevas(1) con 0 cards visibles. Fix: `fa70b6e` |

**Principio violado:** Dos componentes visuales (counter, cards) que representan lo mismo deben usar la misma logica de filtrado. UI count semantics must match visible work.

### C4. Batch counter global scope

| Esperado | Actual | Status |
|---|---|---|
| Batch counter muestra items del tab activo | Batch counter muestra items de TODAS las estaciones | Bug identificado, no corregido. En Barra tab, chef ve "TOAST DE ATUN 0/1" que no es su trabajo |

**Principio violado:** Mismo que C3. Toda metrica visible debe reflejar el scope del filtro activo.

## D. FIELD-DERIVED PRODUCT PRINCIPLES

### D1. Baseline working system before redesign
Siempre tener un sistema funcional de referencia antes de cambiar. El build viejo con STATIONS hardcoded funcionaba. Se debio usar Entrada como baseline comparison ANTES de desplegar el build nuevo, no despues de encontrar bugs.

### D2. Physical topology before abstract station model
El KDS tiene 4 tabs (Cocina, Panaderia, Barra, Market) pero solo hay 1 KDS fisico en cocina. Panaderia es verbal. Barra tiene comanda impresa. El modelo abstracto multi-station no refleja la operacion real. Disenar sobre topologia fisica, no sobre abstracciones.

### D3. UI count semantics must match visible work
Si el counter dice Nuevas(1), debe haber exactamente 1 card nueva visible. Divergencia entre counter y contenido visible destruye confianza operacional inmediatamente.

### D4. Appliance surfaces need explicit boundaries
Un KDS no es "un browser apuntando a una URL". Es un appliance de produccion con una sola funcion. Necesita: surface marker, navigation guards, DevTools bloqueado, single-purpose UX. Defense in depth, no un solo mecanismo.

### D5. Server version must come from server
Nunca usar `new Date().toISOString()` del cliente como version de referencia cuando el servidor tiene un trigger que genera su propio timestamp. El servidor es la fuente de verdad.

### D6. Dynamic config needs schema validation
Pasar de hardcoded a printers.json introdujo 3 bugs en un dia. Dynamic config sin schema validation (tipos permitidos, estructura, defaults) es una fuente de regresiones. Al minimo, validar on-load y loguear warnings.

### D7. Generalization earns its complexity in the field, not in code review
Los 3 bugs de printers.json (wrapper parse, array support, type:windows) pasaron code review local. Solo se manifestaron en hardware real con configuraciones reales. Generalizar solo cuando hay evidencia de que la complejidad adicional se necesita en produccion.

### D8. One known-good artifact before branching
El commit `2932000` con CAJA-KNOWN-GOOD fue el punto de referencia correcto. Todo cambio posterior se puede comparar contra ese hash. Siempre congelar un artifact known-good antes de hacer cambios.

### D9. WAR ROOM discipline prevents compound errors
Un paso a la vez, evidencia antes de avanzar, HECHO/INFERENCIA/HIPOTESIS separados. Sin este protocolo, habriamos saltado de "fingerprint no funciona" a "reinstalar todo" sin descubrir que el root cause era un .bat en Startup.

### D10. Evidence-based debugging over intuition
"No me digas que ignore el toast" — investigar antes de continuar. "No asumas que el build viejo funciona por memoria — midelo" — comparar contra baseline. Cada fix debe tener root cause confirmado antes de aplicar.

---

## ARTIFACTS KNOWN-GOOD

### FULLSITE POS CAJA (SERVER1) — KNOWN-GOOD

| Campo | Valor |
|---|---|
| Commit SHA | `2932000` (fix: support array of printers per station) |
| Commit message | fix(electron): support array of printers per station |
| EXE SHA-256 | `c6ccd31c6c34567408374b49dd63cb8aa6ff4ab56ed904ce186a14a6d3d2b579` |
| EXE timestamp | Jul 12 19:34:16 2026 |
| APP.ASAR SHA-256 | `a984d6ce32878441980602315cfa3c8d30425b2a0745ad0199df422e2dd50fcc` |
| Build platform | Windows x64, electron-builder 25.1.8, Electron 33.4.11 |
| Terminal | SERVER1 (Caja principal) |
| User | SOPORTE |
| Local Windows changes | start-bridge.bat eliminado del Startup; PANADERIA shared; printers.json editado type:usb |
| printers.json effective | `{"port":7717,"stations":{"cocina":[TCP .21:9100, TCP .40:9100],"barra":TCP .30:9100,"caja":USB ["PANADERIA"],"tickets":USB ["EC01","EC TICKET"]},"default":"tickets"}` |
| Validated capabilities | Fingerprint, cocina fria+caliente, barra, ticket caja USB, conflict-free cobro |

### FULLSITE KDS RC2 (PDV2) — KNOWN-GOOD

| Campo | Valor |
|---|---|
| Commit SHA | `fa70b6e` |
| Commit message | fix(kds): station-aware counters + route isolation (KDS-RC2) |
| EXE SHA-256 | `9459db145e122530fc7babfbbb70c6a7f66c61d8f9812d6f04a847e86f96fea4` |
| APP.ASAR SHA-256 | `4bea13e8fe009f6c2954dbeec7a5f5e5bf74191c50c37b26b7acdbf661746837` |
| EXE timestamp | Jul 12 21:33:25 2026 |
| Build platform | Windows x64, electron-builder 25.1.8, Electron 33.4.11 |
| Terminal | PDV2 (Cocina KDS) |
| User | SOPORTE |
| URL effective | `https://app.fullsite.mx/pos/cocina` |
| Allowlist effective | origin=`https://app.fullsite.mx` + pathname exacto `/pos/cocina` |
| Surface marker | `window.fullsiteApp.surface = 'kds'` |
| Route guards | will-navigate (block), did-navigate-in-page (restore), setWindowOpenHandler (deny) |
| Validated capabilities | Realtime orders (~2s), station-aware counters, station-aware cards, item-level state flow, auto-advance, modifier display, back button hidden, hash integrity |
| NOT validated | Route guard execution, cold start, auto-start post-reboot, offline recovery, window.open deny |

---

## TOP 10 NEXT MOVES

Rankeado por: operational risk (OR) | customer value (CV) | learning value (LV) | effort (E)

| # | Move | OR | CV | LV | E | Notes |
|---|---|---|---|---|---|---|
| 1 | **Cold start test (power cycle 3 terminals + KDS)** | HIGH | LOW | HIGH | LOW | Nunca validado. Auto-start, bridge, fingerprint deben sobrevivir reboot. 15 min en campo |
| 2 | **Route isolation test con DevTools** | MED | LOW | HIGH | LOW | Guards en codigo no probados. 10 min con remote debug port. Cierra la unica incognita de KDS-RC2 |
| 3 | **Escondite ticket printing** | HIGH | MED | MED | MED | Terminal no puede cobrar con ticket. Requiere resolver credenciales de red o impresora USB. Acceso fisico |
| 4 | **Batch counter station-aware** | LOW | MED | LOW | LOW | ~10 lineas de codigo. Filtra batchCounts por stationFilter. Podria ser RC3 candidate. No bloquea operacion |
| 5 | **Productive Validation Runbook (25 checkpoints)** | HIGH | HIGH | HIGH | MED | El smoke test real de operacion completa. Debe ejecutarse en dia laboral con ordenes reales. Es el gate para cutover |
| 6 | **Registrar huellas Eduardo + meseros** | HIGH | HIGH | LOW | LOW | Sin huellas registradas, todos usan PIN. Huella es el auth primario para anti-fraude. Requiere acceso fisico |
| 7 | **Ticket en Entrada (PDV3) explicit test** | MED | MED | LOW | LOW | Nunca se testeo explicitamente. Deberia funcionar (USB "TICKET" shared). 2 min en campo |
| 8 | **KDS V2 Product Spec — auditoria comparativa** | LOW | HIGH | HIGH | MED | Wansoft KDS vs Fullsite actual vs ideal. No requiere campo. Informa el rediseno completo |
| 9 | **Concurrent multi-terminal orders** | MED | MED | HIGH | LOW | 2 terminales enviando ordenes simultaneas. Valida que no hay race conditions en bridge/KDS. 10 min en campo |
| 10 | **printers.json schema validation** | MED | LOW | MED | LOW | Validar on-load: tipos permitidos (tcp/usb), campos requeridos, log warnings. Previene regresiones tipo "type:windows" |

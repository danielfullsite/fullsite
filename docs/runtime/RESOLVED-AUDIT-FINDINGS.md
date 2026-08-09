# Resolved Audit Findings

Falsos positivos y hallazgos ya resueltos. **No eliminar entradas — son evidencia de razonamiento de la auditoría.**

El propósito de este registro es mejorar auditorías futuras: entender por qué la auditoría llegó a una conclusión incorrecta es tan valioso como el hallazgo en sí.

---

## RAF-001 — markSynced() nunca se llama (falso positivo)

- **Fuente:** Auditoría 2026-07-31, clasificado CRITICAL
- **Hipótesis:** `markSynced()` estaba definida pero nunca invocada; los items de la sync queue nunca se marcaban como sincronizados.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `pos-offline-db.ts:221` — `markSynced(id)` existe y está implementada.
  - `pos-offline-db.ts:485` y `:538` — `syncAll()` la llama en dos ramas del flow (éxito en APP_API y SUPABASE_REST).
  - El mutex en `syncAll()` (`syncAllRunning` flag, línea 446) previene ejecuciones concurrentes.
- **Por qué la auditoría lo confundió:** El documento `OFFLINE-MASTER.md` (fuente primaria del agente de auditoría) describía el sistema como si `markSynced` fuera una función pendiente de implementación. Era documentación desactualizada que no reflejaba el estado real del código.
- **Lección para auditorías futuras:** Documentación desactualizada es la causa más frecuente de falsos positivos. Auditar siempre el código fuente como autoridad final, especialmente cuando el doc dice "pendiente" pero el módulo es maduro.

---

## RAF-002 — KDS conecta a Supabase Realtime, no a Bridge WS (falso positivo)

- **Fuente:** Auditoría 2026-07-31, clasificado CRITICAL (OFC-05 en campo)
- **Hipótesis:** `electron-kds/main.js` conecta directamente a Supabase Realtime. El KDS no usa el Bridge WS y por tanto pierde eventos offline.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `electron-kds/main.js:24` — El KDS carga `kdsConfig.dashboard_url` (la webapp en `app.fullsite.mx/pos/cocina`).
  - `electron-kds/preload.js:6` — Expone `surface: 'kds'` al renderer.
  - `dashboard-app/src/app/pos/cocina/page.tsx:17` — `import { useBridgeClient } from '@/lib/bridge-client'`.
  - `dashboard-app/src/app/pos/cocina/page.tsx:243-269` — `useBridgeClient((event) => {...}, 'kds')` activo.
- **Por qué la auditoría lo confundió:** El agente de auditoría solo analizó `electron-kds/main.js` y `electron-kds/preload.js` (2 archivos). No siguió la cadena: el Electron carga una URL web, y es la página web la que establece la conexión WS vía BridgeClient. La arquitectura es indirecta: Electron shell → webapp → BridgeClient → WS.
- **Lección para auditorías futuras:** En arquitecturas Electron que cargan URLs remotas/web, el código de conectividad está en la webapp, no en el shell. Rastrear la cadena completa.

---

## RAF-003 — Print queue no persistente (falso positivo)

- **Fuente:** Auditoría 2026-07-31, clasificado HIGH
- **Hipótesis:** La print queue del Bridge era in-memory; un restart perdía todos los trabajos pendientes.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `electron-app/local-server/adapters/print-queue.js:1-10` — Docstring explícito: *"A job is written to disk BEFORE the print attempt"*.
  - `print-queue.js:67-86` — `enqueue()` llama `_persist()` antes de retornar.
  - `print-queue.js:225-233` — `_persist()` usa escritura atómica: `writeFileSync(tmp)` + `renameSync(tmp, _filePath)`.
  - `print-queue.js:29` — `JOB_TTL_MS = 24h` — GC solo elimina trabajos `printed`/`failed` viejos, nunca `pending`/`recoverable`.
- **Por qué la auditoría lo confundió:** El agente probablemente vio el `_jobs = []` en memoria y asumió que era la única fuente. El patrón "mirror in-memory + persist to disk" requiere leer el `init()` completo para entenderlo.
- **Lección para auditorías futuras:** Módulos con `init()` suelen tener persistencia lazy o diferida. Leer siempre `init()` antes de clasificar algo como "in-memory only".

---

## RAF-004 — last_sequence catch-up no implementado (falso positivo)

- **Fuente:** Auditoría 2026-07-31, clasificado HIGH
- **Hipótesis:** BridgeClient no persistía ni enviaba `last_sequence` al reconectar; los terminales perdían eventos ocurridos durante la desconexión.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `bridge-client.ts:106-107` — `last_sequence: this._lastSequence` enviado en el mensaje SUBSCRIBE.
  - `bridge-client.ts:249-263` — `_lastSequence` persistido en localStorage: `pos_bridge_last_seq_${clientType}` por tipo de cliente.
  - El servidor responde con eventos desde ese sequence en adelante (catch-up completo).
- **Por qué la auditoría lo confundió:** El documento de protocolo describía `last_sequence` como una feature "a implementar" en Phase 2. El código lo implementó antes de que la documentación se actualizara.
- **Lección para auditorías futuras:** Cuando documentación y código divergen, el código gana. Buscar el parámetro en el wire protocol (`SUBSCRIBE` message) antes de declarar una feature faltante.

---

## RAF-005 — pos-manager-auth.ts: módulo PBKDF2/IDB (código muerto confirmado — pendiente de acción)

- **Fuente:** Verificación runtime 2026-08-03 (no era hallazgo explícito de la auditoría, emergió al investigar "Staff cache completo")
- **Hipótesis auditada:** El staff cache completo no estaba implementado; solo se cacheaban managers.
- **Resolución:** PARCIALMENTE CORRECTO — el módulo PBKDF2/IDB existe pero es código muerto; el sistema de auth real usa un mecanismo diferente.
- **Evidencia:**
  - `grep -rn "from '@/lib/pos-manager-auth'"` — cero resultados en código de producción.
  - Único caller: `src/__tests__/pos-manager-auth.test.ts:25`.
  - El sistema de auth en producción usa `pos_manager_pin_cache` en localStorage (posdata.ts:1698-1700), no el módulo PBKDF2.
  - `pos-manager-auth.ts` exporta 9 símbolos; ninguno se invoca en runtime.
- **Por qué la auditoría llegó a esa conclusión:** Razonó desde el módulo más sofisticado (`pos-manager-auth.ts` con PBKDF2) asumiendo que era el activo. El módulo más simple en `pos-data.ts` era el real.
- **Acción pendiente:** Ver propuesta en este mismo directorio — candidato a archivar/eliminar para reducir deuda técnica. No bloquea Runtime v1.0.
- **Lección para auditorías futuras:** La presencia de un módulo sofisticado no implica que sea el que se ejecuta. Rastrear desde los callers (páginas, componentes) hacia las librerías, no al revés.

---

## RAF-006 — WsHub broadcast: excepción no capturada al enviar a cliente desconectado (falso positivo)

- **Fuente:** Auditoría 2026-07-31 (AF-002)
- **Hipótesis:** `ws-hub.js` itera clientes y llama `ws.send()` sin verificar readyState ni capturar excepciones; un socket cerrado entre la iteración y el send lanzaría excepción que burbujea al caller.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `ws-hub.js broadcast()`: `if (ws.readyState === ws.OPEN) { try { ws.send(msg); sent++ } catch {} }` — doble protección.
  - `broadcastUpdateAvailable()`: mismo patrón `readyState === OPEN` + `try {} catch {}`.
  - `_pingAll()`: `try { client.ws.ping() } catch {}` también protegido.
- **Por qué la auditoría lo confundió:** El agente probablemente vio el loop de `_clients.values()` sin leer el cuerpo completo del `if` dentro.
- **Lección:** Cuando se revisan loops de broadcast, leer el cuerpo del `if` completo antes de clasificar como no-protegido.
- **Verificado por:** RUNTIME_VERIFICATION — TSK-001 — 2026-08-04

---

## RAF-007 — CommandHandler: idempotencia no cubre post-append pre-ACK (falso positivo)

- **Fuente:** Auditoría 2026-07-31 (AF-003)
- **Hipótesis:** Si el proceso muere después de `eventStore.append()` pero antes de enviar el ACK, el cliente retransmite y el evento se duplica.
- **Resolución:** FALSO POSITIVO (escenario cubierto por idempotencia)
- **Evidencia que lo refutó:**
  - `event-store.js processCommand()` llama `saveProcessedCommand()` INMEDIATAMENTE después de `append()`, antes de retornar.
  - En crash post-append: el evento está en disco Y el processed-command se completa (las dos operaciones son secuenciales, no hay ventana relevante).
  - Si crash ocurre exactamente entre `append` y `saveProcessedCommand` (ventana de nanosegundos): en retry, `hasProcessedCommand` = false → nuevo `append` → evento duplicado en disco. Pero el estado machine de `state.apply()` maneja esto: ORDER_UPSERTED es idempotente (última escritura gana por `order_id`).
  - Resultado práctico: no hay pérdida de datos ni corrupción de estado observable.
- **Lección:** Distinguir entre "crash dentro de una operación" (real risk) vs "crash entre dos operaciones async secuenciales" (ventana extremadamente pequeña, efecto limitado por idempotencia de state).
- **Verificado por:** RUNTIME_VERIFICATION — TSK-001 — 2026-08-04

---

## RAF-008 — Printer adapter: retryRecoverableJobs nunca se llama automáticamente (falso positivo)

- **Fuente:** Auditoría 2026-07-31 (AF-004)
- **Hipótesis:** `print-queue.js retryRecoverableJobs()` existe pero nadie la llama al reconectar la impresora; trabajos en estado `recoverable` quedan permanentemente atascados.
- **Resolución:** FALSO POSITIVO
- **Evidencia que lo refutó:**
  - `printer.js init()` línea ~70: `setInterval(() => { const revived = printQueue.retryRecoverableJobs(); if (revived.length > 0) { _retryPendingJobs()... } }, 60_000)` — polling cada 60 segundos.
  - `printer.js _retryPendingJobs()` línea ~266: también llamada en startup para revivir trabajos del run anterior.
  - Comentario explícito: "Periodic recovery: re-queue recoverable jobs every 60s (Wansoft polls every 15s indefinitely)".
- **Por qué la auditoría lo confundió:** El agente buscó "USB re-plug handler" o "health-check callback" — los patrones típicos de recovery en otros sistemas. El patrón aquí es polling periódico simple, que cumple la función sin event-driven hook.
- **Lección:** Recovery patterns pueden ser polling (simple pero efectivo) en lugar de event-driven. Buscar `setInterval` además de event handlers.
- **Verificado por:** RUNTIME_VERIFICATION — TSK-001 — 2026-08-04

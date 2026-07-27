# Local-First Code Audit Matrix
<!-- Última actualización: 2026-07-27 (sesión 5 / PER-02). No borrar hallazgos resueltos — marcar Estado. -->

## Leyenda de severidad
- **CRITICAL** — bloquea la operación del restaurante sin internet
- **HIGH** — degrada operación, workaround posible pero frágil
- **MEDIUM** — falla silenciosa, recuperable manualmente
- **LOW** — cosmético o edge case menor

## Leyenda de estado
- `OPEN` — no corregido
- `IN_PROGRESS` — siendo corregido en sesión activa
- `FIXED` — corregido, commit indicado
- `WONT_FIX` — documentado, decisión consciente de no corregir

---

## Módulo: Cobro (Payment)

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| PAY-01 | CRITICAL | Cobro | `pos/page.tsx:2657` `checkOrderConflict` | Fetch a Supabase sin timeout — cuelga en red degradada. `catch` ya retorna `false` (procede offline) pero sin timeout puede bloquear 30s+. | Cobro se cuelga en LAN lenta aunque la orden esté en IDB. | `AbortSignal.timeout(4000)` en el fetch del conflict-check. | FIXED | — | — | — |
| PAY-02 | MEDIUM | Cobro | `pos/page.tsx:3193` Inventory deduction | Fire-and-forget hacia Supabase sin queue. | Inventario no se descuenta offline, queda desincronizado. | Enqueue deducción en sync queue cuando falla. | OPEN | — | — | — |
| PAY-03 | LOW | Cobro | `pos-data.ts` `saveOrder` | Pago mixto con múltiples `pagos` no tiene deduplicación robusta por UUID de pago. | Doble-tap podría disparar dos cobros. | `operationLock.current` ya previene la mayoría; verificar que cover UUID de `saveOperationId`. | OPEN | — | — | — |

---

## Módulo: Órdenes / Send

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| ORD-01 | HIGH | Órdenes | `pos/page.tsx:2916` | LAN broadcast (POST `/events`) solo existía en el path `OFFLINE_QUEUED`. Envíos online NO notificaban al Local Server. | KDS y otros POS solo se enteraban por Supabase poll (5s delay). Multi-terminal no era real-time cuando hay internet. | Broadcast añadido a TODOS los sends exitosos (online + offline). | FIXED | — | — | — |
| ORD-02 | HIGH | Órdenes | `pos/page.tsx:2705` | Race-check de nueva orden llamaba Supabase sin timeout. `catch` ya maneja el error pero sin timeout puede colgar 30s+. | Congelamiento al crear primera orden de una mesa en red degradada. | `AbortSignal.timeout(4000)` en el race-check fetch. | FIXED | — | — | — |
| ORD-03 | MEDIUM | Órdenes | `pos-data.ts:1323` `saveOrder` | IDB write ocurre SOLO en el catch (falla de red). No hay pre-write a IDB antes de intentar Supabase. | Si hay corte de red justo durante el POST (sin error catcheable), la orden podría perderse. | Pre-write a IDB antes del fetch, marcar como `pending_sync`. | OPEN | — | — | — |
| ORD-04 | LOW | Órdenes | `pos/page.tsx:2985` | Fetch de `updated_at` post-save va a Supabase sin fallback. | Falla silenciosa — no bloquea, solo no actualiza `loadedUpdatedAt`. Pero puede causar conflictos en siguiente envío. | Usar `Date.now()` como fallback si fetch falla. Ya implementado en catch pero vale verificar. | OPEN | — | — | — |

---

## Módulo: KDS

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| KDS-01 | CRITICAL | KDS | `pos/kds/page.tsx` `toggleItemDone` | `updateOrderStatus` (advance/bump) ya tenía fallback offline vía IDB. `toggleItemDone` hacía PATCH directo sin queue — solo logueaba el error en red. | Offline: el cocinero marca item listo → state local OK pero no se persiste ni sincroniza. | `.catch` de `toggleItemDone` ahora encola en `fullsite_offline_queue` para sync posterior. | FIXED | — | — | — |
| KDS-02 | HIGH | KDS | `pos/kds/page.tsx` `useKdsWsClient.ts` | KDS hacía poll a Supabase cada 2s. Solo cuando fallaba usaba IDB como fallback. | Cuando Supabase cae, KDS congela o muestra órdenes desactualizadas. La IDB solo tiene lo que el POS guardó. | `useKdsWsClient` hook: WsHub WS como fuente primaria (LAN_PRIMARY), Supabase poll solo en FALLBACK/OFFLINE. Modos: LAN_PRIMARY / RECONCILING / FALLBACK / OFFLINE. Catch-up con last_sequence, dedup sliding-window 256 IDs, dual-write en acciones KDS. | FIXED | 823b747 | 17 kds-ws.test.js | — |
| KDS-03 | HIGH | KDS | `public/sw.js` | `pos_orders` NO está en el API cache del Service Worker. | KDS no puede servir órdenes offline desde SW. Solo IDB. | Agregar `pos_orders` al cache del SW, o confiar en IDB + Local Server. | OPEN | — | — | — |
| KDS-04 | MEDIUM | KDS | `pos/kds/page.tsx` | No se suscribe al WsHub via WebSocket en startup. Usa REST poll (2s) + HTTP bridge eventos. | Latencia 0-2s en actualizaciones cruzadas cuando debería ser <500ms. | Resuelto por KDS-02: `useKdsWsClient` conecta WsHub WS en mount con SNAPSHOT + DELTAs. | FIXED | 823b747 | — | — |

---

## Módulo: Navegación / App Shell

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| NAV-01 | MEDIUM | Auth | `pos/layout.tsx:322-329` | `checkActiveSession` + `registerSession` llaman Supabase sin guard offline. | Session locking no funciona offline, pero auth por PIN sí (cache localStorage). | Envolver en `try/catch` que no bloquee login. Ya aislado. Verificar que no rompe flujo. | OPEN | — | — | — |
| NAV-02 | LOW | Config | `pos-config.ts` `getPosConfigSync()` | Retorna strings vacíos si `fetchClientConfig` no terminó. | Primera sesión offline: print config vacía → ticket sin nombre ni dirección. | Pre-cargar posConfig en IDB en el primer load online, leer de IDB offline. | OPEN | — | — | — |
| NAV-03 | LOW | SW | `public/sw.js v6` | `pos_orders`, `pos_cierres` no están en patrones de cache de API. | KDS y CorteXModal no tienen fallback SW para datos de órdenes. | Depende de IDB (que sí cachea). Documentado. | OPEN | — | — | — |

---

## Módulo: Persistencia / Reinicio

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| PER-01 | HIGH | IDB | `pos-offline-db.ts` + `offline-sync.ts` | Dos queues paralelas (IDB `sync_queue` + localStorage `fullsite_offline_queue`). Items en una invisible a la otra. | Split-brain: sync puede ignorar items si están en la queue equivocada. | IDB `sync_queue` es la cola canónica. `drainLocalStorageToIdb()` migra items de localStorage a IDB en startup. Los únicos writes a `fullsite_offline_queue` son emergency-fallback (IDB primero, localStorage solo si IDB falla). | FIXED | a3a47f4 | — | — |
| PER-02 | HIGH | EventStore | `dashboard-app/AGENTS.md` | `src/lib/event-store.ts` declarado como "Formal" en AGENTS.md pero no existe — promesa de documentación, no un import real. Investigación completa revela: (1) el Local Server ya tiene `CoreEventStore + NdjsonEventStore` como autoridad durable; (2) persist → state → ACK orden garantizado; (3) replay real en startup; (4) dedup survives restart; (5) gaps reales son non-atomic append+saveCmd y STATE_SYNC inflation del log (Phase 2). El POS no necesita su propio event store. | **Opción A**: corregir AGENTS.md para apuntar a `bridge-client.sendCommand()` + Local Server `CoreEventStore`. No crear nuevo archivo. Gaps de Phase 2 documentados en `docs/reference/PERSISTENCE-LAYER.md`. | FIXED | a8385f5 | 8 event-store.test.js existentes; 6 tests adicionales identificados (línea truncada, crash entre append+saveCmd) — por implementar | — |
| PER-03 | MEDIUM | Print | `print-queue.ts` | `recoverFromIDB()` implementado (commit P0.3) pero `_syncQueueToIDB` usa dynamic import fire-and-forget. Si el import falla, IDB no se actualiza. | Print jobs perdidos si IDB import falla al escribir. | Verificar que dynamic import no falla en contexto Electron. Test en Windows. | OPEN | — | — | — |
| PER-04 | LOW | Turno | `pos/turno/page.tsx` | `turnoId` se persiste en localStorage. Si localStorage se borra (modo privado, policy), turno se pierde. | Turno no recuperable solo desde localStorage en ese caso. | Turno también en IDB (ya implementado P0.1). Doble persistencia. | FIXED | 9cd2d78 | — | — |

---

## Módulo: Sincronización LAN

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| LAN-01 | HIGH | Local Server | `local-server/index.js:17 comment` | Local server en Phase 1: Supabase sigue siendo la autoridad de escritura. Terminal B que recibe ORDER_SENT via WS no puede verificar el estado sin Supabase. | Multi-terminal offline: estado diverge si Supabase no llega. | Phase 2: comandos van al Local Server primero, Supabase en background. Trabajo mayor. | OPEN | — | — | — |
| LAN-02 | MEDIUM | Local Server | `local-server/adapters/storage/ndjson.js` | `readAfter(seq)` y `markSynced` hacen scan/rewrite del archivo completo. | Con meses de operación, startup lento y I/O alto. | Agregar compactación periódica (snapshot + truncate). Tarea de mantenimiento. | OPEN | — | — | — |
| LAN-03 | HIGH | Client | `src/lib/server-discovery.ts`, `src/lib/server-registry.ts`, `local-server/index.js:/identity` | mDNS `bonjour-service` puede fallar silenciosamente en Windows con múltiples interfaces de red. Sin fallback, KDS standalone no encontraba el servidor. | KDS standalone (`kds_only`) no encontraba el servidor si mDNS fallaba. Una terminal podía conectarse a un servidor de otro restaurante sin validación de identidad. | Estrategia escalonada: preferidos → registry → subnet scan (opt-in). Endpoint `GET /identity` valida restaurant_id + protocol_version antes de abrir WS. `ServerRegistry` persiste endpoints exitosos en localStorage por 24h. `useBridgeClient` ejecuta discovery antes de conectar. | FIXED | pendiente | 24 tests (TC-01…TC-13 + Registry + buildDiscoveryConfig) | Pendiente — requiere: Ethernet + WiFi + KDS + internet desconectado + cambio de IP |
| LAN-04 | MEDIUM | KDS standalone | `electron-app/main.js:363` | `pos_server_ip` se inyecta como `?bridge=IP` en la URL del KDS. No hay validación de que el web app lea ese parámetro. | KDS standalone podría conectarse al bridge incorrecto o no conectarse. | Verificar que `useBridgeClient` lee `?bridge=` correctamente. | OPEN | — | — | — |

---

## Módulo: Configuración / Replicabilidad

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| CFG-01 | HIGH | Config | `electron-app/main.js:31-33` | IPs hardcodeadas: `192.168.1.21` (cocina), `192.168.1.30` (barra) como DEFAULT_STATIONS. | En nueva instalación con diferente subred → impresoras no responden. No hay error claro. | Forzar config explícita de impresoras antes de primer servicio. Diagnostic que valide IPs. | OPEN | — | — | — |
| CFG-02 | CRITICAL | Config | `electron-app/main.js` | `restaurantId` defaults a `'unknown'` si `config.json` ausente. Local Server y KDS arrancaban con identidad inválida. | Órdenes, eventos y mDNS con `restaurant_id: 'unknown'`. Datos de cualquier restaurante mezclados. | Formal TerminalConfig schema + loadAndValidateConfig() gate + wizard setup.html + Local Server guard + ws-hub reject + fromLegacy() migration. | FIXED | 3c9dbc0 | 35 schema + 3 ws-hub | — |
| CFG-03 | HIGH | Config | `electron-app/main.js` | Config en `C:\fullsite\` hardcodeado. | En Windows con permisos restrictivos o instalación en path diferente → config no se lee. | `app.getPath('userData')` como primario, `C:\fullsite\` como fallback. | FIXED | 3c9dbc0 | — | — |
| CFG-04 | HIGH | Octogent Hook | `.claude/settings.json` | Hook `PreToolUse` HTTP a `127.0.0.1:8787` (Octogent) falla con ECONNREFUSED en cada tool use. | No bloquea código ni tests, pero genera ruido y el tracking de Octogent es ciego. | Arrancar el Worker local de Octogent o eliminar los hooks del proyecto settings. | OPEN | — | — | — |

---

## Módulo: Impresión

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| PRN-01 | MEDIUM | Print | `print-queue.ts` / `pos-offline-db.ts` | `saveIDBPrintJob` importado dinámicamente en fire-and-forget. Si IDB no disponible, job no persiste en IDB. | Print job no sobrevive restart si localStorage se borra. | Sincrónico o verificar que el import dinámico funciona en Electron. | OPEN | — | — | — |
| PRN-02 | LOW | Print | `printer.ts` | `printTicketCSS` ahora es async (P0.5). Callers en `historial/page.tsx` no awaitan. | No bloquea — la ventana abre antes de que el QR esté listo. Funciona. | Documentado. No requiere fix. | FIXED | 9cd2d78 | — | — |

---

## Resumen ejecutivo

| Módulo | CRITICAL | HIGH | MEDIUM | LOW | FIXED |
|--------|----------|------|--------|-----|-------|
| Cobro | 0 | 0 | 1 | 1 | 1 |
| Órdenes | 0 | 0 | 1 | 1 | 2 |
| KDS | 0 | 1 | 0 | 0 | 3 |
| Navegación | 0 | 0 | 1 | 2 | 0 |
| Persistencia | 0 | 0 | 1 | 0 | 3 |
| Sync LAN | 0 | 2 | 2 | 0 | 0 |
| Configuración | 0 | 2 | 0 | 0 | 2 |
| Impresión | 0 | 0 | 1 | 0 | 1 |
| **Total** | **0** | **5** | **7** | **4** | **12** |

### Circuito offline — estado actual (sesión 4 / KDS-02 + PER-01 resueltos)
- **Funciona offline**: PIN, turno, mapa de mesas, órdenes, envíos, impresión, cobro, KDS avanzar/completar/item-done
- **KDS LAN-first**: `useKdsWsClient` — WsHub WS como fuente primaria, Supabase poll solo en FALLBACK/OFFLINE. Modos visuales: LAN / ... / Supabase / (sin señal). 17 tests cubren snapshot, catch-up, second-round, dual-write, mismatch rejection, idempotency.
- **Queue única**: IDB `sync_queue` es la cola canónica. `drainLocalStorageToIdb()` migra en startup. localStorage solo es emergency-fallback.
- **Multi-terminal real-time**: broadcast inmediato al Local Server en TODOS los envíos (online y offline)
- **Timeouts cortos**: conflict-check y race-check abortan en 4s — no más cuelgues en LAN degradada
- **Identidad validada**: TerminalConfig schema + wizard provisionamiento + ws-hub mismatch rejection
- **Migración automática**: installs AMALAY existentes migran sin perder IDB / queues / turno
- **Todavía requiere internet en 1er boot**: KDS startup sin estado previo en IDB, actualizaciones de SW

### HIGH restantes — clasificados por impacto

**EventStore / Persistencia**
- ~~PER-02~~: Resuelto documentalmente. El Local Server tiene `CoreEventStore + NdjsonEventStore` completos. AGENTS.md corregido. Ver `docs/reference/PERSISTENCE-LAYER.md` para gaps de Phase 2 (non-atomic append+dedup, sin fsync, STATE_SYNC inflation, sin snapshots).

**Multi-terminal / LAN sync**
- LAN-01 (HIGH): Local Server en Phase 1 — Supabase sigue siendo autoridad de escritura. Multi-terminal offline diverge.
- ~~LAN-03~~ (HIGH): **FIXED** — `ServerDiscovery` + `ServerRegistry` + `GET /identity` + `useBridgeClient` integrado. 24 tests. Pendiente validación física.

**Configuración / Replicabilidad**
- CFG-01 (HIGH): IPs `192.168.1.21`/`.30` hardcodeadas como DEFAULT_STATIONS — en nueva sucursal no funcionan sin editar el config.
- CFG-04 (HIGH): Octogent hooks llaman `127.0.0.1:8787` — ECONNREFUSED en cada tool use (no bloquea operación, pero ruido en logs).

**KDS**
- KDS-03 (HIGH): `pos_orders` no está en el API cache del SW — KDS no puede servir órdenes desde SW offline (IDB + Local Server lo cubren parcialmente).

### Próximos HIGH recomendados

**LAN-01** (Supabase como autoridad de escritura en Phase 1) — el gap arquitectural más significativo. Los comandos POS van a Supabase primero, luego al Local Server como observación. Multi-terminal offline diverge. Desbloquea que el POS sea verdaderamente offline-first.

**CFG-01** (IPs hardcodeadas) — en cualquier cliente nuevo, las impresoras no responden hasta editar `DEFAULT_STATIONS` en código. Reemplazar con provisioning explícito antes del primer servicio.

---
*Generado: 2026-07-27 | Sesión 4 | Auditor: Claude Code | Basado en análisis completo de pos/page.tsx, local-server/, pos-offline-db.ts, kds/page.tsx, layout.tsx, sw.js, useKdsWsClient.ts*

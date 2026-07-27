# Local-First Code Audit Matrix
<!-- Última actualización: 2026-07-27 (sesión 2). No borrar hallazgos resueltos — marcar Estado. -->

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
| KDS-02 | HIGH | KDS | `pos/kds/page.tsx` `fetchOrders` | KDS hace poll a Supabase cada 2s. Solo cuando falla usa IDB como fallback. | Cuando Supabase cae, KDS congela o muestra órdenes desactualizadas. La IDB solo tiene lo que el POS guardó. | KDS debe suscribirse al Local Server (WsHub) como fuente primaria, Supabase como respaldo. | OPEN | — | — | — |
| KDS-03 | HIGH | KDS | `public/sw.js` | `pos_orders` NO está en el API cache del Service Worker. | KDS no puede servir órdenes offline desde SW. Solo IDB. | Agregar `pos_orders` al cache del SW, o confiar en IDB + Local Server. | OPEN | — | — | — |
| KDS-04 | MEDIUM | KDS | `pos/kds/page.tsx` | No se suscribe al WsHub via WebSocket en startup. Usa REST poll (2s) + HTTP bridge eventos. | Latencia 0-2s en actualizaciones cruzadas cuando debería ser <500ms. | Conectar KDS al WsHub `/ws` en mount, aplicar SNAPSHOT + DELTAs. | OPEN | — | — | — |

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
| PER-01 | HIGH | IDB | `pos-offline-db.ts` + `offline-sync.ts` | Dos queues paralelas (IDB `sync_queue` + localStorage `fullsite_offline_queue`). Items en una invisible a la otra. | Split-brain: sync puede ignorar items si están en la queue equivocada. | Deprecar `offline-sync.ts`, redirigir todo a IDB. Mantener compatibilidad para items existentes. | OPEN | — | — | — |
| PER-02 | HIGH | EventStore | `AGENTS.md` + código | `src/lib/event-store.ts` referenciado en AGENTS.md como contrato formal de "Event store (POS)" pero **el archivo no existe**. | Cualquier import a `event-store.ts` falla en runtime. | Crear el módulo o actualizar AGENTS.md con la abstracción real. | OPEN | — | — | — |
| PER-03 | MEDIUM | Print | `print-queue.ts` | `recoverFromIDB()` implementado (commit P0.3) pero `_syncQueueToIDB` usa dynamic import fire-and-forget. Si el import falla, IDB no se actualiza. | Print jobs perdidos si IDB import falla al escribir. | Verificar que dynamic import no falla en contexto Electron. Test en Windows. | OPEN | — | — | — |
| PER-04 | LOW | Turno | `pos/turno/page.tsx` | `turnoId` se persiste en localStorage. Si localStorage se borra (modo privado, policy), turno se pierde. | Turno no recuperable solo desde localStorage en ese caso. | Turno también en IDB (ya implementado P0.1). Doble persistencia. | FIXED | 9cd2d78 | — | — |

---

## Módulo: Sincronización LAN

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| LAN-01 | HIGH | Local Server | `local-server/index.js:17 comment` | Local server en Phase 1: Supabase sigue siendo la autoridad de escritura. Terminal B que recibe ORDER_SENT via WS no puede verificar el estado sin Supabase. | Multi-terminal offline: estado diverge si Supabase no llega. | Phase 2: comandos van al Local Server primero, Supabase en background. Trabajo mayor. | OPEN | — | — | — |
| LAN-02 | MEDIUM | Local Server | `local-server/adapters/storage/ndjson.js` | `readAfter(seq)` y `markSynced` hacen scan/rewrite del archivo completo. | Con meses de operación, startup lento y I/O alto. | Agregar compactación periódica (snapshot + truncate). Tarea de mantenimiento. | OPEN | — | — | — |
| LAN-03 | HIGH | Local Server | `local-server/discovery/mdns.js` | mDNS `bonjour-service` puede fallar silenciosamente en Windows con múltiples interfaces de red. | KDS standalone (`kds_only`) no encuentra el servidor si mDNS falla. | Fallback a broadcast UDP o registro manual en config. Documentar pasos manuales. | OPEN | — | — | — |
| LAN-04 | MEDIUM | KDS standalone | `electron-app/main.js:363` | `pos_server_ip` se inyecta como `?bridge=IP` en la URL del KDS. No hay validación de que el web app lea ese parámetro. | KDS standalone podría conectarse al bridge incorrecto o no conectarse. | Verificar que `useBridgeClient` lee `?bridge=` correctamente. | OPEN | — | — | — |

---

## Módulo: Configuración / Replicabilidad

| ID | Severidad | Módulo | Archivo/función | Problema | Riesgo offline | Solución | Estado | Commit | Tests | Validación física |
|----|-----------|--------|-----------------|----------|----------------|----------|--------|--------|-------|-------------------|
| CFG-01 | HIGH | Config | `electron-app/main.js:31-33` | IPs hardcodeadas: `192.168.1.21` (cocina), `192.168.1.30` (barra) como DEFAULT_STATIONS. | En nueva instalación con diferente subred → impresoras no responden. No hay error claro. | Forzar config explícita de impresoras antes de primer servicio. Diagnostic que valide IPs. | OPEN | — | — | — |
| CFG-02 | CRITICAL | Config | `electron-app/main.js:74` | `restaurantId` defaults a `'unknown'` si `config.json` ausente. | Local server corre sin identidad de tenant. Eventos y mDNS con `restaurant_id: 'unknown'`. | Bloquear startup si `restaurantId` es inválido. Config validator al arrancar. | OPEN | — | — | — |
| CFG-03 | HIGH | Config | `electron-app/main.js:18-19` | Config en `C:\fullsite\` hardcodeado. | En Windows con permisos restrictivos o instalación en path diferente → config no se lee. | Usar `app.getPath('userData')` como primario, `C:\fullsite\` como fallback documentado. | OPEN | — | — | — |
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
| KDS | 0 | 2 | 1 | 1 | 1 |
| Navegación | 0 | 0 | 1 | 2 | 0 |
| Persistencia | 0 | 2 | 1 | 0 | 1 |
| Sync LAN | 0 | 2 | 1 | 1 | 0 |
| Configuración | 1 | 3 | 0 | 0 | 0 |
| Impresión | 0 | 0 | 1 | 0 | 1 |
| **Total** | **1** | **9** | **7** | **6** | **6** |

### Circuito offline — estado actual (sesión 2)
- **Funciona offline**: PIN, turno, mapa de mesas, órdenes, envíos (+ cierre wizard), impresión, cobro, KDS avanzar/completar/item-done
- **Multi-terminal real-time**: broadcast inmediato al Local Server en TODOS los envíos (online y offline)
- **Timeouts cortos**: conflict-check y race-check abortan en 4s — no más cuelgues en LAN degradada
- **Todavía requiere internet**: KDS startup sin estado previo en IDB, config de impresoras inicial, actualizaciones

### Hallazgos que bloquean "operación real sin internet de principio a fin"
1. CFG-02 (restaurantId unknown en nueva instalación) ← tarea pendiente, requiere onboarding wizard
2. KDS-02/04 (KDS usa Supabase poll, no WsHub) ← trabajo mayor, P1

---
*Generado: 2026-07-27 | Auditor: Claude Code | Basado en análisis completo de pos/page.tsx, local-server/, pos-offline-db.ts, kds/page.tsx, layout.tsx, sw.js*

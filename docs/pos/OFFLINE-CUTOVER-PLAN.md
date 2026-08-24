# Plan Offline → Cutover AMALAY

> Fundamentado en la prueba de campo del 2026-08-23 + investigación del código de prod (origin/main) + docs de sesión (`OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, `LOCAL-FIRST-RFC.md`, `OFFLINE-MASTER.md`, `OFFLINE-AUTH.md`). El cutover de Wansoft = **cuando esta checklist esté 100% certificada**, no antes.

## 1. Estado REAL (probado en campo, no supuesto)

**✅ Funciona sin internet (verificado hoy):**
- KDS muestra comandas (offline-puro, servido local por Pedro `127.0.0.1:7717/kds`).
- Mesero manda orden → **imprime comanda** + **sale en KDS** (vía Pedro/LAN). Probado en caja y entrada.
- Login por PIN offline (PBKDF2 cacheado, TTL 8h) — requiere un login online previo que llene el cache.
- Menú, mesas, turno: fallback en IndexedDB.
- La orden se **encola** idempotente (`sync_queue`, `save_operation_id`) y reintenta al reconectar.

**🔴 NO funciona sin internet (los 3 gaps reales del cutover):**
- **G1 — Abrir una mesa desde el mapa en frío.** Tras limpiar el cache del navegador, tocar una mesa no la abre offline. Causa raíz: el **Service Worker no reconstruye `/pos` offline de forma confiable** (ni con nav dura ni con nav cliente — no es el método de navegación). El "antes jalaba" era porque el cache viejo estaba tibio; al limpiarlo no se re-calienta bien.
- **G2 — Sesión/login offline en frío.** Si la app recarga sin internet y el `pos_staff_cache` no está fresco (>8h o limpiado), no re-autentica. TTL 8h insuficiente para operar 24/7.
- **G3 — Sync a Supabase muerto.** Las órdenes se guardan local pero **no suben a la nube** desde ~14-18 ago (`sync_queue: 271`, `last_supabase_sync` viejo). El OutboxWorker está en shadow-mode OFF por default (`local-server/index.js`, requiere `OFFLINE_OUTBOX_SHADOW=1`). Sin esto el dashboard/IA no tienen datos → bloqueante para cutover.

## 2. Por qué es frágil hoy (el diagnóstico de fondo)

El POS carga de `app.fullsite.mx/pos` (internet) y **depende del Service Worker cacheando todo** para offline. Eso es un parche: un POS que necesita que un cache del navegador esté "calientito" para abrir una mesa **nunca será confiable** para cutover. El KDS **no** tiene este problema porque **Pedro lo sirve local** (no depende de cachear internet). La solución de fondo es hacer el POS como el KDS.

## 3. Los dos caminos (y por qué el plan tiene 2 fases)

| | Fase 0 — Endurecer arquitectura actual | Fase 1 — Offline-puro (endgame) |
|---|---|---|
| Qué | Que el SW sirva `/pos` offline confiable + fix del sync + extender sesión | Servir `/pos` local desde Pedro (como el KDS) |
| Desbloquea | Cutover en la arquitectura web+SW | Cutover bulletproof, cold-boot sin internet |
| Esfuerzo | ~2-4 días | ~1-2 semanas |
| Riesgo | Medio (depende del SW, que ya probó ser caprichoso) | Bajo una vez hecho (no depende de cache) |

**Recomendación:** hacer **Fase 0 primero** (desbloquea el cutover más rápido) y **Fase 1 después** como el endurecimiento definitivo. No saltar directo a Fase 1 (semanas) si Fase 0 (días) ya te deja operar.

## 4. FASE 0 — Desbloquear offline en la arquitectura actual (~2-4 días)

**Objetivo:** que la checklist offline pase 100% con la arquitectura actual.

1. **G1 — SW sirve `/pos` offline confiable.**
   - Precache robusto: cachear `/pos` **autenticado** (HTML + los chunks JS del route + el RSC payload), no un redirect a login. Revisar `public/sw.js` (STATIC_ASSETS + warm de rutas línea ~79) — hoy calienta la ruta pero no garantiza el RSC/chunks del navegar cliente.
   - **Warm-on-login:** al loguear con éxito, forzar el cacheo de `/pos` y `/pos/mesas` (navegar/prefetch) para que quede tibio SIEMPRE.
   - Regla operativa temporal hasta esto: tras cualquier "clear site data" o reinstalación, **abrir una mesa una vez con internet** antes de operar offline (calienta el cache).
2. **G3 — Fix del sync a Supabase.** Investigar por qué el outbox no sube (shadow OFF? credencial? RPC?). Activar el camino de escritura diferida idempotente. **Este es tan importante como G1** — sin sync, offline no es "seguro".
3. **G2 — Extender sesión offline.** Subir el TTL del `pos_staff_cache` (hoy 8h → cubrir jornada larga/24-7) y asegurar que cada terminal haga 1 login online para llenar el cache.
4. **Certificar** la prueba de aceptación offline (§6) end-to-end en caja + entrada + KDS.

## 5. FASE 1 — Offline-puro (bulletproof, ~1-2 semanas)

Fundamento: `docs/product/LOCAL-FIRST-RFC.md`. El patrón ya existe (el KDS lo hace).

1. **Servir el POS local desde Pedro** (como `kds-ui.html`): activar el `output:'export'` (ya scaffolded en `next.config.ts`, hoy muerto) → Pedro sirve el bundle en `http://127.0.0.1:7717/pos`. El Electron carga esa URL local (como el KDS) → cold-boot sin internet jala.
2. **Mover `/api/pos/save-order` + `/api/pos/pin` a Pedro** (hoy son rutas Next.js que desaparecen en static export). Pedro ejecuta el RPC/lógica local con **JWT scoped por-tenant** (ya implementado en `local-server/index.js:55-81`) — **nunca la service_role key en la terminal**.
3. **Activar el OutboxWorker** (hoy shadow-OFF) → Pedro = autoridad de escritura local + sync diferido idempotente a Supabase.
4. **Caja vs secundarios:** caja = autoridad (escribe + imprime + outbox); secundarios = reenvían a la caja (patrón de forward ya construido); KDS = solo-lectura (ya resuelto).

**Contratos a NO romper** (de `LOCAL-FIRST-RFC.md`): idempotencia `command_id`/`save_operation_id` (event store append-only), `turno_id` obligatorio, invariante de pagos `sum(pagos)=total+propina`, `order_revision` server-managed, `MESA_LOCK` (anti doble-cobro), aislamiento `client_id`, fallback impresión bridge→BT→CSS, y NUNCA la service_role key en la terminal.

## 6. Certificación = gate del cutover (la prueba que debe pasar)

Sin internet, en frío:
1. Login por PIN ✅
2. Abrir cualquier mesa desde el mapa ✅
3. Orden → imprime comanda por estación ✅
4. Sale en el KDS ✅
5. Cobrar + cerrar + imprimir ticket ✅
6. Reconectar → todo sube a Supabase, nada se pierde (idempotente) ✅
7. Repetir en caja + entrada + escondite.

**Cuando esto pasa 100% → cutover.** Ni un paso antes.

## 7. Riesgos / notas
- El SW es caprichoso (probado hoy: limpiar cache rompió lo que jalaba). Fase 0 debe hacer el cacheo **determinista**, no dependiente de "usar la app antes".
- IP de la caja por DHCP puede cambiar → fijar IP estática.
- Conflicto de merge de misma orden desde 2 terminales offline: validar en campo (MESA_LOCK mitiga).

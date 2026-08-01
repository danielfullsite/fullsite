# KDS — Análisis de Gaps vs Wansoft

**Fecha:** 2026-07-31  
**Actualización:** 2026-07-31 — G-02 CLOSED, G-06 CLOSED (implementados en `barra/page.tsx`)  
**Scope:** `kds/page.tsx`, `pos/cocina/page.tsx`, `pos/barra/page.tsx`  
**Fuente:** Revisión funcional post-P2.5.5 (no visual)

---

## Resultado general

Fullsite supera a Wansoft en todas las dimensiones que Wansoft implementa (latencia, alertas de audio, auto-archive, tracking por ítem, reimpresión, detección de conflictos). Los gaps identificados son **internos** — paridad entre Cocina y Barra — más un gap estructural de configurabilidad de routing.

---

## Por área

### 1. Routing

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Routing de items a estación | `ImpresoraGrupo` DB — cada grupo de platillo mapea a una impresora/estación vía SP | `resolveItemStation()` — campo `station` del item o heurística por nombre | Match funcional |
| Configurabilidad de routing | Config por operador desde admin UI — reasignar un platillo sin deploy | **Sin UI de configuración** — cambiar el routing requiere modificar keywords en código | **GAP G-01 (P2)** |
| Latencia de llegada a KDS | Poll SQL Server cada 15s | Poll Supabase cada 2s + push events del bridge | Fullsite supera |

### 2. Estaciones

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Superficies KDS | Comandero APK (única pantalla Android) | `/kds`, `/pos/cocina`, `/pos/barra` | Fullsite supera |
| Filtro sub-categoría (panadería) | No observado | Cocina tiene tab de panadería | Fullsite supera |
| Órdenes de delivery en KDS | No integrado — Uber/Rappi como método de pago, no entra al KDS | Cocina fetches `delivery_orders` e inyecta en el stream de KDS | Fullsite supera |
| Órdenes de delivery en Barra | N/A | Barra ahora fetches `delivery_orders` igual que Cocina — inyecta en el stream de KDS | **CLOSED G-02** |

### 3. Estados

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Estados de orden | 4 estados (Abierta → Comandada → Impresa → Cobrada) | 4 estados (`enviada → preparando → lista → entregada`) | Match |
| Forward-only guard | Enforced via SP en SQL Server | In-memory rank comparison antes de avanzar | Fullsite supera (más explícito) |
| Tracking por ítem | No observado | Cocina: click por ítem → `preparando`/`listo` en localStorage; auto-avanza la orden al completar todos los ítems | Fullsite supera |
| Tracking por ítem en Barra | N/A | **Barra: solo advance a nivel de orden. Sin tracking individual de ítems.** | **GAP G-03 (P3)** |

### 4. Impresión

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Print inicial de comanda | RestPrintingApp.exe poll cada 15s → TCP printer | Bridge HTTP → BT fallback → retry queue (0–1s) | Fullsite supera |
| Reimpresión desde KDS | No observado | Botón "Reimprimir" en Cocina y Barra → `reprintByStation()` | Fullsite supera |
| Retry en reimpresión | N/A | **`reprintByStation` (botón KDS) no tiene retry queue. Un fallo es silencioso.** Print inicial sí tiene retry. | **GAP G-04 (P3)** |
| Multi-batch en comanda | N/A | Cocina: reprint por batch. Barra: reprint orden completa (no por batch) | Barra es más grueso |

### 5. Alertas

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Indicador de tiempo transcurrido | No observado | Ambas superficies muestran minutos + ícono de llama | Fullsite supera |
| Umbral de urgencia | N/A | Cocina: configurable desde Settings modal (localStorage, default 10 min). Barra: hardcoded 10 min | **GAP G-05 (P3) = KDS-GAP-04** |
| Alerta de audio | N/A | Cocina: 880+1100Hz al recibir órdenes nuevas. Barra: 660Hz. | Fullsite supera |
| Resumen de items pendientes | N/A | Cocina: sidebar con conteo por platillo ordenado por demanda | Fullsite supera |

### 6. Recuperación

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Operación offline | 100% — SQL Server es local; no requiere internet | Cocina y Barra: IDB + suscripción al bridge. Barra ahora tiene `useBridgeClient` — recibe push events durante outage de Supabase | **CLOSED G-06** |
| Auto-archive de órdenes stale | N/A | Ambas superficies auto-archivan >4h | Fullsite supera |
| Detección de conflictos en cancelación | N/A | Cocina: `save_operation_id` + `expected_revision` | Fullsite supera |

### 7. Operación continua

| Comportamiento | Wansoft | Fullsite | Estado |
|---|---|---|---|
| Intervalo de sync | 15s (poll SQL Server) | 2s (Cocina/Barra), 1.5s (KDS) | Fullsite supera |
| Push events | N/A | Cocina: bridge events `ORDER_SENT`, `ORDER_UPSERTED`, `KDS_ITEM_STATUS` | Fullsite supera |
| Push events en Barra | N/A | Barra tiene `useBridgeClient` — push events `ORDER_SENT`, `ORDER_UPSERTED`, `KDS_ITEM_STATUS`. Latencia = evento inmediato + poll cada 2s. | **CLOSED G-06** |

---

## Tabla de gaps registrados

| ID | Área | Gap | Severidad | Acción sugerida |
|---|---|---|---|---|
| G-01 | Routing | Sin UI de configuración de routing por platillo — requiere deploy para reasignar | P2 | Crear tabla `pos_station_routing` + UI en Settings |
| G-02 | Estaciones | Barra no recibía `delivery_orders` | ~~P2~~ **CLOSED** | Implementado 2026-07-31 en `barra/page.tsx` |
| G-03 | Estados | Barra sin tracking por ítem | P3 | Llevar el patrón item-click de Cocina a Barra |
| G-04 | Impresión | `reprintByStation` sin retry queue | P3 | Encolar en `sync_queue` con type `REPRINT` |
| G-05 | Alertas | Umbral de urgencia de Barra no lee de config | P3 | Ya documentado como KDS-GAP-04 |
| G-06 | Recuperación | Barra sin `useBridgeClient` — no recibía push events | ~~P2~~ **CLOSED** | Implementado 2026-07-31 en `barra/page.tsx` |

---

## Conclusión de paridad

Wansoft no tiene ventaja funcional en ninguna dimensión que Fullsite implemente. Los gaps P2 operativos (G-02, G-06) fueron cerrados 2026-07-31 — Barra ahora es funcionalmente idéntica a Cocina en las dimensiones de canal y resiliencia LAN.

**Gaps operativos abiertos:** ninguno para el siguiente cliente.

**Gaps P3 documentados (no bloqueantes):**
- G-01 (routing sin UI de configuración) — requiere tabla `pos_station_routing` + UI Settings
- G-03 (Barra sin tracking por ítem) — seguir patrón item-click de Cocina
- G-04 (reprint sin retry) — ya cerrado en P2.5.6 (PRN-GAP-01)
- G-05 (umbral de urgencia Barra hardcoded) — registrado como KDS-GAP-04

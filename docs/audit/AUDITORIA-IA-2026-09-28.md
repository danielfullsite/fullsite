# Auditoría de la inteligencia de Fullsite — 2026-09-28

> Revisión de código (lectura) + historial real de `agent_runs` (30 días, prod).
> Lo del **dashboard** (chat, voz, coach, agentes TS) quedó corregido en `feat/ia-confiable`;
> ver [`../ai/IA-DEL-DUENO.md`](../ai/IA-DEL-DUENO.md).
> Lo de **`.github/scripts`** queda pendiente — asignado a la línea de trabajo que retira
> Wansoft. Esta es la lista exacta.

## Corridas reales (30 días)

| Agente | Corridas | Exitosas |
|---|---|---|
| close-predictor | 722 | 22 |
| anomaly-detector | 717 | 12 |
| upselling | 701 | 0 |
| intraday-sales | 117 | 0 |
| daily-briefing | 27 | 0 |
| smoke-test | 348 | 21 |
| uptime-monitor | 166 | 13 |

## Pendientes en agentes de Python (`.github/scripts`, `.github/workflows`)

1. **Apagar crons de Wansoft:** scrapers (`wansoft-browser`, `wansoft-daily-mesero`,
   `wansoft-deep`, `wansoft-inventory`, `wansoft-mega`, `wansoft-menu-sync`, `ticket-detail`),
   `intraday-sales`, `wansoft-staleness`. Apagar `hermes` (su PATCH a `agent_results` cruza
   restaurantes: `hermes_agent.py:419`).
2. **Workflows sin `CLIENT_ID` truenan al importar `client_config`** (`client_config.py:22`):
   `auto86`, `speed-of-service`, `inventory-auto-order`, `cost-variance`, `crm-recompra`,
   `pos-daily-aggregator`. Pasar a la matriz de `tenants_activos.py` (patrón de
   `agents-hourly.yml`), igual que `agents-daily` / `agents-weekly` (hoy fijos en `amalay`).
3. **Regla única de venta** (`payment_status='pagada'` o nulo + `cerrada`) en
   `pos_daily_aggregator.py:124`, `pos_intraday_snapshot.py:120`, `speed_of_service.py:56`,
   `table_time_agent.py:97`, `cuadre.py:97`. Helper compartido en `agent_common.py`.
4. **Falla ≠ vacío:** quitar `return []` en lecturas fallidas: `antifraud_agent.py`
   (:91,:119,:199,:276,:292,:307), `supplier_monitor.py` (:59,:82,:94),
   `climate_events_agent.py:365`, `inventory_auto_order.py:41`, `speed_of_service.py:45`.
5. **Datos viejos como de hoy:** `daily_briefing.py:131` toma la última fila como "ayer" y el
   prompt dice que los datos "NO son stale" (:299, :317). `table_time_agent.py:310-314` usa el
   último día disponible como hoy. Freno de frescura (>48 h) sólo para afirmaciones de hoy; el
   histórico se puede seguir analizando.
6. **`close_predictor.py:121,162-169`:** normaliza la curva contra el último snapshot → la
   proyección siempre = lo ya vendido. Normalizar contra el perfil histórico.
7. **`orquestador.py:213`** no pasa `client_id` al disparar workflows (un 2º cliente vería
   datos de AMALAY); saludo fijo "AMALAY" (:132). El KB (`wansoft_query.py`) depende del login
   de Wansoft: toda pregunta falla. Reescribir sobre `fs_*`/`pos_*`.
8. **`pos_daily_aggregator.py`:** PATCH a `wansoft_daily?fecha=eq` sin filtro de restaurante
   (:76) y escribiría órdenes de prueba de AMALAY en `ops_daily` cierre (:351). No habilitar
   hasta corregir.
9. **Duplicados:** `proactive_alerts` ≈ `anomaly_detector`; `weekly_summary` ≈ `weekly_amalay`;
   `stock_alert` + `auto86` + `inventory_auto_order` se traslapan.
10. **Tablas `wansoft_*` sin filtro de restaurante** en `upselling_agent.py:84`,
    `kitchen_quality_agent.py:69`, `supplier_monitor.py:54`, `waste_detector.py:59,92`,
    `tips_analyzer.py:71,83`, `weekly_amalay.py:73,81`, `climate_events_agent.py:354`,
    `cost_variance_agent.py:92`, `proactive_alerts.py:150`, `daily_briefing.py:142`.

## Preguntas del dueño que aún no se contestan

- ¿Dónde pierdo dinero? → falta P&L con gastos, nómina, merma real vs teórica.
- ¿Qué platillo quito? → falta matriz popularidad × margen precalculada (`fs_*`).
- ¿Quién necesita capacitación? → faltan métricas por mesero desde el POS.
- ¿Qué sucursal rinde menos? → falta food cost y labor % por sucursal.

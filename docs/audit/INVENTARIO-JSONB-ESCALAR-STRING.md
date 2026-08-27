# Inventario: columnas `jsonb` guardadas como escalar de tipo string

**Medido:** 2026-08-27, base de AMALAY (`qjiomlvudfmzuvqvhwpk`), sólo lectura.
**Alcance del escaneo:** las 117 columnas `jsonb` de las tablas base de `public`.

## El defecto, en una línea

La columna es `jsonb`, pero el escritor manda el valor **ya serializado** (`json.dumps(...)`
en Python, `JSON.stringify(...)` en TypeScript) dentro de un cuerpo que el cliente HTTP
vuelve a serializar entero. PostgREST recibe texto y Postgres guarda un **escalar JSON de
tipo string**, no un objeto ni un arreglo.

```sql
select jsonb_typeof(evidence), evidence->>'sin_stock'
from agent_insights order by created_at desc limit 1;
-- "string", null      ← el dato entró, pero es inconsultable
```

Por qué sobrevive tanto tiempo: **no rompe nada visible**. Los lectores de la aplicación
desenvuelven el string (`typeof x === 'string' ? JSON.parse(x) : x`), así que la pantalla
pinta bien. Lo único que queda roto es la consulta desde SQL — `->>` devuelve NULL,
`jsonb_array_elements` revienta — y eso nadie lo nota hasta que alguien intenta construir
un reporte, una vista OCM o un agente encima del histórico.

## Cómo leer este inventario

| Grado | Significa |
|---|---|
| **HECHO** | Medido en producción en esta sesión, o leído en el fuente. Se cita el número o el archivo. |
| **INFERENCIA** | Deducido de evidencia indirecta y consistente, pero no verificado de punta a punta. |
| **PENDIENTE** | No se buscó todavía. La ausencia de dato **no** es evidencia de que esté bien. |

## Resumen

- **HECHO:** 40 columnas en 23 tablas tienen al menos una fila con escalar string.
- **HECHO:** ~14,431 valores afectados en total.
- **HECHO:** 2 columnas seguían escribiéndose mal el día de la medición. `agent_insights.evidence`
  subió de 2,057 a 2,058 filas durante la propia sesión de trabajo.
- **HECHO:** `wansoft_data.data` ya está corregido y migrado (PR #170 + migración
  `20260826140000`, corrida el 2026-08-27: 670 → 0 filas string, huella de contenido idéntica).

## Estado por columna

### Sangrando el día de la medición

| Columna | Malas / no nulas | Escritor | Lector | Estado |
|---|---|---|---|---|
| `agent_insights.evidence` | 2,058 / 2,058 (100%) | `agent_common.py` `create_insight` — **HECHO** | **ninguno en el repo** — HECHO (`getDeepTable` sólo se llama con `agent_results` y `agent_runs`) | **arreglado en este PR** |
| `pos_audit_log.details` | 1,314 / 1,330 (98.8%) | `pos-data.ts` `logAudit` — **HECHO**, confirmado porque las 16 filas sanas son exactamente `item_transferred` y `skimming_suspect`, las dos acciones que escriben las rutas de `/api/pos` | `pos/auditoria/page.tsx` — **rompía** con objeto (`.toLowerCase()`) | **arreglado en este PR** (lector + escritor) |
| `agent_events.evidence` | 0 hoy | `agent_common.py` `log_event` + `resolver_predicciones.py` — **HECHO** | `resolver_predicciones.evidencia_de` — tolera las dos — HECHO | **arreglado en este PR.** Marcaba 0 no por estar bien: los INSERT se rechazaban por un CHECK de `status` hasta el 2026-08-26. Estaba por empezar a llenarse. |

### Congelado — el escritor ya no corre

Los 9 workflows de scrapers de wansoft están `disabled_manually` y su última corrida fue el
2026-07-13, toda en `failure` — **HECHO**, vía `gh api .../actions/workflows`. Por eso estas
columnas no crecen.

| Columna | Malas / no nulas | Escritor | Estado |
|---|---|---|---|
| `wansoft_daily.meseros` / `.platillos_top` / `.ventas_por_grupo` / `.pago_metodos` | 903 / 903 c/u | `wansoft_backfill.py`, `intraday_sales.py` — **HECHO** | PENDIENTE |
| `wansoft_catalog.filters` / `.endpoints` / `.xlsx_sheets` | 172 / 151 / 71 | `agents/wansoft-explorer/src/supabase_client.py:49-52` — **HECHO** | PENDIENTE |
| `wansoft_waiter_categories.data` | 59 / 59 | `ticket_detail_scraper.py:490` — **HECHO** | PENDIENTE |
| `wansoft_persons_hourly.data` | 42 / 42 | `wansoft_deep_scraper.py:244` — **HECHO** | PENDIENTE |
| `wansoft_suppliers.data` | 42 / 42 | `wansoft_deep_scraper.py:643` — **HECHO** | PENDIENTE |
| `wansoft_menu_config` × 5 columnas | 38 / 38 c/u | `wansoft_browser_scraper.py:667-671` — **HECHO** | PENDIENTE |
| `wansoft_tips.data` | 31 / 36 | PENDIENTE | PENDIENTE |
| `wansoft_hourly.data` | 20 / 20 | `wansoft_backfill.py:252`, `intraday_sales.py:555` — **HECHO** | PENDIENTE |
| `wansoft_inventory.data` | 10 / 10 | `wansoft_browser_scraper.py:368` — **HECHO** | PENDIENTE |
| `wansoft_labor.data` | 10 / 10 | PENDIENTE | PENDIENTE |
| `wansoft_pnl.data` | 1 / 1 | `wansoft_deep_scraper.py:730` — **HECHO** | PENDIENTE |

### Dejó de sangrar, causa sin confirmar

| Columna | Malas / no nulas | Última fila mala | Estado |
|---|---|---|---|
| `pos_orders.items` | 1,829 / 6,316 (29%) | 2026-07-24 — **HECHO** | **PENDIENTE, y es el más importante de los que quedan.** Algo lo corrigió alrededor del 24 de julio; qué fue exactamente es INFERENCIA sin verificar. Hay que confirmar que el escritor actual está bien antes de dar por cerrado nada. |
| `ops_daily` × 4 columnas | 904 / 1,269 c/u | 2026-07-12 — **HECHO** | PENDIENTE. Es la tabla que consumen las vistas OCM. |
| `pos_orders.pagos` | 1 / 4,234 | PENDIENTE | PENDIENTE. Una sola fila — probablemente un caso suelto, pero es INFERENCIA. |

### Cola, sin medir cuándo dejaron de escribirse

| Columna | Malas / no nulas | Estado |
|---|---|---|
| `agent_results.data` | 1,035 / 1,049 | Escritor arreglado en la rama `fix/agent-results-jsonb` (sin mergear). Migración escrita, **no ejecutada**. |
| `pos_staff_shifts.breaks` | 52 / 52 | PENDIENTE |
| `pos_recipe_details.allergens` | 42 / 42 | PENDIENTE |
| `delivery_platform_payments.raw_json` | 36 / 36 | PENDIENTE |
| `delivery_orders.items` | 18 / 20 | PENDIENTE |
| `pos_cierres.billetes` / `.monedas` | 4 / 4 c/u | PENDIENTE |
| `clients.features` | 3 / 8 | PENDIENTE. **Es la peor de las chicas**: `features` decide qué ve cada tenant en el sidebar. |
| `clients.meseros` | 2 / 8 | PENDIENTE |
| `pos_promotions.category_ids` / `.item_ids` / `.schedule` | 2 / 2 c/u | PENDIENTE |

## Clonabilidad: qué hereda un tenant nuevo desde cero

La pregunta que importa para el Golden Skeleton es si un restaurante nuevo **nace** con este
defecto o no. Se responde por columna, no por tabla:

- **Nace limpio** si el único escritor ya está arreglado. Hoy: `wansoft_data.data`,
  `agent_insights.evidence`, `agent_events.evidence`, `pos_audit_log.details`.
- **Nace roto** si el escritor sigue serializando de más. Hoy: todo lo marcado PENDIENTE cuyo
  escritor esté vivo — en particular `clients.features` (se escribe al provisionar) y
  `ops_daily` (se llena desde el primer día de operación).
- **No aplica** a las columnas de wansoft: un tenant nuevo no tiene POS legado que scrapear.

**Criterio para declarar una columna cerrada** — las cuatro cosas, no tres:

1. El escritor manda el valor directo. Verificado por una prueba que mira el payload real,
   no el fuente.
2. El lector tolera las dos formas, **verificado antes** de tocar el escritor. El caso de
   `pos_audit_log` muestra por qué el orden importa: arreglar sólo el escritor habría
   cambiado un dato invisible por una pantalla de auditoría caída.
3. Hay una prueba que truena si alguien reintroduce cualquiera de las dos formas del bug
   (`json.dumps(x)` y `json.dumps(x) if not isinstance(x, str) else x`), con guarda contra
   pasar en vacío, y verificada por mutación.
4. Un tenant creado desde cero produce objetos desde su primera escritura. Mientras esto no
   se compruebe sobre un tenant real, la columna es INFERENCIA, no HECHO.

La migración del histórico **no** entra en el criterio: es opcional y aparte. Los lectores
toleran las dos formas, así que lo único que desbloquea migrar es consultar lo viejo desde
SQL.

## Trampa a evitar

Ya se cayó dos veces en ella y las dos veces costó meses:

1. **Parchar el lector en vez del escritor.** `deep_parse` en `stock_alert_agent.py` fue eso:
   deja al escritor libre de reincidir y el dato sigue sin ser consultable en SQL.
2. **Escribir una prueba que aserta el bug.** `test_resolver_predicciones.py` hacía
   `json.loads(payload["evidence"])` — daba por bueno que el escritor mandara texto. Una
   prueba así no protege: bendice. Corregida en este PR.

## Trabajo ya hecho

| PR / rama | Alcance | Estado |
|---|---|---|
| #170 `fix/wansoft-data-jsonb` | `wansoft_data.data` — 14 payloads, 9 scripts + 1 workflow | Abierto. Migración **ejecutada** el 2026-08-27 con respaldo. |
| `fix/agent-results-jsonb` | `agent_results.data` — 19 agentes | Sin pushear. Migración **no** ejecutada. |
| Este PR | `agent_insights.evidence`, `agent_events.evidence`, `pos_audit_log.details` | Sin migración: no se tocó ningún dato de AMALAY. |

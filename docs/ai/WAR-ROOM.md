# War Room — arquitectura multi-agente

> Referencia operativa: tentáculos, workflows, secrets, scripts y cómo agregar
> nuevos. Movido desde `CLAUDE.md` el 2026-08-24 — es un manual de consulta,
> no una regla que deba cargarse en cada sesión.
>
> **Nota de exactitud:** el registro de agentes aquí descrito quedó por delante de
> la realidad. Los agentes `orquestador` y `kb` son *skeleton*, no "active", y
> los 68 scripts de `.github/scripts/*.py` **no escriben `agent_events`** — sólo
> los 5 agentes TS de `dashboard-app/src/lib/agents/` cierran el bucle de valor.
> Ver `docs/audit/REVISION-2026-08-24.md`.

## War Room Multi-Agent Architecture

Sistema de agentes autónomos 24/7 que monitorean, reportan y alertan sobre operaciones de AMALAY. Stack 100% gratis.

### Diagrama de flujo

```
TRIGGERS (GitHub Actions cron / Telegram webhook)
        │
        ▼
  ┌─────────────────────────────────────────┐
  │          ORQUESTADOR (active)           │  ← Telegram inbound → Groq clasifica → despacha
  └─────────────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────────┐
  │              TENTÁCULOS                    │
  ├──────────────┬──────────────┬──────────────┤
  │   reportes   │     ops      │     kb       │  reseñas (skeleton)
  │  daily brief │  reservas    │ wansoft-query │
  │  weekly rep  │  wansoft     │  (24/7)      │
  └──────┬───────┴──────┬───────┴──────┬───────┘
         │              │              │
         ▼              ▼              ▼
    Supabase REST    Supabase REST   Wansoft Web
    + Groq API       + Groq API      + Groq API
         │              │              │
         ▼              ▼              ▼
      Telegram        Telegram       Telegram
                                   + agent_runs log
```

### Tentáculos — status

| Tentáculo | Status | Workflows | Blocker |
|---|---|---|---|
| `orquestador` | **active** | orquestador.yml (webhook via Cloudflare Worker) | — |
| `reportes` | **active** | daily-briefing (7am), weekly-amalay (lunes 9am) | — |
| `ops` | **active** | reservas-pendientes (10am), wansoft-staleness (8am) | — |
| `kb` | **active** | wansoft-query.yml (24/7 on-demand via orquestador) | — |
| `reseñas` | skeleton | gbp-monitor.yml (pendiente) | Google Cloud OAuth |

### Workflows activos

| Workflow | Archivo | Trigger | Tentáculo | Descripción |
|---|---|---|---|---|
| Orquestador | `orquestador.yml` | webhook (Telegram → CF Worker) | orquestador | Clasifica intent con Groq, despacha al tentáculo correcto |
| Daily Briefing | `daily-briefing.yml` | `0 13 * * *` (7am MX) | reportes | Briefing matutino completo |
| Weekly Report | `weekly-amalay.yml` | `0 15 * * 1` (lunes 9am MX) | reportes | Reporte ejecutivo semanal |
| Reservas Pendientes | `reservas-pendientes.yml` | `0 16 * * *` (10am MX) | ops | Alerta reservas sin confirmar/sin tel |
| Wansoft Staleness | `wansoft-staleness.yml` | `0 14 * * *` (8am MX) | ops | Alert si sync > 24h (silent si OK) |
| Wansoft Query | `wansoft-query.yml` | on-demand (via orquestador) | kb | Responde preguntas ad-hoc sobre ventas, meseros, platillos 24/7 |
| Agents Daily | `agents-daily.yml` | cron (7am, 4pm, 7pm MX) | ops | Config Validator + Kitchen Quality + Table Time |
| Agents Hourly | `agents-hourly.yml` | cron (2pm, 4pm, 6pm MX) | ops | Anomaly Detector + Close Predictor + Upselling |
| Agents Weekly | `agents-weekly.yml` | cron (Lun-Vie) | ops | Staffing + Menu Engineering + Suppliers + Waste + Anti-Fraud + Tips |
| Intraday Sales | `intraday-sales.yml` | cron | reportes | Reporte de ventas intraday |
| Wansoft Scraper | `wansoft-daily-mesero.yml` | cron (3pm avance, 8:30/11pm cierre) | ops | Scraper Playwright → parser → Telegram |

### Secrets requeridos en GitHub (Settings → Secrets → Actions)

| Secret | Descripción |
|---|---|
| `SUPABASE_URL` | `https://qjiomlvudfmzuvqvhwpk.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key (desde Supabase Dashboard → Settings → API) |
| `GROQ_API_KEY` | API key de Groq Cloud |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID_DANIEL` | Chat ID del destinatario |

### Scripts principales

| Script | Descripción |
|---|---|
| `daily_briefing.py` | Briefing matutino: reservas + calendar + wansoft → Groq → Telegram |
| `orquestador.py` | Router central: Telegram msg → Groq clasifica → dispatch workflow |
| `wansoft_query.py` | KB 24/7: pregunta natural → date detection → Wansoft scrape → Groq → Telegram |
| `client_config.py` | Config multi-tenant: fetcha client settings de Supabase (chat IDs, staff, TZ) |
| `anomaly_detector.py` | Detecta metricas fuera de patron historico |
| `close_predictor.py` | Predice cierre del dia a las 2pm/4pm/6pm |
| `upselling_agent.py` | Detecta oportunidades de upselling por mesero |
| `kitchen_quality_agent.py` | Monitorea cancelaciones vs baseline |
| `table_time_agent.py` | Analiza rotacion de mesas |
| `staffing_optimizer.py` | Sugiere horarios optimos (lunes) |
| `menu_engineering.py` | Clasifica platillos: estrellas, vacas, perros (lunes) |
| `antifraud_agent.py` | Detecta patrones de fraude en cancelaciones/descuentos (viernes) |
| `tips_analyzer.py` | Analisis de propinas por mesero (viernes) |

Todos siguen el patron: `client_config.get_client()` → fetch data → Groq/Claude → Telegram → log `agent_runs`.

### Tablas de agentes en Supabase (ya creadas)

- `agent_runs` — log de ejecuciones de todos los agentes (agent_id, status, duration_ms, tokens, tentacle)
- `agent_messages` — mensajería inter-agente (from_agent, to_agent, payload, read)

### Auth pendiente — qué se desbloquea con cada step

| Auth step | Cómo hacerlo | Se desbloquea |
|---|---|---|
| ~~Crear tablas `agent_runs` / `agent_messages`~~ | ~~SQL Editor~~ | ✅ Completado 2026-05-23 |
| ~~Cloudflare Worker webhook de Telegram~~ | ~~`telegram-orquestador-warroom`~~ | ✅ Completado — orquestador activo |
| Google Cloud OAuth (GBP API) | Ver `agents/reseñas/tools.md` — 5 pasos | Tentáculo `reseñas` — monitor de Google Maps |
| Meta Business + WhatsApp Business API | Meta Business Manager | WhatsApp inbound/outbound desde agentes |

### Cómo agregar un nuevo tentáculo

1. Crea carpeta `agents/nombre-tentaculo/` con 4 archivos:
   - `CONTEXT.md` — rol, scope, status, fuentes de datos
   - `system_prompt.md` — prompt para Groq (entre triple backticks)
   - `triggers.yml` — cuándo y cómo dispara
   - `tools.md` — APIs disponibles y pendientes
2. Crea `.github/scripts/nombre_script.py` (usa `daily_briefing.py` como plantilla)
3. Crea `.github/workflows/nombre-workflow.yml`
4. Agrega al `WORKFLOW_MAP` en `.github/scripts/orquestador.py`
5. Actualiza tabla de tentáculos en esta sección de CLAUDE.md

### Cómo agregar un nuevo workflow autónomo

1. Crea `.github/scripts/nombre_script.py` siguiendo el patrón de `daily_briefing.py`:
   - Leer config desde `os.environ`
   - Usar `sb_get()` / `sb_post()` para Supabase REST
   - Loguear en `agent_runs` al final
2. Crea `.github/workflows/nombre-workflow.yml` con:
   - `schedule` cron en UTC (MX = UTC-6, entonces 7am MX = `0 13 * * *`)
   - `workflow_dispatch` para testing manual
   - `env:` con todos los secrets necesarios
   - `TRIGGER_TYPE: ${{ github.event_name }}`
3. Setea cualquier secret nuevo: `gh secret set NOMBRE --repo ramonfaurdaniel-png/fullsite --body "valor"`
4. Test: `gh workflow run nombre-workflow.yml --repo ramonfaurdaniel-png/fullsite`
5. Watch: `gh run watch <run_id> --repo ramonfaurdaniel-png/fullsite`

### Orquestador Inbound Setup

El orquestador recibe mensajes de Telegram en tiempo real vía:
`Telegram → Cloudflare Worker → GitHub Actions → tentáculo → Telegram`

**Worker:** `telegram-orquestador-warroom` (cuenta `fd00e9e6edd331e0abe6d1e796f38172`)
**Código:** `cloudflare/orquestador-worker/src/index.ts`
**Deploy:** `bash cloudflare/orquestador-worker/deploy.sh` (requiere `CLOUDFLARE_API_TOKEN`, `GITHUB_PAT`, `TELEGRAM_BOT_TOKEN` en env)

**Secrets del Worker** (setear con `wrangler secret put`):
| Secret | Descripción |
|---|---|
| `GITHUB_TOKEN` | PAT con scope `workflow` — para disparar Actions desde el Worker |
| `TELEGRAM_BOT_TOKEN` | Token del bot |
| `WEBHOOK_SECRET` | String aleatorio — valida que el POST viene de Telegram |

**Routing del orquestador** (`agents/orquestador/system_prompt.md`):
| Mensaje | Tentáculo | Workflow disparado |
|---|---|---|
| `/start`, saludos | — | Menu de comandos |
| "dame el briefing" | reportes | `daily-briefing.yml` |
| "reporte semanal" | reportes | `weekly-amalay.yml` |
| "reservas pendientes" | ops | `reservas-pendientes.yml` |
| "wansoft sync" | ops | `wansoft-staleness.yml` |
| "cuanto vendimos hoy", "como vamos", "ticket promedio" | kb | `wansoft-query.yml` |
| "quien vendio mas", "top meseros", "propinas" | kb | `wansoft-query.yml` |
| Cualquier pregunta sobre datos del restaurante | kb | `wansoft-query.yml` |
| "reseñas", "google" | reseñas | skeleton |

**Re-deploy del Worker** (si cambias el código TypeScript):
```bash
! export CLOUDFLARE_API_TOKEN="..." && cd cloudflare/orquestador-worker && ~/.local/bin/wrangler deploy
```

**Ver logs en tiempo real:**
```bash
! ~/.local/bin/wrangler tail telegram-orquestador-warroom
```

**Re-configurar webhook de Telegram** (si cambia la URL del Worker):
```bash
! curl -F "url=https://telegram-orquestador-warroom.TU-SUBDOMINIO.workers.dev" \
       -F "secret_token=TU_WEBHOOK_SECRET" \
       "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
```

### Comandos útiles

```bash
# Trigger manual de cualquier workflow
gh workflow run daily-briefing.yml --repo ramonfaurdaniel-png/fullsite

# Ver últimos runs
gh run list --repo ramonfaurdaniel-png/fullsite --limit=10

# Ver logs completos de un run
gh run view <run_id> --repo ramonfaurdaniel-png/fullsite --log

# Ver/editar secrets de GitHub
gh secret list --repo ramonfaurdaniel-png/fullsite
gh secret set NOMBRE --repo ramonfaurdaniel-png/fullsite
```

# autonomous-agents

## Scope
Todos los agentes autónomos que corren en GitHub Actions: reportes diarios/semanales,
alertas operativas, y el orquestador que ruteea mensajes de Telegram al tentáculo correcto.

## Key files
- `.github/scripts/daily_briefing.py` — Fetch Supabase (reservas + calendario + wansoft_kpis) → Groq → Telegram → log en agent_runs. Cron 7am MX.
- `.github/scripts/reservas_pendientes.py` — Alerta reservas próximas 5 días con status=pending o sin teléfono. Silent success si no hay. Cron 10am MX.
- `.github/scripts/wansoft_staleness.py` — Verifica updated_at de wansoft_kpis. Alerta si >24h. No usa Groq. Cron 8am MX.
- `.github/scripts/weekly_amalay.py` — Reporte ejecutivo: wansoft_daily semana pasada vs anterior + reservaciones. Groq genera texto. Lunes 9am MX.
- `.github/scripts/orquestador.py` — Recibe mensaje de Telegram (vía INPUT_MESSAGE), clasifica con Groq, resuelve workflow, hace dispatch a GH Actions. Lee system_prompt de `agents/orquestador/system_prompt.md`.
- `.github/workflows/daily-briefing.yml` — `0 13 * * *` UTC + workflow_dispatch
- `.github/workflows/reservas-pendientes.yml` — `0 16 * * *` UTC + workflow_dispatch
- `.github/workflows/wansoft-staleness.yml` — `0 14 * * *` UTC + workflow_dispatch
- `.github/workflows/weekly-amalay.yml` — `0 15 * * 1` UTC + workflow_dispatch
- `.github/workflows/orquestador.yml` — solo workflow_dispatch, inputs: message + chat_id
- `.github/workflows/claude.yml` — TODO: revisar qué hace este workflow

## Architecture / Stack
- **Runtime:** GitHub Actions, ubuntu-latest, Python 3.11
- **Única dependencia:** `requests` (instalado con `pip install requests` en cada job)
- **LLM:** Groq `llama-3.3-70b-versatile` — temperature 0.1–0.3 según agente
- **DB:** Supabase REST API directa (no MCP) vía `SUPABASE_SERVICE_KEY`
- **Notificaciones:** Telegram Bot API, split automático en chunks de 4000 chars
- **Logging:** Todos los agentes escriben en tabla `agent_runs` (non-blocking — warn si falla)
- **Patrón de script:** `sb_get()` / `sb_post()` helpers → fetch data → format block → Groq → Telegram → log

### WORKFLOW_MAP (orquestador.py)
| Keyword | Workflow |
|---|---|
| briefing / ventas / reportes | daily-briefing.yml |
| semanal / weekly | weekly-amalay.yml |
| reservas / ops | reservas-pendientes.yml |
| wansoft / sync | wansoft-staleness.yml |
| kb / reseñas | None (skeleton) |

## Known issues / gotchas
- `orquestador.py` usa `dict[str, str]` type hint — requiere Python 3.10+. El workflow ya especifica 3.11, OK.
- `wansoft-staleness.py` **no usa Groq** (no tiene API key en env realmente necesaria, aunque el workflow la pasa).
- Si Groq JSON parse falla en orquestador, cae a keyword matching — funciona como fallback silencioso.
- `daily_briefing.py` usa la columna `calendar_sync_log` que requiere que Google Calendar esté sincronizando; si no hay sync, la sección Calendario queda vacía sin error.
- `wansoft_daily` puede tener días faltantes si el sync de Chrome Extension falló — weekly_amalay.py lo detecta pero solo como nota en el prompt de Groq.
- `agent_runs` y `agent_messages` deben existir en Supabase o el log falla silenciosamente.

## How to extend
1. Crea `.github/scripts/nombre.py` siguiendo el patrón de `daily_briefing.py`: config desde `os.environ`, `sb_get()`/`sb_post()` helpers, log en `agent_runs` al final.
2. Crea `.github/workflows/nombre.yml` con `schedule` + `workflow_dispatch` y los mismos `env:` secrets.
3. Agrega al `WORKFLOW_MAP` en `orquestador.py` con la keyword que el usuario diría en Telegram.
4. Actualiza `MENU` en `orquestador.py` para que el bot lo anuncie.
5. Para nuevos tentáculos skeleton (sin workflow aún), agrega el keyword con valor `None` y a `SKELETON_WORKFLOWS`.

# bug-triage

## Scope
Receptor central de alertas del War Room. Recibe notificaciones de errores
(workflows fallidos, caídas de KPIs, sync stale) y rutea al tentáculo
correspondiente para diagnóstico y fix.

## Key files
- `.github/scripts/wansoft_staleness.py` — Fuente de alertas de sync (>24h sin update)
- `.github/scripts/daily_briefing.py` — Si falla, alerta vía log en `agent_runs`
- `cloudflare/orquestador-worker/src/index.ts` — Recibe mensajes de Telegram que pueden ser reportes de error
- `.github/scripts/orquestador.py` — Clasifica mensajes; errores/bugs caen aquí si no matchean otro tentáculo
- `CLAUDE.md` (sección "War Room") — Mapa completo de workflows y tentáculos

## Architecture / Stack
- **Input:** alertas llegan por dos vías:
  1. **Telegram → Worker → orquestador.py** — usuario reporta error ("el briefing no llegó", "wansoft no actualiza")
  2. **GitHub Actions failure** — workflow falla, se puede ver con `gh run list --status failure`
- **Triage:** analizar el error (log del workflow, estado de Supabase, output de agent_runs) y determinar:
  - Qué tentáculo es responsable del fix
  - Si es un error transitorio (retry) o un bug real (fix)
- **Output:** spawn de worker en el tentáculo correcto con contexto del error

### Flujo
```
Alerta (Telegram / GH Actions failure)
  → bug-triage analiza log + contexto
  → Identifica tentáculo responsable:
    - Script Python roto → autonomous-agents
    - Worker CF caído → cloudflare-edge
    - Datos stale / tabla rota → data-infra
    - Dashboard roto → war-room-ui
    - Slash command falla → claude-commands
  → Spawn worker en tentáculo con instrucciones de fix
```

## Known issues / gotchas
- `agent_runs` es la fuente principal de diagnóstico — si la tabla no existe, el triage es ciego.
- Los workflows de GH Actions no notifican a Telegram automáticamente al fallar — hay que revisar manualmente o con `gh run list --status failure`.
- El orquestador no tiene keyword dedicada para "error" o "bug" — actualmente estos mensajes caen al fallback.

## How to extend
- Agregar keyword "error", "bug", "fallo", "no funciona" al `WORKFLOW_MAP` de `orquestador.py` para rutear a bug-triage.
- Crear workflow `bug-alert.yml` que corra diario y revise `gh run list --status failure --limit 5` + `agent_runs` con status=error.
- Agregar notificación automática de GH Actions failures a Telegram (GitHub webhook o action de terceros).

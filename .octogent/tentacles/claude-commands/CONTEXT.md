# claude-commands

## Scope
Los slash commands de Claude Code para consultar datos operativos de AMALAY en tiempo real,
más la configuración del MCP que los habilita. Permiten hacer queries a Supabase
directamente desde el chat sin escribir SQL.

## Key files
- `.claude/commands/morning-briefing.md` — Briefing completo: calendar_sync_log + amalay_reservaciones (hoy + 7 días) + wansoft_kpis. Acepta fecha como argumento, default hoy. Output estructurado en 5 secciones (A–E).
- `.claude/commands/reporte-amalay.md` — KPIs del día: wansoft_daily (o wansoft_kpis si no hay daily). Tablas: ventas, métodos de pago, top 3 categorías, reservaciones del día.
- `.claude/commands/top-meseros.md` — Ranking de meseros: agrega JSONB `meseros` de wansoft_daily con `jsonb_array_elements`. Acepta N días, default 7. Excluye SERVER1, APLICACIONES, MESERO EVENTO.
- `.claude/commands/proximas-reservas.md` — Lista reservaciones futuras agrupadas por fecha. Acepta N días, default 14. Filtra status != cancelled.
- `.mcp.json` — Config del MCP server `supabase-amalay`: `@supabase/mcp-server-supabase@latest --read-only --project-ref=qjiomlvudfmzuvqvhwpk`. **No imprimir contenido.**

## Architecture / Stack
- **MCP server:** `supabase-amalay` — npx, read-only, project-ref hardcodeado
- **Token:** `SUPABASE_ACCESS_TOKEN` desde env (definido en `~/.zshrc`)
- **Herramientas MCP disponibles:** `execute_sql`, `list_tables`, `list_extensions`, `get_logs`, `search_docs`, `get_project_url`, `get_publishable_keys`, entre otras
- **Skills instaladas (globales en `~/.claude/skills/`):** ~40+ skills incluyendo:
  - Desarrollo: `frontend-design`, `browse`, `investigate`, `health`, `cso`, `review`
  - Marketing: `ad-creative`, `ai-seo`, `copywriting`, `seo-audit`, `social-content`, `paid-ads`, `schema-markup`, `launch-strategy`, `web-design-guidelines`
  - Workflow: `ship`, `context-save`, `context-restore`, `plan-*`, `retro`
- **MCPs adicionales disponibles:** `claude_ai_Google_Calendar` (8 tools), `claude_ai_Google_Drive` (2 tools)

### Convenciones de output (aplicadas en todos los commands)
- Respuestas en español
- Fechas YYYY-MM-DD
- Montos en MXN: `$X,XXX.XX`
- Sin emojis salvo ⚠️ para data stale

## Known issues / gotchas
- `top-meseros.md` incluye un query SQL de referencia con `jsonb_array_elements` — Claude debe ejecutarlo via `execute_sql` del MCP, no como query REST.
- `morning-briefing.md` tiene lógica de timezone (UTC-6 / MX) para el filtro de `calendar_sync_log` — si los eventos están en UTC los cálculos deben ajustarse.
- Las skills en `~/.claude/skills/` son globales (no en el repo) — si se instala Claude Code en otra máquina, hay que reinstalar con `npx skills add`.
- No hay skills en `.claude/skills/` dentro del repo — TODO: evaluar si alguna skill específica de AMALAY debería estar versionada aquí.

## How to extend
- **Nuevo slash command:** crear `.claude/commands/nombre.md` con instrucciones en lenguaje natural. Usar `$ARGUMENTS` para parámetros. Referenciar tablas de `CLAUDE.md`.
- **Formato mínimo de command:**
  ```
  Usando el MCP supabase-amalay, [descripción].
  Argumentos: $ARGUMENTS. Si no se proporcionan, usar [default].
  ```
- **Nueva skill de proyecto:** crear `.claude/skills/nombre/` con `skill.md` y registrarla (ver docs de Claude Code skills).
- **Cambiar proyecto Supabase:** actualizar `project-ref` en `.mcp.json` y el token en `~/.zshrc`.

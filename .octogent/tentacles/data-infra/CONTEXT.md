# data-infra

## Scope
La capa de datos del sistema: Supabase como única fuente de verdad. Cubre el esquema
de tablas operativas de AMALAY, la configuración del MCP read-only para Claude Code,
y el contrato de acceso que usan los agentes autónomos.

## Key files
- `.mcp.json` — Configura `supabase-amalay` MCP server: `@supabase/mcp-server-supabase@latest --read-only --project-ref=qjiomlvudfmzuvqvhwpk`. Token en env `SUPABASE_ACCESS_TOKEN`. **No imprimir contenido.**
- `CLAUDE.md` (sección "Tablas principales") — Documentación canónica del esquema: columnas, tipos, descripción. Fuente de verdad para queries.
- No hay archivos `.sql` en el repo — las migraciones se corren manualmente en el SQL Editor de Supabase Dashboard.

## Architecture / Stack
- **Supabase project:** `qjiomlvudfmzuvqvhwpk` — `https://qjiomlvudfmzuvqvhwpk.supabase.co`
- **Dos modos de acceso:**
  1. **MCP (Claude Code):** read-only, usa `SUPABASE_ACCESS_TOKEN` desde `~/.zshrc`
  2. **REST directo (scripts GH Actions):** usa `SUPABASE_SERVICE_KEY` (write), accede vía `https://[proj].supabase.co/rest/v1/[tabla]`

### Tablas principales
| Tabla | Tipo | Descripción |
|---|---|---|
| `wansoft_kpis` | Fila única (id='amalay') | Estado en tiempo real — se sobreescribe en cada sync |
| `wansoft_daily` | Histórico por `fecha` (PK funcional) | Fuente para reportes históricos |
| `amalay_reservaciones` | Rows por evento | Reservaciones con status pending/confirmed/cancelled |
| `calendar_sync_log` | Eventos de Google Calendar | Sincronizados externamente |
| `agent_runs` | Log de ejecuciones de agentes | agent_id, status, duration_ms, tokens_in/out |
| `agent_messages` | Mensajería inter-agente | from_agent, to_agent, payload JSONB, read flag |
| `whatsapp_conversations` / `whatsapp_messages_log` | WhatsApp | Skeleton — sin integración activa |

### JSONB fields (wansoft_daily y wansoft_kpis)
Todos usan `[{nombre: string, total: number}]` como estructura:
- `meseros` — ventas por mesero
- `propinas_meseros` — propinas por mesero (puede estar vacío)
- `platillos_top` — mezcla platillos + meseros + grupos (filtrar con cuidado)
- `ventas_por_grupo` — ventas por categoría de menú
- `pago_metodos` — desglose por método de pago

## Known issues / gotchas
- `wansoft_daily` puede tener días faltantes si el sync de la Chrome Extension falló — no hay alerta automática por gaps históricos.
- `platillos_top` en wansoft_daily **mezcla platillos, meseros y grupos** en el mismo array — no es confiable para queries aislados por tipo.
- `wansoft_kpis` es una sola fila (no hay historial por fecha en esa tabla) — para histórico siempre usar `wansoft_daily`.
- `agent_runs` y `agent_messages` deben existir antes de que los agentes corran. El DDL está en `CLAUDE.md` sección "Tablas requeridas en Supabase".
- No hay `.sql` en el repo — cualquier cambio de esquema se hace en Supabase Dashboard y queda fuera del control de versiones.
- El MCP es **read-only** — INSERT/UPDATE/DELETE desde Claude Code están bloqueados por el flag `--read-only`.

## How to extend
- **Nueva tabla:** crearla en Supabase SQL Editor → documentar columnas en `CLAUDE.md` sección "Tablas principales".
- **Nuevo campo JSONB:** verificar que tiene estructura `{nombre, total}` o documentar la diferencia antes de usar.
- **Query desde scripts:** usar el patrón `sb_get(table, params)` de cualquier script existente — params es lista de tuplas `(key, value)` para filtros PostgREST.
- **Query desde Claude Code:** usar MCP `supabase-amalay` con `execute_sql` o `list_tables`. Siempre read-only.
- **Agregar tabla al MCP:** no requiere config extra — el MCP tiene acceso a todas las tablas del proyecto por project-ref.

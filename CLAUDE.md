# Fullsite / AMALAY — Contexto para Claude Code

## Security Rules

- Nunca imprimir el contenido de `.mcp.json`, `.env`, `~/.zshrc` en el chat ni en logs.
- Nunca escribir tokens reales en diffs visibles — redactar como `***REDACTED***`.
- Al editar archivos que contienen secretos, confirmar solo con "actualizado", sin mostrar el contenido completo.
- Estos archivos nunca deben trackearse en git (ya están en `.gitignore`).

## Proyecto

Restaurante AMALAY (Monterrey, MX). Este proyecto conecta Claude Code a los datos operativos del restaurante vía MCP de Supabase en modo read-only.

- **MCP:** `supabase-amalay` (read-only)
- **Proyecto Supabase:** `qjiomlvudfmzuvqvhwpk`
- **URL:** `https://qjiomlvudfmzuvqvhwpk.supabase.co`
- **Token:** variable de entorno `SUPABASE_ACCESS_TOKEN` (en `~/.zshrc`)

## Convenciones de output

- Respuestas en **español**
- Fechas en formato **YYYY-MM-DD**
- Montos en **MXN** con símbolo `$` y dos decimales (ej. `$1,234.56`)
- Formato **markdown** para reportes
- Tablas para rankings y comparativos
- Sin emojis salvo que se pidan explícitamente

## Datos — dónde está la verdad

**La fuente viva son las vistas OCM por-tenant:** `ocm_daily`, `ocm_waiter_rankings`,
`ocm_menu_groups`, `ocm_menu_items`.

`wansoft_daily` y `ops_daily` están **muertas** (sin datos desde jul-2026). No las uses
como fuente aunque el código viejo todavía las consulte (`api/chat`, `api/coach`,
`api/predict` siguen apuntando ahí — es deuda conocida, OCM Fase 3).

Esquema de las tablas legacy: [`docs/knowledge/wansoft/TABLAS-LEGACY.md`](docs/knowledge/wansoft/TABLAS-LEGACY.md).


## Slash commands disponibles

| Comando | Descripción |
|---|---|
| `/morning-briefing [fecha]` | Briefing matutino: calendario, reservaciones, KPI Wansoft y 3 acciones del día (default: hoy) |
| `/reporte-amalay [fecha]` | KPIs del día (default: hoy) |
| `/top-meseros [dias]` | Ranking de meseros (default: 7 días) |
| `/proximas-reservas [dias]` | Próximas reservaciones (default: 14 días) |

## GitHub Actions Workflows

Workflows en `.github/workflows/`. Stack: **GitHub Actions (gratis) + Groq + Supabase REST + Telegram**.

Arquitectura completa, tentáculos, secrets y cómo agregar workflows:
[`docs/ai/WAR-ROOM.md`](docs/ai/WAR-ROOM.md).


## Cómo agregar nuevas routines

1. Crea un archivo `.md` en `.claude/commands/nombre-comando.md`
2. El archivo debe contener las instrucciones en lenguaje natural para Claude
3. Usa `$ARGUMENTS` para recibir parámetros del usuario
4. Referencia el esquema en `docs/knowledge/wansoft/TABLAS-LEGACY.md` y las vistas `ocm_*`
5. Invoca el comando con `/nombre-comando [argumentos opcionales]`

**Ejemplo mínimo:**

```markdown
Consulta la vista ocm_daily vía MCP supabase-amalay y responde: $ARGUMENTS
```

**Patrón recomendado:**

```markdown
Usando el MCP supabase-amalay, ejecuta el siguiente análisis y presenta los resultados en markdown en español:

[descripción de lo que debe hacer]

Argumentos opcionales: $ARGUMENTS
Si no se proporcionan argumentos, usa [valor default].
```

## Notas operativas

- Para datos de negocio usa las vistas `ocm_*` (ver "Datos — dónde está la verdad")
- Los JSONB de meseros usan `nombre` y `total` como keys
- `platillos_top` en la BD actual mezcla platillos, meseros y grupos — filtrar con cuidado
- El MCP es **read-only**: no hacer INSERT, UPDATE ni DELETE

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

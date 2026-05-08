# Octogent SOP — Daniel (Fullsite / AMALAY)

## Inicio del día

1. Abrir terminal en `/Users/danielrg/fullsite`
2. Verificar Octogent está corriendo: `curl -s http://127.0.0.1:8787/api/health`
3. Si no responde: `octogent start` (los hooks en `.claude/settings.json` apuntan a :8787)
4. Revisar estado de tentáculos: `octogent status`
5. Abrir Claude Code — el hook SessionStart registra la sesión automáticamente

## Patrón de uso por tentáculo

| Tentáculo | Modo | Por qué |
|---|---|---|
| `data-infra` | **shared** | Esquema Supabase + MCP — ediciones afectan a todo el sistema, no aislar |
| `autonomous-agents` | **worktree** | Scripts Python + workflows GH Actions — cambios deben testearse aislados |
| `cloudflare-edge` | **worktree** | Worker TypeScript — deploy independiente, testear antes de merge |
| `war-room-ui` | **worktree** | HTML/CSS/JS estático — cambios visuales, previsualizar antes de merge |
| `claude-commands` | **worktree** | Slash commands .md — bajo riesgo pero mejor aislar para review |
| `bug-triage` | **shared** | Receptor de alertas — lee contexto de otros tentáculos, no modifica código |

## Cuándo usar swarm vs worker individual

- **Worker individual:** tareas enfocadas en un tentáculo (ej. "arreglar el daily briefing", "agregar nueva columna a Supabase")
- **Swarm:** tareas que cruzan tentáculos (ej. "nueva feature end-to-end: tabla Supabase + script Python + workflow GH + slash command")
- **Regla:** si la tarea toca 3+ tentáculos, swarm. Si toca 1-2, worker individual.

## Flujo típico de trabajo

```
octogent status                    # ver qué hay pendiente
octogent worker start <tentáculo>  # arrancar worker en el tentáculo
# ... trabajar en Claude Code ...
octogent worker stop               # al terminar
```

Para worktree:
```
octogent worktree create <tentáculo>  # crea branch aislado
# ... trabajar ...
# revisar cambios, merge manual
```

## Cierre del día

1. Verificar workers activos: `octogent status`
2. Detener workers que quedaron abiertos: `octogent worker stop --all`
3. Revisar branches pendientes: `git branch --list 'octogent/*'`
4. Prune worktrees huérfanos: `git worktree prune`
5. Commit y push cambios del día: `git add -A && git commit -m "..." && git push`
6. Opcional: `octogent stop` si no vas a usar más en el día

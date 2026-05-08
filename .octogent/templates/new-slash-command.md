# Template: Nuevo Slash Command

Crea un archivo `.claude/commands/{{NAME}}.md` con este contenido:

---

```markdown
Usando el MCP supabase-amalay, {{OUTPUT_DESC}}.

Argumentos: $ARGUMENTS
{{ARG_DESC}}

Tono: {{TONE}}

{{SKILLS}}

Presenta el resultado en markdown en español, montos en MXN ($X,XXX.XX), fechas YYYY-MM-DD.
```

---

## Variables

| Variable | Descripción | Ejemplo |
|---|---|---|
| `{{NAME}}` | Nombre del comando (kebab-case) | `analisis-semanal` |
| `{{ARG_DESC}}` | Descripción de argumentos y defaults | `Si se proporciona una fecha, úsala. Si no, usa hoy.` |
| `{{OUTPUT_DESC}}` | Qué debe hacer el comando | `genera un análisis comparativo de ventas semana actual vs anterior` |
| `{{TONE}}` | Tono del output | `ejecutivo, conciso, sin emojis` |
| `{{SKILLS}}` | Skills a activar (opcional) | `Activa la skill copywriting para el texto.` |

## Checklist post-creación

- [ ] Archivo creado en `.claude/commands/{{NAME}}.md`
- [ ] Probado con `/{{NAME}}` en Claude Code
- [ ] Documentado en `CLAUDE.md` sección "Slash commands disponibles"

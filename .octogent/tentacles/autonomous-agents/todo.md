# Todo - Autonomous Agents

- [ ] **BLOQUEADO** — POS sync vía Clip API (post-acquisition de Wansoft)
  - Subtareas:
    - [ ] Reunión con Eduardo Ezquivel (contacto Wansoft/Clip) sobre acceso API
    - [ ] Documentar autenticación Clip y endpoints disponibles
    - [ ] Implementar agents/wansoft/main.py con Clip API en lugar de scraper
    - [ ] Migrar wansoft_daily a wansoft_pos_data con schema nuevo si Clip difiere
  - Done cuando: nueva fila aparece en Supabase con timestamp >= hoy desde Clip API
  - Caveat: la promesa "sincronizamos tu POS cada 20 min" del landing no se cumple temporalmente — considerar disclaimer o pivot pitch hasta resolver

- [ ] Agregar try/except + retry en orquestador.py para Groq invalid JSON
  - En `orquestador.py`, el parse de JSON de Groq puede fallar silenciosamente
  - Agregar `try/except json.JSONDecodeError` con retry (max 2 intentos, backoff 1s)
  - Si retry falla, caer a keyword matching (ya existe como fallback)
  - Loguear el error en `agent_runs` con `status=error` y `error_message` con el raw response
  - **Done:** orquestador no se cae por JSON malformado + error queda en agent_runs

- [ ] Implementar agents/reseñas/main.py con Google Business Profile API
  - Prerequisito: Google Cloud OAuth configurado (ver `agents/reseñas/tools.md`)
  - Crear `agents/reseñas/main.py` siguiendo patrón de `daily_briefing.py`
  - Fetch reviews de GBP API → detectar nuevas (comparar con tabla `google_reviews` si existe)
  - Para cada nueva reseña: generar respuesta con Groq usando prompt de `/reseña-amalay`
  - Enviar respuesta sugerida a Telegram para aprobación manual
  - **Done:** reseñas nuevas llegan a Telegram con respuesta sugerida lista para copiar

- [ ] Logging estructurado a Supabase agent_runs en cada workflow
  - Auditar los 4 scripts activos: daily_briefing, reservas_pendientes, wansoft_staleness, weekly_amalay
  - Verificar que cada uno hace `sb_post("agent_runs", ...)` al final
  - Estandarizar campos: agent_id, trigger_type, status, duration_ms, tokens_in, tokens_out, tentacle
  - Agregar logging en caso de error (try/except en el main de cada script)
  - **Done:** `SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 10` muestra entradas de los 4 agentes

- [ ] Crear AGENTS.md raíz con índice de los 5 agentes y schedule
  - Listar los 4 agentes activos + orquestador con: nombre, script, workflow, cron, status
  - Incluir los 2 skeletons (kb, reseñas) con blocker
  - Documentar secrets requeridos y cómo verificarlos
  - **Done:** `AGENTS.md` existe en raíz, es consistente con `CLAUDE.md` sección War Room

> ⚠️ **DOCUMENTO HISTÓRICO / DESACTUALIZADO** (snapshot de julio 2026 — verificar antes de citar).
> Estado real vigente: los agents/*/CONTEXT.md reales + docs/audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md (orquestador/kb son skeleton, no "active"; 0 agentes certificados; agent_events no se escribe).

# AI — War Room Multi-Agente

> 26+ agentes autónomos que monitorean, reportan y alertan sobre operaciones de AMALAY.
> Stack 100% gratuito: GitHub Actions + Groq + Supabase REST + Telegram.

---

## Arquitectura

```
TRIGGERS (GitHub Actions cron / Telegram webhook)
        │
        ▼
  ┌─────────────────────────┐
  │      ORQUESTADOR        │  ← Telegram → Cloudflare Worker → GitHub Actions
  └─────────────────────────┘
        │
  ┌─────┴──────────────────────────────┐
  │            TENTÁCULOS              │
  ├──────────┬──────────┬──────────────┤
  │ reportes │   ops    │      kb      │
  │  daily   │ reservas │ wansoft-query│
  │  weekly  │ wansoft  │   (24/7)     │
  └────┬─────┴────┬─────┴──────┬───────┘
       │          │            │
       ▼          ▼            ▼
  Supabase    Supabase    Wansoft Web
  + Groq      + Groq      + Groq
       │          │            │
       ▼          ▼            ▼
   Telegram   Telegram    Telegram + agent_runs
```

---

## Tentáculos activos

| Tentáculo | Status | Workflows |
|---|---|---|
| `orquestador` | active | orquestador.yml (webhook via Cloudflare Worker) |
| `reportes` | active | daily-briefing (7am), weekly-amalay (lunes 9am) |
| `ops` | active | reservas-pendientes (10am), wansoft-staleness (8am) |
| `kb` | active | wansoft-query.yml (24/7 on-demand) |
| `reseñas` | skeleton | gbp-monitor.yml (pendiente Google Cloud OAuth) |

---

## Agentes activos (AI Ops v1)

5 agentes con cron cada 30 minutos, evidencia en `agent_events`:

| Agente | Función |
|---|---|
| Anomaly Detector | Detecta métricas fuera de patrón histórico |
| Close Predictor | Predice cierre del día a las 2pm/4pm/6pm |
| Upselling Agent | Detecta oportunidades por mesero |
| Kitchen Quality Agent | Monitorea cancelaciones vs baseline |
| Table Time Agent | Analiza rotación de mesas |

Tabla de log: `agent_events` (estimated_value, outcome, client_slug).

---

## Regla de expansión

**No agregar nuevos agentes por iniciativa propia.** Solo se agregan basados en:
- Falso positivo observado en producción
- Falso negativo observado en producción
- Feedback del gerente
- Datos de operación real
- Rendimiento medido en `agent_events`

Ver `AGENT-CERTIFICATION.md` para el protocolo de certificación antes de activar un agente.

---

## Configuración de agents/ en el repo

Los tentáculos tienen su configuración en `agents/` (raíz del repo):
- `agents/orquestador/` — router central
- `agents/kb/` — knowledge base 24/7
- `agents/ops/` — operaciones
- `agents/reportes/` — reportes
- `agents/reseñas/` — skeleton

Scripts en `.github/scripts/`. Workflows en `.github/workflows/`.

---

## Tabla de Supabase para inter-agente

- `agent_runs` — log de ejecuciones (agent_id, status, duration_ms, tokens, tentacle)
- `agent_messages` — mensajería inter-agente (from_agent, to_agent, payload, read)
- `agent_events` — eventos detectados con estimated_value + outcome

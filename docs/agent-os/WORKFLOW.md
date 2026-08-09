# Agent OS — Workflow y State Machine

## Ciclo autónomo

```
Readiness Contract
  ↓
Orchestrator identifica blocker ejecutable
  ↓
create_task.py → READY
  ↓
runner.py --role <ROLE> → IN_PROGRESS (Engineering/Verification)
  ↓
Agent trabaja (código, tests, análisis)
  ↓
submit_result.py → SUBMITTED
  ↓
submit_review.py → IN_REVIEW
  ↓ (VERIFIED)        ↓ (FAILED/PARTIAL, retry_count < MAX)
VERIFIED           CHANGES_REQUESTED → IN_PROGRESS (retry)
  ↓                    (si retry_count >= MAX → BLOCKED → Founder Decision)
create_decision.py → AWAITING_FOUNDER (FOUNDER-INBOX)
  ↓
Daniel: APROBAR / RECHAZAR / PEDIR CAMBIOS
  ↓ (APPROVED)
MERGED
  ↓
Orchestrator selecciona siguiente tarea
```

## Estados válidos

| Estado | Descripción |
|---|---|
| `DRAFT` | Borrador, no listo para ejecutar |
| `READY` | Listo para ser reclamado |
| `CLAIMED` | Reclamado, pendiente inicio |
| `IN_PROGRESS` | Engineering o Verification trabajando |
| `SUBMITTED` | Engineering entregó resultado |
| `IN_REVIEW` | Verification revisando |
| `CHANGES_REQUESTED` | Verification rechazó, enviado de vuelta |
| `VERIFIED` | Verification aprobó |
| `AWAITING_FOUNDER` | Esperando decisión del Founder |
| `APPROVED` | Founder aprobó |
| `REJECTED` | Founder rechazó |
| `MERGED` | Completado y cerrado |
| `BLOCKED` | Bloqueado (max retries o bloqueo externo) |
| `CANCELLED` | Cancelado |

## Transiciones válidas

```
DRAFT → READY | CANCELLED
READY → CLAIMED | CANCELLED
CLAIMED → IN_PROGRESS | READY
IN_PROGRESS → SUBMITTED | BLOCKED | CANCELLED
SUBMITTED → IN_REVIEW
IN_REVIEW → VERIFIED | CHANGES_REQUESTED | BLOCKED
CHANGES_REQUESTED → IN_PROGRESS
VERIFIED → AWAITING_FOUNDER | MERGED
AWAITING_FOUNDER → APPROVED | REJECTED | CHANGES_REQUESTED
APPROVED → MERGED
REJECTED → CANCELLED
BLOCKED → READY | CANCELLED
```

## Ubicación de archivos por estado

| Estado | Directorio |
|---|---|
| DRAFT, READY | `docs/agent-os/inbox/` |
| CLAIMED, IN_PROGRESS, CHANGES_REQUESTED, BLOCKED | `docs/agent-os/active/` |
| SUBMITTED | `docs/agent-os/results/` |
| IN_REVIEW, VERIFIED | `docs/agent-os/reviews/` |
| AWAITING_FOUNDER | `docs/agent-os/decisions/` |
| APPROVED, REJECTED, MERGED, CANCELLED | `docs/agent-os/archive/` |

## Regla de auto-loop Engineering ↔ Verification

Si `submit_review.py` emite FAILED o PARTIAL:
1. Si `retry_count < max_retries (3)`: tarea vuelve a IN_PROGRESS automáticamente
2. Si `retry_count >= max_retries`: tarea pasa a BLOCKED y se crea Founder Decision con diagnóstico

El Orchestrator nunca escala a Daniel mientras existan reintentos disponibles.

## Archivos del sistema

| Archivo | Descripción |
|---|---|
| `STATE.json` | Estado global del Agent OS |
| `TASKS.json` | Índice de todas las tareas |
| `AUDIT-LOG.ndjson` | Log append-only de todas las transiciones |
| `FOUNDER-INBOX.md` | Decisiones pendientes para Daniel |
| `CHATGPT-HANDOFF.md` | Contexto para revisión externa |
| `HEARTBEAT.json` | Estado del runner en tiempo real |
| `DAILY-DIGEST.md` | Reporte diario de progreso |
| `FULLSITE-READINESS-CONTRACT.md` | Definición de "listo" (congelado) |

## Comandos de operación

```bash
# Iniciar un ciclo de orquestación
python3 scripts/agent-os/orchestrator.py

# Ejecutar siguiente tarea para un rol
python3 scripts/agent-os/runner.py --role RUNTIME_VERIFICATION

# Ver inbox del Founder
python3 scripts/agent-os/show_founder_inbox.py

# Aprobar/rechazar/cambiar una decisión
python3 scripts/agent-os/approve_decision.py D-001
python3 scripts/agent-os/reject_decision.py D-001
python3 scripts/agent-os/request_changes.py D-001 "motivo"

# Validar integridad del sistema
python3 scripts/agent-os/validate_state.py

# Recuperar tareas atascadas
python3 scripts/agent-os/recover_stuck_tasks.py --reset

# Detener el sistema
python3 scripts/agent-os/stop_agent_os.py
```

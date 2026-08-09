# Fullsite Agent OS

Sistema autónomo de ingeniería continua para Fullsite.

**Misión:** Avanzar hacia Fullsite Readiness sin que Daniel gestione tareas manualmente. Solo interviene para decisiones irreversibles.

---

## Estructura

```
docs/agent-os/
├── README.md                        ← este archivo
├── FULLSITE-READINESS-CONTRACT.md   ← qué significa "listo" (CONGELADO)
├── AGENT-ROLES.md                   ← quién puede hacer qué
├── WORKFLOW.md                      ← state machine y comandos
├── POLICIES.md                      ← autonomía, límites, kill switch
├── STATE.json                       ← estado global del sistema
├── TASKS.json                       ← índice de tareas
├── AUDIT-LOG.ndjson                 ← log append-only de transiciones
├── FOUNDER-INBOX.md                 ← decisiones pendientes
├── CHATGPT-HANDOFF.md               ← contexto para revisión externa
├── HEARTBEAT.json                   ← estado del runner en tiempo real
├── DAILY-DIGEST.md                  ← reporte diario
├── templates/                       ← schemas JSON
├── inbox/                           ← tareas DRAFT/READY
├── active/                          ← tareas en progreso
├── results/                         ← resultados de Engineering
├── reviews/                         ← revisiones de Verification
├── decisions/                       ← decisiones AWAITING_FOUNDER
├── handoffs/                        ← archivo de handoffs a ChatGPT
└── archive/                         ← tareas terminadas
```

---

## Niveles de Readiness

| Nivel | Definición |
|---|---|
| **R1** | AMALAY Production Ready |
| **R2** | Client #2 Ready |
| **R3** | Scale Ready (20+ clientes) |
| **R4** | Operational Intelligence Ready |

Ver `FULLSITE-READINESS-CONTRACT.md` para los gates de cada nivel.

---

## Priorización del Orchestrator

1. Riesgos que bloquean producción (P0 Runtime Gaps)
2. Gates de R1 (AMALAY Prod)
3. Gates de R2/R3 en paralelo cuando R1 avanza
4. R4 en background

---

## Para Daniel

Solo necesitas responder cuando `FOUNDER-INBOX.md` tenga decisiones:

```bash
python3 scripts/agent-os/show_founder_inbox.py
python3 scripts/agent-os/approve_decision.py D-001
```

Kill switch de emergencia:
```bash
python3 scripts/agent-os/stop_agent_os.py
```

---

## Estado actual

Ver `HEARTBEAT.json` para el estado en tiempo real del runner.
Ver `FOUNDER-INBOX.md` para decisiones pendientes.

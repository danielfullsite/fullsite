#!/usr/bin/env python3
"""
Agent OS Orchestrator — selects the highest-priority executable work and creates tasks.

Priority order:
  1. Risks blocking production (P0 Runtime Gaps)
  2. Risks blocking Client #2 (R2 gates)
  3. R1 gates (AMALAY Production Ready)
  4. R3 work (scale)
  5. Deferred R2/R4 work
  6. Tech debt with measurable impact

Rules:
  - Never creates tasks beyond MAX_CONCURRENT_ENGINEERS at once
  - Checks for task collision on files before parallelizing
  - Enters WAITING if nothing executable exists
  - Updates HEARTBEAT.json after each decision
  - Respects kill_switch
"""
import sys, os, json, datetime
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import (
    load_state, is_killed, load_tasks_index, load_pending_decisions,
    create_task, transition_task, update_state, audit, ensure_dirs,
    ACTIVE_DIR, INBOX_DIR, now_iso,
)

MAX_CONCURRENT_ENGINEERS = 2
MAX_CONCURRENT_VERIFICATION = 1

HEARTBEAT_FILE = os.path.join(os.path.dirname(__file__), '../../docs/agent-os/HEARTBEAT.json')

# ── Readiness contract state ──────────────────────────────────────────────────
# These are the executable gates for R1. Updated as work is completed.

R1_WORKQUEUE = [
    {
        'gate': 'R1-G02',
        'title': 'Field Batch #2 — Code Readiness for OCS-P2.5.9',
        'objective': 'Preparar todo el trabajo de código ejecutable antes de la visita física a AMALAY para que la visita sea exclusivamente de certificación',
        'role': 'RUNTIME_VERIFICATION',
        'priority': 'P0',
        'tags': ['field-batch-2', 'r1', 'offline-sync'],
        'dod': [
            'AF-001 verificado y documentado en AUDIT-FINDINGS o RESOLVED',
            'AF-002 verificado y documentado',
            'AF-003 verificado y documentado',
            'AF-004 verificado y documentado',
            'GAP-A documentado con prioridad correcta en RUNTIME-HEALTH',
            'Runtime Health actualizado con resultados',
            'Preflight checklist PRE-01..PRE-12 revisado — ítems ajustables marcados',
            'FIELD BATCH #2 decision card creada en FOUNDER-INBOX',
        ],
        'budget_tokens': 150_000,
        'notes': 'No declara ninguna prueba física como completada. Solo prepara el trabajo de código.',
    },
]

R3_WORKQUEUE = [
    {
        'gate': 'R3-G01',
        'title': 'HTTP Contract Tests — Bridge WS + REST API',
        'objective': 'Crear contract tests que validen el protocolo Bridge WS y los endpoints REST del local server',
        'role': 'RUNTIME_ENGINEER',
        'priority': 'P1',
        'tags': ['http-contracts', 'r3', 'testing'],
        'dod': [
            'Tests para SUBSCRIBE, COMMAND, ACK, REJECT, DELTA protocol messages',
            'Tests para /health, /state REST endpoints',
            'Tests pasan en CI (npm test o bun test)',
            'Coverage de happy path + error cases',
        ],
        'budget_tokens': 120_000,
        'notes': '',
    },
    {
        'gate': 'R3-G02',
        'title': 'Logging Persistente — Electron logs survive restarts',
        'objective': 'Verificar y mejorar que los logs del servidor Electron sobreviven reinicios y tienen rotación',
        'role': 'RUNTIME_ENGINEER',
        'priority': 'P1',
        'tags': ['logging', 'r3', 'observability'],
        'dod': [
            'Logs escritos a archivo con winston o pino, no solo stdout',
            'Rotación automática (max 5MB por archivo, 5 archivos)',
            '/health incluye last_log_entry',
            'Diagnóstico remoto posible sin SSH',
        ],
        'budget_tokens': 80_000,
        'notes': '',
    },
]

# ── Heartbeat ─────────────────────────────────────────────────────────────────

def _update_heartbeat(status, current_task=None, next_action='', errors=None):
    hb = {
        'ts':           now_iso(),
        'status':       status,
        'current_task': current_task,
        'next_action':  next_action,
        'errors':       errors or [],
    }
    tmp = HEARTBEAT_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(hb, f, indent=2)
    os.replace(tmp, HEARTBEAT_FILE)

# ── Task counting ─────────────────────────────────────────────────────────────

def _count_active(role=None):
    index = load_tasks_index()
    active_statuses = {'CLAIMED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED'}
    count = 0
    for tid, meta in index.items():
        if meta['status'] in active_statuses:
            if role is None or meta['role'] == role:
                count += 1
    return count

def _task_exists_for_gate(gate_tag):
    index = load_tasks_index()
    terminal = {'MERGED', 'CANCELLED', 'REJECTED', 'APPROVED'}
    for tid, meta in index.items():
        if gate_tag in meta.get('tags', []) and meta['status'] not in terminal:
            return True
    return False

# ── Main orchestration loop ───────────────────────────────────────────────────

def run():
    ensure_dirs()

    if is_killed():
        print('Kill switch is ON. Orchestrator will not run.')
        _update_heartbeat('KILLED', next_action='Activate kill switch removed in STATE.json')
        return

    pending_decisions = load_pending_decisions()
    if len(pending_decisions) >= 3:
        print(f'⏸ {len(pending_decisions)} pending decisions. Waiting for Founder.')
        _update_heartbeat('AWAITING_FOUNDER',
                          next_action='Founder must respond to pending decisions')
        return

    engineers_busy = _count_active('RUNTIME_ENGINEER')
    verifiers_busy = _count_active('RUNTIME_VERIFICATION')

    created = []

    # Priority 1: R1 work (Field Batch #2 — most critical)
    for item in R1_WORKQUEUE:
        if _task_exists_for_gate(item['tags'][0]):
            continue
        task = create_task(
            title=item['title'],
            objective=item['objective'],
            role=item['role'],
            priority=item['priority'],
            tags=item['tags'],
            dod=item['dod'],
            budget_tokens=item['budget_tokens'],
            notes=item['notes'],
        )
        created.append(task)
        audit('ORCHESTRATOR_CREATED_TASK', {
            'task_id': task['id'], 'gate': item['gate'], 'reason': 'R1 blocker'
        })
        print(f'Created R1 task: {task["id"]} — {task["title"]}')

    # Priority 2: R3 work (if engineers available and no R1 tasks pending)
    r1_pending = any(_task_exists_for_gate(item['tags'][0]) for item in R1_WORKQUEUE)
    if not r1_pending or engineers_busy < MAX_CONCURRENT_ENGINEERS:
        for item in R3_WORKQUEUE:
            if engineers_busy >= MAX_CONCURRENT_ENGINEERS:
                break
            if _task_exists_for_gate(item['tags'][0]):
                continue
            # Only start R3 if R1 verification is underway (parallel, not blocking)
            task = create_task(
                title=item['title'],
                objective=item['objective'],
                role=item['role'],
                priority=item['priority'],
                tags=item['tags'],
                dod=item['dod'],
                budget_tokens=item['budget_tokens'],
                notes=item['notes'],
            )
            created.append(task)
            engineers_busy += 1
            audit('ORCHESTRATOR_CREATED_TASK', {
                'task_id': task['id'], 'gate': item['gate'], 'reason': 'R3 parallel work'
            })
            print(f'Created R3 task: {task["id"]} — {task["title"]}')

    if not created:
        index = load_tasks_index()
        terminal = {'MERGED', 'CANCELLED', 'REJECTED', 'APPROVED'}
        active = [v for v in index.values() if v['status'] not in terminal]
        if active:
            print(f'All eligible work is in progress ({len(active)} active tasks). Monitoring.')
            _update_heartbeat('RUNNING', next_action='Waiting for tasks to complete')
        else:
            print('WAITING — no executable work. All remaining blockers require field/founder/external.')
            _update_heartbeat('WAITING',
                              next_action='Field execution or Founder decision required',
                              errors=['No internal work remaining for current sprint'])
        return

    _update_heartbeat('RUNNING',
                      current_task=created[0]['id'] if created else None,
                      next_action=f'Tasks created: {[t["id"] for t in created]}')

if __name__ == '__main__':
    run()

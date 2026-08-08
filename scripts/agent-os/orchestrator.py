#!/usr/bin/env python3
"""
Agent OS Orchestrator v2 — pipeline-driven work selection.

Source of truth: docs/agent-os/PIPELINE.json (TARGET → GATES → EVIDENCE).
This module no longer hardcodes workqueues. Each cycle it:

  1. Reaps stale AGENT domain locks (sleep/crash safe — locks live on disk).
  2. Syncs gate status from task state (RUNNING/REVIEW/BLOCKED_TECH).
  3. Selects actionable gates (deps PASS, domain unlocked, retry budget left).
  4. Routes by execution class:
       AUTO_TECH           → create task + acquire domain lock (one writer/domain)
       HUMAN_PHYSICAL      → human queue + field visit pack (batched per location)
       FOUNDER_DECISION    → decision card (approval = gate PASS)
       PRODUCTION_APPROVAL → decision card; NEVER auto-executed
  5. Declares TARGET COMPLETE only when all REQUIRED gates = PASS (deterministic).

Never touches: frozen branches, externally-owned domains, production.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shared import (
    load_state, is_killed, load_tasks_index, load_pending_decisions,
    create_task, update_state, audit, ensure_dirs, now_iso,
    TERMINAL_STATUSES, DECISIONS_DIR, read_json,
)
import pipeline
import locks
import human_queue
from telegram_notify import notify as _tg

MAX_CONCURRENT_ENGINEERS = 2

TASK_ACTIVE_STATUSES = {'READY', 'CLAIMED', 'IN_PROGRESS', 'SUBMITTED',
                        'IN_REVIEW', 'CHANGES_REQUESTED', 'VERIFIED', 'AWAITING_FOUNDER'}


def _gate_tag(gate_id: str) -> str:
    return f'gate:{gate_id}'


def _tasks_for_gate(index: dict, gate_id: str) -> list:
    tag = _gate_tag(gate_id)
    return [(tid, m) for tid, m in index.items() if tag in m.get('tags', [])]


def _active_task_for_gate(index: dict, gate_id: str):
    for tid, m in _tasks_for_gate(index, gate_id):
        if m['status'] in TASK_ACTIVE_STATUSES:
            return tid, m
    return None, None


def _count_active_engineers(index: dict) -> int:
    return sum(1 for m in index.values()
               if m['status'] in ('READY', 'CLAIMED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
               and m.get('role') == 'RUNTIME_ENGINEER')


# ── Gate ↔ task status sync ───────────────────────────────────────────────────

def _sync_gates_from_tasks(index: dict):
    p = pipeline.load_pipeline()
    _, target = pipeline.active_target(p)
    if not target:
        return
    for gid, gate in target.get('gates', {}).items():
        if gate.get('status') in ('PASS', 'DEFERRED'):
            continue
        tid, meta = _active_task_for_gate(index, gid)
        if meta:
            desired = None
            if meta['status'] in ('READY', 'CLAIMED'):
                desired = 'CLAIMED'
            elif meta['status'] in ('IN_PROGRESS', 'CHANGES_REQUESTED'):
                desired = 'RUNNING'
            elif meta['status'] in ('SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'AWAITING_FOUNDER'):
                desired = 'REVIEW'
            if desired and gate.get('status') != desired:
                pipeline.set_gate_status(gid, desired, by='ORCHESTRATOR',
                                         note=f'task {tid} is {meta["status"]}')
        else:
            # No active task. If a task for this gate ended BLOCKED → BLOCKED_TECH.
            blocked = [tid for tid, m in _tasks_for_gate(index, gid)
                       if m['status'] == 'BLOCKED']
            if blocked and gate.get('status') not in ('BLOCKED_TECH', 'FAIL'):
                pipeline.set_gate_status(gid, 'BLOCKED_TECH', by='ORCHESTRATOR',
                                         note=f'task {blocked[-1]} blocked after max retries')
                pipeline.record_gate_failure(gid, f'task_blocked:{blocked[-1]}')
            # If gate was CLAIMED/RUNNING/REVIEW but its task vanished/cancelled → back to READY
            elif gate.get('status') in ('CLAIMED', 'RUNNING', 'REVIEW'):
                if gate.get('execution_class', 'AUTO_TECH') == 'AUTO_TECH' and \
                   gate.get('owner') is None or (gate.get('owner') or '').startswith('AGENT'):
                    pipeline.set_gate_status(gid, 'READY', by='ORCHESTRATOR',
                                             note='no active task — re-eligible')


# ── Decision cards for FOUNDER_DECISION / PRODUCTION_APPROVAL gates ───────────

def _decision_exists_for_gate(gate_id: str) -> bool:
    if not os.path.isdir(DECISIONS_DIR):
        return False
    for fn in os.listdir(DECISIONS_DIR):
        if fn.startswith('D-') and fn.endswith('.json'):
            d = read_json(os.path.join(DECISIONS_DIR, fn), {})
            if d.get('gate_id') == gate_id and d.get('status') == 'AWAITING_FOUNDER':
                return True
    return False


def _ensure_gate_decision(gate: dict):
    gid = gate['id']
    if _decision_exists_for_gate(gid):
        return
    from shared import create_decision, write_json, read_json as _rj
    icon = '🔴' if gate.get('execution_class') == 'PRODUCTION_APPROVAL' else '🟡'
    d = create_decision(
        task_id=None,
        objective=f'{icon} {gate["title"]}',
        what_changed=gate.get('evidence_required', ''),
        why_it_matters=f'Gate {gid} ({gate.get("cert_level")}) bloquea el target CLIENT_2_READY',
        verification=gate.get('cert_level', ''),
        risk='ALTO' if gate.get('execution_class') == 'PRODUCTION_APPROVAL' else 'MEDIO',
        action_requested='APROBAR' if gate.get('execution_class') == 'FOUNDER_DECISION'
                         else 'APROBAR EJECUCIÓN EN PRODUCCIÓN',
        skip_gap_gate=True,
    )
    # Tag the decision with its gate so approval propagates to the pipeline
    from shared import _decision_path
    path = _decision_path(d['id'])
    dd = _rj(path)
    dd['gate_id'] = gid
    write_json(path, dd)
    pipeline.set_gate_status(gid, 'BLOCKED_DECISION', by='ORCHESTRATOR',
                             note=f'Decision {d["id"]} created')
    _tg('DECISION_REQUIRED', {'task_id': gid, 'title': gate['title'],
                              'decision_id': d['id']})


def reconcile_gate_decisions():
    """Propagate archived/answered gate decisions to gate status.
    Called by supervisor after decision reconciliation."""
    from shared import ARCHIVE_DIR
    if not os.path.isdir(ARCHIVE_DIR):
        return
    p = pipeline.load_pipeline()
    _, target = pipeline.active_target(p)
    if not target:
        return
    for fn in os.listdir(ARCHIVE_DIR):
        if not (fn.startswith('D-') and fn.endswith('.json')):
            continue
        d = read_json(os.path.join(ARCHIVE_DIR, fn), {})
        gid = d.get('gate_id')
        if not gid or gid not in target.get('gates', {}):
            continue
        gate = target['gates'][gid]
        if gate.get('status') in ('PASS', 'DEFERRED'):
            continue
        if d.get('response') == 'APPROVED':
            pipeline.set_gate_status(gid, 'PASS', by='FOUNDER',
                                     note=f'Decision {d["id"]} approved',
                                     evidence={'decision_id': d['id'],
                                               'note': 'Founder approval'})
        elif d.get('response') == 'REJECTED':
            pipeline.set_gate_status(gid, 'DEFERRED', by='FOUNDER',
                                     note=f'Decision {d["id"]} rejected — deferred')


# ── Human physical gates ──────────────────────────────────────────────────────

HUMAN_SPECS = {
    'REL-OFFLINE-FIELD': {
        'title': 'Certificación física offline OCS-P2.5.9 en AMALAY',
        'location': 'AMALAY',
        'why': 'Único gate que valida offline real en hardware real; bloquea GO-LIVE Client #2',
        'estimated_time': '90 min',
        'preparation_completed': 'Field Package v2 canónico (v1.3.4), THURSDAY-RUNBOOK.md, OFFLINE-TEST-MATRIX.md, FIELD-KIT scripts listos',
        'do_exactly': [
            'Lleva laptop + USB con FULLSITE-FIELD-KIT (docs/agent-os/field/)',
            'Sigue docs/agent-os/field/THURSDAY-RUNBOOK.md paso a paso',
            'Ejecuta cada escenario de OFFLINE-TEST-MATRIX.md y anota PASS/FAIL',
            'Ante un FAIL: detén el caso, captura evidencia (RUN-CERT-CAPTURE.cmd) y continúa con el siguiente escenario independiente',
        ],
        'expected_result': 'Matriz completa con PASS/FAIL por escenario + capturas',
        'return_evidence': 'Fotos de tickets, archivo de captura del FIELD-KIT, matriz marcada',
        'safe_failure': 'ROLLBACK.ps1 del FIELD-KIT restaura el estado previo; el POS de AMALAY sigue en su versión actual si no instalas',
    },
}


def _ensure_human_gates(gates: list):
    created = False
    for g in gates:
        if g.get('execution_class') != 'HUMAN_PHYSICAL':
            continue
        spec = HUMAN_SPECS.get(g['id'], {
            'title': g['title'],
            'location': g.get('location', 'AMALAY'),
            'why': g.get('evidence_required', ''),
            'do_exactly': ['Ver evidencia requerida del gate'],
            'expected_result': g.get('evidence_required', ''),
            'return_evidence': 'Evidencia descrita en el gate',
            'safe_failure': 'No destructivo',
        })
        if human_queue.ensure_human_task(g['id'], spec):
            created = True
        if g.get('status') != 'BLOCKED_HUMAN':
            pipeline.set_gate_status(g['id'], 'BLOCKED_HUMAN', by='ORCHESTRATOR',
                                     note='Queued in human queue / field visit pack')
    summary = human_queue.render_field_visit_pack()
    if summary and created:
        _tg('FIELD_ACTION', {'task_id': 'FIELD-PACK', 'summary': summary},
            dedup_ttl_s=6 * 3600)


# ── AUTO_TECH task creation ───────────────────────────────────────────────────

def _create_gate_task(gate: dict):
    gid = gate['id']
    domain = gate.get('domain')
    # One writer per domain: if another agent task holds the domain, wait.
    if domain and domain in locks.load_locks():
        return None
    task = create_task(
        title=f'{gid} — {gate["title"]}',
        objective=(
            f'{gate.get("evidence_required", "")}\n\n'
            f'GATE: {gid} · dominio: {domain} · cert level objetivo: {gate.get("cert_level")}\n'
            'Contexto: este task implementa un gate del pipeline CLIENT_2_READY. '
            'Reconcilia SIEMPRE contra el estado actual del repo antes de asumir docs como verdad. '
            'NO toques: branches bug-019/*, wave1/*, release/offline-field-*, producción, secretos.'
        ),
        role='RUNTIME_ENGINEER',
        priority=gate.get('priority', 'P1'),
        tags=[_gate_tag(gid), domain or 'general'],
        dod=[gate.get('evidence_required', 'Evidencia verificable del gate'),
             'Tests deterministas incluidos y en verde',
             'Commit en el branch del task (nunca push, nunca merge manual)'],
        budget_tokens=150_000,
        execution_class='AUTO_TECH',
        gate_id=gid,
        domain=domain,
        notes=gate.get('notes', ''),
    )
    ok = locks.acquire(domain, owner=f'AGENT:{task["id"]}', task_id=task['id'],
                       branch=f'agent-os/{task["id"]}') if domain else True
    if not ok:
        # Someone else holds the domain — cancel and retry next cycle
        from shared import transition_task
        transition_task(task['id'], 'CANCELLED', by='ORCHESTRATOR',
                        note=f'Domain {domain} locked — will retry')
        return None
    pipeline.set_gate_status(gid, 'CLAIMED', by='ORCHESTRATOR',
                             note=f'Task {task["id"]} created')
    audit('ORCHESTRATOR_CREATED_TASK', {'task_id': task['id'], 'gate': gid,
                                        'domain': domain})
    print(f'Created task {task["id"]} for gate {gid}')
    return task


# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    ensure_dirs()

    if is_killed():
        print('Kill switch ON — orchestrator paused.')
        return

    locks.reap_stale_agent_locks()
    index = load_tasks_index()
    _sync_gates_from_tasks(index)
    reconcile_gate_decisions()

    r = pipeline.readiness()
    if r['target'] is None:
        print('No active target — idle.')
        return

    if r.get('complete'):
        state = load_state()
        if state.get('notes') != f'TARGET_COMPLETE:{r["target"]}':
            _tg('TARGET_COMPLETE', {'task_id': r['target'],
                                    'pass': r['required_pass'],
                                    'total': r['required_total']},
                dedup_ttl_s=86400)
            update_state({'notes': f'TARGET_COMPLETE:{r["target"]}'})
            audit('TARGET_COMPLETE', r)
        print(f'🏁 TARGET {r["target"]} COMPLETE ({r["required_pass"]}/{r["required_total"]})')
        return

    actionable = pipeline.actionable_gates(locked_domains=locks.locked_domains())

    # Human/decision gates are actionable regardless of engineer capacity
    p = pipeline.load_pipeline()
    _, target = pipeline.active_target(p)
    gates_all = target.get('gates', {})
    human_gates = [{**g, 'id': gid} for gid, g in gates_all.items()
                   if g.get('execution_class') == 'HUMAN_PHYSICAL'
                   and g.get('status') in ('BACKLOG', 'READY', 'BLOCKED_HUMAN')
                   and pipeline.deps_met(g, gates_all)]
    _ensure_human_gates(human_gates)

    decision_gates = [{**g, 'id': gid} for gid, g in gates_all.items()
                      if g.get('execution_class') in ('FOUNDER_DECISION', 'PRODUCTION_APPROVAL')
                      and g.get('status') in ('BACKLOG', 'READY', 'BLOCKED_DECISION')
                      and pipeline.deps_met(g, gates_all)]
    for g in decision_gates:
        _ensure_gate_decision(g)

    # AUTO_TECH gates → tasks, bounded by engineer capacity
    capacity = MAX_CONCURRENT_ENGINEERS - _count_active_engineers(index)
    created = 0
    for g in actionable:
        if capacity <= 0:
            break
        if g.get('execution_class', 'AUTO_TECH') != 'AUTO_TECH':
            continue
        tid, _m = _active_task_for_gate(index, g['id'])
        if tid:
            continue
        if _create_gate_task(g):
            created += 1
            capacity -= 1

    print(f'Readiness {r["required_pass"]}/{r["required_total"]} '
          f'({r["pct"]}%) · actionable={len(actionable)} · created={created}')


if __name__ == '__main__':
    run()

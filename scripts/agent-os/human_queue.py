"""Agent OS Human Queue — HUMAN_PHYSICAL tasks and Field Visit Packs.

HUMAN-QUEUE.json:
  { "<gate_id>": { gate_id, title, location, why, gate_blocked, actionable_now,
                   estimated_time, preparation_completed, do_exactly [steps],
                   expected_result, return_evidence, safe_failure,
                   status: PENDING|DONE, created_at, done_at, evidence } }

Field Visit Packs batch all PENDING+actionable items for the same location so
Daniel makes ONE trip. Rendered to FIELD-VISIT-PACK.md and notified via
Telegram (deduplicated).
"""
import os
from collections import defaultdict

from shared import AOS_ROOT, FileLock, read_json, write_json, audit, now_iso

QUEUE_FILE = os.path.join(AOS_ROOT, 'HUMAN-QUEUE.json')
PACK_FILE = os.path.join(AOS_ROOT, 'FIELD-VISIT-PACK.md')


def load_queue() -> dict:
    return read_json(QUEUE_FILE, {})


def ensure_human_task(gate_id: str, spec: dict) -> bool:
    """Idempotent: add a human task for a gate if not already queued/done.
    Returns True if newly created."""
    with FileLock(QUEUE_FILE):
        q = load_queue()
        if gate_id in q:
            return False
        q[gate_id] = {
            'gate_id': gate_id,
            'title': spec.get('title', gate_id),
            'location': spec.get('location', 'AMALAY'),
            'why': spec.get('why', ''),
            'gate_blocked': gate_id,
            'actionable_now': spec.get('actionable_now', True),
            'estimated_time': spec.get('estimated_time', '15 min'),
            'preparation_completed': spec.get('preparation_completed', ''),
            'do_exactly': spec.get('do_exactly', []),
            'expected_result': spec.get('expected_result', ''),
            'return_evidence': spec.get('return_evidence', ''),
            'safe_failure': spec.get('safe_failure', ''),
            'status': 'PENDING',
            'created_at': now_iso(),
            'done_at': None,
            'evidence': None,
        }
        write_json(QUEUE_FILE, q)
    audit('HUMAN_TASK_CREATED', {'gate_id': gate_id, 'location': spec.get('location', '')})
    return True


def complete_human_task(gate_id: str, evidence: str, by: str = 'FOUNDER'):
    """Record evidence and mark DONE. Dependent gates resume automatically on
    the next orchestrator cycle (their dependency reads gate status)."""
    with FileLock(QUEUE_FILE):
        q = load_queue()
        if gate_id not in q:
            raise KeyError(f'{gate_id} not in human queue')
        q[gate_id]['status'] = 'DONE'
        q[gate_id]['done_at'] = now_iso()
        q[gate_id]['evidence'] = evidence[:2000]
        write_json(QUEUE_FILE, q)
    audit('HUMAN_TASK_DONE', {'gate_id': gate_id, 'by': by, 'evidence': evidence[:200]})
    # Human evidence certifies the gate directly (PHYSICAL cert path)
    try:
        import pipeline
        pipeline.set_gate_status(gate_id, 'PASS', by=by,
                                 note='Human evidence received',
                                 evidence={'human_evidence': evidence[:500]})
    except Exception:
        pass


def pending_by_location() -> dict:
    packs = defaultdict(list)
    for gid, t in load_queue().items():
        if t['status'] == 'PENDING' and t.get('actionable_now'):
            packs[t.get('location', 'AMALAY')].append(t)
    return dict(packs)


def render_field_visit_pack() -> str:
    """Write FIELD-VISIT-PACK.md batching all pending tasks per location.
    Returns a short summary string ('' if nothing pending)."""
    packs = pending_by_location()
    lines = ['# FIELD VISIT PACK', '', f'*Actualizado: {now_iso()}*', '']
    if not packs:
        lines.append('> No hay tareas físicas pendientes.')
    summary_parts = []
    for location, tasks in packs.items():
        total_min = 0
        for t in tasks:
            try:
                total_min += int(str(t.get('estimated_time', '15')).split()[0])
            except Exception:
                total_min += 15
        summary_parts.append(f'{location}: {len(tasks)} tareas (~{total_min} min)')
        lines += [f'## LOCATION: {location}',
                  f'**Tiempo total estimado:** ~{total_min} min · '
                  f'**Tareas:** {len(tasks)} · '
                  f'**Gates desbloqueados:** {", ".join(t["gate_blocked"] for t in tasks)}', '']
        for i, t in enumerate(tasks, 1):
            lines += [f'### {i}. {t["title"]}  (`{t["gate_id"]}`)',
                      f'- **Por qué:** {t["why"]}',
                      f'- **Tiempo:** {t["estimated_time"]}',
                      f'- **Preparación de agentes:** {t["preparation_completed"] or "completa"}',
                      '- **Haz exactamente:**']
            lines += [f'  {n}. {step}' for n, step in enumerate(t['do_exactly'], 1)]
            lines += [f'- **Resultado esperado:** {t["expected_result"]}',
                      f'- **Evidencia a regresar:** {t["return_evidence"]}',
                      f'- **Fallback seguro:** {t["safe_failure"]}', '']
        lines += ['Para marcar completada:',
                  '```',
                  'python3 scripts/agent-os/agent_company.py human-done <GATE-ID> "evidencia"',
                  '```', '']
    with open(PACK_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    return ' · '.join(summary_parts)


if __name__ == '__main__':
    print(render_field_visit_pack() or 'queue empty')

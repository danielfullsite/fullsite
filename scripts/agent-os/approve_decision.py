#!/usr/bin/env python3
"""
Founder approves a decision.

Root cause fix: previous version only updated D-XXX.json via respond_to_decision().
It did NOT transition the linked task (AWAITING_FOUNDER → APPROVED → MERGED) and did
NOT update the heartbeat. This caused D-002 to show as APPROVED while TSK-001 remained
stuck in AWAITING_FOUNDER with a stale heartbeat.

Fix: call propagate_decision_to_task() after respond_to_decision().
"""
import sys, os, json
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import respond_to_decision, propagate_decision_to_task, ensure_dirs, now_iso

HEARTBEAT_FILE = os.path.join(os.path.dirname(__file__), '../../docs/agent-os/HEARTBEAT.json')

def _touch_heartbeat(decision_id, task_id):
    """Patch heartbeat so supervisor doesn't see stale AWAITING_FOUNDER state."""
    hb = {}
    if os.path.exists(HEARTBEAT_FILE):
        try:
            with open(HEARTBEAT_FILE) as f:
                hb = json.load(f)
        except Exception:
            pass
    hb['last_heartbeat'] = now_iso()
    hb['last_founder_action'] = f'APPROVED {decision_id}'
    if task_id and isinstance(hb.get('active_tasks'), dict):
        hb['active_tasks'].pop(task_id, None)
    tmp = HEARTBEAT_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(hb, f, indent=2)
    os.replace(tmp, HEARTBEAT_FILE)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: approve_decision.py <DECISION_ID> [notes]')
        sys.exit(1)
    ensure_dirs()
    decision_id = sys.argv[1]
    notes = ' '.join(sys.argv[2:]) if len(sys.argv) > 2 else ''

    d = respond_to_decision(decision_id, 'APPROVED', notes=notes)
    print(f'Decision {decision_id} APPROVED by Founder.')

    # Propagate: task AWAITING_FOUNDER → APPROVED → MERGED
    try:
        propagate_decision_to_task(decision_id)
        task_id = d.get('task_id')
        if task_id:
            print(f'Task {task_id} → MERGED.')
    except Exception as e:
        print(f'WARNING propagation: {e}')

    _touch_heartbeat(decision_id, d.get('task_id'))
    print('Heartbeat updated.')

#!/usr/bin/env python3
"""Founder rejects a decision — propagates to task."""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import respond_to_decision, propagate_decision_to_task, ensure_dirs

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: reject_decision.py <DECISION_ID> [notes]')
        sys.exit(1)
    ensure_dirs()
    decision_id = sys.argv[1]
    notes = ' '.join(sys.argv[2:]) if len(sys.argv) > 2 else ''
    d = respond_to_decision(decision_id, 'REJECTED', notes=notes)
    print(f'Decision {decision_id} REJECTED by Founder.')
    try:
        propagate_decision_to_task(decision_id)
        if d.get('task_id'):
            print(f'Task {d["task_id"]} → CANCELLED.')
    except Exception as e:
        print(f'WARNING propagation: {e}')

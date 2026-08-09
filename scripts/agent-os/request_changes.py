#!/usr/bin/env python3
"""Founder requests changes on a decision."""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import respond_to_decision, ensure_dirs

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: request_changes.py <DECISION_ID> <notes>')
        sys.exit(1)
    ensure_dirs()
    decision_id = sys.argv[1]
    notes = ' '.join(sys.argv[2:])
    d = respond_to_decision(decision_id, 'CHANGES_REQUESTED', notes=notes)
    print(f'Changes requested for {decision_id}: {notes}')

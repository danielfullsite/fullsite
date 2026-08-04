#!/usr/bin/env python3
"""Founder rejects a decision."""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import respond_to_decision, ensure_dirs

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: reject_decision.py <DECISION_ID> [notes]')
        sys.exit(1)
    ensure_dirs()
    decision_id = sys.argv[1]
    notes = sys.argv[2] if len(sys.argv) > 2 else ''
    d = respond_to_decision(decision_id, 'REJECTED', notes=notes)
    print(f'Decision {decision_id} REJECTED by Founder.')

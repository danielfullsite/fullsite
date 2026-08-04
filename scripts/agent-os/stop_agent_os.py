#!/usr/bin/env python3
"""Emergency kill switch — stops the Agent OS immediately."""
import sys, os
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import update_state, audit, ensure_dirs

if __name__ == '__main__':
    ensure_dirs()
    update_state({'kill_switch': True, 'notes': 'KILLED by operator'})
    audit('KILL_SWITCH_ACTIVATED', {'by': 'OPERATOR'})
    print('Agent OS STOPPED. Kill switch is ON.')
    print('To resume: edit docs/agent-os/STATE.json and set kill_switch=false')
    print('           then run: python3 scripts/agent-os/orchestrator.py')

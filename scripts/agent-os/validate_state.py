#!/usr/bin/env python3
"""Validate Agent OS state integrity."""
import sys, os, json
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import (load_tasks_index, find_task_file, load_task, load_pending_decisions,
                    AUDIT_FILE, STATE_FILE, TASKS_FILE, ensure_dirs)

def main():
    ensure_dirs()
    errors = []
    warnings = []

    # Check state file
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
        if state.get('kill_switch'):
            warnings.append('Kill switch is ON')
    except Exception as e:
        errors.append(f'STATE.json unreadable: {e}')

    # Check tasks index vs actual files
    index = load_tasks_index()
    for task_id, meta in index.items():
        path = find_task_file(task_id)
        if not path:
            errors.append(f'{task_id}: in index but file not found')
            continue
        try:
            task = load_task(task_id)
            if task['status'] != meta['status']:
                errors.append(f'{task_id}: index status={meta["status"]} but file status={task["status"]}')
        except Exception as e:
            errors.append(f'{task_id}: cannot load task file: {e}')

    # Check audit log readability
    if os.path.exists(AUDIT_FILE):
        corrupt = 0
        lines = 0
        with open(AUDIT_FILE) as f:
            for line in f:
                lines += 1
                try:
                    json.loads(line)
                except:
                    corrupt += 1
        if corrupt > 0:
            warnings.append(f'AUDIT-LOG: {corrupt}/{lines} corrupt lines')
    else:
        warnings.append('AUDIT-LOG does not exist yet')

    # Check pending decisions
    decisions = load_pending_decisions()
    if len(decisions) > 5:
        warnings.append(f'{len(decisions)} pending decisions — inbox congested')

    # Report
    print('=== Agent OS State Validation ===')
    if errors:
        print(f'\nERRORS ({len(errors)}):')
        for e in errors:
            print(f'  ✗ {e}')
    if warnings:
        print(f'\nWARNINGS ({len(warnings)}):')
        for w in warnings:
            print(f'  ⚠ {w}')
    if not errors and not warnings:
        print('\n✅ All checks passed.')
    elif not errors:
        print(f'\n✅ No errors. {len(warnings)} warning(s).')
    else:
        print(f'\n✗ {len(errors)} error(s), {len(warnings)} warning(s).')
        sys.exit(1)

if __name__ == '__main__':
    main()

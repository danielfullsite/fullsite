#!/usr/bin/env python3
"""
Agent OS Runner — executes the next READY task assigned to the given role.

Usage:
  python3 runner.py --role RUNTIME_VERIFICATION [--dry-run]

This script:
  1. Finds the highest-priority READY task for the role
  2. Claims it (READY → IN_PROGRESS)
  3. Prints a structured prompt for the Claude Code agent to execute
  4. The agent then calls submit_result.py when done

The runner does NOT execute the task itself — it produces the prompt and
waits for the agent to call submit_result.py.
"""
import sys, os, json, argparse
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import (load_tasks_index, load_task, transition_task,
                    update_task_fields, is_killed, find_task_file, ensure_dirs, now_iso)

PRIORITY_ORDER = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}

def _find_next_task(role, skip_ids=None):
    skip_ids = set(skip_ids or [])
    index = load_tasks_index()
    candidates = []
    for tid, meta in index.items():
        if meta['status'] != 'READY':
            continue
        if meta['role'] != role:
            continue
        if tid in skip_ids:
            continue
        candidates.append((tid, meta))

    if not candidates:
        return None

    # Sort by priority, then by task_id (creation order)
    candidates.sort(key=lambda x: (PRIORITY_ORDER.get(x[1]['priority'], 99), x[0]))
    task_id = candidates[0][0]
    return load_task(task_id)

def _check_dependencies(task):
    """Return list of unfulfilled dependency task IDs."""
    deps = task.get('dependencies', [])
    if not deps:
        return []
    index = load_tasks_index()
    unfulfilled = []
    for dep in deps:
        meta = index.get(dep, {})
        if meta.get('status') not in ('VERIFIED', 'APPROVED', 'MERGED'):
            unfulfilled.append(dep)
    return unfulfilled

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--role', required=True)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--skip', default='', help='comma-separated task IDs to skip')
    args = p.parse_args()

    ensure_dirs()

    if is_killed():
        print('KILL SWITCH IS ON. Runner will not start.')
        sys.exit(0)

    skip_ids = [s.strip() for s in args.skip.split(',') if s.strip()]
    task = _find_next_task(args.role, skip_ids)

    if not task:
        print(f'No READY tasks for role {args.role}.')
        sys.exit(0)

    unfulfilled = _check_dependencies(task)
    if unfulfilled:
        print(f'Task {task["id"]} has unfulfilled dependencies: {unfulfilled}')
        print('Skipping — try again after dependencies are VERIFIED.')
        sys.exit(0)

    if args.dry_run:
        print(f'[DRY RUN] Would claim task: {task["id"]} — {task["title"]}')
        print(f'  Role: {task["role"]}')
        print(f'  Priority: {task["priority"]}')
        print(f'  DoD: {task["dod"]}')
        sys.exit(0)

    # Claim the task
    transition_task(task['id'], 'CLAIMED', by=args.role, note='Claimed by runner')
    transition_task(task['id'], 'IN_PROGRESS', by=args.role, note='Work started')
    update_task_fields(task['id'], {'claimed_by': args.role, 'claimed_at': now_iso()})

    # Print execution prompt
    print('=' * 70)
    print(f'TASK {task["id"]} — {task["priority"]} — {task["role"]}')
    print('=' * 70)
    print()
    print(f'OBJETIVO: {task["objective"]}')
    print()
    print('DEFINITION OF DONE:')
    for item in task.get('dod', []):
        print(f'  - {item}')
    print()
    if task.get('notes'):
        print(f'NOTAS: {task["notes"]}')
        print()
    print('ARCHIVOS PERMITIDOS:')
    if task.get('files_allowed'):
        for f in task['files_allowed']:
            print(f'  {f}')
    else:
        print('  (sin restricción — todos los archivos de lectura)')
    print()
    print(f'PRESUPUESTO: {task["budget_tokens"]:,} tokens')
    print(f'MAX TURNOS: {task["max_turns"]}')
    print()
    print('AL TERMINAR:')
    print(f'  python3 scripts/agent-os/submit_result.py {task["id"]} \\')
    print(f'    --role {task["role"]} \\')
    print(f'    --verdict VERIFIED|PARTIAL|FAILED \\')
    print(f'    --summary "resumen" \\')
    print(f'    --evidence "evidencia" \\')
    print(f'    --commit <hash_si_aplica> \\')
    print(f'    --tests-passed N --tests-total M')
    print('=' * 70)

if __name__ == '__main__':
    main()

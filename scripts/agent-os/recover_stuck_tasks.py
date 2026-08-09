#!/usr/bin/env python3
"""Detect and report stuck tasks. Optionally reset to READY."""
import sys, argparse
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import find_stuck_tasks, transition_task, ensure_dirs

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--minutes', type=int, default=60,
                   help='Minutes since last update to consider a task stuck')
    p.add_argument('--reset', action='store_true',
                   help='Reset stuck CLAIMED/IN_PROGRESS tasks to READY')
    args = p.parse_args()

    ensure_dirs()
    stuck = find_stuck_tasks(args.minutes)

    if not stuck:
        print(f'No stuck tasks (threshold: {args.minutes}m)')
        return

    print(f'Found {len(stuck)} stuck task(s):')
    for item in stuck:
        task = item['task']
        print(f'  {task["id"]} [{task["status"]}] {task["title"]} — {item["age_minutes"]}m ago')
        if args.reset and task['status'] in ('CLAIMED', 'IN_PROGRESS', 'CHANGES_REQUESTED'):
            transition_task(task['id'], 'READY', by='RECOVERY',
                            note=f'Auto-reset after {item["age_minutes"]}m stuck')
            print(f'    → Reset to READY')

if __name__ == '__main__':
    main()

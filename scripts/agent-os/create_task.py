#!/usr/bin/env python3
"""Create a new task in the Agent OS."""
import sys, argparse
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import create_task, ensure_dirs

def main():
    p = argparse.ArgumentParser(description='Create a new Agent OS task')
    p.add_argument('--title',    required=True)
    p.add_argument('--role',     required=True, choices=['ORCHESTRATOR','RUNTIME_ENGINEER',
                   'RUNTIME_VERIFICATION','KNOWLEDGE_ENGINEER','FIELD_CERTIFICATION','FOUNDER'])
    p.add_argument('--objective', required=True)
    p.add_argument('--priority', default='P1', choices=['P0','P1','P2','P3'])
    p.add_argument('--tags',     default='', help='comma-separated tags')
    p.add_argument('--dod',      default='', help='comma-separated definition-of-done items')
    p.add_argument('--deps',     default='', help='comma-separated dependency task IDs')
    p.add_argument('--budget',   type=int, default=100_000)
    p.add_argument('--notes',    default='')
    args = p.parse_args()

    ensure_dirs()
    task = create_task(
        title=args.title,
        objective=args.objective,
        role=args.role,
        priority=args.priority,
        tags=[t.strip() for t in args.tags.split(',') if t.strip()],
        dod=[d.strip() for d in args.dod.split(',') if d.strip()],
        dependencies=[d.strip() for d in args.deps.split(',') if d.strip()],
        budget_tokens=args.budget,
        notes=args.notes,
    )
    print(f'Created: {task["id"]} — {task["title"]}')
    return task['id']

if __name__ == '__main__':
    main()

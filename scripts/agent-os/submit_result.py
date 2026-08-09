#!/usr/bin/env python3
"""Submit an engineering result for a task."""
import sys, argparse, json
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import submit_result, transition_task, update_task_fields, ensure_dirs

def main():
    p = argparse.ArgumentParser()
    p.add_argument('task_id')
    p.add_argument('--role',     required=True)
    p.add_argument('--verdict',  required=True, choices=['VERIFIED','PARTIAL','FAILED','UNVERIFIED'])
    p.add_argument('--summary',  required=True)
    p.add_argument('--evidence', default='')
    p.add_argument('--commit',   default=None)
    p.add_argument('--tests-passed', type=int, default=None, dest='tests_passed')
    p.add_argument('--tests-total',  type=int, default=None, dest='tests_total')
    p.add_argument('--gaps',     default='', help='comma-separated gap descriptions')
    p.add_argument('--next',     default='', help='comma-separated next steps')
    args = p.parse_args()

    ensure_dirs()
    result = submit_result(
        task_id=args.task_id,
        submitted_by=args.role,
        verdict=args.verdict,
        summary=args.summary,
        evidence=args.evidence,
        commit=args.commit,
        tests_passed=args.tests_passed,
        tests_total=args.tests_total,
        gaps_found=[g.strip() for g in args.gaps.split(',') if g.strip()],
        next_steps=[n.strip() for n in args.next.split(',') if n.strip()],
    )

    update_task_fields(args.task_id, {'submitted_at': result['submitted_at']})
    transition_task(args.task_id, 'SUBMITTED', by=args.role, note=f'Result: {args.verdict}')
    print(f'Result submitted for {args.task_id}: {args.verdict}')

if __name__ == '__main__':
    main()

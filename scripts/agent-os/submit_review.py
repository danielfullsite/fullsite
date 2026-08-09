#!/usr/bin/env python3
"""Submit a verification review. Automatically loops back to Engineer if FAILED/PARTIAL."""
import sys, argparse
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import (submit_review, transition_task, update_task_fields,
                    load_task, create_decision, ensure_dirs)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('task_id')
    p.add_argument('--verdict',  required=True, choices=['VERIFIED','PARTIAL','FAILED','UNVERIFIED'])
    p.add_argument('--findings', default='', help='comma-separated findings')
    p.add_argument('--return-reason', default=None, dest='return_reason',
                   help='Reason for returning to engineer')
    p.add_argument('--notes',    default='')
    p.add_argument('--objective',      default='', help='For decision card (VERIFIED only)')
    p.add_argument('--what-changed',   default='', dest='what_changed')
    p.add_argument('--why-matters',    default='', dest='why_matters')
    p.add_argument('--commit',         default=None)
    p.add_argument('--tests-summary',  default='', dest='tests_summary')
    p.add_argument('--risk',           default='BAJO', choices=['BAJO','MEDIO','ALTO'])
    p.add_argument('--rollback',       default='No aplica')
    p.add_argument('--health-delta',   default='Sin cambio', dest='health_delta')
    p.add_argument('--action',         default='APROBAR MERGE', dest='action')
    args = p.parse_args()

    ensure_dirs()
    task = load_task(args.task_id)
    retry_count = task.get('retry_count', 0)
    max_retries = task.get('max_retries', 3)

    return_to_engineer = args.verdict in ('FAILED', 'PARTIAL')

    review = submit_review(
        task_id=args.task_id,
        reviewed_by='RUNTIME_VERIFICATION',
        verdict=args.verdict,
        findings=[f.strip() for f in args.findings.split(',') if f.strip()],
        return_to_engineer=return_to_engineer,
        return_reason=args.return_reason,
        notes=args.notes,
    )

    transition_task(args.task_id, 'IN_REVIEW', by='RUNTIME_VERIFICATION', note='Review started')

    if args.verdict == 'VERIFIED':
        update_task_fields(args.task_id, {'verified_at': review['reviewed_at']})
        transition_task(args.task_id, 'VERIFIED', by='RUNTIME_VERIFICATION', note='VERIFIED')

        if args.objective:
            d = create_decision(
                task_id=args.task_id,
                objective=args.objective,
                what_changed=args.what_changed,
                why_it_matters=args.why_matters,
                commit=args.commit,
                tests_summary=args.tests_summary,
                verification='VERIFIED',
                risk=args.risk,
                rollback=args.rollback,
                runtime_health_delta=args.health_delta,
                action_requested=args.action,
            )
            transition_task(args.task_id, 'AWAITING_FOUNDER',
                            by='ORCHESTRATOR', note=f'Decision {d["id"]} created')
            print(f'VERIFIED → Decision {d["id"]} in FOUNDER-INBOX')
        else:
            print(f'VERIFIED — no decision card requested')

    elif return_to_engineer:
        if retry_count >= max_retries:
            transition_task(args.task_id, 'BLOCKED', by='RUNTIME_VERIFICATION',
                            note=f'Max retries ({max_retries}) exceeded: {args.return_reason}')
            print(f'BLOCKED after {retry_count} retries. Needs Founder Decision.')
        else:
            update_task_fields(args.task_id, {'retry_count': retry_count + 1})
            transition_task(args.task_id, 'CHANGES_REQUESTED', by='RUNTIME_VERIFICATION',
                            note=args.return_reason or 'Needs rework')
            transition_task(args.task_id, 'IN_PROGRESS', by='RUNTIME_VERIFICATION',
                            note='Returned to engineer')
            print(f'{args.verdict} — returned to engineer (retry {retry_count+1}/{max_retries}): {args.return_reason}')
    else:
        print(f'Review recorded: {args.verdict}')

if __name__ == '__main__':
    main()

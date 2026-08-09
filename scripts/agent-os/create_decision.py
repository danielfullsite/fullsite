#!/usr/bin/env python3
"""Manually create a Founder Decision card."""
import sys, argparse
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import create_decision, ensure_dirs

def main():
    p = argparse.ArgumentParser()
    p.add_argument('task_id')
    p.add_argument('--objective',    required=True)
    p.add_argument('--what-changed', required=True, dest='what_changed')
    p.add_argument('--why-matters',  required=True, dest='why_matters')
    p.add_argument('--commit',       default=None)
    p.add_argument('--tests',        default='', dest='tests_summary')
    p.add_argument('--verification', default='VERIFIED',
                   choices=['VERIFIED','PARTIAL','FAILED','UNVERIFIED'])
    p.add_argument('--risk',         default='BAJO', choices=['BAJO','MEDIO','ALTO'])
    p.add_argument('--rollback',     default='No aplica')
    p.add_argument('--health-delta', default='Sin cambio', dest='health_delta')
    p.add_argument('--action',       default='APROBAR MERGE', dest='action')
    args = p.parse_args()

    ensure_dirs()
    d = create_decision(
        task_id=args.task_id,
        objective=args.objective,
        what_changed=args.what_changed,
        why_it_matters=args.why_matters,
        commit=args.commit,
        tests_summary=args.tests_summary,
        verification=args.verification,
        risk=args.risk,
        rollback=args.rollback,
        runtime_health_delta=args.health_delta,
        action_requested=args.action,
    )
    print(f'Decision {d["id"]} created and added to FOUNDER-INBOX')

if __name__ == '__main__':
    main()

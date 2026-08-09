#!/usr/bin/env python3
"""Show all pending Founder Decisions."""
import sys, json, os
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import load_pending_decisions, INBOX_MD, ensure_dirs

def _readiness_score():
    """Quick R1-R4 score estimate from FULLSITE-READINESS-CONTRACT.md state."""
    # These are hard-coded based on known state as of 2026-08-04.
    # The orchestrator updates these as gates are verified.
    return {
        'R1': {'done': 3, 'total': 9, 'pct': 33},   # G01, G07, G10 = 3/9 internal gates
        'R2': {'done': 1, 'total': 10, 'pct': 10},  # G10 (INV-05) done
        'R3': {'done': 0, 'total': 11, 'pct': 0},
        'R4': {'done': 2, 'total': 7, 'pct': 29},   # G01 (capture), G06 (tracking) done
    }

def main():
    ensure_dirs()
    decisions = load_pending_decisions()
    scores = _readiness_score()

    print('=' * 60)
    print('FOUNDER INBOX')
    print('=' * 60)
    print()
    print(f'R1 (AMALAY Prod):       {scores["R1"]["pct"]:3d}%  ({scores["R1"]["done"]}/{scores["R1"]["total"]} gates)')
    print(f'R2 (Client #2):         {scores["R2"]["pct"]:3d}%  ({scores["R2"]["done"]}/{scores["R2"]["total"]} gates)')
    print(f'R3 (Scale 20+):         {scores["R3"]["pct"]:3d}%  ({scores["R3"]["done"]}/{scores["R3"]["total"]} gates)')
    print(f'R4 (Op Intelligence):   {scores["R4"]["pct"]:3d}%  ({scores["R4"]["done"]}/{scores["R4"]["total"]} gates)')
    print()
    print('=' * 60)

    if not decisions:
        print('No hay decisiones pendientes.')
        return

    for d in decisions:
        print()
        print(f'DECISIÓN {d["id"]}')
        print()
        print(f'  Readiness:    R1:{scores["R1"]["pct"]}%  R2:{scores["R2"]["pct"]}%  R3:{scores["R3"]["pct"]}%  R4:{scores["R4"]["pct"]}%')
        print(f'  Objetivo:     {d.get("objective", "")}')
        print(f'  Qué cambió:   {d.get("what_changed", "")}')
        print(f'  Por qué:      {d.get("why_it_matters", "")}')
        print(f'  Commit:       {d.get("commit") or "—"}')
        print(f'  Tests:        {d.get("tests_summary", "—")}')
        print(f'  Verificación: {d.get("verification", "—")}')
        print(f'  Riesgo:       {d.get("risk", "—")}')
        print(f'  Rollback:     {d.get("rollback", "—")}')
        print(f'  Runtime:      {d.get("runtime_health_delta", "—")}')
        print(f'  Acción:       {d.get("action_requested", "—")}')
        print()
        print(f'  >>> python3 scripts/agent-os/approve_decision.py {d["id"]}')
        print(f'  >>> python3 scripts/agent-os/reject_decision.py {d["id"]}')
        print(f'  >>> python3 scripts/agent-os/request_changes.py {d["id"]} "motivo"')
        print()
        print('-' * 60)

if __name__ == '__main__':
    main()

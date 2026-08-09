#!/usr/bin/env python3
"""Update CHATGPT-HANDOFF.md with latest decision and context."""
import sys, json, os, datetime
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from shared import (load_pending_decisions, load_tasks_index, HANDOFF_MD,
                    HANDOFFS_DIR, now_iso, ensure_dirs, read_json, AUDIT_FILE)

def _last_audit_entries(n=10):
    if not os.path.exists(AUDIT_FILE):
        return []
    lines = []
    with open(AUDIT_FILE) as f:
        for line in f:
            try:
                lines.append(json.loads(line))
            except:
                pass
    return lines[-n:]

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--decision-id',    default=None, dest='decision_id')
    p.add_argument('--context',        default='', help='Additional context for ChatGPT')
    p.add_argument('--risks',          default='', help='Known risks')
    p.add_argument('--questions',      default='', help='Questions needing judgment')
    p.add_argument('--recommendation', default='', help='Orchestrator recommendation')
    args = p.parse_args()

    ensure_dirs()
    pending = load_pending_decisions()
    index   = load_tasks_index()
    recent_audit = _last_audit_entries(5)

    # Find specific decision if requested
    target_decision = None
    if args.decision_id:
        decision_path = os.path.join(
            os.path.dirname(HANDOFF_MD), 'decisions', f'{args.decision_id}.json')
        if os.path.exists(decision_path):
            target_decision = read_json(decision_path)
    elif pending:
        target_decision = pending[0]

    ts = now_iso()

    lines = [
        '# ChatGPT Handoff',
        '',
        f'**Generado:** {ts}',
        f'**Decisión:** {target_decision["id"] if target_decision else "ninguna pendiente"}',
        '',
        '---',
        '',
        '## Estado del Readiness Contract',
        '',
        '| Nivel | Score estimado | Blocker |',
        '|---|---|---|',
        '| R1 — AMALAY Prod | ~33% | P0-4 field execution pendiente |',
        '| R2 — Client #2   | ~10% | R1 gates open |',
        '| R3 — Scale 20+   |  ~0% | R2 gates open |',
        '| R4 — Op Intel    | ~29% | Data quality gaps |',
        '',
        '---',
        '',
    ]

    if target_decision:
        lines += [
            f'## Decisión {target_decision["id"]}',
            '',
            f'**Estado:** {target_decision["status"]}',
            f'**Objetivo:** {target_decision.get("objective", "")}',
            '',
            '| Campo | Valor |',
            '|---|---|',
            f'| Qué cambió | {target_decision.get("what_changed", "")} |',
            f'| Por qué importa | {target_decision.get("why_it_matters", "")} |',
            f'| Commit | `{target_decision.get("commit") or "—"}` |',
            f'| Tests | {target_decision.get("tests_summary", "—")} |',
            f'| Verificación | {target_decision.get("verification", "—")} |',
            f'| Riesgo | {target_decision.get("risk", "—")} |',
            f'| Rollback | {target_decision.get("rollback", "—")} |',
            f'| Runtime Health | {target_decision.get("runtime_health_delta", "—")} |',
            f'| Acción solicitada | **{target_decision.get("action_requested", "—")}** |',
            '',
            '---',
            '',
        ]

    if args.context:
        lines += ['## Contexto adicional', '', args.context, '', '---', '']

    if args.risks:
        lines += ['## Riesgos conocidos', '', args.risks, '', '---', '']

    if args.questions:
        lines += ['## Preguntas que requieren criterio externo', '', args.questions, '', '---', '']

    if args.recommendation:
        lines += ['## Recomendación del Orchestrator', '', args.recommendation, '', '---', '']

    # Recent audit trail
    if recent_audit:
        lines += ['## Últimas 5 acciones del Agent OS', '']
        for entry in recent_audit:
            lines.append(f'- `{entry.get("ts", "")}` [{entry.get("type", "")}] {json.dumps({k:v for k,v in entry.items() if k not in ("ts","type")})}')
        lines += ['', '---', '']

    lines += [
        '## Instrucciones para ChatGPT',
        '',
        '1. Lee el Readiness Contract en `docs/agent-os/FULLSITE-READINESS-CONTRACT.md`',
        '2. Revisa los archivos referenciados en el commit (si aplica)',
        '3. Evalúa si la decisión es correcta dado el estado del sistema',
        '4. Responde: APROBAR / RECHAZAR / PEDIR CAMBIOS + justificación en ≤200 palabras',
        '5. Daniel ejecuta el comando correspondiente en Claude Code',
        '',
        '*Este documento tiene un máximo de 1,500 palabras y es autocontenido.*',
    ]

    with open(HANDOFF_MD, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    # Archive a copy
    archive_path = os.path.join(HANDOFFS_DIR, f'handoff-{ts.replace(":", "-")}.md')
    with open(archive_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print(f'ChatGPT handoff updated: {HANDOFF_MD}')

if __name__ == '__main__':
    main()

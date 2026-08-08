"""Agent OS Pipeline — machine-readable source of truth for targets, gates, evidence.

PIPELINE.json structure:
  {
    "version": 1,
    "active_target": "CLIENT_2_READY",
    "targets": {
      "<TARGET>": {
        "title": ..., "target_date": "YYYY-MM-DD",
        "gates": { "<GATE-ID>": { ...gate fields... } }
      }
    }
  }

Gate fields:
  id, title, domain, status, criticality (REQUIRED|OPTIONAL), dependencies [gate ids],
  owner, execution_class (AUTO_TECH|HUMAN_PHYSICAL|FOUNDER_DECISION|PRODUCTION_APPROVAL),
  cert_level (IMPLEMENTATION|SOFTWARE|STAGING|PHYSICAL|PRODUCTION),
  evidence_required (str), evidence (list of {ts, task_id, commit, note}),
  requires_human (bool), location (for HUMAN_PHYSICAL), cert_command (optional shell
  command; must exit 0 before a task-driven PASS is accepted), updated_at, notes,
  failure_history (list), retry_budget.

Readiness is NEVER an LLM opinion: it is required-gates-PASS / required-gates-total.
"""
import os
import subprocess

from shared import (
    AOS_ROOT, REPO_ROOT, FileLock, read_json, write_json, audit, now_iso,
)

PIPELINE_FILE = os.path.join(AOS_ROOT, 'PIPELINE.json')

GATE_STATUSES = [
    'BACKLOG', 'READY', 'CLAIMED', 'RUNNING', 'REVIEW', 'CERTIFYING',
    'BLOCKED_TECH', 'BLOCKED_HUMAN', 'BLOCKED_DECISION', 'BLOCKED_EXTERNAL',
    'PASS', 'FAIL', 'DEFERRED',
]
ACTIONABLE_STATUSES = {'BACKLOG', 'READY', 'FAIL'}
DEFAULT_RETRY_BUDGET = 3


# ── Load / save ───────────────────────────────────────────────────────────────

def load_pipeline() -> dict:
    return read_json(PIPELINE_FILE, {'version': 1, 'active_target': None, 'targets': {}})


def save_pipeline(p: dict):
    p['updated_at'] = now_iso()
    write_json(PIPELINE_FILE, p)


def active_target(p: dict = None) -> tuple:
    """Returns (target_name, target_dict) or (None, None)."""
    p = p or load_pipeline()
    name = p.get('active_target')
    if not name:
        return None, None
    return name, p.get('targets', {}).get(name)


def get_gate(gate_id: str, p: dict = None) -> dict:
    p = p or load_pipeline()
    _, target = active_target(p)
    if not target:
        return None
    return target.get('gates', {}).get(gate_id)


# ── Mutation (always under file lock, always audited) ─────────────────────────

def set_gate_status(gate_id: str, status: str, by: str = 'SYSTEM', note: str = '',
                    evidence: dict = None):
    if status not in GATE_STATUSES:
        raise ValueError(f'Invalid gate status: {status}')
    with FileLock(PIPELINE_FILE):
        p = load_pipeline()
        tname, target = active_target(p)
        if not target or gate_id not in target.get('gates', {}):
            raise KeyError(f'Gate {gate_id} not found in active target')
        gate = target['gates'][gate_id]
        old = gate.get('status')
        gate['status'] = status
        gate['updated_at'] = now_iso()
        if note:
            gate['last_note'] = note[:300]
        if evidence:
            gate.setdefault('evidence', []).append({'ts': now_iso(), **evidence})
        save_pipeline(p)
    audit('GATE_STATUS', {'gate_id': gate_id, 'from': old, 'to': status,
                          'by': by, 'note': note[:200]})
    return status


def record_gate_failure(gate_id: str, signature: str, by: str = 'SYSTEM'):
    """Record a failure signature; returns True if retry budget remains."""
    with FileLock(PIPELINE_FILE):
        p = load_pipeline()
        _, target = active_target(p)
        gate = target['gates'][gate_id]
        hist = gate.setdefault('failure_history', [])
        hist.append({'ts': now_iso(), 'signature': signature[:300]})
        budget = gate.get('retry_budget', DEFAULT_RETRY_BUDGET)
        identical = sum(1 for h in hist if h['signature'] == signature[:300])
        gate['updated_at'] = now_iso()
        save_pipeline(p)
    audit('GATE_FAILURE', {'gate_id': gate_id, 'signature': signature[:200],
                           'identical_count': identical, 'budget': budget})
    return identical < budget


# ── Deterministic certification ───────────────────────────────────────────────

def run_cert_command(gate: dict) -> tuple:
    """Run gate's cert_command if present. Returns (ok, output_tail)."""
    cmd = gate.get('cert_command')
    if not cmd:
        return True, 'no cert_command (task pipeline verdict is the cert)'
    try:
        r = subprocess.run(cmd, shell=True, cwd=REPO_ROOT, capture_output=True,
                           text=True, timeout=600)
        out = ((r.stdout or '') + (r.stderr or ''))[-1000:]
        return r.returncode == 0, out
    except Exception as e:
        return False, f'cert_command error: {e}'


def mark_gate_from_task(gate_id: str, task_id: str, commit: str, evidence: str):
    """Called when a task pipeline (builder→reviewer→merge) completes for a gate.

    Runs the gate's deterministic cert_command (if any) before declaring PASS.
    On cert failure the gate goes to FAIL (routed back by the orchestrator).
    """
    gate = get_gate(gate_id)
    if not gate:
        audit('GATE_NOT_FOUND', {'gate_id': gate_id, 'task_id': task_id})
        return
    set_gate_status(gate_id, 'CERTIFYING', by='SUPERVISOR',
                    note=f'Task {task_id} merged; running deterministic cert')
    ok, out = run_cert_command(gate)
    if ok:
        set_gate_status(gate_id, 'PASS', by='CERT',
                        note=f'cert ok: {out[:150]}',
                        evidence={'task_id': task_id, 'commit': commit,
                                  'note': evidence[:300], 'cert_output': out[:300]})
    else:
        set_gate_status(gate_id, 'FAIL', by='CERT', note=f'cert failed: {out[:200]}')
        record_gate_failure(gate_id, f'cert_command_failed:{out[:100]}')


# ── Readiness (deterministic, never LLM confidence) ───────────────────────────

def readiness(p: dict = None) -> dict:
    p = p or load_pipeline()
    tname, target = active_target(p)
    if not target:
        return {'target': None, 'required_total': 0, 'required_pass': 0, 'pct': 0.0}
    gates = target.get('gates', {})
    required = {gid: g for gid, g in gates.items()
                if g.get('criticality', 'REQUIRED') == 'REQUIRED'
                and g.get('status') != 'DEFERRED'}
    passed = [gid for gid, g in required.items() if g.get('status') == 'PASS']
    total = len(required)
    return {
        'target': tname,
        'target_date': target.get('target_date'),
        'required_total': total,
        'required_pass': len(passed),
        'pct': round(100.0 * len(passed) / total, 1) if total else 0.0,
        'complete': total > 0 and len(passed) == total,
        'blocked_human': [gid for gid, g in required.items()
                          if g.get('status') == 'BLOCKED_HUMAN'],
        'blocked_decision': [gid for gid, g in required.items()
                             if g.get('status') == 'BLOCKED_DECISION'],
        'blocked_tech': [gid for gid, g in required.items()
                         if g.get('status') == 'BLOCKED_TECH'],
        'blocked_external': [gid for gid, g in required.items()
                             if g.get('status') == 'BLOCKED_EXTERNAL'],
    }


def deps_met(gate: dict, gates: dict) -> bool:
    return all(gates.get(d, {}).get('status') == 'PASS'
               for d in gate.get('dependencies', []))


def actionable_gates(p: dict = None, locked_domains: set = None) -> list:
    """Gates the orchestrator can act on NOW: deps PASS, domain unlocked,
    status actionable, retry budget not exhausted. Returns list of gate dicts."""
    p = p or load_pipeline()
    _, target = active_target(p)
    if not target:
        return []
    locked_domains = locked_domains or set()
    gates = target.get('gates', {})
    out = []
    for gid, g in gates.items():
        if g.get('status') not in ACTIONABLE_STATUSES:
            continue
        if not deps_met(g, gates):
            continue
        if g.get('domain') in locked_domains:
            continue
        hist = g.get('failure_history', [])
        if hist:
            last_sig = hist[-1]['signature']
            identical = sum(1 for h in hist if h['signature'] == last_sig)
            if identical >= g.get('retry_budget', DEFAULT_RETRY_BUDGET):
                continue  # deadlocked → stays FAIL, escalation handles it
        out.append({**g, 'id': gid})
    prio = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}
    out.sort(key=lambda g: prio.get(g.get('priority', 'P2'), 9))
    return out


if __name__ == '__main__':
    import json as _json
    print(_json.dumps(readiness(), indent=2, ensure_ascii=False))

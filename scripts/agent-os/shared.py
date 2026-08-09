"""Agent OS — Shared state machine, locking, and audit primitives."""
import json
import os
import time
import uuid
import datetime
import fcntl
import shutil
import subprocess

# ── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
AOS_ROOT    = os.path.join(REPO_ROOT, 'docs', 'agent-os')
SCRIPTS_ROOT = os.path.join(REPO_ROOT, 'scripts', 'agent-os')

INBOX_DIR    = os.path.join(AOS_ROOT, 'inbox')
ACTIVE_DIR   = os.path.join(AOS_ROOT, 'active')
RESULTS_DIR  = os.path.join(AOS_ROOT, 'results')
REVIEWS_DIR  = os.path.join(AOS_ROOT, 'reviews')
DECISIONS_DIR = os.path.join(AOS_ROOT, 'decisions')
HANDOFFS_DIR = os.path.join(AOS_ROOT, 'handoffs')
ARCHIVE_DIR  = os.path.join(AOS_ROOT, 'archive')

STATE_FILE   = os.path.join(AOS_ROOT, 'STATE.json')
TASKS_FILE   = os.path.join(AOS_ROOT, 'TASKS.json')
AUDIT_FILE   = os.path.join(AOS_ROOT, 'AUDIT-LOG.ndjson')
INBOX_MD     = os.path.join(AOS_ROOT, 'FOUNDER-INBOX.md')
HANDOFF_MD   = os.path.join(AOS_ROOT, 'CHATGPT-HANDOFF.md')

# ── State machine ─────────────────────────────────────────────────────────────

VALID_STATUSES = [
    'DRAFT', 'READY', 'CLAIMED', 'IN_PROGRESS', 'SUBMITTED',
    'IN_REVIEW', 'CHANGES_REQUESTED', 'VERIFIED',
    'AWAITING_FOUNDER', 'APPROVED', 'REJECTED', 'MERGED',
    'BLOCKED', 'CANCELLED', 'CLOSED',
]

VALID_TRANSITIONS = {
    'DRAFT':              ['READY', 'CANCELLED'],
    'READY':              ['CLAIMED', 'CANCELLED'],
    'CLAIMED':            ['IN_PROGRESS', 'READY'],
    'IN_PROGRESS':        ['SUBMITTED', 'BLOCKED', 'CANCELLED', 'READY'],
    'SUBMITTED':          ['IN_REVIEW'],
    'IN_REVIEW':          ['VERIFIED', 'CHANGES_REQUESTED', 'BLOCKED', 'READY'],
    'CHANGES_REQUESTED':  ['IN_PROGRESS', 'CANCELLED'],
    'VERIFIED':           ['AWAITING_FOUNDER', 'MERGED', 'CLOSED'],
    'AWAITING_FOUNDER':   ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
    'APPROVED':           ['MERGED'],
    'REJECTED':           ['CANCELLED'],
    'MERGED':             [],
    'CLOSED':             [],
    'BLOCKED':            ['READY', 'CANCELLED'],
    'CANCELLED':          [],
}

TERMINAL_STATUSES = {'MERGED', 'CANCELLED', 'REJECTED', 'CLOSED'}

VALID_ROLES = ['ORCHESTRATOR', 'RUNTIME_ENGINEER', 'RUNTIME_VERIFICATION',
               'KNOWLEDGE_ENGINEER', 'FIELD_CERTIFICATION', 'FOUNDER']

MAX_RETRIES  = 3   # auto-escalate to BLOCKED after 3 failed Engineering↔Verification cycles
MAX_TURNS    = 20  # per-task agent turn budget
LOCK_TIMEOUT = 60  # seconds to hold a file lock

# ── ID generation ─────────────────────────────────────────────────────────────

def new_task_id():
    state = _load_state_raw()
    n = state.get('last_task_seq', 0) + 1
    state['last_task_seq'] = n
    _save_state_raw(state)
    return f'TSK-{n:03d}'

def new_decision_id():
    state = _load_state_raw()
    n = state.get('last_decision_seq', 0) + 1
    state['last_decision_seq'] = n
    _save_state_raw(state)
    return f'D-{n:03d}'

def now_iso():
    return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

# ── File locking ─────────────────────────────────────────────────────────────

class FileLock:
    def __init__(self, path, timeout=LOCK_TIMEOUT):
        self._lock_path = path + '.lock'
        self._timeout   = timeout
        self._fh        = None

    def __enter__(self):
        deadline = time.time() + self._timeout
        self._fh = open(self._lock_path, 'w')
        while True:
            try:
                fcntl.flock(self._fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.time() > deadline:
                    raise TimeoutError(f'Could not acquire lock: {self._lock_path}')
                time.sleep(0.1)

    def __exit__(self, *_):
        if self._fh:
            fcntl.flock(self._fh, fcntl.LOCK_UN)
            self._fh.close()
        try:
            os.unlink(self._lock_path)
        except FileNotFoundError:
            pass

# ── Atomic JSON read/write ────────────────────────────────────────────────────

def read_json(path, default=None):
    if not os.path.exists(path):
        return default if default is not None else {}
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, path)

# ── Audit log ─────────────────────────────────────────────────────────────────

def audit(event_type, data):
    entry = {'ts': now_iso(), 'type': event_type, **data}
    with open(AUDIT_FILE, 'a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')

# ── STATE.json ────────────────────────────────────────────────────────────────

def _default_state():
    return {
        'version':          1,
        'created_at':       now_iso(),
        'updated_at':       now_iso(),
        'last_task_seq':    0,
        'last_decision_seq': 0,
        'kill_switch':      False,
        'active_workstream': None,
        'blocked_tasks':    [],
        'notes':            '',
    }

def _load_state_raw():
    if not os.path.exists(STATE_FILE):
        return _default_state()
    return read_json(STATE_FILE, _default_state())

def _save_state_raw(state):
    state['updated_at'] = now_iso()
    write_json(STATE_FILE, state)

def load_state():
    return _load_state_raw()

def update_state(updates):
    with FileLock(STATE_FILE):
        state = _load_state_raw()
        state.update(updates)
        _save_state_raw(state)
    return state

def is_killed():
    return _load_state_raw().get('kill_switch', False)

# ── TASKS.json index ──────────────────────────────────────────────────────────

def load_tasks_index():
    return read_json(TASKS_FILE, {})

def _save_tasks_index(index):
    write_json(TASKS_FILE, index)

def _index_task(task):
    index = load_tasks_index()
    index[task['id']] = {
        'title':      task['title'],
        'status':     task['status'],
        'role':       task['role'],
        'priority':   task['priority'],
        'tags':       task.get('tags', []),
        'updated_at': task['updated_at'],
    }
    _save_tasks_index(index)

# ── Task file paths ───────────────────────────────────────────────────────────

STATUS_DIR = {
    'DRAFT':             INBOX_DIR,
    'READY':             INBOX_DIR,
    'CLAIMED':           ACTIVE_DIR,
    'IN_PROGRESS':       ACTIVE_DIR,
    'SUBMITTED':         RESULTS_DIR,
    'IN_REVIEW':         REVIEWS_DIR,
    'CHANGES_REQUESTED': ACTIVE_DIR,
    'VERIFIED':          REVIEWS_DIR,
    'AWAITING_FOUNDER':  DECISIONS_DIR,
    'APPROVED':          ARCHIVE_DIR,
    'REJECTED':          ARCHIVE_DIR,
    'MERGED':            ARCHIVE_DIR,
    'CLOSED':            ARCHIVE_DIR,
    'BLOCKED':           ACTIVE_DIR,
    'CANCELLED':         ARCHIVE_DIR,
}

GATE_STATUS_FILE = os.path.join(AOS_ROOT, 'GATE-STATUS.json')

def _task_path(task_id, status):
    directory = STATUS_DIR.get(status, ACTIVE_DIR)
    return os.path.join(directory, f'{task_id}.json')

def find_task_file(task_id):
    for directory in [INBOX_DIR, ACTIVE_DIR, RESULTS_DIR, REVIEWS_DIR,
                      DECISIONS_DIR, ARCHIVE_DIR]:
        p = os.path.join(directory, f'{task_id}.json')
        if os.path.exists(p):
            return p
    return None

def load_task(task_id):
    p = find_task_file(task_id)
    if not p:
        raise FileNotFoundError(f'Task {task_id} not found')
    return read_json(p)

# ── Task CRUD ─────────────────────────────────────────────────────────────────

def create_task(title, objective, role, priority='P1', tags=None, dod=None,
                dependencies=None, budget_tokens=100_000, max_turns=MAX_TURNS,
                files_allowed=None, notes=''):
    if role not in VALID_ROLES:
        raise ValueError(f'Invalid role: {role}. Must be one of {VALID_ROLES}')
    task_id = new_task_id()
    ts = now_iso()
    task = {
        'id':             task_id,
        'title':          title,
        'objective':      objective,
        'role':           role,
        'priority':       priority,
        'status':         'READY',
        'tags':           tags or [],
        'dod':            dod or [],
        'dependencies':   dependencies or [],
        'budget_tokens':  budget_tokens,
        'max_turns':      max_turns,
        'max_retries':    MAX_RETRIES,
        'retry_count':    0,
        'files_allowed':  files_allowed or [],
        'notes':          notes,
        'claimed_by':     None,
        'claimed_at':     None,
        'submitted_at':   None,
        'verified_at':    None,
        'created_at':     ts,
        'updated_at':     ts,
        'history': [{'from': None, 'to': 'READY', 'by': 'ORCHESTRATOR', 'at': ts, 'note': 'Task created'}],
    }
    path = _task_path(task_id, 'READY')
    write_json(path, task)
    _index_task(task)
    audit('TASK_CREATED', {'task_id': task_id, 'title': title, 'role': role, 'priority': priority})
    return task

def transition_task(task_id, new_status, by='SYSTEM', note=''):
    """Transition a task to a new status. Enforces valid transitions."""
    path = find_task_file(task_id)
    if not path:
        raise FileNotFoundError(f'Task {task_id} not found')

    with FileLock(path):
        task = read_json(path)
        old_status = task['status']

        if new_status == old_status:
            return task

        allowed = VALID_TRANSITIONS.get(old_status, [])
        if new_status not in allowed:
            raise ValueError(
                f'Invalid transition {old_status} → {new_status} for {task_id}. '
                f'Allowed: {allowed}'
            )

        # Move file to new directory
        new_path = _task_path(task_id, new_status)
        if new_path != path:
            os.makedirs(os.path.dirname(new_path), exist_ok=True)
            # Write updated task to new location, then remove old
            task['status']     = new_status
            task['updated_at'] = now_iso()
            task['history'].append({
                'from': old_status, 'to': new_status,
                'by': by, 'at': task['updated_at'], 'note': note,
            })
            write_json(new_path, task)
            os.unlink(path)
        else:
            task['status']     = new_status
            task['updated_at'] = now_iso()
            task['history'].append({
                'from': old_status, 'to': new_status,
                'by': by, 'at': task['updated_at'], 'note': note,
            })
            write_json(path, task)

    _index_task(task)
    audit('TASK_TRANSITION', {
        'task_id': task_id, 'from': old_status, 'to': new_status, 'by': by, 'note': note
    })
    return task

def update_task_fields(task_id, updates):
    path = find_task_file(task_id)
    if not path:
        raise FileNotFoundError(f'Task {task_id} not found')
    with FileLock(path):
        task = read_json(path)
        task.update(updates)
        task['updated_at'] = now_iso()
        write_json(path, task)
    _index_task(task)
    return task

# ── Decision CRUD ─────────────────────────────────────────────────────────────

def _decision_path(decision_id):
    return os.path.join(DECISIONS_DIR, f'{decision_id}.json')

def assert_no_open_gaps(gap_register_path=None, fail_hard=True):
    """
    GAP-GATE — Block readiness decisions if open P0/P1 gaps exist in RUNTIME-GAP-REGISTER.md.

    Why: D-001 was issued with AUTH-OFFLINE-02 (GAP-A) still open because RUNTIME_VERIFICATION
    crossed AUDIT-FINDINGS.md but not RUNTIME-GAP-REGISTER.md. This gate prevents recurrence.

    Returns list of open gap IDs (empty = clean). If fail_hard=True and gaps exist, raises.
    """
    if gap_register_path is None:
        gap_register_path = os.path.join(REPO_ROOT, 'docs', 'runtime', 'RUNTIME-GAP-REGISTER.md')
    if not os.path.exists(gap_register_path):
        return []  # register not present → can't block (log a warning)
    open_gaps = []
    try:
        with open(gap_register_path) as f:
            content = f.read()
        # Scan for open gap headers: "## GAP-xxx" followed by a Status line that is NOT CLOSED
        import re
        blocks = re.split(r'\n## (GAP-[A-Za-z0-9-]+)', content)
        # blocks: [preamble, gap_id, gap_body, gap_id, gap_body, ...]
        for i in range(1, len(blocks), 2):
            gap_id = blocks[i]
            gap_body = blocks[i+1] if i+1 < len(blocks) else ''
            # Find status line: "| Status | CLOSED |" or "**Status:** CLOSED"
            status_match = re.search(r'\|\s*[Ss]tatus\s*\|\s*(\w+)', gap_body)
            if not status_match:
                status_match = re.search(r'\*\*[Ss]tatus[:\*]+\s*(\w+)', gap_body)
            status = status_match.group(1).upper() if status_match else 'UNKNOWN'
            if status not in ('CLOSED', 'RESOLVED', 'MERGED'):
                # Check severity — only block on P0/P1
                sev_match = re.search(r'\|\s*[Ss]everity\s*\|\s*(P\d)', gap_body)
                if not sev_match:
                    sev_match = re.search(r'\*\*[Ss]everity[:\*]+\s*(P\d)', gap_body)
                sev = sev_match.group(1) if sev_match else 'P1'  # conservative default
                if sev in ('P0', 'P1'):
                    open_gaps.append(f'{gap_id} [{sev}] status={status}')
    except Exception as e:
        audit('GAP_GATE_ERROR', {'error': str(e)})
        return []
    if open_gaps and fail_hard:
        raise RuntimeError(
            f'GAP-GATE: {len(open_gaps)} open P0/P1 gap(s) in RUNTIME-GAP-REGISTER — '
            f'cannot create readiness decision until resolved: {open_gaps}. '
            'Fix gaps or get explicit Founder waiver before proceeding.'
        )
    return open_gaps

def create_decision(task_id, objective, what_changed, why_it_matters,
                    commit=None, tests_summary='', verification='VERIFIED',
                    risk='BAJO', rollback='No aplica',
                    runtime_health_delta='Sin cambio', action_requested='APROBAR MERGE',
                    skip_gap_gate=False):
    # GAP-GATE: readiness decisions cannot be issued while P0/P1 gaps are open.
    # skip_gap_gate=True only when Founder has explicitly waived (put reason in what_changed).
    if not skip_gap_gate:
        assert_no_open_gaps(fail_hard=True)  # raises if open gaps found

    decision_id = new_decision_id()
    ts = now_iso()
    decision = {
        'id':                   decision_id,
        'task_id':              task_id,
        'status':               'AWAITING_FOUNDER',
        'created_at':           ts,
        'updated_at':           ts,
        'objective':            objective,
        'what_changed':         what_changed,
        'why_it_matters':       why_it_matters,
        'commit':               commit,
        'tests_summary':        tests_summary,
        'verification':         verification,
        'risk':                 risk,
        'rollback':             rollback,
        'runtime_health_delta': runtime_health_delta,
        'action_requested':     action_requested,
        'response':             None,
        'response_at':          None,
        'response_notes':       None,
    }
    write_json(_decision_path(decision_id), decision)
    audit('DECISION_CREATED', {'decision_id': decision_id, 'task_id': task_id})
    _refresh_founder_inbox()
    return decision

def respond_to_decision(decision_id, response, notes='', by='FOUNDER'):
    if response not in ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'):
        raise ValueError(f'response must be APPROVED, REJECTED, or CHANGES_REQUESTED')
    path = _decision_path(decision_id)
    if not os.path.exists(path):
        raise FileNotFoundError(f'Decision {decision_id} not found')
    with FileLock(path):
        decision = read_json(path)
        decision['status']       = response
        decision['response']     = response
        decision['response_at']  = now_iso()
        decision['response_notes'] = notes
        decision['updated_at']   = now_iso()
        write_json(path, decision)
    audit('DECISION_RESPONSE', {
        'decision_id': decision_id, 'response': response, 'by': by
    })
    _refresh_founder_inbox()
    return decision

def load_pending_decisions():
    decisions = []
    if os.path.isdir(DECISIONS_DIR):
        for fn in sorted(os.listdir(DECISIONS_DIR)):
            if fn.startswith('D-') and fn.endswith('.json') and not fn.endswith('.tmp'):
                d = read_json(os.path.join(DECISIONS_DIR, fn), {})
                if d.get('status') == 'AWAITING_FOUNDER':
                    decisions.append(d)
    return decisions

# ── Gate completion tracking ──────────────────────────────────────────────────

def mark_gate_completed(gate_tag: str):
    """Record that a gate is done so the Orchestrator won't recreate its task."""
    with FileLock(STATE_FILE):
        state = _load_state_raw()
        gates = state.get('completed_gates', [])
        if gate_tag not in gates:
            gates.append(gate_tag)
        state['completed_gates'] = gates
        _save_state_raw(state)
    audit('GATE_COMPLETED', {'gate_tag': gate_tag})

def is_gate_completed(gate_tag: str) -> bool:
    return gate_tag in _load_state_raw().get('completed_gates', [])

# ── Decision propagation ──────────────────────────────────────────────────────

def _archive_decision_file(decision_id: str):
    """Move decision file from decisions/ to archive/."""
    src = _decision_path(decision_id)
    if not os.path.exists(src):
        return
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    dst = os.path.join(ARCHIVE_DIR, f'{decision_id}.json')
    d = read_json(src)
    d['archived_at'] = now_iso()
    write_json(dst, d)
    os.unlink(src)
    _refresh_founder_inbox()

def propagate_decision_to_task(decision_id: str):
    """
    Propagate a Founder Decision result to the linked task.

    Root cause of original bug (D-001/D-002 desync): approve_decision.py called
    respond_to_decision() which only updated D-XXX.json. It did NOT transition the
    linked task from AWAITING_FOUNDER → APPROVED → MERGED, and did NOT update the
    heartbeat. This function fixes that gap.

    Called by: approve_decision.py, reject_decision.py, supervisor.py reconcile loop.
    """
    path = _decision_path(decision_id)
    if not os.path.exists(path):
        # May already be archived
        arch = os.path.join(ARCHIVE_DIR, f'{decision_id}.json')
        if not os.path.exists(arch):
            return
        return  # Already propagated
    d = read_json(path)
    response = d.get('response')
    task_id  = d.get('task_id')

    if not response or response == 'CHANGES_REQUESTED':
        return  # Nothing to propagate for changes-requested

    if not task_id:
        _archive_decision_file(decision_id)
        return

    # Find task regardless of current directory
    task_path = find_task_file(task_id)
    if not task_path:
        audit('PROPAGATION_SKIP', {'decision_id': decision_id, 'reason': f'{task_id} not found'})
        _archive_decision_file(decision_id)
        return

    task = read_json(task_path)
    current_status = task.get('status', '')

    if response == 'APPROVED':
        if current_status == 'AWAITING_FOUNDER':
            transition_task(task_id, 'APPROVED', by='SUPERVISOR',
                           note=f'Decision {decision_id} approved by Founder')
            transition_task(task_id, 'MERGED', by='SUPERVISOR',
                           note='Auto-merged after Founder approval')
        for tag in task.get('tags', []):
            mark_gate_completed(tag)
        audit('DECISION_PROPAGATED', {
            'decision_id': decision_id, 'task_id': task_id,
            'task_final': 'MERGED', 'response': 'APPROVED',
        })

    elif response == 'REJECTED':
        if current_status == 'AWAITING_FOUNDER':
            transition_task(task_id, 'REJECTED', by='SUPERVISOR',
                           note=f'Decision {decision_id} rejected by Founder')
            transition_task(task_id, 'CANCELLED', by='SUPERVISOR',
                           note='Cancelled after rejection')
        audit('DECISION_PROPAGATED', {
            'decision_id': decision_id, 'task_id': task_id,
            'task_final': 'CANCELLED', 'response': 'REJECTED',
        })

    _archive_decision_file(decision_id)

# ── Result/Review CRUD ────────────────────────────────────────────────────────

def _result_path(task_id):
    return os.path.join(RESULTS_DIR, f'{task_id}.result.json')

def _review_path(task_id):
    return os.path.join(REVIEWS_DIR, f'{task_id}.review.json')

def submit_result(task_id, submitted_by, summary, verdict, evidence='',
                  commit=None, tests_passed=None, tests_total=None,
                  gaps_found=None, next_steps=None):
    ts = now_iso()
    result = {
        'task_id':      task_id,
        'submitted_by': submitted_by,
        'submitted_at': ts,
        'verdict':      verdict,
        'summary':      summary,
        'evidence':     evidence,
        'commit':       commit,
        'tests_passed': tests_passed,
        'tests_total':  tests_total,
        'gaps_found':   gaps_found or [],
        'next_steps':   next_steps or [],
    }
    os.makedirs(RESULTS_DIR, exist_ok=True)
    write_json(_result_path(task_id), result)
    audit('RESULT_SUBMITTED', {'task_id': task_id, 'verdict': verdict, 'by': submitted_by})
    return result

def submit_review(task_id, reviewed_by, verdict, findings=None,
                  return_to_engineer=False, return_reason=None, notes=''):
    if verdict not in ('VERIFIED', 'PARTIAL', 'FAILED', 'UNVERIFIED'):
        raise ValueError(f'verdict must be VERIFIED, PARTIAL, FAILED, or UNVERIFIED')
    ts = now_iso()
    review = {
        'task_id':            task_id,
        'reviewed_by':        reviewed_by,
        'reviewed_at':        ts,
        'verdict':            verdict,
        'findings':           findings or [],
        'return_to_engineer': return_to_engineer,
        'return_reason':      return_reason,
        'notes':              notes,
    }
    os.makedirs(REVIEWS_DIR, exist_ok=True)
    write_json(_review_path(task_id), review)
    audit('REVIEW_SUBMITTED', {
        'task_id': task_id, 'verdict': verdict, 'return': return_to_engineer, 'by': reviewed_by
    })
    return review

def load_result(task_id):
    return read_json(_result_path(task_id), None)

def load_review(task_id):
    return read_json(_review_path(task_id), None)

# ── FOUNDER-INBOX.md refresh ──────────────────────────────────────────────────

def _refresh_founder_inbox():
    decisions = load_pending_decisions()
    lines = ['# FOUNDER-INBOX', '',
             f'*Actualizado: {now_iso()}*', '',
             '---', '']

    if not decisions:
        lines += ['> No hay decisiones pendientes.', '']
    else:
        for d in decisions:
            lines += [
                f'## {d["id"]} — {d.get("objective", "")[:60]}',
                '',
                f'| Campo | Valor |',
                f'|---|---|',
                f'| Objetivo | {d.get("objective", "")} |',
                f'| Qué cambió | {d.get("what_changed", "")} |',
                f'| Por qué importa | {d.get("why_it_matters", "")} |',
                f'| Commit | `{d.get("commit") or "—"}` |',
                f'| Tests | {d.get("tests_summary", "—")} |',
                f'| Verificación | {d.get("verification", "—")} |',
                f'| Riesgo | {d.get("risk", "—")} |',
                f'| Rollback | {d.get("rollback", "—")} |',
                f'| Runtime Health | {d.get("runtime_health_delta", "—")} |',
                f'| Acción | **{d.get("action_requested", "—")}** |',
                '',
                f'Respuestas permitidas: `APROBAR` · `RECHAZAR` · `PEDIR CAMBIOS`',
                '',
                f'```',
                f'python scripts/agent-os/approve_decision.py {d["id"]}',
                f'python scripts/agent-os/reject_decision.py {d["id"]}',
                f'python scripts/agent-os/request_changes.py {d["id"]} "motivo"',
                f'```',
                '',
                '---',
                '',
            ]

    with open(INBOX_MD, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

# ── Blocked-task detection ────────────────────────────────────────────────────

def find_stuck_tasks(stuck_minutes=60):
    stuck = []
    for directory in [ACTIVE_DIR, REVIEWS_DIR]:
        if not os.path.isdir(directory):
            continue
        for fn in os.listdir(directory):
            if not fn.endswith('.json') or fn.endswith('.tmp') or fn.endswith('.lock'):
                continue
            p = os.path.join(directory, fn)
            task = read_json(p, {})
            updated = task.get('updated_at', '')
            if updated:
                try:
                    dt = datetime.datetime.strptime(updated, '%Y-%m-%dT%H:%M:%SZ')
                    age_min = (datetime.datetime.utcnow() - dt).total_seconds() / 60
                    if age_min > stuck_minutes:
                        stuck.append({'task': task, 'age_minutes': round(age_min)})
                except ValueError:
                    pass
    return stuck

# ── Init dirs ─────────────────────────────────────────────────────────────────

def ensure_dirs():
    for d in [INBOX_DIR, ACTIVE_DIR, RESULTS_DIR, REVIEWS_DIR,
              DECISIONS_DIR, HANDOFFS_DIR, ARCHIVE_DIR]:
        os.makedirs(d, exist_ok=True)
    if not os.path.exists(AUDIT_FILE):
        open(AUDIT_FILE, 'a').close()
    if not os.path.exists(STATE_FILE):
        _save_state_raw(_default_state())
    if not os.path.exists(TASKS_FILE):
        write_json(TASKS_FILE, {})
    if not os.path.exists(INBOX_MD):
        _refresh_founder_inbox()

# ── Worktree management ───────────────────────────────────────────────────────

def create_task_worktree(task_id: str) -> tuple:
    """Create isolated git branch + worktree for a task. Returns (branch, worktree_path)."""
    branch = f'agent-os/{task_id}'
    worktree_path = f'/tmp/fullsite-worker-{task_id}'

    # Create branch from current HEAD if it doesn't exist
    r = subprocess.run(['git', 'show-ref', '--verify', '--quiet', f'refs/heads/{branch}'],
                      cwd=REPO_ROOT, capture_output=True)
    if r.returncode != 0:
        subprocess.run(['git', 'branch', branch, 'HEAD'],
                      cwd=REPO_ROOT, capture_output=True, check=True)

    # Remove stale worktree if present
    if os.path.exists(worktree_path):
        subprocess.run(['git', 'worktree', 'remove', '--force', worktree_path],
                      cwd=REPO_ROOT, capture_output=True)
    # Also prune stale refs
    subprocess.run(['git', 'worktree', 'prune'], cwd=REPO_ROOT, capture_output=True)

    r = subprocess.run(['git', 'worktree', 'add', worktree_path, branch],
                      cwd=REPO_ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'git worktree add failed: {r.stderr.strip()}')

    update_task_fields(task_id, {'branch': branch, 'worktree_path': worktree_path})
    audit('WORKTREE_CREATED', {'task_id': task_id, 'branch': branch, 'path': worktree_path})
    return branch, worktree_path


def cleanup_task_worktree(task_id: str):
    """Remove worktree (branch preserved for audit trail)."""
    try:
        task = load_task(task_id)
        path = task.get('worktree_path', f'/tmp/fullsite-worker-{task_id}')
    except Exception:
        path = f'/tmp/fullsite-worker-{task_id}'
    if os.path.exists(path):
        subprocess.run(['git', 'worktree', 'remove', '--force', path],
                      cwd=REPO_ROOT, capture_output=True)
    subprocess.run(['git', 'worktree', 'prune'], cwd=REPO_ROOT, capture_output=True)
    audit('WORKTREE_REMOVED', {'task_id': task_id, 'path': path})


def get_task_diff(task_id: str) -> tuple:
    """Return (diff_stat, diff_patch) for task branch vs main, excluding agent-os state files."""
    try:
        task = load_task(task_id)
        branch = task.get('branch', f'agent-os/{task_id}')
    except Exception:
        branch = f'agent-os/{task_id}'

    # Exclude agent-os state/script dirs so verifier sees only task-relevant changes
    exclude = [':(exclude)docs/agent-os/', ':(exclude)scripts/agent-os/']
    stat = subprocess.run(
        ['git', 'diff', f'main..{branch}', '--stat', '--'] + exclude,
        cwd=REPO_ROOT, capture_output=True, text=True,
    ).stdout
    patch = subprocess.run(
        ['git', 'diff', f'main..{branch}', '--unified=3', '--'] + exclude,
        cwd=REPO_ROOT, capture_output=True, text=True,
    ).stdout
    return stat[:3000], patch[:10000]


def _clear_branch_conflicts(branch: str):
    """
    Clear staged/working-tree conflicts for files the branch will introduce.

    Avoids git-stash (stash pops revert agent-os task JSON files, corrupting state).
    Instead: unstage + discard tracked changes, delete new untracked staged files.
    """
    r = subprocess.run(
        ['git', 'diff', '--name-only', f'HEAD...{branch}'],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if r.returncode != 0:
        return

    branch_files = [
        f.strip() for f in r.stdout.splitlines()
        if f.strip()
        and not f.startswith('docs/agent-os/')
        and not f.startswith('scripts/agent-os/')
    ]
    if not branch_files:
        return

    status_r = subprocess.run(
        ['git', 'status', '--porcelain'] + branch_files,
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    staged, new_staged, modified = [], [], []
    for line in status_r.stdout.splitlines():
        if len(line) < 3:
            continue
        xy, path = line[:2], line[3:].strip()
        if xy[0] in ('A', 'M', 'D'):
            staged.append(path)
            if xy[0] == 'A':
                new_staged.append(path)
            else:
                modified.append(path)

    if staged:
        subprocess.run(['git', 'restore', '--staged', '--'] + staged,
                       cwd=REPO_ROOT, capture_output=True)
    for f in modified:
        subprocess.run(['git', 'restore', '--', f], cwd=REPO_ROOT, capture_output=True)
    for f in new_staged:
        full = os.path.join(REPO_ROOT, f)
        if os.path.exists(full):
            os.remove(full)


def merge_and_close_task(task_id: str, evidence: str) -> str:
    """
    Merge task branch into main, transition to CLOSED, update gates.
    Returns merge commit hash.
    Only for R3 (non-gate) tasks. R1 gate tasks go through Founder Decision.
    """
    task = load_task(task_id)
    branch = task.get('branch', f'agent-os/{task_id}')
    title = task.get('title', task_id)[:60]
    tags = task.get('tags', [])

    # Clear staging conflicts from old pre-worktree workers before merging.
    # Do NOT stash: stash pops corrupt agent-os task JSON files (state regression).
    _clear_branch_conflicts(branch)

    r = subprocess.run(
        ['git', 'merge', '--no-ff', '-X', 'ours', branch,
         '-m', f'merge({task_id}): {title}'],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f'Merge failed for {task_id}/{branch}: {r.stderr.strip()}')

    commit = subprocess.run(
        ['git', 'rev-parse', 'HEAD'],
        cwd=REPO_ROOT, capture_output=True, text=True,
    ).stdout.strip()

    transition_task(task_id, 'CLOSED', by='SUPERVISOR',
                   note=f'Pipeline complete. Merge commit: {commit}')
    update_task_fields(task_id, {
        'closed_at': now_iso(),
        'merge_commit': commit,
        'close_evidence': evidence[:500],
        'gate_updated': tags,
    })

    for tag in tags:
        mark_gate_completed(tag)
    _write_gate_status_entries(tags, task_id, commit, evidence)
    cleanup_task_worktree(task_id)

    audit('TASK_CLOSED', {'task_id': task_id, 'commit': commit, 'gates': tags,
                          'evidence': evidence[:200]})
    return commit


def _write_gate_status_entries(gates: list, task_id: str, commit: str, evidence: str):
    with FileLock(GATE_STATUS_FILE):
        data = read_json(GATE_STATUS_FILE, {})
        for gate in gates:
            data[gate] = {
                'status': 'CLOSED',
                'task_id': task_id,
                'commit': commit,
                'evidence': evidence[:300],
                'closed_at': now_iso(),
            }
        write_json(GATE_STATUS_FILE, data)


if __name__ == '__main__':
    ensure_dirs()
    print('Agent OS dirs initialized.')

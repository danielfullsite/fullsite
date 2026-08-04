#!/usr/bin/env python3
"""
Fullsite Agent OS Supervisor — persistent 24/7 daemon.

Managed by launchd as com.fullsite.agent-os.
PID lock: /tmp/com.fullsite.agent-os.pid

Loop:
  reconcile decisions → recover stuck → orchestrate → dispatch → collect → heartbeat → sleep
"""
import sys, os, signal, time, subprocess, json, atexit, traceback, datetime

SCRIPTS_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_ROOT)

from shared import (
    is_killed, load_tasks_index, load_pending_decisions, load_task, find_task_file,
    propagate_decision_to_task, transition_task, mark_gate_completed,
    is_gate_completed, audit, ensure_dirs, now_iso, read_json, write_json,
    DECISIONS_DIR, ARCHIVE_DIR, RESULTS_DIR, REPO_ROOT, AOS_ROOT,
    update_task_fields, load_result,
    create_task_worktree, cleanup_task_worktree, merge_and_close_task,
)
import orchestrator as _orchestrator

# ── Config ────────────────────────────────────────────────────────────────────

PID_FILE        = '/tmp/com.fullsite.agent-os.pid'
HEARTBEAT_FILE  = os.path.join(AOS_ROOT, 'HEARTBEAT.json')
LOGS_DIR        = os.path.join(REPO_ROOT, 'logs', 'agent-os')
WORKERS_LOG_DIR = os.path.join(LOGS_DIR, 'workers')

LOOP_IDLE_S      = 30     # sleep when no work
LOOP_ACTIVE_S    = 10     # sleep after dispatching work
WORKER_TIMEOUT_S = 600    # max seconds a worker can run
MAX_BACKOFF_S    = 300    # max error backoff

MAX_ENGINEERS    = 2
MAX_VERIFIERS    = 1
STUCK_MIN        = 60     # minutes before a task is considered stuck

# active workers: key → {'proc': Popen, 'phase': str, 'started': str, 'pid': int, 'log': str}
_workers: dict = {}
_shutdown       = False
_last_completed = None
_errors: list   = []

# ── PID management ────────────────────────────────────────────────────────────

def _acquire_pid_lock():
    if os.path.exists(PID_FILE):
        try:
            old_pid = int(open(PID_FILE).read().strip())
            os.kill(old_pid, 0)
            print(f'[supervisor] Already running with PID {old_pid}. Exiting.')
            sys.exit(0)
        except (ProcessLookupError, ValueError):
            pass  # stale PID file
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))

def _release_pid_lock():
    if os.path.exists(PID_FILE):
        try:
            stored = int(open(PID_FILE).read().strip())
            if stored == os.getpid():
                os.unlink(PID_FILE)
        except Exception:
            pass

def _handle_sigterm(sig, frame):
    global _shutdown
    _log('SIGTERM/SIGINT received — shutting down cleanly')
    _shutdown = True

# ── Logging ───────────────────────────────────────────────────────────────────

def _log(msg: str):
    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    print(f'[{ts}] {msg}', flush=True)

def _ts_label() -> str:
    return datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%S')

# ── Heartbeat ─────────────────────────────────────────────────────────────────

def _write_heartbeat(status: str = None, next_action: str = ''):
    pending = load_pending_decisions()
    active_workers = {k: {'pid': w['pid'], 'phase': w['phase'], 'started': w['started']}
                      for k, w in _workers.items()}
    index = load_tasks_index()

    # Determine status
    if status is None:
        if is_killed():
            status = 'KILLED'
        elif _workers:
            status = 'RUNNING'
        elif pending:
            status = 'AWAITING_FOUNDER'
        elif _all_remaining_work_is_field_or_external(index):
            status = 'WAITING_FIELD'
        else:
            status = 'IDLE'

    hb = {
        'supervisor_status': status,
        'pid':               os.getpid(),
        'last_heartbeat':    now_iso(),
        'current_task':      next(iter(_workers), None),
        'current_role':      _workers[next(iter(_workers))]['phase'] if _workers else None,
        'next_action':       next_action or _compute_next_action(index, pending),
        'last_completed_task': _last_completed,
        'active_workers':    active_workers,
        'pending_decisions': len(pending),
        'errors':            _errors[-5:],
        'kill_switch':       is_killed(),
    }
    tmp = HEARTBEAT_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(hb, f, indent=2)
    os.replace(tmp, HEARTBEAT_FILE)

def _all_remaining_work_is_field_or_external(index: dict) -> bool:
    active_statuses = {'READY', 'CLAIMED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED'}
    return not any(m['status'] in active_statuses for m in index.values())

def _compute_next_action(index: dict, pending: list) -> str:
    if pending:
        ids = [d['id'] for d in pending]
        return f'Founder decision needed: {", ".join(ids)}'
    ready = [tid for tid, m in index.items() if m['status'] == 'READY']
    if ready:
        return f'Dispatching workers for: {", ".join(ready)}'
    if _workers:
        return f'Workers running: {list(_workers.keys())}'
    return 'Idle — waiting for new work or field execution'

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    ensure_dirs()
    os.makedirs(LOGS_DIR, exist_ok=True)
    os.makedirs(WORKERS_LOG_DIR, exist_ok=True)

    _acquire_pid_lock()
    atexit.register(_release_pid_lock)
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    _log(f'Supervisor started — PID {os.getpid()}')
    audit('SUPERVISOR_STARTED', {'pid': os.getpid()})
    _write_heartbeat('STARTING', 'Initializing')

    backoff = LOOP_ACTIVE_S
    while not _shutdown:
        try:
            did_work = _loop_once()
            _errors.clear()
            backoff = LOOP_ACTIVE_S if did_work else LOOP_IDLE_S
        except Exception:
            err = traceback.format_exc()
            _log(f'ERROR in loop:\n{err}')
            _errors.append({'ts': now_iso(), 'error': err[-500:]})
            _errors[:] = _errors[-10:]
            backoff = min(backoff * 2, MAX_BACKOFF_S)
        _write_heartbeat()
        time.sleep(backoff)

    _log('Supervisor exiting')
    audit('SUPERVISOR_STOPPED', {'pid': os.getpid()})

def _loop_once() -> bool:
    global _last_completed

    if is_killed():
        if _workers:
            _log(f'Kill switch ON — waiting for {len(_workers)} workers to finish cleanly')
            _reap_workers()
            _write_heartbeat('KILL_PENDING',
                             f'Draining {len(_workers)} workers before exit')
            return False
        _log('Kill switch ON, no active workers — exiting cleanly')
        _write_heartbeat('KILLED', 'Kill switch activated, state preserved')
        sys.exit(0)

    # 1. Reap finished workers
    _reap_workers()

    # 2. Propagate approved/rejected decisions to task state
    _reconcile_decisions()

    # 3. Recover tasks stuck with no active worker
    _recover_stuck_tasks()

    # 4. Create new tasks per Orchestrator logic
    try:
        _orchestrator.run()
    except SystemExit:
        pass
    except Exception as e:
        _log(f'Orchestrator error: {e}')

    # 5. Dispatch workers for READY tasks
    dispatched = _dispatch_workers()

    # 6. Transition SUBMITTED → IN_REVIEW, launch verifiers
    _handle_submitted_tasks()

    # 7. Auto-close VERIFIED tasks that don't need Founder gate
    _handle_verified_tasks()

    return dispatched > 0

# ── Decision reconciliation ───────────────────────────────────────────────────

def _reconcile_decisions():
    if not os.path.isdir(DECISIONS_DIR):
        return
    for fn in list(os.listdir(DECISIONS_DIR)):
        if not fn.startswith('D-') or not fn.endswith('.json'):
            continue
        path = os.path.join(DECISIONS_DIR, fn)
        try:
            d = read_json(path)
        except Exception:
            continue
        response = d.get('response')
        if response in ('APPROVED', 'REJECTED'):
            decision_id = fn.replace('.json', '')
            _log(f'Reconciling {decision_id} ({response}) → task {d.get("task_id")}')
            try:
                propagate_decision_to_task(decision_id)
            except Exception as e:
                _log(f'Propagation error {decision_id}: {e}')

# ── Stuck task recovery ───────────────────────────────────────────────────────

def _recover_stuck_tasks():
    index = load_tasks_index()
    # IN_REVIEW can also get stuck if verifier worker dies
    stuck_statuses = {'CLAIMED', 'IN_PROGRESS', 'IN_REVIEW', 'SUBMITTED'}
    now_dt = datetime.datetime.now(datetime.timezone.utc)

    for task_id, meta in index.items():
        if meta['status'] not in stuck_statuses:
            continue
        if task_id in _workers or f'{task_id}_verify' in _workers:
            continue
        try:
            task = load_task(task_id)
            updated = task.get('updated_at', '')
            updated_dt = datetime.datetime.fromisoformat(updated.replace('Z', '+00:00'))
            age_min = (now_dt - updated_dt).total_seconds() / 60
            if age_min > STUCK_MIN:
                _log(f'Recovering stuck task {task_id} (age {age_min:.0f}m, status {meta["status"]})')
                # IN_REVIEW/SUBMITTED stuck → back to READY for full retry
                target = 'READY'
                transition_task(task_id, target, by='SUPERVISOR',
                               note=f'Recovered: stuck {meta["status"]} for {age_min:.0f}m, no active worker')
                # Clean up any stale worktree so next dispatch creates fresh one
                try:
                    cleanup_task_worktree(task_id)
                except Exception:
                    pass
                audit('TASK_RECOVERED', {'task_id': task_id, 'from': meta['status'], 'age_min': age_min})
        except Exception as e:
            _log(f'Recovery check error {task_id}: {e}')

# ── Worker dispatch ───────────────────────────────────────────────────────────

def _dispatch_workers() -> int:
    if is_killed():
        return 0  # kill switch: no new claims

    index = load_tasks_index()
    eng_count = sum(1 for w in _workers.values() if w['phase'] == 'engineer')
    dispatched = 0

    priority_order = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}
    sorted_tasks = sorted(
        [(tid, m) for tid, m in index.items() if m['status'] == 'READY'],
        key=lambda x: priority_order.get(x[1].get('priority', 'P3'), 99)
    )

    for task_id, meta in sorted_tasks:
        if task_id in _workers:
            continue
        role = meta.get('role', '')
        if role == 'RUNTIME_ENGINEER' and eng_count >= MAX_ENGINEERS:
            continue
        if role == 'RUNTIME_VERIFICATION' and eng_count >= MAX_VERIFIERS:
            continue

        # Create isolated branch + worktree before dispatching engineer
        try:
            branch, worktree_path = create_task_worktree(task_id)
            _log(f'Worktree ready: {worktree_path} (branch={branch})')
        except Exception as e:
            _log(f'Worktree creation failed for {task_id}: {e} — skipping this cycle')
            _errors.append({'ts': now_iso(), 'error': f'worktree:{task_id}:{str(e)[:200]}'})
            continue

        _launch_worker(task_id, 'engineer')
        eng_count += 1
        dispatched += 1

    return dispatched

def _handle_submitted_tasks():
    index = load_tasks_index()
    ver_count = sum(1 for w in _workers.values() if w['phase'] == 'verify')

    for task_id, meta in index.items():
        if meta['status'] != 'SUBMITTED':
            continue
        verify_key = f'{task_id}_verify'
        if verify_key in _workers:
            continue
        if ver_count >= MAX_VERIFIERS:
            continue

        _log(f'Task {task_id} SUBMITTED → IN_REVIEW, launching verifier')
        try:
            transition_task(task_id, 'IN_REVIEW', by='SUPERVISOR',
                           note='Auto-transitioned by supervisor')
            _launch_worker(task_id, 'verify')
            ver_count += 1
        except Exception as e:
            _log(f'Error handling submitted task {task_id}: {e}')

def _handle_verified_tasks():
    """
    VERIFIED tasks:
    - R1 gate tasks → Founder Decision (touch production readiness).
    - R3 and other tasks → merge branch + CLOSED + gate update (fully autonomous).
    """
    global _last_completed
    index = load_tasks_index()
    for task_id, meta in index.items():
        if meta['status'] != 'VERIFIED':
            continue
        if task_id in _workers or f'{task_id}_verify' in _workers:
            continue  # still has an active worker
        tags = meta.get('tags', [])
        is_r1_gate = any(t.startswith('r1') or 'field-batch' in t for t in tags)
        try:
            if is_r1_gate:
                _maybe_create_founder_decision(task_id)
            else:
                result = load_result(task_id)
                evidence = result.get('evidence', 'Verified') if result else 'Verified'
                _log(f'Closing R3 task {task_id} — merge + CLOSED + gate update')
                commit = merge_and_close_task(task_id, evidence)
                _last_completed = task_id
                _log(f'Task {task_id} CLOSED. Merge commit: {commit}')
                audit('PIPELINE_COMPLETE', {
                    'task_id': task_id,
                    'commit': commit,
                    'gates': tags,
                })
        except Exception as e:
            _log(f'Error closing verified task {task_id}: {e}')
            _errors.append({'ts': now_iso(), 'error': f'close:{task_id}:{str(e)[:200]}'})

def _maybe_create_founder_decision(task_id: str):
    from shared import create_decision, load_result
    task = load_task(task_id)
    result = load_result(task_id)
    if not result:
        return
    # Check no decision already exists for this task
    if os.path.isdir(DECISIONS_DIR):
        for fn in os.listdir(DECISIONS_DIR):
            if fn.startswith('D-') and fn.endswith('.json'):
                d = read_json(os.path.join(DECISIONS_DIR, fn))
                if d.get('task_id') == task_id and d.get('status') == 'AWAITING_FOUNDER':
                    return  # decision already pending
    _log(f'Creating Founder Decision for VERIFIED gate task {task_id}')
    create_decision(
        task_id=task_id,
        objective=f'APROBAR MERGE — {task["title"]}',
        what_changed=result.get('evidence', 'Task verified'),
        why_it_matters=task.get('objective', ''),
        commit=result.get('commit'),
        tests_summary=f'{result.get("tests_passed", "?")} / {result.get("tests_total", "?")} tests PASS',
        verification='VERIFIED',
        risk='BAJO',
        action_requested='APROBAR MERGE A MAIN',
        skip_gap_gate=True,  # GAP-GATE already cleared when task was verified
    )

# ── Worker launch & reaping ───────────────────────────────────────────────────

def _launch_worker(task_id: str, phase: str):
    ts = _ts_label()
    log_path = os.path.join(WORKERS_LOG_DIR, f'{task_id}-{phase}-{ts}.log')
    worker_script = os.path.join(SCRIPTS_ROOT, 'worker.py')
    cmd = [sys.executable, worker_script, task_id, phase]

    _log(f'Launching worker: {" ".join(cmd)} → {log_path}')
    log_f = open(log_path, 'w')
    proc = subprocess.Popen(cmd, cwd=REPO_ROOT, stdout=log_f, stderr=log_f)

    key = f'{task_id}_verify' if phase == 'verify' else task_id
    _workers[key] = {
        'proc':    proc,
        'phase':   phase,
        'task_id': task_id,
        'started': now_iso(),
        'pid':     proc.pid,
        'log':     log_path,
    }
    audit('WORKER_LAUNCHED', {'task_id': task_id, 'phase': phase, 'pid': proc.pid})
    _log(f'Worker PID {proc.pid} → {task_id} [{phase}]')

def _reap_workers():
    global _last_completed
    for key in list(_workers.keys()):
        w = _workers[key]
        rc = w['proc'].poll()
        if rc is None:
            # Still running — check timeout
            started_dt = datetime.datetime.fromisoformat(w['started'].replace('Z', '+00:00'))
            age_s = (datetime.datetime.now(datetime.timezone.utc) - started_dt).total_seconds()
            if age_s > WORKER_TIMEOUT_S:
                _log(f'Worker {key} timeout after {age_s:.0f}s — killing')
                try:
                    w['proc'].kill()
                    w['proc'].wait(timeout=5)
                except Exception:
                    pass
                # Recover the task
                try:
                    task_id = w['task_id']
                    transition_task(task_id, 'READY', by='SUPERVISOR',
                                   note=f'Worker timeout after {age_s:.0f}s')
                except Exception:
                    pass
                del _workers[key]
            continue

        _log(f'Worker {key} [{w["phase"]}] done rc={rc} pid={w["pid"]}')
        _last_completed = key
        audit('WORKER_DONE', {'key': key, 'phase': w['phase'], 'pid': w['pid'], 'rc': rc})
        del _workers[key]


if __name__ == '__main__':
    main()

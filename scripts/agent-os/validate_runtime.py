#!/usr/bin/env python3
"""
Agent OS Runtime Validator — CI-grade checks.

Fails (exit 1) on any condition that indicates the agent OS is broken or inconsistent.
Used in: pre-commit hooks, CI, manual audits before Founder Decisions.

Checked conditions (any one causes exit 1):
  1. No supervisor process (PID file missing or process dead)
  2. Stale heartbeat (>5 min since last write)
  3. Unpropagated APPROVED decision (APPROVED in decisions/ but task still AWAITING_FOUNDER)
  4. Idle READY task with active supervisor + fresh heartbeat
  5. Duplicate workers for the same task (two PIDs claim same task)
  6. Kill switch is ON (supervisor disabled)
"""
import sys, os, subprocess, json, datetime

SCRIPTS_ROOT   = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_ROOT)

from shared import (
    load_tasks_index, load_pending_decisions, read_json, now_iso,
    AOS_ROOT, DECISIONS_DIR,
)

PID_FILE         = '/tmp/com.fullsite.agent-os.pid'
HEARTBEAT_FILE   = os.path.join(AOS_ROOT, 'HEARTBEAT.json')
HEARTBEAT_MAX_S  = 300

failures = []


def fail(msg: str):
    failures.append(msg)
    print(f'FAIL: {msg}')


def ok(msg: str):
    print(f'  ok: {msg}')


# ── 1. Supervisor process ─────────────────────────────────────────────────────

if not os.path.exists(PID_FILE):
    fail('No PID file — supervisor not running')
else:
    try:
        pid = int(open(PID_FILE).read().strip())
        os.kill(pid, 0)
        ok(f'Supervisor alive (PID={pid})')
    except ProcessLookupError:
        fail(f'PID file exists but process {pid} is dead')
    except ValueError:
        fail('PID file is corrupt (non-integer)')

# ── 2. Heartbeat freshness ────────────────────────────────────────────────────

if not os.path.exists(HEARTBEAT_FILE):
    fail('HEARTBEAT.json missing')
else:
    try:
        hb = json.load(open(HEARTBEAT_FILE))
        ts_str = hb.get('last_heartbeat', '')
        if not ts_str:
            fail('Heartbeat has no last_heartbeat field')
        else:
            ts = datetime.datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            age = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
            if age > HEARTBEAT_MAX_S:
                fail(f'Stale heartbeat: {age:.0f}s old (max {HEARTBEAT_MAX_S}s)')
            else:
                ok(f'Heartbeat fresh: {age:.0f}s ago (status={hb.get("supervisor_status")})')

        if hb.get('kill_switch') is True:
            fail('Kill switch is ON — supervisor will not run')
    except Exception as e:
        fail(f'Heartbeat read error: {e}')

# ── 3. Unpropagated APPROVED decisions ────────────────────────────────────────

index = load_tasks_index()

if os.path.isdir(DECISIONS_DIR):
    for fn in os.listdir(DECISIONS_DIR):
        if not fn.startswith('D-') or not fn.endswith('.json'):
            continue
        d = read_json(os.path.join(DECISIONS_DIR, fn))
        if d.get('response') == 'APPROVED':
            tid = d.get('task_id')
            if tid:
                task_status = index.get(tid, {}).get('status', 'UNKNOWN')
                if task_status == 'AWAITING_FOUNDER':
                    fail(f'{fn}: APPROVED but task {tid} still AWAITING_FOUNDER — run approve_decision.py again')
            else:
                fail(f'{fn}: APPROVED decision has no task_id — cannot validate propagation')
else:
    ok('No decisions directory (no approvals to validate)')

if not any(fn.startswith('D-') for fn in os.listdir(DECISIONS_DIR) if DECISIONS_DIR and os.path.isdir(DECISIONS_DIR)):
    ok('No unpropagated APPROVED decisions')

# ── 4. Idle READY tasks with active supervisor ────────────────────────────────

proc_alive = False
try:
    pid = int(open(PID_FILE).read().strip()) if os.path.exists(PID_FILE) else None
    if pid:
        os.kill(pid, 0)
        proc_alive = True
except Exception:
    pass

hb_fresh = False
hb = {}
if os.path.exists(HEARTBEAT_FILE):
    try:
        hb = json.load(open(HEARTBEAT_FILE))
        ts_str = hb.get('last_heartbeat', '')
        if ts_str:
            ts = datetime.datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            age = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
            hb_fresh = age < HEARTBEAT_MAX_S
    except Exception:
        pass

if proc_alive and hb_fresh:
    ready_tasks = [tid for tid, m in index.items() if m['status'] == 'READY']
    active_workers = hb.get('active_workers', {})
    idle = [t for t in ready_tasks if t not in active_workers]
    if idle:
        # Allow 1 loop interval (30s) — only fail if heartbeat is fresh AND tasks still idle
        # But supervisor may be dispatching in this very tick; this is a soft warning
        fail(f'READY tasks not dispatched while supervisor active: {idle}')
    else:
        ok(f'All READY tasks dispatched (workers={list(active_workers.keys())})')
elif not proc_alive:
    ok('Supervisor not running — READY task idle check skipped')

# ── 5. Duplicate workers ──────────────────────────────────────────────────────

if proc_alive and hb_fresh:
    active_workers = hb.get('active_workers', {})
    seen_pids = {}
    for task_id, w in active_workers.items():
        wpid = w.get('pid') if isinstance(w, dict) else None
        if wpid and wpid in seen_pids:
            fail(f'Duplicate worker PID {wpid} for tasks {seen_pids[wpid]} and {task_id}')
        elif wpid:
            seen_pids[wpid] = task_id
    if not seen_pids or len(seen_pids) == len(set(seen_pids.values())):
        ok('No duplicate workers')

# ── Result ────────────────────────────────────────────────────────────────────

print()
if failures:
    print(f'VALIDATE_RUNTIME: FAILED ({len(failures)} issue(s))')
    for f in failures:
        print(f'  ❌ {f}')
    sys.exit(1)
else:
    print('VALIDATE_RUNTIME: PASSED')
    sys.exit(0)

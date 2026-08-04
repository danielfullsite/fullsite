#!/usr/bin/env python3
"""
Fullsite Agent OS — runtime status check.

Checks real process state, not just files. Fails with non-zero exit if critical
invariants are violated (useful for CI / validate_runtime.py).
"""
import sys, os, subprocess, json, datetime, time

SCRIPTS_ROOT   = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_ROOT)

from shared import (
    load_tasks_index, load_pending_decisions, read_json, now_iso,
    AOS_ROOT, DECISIONS_DIR, ARCHIVE_DIR,
)

PLIST_LABEL    = 'com.fullsite.agent-os'
PLIST_PATH     = os.path.expanduser(f'~/Library/LaunchAgents/{PLIST_LABEL}.plist')
PID_FILE       = '/tmp/com.fullsite.agent-os.pid'
HEARTBEAT_FILE = os.path.join(AOS_ROOT, 'HEARTBEAT.json')
HEARTBEAT_MAX_AGE_S = 300  # 5 min

FAIL = False  # set to True if any critical check fails


def _check(label: str, ok: bool, detail: str = '', critical: bool = False):
    global FAIL
    status = '✅' if ok else ('❌' if critical else '⚠️ ')
    print(f'  {status} {label}' + (f' — {detail}' if detail else ''))
    if not ok and critical:
        FAIL = True


def main():
    global FAIL

    print('\n══════════════════════════════════════')
    print('  Fullsite Agent OS — Runtime Status')
    print(f'  {now_iso()}')
    print('══════════════════════════════════════\n')

    # ── 1. LaunchAgent ────────────────────────────────────────────────────────
    print('[ LaunchAgent ]')
    plist_ok = os.path.exists(PLIST_PATH)
    _check('Plist installed', plist_ok, PLIST_PATH, critical=True)

    lc_result = subprocess.run(['launchctl', 'list', PLIST_LABEL],
                               capture_output=True, text=True)
    lc_ok = lc_result.returncode == 0
    lc_pid = None
    if lc_ok and lc_result.stdout.strip():
        try:
            lc_data = json.loads(lc_result.stdout)
            lc_pid = lc_data.get('PID')
        except Exception:
            # launchctl list output is tab-separated on older macOS
            parts = lc_result.stdout.strip().split('\t')
            if len(parts) >= 1 and parts[0].isdigit():
                lc_pid = int(parts[0])
    _check('launchctl loaded', lc_ok, f'PID={lc_pid}' if lc_pid else 'not running', critical=True)

    # ── 2. PID file & process ─────────────────────────────────────────────────
    print('\n[ Supervisor Process ]')
    pid_file_ok = os.path.exists(PID_FILE)
    _check('PID file exists', pid_file_ok, PID_FILE)

    pid = None
    proc_alive = False
    if pid_file_ok:
        try:
            pid = int(open(PID_FILE).read().strip())
            os.kill(pid, 0)
            proc_alive = True
        except (ProcessLookupError, ValueError):
            proc_alive = False
    _check('Supervisor process alive', proc_alive, f'PID={pid}', critical=True)

    # Cross-check PID consistency
    if lc_pid and pid and lc_pid != pid:
        _check('PID consistent (launchctl vs PID file)', False,
               f'launchctl={lc_pid} pidfile={pid}', critical=False)
    elif lc_pid and pid:
        _check('PID consistent', True, f'{pid}')

    # ps confirmation
    if pid:
        ps = subprocess.run(['ps', '-p', str(pid), '-o', 'pid,comm,etime'],
                            capture_output=True, text=True)
        if ps.returncode == 0:
            lines = ps.stdout.strip().splitlines()
            if len(lines) > 1:
                print(f'       ps: {lines[-1].strip()}')

    # ── 3. Heartbeat ──────────────────────────────────────────────────────────
    print('\n[ Heartbeat ]')
    hb = {}
    hb_age_s = None
    if os.path.exists(HEARTBEAT_FILE):
        try:
            with open(HEARTBEAT_FILE) as f:
                hb = json.load(f)
            ts_str = hb.get('last_heartbeat', '')
            if ts_str:
                ts = datetime.datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                hb_age_s = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
        except Exception as e:
            print(f'       ERROR reading heartbeat: {e}')

    hb_fresh = hb_age_s is not None and hb_age_s < HEARTBEAT_MAX_AGE_S
    _check('Heartbeat fresh', hb_fresh,
           f'age={hb_age_s:.0f}s' if hb_age_s is not None else 'missing',
           critical=proc_alive)  # only critical if process should be running

    print(f'       status: {hb.get("supervisor_status", "unknown")}')
    print(f'       current_task: {hb.get("current_task", "none")}')
    print(f'       next_action: {hb.get("next_action", "")}')
    print(f'       kill_switch: {hb.get("kill_switch", "?")}')

    # ── 4. Decision/Task consistency ──────────────────────────────────────────
    print('\n[ Decision/Task Consistency ]')
    index = load_tasks_index()
    pending = load_pending_decisions()

    # APPROVED decisions not propagated?
    unpropagated = 0
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
                        unpropagated += 1
                        print(f'       ❌ {fn}: APPROVED but {tid} still AWAITING_FOUNDER')

    _check('No unpropagated approvals', unpropagated == 0,
           f'{unpropagated} approvals not propagated', critical=True)

    _check('Pending decisions', True, f'{len(pending)} pending')

    # READY tasks sitting idle while supervisor alive
    ready_tasks = [tid for tid, m in index.items() if m['status'] == 'READY']
    if ready_tasks and proc_alive and hb_fresh:
        hb_workers = hb.get('active_workers', {})
        idle_ready = [t for t in ready_tasks if t not in hb_workers]
        # Allow 1 loop interval before flagging as idle
        if idle_ready:
            _check('No idle READY tasks while supervisor active', False,
                   f'READY but no worker: {idle_ready}')
        else:
            _check('All READY tasks dispatched', True)
    elif ready_tasks:
        print(f'       ⚠️  READY tasks: {ready_tasks} (supervisor not running)')

    # ── 5. Task summary ───────────────────────────────────────────────────────
    print('\n[ Tasks ]')
    by_status: dict = {}
    for tid, m in index.items():
        by_status.setdefault(m['status'], []).append(tid)
    for status in ['READY', 'IN_PROGRESS', 'CLAIMED', 'SUBMITTED', 'IN_REVIEW',
                   'VERIFIED', 'AWAITING_FOUNDER', 'MERGED', 'BLOCKED', 'CANCELLED']:
        tasks = by_status.get(status, [])
        if tasks:
            print(f'       {status}: {", ".join(tasks)}')

    # ── 6. Logs ───────────────────────────────────────────────────────────────
    print('\n[ Logs ]')
    logs_dir = os.path.join(os.path.dirname(SCRIPTS_ROOT), '..', 'logs', 'agent-os')
    logs_dir = os.path.abspath(logs_dir)
    for log_name in ('supervisor.stdout.log', 'supervisor.stderr.log'):
        log_path = os.path.join(logs_dir, log_name)
        if os.path.exists(log_path):
            size = os.path.getsize(log_path)
            print(f'       {log_name}: {size:,} bytes → tail:')
            tail = subprocess.run(['tail', '-5', log_path], capture_output=True, text=True)
            for line in tail.stdout.strip().splitlines():
                print(f'         {line}')
        else:
            print(f'       {log_name}: not found')

    # ── Result ────────────────────────────────────────────────────────────────
    print('\n══════════════════════════════════════')
    if FAIL:
        print('  AGENT OS 24/7: NOT ACTIVE')
        print('  Blocker: critical check(s) failed (see ❌ above)')
        print('══════════════════════════════════════\n')
        sys.exit(1)
    elif not proc_alive:
        print('  AGENT OS 24/7: NOT ACTIVE')
        print('  Supervisor process not running. Run: python3 scripts/agent-os/install_service.py')
        print('══════════════════════════════════════\n')
        sys.exit(1)
    else:
        sup_status = hb.get('supervisor_status', 'UNKNOWN')
        print(f'  AGENT OS 24/7: ACTIVE (supervisor_status={sup_status})')
        print('══════════════════════════════════════\n')
        sys.exit(0)


if __name__ == '__main__':
    main()

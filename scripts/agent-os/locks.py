"""Agent OS Domain Locks — one writing owner per critical domain.

DOMAIN-LOCKS.json:
  { "<domain>": { "owner": str, "kind": "AGENT|EXTERNAL|FROZEN",
                  "task_id": str|null, "branch": str|null,
                  "locked_at": iso, "note": str } }

Rules:
- EXTERNAL locks (human/Claude sessions like BUG-019, Wave1) are registered by
  operators and NEVER released automatically.
- FROZEN locks (offline release, production) are permanent until a Founder
  Decision reopens them.
- AGENT locks are acquired at dispatch and released when the owning task
  reaches a terminal status. Stale AGENT locks (task terminal/missing) are
  reaped automatically — sleep/wake safe because locks live on disk.
"""
import os

from shared import (
    AOS_ROOT, FileLock, read_json, write_json, audit, now_iso,
    load_tasks_index, TERMINAL_STATUSES,
)

LOCKS_FILE = os.path.join(AOS_ROOT, 'DOMAIN-LOCKS.json')


def load_locks() -> dict:
    return read_json(LOCKS_FILE, {})


def locked_domains() -> set:
    return set(load_locks().keys())


def acquire(domain: str, owner: str, task_id: str = None, branch: str = None,
            kind: str = 'AGENT', note: str = '') -> bool:
    """Returns True if acquired; False if another owner holds the domain."""
    if not domain:
        return True
    with FileLock(LOCKS_FILE):
        locks = load_locks()
        cur = locks.get(domain)
        if cur and not (cur.get('kind') == 'AGENT' and cur.get('task_id') == task_id):
            return False
        locks[domain] = {'owner': owner, 'kind': kind, 'task_id': task_id,
                         'branch': branch, 'locked_at': now_iso(), 'note': note}
        write_json(LOCKS_FILE, locks)
    audit('DOMAIN_LOCK_ACQUIRED', {'domain': domain, 'owner': owner,
                                   'task_id': task_id, 'kind': kind})
    return True


def release(domain: str, by: str = 'SYSTEM', force: bool = False) -> bool:
    with FileLock(LOCKS_FILE):
        locks = load_locks()
        cur = locks.get(domain)
        if not cur:
            return True
        if cur.get('kind') in ('EXTERNAL', 'FROZEN') and not force:
            return False  # only operators/Founder release these
        del locks[domain]
        write_json(LOCKS_FILE, locks)
    audit('DOMAIN_LOCK_RELEASED', {'domain': domain, 'by': by, 'force': force})
    return True


def reap_stale_agent_locks():
    """Release AGENT locks whose task is terminal or missing (crash/sleep safe)."""
    index = load_tasks_index()
    with FileLock(LOCKS_FILE):
        locks = load_locks()
        stale = []
        for domain, l in list(locks.items()):
            if l.get('kind') != 'AGENT':
                continue
            tid = l.get('task_id')
            meta = index.get(tid)
            if meta is None or meta.get('status') in TERMINAL_STATUSES or \
               meta.get('status') == 'BLOCKED':
                stale.append(domain)
                del locks[domain]
        if stale:
            write_json(LOCKS_FILE, locks)
    for d in stale:
        audit('DOMAIN_LOCK_REAPED', {'domain': d})
    return stale


if __name__ == '__main__':
    import json
    print(json.dumps(load_locks(), indent=2, ensure_ascii=False))

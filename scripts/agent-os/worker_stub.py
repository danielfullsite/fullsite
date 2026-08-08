#!/usr/bin/env python3
"""Stub worker for V1 certification — same lifecycle as worker.py, zero tokens.

engineer phase: writes a marker file in the task worktree, commits, submits result.
verify phase:   checks the marker exists in the diff, issues VERIFIED/FAILED.

Failure injection: if the task title contains [INDUCE-FAIL], the first
verification FAILs (exercising the FAIL→fix→retry loop); the repair attempt
then adds the fix marker and verification passes.
"""
import sys, os, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shared import (
    load_task, load_result, transition_task, submit_result, submit_review,
    update_task_fields, REPO_ROOT, get_task_diff, load_review,
)


def sh(cwd, *args):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)


def engineer(task):
    task_id = task['id']
    s = task['status']
    if s == 'READY':
        transition_task(task_id, 'CLAIMED', by='RUNTIME_ENGINEER', note='stub claim')
        transition_task(task_id, 'IN_PROGRESS', by='RUNTIME_ENGINEER', note='stub start')
    elif s == 'CHANGES_REQUESTED':
        transition_task(task_id, 'IN_PROGRESS', by='RUNTIME_ENGINEER', note='stub repair')
    task = load_task(task_id)
    wt = task.get('worktree_path')
    if not wt or not os.path.isdir(wt):
        submit_result(task_id, 'RUNTIME_ENGINEER', 'no worktree', 'FAILED')
        transition_task(task_id, 'SUBMITTED', by='RUNTIME_ENGINEER', note='no worktree')
        return

    marker = os.path.join(wt, f'CERT-ARTIFACT-{task_id}.txt')
    is_repair = s == 'CHANGES_REQUESTED'
    with open(marker, 'a') as f:
        f.write('artifact\n' + ('fix\n' if is_repair else ''))
    sh(wt, 'git', 'add', '-A')
    sh(wt, 'git', 'commit', '-m', f'feat({task_id}): cert artifact' + (' fix' if is_repair else ''))
    commit = sh(wt, 'git', 'rev-parse', 'HEAD').stdout.strip()

    submit_result(task_id, 'RUNTIME_ENGINEER', 'stub artifact committed', 'VERIFIED',
                  evidence=f'marker {os.path.basename(marker)} commit {commit}',
                  commit=commit, tests_passed=1, tests_total=1)
    transition_task(task_id, 'SUBMITTED', by='RUNTIME_ENGINEER', note='stub submitted')


def verify(task):
    task_id = task['id']
    if task['status'] not in ('IN_REVIEW', 'VERIFIED'):
        sys.exit(1)
    diff_stat, _ = get_task_diff(task_id)
    induce_fail = '[INDUCE-FAIL]' in task.get('title', '')
    already_failed = (task.get('retry_count', 0) or 0) > 0
    has_artifact = f'CERT-ARTIFACT-{task_id}' in diff_stat

    ok = has_artifact and (not induce_fail or already_failed)
    submit_review(task_id, 'RUNTIME_VERIFICATION',
                  'VERIFIED' if ok else 'FAILED',
                  findings=[] if ok else ['induced failure' if induce_fail else 'artifact missing'],
                  return_to_engineer=not ok,
                  return_reason=None if ok else 'stub induced/missing',
                  notes=f'diff_stat={diff_stat[:120]}')
    retry_count = task.get('retry_count', 0)
    if ok:
        transition_task(task_id, 'VERIFIED', by='RUNTIME_VERIFICATION', note='stub verified')
    elif retry_count < task.get('max_retries', 3):
        update_task_fields(task_id, {'retry_count': retry_count + 1})
        transition_task(task_id, 'CHANGES_REQUESTED', by='RUNTIME_VERIFICATION',
                        note='stub failure — retry')
    else:
        transition_task(task_id, 'BLOCKED', by='RUNTIME_VERIFICATION', note='max retries')


if __name__ == '__main__':
    t = load_task(sys.argv[1])
    if sys.argv[2] == 'engineer':
        engineer(t)
    else:
        verify(t)

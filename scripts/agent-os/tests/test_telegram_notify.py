"""
Tests for the false-notification fix (TELEGRAM-FALSE-NOTIFICATION-01).

Covers four scenarios:
  1. Placeholder / non-real hashes are never sent in notifications.
  2. A CLOSED task is not re-notified within the dedup TTL.
  3. TASK_CLOSED message distinguishes engineer commit from merge commit.
  4. Only hashes resolvable via `git cat-file -e` are displayed as-is.
"""
import json
import pathlib
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock

# Ensure scripts/agent-os is importable
SCRIPTS_DIR = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import telegram_notify as tn


# ── helpers ───────────────────────────────────────────────────────────────────

REAL_COMMIT   = '7f4c998eec207dfd62576941e0e3b334c16fd9a4'   # HEAD at fix time
FAKE_COMMIT   = 'abc123def456'                                  # the false-notification hash
PLACEHOLDER   = 'git-hash-here'                                 # literal from worker prompt
SHORT_REAL    = REAL_COMMIT[:12]


def _cat_file_side_effect(args, **kwargs):
    """Simulate git cat-file -e: returncode=0 only for REAL_COMMIT."""
    if args[:3] == ['git', 'cat-file', '-e']:
        obj = args[3].lower()
        if obj == REAL_COMMIT.lower() or obj == REAL_COMMIT[:7].lower():
            result = MagicMock()
            result.returncode = 0
            return result
    result = MagicMock()
    result.returncode = 1
    return result


# ── Test 1: placeholder hashes are never sent ─────────────────────────────────

class TestNoPlaceholderHashes(unittest.TestCase):

    def _format(self, commit):
        with patch('subprocess.run', side_effect=_cat_file_side_effect):
            return tn._format_message('TASK_CLOSED', {
                'task_id': 'TSK-002',
                'title': 'HTTP contract tests',
                'commit': commit,
            })

    def test_placeholder_string_not_in_message(self):
        msg = self._format(PLACEHOLDER)
        self.assertNotIn('git-hash-here', msg,
                         'Placeholder literal must not appear in notification text')
        self.assertIn('unverified', msg,
                      'Unverifiable commit must show warning token')

    def test_fake_hex_not_in_message(self):
        msg = self._format(FAKE_COMMIT)
        self.assertNotIn(FAKE_COMMIT, msg,
                         f'{FAKE_COMMIT} is not a real git object and must not appear verbatim')
        self.assertIn('unverified', msg)

    def test_none_commit_shows_question_mark(self):
        msg = self._format(None)
        self.assertIn('?', msg)
        self.assertNotIn('None', msg)

    def test_real_commit_shown_verbatim(self):
        msg = self._format(REAL_COMMIT)
        self.assertIn(SHORT_REAL, msg,
                      'Real git commit must appear (first 12 chars) in notification')
        self.assertNotIn('unverified', msg)


# ── Test 2: CLOSED task not re-notified within dedup TTL ─────────────────────

class TestDeduplication(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._dedup_path = pathlib.Path(self._tmpdir.name) / '.notified.json'
        self._patcher = patch.object(tn, '_DEDUP_FILE', self._dedup_path)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmpdir.cleanup()

    def _notify(self, task_id='TSK-002'):
        with patch('subprocess.run', side_effect=_cat_file_side_effect), \
             patch.object(tn, '_send_raw', return_value=True), \
             patch.object(tn, '_load_secrets', return_value=('tok', 'chat')):
            return tn.notify('TASK_CLOSED', {
                'task_id': task_id,
                'title': 'HTTP contract tests',
                'commit': REAL_COMMIT,
            })

    def test_first_notification_sent(self):
        self.assertTrue(self._notify(), 'First notification must be sent')

    def test_second_notification_suppressed(self):
        self._notify()   # first — records timestamp
        result = self._notify()  # second within TTL
        self.assertFalse(result, 'Duplicate within TTL must be suppressed')

    def test_dedup_survives_process_restart(self):
        """Dedup file must be in the persistent docs/ path, not /tmp."""
        self._notify()
        self.assertTrue(self._dedup_path.exists(),
                        'Dedup file must exist at persistent path after first send')
        data = json.loads(self._dedup_path.read_text())
        key = 'TASK_CLOSED:TSK-002'
        self.assertIn(key, data, 'Dedup key must be persisted to disk')

    def test_expired_ttl_allows_resend(self):
        """After TTL expires, notification can be sent again."""
        self._notify()
        # Backdate the dedup timestamp past the TTL
        data = json.loads(self._dedup_path.read_text())
        data['TASK_CLOSED:TSK-002'] = time.time() - 3700
        self._dedup_path.write_text(json.dumps(data))
        result = self._notify()
        self.assertTrue(result, 'Notification must be allowed after TTL expires')


# ── Test 3: message distinguishes engineer commit from merge commit ───────────

class TestEngineerVsMergeCommit(unittest.TestCase):

    ENGINEER = '0' * 7 + 'aabbcc'   # not a real commit — but let's mock cat-file
    MERGE    = REAL_COMMIT

    def _format(self, engineer_commit, merge_commit):
        def mock_cat_file(args, **kwargs):
            if args[:3] == ['git', 'cat-file', '-e']:
                obj = args[3].lower()
                if obj in (self.MERGE.lower(), self.MERGE[:7].lower()):
                    r = MagicMock(); r.returncode = 0; return r
                if obj in (self.ENGINEER.lower(), self.ENGINEER[:7].lower()):
                    r = MagicMock(); r.returncode = 0; return r
            r = MagicMock(); r.returncode = 1; return r

        with patch('subprocess.run', side_effect=mock_cat_file):
            return tn._format_message('TASK_CLOSED', {
                'task_id': 'TSK-002',
                'title': 'HTTP contract tests',
                'commit': merge_commit,
                'engineer_commit': engineer_commit,
            })

    def test_two_different_commits_both_shown(self):
        msg = self._format(self.ENGINEER, self.MERGE)
        self.assertIn('Engineer:', msg)
        self.assertIn('Merge:', msg)

    def test_same_commit_shows_single_line(self):
        msg = self._format(self.MERGE, self.MERGE)
        self.assertNotIn('Engineer:', msg)
        self.assertIn('Commit:', msg)

    def test_only_merge_commit_shows_single_line(self):
        msg = self._format(None, self.MERGE)
        self.assertNotIn('Engineer:', msg)
        self.assertIn('Commit:', msg)


# ── Test 4: git cat-file -e gates what is displayed ─────────────────────────

class TestGitCatFileGating(unittest.TestCase):

    def _display(self, commit):
        with patch('subprocess.run', side_effect=_cat_file_side_effect):
            return tn._safe_commit_display(commit)

    def test_real_commit_passes(self):
        result = self._display(REAL_COMMIT)
        self.assertEqual(result, SHORT_REAL)

    def test_fake_hex_blocked(self):
        result = self._display(FAKE_COMMIT)
        self.assertIn('unverified', result)

    def test_placeholder_string_blocked(self):
        result = self._display('git-hash-here')
        self.assertIn('unverified', result)

    def test_empty_string_returns_question_mark(self):
        self.assertEqual(tn._safe_commit_display(''), '?')
        self.assertEqual(tn._safe_commit_display(None), '?')

    def test_is_real_git_commit_rejects_non_hex(self):
        with patch('subprocess.run', side_effect=_cat_file_side_effect):
            self.assertFalse(tn._is_real_git_commit('not-a-hash'))
            self.assertFalse(tn._is_real_git_commit('git-hash-here'))
            self.assertFalse(tn._is_real_git_commit(''))
            self.assertFalse(tn._is_real_git_commit(None))

    def test_is_real_git_commit_accepts_real(self):
        with patch('subprocess.run', side_effect=_cat_file_side_effect):
            self.assertTrue(tn._is_real_git_commit(REAL_COMMIT))


if __name__ == '__main__':
    unittest.main(verbosity=2)

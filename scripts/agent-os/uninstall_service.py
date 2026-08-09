#!/usr/bin/env python3
"""Uninstall Fullsite Agent OS LaunchAgent."""
import sys, os, subprocess

PLIST_LABEL = 'com.fullsite.agent-os'
PLIST_PATH  = os.path.expanduser(f'~/Library/LaunchAgents/{PLIST_LABEL}.plist')
PID_FILE    = '/tmp/com.fullsite.agent-os.pid'

if __name__ == '__main__':
    result = subprocess.run(['launchctl', 'unload', PLIST_PATH], capture_output=True, text=True)
    if result.returncode == 0:
        print(f'Unloaded: {PLIST_LABEL}')
    else:
        print(f'Unload result: {result.stderr or "already unloaded"}')

    if os.path.exists(PLIST_PATH):
        os.unlink(PLIST_PATH)
        print(f'Removed: {PLIST_PATH}')

    if os.path.exists(PID_FILE):
        os.unlink(PID_FILE)
        print(f'Removed PID file: {PID_FILE}')

    print('Agent OS service uninstalled.')

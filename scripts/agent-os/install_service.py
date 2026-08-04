#!/usr/bin/env python3
"""
Install Fullsite Agent OS as a macOS LaunchAgent.

Creates ~/Library/LaunchAgents/com.fullsite.agent-os.plist and loads it with launchctl.
The supervisor starts automatically at login and restarts on crash.
"""
import sys, os, subprocess

PLIST_LABEL     = 'com.fullsite.agent-os'
LAUNCH_AGENTS   = os.path.expanduser('~/Library/LaunchAgents')
PLIST_PATH      = os.path.join(LAUNCH_AGENTS, f'{PLIST_LABEL}.plist')
SCRIPTS_ROOT    = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT       = os.path.abspath(os.path.join(SCRIPTS_ROOT, '..', '..'))
PYTHON_BIN      = sys.executable
SUPERVISOR      = os.path.join(SCRIPTS_ROOT, 'supervisor.py')
LOGS_DIR        = os.path.join(REPO_ROOT, 'logs', 'agent-os')
PATH_ENV        = '/usr/local/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/bin:/bin:/usr/sbin:/sbin'


def install(dry_run=False):
    os.makedirs(LAUNCH_AGENTS, exist_ok=True)
    os.makedirs(LOGS_DIR, exist_ok=True)

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>{PYTHON_BIN}</string>
        <string>{SUPERVISOR}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>{REPO_ROOT}</string>

    <!-- Start immediately on load and on login -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Restart unconditionally (except launchctl unload). SIGKILL is not treated
         as a crash by launchd for KeepAlive.Crashed, so we use the boolean form. -->
    <key>KeepAlive</key>
    <true/>

    <!-- Minimum 10s between restarts to prevent tight crash loops -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>{LOGS_DIR}/supervisor.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{LOGS_DIR}/supervisor.stderr.log</string>

    <!-- Environment: no secrets stored here -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>{os.path.expanduser('~')}</string>
        <key>PATH</key>
        <string>{PATH_ENV}</string>
        <key>AGENT_OS_ENABLED</key>
        <string>true</string>
    </dict>
</dict>
</plist>
"""

    if dry_run:
        print('=== DRY RUN — plist content ===')
        print(plist)
        return

    print(f'Writing plist → {PLIST_PATH}')
    with open(PLIST_PATH, 'w') as f:
        f.write(plist)

    # Unload any existing instance (ignore errors)
    subprocess.run(['launchctl', 'unload', PLIST_PATH], capture_output=True)

    # Load the new plist
    result = subprocess.run(['launchctl', 'load', PLIST_PATH], capture_output=True, text=True)
    if result.returncode != 0:
        print(f'ERROR loading plist: {result.stderr}')
        sys.exit(1)

    print(f'Loaded: {PLIST_LABEL}')

    # Wait a moment and check status
    import time
    time.sleep(2)
    _show_status()


def _show_status():
    result = subprocess.run(
        ['launchctl', 'list', PLIST_LABEL],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print('\nlaunchctl status:')
        print(result.stdout)
    else:
        print(f'Status check: {result.stderr}')


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    install(dry_run=dry)
    if not dry:
        print(f'\nLogs: {LOGS_DIR}/supervisor.stdout.log')
        print(f'Status: python3 {SCRIPTS_ROOT}/service_status.py')
        print(f'Stop:   python3 {SCRIPTS_ROOT}/stop_agent_os.py')

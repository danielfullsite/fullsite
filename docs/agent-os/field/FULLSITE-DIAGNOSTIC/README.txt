FULLSITE POS -- FIELD DIAGNOSTIC PACKAGE
========================================
Version  : 1.0.0
Date     : 2026-08-04
Platform : Windows 10/11 (x64)

CONTENTS
--------
  DIAGNOSTIC-ONLY.ps1  -- Read-only evidence capture script
  RUN-DIAGNOSTIC.cmd   -- Launcher with UAC elevation
  SHA256.txt           -- Checksums for integrity verification
  README.txt           -- This file

WHAT THIS CAPTURES
------------------
  - Running processes and executable paths (Win32_Process via CIM)
  - Installed software registry entries (HKLM + WOW6432Node + HKCU)
  - Active ports 7717 and 7718 (owner process, executable path)
  - Windows services (Name, StartMode, PathName)
  - Scheduled tasks (CSV summary + XML per task)
  - Auto-start registry Run keys and Startup folder shortcuts
  - AppData / LocalAppData folder inventory with file hashes
  - C:\fullsite folder inventory (legacy deployment evidence)
  - Network configuration: adapters, IP, gateway, routes
  - Connectivity: this terminal -> SERVER1:7717

THIS PACKAGE DOES NOT:
  X Stop or modify any running process
  X Write to the registry
  X Change firewall rules
  X Install or uninstall software
  X Modify services or scheduled tasks
  X Read, copy, or hash biometric data files (.dat, .bio, .fp, .fng)

OUTPUT
------
  Desktop\fullsite-diag-YYYYMMDD-HHmm.zip
    -- ZIP of all evidence CSVs, task XMLs, and transcript
  Desktop\fullsite-diag-YYYYMMDD-HHmm\transcript.log
    -- Full session stdout/stderr log (also inside the ZIP)

The final terminal block shows:
  TERMINAL, DEPLOYMENT TYPE, EXECUTABLE, VERSION,
  PORT 7717 OWNER, PORT 7718 OWNER, AUTO-START METHOD,
  USER DATA PATHS, ROLLBACK INPUTS CAPTURED, ZIP, SHA-256

USAGE
-----
  1. Copy this entire folder (FULLSITE-DIAGNOSTIC\) to a USB drive.
  2. On the target machine (PDV3 or SERVER1):
       a. Double-click  RUN-DIAGNOSTIC.cmd
       b. Click "Yes" when Windows asks for administrator privileges
       c. Wait for the script to complete (~2-3 minutes)
       d. Read and photograph the final summary block
  3. Copy the ZIP file to the USB drive before closing the window.
  4. Analyze the ZIP offline:
       python analyze_diagnostic.py fullsite-diag-YYYYMMDD-HHmm.zip

INTEGRITY VERIFICATION
-----------------------
  To verify the script has not been modified before use:

  PowerShell (on any machine):
    Get-FileHash .\DIAGNOSTIC-ONLY.ps1 -Algorithm SHA256

  Compare output against SHA256.txt in this package.

TROUBLESHOOTING
---------------
  "Execution Policy" error
    -> Run via RUN-DIAGNOSTIC.cmd (it passes -ExecutionPolicy Bypass)

  Access denied on some registry keys
    -> Normal on non-admin accounts; the script continues and logs what it can.
    -> Always run via RUN-DIAGNOSTIC.cmd which requests admin.

  fltmc error or "elevation failed"
    -> Right-click RUN-DIAGNOSTIC.cmd -> Run as administrator

  Script runs but ZIP is empty or missing
    -> Check Desktop for the fullsite-diag-* folder.
    -> Review transcript.log inside the folder for errors.

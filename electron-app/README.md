# Fullsite POS — Electron Kiosk Wrapper

Wraps `https://app.fullsite.mx/pos` as a native Windows application in kiosk mode.

## Features

- Fullscreen kiosk mode, no title bar, no browser chrome
- Exit only with **Ctrl+Shift+Q** (or 5-tap logo handled by web app)
- Blocks Ctrl+W, Alt+F4, right-click context menu
- Offline fallback page with auto-retry every 10 seconds
- Auto-reload on renderer crash
- Single instance lock (prevents opening twice)

## Setup

```bash
npm install
```

## Run (development)

```bash
npm start
```

## Build Windows .exe

```bash
npm run build:win
```

Output goes to `dist/`. The installer is an `.exe` (NSIS).

## Build macOS (for testing)

```bash
npm run build:mac
```

## Auto-start on Windows boot

After installing, add a shortcut to `Fullsite POS.exe` in:

```
C:\Users\<USER>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

Or use Task Scheduler for more control.

## Icon

Place a 512x512 PNG as `icon.png` in the project root (already included).
For Windows builds, electron-builder auto-converts PNG to ICO.

#!/usr/bin/env bash
# ─── Build the offline POS static bundle (dashboard-app/out) ──────────────────
# For the Electron Offline Shell (docs/architecture/OFFLINE-SHELL-001.md).
#
# Next `output: export` (via CAPACITOR_OFFLINE=1) can't export:
#   • server-only /api routes (59 of them), and
#   • non-POS dynamic routes without generateStaticParams (demo, menu, encuesta).
# None of /pos/* is dynamic, so we scope the export by temporarily moving the
# incompatible route folders aside, building, then restoring them (always).
#
# If a future build fails on a NEW dynamic/server route, add it to EXCLUDE.
set -euo pipefail
cd "$(dirname "$0")/.."

EXCLUDE=(api demo menu encuesta)

restore() {
  for d in "${EXCLUDE[@]}"; do
    [ -d "src/app/__off_$d" ] && mv "src/app/__off_$d" "src/app/$d" || true
  done
}
trap restore EXIT

rm -rf out
for d in "${EXCLUDE[@]}"; do
  [ -d "src/app/$d" ] && mv "src/app/$d" "src/app/__off_$d"
done

CAPACITOR_OFFLINE=1 npx next build

echo "✓ Offline bundle → dashboard-app/out ($(du -sh out | cut -f1)) · entra en /pos"

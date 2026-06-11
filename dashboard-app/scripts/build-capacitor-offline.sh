#!/usr/bin/env bash
# Build estático para la app nativa offline (Capacitor).
#
# Aparta las rutas que no soportan `output: export` (API routes y rutas
# dinámicas sin generateStaticParams), corre el export y las restaura
# siempre — incluso si el build falla.
#
# Uso: bash scripts/build-capacitor-offline.sh
set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDED=(
  "src/app/api"
  "src/app/demo/[...slug]"
  "src/app/menu/[mesa]"
  "src/app/encuesta/[id]"
)

STASH=".capacitor-excluded"
rm -rf "$STASH"
mkdir -p "$STASH"

restore() {
  for path in "${EXCLUDED[@]}"; do
    name=$(echo "$path" | tr '/' '_')
    if [ -e "$STASH/$name" ]; then
      rm -rf "$path"
      mv "$STASH/$name" "$path"
    fi
  done
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT

for path in "${EXCLUDED[@]}"; do
  if [ -e "$path" ]; then
    name=$(echo "$path" | tr '/' '_')
    mv "$path" "$STASH/$name"
  fi
done

echo "→ next build (CAPACITOR_OFFLINE=1, output: export)"
CAPACITOR_OFFLINE=1 NEXT_PUBLIC_CAPACITOR_OFFLINE=1 npx next build

echo "→ cap sync ios"
CAPACITOR_OFFLINE=1 npx cap sync ios

echo "✓ Bundle estático en out/ y sincronizado a ios/"

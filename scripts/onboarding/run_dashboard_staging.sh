#!/usr/bin/env bash
# Corre dashboard-app apuntando EXCLUSIVAMENTE a staging (jkcnxfbbuyyfhwfjizgw),
# anulando las vars de prod (qjiom/AMALAY) heredadas del shell (~/.zshrc).
#
# Por qué existe: `next dev` hereda `SUPABASE_URL`/`DATABASE_URL`=prod del shell,
# que preceden a .env.local; y un `.next` compilado con esas vars las hornea.
# Fix: forzar env de staging + arrancar con dir-arg + `.next` limpio.
#
# La anon key de staging es PÚBLICA (se envía al browser). Exportarla primero:
#   export NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
# (obtén con: supabase projects api-keys --project-ref jkcnxfbbuyyfhwfjizgw)
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
export NEXT_PUBLIC_SUPABASE_URL="https://jkcnxfbbuyyfhwfjizgw.supabase.co"
export SUPABASE_URL="https://jkcnxfbbuyyfhwfjizgw.supabase.co"
export SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:?exporta NEXT_PUBLIC_SUPABASE_ANON_KEY (staging, pública) primero}"
# Nunca usar la service key de producción en este demo.
export SUPABASE_SERVICE_KEY=""
rm -rf "$REPO/dashboard-app/.next" 2>/dev/null || true
exec "$REPO/dashboard-app/node_modules/.bin/next" dev "$REPO/dashboard-app" -p 3939

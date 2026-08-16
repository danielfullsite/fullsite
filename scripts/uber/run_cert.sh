#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Uber Eats — runner de certificación (ejercita TODOS los endpoints requeridos
# contra el test store, en secuencia, para generar los logs que Uber pide ver).
#
# PRE-REQUISITO (una vez): concede los scopes del test app.
#   1. curl -sX POST "$BASE_URL/api/integrations/uber-eats/sandbox" \
#        -H "Authorization: Bearer $INTEGRATION_ADMIN_SECRET" \
#        -H 'Content-Type: application/json' -d '{"action":"reauth_url"}'
#   2. Abre la URL que devuelve → autoriza → concede scopes ampliados.
#
# USO:
#   export BASE_URL="https://<tu-deploy-uber-sandbox>.vercel.app"
#   export INTEGRATION_ADMIN_SECRET="<secret>"
#   export STORE_ID="0f655507-7337-41e9-b536-5fd6171bb0da"   # test store
#   bash scripts/uber/run_cert.sh
#
# Éxito = cada paso devuelve 200/2xx. Los 401/403 = scopes no concedidos (haz el
# pre-requisito). Al final corre evidence_export → copia esa evidencia a Uber.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

: "${BASE_URL:?define BASE_URL (URL del deploy del sandbox de Uber)}"
: "${INTEGRATION_ADMIN_SECRET:?define INTEGRATION_ADMIN_SECRET}"
: "${STORE_ID:=0f655507-7337-41e9-b536-5fd6171bb0da}"

AUTH="Authorization: Bearer ${INTEGRATION_ADMIN_SECRET}"
CT="Content-Type: application/json"
PASS=0; FAIL=0

step() {
  # step "<etiqueta>" "<METHOD>" "<path>" ["<json-body>"]
  local label="$1" method="$2" path="$3" body="${4:-}"
  local url="${BASE_URL}${path}" code
  printf '\n▶ %s\n  %s %s\n' "$label" "$method" "$path"
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/uber_cert_out -w '%{http_code}' -X "$method" "$url" -H "$AUTH" -H "$CT" -d "$body")
  else
    code=$(curl -s -o /tmp/uber_cert_out -w '%{http_code}' -X "$method" "$url" -H "$AUTH")
  fi
  local snippet; snippet=$(head -c 220 /tmp/uber_cert_out | tr '\n' ' ')
  if [[ "$code" =~ ^2 ]]; then printf '  ✅ %s  %s\n' "$code" "$snippet"; PASS=$((PASS+1))
  else printf '  ❌ %s  %s\n' "$code" "$snippet"; FAIL=$((FAIL+1)); fi
}

echo "=== Uber Eats cert runner → ${BASE_URL}  (store ${STORE_ID}) ==="

# ── Integración & Onboarding ────────────────────────────────────────────────
step "Get All Stores"            GET  "/api/integrations/uber-eats/stores"
step "Get Store"                 GET  "/api/integrations/uber-eats/store?store_id=${STORE_ID}"

# ── Store Management (status) ───────────────────────────────────────────────
step "Set Store PAUSE"           POST "/api/integrations/uber-eats/store" "{\"store_id\":\"${STORE_ID}\",\"action\":\"pause\",\"duration_minutes\":5}"
step "Set Store ACTIVATE"        POST "/api/integrations/uber-eats/store" "{\"store_id\":\"${STORE_ID}\",\"action\":\"activate\"}"

# ── Menu Management ─────────────────────────────────────────────────────────
step "Upload Menu"               POST "/api/integrations/uber-eats/menu"  "{\"store_id\":\"${STORE_ID}\"}"
step "Mark Item OUT-OF-STOCK"    PATCH "/api/integrations/uber-eats/menu" "{\"store_id\":\"${STORE_ID}\",\"action\":\"oos\",\"items\":[{\"external_id\":\"probe-item\"}]}"
step "Restore Item"             PATCH "/api/integrations/uber-eats/menu" "{\"store_id\":\"${STORE_ID}\",\"action\":\"restore\",\"item_ids\":[\"probe-item\"]}"

# ── Order lifecycle + evidencia (arnés delivery day3_full) ──────────────────
step "Delivery order lifecycle"  POST "/api/integrations/uber-eats/sandbox" '{"action":"day3_full"}'
step "Scope probe (diagnóstico)" POST "/api/integrations/uber-eats/sandbox" '{"action":"scope_probe"}'

# ── Exporta la evidencia para Uber ──────────────────────────────────────────
echo -e "\n=== EVIDENCIA PARA UBER (copia esto a la respuesta) ==="
curl -s -X POST "${BASE_URL}/api/integrations/uber-eats/sandbox" -H "$AUTH" -H "$CT" \
  -d '{"action":"evidence_export"}'
echo

echo -e "\n=== RESUMEN: ${PASS} ok · ${FAIL} fallidos ==="
[ "$FAIL" -eq 0 ] && echo "✅ Todo verde → responde a Uber con la evidencia de arriba." \
  || echo "⚠️  Hay fallidos. Si son 401/403 → concede scopes (reauth_url) y re-corre."

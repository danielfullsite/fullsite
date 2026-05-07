#!/usr/bin/env bash
# deploy.sh — corre una vez para deploy + secrets + webhook
# Requiere en env: CLOUDFLARE_API_TOKEN, GITHUB_PAT, TELEGRAM_BOT_TOKEN
# Uso: bash cloudflare/orquestador-worker/deploy.sh

set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"
WRANGLER="${HOME}/.local/bin/wrangler"
REPO="ramonfaurdaniel-png/fullsite"

echo "=== [1/5] Verificando vars ==="
: "${CLOUDFLARE_API_TOKEN:?Falta CLOUDFLARE_API_TOKEN}"
: "${GITHUB_PAT:?Falta GITHUB_PAT}"
: "${TELEGRAM_BOT_TOKEN:?Falta TELEGRAM_BOT_TOKEN}"
echo "CF token: ${CLOUDFLARE_API_TOKEN:0:8}... OK"
echo "GH PAT:   ${GITHUB_PAT:0:8}... OK"
echo "TG token: ${TELEGRAM_BOT_TOKEN:0:8}... OK"

echo ""
echo "=== [2/5] Deploy Worker ==="
export CLOUDFLARE_API_TOKEN
cd "$WORKER_DIR"
DEPLOY_OUTPUT=$("$WRANGLER" deploy 2>&1)
echo "$DEPLOY_OUTPUT"

# Extraer URL del Worker del output
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
  echo "ERROR: No se pudo extraer la URL del Worker del output de deploy"
  exit 1
fi
echo "Worker URL: $WORKER_URL"

echo ""
echo "=== [3/5] Seteando secrets del Worker ==="

# GITHUB_TOKEN (PAT con scope workflow)
echo "$GITHUB_PAT" | "$WRANGLER" secret put GITHUB_TOKEN --name telegram-orquestador-warroom
echo "Secret GITHUB_TOKEN: OK"

# TELEGRAM_BOT_TOKEN
echo "$TELEGRAM_BOT_TOKEN" | "$WRANGLER" secret put TELEGRAM_BOT_TOKEN --name telegram-orquestador-warroom
echo "Secret TELEGRAM_BOT_TOKEN: OK"

# WEBHOOK_SECRET (generado aleatoriamente)
WEBHOOK_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "$WEBHOOK_SECRET" | "$WRANGLER" secret put WEBHOOK_SECRET --name telegram-orquestador-warroom
echo "Secret WEBHOOK_SECRET: OK (guardado en /tmp/warroom_webhook_secret.txt para el siguiente paso)"
echo "$WEBHOOK_SECRET" > /tmp/warroom_webhook_secret.txt

echo ""
echo "=== [4/5] Verificando Worker (GET health check) ==="
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "Worker responde 200 OK"
else
  echo "WARN: Worker respondió HTTP $HTTP_STATUS (puede tardar unos segundos en propagar)"
fi

echo ""
echo "=== [5/5] Configurando webhook de Telegram ==="
WEBHOOK_RESPONSE=$(curl -s \
  -F "url=${WORKER_URL}" \
  -F "secret_token=${WEBHOOK_SECRET}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook")
echo "Telegram webhook response: $WEBHOOK_RESPONSE"

echo ""
echo "=== DEPLOY COMPLETO ==="
echo "Worker URL:    $WORKER_URL"
echo "Webhook:       configurado con secret_token"
echo "Siguiente:     envía un mensaje al bot desde Telegram y verifica en GitHub Actions"
echo "               gh run list --repo $REPO --workflow=orquestador.yml --limit=3"

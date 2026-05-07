# cloudflare-edge

## Scope
El Worker de Cloudflare que actúa como webhook receiver de Telegram: recibe POSTs,
valida el secret, extrae el texto, y dispara `orquestador.yml` en GitHub Actions.
Es la única pieza con una URL pública HTTPS en todo el sistema.

## Key files
- `cloudflare/orquestador-worker/src/index.ts` — Lógica completa del Worker (132 líneas). Recibe Telegram update, valida WEBHOOK_SECRET, extrae `message.text` + `chat.id`, dispara GH Actions workflow_dispatch con inputs `{message, chat_id}`.
- `cloudflare/orquestador-worker/wrangler.toml` — Config del Worker: name=`telegram-orquestador-warroom`, account=`fd00e9e6edd331e0abe6d1e796f38172`, compatibility_date=2025-01-01.
- `cloudflare/orquestador-worker/package.json` — TODO: verificar versión de wrangler y si hay lockfile.

## Architecture / Stack
- **Runtime:** Cloudflare Workers (V8 isolates, edge global)
- **Language:** TypeScript — compila con Wrangler en deploy
- **Hardcoded en index.ts:**
  - `GITHUB_REPO = "ramonfaurdaniel-png/fullsite"`
  - `GITHUB_WORKFLOW = "orquestador.yml"`
  - `GITHUB_REF = "main"`
- **Secrets (vía `wrangler secret put`, NO en wrangler.toml):**
  - `GITHUB_TOKEN` — PAT con scope `workflow`
  - `TELEGRAM_BOT_TOKEN` — token del bot
  - `WEBHOOK_SECRET` — valida header `X-Telegram-Bot-Api-Secret-Token`
- **Observability:** `[observability] enabled = true` en wrangler.toml → logs visibles en `wrangler tail`
- **Flujo:** POST de Telegram → validar secret → parsear JSON → extraer text+chatId → fetch GH API → return 200 inmediato (fire and forget)
- **GET:** health check que devuelve `{"status":"ok","worker":"telegram-orquestador-warroom"}`

### Integración con el sistema
```
Telegram → POST /  →  Worker  →  GH Actions orquestador.yml (inputs: message, chat_id)
                                         ↓
                               orquestador.py (clasifica + despacha tentáculo)
```

## Known issues / gotchas
- El Worker responde 200 a Telegram **aunque el dispatch de GH falle** — así Telegram no reintenta. El error queda solo en logs del Worker.
- `WEBHOOK_SECRET` es opcional en el código (`?` en la interfaz `Env`) — si no está seteado, acepta cualquier request. Debe estar seteado en prod.
- Si cambia el nombre del repo o el workflow, hay que editar las constantes hardcodeadas en `index.ts` y hacer redeploy.
- El Worker **no loguea en agent_runs** — eso lo hace `orquestador.py`.
- Solo procesa `message.text` — mensajes con foto, audio, sticker, etc. son ignorados silenciosamente (return 200 sin dispatch).
- `edited_message` sí se procesa igual que `message` (línea: `update.message ?? update.edited_message`).

## How to extend
- **Cambiar workflow destino:** editar constante `GITHUB_WORKFLOW` en `index.ts` y redeploy.
- **Soportar múltiples chats/usuarios:** agregar lógica de whitelist en el Worker antes del dispatch (actualmente cualquier chat_id que conozca el webhook puede disparar workflows).
- **Agregar comandos directos en el Worker** (sin pasar por GH Actions): añadir cases antes del dispatch para respuestas instantáneas sin latencia de GH.
- **Redeploy:** `export CLOUDFLARE_API_TOKEN="..." && cd cloudflare/orquestador-worker && wrangler deploy`
- **Ver logs en vivo:** `wrangler tail telegram-orquestador-warroom`

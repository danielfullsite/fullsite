# Reviews Manager — AMALAY

Gestiona reseñas de Google Business Profile. Cloudflare Worker que sincroniza reseñas, genera borradores de respuesta con Claude y envía alertas a Telegram para aprobación humana.

## Arquitectura

```
Google Business Profile API
        |
        v
  [Cloudflare Worker]  <-- cron cada 2h
   |    |    |    |
   |    |    |    +-- GET /oauth/start → Google consent
   |    |    |    +-- GET /oauth/callback → guarda tokens
   |    |    |
   |    |    +-- POST /webhook/telegram → aprobar/rechazar
   |    |
   +---------+-----------+
   |         |           |
Supabase   Claude API  Telegram
(cache)    (borradores) (alertas + aprobación)
```

## Estructura

```
reviews-manager/
  migrations/
    001_reviews_tables.sql   3 tablas: google_reviews, google_oauth_tokens, review_actions_log
  setup/
  worker/
    src/
      handlers/
        cron.ts              Sync GBP -> draft con Claude -> alerta Telegram
        oauth.ts             Flujo OAuth: /start y /callback
        telegram.ts          Callback de aprobación/rechazo
      lib/
        claude-api.ts        System prompt AMALAY + generateReplyDraft()
        google-gbp.ts        listReviews, replyToReview, refreshAccessToken
        supabase.ts          CRUD multi-tenant (client_slug)
        telegram.ts          sendReviewAlert con botones inline
      index.ts               Entry point: fetch + scheduled
    wrangler.toml
    package.json
    tsconfig.json
```

## Setup

### 1. Base de datos

Correr `migrations/001_reviews_tables.sql` en el SQL Editor de Supabase (proyecto `qjiomlvudfmzuvqvhwpk`).

### 2. Google Cloud

1. Ir a [Google Cloud Console](https://console.cloud.google.com)
2. Crear proyecto (o usar uno existente)
3. Habilitar APIs:
   - My Business Account Management API
   - My Business Business Information API
4. Crear OAuth 2.0 Client ID:
   - Tipo: Web Application
   - Authorized redirect URI: `https://reviews-manager.TU-SUBDOMINIO.workers.dev/oauth/callback`
5. Anotar `client_id` y `client_secret`

### 3. Worker

```bash
cd worker
npm install
```

Setear secrets:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

### 4. Deploy

```bash
npm run deploy
```

### 5. OAuth — obtener refresh token

1. Insertar fila base en `google_oauth_tokens`:

```sql
INSERT INTO google_oauth_tokens (
  client_slug, oauth_client_id, access_token, refresh_token,
  expires_at, scope
) VALUES (
  'amalay',
  'TU_CLIENT_ID',
  'placeholder',
  'placeholder',
  NOW(),
  'https://www.googleapis.com/auth/business.manage'
);
```

2. Abrir en browser: `https://reviews-manager.TU-SUBDOMINIO.workers.dev/oauth/start`
3. Autorizar con la cuenta Google que administra el perfil de AMALAY
4. El callback guarda los tokens automaticamente en Supabase

### 6. Telegram webhook

```bash
curl -F "url=https://reviews-manager.TU-SUBDOMINIO.workers.dev/webhook/telegram" \
     "https://api.telegram.org/botTU_TOKEN/setWebhook"
```

## Flujo de operacion

1. **Cron (cada 2h):** Worker sincroniza reseñas nuevas desde GBP
2. **Borrador:** Claude genera respuesta personalizada para cada reseña `pending`
3. **Alerta:** Si rating <= 3 estrellas, alerta a Telegram con botones aprobar/rechazar
4. **Aprobacion:** Daniel aprueba, rechaza o edita desde Telegram
5. **Publicacion:** Worker publica la respuesta aprobada en Google
6. **Log:** Cada accion se registra en `review_actions_log`

## Status machine

```
pending → ai_drafted → awaiting_approval → replied
                    ↘                    ↗
                     auto_approved ------
                    ↘
                     flagged / ignored
                    ↘
                     error (retry_count++)
```

## Secrets requeridos

| Secret | Descripcion |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key |
| `ANTHROPIC_API_KEY` | API key de Claude |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | Chat ID del destinatario |

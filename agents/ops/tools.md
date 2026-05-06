# Herramientas disponibles — ops

## APIs activas
| Tool | Endpoint | Auth | Uso |
|---|---|---|---|
| Supabase REST | `$SUPABASE_URL/rest/v1/` | service_role key | Query amalay_reservaciones, wansoft_kpis |
| Groq | `api.groq.com/openai/v1/` | GROQ_API_KEY | Formatear alertas con llama-3.3-70b |
| Telegram Bot | `api.telegram.org/bot{token}/sendMessage` | TELEGRAM_BOT_TOKEN | Enviar alertas |
| Supabase REST (write) | `$SUPABASE_URL/rest/v1/agent_runs` | service_role key | Log de ejecuciones |

## APIs pendientes (requieren auth)
| Tool | Blocker | Se desbloquea |
|---|---|---|
| WhatsApp Business API | Meta Business account | Phase 3 |
| Google Business Profile | Google Cloud project + OAuth | Phase 3 |

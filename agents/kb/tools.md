# Herramientas disponibles — kb

## APIs activas
| Tool | Endpoint | Auth | Uso |
|---|---|---|---|
| Supabase REST | `$SUPABASE_URL/rest/v1/` | service_role key | Query clientes, reservaciones, ventas |
| Groq | `api.groq.com/openai/v1/` | GROQ_API_KEY | Síntesis de respuesta |
| Telegram Bot | `api.telegram.org/bot{token}/sendMessage` | TELEGRAM_BOT_TOKEN | Respuesta al usuario |

## Tablas relevantes
- `clients` (columns: name, phone, email)
- `amalay_reservaciones` (historial completo)
- `wansoft_daily` (ventas históricas por día)
- `reviews` (reseñas de clientes)

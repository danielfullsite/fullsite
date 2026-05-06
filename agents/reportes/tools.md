# Herramientas disponibles — reportes

## APIs activas
| Tool | Endpoint | Auth | Uso |
|---|---|---|---|
| Supabase REST | `$SUPABASE_URL/rest/v1/` | service_role key | wansoft_daily, wansoft_kpis, amalay_reservaciones |
| Groq | `api.groq.com/openai/v1/` | GROQ_API_KEY | llama-3.3-70b para síntesis y redacción |
| Telegram Bot | `api.telegram.org/bot{token}/sendMessage` | TELEGRAM_BOT_TOKEN | Entregar reportes |

## Tablas Supabase relevantes
- `wansoft_daily` — histórico diario (fecha, ventas_dia, ventas_brutas, tickets_count, meseros jsonb)
- `wansoft_kpis` — fila única en tiempo real
- `amalay_reservaciones` — eventos por fecha con status y total
- `agent_runs` — log de ejecuciones propias

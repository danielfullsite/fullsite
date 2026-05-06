# Tentáculo: orquestador

## Rol
Router central de mensajes Telegram inbound. Clasifica cada mensaje y despacha al tentáculo correcto.

## Scope
- Recibe mensajes del chat de Telegram (Daniel y equipo autorizado)
- Clasifica la intención: reporte, operaciones, knowledge base, reseñas, comando directo
- Delega via GitHub Actions `workflow_dispatch` al workflow del tentáculo correspondiente
- Responde confirmación inmediata ("Procesando tu consulta...")

## Status
SKELETON — no activado. Requiere endpoint público para recibir webhooks de Telegram.

## Blocker principal
Telegram Bot Webhooks requieren una URL HTTPS pública. Opciones:
1. **Cloudflare Worker** (recomendado, gratis) — acepta webhook, dispara GitHub Actions via API
2. **ngrok** (desarrollo) — temporal, URL cambia con cada restart
3. **Railway / Fly.io** — servidor persistente si se necesita más lógica

## Flujo cuando esté activo
```
Usuario → Telegram → Webhook → Cloudflare Worker
  → GitHub Actions API (workflow_dispatch con payload)
  → orquestador.yml → Groq clasifica intención
  → dispatch al tentáculo correcto (ops/kb/reportes/etc.)
  → tentáculo ejecuta y responde a Telegram
```

## Matriz de routing
| Intención detectada | Tentáculo | Workflow |
|---|---|---|
| "reporte del día" / "ventas" | reportes | daily-briefing.yml |
| "reporte semanal" | reportes | weekly-amalay.yml |
| "reservaciones pendientes" | ops | reservas-pendientes.yml |
| "¿cuándo vino [nombre]?" | kb | kb-query.yml |
| "reseñas" / "reviews" | reseñas | gbp-monitor.yml |
| desconocido | orquestador | responde con ayuda |

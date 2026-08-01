# Uber Eats — Runbook Operativo

## Comandos rápidos

### Verificar estado del webhook
```bash
curl https://app.fullsite.mx/api/integrations/uber-eats/webhook
# → {"status":"ok","service":"fullsite-ubereats-webhook-v2","version":"2.0.0"}
```

### Ver eventos recientes en DB (Supabase SQL)
```sql
SELECT event_type, status, correlation_id, created_at, last_error
FROM integration_webhook_events
WHERE provider = 'ubereats'
ORDER BY created_at DESC
LIMIT 20;
```

### Ver DLQ
```sql
SELECT * FROM integration_webhook_dlq
WHERE provider = 'ubereats'
ORDER BY created_at DESC;
```

### Ver audit trail de una orden
```sql
SELECT action, request_summary, response_summary, status_code, duration_ms, created_at
FROM integration_audit_log
WHERE correlation_id = 'UUID-AQUÍ'
ORDER BY created_at;
```

### Correr reconciliación manual
```bash
curl -X POST https://app.fullsite.mx/api/integrations/uber-eats/reconcile \
  -H "Content-Type: application/json" \
  -d '{"client_id":"amalay"}'
```

## Incidentes comunes

### Webhook no llega
1. Verificar URL en Uber Developer Console → Webhooks
2. Verificar que UBER_WEBHOOK_SECRET coincide con lo registrado
3. Revisar Vercel Function logs: Funciones → `/api/integrations/uber-eats/webhook`

### Orden no aparece en /pos/delivery
1. Buscar en integration_webhook_events: `event_type=orders.notification, status=failed`
2. Ver `last_error` para diagnóstico
3. Si está en DLQ: copiar payload, reenviar manualmente
4. Verificar que store_id está en integration_store_mappings

### Accept falla (orden en DB pero Uber no confirmada)
1. Buscar en integration_audit_log: `action=order.accept_failed`
2. La orden permanece en `/pos/delivery` status=nueva
3. El operador puede cancelar manualmente desde la UI (botón X)
4. O reintentar: `POST /api/integrations/uber-eats/order {order_id, action:"accept"}`

### Store se pausó solo
1. Revisar integration_webhook_events: `event_type=store.status`
2. Verificar integration_store_mappings.store_open
3. Reactivar: `POST /api/integrations/uber-eats/store {store_id, action:"activate"}`

## Rotación de secrets

### Rotar UBER_WEBHOOK_SECRET
1. Generar nuevo secret: `openssl rand -hex 32`
2. Actualizar en Uber Developer Console → Webhooks
3. Actualizar en Vercel: `vercel env add UBER_WEBHOOK_SECRET`
4. Redeploy (secrets se aplican en el siguiente deploy)
5. Window de ~2min donde pueden llegar webhooks con secret viejo → inofensivo (retried por Uber)

### Rotar UBER_CLIENT_SECRET
1. Rotar en Uber Developer Console → Credentials
2. Actualizar en Vercel
3. In-process token cache se invalida automáticamente (expiración)

## Monitoreo

Configurar alerta si:
- `integration_webhook_dlq` crece > 5 filas/hora → probable problema de procesamiento
- `integration_webhook_events` con `status=failed` > 10% del total → revisar logs
- `delivery_orders` con `status=nueva` y `created_at < now() - 30min` → orden stuck (correr reconciliation)

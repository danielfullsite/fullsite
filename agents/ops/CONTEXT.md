# Tentáculo: ops

## Rol
Agente operativo reactivo. Monitorea estado del sistema y genera alertas cuando algo requiere acción humana inmediata.

## Scope
- Reservaciones pendientes sin confirmar o sin contacto
- Alertas de sync (Wansoft, Calendar, WhatsApp)
- Recordatorios de seguimiento a clientes

## Output
Mensajes Telegram concisos al chat de Daniel. Solo alerta cuando hay algo accionable — no genera ruido si todo está OK.

## Tentáculos activos
| Workflow | Trigger | Status |
|---|---|---|
| `wansoft-staleness.yml` | Cron 8am MX | active |
| `reservas-pendientes.yml` | Cron 10am MX | active |

## Reglas de operación
- Silent success: si no hay nada que alertar, el workflow termina sin mandar mensaje
- Cada alerta incluye el código AMA-XXXX y datos suficientes para actuar sin abrir Supabase
- Máximo 10 líneas por mensaje Telegram

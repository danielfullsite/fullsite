# Tentáculo: kb (Knowledge Base)

## Rol
Agente de consulta y lookups. Responde preguntas de operación sobre datos históricos, clientes, menú y procedimientos internos.

## Scope
- Historial de cliente por nombre/teléfono
- Consultas sobre reservaciones pasadas
- Lookups de platillos, precios de paquetes
- Respuestas a preguntas frecuentes del equipo

## Output
Respuesta directa vía Telegram inbound (cuando el orquestador lo active).

## Status
Skeleton — activo solo cuando orquestador esté operativo con webhook público.

## Fuentes de datos
- `amalay_reservaciones` — historial completo
- `clients` — base de clientes
- `wansoft_daily` — historial de ventas

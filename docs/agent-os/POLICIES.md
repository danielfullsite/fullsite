# Agent OS — Políticas de Autonomía

## Acciones autónomas (sin aprobación)

El Agent OS puede hacer sin aprobación:

- Leer cualquier código, doc, log o git history
- Investigar y analizar
- Crear tareas en el sistema
- Crear ramas git locales
- Editar archivos de código, tests y docs dentro del scope de la tarea
- Ejecutar tests, lint y typecheck
- Crear commits locales
- Actualizar documentación de estado (RUNTIME-HEALTH, Gap Register, AUDIT-FINDINGS)
- Producir reportes y análisis
- Pedir revisión a otro agente
- Repetir ciclos Engineering ↔ Verification hasta MAX_RETRIES
- Archivar tareas terminadas
- Actualizar HEARTBEAT.json y DAILY-DIGEST.md

## Acciones que SIEMPRE requieren aprobación del Founder

Nunca ejecutar automáticamente:

- Merge a ramas protegidas (main, production)
- Deploy a cualquier entorno
- Modificar datos en producción
- Ejecutar migraciones en producción
- Usar service-role secrets de Supabase
- Borrar datos o branches
- Enviar correos, mensajes o notificaciones externas
- Contactar clientes
- Ejecutar pagos
- Cambiar arquitectura fundamental
- Cerrar certificaciones físicas (FIELD VERIFIED)
- Crear gastos
- Modificar permisos o RLS en producción
- Exponer puertos o cambiar firewall
- Cambiar políticas de seguridad
- Aprobar su propio trabajo (auto-verificación prohibida)
- Modificar el Readiness Contract

## Límites configurables

```
MAX_TURNS_PER_TASK          = 20
MAX_RETRIES_PER_TASK        = 3
MAX_CONCURRENT_ENGINEERS    = 2
TASK_TIMEOUT_MINUTES        = 120
STUCK_THRESHOLD_MINUTES     = 60
```

Editables en `shared.py` líneas 44-48.

## Kill switch

```bash
python3 scripts/agent-os/stop_agent_os.py
```

O editar `docs/agent-os/STATE.json` y poner `"kill_switch": true`.

Para reactivar: poner `"kill_switch": false` en STATE.json.

## Escalamiento automático

Si una tarea falla `MAX_RETRIES_PER_TASK` ciclos Engineering ↔ Verification:

1. La tarea pasa a `BLOCKED`
2. Se genera una Founder Decision con diagnóstico completo
3. El Orchestrator **no intenta un cuarto ciclo automático**

## Protección contra loops

- El Orchestrator verifica si ya existe una tarea para cada gate antes de crear una nueva
- Las tareas en estados terminales (MERGED, CANCELLED, REJECTED) no se recrean
- El audit log detecta patrones repetitivos

## Protección de secretos

- Nunca imprimir contenido de `.env`, `.mcp.json`, `~/.zshrc` en logs ni en commits
- Nunca escribir tokens reales en diffs visibles
- Al editar archivos con secretos, confirmar solo con "actualizado"

## Estado de WAITING

El sistema entra en WAITING cuando:

1. No existe trabajo ejecutable sin bloqueos externos o físicos
2. Hay ≥3 decisiones pendientes del Founder sin respuesta

En WAITING el sistema:
- NO inventa tareas
- NO consume tokens de modelos activamente
- Actualiza HEARTBEAT.json con estado WAITING
- Genera una tarjeta consolidada de "qué falta para desbloquear"

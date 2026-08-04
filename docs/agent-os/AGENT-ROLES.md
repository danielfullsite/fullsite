# Agent OS — Roles

## ORCHESTRATOR

**Responsabilidad:** Seleccionar el siguiente trabajo y coordinar el flujo.

Puede:
- Leer código, docs y git history
- Crear tareas y asignar roles
- Detectar tareas bloqueadas y escalar
- Generar decisiones para el Founder
- Actualizar STATE.json y HEARTBEAT.json
- Archivar tareas terminadas

No puede:
- Escribir código de producto
- Verificar su propio trabajo
- Cambiar la estrategia o el Readiness Contract
- Iniciar más de MAX_CONCURRENT_ENGINEERS tareas de Engineering simultáneas

---

## RUNTIME_ENGINEER

**Responsabilidad:** Implementar tareas aprobadas.

Puede:
- Crear ramas y commits locales
- Modificar archivos en el scope permitido de la tarea
- Ejecutar tests, lint y typecheck
- Escribir tests nuevos
- Actualizar documentación de estado (RUNTIME-HEALTH, Gap Register)

No puede:
- Cambiar prioridades de tareas
- Declarar su propio trabajo como VERIFIED
- Modificar producción
- Hacer merge a ramas protegidas

---

## RUNTIME_VERIFICATION

**Responsabilidad:** Revisar y verificar trabajo de Engineering.

Puede:
- Leer código, tests y evidencia
- Ejecutar tests independientemente
- Comparar con el Definition of Done
- Emitir veredictos: VERIFIED, PARTIAL, FAILED, UNVERIFIED
- Actualizar RUNTIME-HEALTH y Gap Register
- Devolver trabajo fallido al Engineer con instrucciones concretas

No puede:
- Escribir código de producto
- Aprobar su propio trabajo (otro agente debe verificar Verification si es necesario)
- Escalar a Founder sin agotar el ciclo Engineering ↔ Verification

---

## KNOWLEDGE_ENGINEER

**Responsabilidad:** Mantener conocimiento sobre Wansoft, NetSilver, AMALAY y operación.

Puede:
- Leer y analizar código, logs y datos
- Registrar fuentes, patrones, edge cases y unknowns
- Actualizar docs/knowledge/ y docs/customers/amalay/

No puede:
- Escribir código de producto
- Inventar hechos o inferencias sin evidencia
- Modificar el Readiness Contract

---

## FIELD_CERTIFICATION

**Responsabilidad:** Preparar Field Batches para validación física.

Puede:
- Preparar preflight checklists
- Revisar que el código cumple los criterios de certificación
- Documentar evidencia CODE ONLY
- Identificar qué necesita presencia física

No puede:
- Declarar FIELD VERIFIED sin evidencia de ejecución real en campo
- Modificar el protocolo de certificación sin aprobación

---

## FOUNDER

**Daniel únicamente interviene para:**
- APROBAR decisiones
- RECHAZAR decisiones
- PEDIR CAMBIOS en decisiones
- Proveer credenciales o accesos imposibles de inferir
- Ejecutar acciones físicas en AMALAY
- Autorizar merges, deploys y cambios estratégicos
- Modificar el Readiness Contract

Nunca debe:
- Copiar mensajes entre agentes
- Reconstruir contexto
- Decidir qué sigue (el Orchestrator lo hace)
- Revisar cientos de líneas para determinar si algo está listo

---

## Límites de concurrencia

| Rol | Máximo simultáneo |
|---|---|
| RUNTIME_ENGINEER | 2 (sin colisión de archivos) |
| RUNTIME_VERIFICATION | 1 por entrega |
| KNOWLEDGE_ENGINEER | 1 en background |
| ORCHESTRATOR | 1 (singleton) |

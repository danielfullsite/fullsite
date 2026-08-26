# Fullsite — Master Execution Plan

Estado: fuente de coordinación operativa.

Director y decisión final: Daniel.

Regla central: evidencia antes que opinión; ejecución antes que ceremonia.

## Objetivo

Cerrar Fullsite de esquina a esquina sin desestabilizar AMALAY, llegar a un segundo restaurante reproducible y construir una base que pueda crecer sin rediseñar cada instalación.

Este documento no sustituye los checklists técnicos. Los ordena y define cuándo una etapa puede considerarse cerrada.

## Foto honesta de avance

Las cifras son rangos de planeación, no porcentajes automáticos:

| Meta | Trabajo restante estimado |
|---|---:|
| AMALAY confiable para operación diaria | 20–30% |
| Segundo tenant con datos reales | 40–50% |
| Fullsite completo: POS, KDS, dashboard, integraciones e IA | 55–65% |

## Jerarquía de evidencia

Cuando dos análisis difieran, gana la evidencia más alta:

1. Prueba física o dato observado en producción.
2. Código del SHA efectivamente desplegado.
3. Prueba reproducible sobre ese mismo SHA.
4. Código de una rama todavía no desplegada.
5. Evidencia de certificación registrada.
6. Documentación.
7. Opinión o memoria.

Etiquetas permitidas: `LIVE_VERIFIED`, `CODE_VERIFIED`, `TEST_VERIFIED`, `DOC_ONLY`, `INFERENCE`, `EXTERNAL_BLOCKED`.

La evidencia live expira a los 30 días o inmediatamente después de un deploy, migración o cambio de configuración relacionado.

## Protocolo Codex + Claude

Daniel dirige. Los agentes son pares. Ninguno administra al otro y el relay solo transporta contexto, evidencia y objeciones.

### Nivel 0 — ejecución simple

Para documentación, estilos y cambios mecánicos de bajo riesgo:

- Un agente implementa y prueba.
- No se activa el segundo modelo salvo que aparezca riesgo nuevo.

### Nivel 1 — implementación con revisión adversarial

Para endpoints normales, dashboard, provisioning y cambios de riesgo medio:

- Un agente implementa en un worktree definido.
- El otro revisa en modo adversarial y de solo lectura.
- El implementador corrige y presenta evidencia.

### Nivel 2 — doble análisis independiente

Obligatorio para dinero, offline, RLS, migraciones, autenticación, multi-tenant e integraciones productivas:

- Ambos analizan primero sin contaminarse con la conclusión del otro.
- Cada afirmación importante debe traer archivo, línea, consulta live o prueba reproducible.
- Se comparan hallazgos y se ejecuta la prueba que resuelva cualquier diferencia.
- Máximo tres rondas. Si la evidencia no resuelve, Daniel decide alcance y riesgo.
- Ningún cambio llega a producción sin aprobación explícita de Daniel.

### Las cinco reglas

1. Daniel elige objetivo, alcance y veredicto.
2. Una superficie tiene un solo implementador y un solo worktree.
3. Todo cambio de alto riesgo recibe revisión independiente antes de merge.
4. La evidencia manda; si falta, se diseña una prueba en vez de debatir.
5. Merge, deploy, SQL productivo, secretos, comunicaciones externas y acciones destructivas requieren aprobación de Daniel.

Guardrails adicionales:

- Máximo dos worktrees activos de implementación.
- Nunca dos agentes editan simultáneamente el mismo archivo.
- Nunca uno despliega mientras el otro revisa esa misma entrega.
- El árbol raíz no se limpia a ciegas: primero se inventaria y atribuye cada cambio.
- Solo Nivel 2 requiere una nota breve de decisión; no se crean minutas por rutina.

## Secuencia de gates

```text
G0 Instalación
   ↓
G1 Verdad desplegada
   ↓
G2 Offline + dinero
   ↓
G3 Seguridad + aislamiento
   ↓
G4 Golden Skeleton + cliente 2
   ↓
G5 Dashboard + administración + CFDI
   ↓
G6 Uber + Rappi
   ↓
G7 IA medible
   ↓
G8 Operación repetible + venta
```

Los gates expresan dependencia, no impiden trabajo paralelo seguro.

## G0 — instalación estable

Objetivo inmediato: instalar y operar AMALAY sin introducir cambios de última hora.

- Congelar Electron, KDS, colas offline, Service Worker, bridge de impresión, proxy DB y RLS hasta terminar la instalación.
- Ejecutar el checklist físico y registrar SHA/versiones realmente instaladas.
- Validar Entrada → Caja → KDS → impresión → cobro → cierre en operación real.

Criterio de salida: instalación estable, evidencia guardada y ventana post-instalación autorizada por Daniel.

## G1 — reconciliar la verdad

- Identificar SHA de dashboard, Electron/Pedro y configuración desplegada.
- Reconciliar `OPEN-ITEMS`, certificaciones y código efectivo.
- Clasificar cada afirmación con las etiquetas de evidencia.
- No declarar cerrado algo que solo existe en una rama.

Criterio de salida: una sola foto verificable del sistema desplegado.

## G2 — offline y dinero

Orden de ejecución post-instalación:

1. Corregir la cola canónica de turnos: apertura `POST`, cierre `PATCH` con filtro exacto.
2. Hacer durable `ORDER_SENT` en el emisor: guardar antes de enviar, mismo `command_id`, borrar solo con ACK y reintentar hasta entrega.
3. Certificar cobros y cierres offline con idempotencia y conciliación exacta.
4. Probar reconexión sin duplicados, pérdida ni replay amplio.
5. Congelar una versión `Offline Certified`.

La certificación de dinero compara caja física, terminales, órdenes, movimientos y sistema paralelo. Una diferencia no explicada detiene el gate.

Criterio de salida: matriz online, caída durante servicio, reinicio y reconexión aprobada físicamente.

## G3 — seguridad y aislamiento

- Cerrar autorización por recurso y operación del proxy DB; ocultar enlaces no cuenta como control.
- Separar sesión dashboard de shift token para rutas owner/admin.
- No devolver PIN; migrar a hashes y definir revocación de sesiones al desactivar o degradar personal.
- Eliminar aprobaciones offline forjables y fallos `fail-open`.
- Auditar `USING` y `WITH CHECK` instalados en producción, no solo migraciones.
- Ejecutar pruebas negativas tenant A → tenant B para `SELECT`, `INSERT`, `UPDATE` y `DELETE`.
- Hacer durable el fraude: cursor por tenant/evento, paginación, reintento y entrega verificable.
- Verificar autenticación LAN/KDS y endurecer roles de inventario, recetas y acciones de delivery.

Criterio de salida: pruebas negativas automatizadas y evidencia live de políticas, sin escalamiento mediante PIN o token POS.

## G4 — Golden Skeleton y cliente 2

- Provisionar restaurante, menú, personal, permisos, dispositivos e impresoras sin cambios manuales de código.
- Separar configuración de producto y versionar el protocolo local.
- Ejecutar Shadow Day del segundo cliente con soporte normal, no intervención de ingeniería.
- Verificar aislamiento antes de cargar datos reales del segundo tenant.

Criterio de salida: cliente 2 reproducible desde plantilla, aislado y operable.

## G5 — dashboard, administración y CFDI

- Auditar flujos completos de dueño, gerente, caja, equipo, inventario, CRM, reportes y conciliación.
- Corregir estados falsos de éxito y operaciones no transaccionales.
- Probar CFDI real: emisión, error, reintento, cancelación y conciliación.
- Definir permisos y mensajes accionables en cada operación sensible.

Criterio de salida: flujos críticos ejecutados end-to-end con roles reales.

## G6 — integraciones

### Uber

La aprobación externa de scopes sigue siendo un bloqueo, pero no el único. Antes de producción deben cerrarse autenticación y tenant binding de acciones, autoaceptación, deduplicación, DLQ/replay, reintentos HTTP y autorización del flujo OAuth.

### Rappi

El receptor actual no equivale a integración certificada. Faltan persistencia durable antes del ACK, lifecycle conectado a la UI, firma y autenticación confirmadas con evidencia oficial, normalización de precio, menú real, poller, state machine y pruebas con tienda/payload reales.

Criterio de salida: sandbox end-to-end y producción certificada, o `EXTERNAL_BLOCKED` con todos los pendientes internos terminados y documentados.

## G7 — IA con resultado medible

- Unificar eventos, contexto, severidad y outcomes.
- Medir precisión, falsos positivos, tiempo ahorrado e impacto económico.
- Certificar cada agente antes de automatizar acciones sensibles.
- Mantener aprobación humana donde el costo de error sea material.

Criterio de salida: al menos un flujo de IA genera valor medido y reproducible.

## G8 — operación repetible y venta

- Pipeline reproducible con rollback y canary.
- Observabilidad por tenant, versión y dispositivo.
- Runbook de instalación, soporte y recuperación.
- Precio, contrato y segundo cliente activo.

Criterio de salida: Fullsite se instala, opera, actualiza y soporta sin depender de conocimiento tribal.

## Definición de “cerrado”

Fullsite está cerrado de esquina a esquina cuando:

- AMALAY completa operación online y offline sin pérdida ni duplicación de dinero o comandas.
- El segundo restaurante pasa Shadow Day sin ayuda extraordinaria.
- Autorización y aislamiento sobreviven pruebas negativas.
- Uber y Rappi están certificados o bloqueados solo por terceros, con el trabajo interno terminado.
- La IA demuestra valor medible.
- Deploy y rollback son reproducibles.
- La documentación coincide con el SHA desplegado.

## Próxima acción

La próxima acción es `G0`: instalación y checklist físico. No se abre otro frente de arquitectura antes de cerrarlo.

Después de G0, el primer corte es `CUT-01`: bugs de turno offline. Por tocar integridad y dinero, se ejecuta con Nivel 2.

## Fuentes operativas

- `docs/state/OPEN-ITEMS.md`
- `docs/state/CERTIFICATIONS.md`
- `docs/pos/POST-INSTALL-OFFLINE-SECURITY-CHECKLIST.md`
- `docs/platform/GOLDEN-POS-SKELETON.md`

# Fullsite Engineering OS — Índice

Tres preguntas → tres directorios. Nunca mezclar.

| Pregunta | Directorio | Vida útil |
|---|---|---|
| ¿Qué nunca puedo romper? | `docs/constitution/` | Permanente — cambia solo con RFC aprobado |
| ¿Cuál es el estado hoy? | `docs/state/` | Temporal — se actualiza cada sesión |
| ¿Cómo hago X? | `docs/runbooks/` | Semi-permanente — cambia cuando cambia el proceso |

---

## Qué leer según tu tarea

**Voy a modificar una RPC o crear una nueva:**
→ `docs/constitution/CONCURRENCY.md` primero.
→ `docs/runbooks/SQL_MIGRATION.md` para el proceso.

**Voy a hacer un PR:**
→ `docs/constitution/CLONABILITY.md` — responde las 5 preguntas antes de abrir el PR.

**Voy a arreglar un bug:**
→ `docs/state/BUGS.md` — verifica que no esté ya resuelto o fuera de scope.
→ `docs/runbooks/BUG_FIX.md` para el proceso.

**Voy a agregar datos de tenant (config, menú, staff):**
→ `docs/constitution/TENANT_ISOLATION.md` — entiende el modelo de aislamiento antes de tocar datos.

**No sé si algo está certificado o congelado:**
→ `docs/state/CERTIFICATIONS.md` y `docs/state/FREEZES.md`.

---

## Constitution (permanente)

| Documento | Propósito |
|---|---|
| `CONCURRENCY.md` | Modelo OCC vs append-only. Qué nunca puedes romper. |
| `CLONABILITY.md` | Las 5 preguntas. Gate de todo PR. |
| `DATA_MODEL.md` | Tablas core, invariantes, turno_id, client_id. |
| `NAMING.md` | Convenciones: r1/r2d, API, SQL, React state. |
| `TENANT_ISOLATION.md` | Multi-tenancy: RLS, SECURITY DEFINER, jerarquía de keys. |
| `SYSTEM_ARCHITECTURE.md` | Componentes y flujo del sistema. Sin estado, sin bugs. |

## State (temporal)

| Documento | Propósito |
|---|---|
| `BUGS.md` | Lista canónica de bugs abiertos por prioridad. Fuente de verdad. |
| `CERTIFICATIONS.md` | Qué está certificado, qué está en observación, qué está pendiente. |
| `FREEZES.md` | Congelamientos activos y condiciones para descongelar. |
| `INITIATIVES.md` | FSOS: 9 iniciativas, estado actual, backlog. |

## Runbooks (proceso)

| Documento | Propósito |
|---|---|
| `SQL_MIGRATION.md` | Cómo escribir y aplicar una migración SQL. |
| `BUG_FIX.md` | Ciclo completo: reproducir → fix → commit → certificar. |
| `RELEASE.md` | Checklist de deploy. |
| `CERTIFICATION.md` | Protocolo de sesión de certificación de campo. |
| `NEW_RESTAURANT.md` | Cómo dar de alta un restaurante nuevo. |

---

## Archivos legacy

Los siguientes archivos existían antes del Engineering OS y pueden contener información útil pero potencialmente desactualizada. Si hay conflicto entre ellos y `docs/constitution/`, la constitution gana.

- `docs/bibles/` — Bibles del dominio. Consultar para contexto histórico, no para reglas actuales.
- `docs/bibles/P0-EXECUTION-PLAN.md` — Plan de ejecución P0s operacionales (Architecture Freeze 2026-07-23). Complementa `docs/state/BUGS.md`.
- `FULLSITE-OPERATIONS.md` — Documento de operaciones original. Migrado parcialmente.
- `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md` — Runbook de certificación offline. Activo.

# P1 — Golden Skeleton: Registro de Certificaciones

> **Estado del registro:** PENDING-GATE  
> **Gate de apertura:** POS V2 Operational Certification milestone (todos los P0 CERTIFIED + 7 días operación sostenida en AMALAY sin intervención)  
> **Referencia del gate:** `docs/feos/EXECUTION-PLAN.md` — sección "Milestone: POS V2 Operational Certification"
>
> **Regla:** Ninguna certificación de este registro puede iniciar hasta que el gate de apertura esté CLOSED.
> No se asignan fechas, no se abren branches, no se escriben docs de evidencia mientras el gate esté OPEN.

---

## Gate de apertura — estado actual

Todos los requisitos provienen de `docs/feos/EXECUTION-PLAN.md` § "Milestone: POS V2 Operational Certification" (aprobado 2026-07-23). No hay condiciones agregadas fuera de ese documento.

| Requisito | Fuente | Estado |
|---|---|---|
| P0-1 CERTIFIED | EXECUTION-PLAN.md | CERTIFIED ✓ |
| P0-2 CERTIFIED | EXECUTION-PLAN.md | EN VALIDACIÓN |
| P0-3 CERTIFIED | EXECUTION-PLAN.md | OPEN — blocker SAT |
| P0-4 CERTIFIED | EXECUTION-PLAN.md | OPEN — Fase 5 pendiente |
| 7 días consecutivos en AMALAY sin intervención | EXECUTION-PLAN.md | PENDIENTE |
| Cero pérdida de órdenes en esos 7 días | EXECUTION-PLAN.md | PENDIENTE |
| Cero diferencias de arqueo no explicadas | EXECUTION-PLAN.md | PENDIENTE |
| Cero fallas de impresión no recuperables | EXECUTION-PLAN.md | PENDIENTE |
| Facturación CFDI operando (≥1 CFDI/día) | EXECUTION-PLAN.md | PENDIENTE — blocker P0-3 |
| Sin incidentes P0 abiertos al cierre de los 7 días | EXECUTION-PLAN.md | PENDIENTE |

**El gate está OPEN. Ninguna certificación P1 puede comenzar.**

> Cualquier modificación a estos gates requiere un ADR explícito que modifique `docs/feos/EXECUTION-PLAN.md`. No se ajustan durante ejecución.

---

## Certificaciones planificadas — Golden Skeleton

Cada ítem sigue el pipeline universal:
`Implementación → Tests → Auditoría → Evidencia → Doc → CERTIFICATIONS.md → Commit → CERTIFIED`

El doc de evidencia de cada ítem se creará como `OCS-GS-{ID}-{SLUG}.md` usando `TEMPLATE-OCS-MODULE.md`.

---

### GS-01 — Eliminación de hardcodes AMALAY

**Scope tentativo:** Cero referencias a datos específicos de AMALAY (IDs, IPs, nombres) en código fuente fuera de archivos de configuración explícitamente whitelisted. El codebase es válido para cualquier cliente sin cambios manuales.

**Criterio de éxito:** `check_hardcodes.sh` (o equivalente) pasa sin falsos negativos.  
**Evidencia requerida:** Reporte de grep + lista de whitelist aprobada + 0 hits fuera de whitelist.  
**Estado:** PENDING-GATE  
**Doc de evidencia:** `OCS-GS-01-HARDCODES.md` (no creado — gate OPEN)

---

### GS-02 — Onboarding pipeline automatizado

**Scope tentativo:** Un único comando (`provision_client.sh` o equivalente) con client-id + config como inputs produce un cliente completamente provisionado: Supabase project, migraciones aplicadas, RLS verificada, env vars en Vercel, CNAME en Cloudflare, smoke test verde. Sin pasos manuales intermedios.

**Criterio de éxito:** Ejecución en sandbox desde cero → cliente operativo en < 20 minutos, sin abrir Supabase UI ni SQL Editor manualmente.  
**Evidencia requerida:** Log completo de ejecución + tiempo medido + smoke test PASS.  
**Estado:** PENDING-GATE  
**Doc de evidencia:** `OCS-GS-02-PROVISION.md` (no creado — gate OPEN)

---

### GS-03 — Aislamiento multi-tenant verificado

**Scope tentativo:** Verificación automatizada de que ninguna tabla con datos de tenant carece de RLS + `auth_tenant` policy. Ningún cliente puede leer o escribir datos de otro cliente bajo ninguna combinación de requests válidos.

**Criterio de éxito:** `verify_rls.py` (o equivalente) pasa en producción y sandbox. Adversarial test: session de cliente A no puede leer `pos_orders` de cliente B.  
**Evidencia requerida:** Output del script + resultado del adversarial test + 0 tablas sin RLS correcta.  
**Estado:** PENDING-GATE  
**Doc de evidencia:** `OCS-GS-03-ISOLATION.md` (no creado — gate OPEN)

---

### GS-04 — POS cloneable "Minute 0"

**Scope tentativo:** Un nuevo cliente puede abrir el POS, autenticarse, abrir turno, tomar una orden, enviarla a cocina, cobrar e imprimir ticket — todo sin que Daniel intervenga en ningún paso. Sin conocimiento de configuración interna del sistema.

**Criterio de éxito:** Eduardo (o equivalente gerente nuevo) ejecuta Shadow Day sin soporte técnico activo.  
**Evidencia requerida:** Shadow Day completado en cliente #2 (o sandbox) + CERTIFICATIONS.md Shadow Day entry.  
**Estado:** PENDING-GATE  
**Prerequisito:** Shadow Day gate (`docs/state/CERTIFICATIONS.md` sección Shadow Day) debe estar aprobado para el cliente.  
**Doc de evidencia:** `OCS-GS-04-CLONEABLE.md` (no creado — gate OPEN)

---

### GS-05 — Sandbox environment operativo

**Scope tentativo:** `sandbox.app.fullsite.mx` completamente operativo como entorno de demos y onboarding. 9-step milestone completado. No comparte datos con producción. Reseteable a estado limpio.

**Criterio de éxito:** Los 9 pasos del sandbox milestone están CLOSED + demo end-to-end ejecutable sin tocar AMALAY.  
**Evidencia requerida:** Checklist de 9 pasos + smoke test desde zero-state + reset verificado.  
**Estado:** PENDING-GATE  
**Referencia:** `docs/state/` sandbox milestone  
**Doc de evidencia:** `OCS-GS-05-SANDBOX.md` (no creado — gate OPEN)

---

## Reglas de este registro

1. **Este archivo NO es el doc de evidencia de ninguna certificación.** Es solo el índice de lo que está planificado.
2. **Ningún ítem puede cambiar de estado sin seguir el pipeline completo.** Ni siquiera a "EN VALIDACIÓN" sin el gate de apertura closed.
3. **Los scopes son tentatives.** Se confirman en el momento de apertura, no antes.
4. **Cualquier ítem nuevo se agrega aquí primero.** Si no está en este registro, no puede certificarse en el track Golden Skeleton.
5. **El registro se actualiza solo en dos momentos:** cuando el gate de apertura cierra (actualizar la tabla de estado) o cuando un ítem pasa a CERTIFIED (actualizar su fila y agregar referencia al doc de evidencia).

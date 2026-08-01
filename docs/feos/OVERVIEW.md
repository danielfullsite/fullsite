# FEOS — Fullsite Engineering Operating System

> El sistema que organiza cómo Fullsite evoluciona como plataforma.
> No es un roadmap de producto. Es la infraestructura de la plataforma misma.

---

## Qué es FEOS

FEOS (Fullsite Engineering Operating System) son las iniciativas de plataforma que permiten a Fullsite escalar más allá de AMALAY sin configuración manual, sin hardcodes por cliente, y sin intervención de Daniel para cada deployment.

FEOS no es sobre features para restaurantes. Es sobre la capacidad de Fullsite de operar como una plataforma real: aprovisionamiento automatizado, clonabilidad comprobada, aislamiento de tenants garantizado, y agentes IA que funcionan para cualquier cliente.

---

## Los 9 iniciativas (P-01 a P-09)

Ver [`INITIATIVES.md`](INITIATIVES.md) para el estado actual de cada una.

| ID | Nombre | Descripción |
|---|---|---|
| P-01 | Tenant Isolation Hardening | RLS completo, auth_client_id() en todas las tablas |
| P-02 | Config-Driven Menus | Menús desde config, sin hardcodes por cliente |
| P-03 | Provisioning Automation | onboard_client.py → Provisioning Engine |
| P-04 | Tenant Creation API | API para crear tenants sin intervención manual |
| P-05 | Observability Stack | Métricas, logs, alertas multi-tenant |
| P-06 | Onboarding Wizard | UI de onboarding para nuevos restaurantes |
| P-07 | Migration Engine | Pipeline de migración desde Wansoft |
| P-08 | AI Ops Automation | Agentes IA configurables por tenant |
| P-09 | Billing Integration | Facturación automática vía Facturapi |

---

## Cómo usar FEOS

- El estado actual de cada iniciativa vive en `INITIATIVES.md`.
- El plan de ejecución activo para P0s vive en `EXECUTION-PLAN.md`.
- Las decisiones de arquitectura que soportan cada iniciativa están en `docs/adr/`.
- El Golden Skeleton (prereq para P-03/P-04) vive en `docs/platform/GOLDEN-SKELETON.md`.

---

## Regla de priorización

Antes de agregar trabajo a FEOS, la iniciativa debe pasar la checklist de 5 preguntas del Golden Skeleton:

1. ¿Es replicable para cualquier cliente sin cambios de código?
2. ¿Reduce configuración manual en el onboarding?
3. ¿Funciona en un ambiente multi-tenant desde día 1?
4. ¿Funciona sin datos de AMALAY para una demo?
5. ¿Un ingeniero nuevo puede ejecutarla siguiendo la documentación?

Si alguna respuesta es "no", la iniciativa no está lista para FEOS — necesita más diseño.

# FSOS — Iniciativas activas

> **Estado del Fullsite Operating System.**
> Misión: todo lo que hoy vive en conversaciones con Claude, scripts SQL, variables de entorno o
> conocimiento de Daniel debe migrar al propio producto.
> Principio: Claude debe ayudar a construir Fullsite, pero nunca ser un componente operativo de Fullsite.
> Última actualización: 2026-07-24

---

## Foco actual

**Hardening P0 primero.** Ninguna iniciativa FSOS se inicia hasta que los P0 estén CERTIFIED.
Track paralelo permitido: documentación, diseño, RFC — no implementación.

---

## Las 9 iniciativas

| ID | Nombre | Elimina | Estado |
|---|---|---|---|
| P-01 | Configuration Engine | Hardcodes en código (IVA, food cost %, MARKET_BRANDS, branding, station categories) | 🔴 Backlog |
| P-02 | Station Configuration UI | Cambios manuales en `pos-constants.ts` para ruteo de estaciones | 🔴 Backlog |
| P-03 | Printer Configuration UI | Configuración manual del bridge · `localhost:7717` hardcoded | 🔴 Backlog |
| P-04 | Tenant Creation API | SQL manual · edición directa de tabla `clients` · email hardcodes | 🔴 Backlog |
| P-05 | Universal Importer | Captura manual de menú y personal (CSV/Excel/Wansoft) | 🔴 Backlog |
| P-06 | Onboarding Wizard | Runbooks · 6+ scripts SQL · conversaciones con Claude para instalar | 🔴 Backlog |
| P-07 | Admin / Implementation Console | Supabase como herramienta de implementación | 🔴 Backlog |
| P-08 | Runtime Diagnostics | Llamadas de soporte para saber qué falló | 🔴 Backlog |
| P-09 | Pre-Launch Validation | Validación manual antes del Go Live | 🔴 Backlog |

---

## Cómo priorizar dentro del FSOS

Cada iniciativa se prioriza por:
1. **Frecuencia:** ¿Cuántas veces por mes requiere intervención humana?
2. **Blocker:** ¿Impide instalar un segundo restaurante?
3. **Clonability Debt:** ¿Cuántos PRs tienen deuda documentada de esta iniciativa?

Candidatos de mayor impacto para el primer ciclo activo: P-04 (sin ella no hay segundo tenant) y P-06 (sin ella el onboarding sigue dependiendo de Daniel).

---

## Regla de Clonabilidad

Ver `docs/constitution/CLONABILITY.md` para el gate completo.

Antes de cualquier PR: responder las 5 preguntas. Si alguna es "no", documentar la deuda y vincularla a la iniciativa FSOS correspondiente.

# Bugs abiertos — Fullsite

> **Fuente de verdad.** Reemplaza la memoria de Claude y cualquier lista anterior.
> Regla: verificar este archivo antes de empezar a trabajar en cualquier bug.
> Regla: cerrar un bug aquí en el mismo commit que lo resuelve.
> Última actualización: 2026-07-24

---

## Cómo usar este archivo

- **Antes de empezar:** verifica que el bug no esté ya cerrado o en progreso
- **Al cerrar:** cambia el estado a `CLOSED`, agrega el commit hash y la fecha
- **Al reabrir:** requiere evidencia — ver `docs/state/CERTIFICATIONS.md`
- **P0 operacionales:** los 4 P0s del Architecture Freeze viven en `docs/bibles/P0-EXECUTION-PLAN.md`. Este archivo trackea bugs de código.

---

## Definición de prioridades

| Nivel | Criterio |
|---|---|
| P0 | Pérdida de datos, bloqueo de operación, o falla silenciosa inaceptable. Bloquea cutover. |
| P1 | Degrada la experiencia significativamente o bloquea una feature core. No bloquea cutover pero debe resolverse antes de GA. |
| P2 | Molestia visible pero tiene workaround. Resolución en siguiente ciclo. |
| P3 | Cosmético o edge case de baja frecuencia. Backlog. |

---

## P0 — Bloquean cutover

### POS-03 · Silent print failure
**Estado:** CLOSED — 2026-07-24 — commit `aa0917f`
**Descripción:** Cuando una impresora falla (sin conexión TCP, bridge caído, error de red), el POS no muestra estado de error observable. El mesero asume que se imprimió. La cocina no recibe la comanda.
**Solución:** Banner diferenciado por estado (amarillo = reintentando automáticamente, rojo + botón = acción requerida). Banner aparece inmediatamente al encolar, no después de 2 minutos. Tres call sites silenciosos corregidos (race, OCC conflict, offline paths).
**Archivos:** `dashboard-app/src/app/pos/page.tsx`.

### POS-04 · Boot offline
**Estado:** ABIERTO
**Descripción:** La app Electron carga `page.tsx` desde la URL de Vercel en producción. Si no hay internet al arrancar, la app no carga. Mid-operation offline (después de carga inicial) funciona correctamente.
**Impacto:** Si internet cae al inicio del turno, todas las terminales quedan inutilizables.
**Criterio de cierre:** La app arranca desde bundle local (sin internet) y opera en modo offline desde boot.
**Corresponde a:** P0-4 en `docs/bibles/P0-EXECUTION-PLAN.md` (Local-First Restaurant Runtime).
**RFC:** `docs/bibles/P0-4-LOCAL-FIRST-RFC.md` aprobado 2026-07-24.

---

## P1 — Resolución antes de GA

### POS-07
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar. Ver historial de sesión julio 2026.

### POS-09
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### POS-11
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-09
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-12
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-13
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-20
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

---

## P2 — Siguiente ciclo

### POS-14
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### POS-15
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### POS-17
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-16
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-21
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

---

## P3 — Backlog

### POS-10
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

### DASH-18
**Estado:** ABIERTO
**Descripción:** Pendiente de documentar.

---

## Cerrados

### POS-02 · Phantom order merge
**Estado:** CLOSED — 2026-07-24 — commit `43d6140`
**Descripción:** Cuando dos terminales actuaban sobre la misma mesa simultáneamente, los ítems de la segunda terminal se perdían silenciosamente. Dos modos de falla: (1) race en orden nueva — B encontraba la orden de A y descartaba sus ítems; (2) conflict en orden existente — B reintentaba con sus ítems sobreescribiendo los de A.
**Solución:** Append-only semantics via `r1_add_items`. El race check ahora calcula el delta y hace append. El conflict handler usa `r1_add_items` en lugar de "Toca Enviar de nuevo".
**Archivos:** `dashboard-app/sql/r1_add_items.sql`, `api/pos/add-items/route.ts`, `pos-data.ts`, `pos/page.tsx`.

> Los bugs cerrados anteriores al Engineering OS (julio 2026) están en la sesión de historial.
> Total histórico: ~20 bugs cerrados entre mayo y julio 2026.

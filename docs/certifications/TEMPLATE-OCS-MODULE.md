# OCS {ID} — {Nombre del módulo}: Certificación

> **INSTRUCCIONES DE USO:** Copiar este archivo como `OCS-{ID}-{SLUG}.md`.
> Completar cada sección con evidencia real. No declarar CERTIFIED hasta que todas
> las secciones tengan datos concretos y el pipeline completo haya sido ejecutado.
> Eliminar estas instrucciones antes del commit final.

**Módulo:** {descripción breve del módulo}  
**Estado:** PENDIENTE  
**Suite:** Operational Certification Suite v1  
**Bloquea:** {qué no puede avanzar hasta que esto cierre}  
**Prerrequisitos:** {qué debe estar CERTIFIED antes de abrir este módulo}

---

## Gate de apertura

> Este módulo NO puede iniciar certificación mientras los siguientes gates estén abiertos.

| Gate | Estado | Referencia |
|---|---|---|
| {gate 1} | OPEN / CLOSED | {doc} |
| {gate 2} | OPEN / CLOSED | {doc} |

---

## Scope

Describir exactamente qué cubre esta certificación y qué queda explícitamente fuera de scope.

**En scope:**
- {item 1}
- {item 2}

**Fuera de scope (deferred):**
- {item A — con referencia al backlog donde se registra}

---

## Pipeline de certificación

### Paso 1 — Implementación

| Campo | Valor |
|---|---|
| Commit(s) | `{sha}` — {descripción} |
| Archivos clave | `{ruta}` — {qué hace} |
| Migración DB (si aplica) | `{sha}` — `{archivo SQL}` |
| TypeScript limpio | Sí / No |

### Paso 2 — Tests automáticos

| Campo | Valor |
|---|---|
| Archivo de tests | `src/__tests__/{archivo}.test.ts` |
| Tests nuevos | {#} |
| Suite completa | {#} / {#} PASS |
| Regresiones | 0 |
| Comando | `cd dashboard-app && npx jest {archivo}` |

### Paso 3 — Auditoría de código

Gaps encontrados durante la auditoría y su resolución:

| Gap ID | Descripción | Severidad | Resolución | Estado |
|---|---|---|---|---|
| {MOD}-GAP-01 | {descripción} | P0/P1/P2/P3 | {cómo se resolvió} | PASS / DEFERRED |

### Paso 4 — Evidencia real (si el módulo requiere prueba de campo)

> Si el módulo es código + tests sin prueba física, indicar "N/A — código + tests suficiente"
> y justificar. Si requiere campo: completar todas las filas.

| Campo | Valor |
|---|---|
| Fecha | {YYYY-MM-DD} |
| Hora inicio | {HH:MM} |
| Hora fin | {HH:MM} |
| Entorno | {AMALAY / sandbox / staging} |
| Terminal(es) | {lista} |
| Order IDs de referencia | {uuid1, uuid2, ...} |
| Queue antes | {#} operaciones |
| Queue después | {#} — esperado 0 |
| Capturas / logs | {filename o "n/a"} |

### Paso 5 — Documento de evidencia

> Este archivo ES el documento de evidencia. Debe existir en disco antes de actualizar
> `docs/state/CERTIFICATIONS.md`.

**Ruta:** `docs/certifications/OCS-{ID}-{SLUG}.md`  
**Existe en disco:** Sí (estás leyendo este archivo)

### Paso 6 — Criterios de aceptación

| # | Criterio | Verificación | Estado |
|---|---|---|---|
| OC-01 | {criterio 1} | {cómo se verificó} | PASS / FAIL |
| OC-02 | {criterio 2} | {cómo se verificó} | PASS / FAIL |

**Todos los criterios:** PASS / {N} FAIL

### Paso 7 — Actualización de CERTIFICATIONS.md

> Solo ejecutar este paso después de completar todos los anteriores con datos reales.
> Agregar entrada en la sección correspondiente con: estado, fecha, tests, referencia a este doc.

**Estado:** PENDIENTE / EJECUTADO ({fecha})

### Paso 8 — Commit final

```
git add docs/certifications/OCS-{ID}-{SLUG}.md docs/state/CERTIFICATIONS.md
git commit -m "cert({ID}): {nombre módulo} CERTIFIED — {N} criterios PASS"
```

**SHA del commit de certificación:** `{sha}` / PENDIENTE

---

## Veredicto final

**Estado:** PENDIENTE / CERTIFIED — {fecha}  
**Evidencia:** Este documento.  
**Reconstructible por terceros:** Sí — leyendo este archivo se puede verificar qué ocurrió, cuándo, dónde, con qué IDs y con qué resultado.

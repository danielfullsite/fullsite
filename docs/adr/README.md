# ADR — Architecture Decision Records

Cada decisión de arquitectura significativa tiene un ADR. Un ADR documenta el contexto, las opciones consideradas, la decisión tomada, y las consecuencias esperadas.

**Regla:** cualquier cambio que afecte constitution/, architecture/, platform/, u offline/ necesita un ADR antes de implementarse.

---

## ADRs activos

| ID | Título | Estado |
|---|---|---|
| [ADR-001](ADR-001-CONCURRENCY.md) | Modelo de concurrencia en el POS | ACTIVE |
| [ADR-002](ADR-002-FISCAL-MODEL.md) | Modelo fiscal y CFDI | ACTIVE |
| [ADR-003](ADR-003-TURNO-LIFECYCLE.md) | Ciclo de vida del turno | ACTIVE |

---

## Template para nuevos ADRs

```markdown
# ADR-NNN — Título

**Estado:** PROPOSED | ACTIVE | DEPRECATED | SUPERSEDED  
**Fecha:** YYYY-MM-DD  
**Supersede:** ADR-XXX (si aplica)

## Contexto

[El problema que se intenta resolver. Qué restricciones existen. Por qué hay una decisión que tomar.]

## Opciones consideradas

1. **Opción A** — descripción breve
2. **Opción B** — descripción breve

## Decisión

[Qué se decidió y por qué. Una o dos oraciones claras.]

## Consecuencias

**Positivas:**
- ...

**Negativas / trade-offs:**
- ...

## Referencias

- commit: [hash]
- docs: [link]
```

---

## Cómo numerar

El siguiente ADR disponible es **ADR-004**. Numeración consecutiva, sin saltos.

# POSTMORTEMS

> Cada incidente que le pasó a Fullsite vive aquí.
> Dueño: todo el equipo. Cada incidente es responsabilidad del sistema, no de una persona.

---

## Por qué hacemos postmortems

Los incidentes son la información más valiosa que el sistema puede generarnos.
Cada vez que algo falla, el sistema nos está diciendo exactamente dónde es frágil.

Un incidente sin postmortem es una oportunidad desperdiciada.
Un incidente con postmortem pero sin acciones completadas es un ritual vacío.

**La regla:** Cada incidente P0 o P1 requiere un postmortem completado en 48 horas.
Cada postmortem requiere al menos una acción que cambie permanentemente el sistema.

---

## No hay culpables

Este folder no existe para asignar responsabilidad.

Existe para mejorar el sistema.

Si alguien cometió un error que causó un incidente, la pregunta correcta no es
"¿por qué lo hicieron?" sino "¿por qué el sistema permitió que ese error causara este impacto?"

Un buen sistema hace que los errores sean difíciles de cometer y fáciles de detectar.
Un sistema frágil convierte errores pequeños en incidentes grandes.

---

## Cómo crear un postmortem

1. Copiar `TEMPLATE.md` a este folder.
2. Renombrar como `YYYY-MM-DD-descripcion-corta.md`.
3. Completar todas las secciones.
4. Agregar al índice abajo.
5. Asignar dueños a cada acción con fecha límite.
6. Hacer follow-up de las acciones hasta que estén cerradas.

---

## Definición de severidades

| Severidad | Definición | Plazo para postmortem |
|---|---|---|
| P0 | El restaurante no puede operar. Cero capacidad de cobro, impresión, o registro de órdenes. | 24 horas |
| P1 | Funcionalidad crítica degradada. El restaurante puede operar pero con fricción significativa. | 48 horas |
| P2 | Funcionalidad importante degradada. Workaround disponible. | 1 semana |
| P3 | Inconveniencia menor. No bloquea la operación. | Opcional |

---

## Índice de incidentes

| Fecha | Descripción | Severidad | Restaurante | Postmortem |
|---|---|---|---|---|
| 2026-08-26 → 09-09 | El demo estuvo 14 días muerto y el CI lo reportó en verde (5 causas encadenadas) | P2 | — (tenant `demo`) | [2026-09-09-demo-simulador-verde-en-vacio.md](2026-09-09-demo-simulador-verde-en-vacio.md) |
| 2026-07-16 → 07-20 | Sobre-deducción de inventario al activar `deductIngredientsForOrder()` | P1 | AMALAY | [R0-INVENTORY-DEDUCTION.md](R0-INVENTORY-DEDUCTION.md) |

**Análisis de causa raíz** (no son incidentes con impacto en operación, pero viven aquí):

| Fecha | Descripción | Status | Documento |
|---|---|---|---|
| 2026-07-27 | Las 615 recetas no resuelven — dos reglas incompatibles para la misma clave | Pendiente aprobación | [ROOT-CAUSE-001-recipe-identifier-mismatch.md](ROOT-CAUSE-001-recipe-identifier-mismatch.md) |

---

> Esta lista arrancó vacía mucho después de que Fullsite tuviera su primer problema.
> Que un incidente no esté aquí no significa que no ocurrió — significa que no lo escribimos.

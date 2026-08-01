# Bug Fix — Ciclo completo

El protocolo para ir de "algo no funciona" a "CLOSED + certificado".

---

## El ciclo

```
Reporte → Reproducir → Diagnosticar → Fix → Test → Commit → Cerrar en BUGS.md → Cert (si P0)
```

---

## Paso 1: Reporte

Todo bug reportado en producción llega via una de estas fuentes:
- Eduardo (gerente AMALAY) — WhatsApp
- Observación directa en visita
- Alerta de agente IA (anomaly detector, kitchen quality)
- Revisión de BUGS.md en cada sesión

Al recibir un reporte, abrir entrada en `state/BUGS.md` con:
- ID: siguiente número disponible (POS-XX o DASH-XX según categoría)
- Descripción: una oración de qué falla y en qué condición
- Status: ABIERTO
- Reportado: fecha

---

## Paso 2: Reproducir

**Regla:** si no puedes reproducirlo, no puedes arreglarlo.

Para bugs de POS:
- Intentar reproducir en sandbox (`vantara` en fullsite-warroom-staging)
- Si no se puede en sandbox, solicitar video o descripción paso a paso del gerente

Para bugs de dashboard:
- Reproducir en staging (`sandbox.app.fullsite.mx`)
- Verificar si hay datos de prueba necesarios

Si el bug no es reproducible: marcarlo como `NO REPRODUCIBLE` con las condiciones intentadas. No cerrarlo — puede reaparecer.

---

## Paso 3: Diagnosticar

Antes de tocar código, responder:
1. ¿Es un bug de lógica, de datos, o de UI?
2. ¿Afecta a un solo cliente o es sistémico?
3. ¿Hay workaround operacional mientras se arregla?

Si hay workaround, documentarlo en el entry de BUGS.md para que el gerente pueda operar.

---

## Paso 4: Fix

Rama: `fix/POS-XX-descripcion-breve` o directo en main si es trivial.

El fix debe:
- Resolver exactamente el problema reportado — nada más
- No introducir nuevas abstracciones ni refactors colaterales
- Incluir un test que falle antes del fix y pase después (si aplica)

---

## Paso 5: Test

| Tipo de bug | Cómo probar |
|---|---|
| POS — lógica de órdenes | Test e2e en staging con `vantara` |
| POS — impresión | Prueba manual con impresora real o simulador |
| POS — offline | Desconectar WiFi, reproducir, reconectar |
| Dashboard — reportes | Verificar con datos reales de sandbox |
| Dashboard — config | Crear/editar/borrar desde la UI en staging |

Siempre verificar que el flujo anterior no se rompió (regression check).

---

## Paso 6: Commit

Formato de mensaje:
```
fix(POS-XX): descripción del fix en una línea

- Qué cambió
- Por qué
- Cómo verificar

Closes POS-XX
```

---

## Paso 7: Cerrar en BUGS.md

Actualizar el entry en `state/BUGS.md`:
- Status: `CLOSED`
- Commit: hash del fix
- Fecha de cierre

---

## Paso 8: Certificación (solo para P0)

Si el bug es de categoría P0 o afecta un criterio de certificación:
1. Verificar que el criterio afectado en `state/CERTIFICATIONS.md` se actualiza
2. Si el fix cierra un P0: ejecutar el smoke test correspondiente del runbook
3. Documentar en `certifications/` si corresponde a una certificación formal

---

## Clasificación de bugs

| Categoría | Criterio | Ejemplo |
|---|---|---|
| P0 | Pérdida de datos o parada de operación | Orden se pierde offline |
| P1 | Feature crítica falla en condición normal | Impresión falla siempre en cocina |
| P2 | Feature no crítica falla o UX deficiente | Botón mal alineado |
| P3 | Cosmético o edge case raro | Texto truncado en pantalla pequeña |

Los P0 se resuelven antes de cualquier otra cosa. Los P1 se resuelven en el sprint activo. Los P2/P3 se acumulan y se resuelven en lotes.

---

## Lo que no es un bug

- Comportamiento que no estaba especificado (es un feature request)
- Limitación de diseño documentada en `offline/LIMITACION-OFF-INV-01.md` u otro doc similar
- Fallo de un servicio externo (Supabase, Facturapi, MP Point) — esos se manejan vía RecoverableOperation

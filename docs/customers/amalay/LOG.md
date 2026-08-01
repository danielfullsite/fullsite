# AMALAY LOG — Diario Operacional

> No es un log de bugs. Es el diario de cómo aprendimos a operar un restaurante.
> Cada entrada debe poder leerse dentro de un año y revivir exactamente qué pasó.
> Dueño: Daniel Ramonfaur. Actualizar después de cada visita operativa.

---

## Cómo usar este documento

Una entrada por visita. Completar el template inmediatamente después de salir del restaurante,
mientras el contexto todavía está fresco. No editar entradas pasadas excepto para corregir
errores factuales. El historial incompleto es mejor que el historial reescrito.

**Regla:** Si visitaste AMALAY y no existe una entrada aquí, la visita no existe para la empresa.

---

## Template (copiar para cada nueva entrada)

```
---

## [YYYY-MM-DD] — [Nombre del restaurante] — [Tipo de visita: Validación / Shadow Day / Go Live / Hypercare / Rutina]

**Dueño de la entrada:** [nombre]
**Duración:** [X horas, de HH:MM a HH:MM]
**Participantes:** [Daniel / gerente / staff específico / otros]

### Objetivo de la visita
[Una oración: qué queríamos demostrar, validar, o aprender hoy]

### Estado inicial (antes de entrar)
[Qué sabíamos que funcionaba. Qué sabíamos que no funcionaba. Qué no sabíamos.]

### Qué salió bien
- [Lista concreta, no vaga. "El bridge no requirió intervención" no "el sistema funcionó"]

### Qué salió mal
- [Lista concreta con contexto: qué pasó, cuándo, bajo qué condiciones]

### Fricciones observadas
[Cosas que no son bugs pero que generan resistencia o fricción en el staff o en el sistema]
- [Fricción]: [descripción] → [tipo: UX / capacitación / producto / proceso]

### Dependencias de Daniel detectadas
[Cada vez que alguien buscó a Daniel o el sistema requirió intervención del founder]
- HH:MM — [quién] — [para qué] — [tipo: Sistema / Confianza / Decisión]

### Workarounds observados
[Cosas que el staff hizo "de forma especial" para que funcionara — cada workaround es un gap de producto]
- [Workaround]: [descripción] → [gap que revela]

### Product Moments
[Momentos donde Fullsite cambió una decisión que sin Fullsite hubiera sido diferente]
- [Descripción del momento, quién tomó la decisión, qué vio en Fullsite, qué decidió]

### Bugs encontrados
| # | Descripción | Severidad | Reproducible | Componente |
|---|---|---|---|---|
| 1 | | P0/P1/P2/P3 | Sí/No | POS/KDS/Bridge/Dashboard/Print |

### Casos borde descubiertos
- [Descripción del caso y por qué no estaba en el happy path]

### Clasificación D-F-E-T (información encontrada)
- **D — Dispersa:** [información que existe pero estaba fragmentada]
- **F — Faltante:** [información que no existía en ningún lugar]
- **E — En la cabeza del gerente:** [conocimiento tácito que Fullsite debería capturar]
- **T — Tardía:** [información que llegó cuando ya no se podía actuar]

### Nuevas hipótesis
- [Hipótesis generada por lo que observamos hoy, con cómo validarla]

### Decisiones tomadas durante la visita
- [Decisión]: [por qué] → [documento donde se registra]

### Cambios al roadmap
- [Qué sube de prioridad y por qué]
- [Qué baja de prioridad y por qué]
- [Qué entra al parking lot]

### Reconciliación Wansoft vs Fullsite
| Métrica | Wansoft | Fullsite | Delta | Estado |
|---|---|---|---|---|
| Tickets del turno | | | | ✅ / ⚠️ / ❌ |
| Total ventas MXN | | | | ✅ / ⚠️ / ❌ |
| Cancelaciones | | | | ✅ / ⚠️ / ❌ |
| Descuentos | | | | ✅ / ⚠️ / ❌ |

### Criterios de Shadow Day (marcar los que se cumplen hoy)
- [ ] 4 horas de uptime continuo del bridge sin intervención
- [ ] Tickets Fullsite = Tickets Wansoft (delta = 0)
- [ ] Ventas Fullsite ≈ Ventas Wansoft (delta < 0.1%)
- [ ] Al menos 1 cancelación/modificación capturada y verificada
- [ ] Logs sin errores críticos en hora pico
- [ ] KDS funcionando en hora pico (ninguna orden llegó antes de aparecer en KDS)
- [ ] Dashboard accesible durante todo el turno

### Acciones concretas (con dueño y fecha)
| # | Acción | Dueño | Fecha límite | Status |
|---|---|---|---|---|
| 1 | | | | Pendiente |

### Riesgos abiertos
- [Riesgo]: [probabilidad: Alta/Media/Baja] — [impacto: Alto/Medio/Bajo] — [mitigación propuesta]

### Resumen ejecutivo (2-3 oraciones)
[Lo más importante de la noche. Si alguien solo lee esto, ¿qué tiene que saber?]

### Respuesta a la pregunta del Shadow Day
¿Podríamos confiar en dejar que Fullsite opere un viernes sin que Daniel intervenga?
[ ] Sí — Evidencia: [qué lo demuestra]
[ ] Todavía no — Bloqueadores: [lista exacta de qué falta]

---
```

---

## Entradas

---

## 2026-07-02 — AMALAY Coffee & Market — Validación crítica pre-Shadow Day

**Dueño de la entrada:** Daniel Ramonfaur
**Duración:** 4 horas, de 19:00 a 23:00
**Participantes:** Daniel + gerente de turno + staff operativo

### Objetivo de la visita
Demostrar que Fullsite puede operar un turno completo de viernes sin que Daniel intervenga,
y encontrar todas las razones por las que todavía no estaría listo.

### Estado inicial (antes de entrar)
**Funcionando:** POS, KDS, bridge, impresoras (4 estaciones verificadas), dashboard, event store activo desde 2026-06-12.
**No funcionando:** Facturación producción (Facturama no pagado), huella digital (WebAuthn pendiente), cajón (EC TICKET atascada).
**No sabíamos:** Si el bridge aguanta 4 horas continuas. Si hay idempotencia real bajo reconexión. Si las impresoras fallan silenciosamente.

### Qué salió bien
[COMPLETAR AL SALIR DEL RESTAURANTE]

### Qué salió mal
[COMPLETAR AL SALIR DEL RESTAURANTE]

### Fricciones observadas
[COMPLETAR AL SALIR DEL RESTAURANTE]

### Dependencias de Daniel detectadas
[COMPLETAR DURANTE LA VISITA — anotar en cuaderno físico con timestamp]

### Workarounds observados
[COMPLETAR DURANTE LA VISITA]

### Product Moments
[COMPLETAR DURANTE LA VISITA — el primer momento donde Fullsite cambia una decisión del gerente]

### Bugs encontrados
[COMPLETAR AL SALIR]

### Casos borde descubiertos
[COMPLETAR AL SALIR]

### Clasificación D-F-E-T
[COMPLETAR AL SALIR]

### Nuevas hipótesis
[COMPLETAR AL SALIR]

### Decisiones tomadas durante la visita
[COMPLETAR AL SALIR]

### Cambios al roadmap
[COMPLETAR AL SALIR]

### Reconciliación Wansoft vs Fullsite
| Métrica | Wansoft | Fullsite | Delta | Estado |
|---|---|---|---|---|
| Tickets del turno | [anotar al inicio] | | | |
| Total ventas MXN | [anotar al inicio] | | | |
| Cancelaciones | | | | |
| Descuentos | | | | |

**Baseline de inicio del turno (completar al llegar, 19:00):**
- Tickets Wansoft al iniciar: ___
- Ventas Wansoft al iniciar: $___
- Número de ticket más reciente en Wansoft: ___

### Criterios de Shadow Day
- [ ] 4 horas de uptime continuo del bridge sin intervención
- [ ] Tickets Fullsite = Tickets Wansoft (delta = 0)
- [ ] Ventas Fullsite ≈ Ventas Wansoft (delta < 0.1%)
- [ ] Al menos 1 cancelación/modificación capturada y verificada
- [ ] Logs sin errores críticos en hora pico
- [ ] KDS funcionando en hora pico
- [ ] Dashboard accesible durante todo el turno

### Acciones concretas
[COMPLETAR AL SALIR]

### Riesgos abiertos
[COMPLETAR AL SALIR]

### Resumen ejecutivo
[COMPLETAR AL SALIR — esto es lo primero que leerá alguien que quiera saber qué pasó esta noche]

### Respuesta a la pregunta del Shadow Day
¿Podríamos confiar en dejar que Fullsite opere un viernes sin que Daniel intervenga?
[ ] Sí — Evidencia:
[ ] Todavía no — Bloqueadores:

# POSTMORTEM TEMPLATE

> Copiar este archivo para cada incidente. Renombrar como YYYY-MM-DD-descripcion-corta.md
> Completar dentro de las 48 horas siguientes al incidente mientras los detalles son frescos.
>
> Regla fundamental: No hay culpables. Cada incidente mejora el sistema.
> Si el sistema permitió que esto ocurriera, el sistema tiene una falla de diseño.

---

## Información básica

**Fecha del incidente:** YYYY-MM-DD
**Hora de inicio:** HH:MM
**Hora de resolución:** HH:MM
**Duración total:** X horas Y minutos
**Severidad:** P0 (restaurante sin sistema) / P1 (funcionalidad crítica degradada) / P2 (funcionalidad importante degradada) / P3 (inconveniencia menor)
**Restaurante afectado:** [nombre]
**Dueño del postmortem:** [nombre]
**Revisado por:** [nombre(s)]

---

## Resumen ejecutivo (1 párrafo)

[Una sola vez que alguien lea solo esto, ¿qué necesita saber? Incluir: qué pasó, cuánto duró, qué impacto tuvo, cómo se resolvió.]

---

## ¿Qué pasó?

### Cronología del incidente

| Hora | Evento |
|---|---|
| HH:MM | [Primer señal del problema] |
| HH:MM | [Quién lo detectó y cómo] |
| HH:MM | [Primera acción tomada] |
| HH:MM | [Escalación si aplica] |
| HH:MM | [Causa raíz identificada] |
| HH:MM | [Fix aplicado] |
| HH:MM | [Sistema restaurado] |
| HH:MM | [Verificación de que todo funcionaba normalmente] |

### Impacto

- **Operacional:** [qué no podía hacer el restaurante durante el incidente]
- **Datos:** [¿se perdieron eventos o datos? ¿hay gaps en el Event Store?]
- **Confianza:** [¿cómo afectó esto la relación con el cliente?]
- **Financiero:** [si aplica: ventas perdidas, tiempo de downtime, etc.]

---

## ¿Cómo lo detectamos?

[Describir exactamente cómo se enteró el equipo del problema. Esta sección es crítica.]

- ¿Lo detectó el sistema automáticamente, o un humano?
- Si fue un humano: ¿quién? ¿por qué lo vio?
- ¿Cuánto tiempo pasó entre el inicio del incidente y la detección?
- ¿Había alguna alerta configurada que debería haberlo detectado antes?

**Tiempo de detección:** [X minutos desde el inicio del incidente]

**¿El sistema debería haberlo detectado solo?**
[ ] Sí — y lo hizo
[ ] Sí — pero no lo hizo (gap de observabilidad — registrar en acciones)
[ ] No — este tipo de falla no estaba en el radar

---

## ¿Cuál fue la causa raíz?

### Causa inmediata

[La acción o falla específica que causó el incidente.]

### Causas contribuyentes

[Factores que hicieron posible o más grave el incidente. Usar los "5 Por qués" si aplica.]

¿Por qué pasó? →
¿Por qué fue posible que pasara? →
¿Por qué no teníamos protección contra esto? →
¿Por qué no lo detectamos antes? →
¿Qué condición del sistema lo permitió? →

### Causa raíz sistémica

[La razón fundamental de por qué el sistema permitió que esto ocurriera.
No es suficiente decir "error humano" — ¿qué permitió que el error humano causara este impacto?]

---

## ¿Por qué nuestros controles no lo detectaron antes?

[Esta es la pregunta más importante del postmortem. Si teníamos monitoreo, alertas, o procesos que debían haber detectado esto antes, ¿por qué no funcionaron?]

- [Control que debería haber funcionado] → [Por qué no funcionó]
- [Alerta que debería haber disparado] → [Por qué no disparó]
- [Proceso que debería haber prevenido esto] → [Por qué no lo previno]

**Si no había controles → eso es el aprendizaje principal.**

---

## ¿Qué aprendimos?

### Sobre el sistema

- [Aprendizaje técnico o arquitectónico]

### Sobre los procesos

- [Aprendizaje sobre nuestros procesos de operación o desarrollo]

### Sobre la detección

- [Aprendizaje sobre cómo detectamos (o no detectamos) problemas]

### Sobre la respuesta

- [Aprendizaje sobre cómo respondemos a incidentes]

---

## ¿Qué cambia permanentemente?

Esta es la sección más importante. Todo incidente debe dejar una mejora permanente.
No hay postmortem sin acciones concretas.

### Acciones inmediatas (antes de la próxima visita al restaurante)

| # | Acción | Tipo | Dueño | Fecha límite | Status |
|---|---|---|---|---|---|
| 1 | | Fix / Monitor / Process / Config | | | Pendiente |

### Acciones a mediano plazo (próximas 2 semanas)

| # | Acción | Tipo | Dueño | Fecha límite | Status |
|---|---|---|---|---|---|
| 1 | | Fix / Monitor / Process / Config | | | Pendiente |

### Cambios permanentes al sistema

[Qué va a cambiar en el sistema para que esto nunca pueda volver a pasar de la misma manera.]

- [Cambio de arquitectura / código]
- [Nueva alerta o monitor]
- [Cambio de proceso]
- [Actualización de documentación]

---

## Clasificación del aprendizaje

Clasificar el aprendizaje principal de este incidente:

| Categoría | Aplica | Detalle |
|---|---|---|
| Producto | ☐ | [feature o bug que reveló] |
| Proceso | ☐ | [proceso que debe cambiar] |
| Capacitación | ☐ | [algo que el staff debe aprender] |
| Config | ☐ | [configuración que estaba mal] |
| Hardware | ☐ | [problema de hardware] |
| Operación | ☐ | [algo que Fullsite debe hacer diferente operativamente] |

---

## Referencia cruzada

- **AMALAY-LOG:** [enlace a la entrada del log si aplica]
- **BRIDGE.md:** [¿este incidente revela un gap en la documentación del bridge?]
- **EVENT-STORE.md:** [¿este incidente revela un gap en la documentación del event store?]
- **PLAYBOOK.md:** [¿este incidente revela un gap en el playbook?]

---

> Los postmortems no se archivan. Están activos.
> Si una acción queda pendiente por más de 2 semanas, escalar.
> Si la misma causa raíz aparece en 2 incidentes, es una falla de sistema, no de suerte.

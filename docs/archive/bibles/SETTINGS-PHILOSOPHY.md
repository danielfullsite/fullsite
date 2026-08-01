# Settings Philosophy

## La pregunta central

Antes de convertir cualquier comportamiento en setting, responde esta pregunta:

> **¿La respuesta legítimamente varía entre clientes, y el default es correcto para la mayoría?**

Si la respuesta a las dos partes no es "sí", no es un setting.

---

## Cuándo algo merece ser un setting

Un comportamiento merece convertirse en setting cuando cumple los cuatro criterios:

1. **Varía legítimamente entre clientes.** Restaurantes diferentes tienen respuestas diferentes. No "Wansoft lo permite" — sino "un restaurante de alta rotación tiene una necesidad real distinta a un restaurante de experiencia lenta".

2. **El default es correcto para la mayoría.** Un buen setting no se configura la primera semana. Se configura cuando el operador nota que el default no encaja con su operación. Si nadie usará el default, el setting no tiene razón de existir.

3. **El operador entiende el impacto sin explicación técnica.** "Tiempo de inactividad antes de bloqueo automático" es claro. "TTL de sesión en ms" no lo es. Si necesita manual, necesita rediseño.

4. **Cambiar el valor no compromete datos históricos ni el audit trail.** Si cambiar un setting puede ocultar fraude, crear inconsistencia en reportes históricos o violar un invariante fiscal, es una regla fija, no un setting.

---

## Cuándo algo debe permanecer como regla fija

Es una regla fija cuando:

- **Es un invariante de integridad.** La deducción de inventario ocurre al enviar a cocina, no al cobrar. No importa cómo opere el restaurante — cambiar esto crea inconsistencias que no se pueden reparar.

- **Es un invariante fiscal o legal.** La numeración de cortes Z es consecutiva. No se puede saltar ni reiniciar. El SAT no negocia esto.

- **Apagarlo permite ocultar fraude.** El audit log siempre está activo. Si puede apagarse, deja de ser un audit log.

- **La respuesta correcta es siempre la misma desde el dominio del negocio.** No porque sea conveniente para el sistema, sino porque el negocio de la restauración no funciona de otra manera.

---

## Reglas de clasificación

### Settings, no features

Un setting cambia el valor de un comportamiento que ya funciona. Un feature agrega un comportamiento que no existe.

| Ejemplo | Clasificación | Por qué |
|---|---|---|
| "Tiempo de inactividad antes de bloqueo" | Setting | El bloqueo ya existe; solo cambia cuándo |
| "Activar módulo de propinas" | Feature flag | El módulo puede no existir |
| "Porcentaje del pool de propinas" | Setting | El pool ya existe; solo cambia la regla |
| "Activar arqueo de caja" | Feature flag | El arqueo no existe aún |
| "Número de intentos en arqueo" | Setting | Solo cuando el arqueo exista |

### Settings, no datos maestros

Un dato maestro es un catálogo que el operador gestiona (platillos, staff, proveedores). Un setting es un valor que gobierna el comportamiento del sistema.

| Ejemplo | Clasificación | Por qué |
|---|---|---|
| "Razones de cancelación" | Dato maestro | Es un catálogo; cada razón es un registro |
| "Cancelación requiere PIN de gerente" | Setting | Gobierno de comportamiento |
| "Formas de pago" | Dato maestro | Catálogo de métodos |
| "Forma de pago requiere PIN de gerente" | Setting | Gobierno por categoría del catálogo |

### Settings, no permisos

Un permiso define qué puede hacer un rol. Un setting define cómo se comporta el sistema para todos.

---

## La jerarquía de scope

La mayoría de settings viven en **Sucursal**. Antes de asignar un scope más granular, justifica por qué Sucursal no es suficiente.

```
Organización   — Datos fiscales, moneda, timezone global
    ↓ hereda
Sucursal       — La mayoría de settings viven aquí
    ↓ hereda
Terminal       — Solo cuando una terminal tiene hardware diferente (papel 72mm vs 80mm)
    ↓ hereda
Estación       — Solo routing de comanda a impresora
```

`Rol` y `Usuario` son el dominio de permisos, no de settings.

---

## Anti-patrones

**"Wansoft lo tiene."** No es razón suficiente. Wansoft tiene 20 años de deuda de configurabilidad acumulada. Muchos de sus settings existen porque no pudieron cambiar el comportamiento por default sin romper clientes existentes.

**Setting sin problema operativo claro.** Si no puedes describir en una oración el problema operativo que resuelve, el setting no debe existir todavía.

**Setting de seguridad desactivable.** Ningún control de seguridad debe poder apagarse desde la UI. Si necesita poder apagarse, es una feature flag temporal para rollout, no un setting permanente.

**Settings que se configuran una vez y nunca más.** Si el operador los configura en el onboarding y no los vuelve a tocar, considerar si pertenecen al proceso de onboarding como entrada de dato maestro, no como setting del sistema.

**Sobre-configuración como sustituto de buen diseño.** Si el sistema necesita 5 settings para funcionar bien, probablemente el comportamiento por default está mal diseñado. El buen default elimina settings.

---

## Checklist de aprobación

Antes de agregar un setting al contrato, confirma:

- [ ] ¿Cuál es el problema operativo específico que resuelve?
- [ ] ¿Varía legítimamente entre clientes reales?
- [ ] ¿El default es correcto para la mayoría sin configuración?
- [ ] ¿El operador puede entender el impacto sin manual técnico?
- [ ] ¿Cambiar el valor puede comprometer integridad de datos o audit trail?
- [ ] ¿Es un setting o en realidad es un feature, un dato maestro o un permiso?
- [ ] ¿En qué scope vive? ¿Sucursal es suficiente?

Si el item 5 es "sí", es una regla fija. Si alguno de los demás no se puede responder, el setting no está listo.

---

## Los 5 settings iniciales aprobados

Estos pasaron el checklist:

| Setting | Problema operativo | Scope | Default |
|---|---|---|---|
| `pos.station_routing` | Un restaurante tiene cocina caliente + barra + panadería en ubicaciones físicas distintas; otro tiene una sola impresora. Hardcodeado impide onboarding de cualquier cliente nuevo. | Sucursal | Todos los items → Cocina principal |
| `pos.cancellation_reasons` | Cada restaurante tiene sus propias razones de cancelación. Texto libre genera inconsistencia en reportes. Catálogo configurable permite análisis de patrones. | Sucursal | Lista base de 5 razones |
| `pos.discount_catalog` | Los porcentajes y nombres de descuento son específicos del restaurante (AMALAY tiene "TELCEL 15%", otro restaurante no tiene nada parecido). | Sucursal | Sin descuentos habilitados |
| `pos.idle_timeout_ms` | Un restaurante de alta rotación con meseros compartiendo terminal necesita bloqueo en 5 min. Un restaurante con terminal dedicada por mesero puede tolerar 30 min. | Sucursal | 30 minutos |
| `pos.return_to_plano` | La mayoría prefiere regresar al plano post-envío (flujo implementado en Ciclo 1). Algunos operadores con flujo de lista prefieren /pos/mesas. | Sucursal | `true` (plano) |

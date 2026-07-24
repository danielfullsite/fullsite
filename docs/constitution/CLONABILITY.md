# Regla de Clonabilidad — Fullsite

> **Permanente.** Gate obligatorio para todo PR.
> Adoptada: 2026-07-24

---

## El principio

Fullsite no es una implementación de AMALAY. Es una plataforma que se despliega en cientos de restaurantes. Cada decisión de código debe funcionar igual para el restaurante número 100 que para AMALAY.

El criterio de diseño ya no es "¿el bug desapareció?" ni "¿funciona en AMALAY?". Es: **¿esta solución hace que Fullsite sea más confiable para el restaurante número 100 que para AMALAY?**

---

## Las 5 preguntas (gate de todo PR)

Antes de abrir un PR, responde estas preguntas en el cuerpo del PR:

**1. ¿Esto funciona para cualquier restaurante o solo para AMALAY?**
La lógica no puede depender de IDs, nombres, configuraciones o comportamientos específicos de AMALAY. Si depende, eso es deuda de clonabilidad.

**2. ¿La configuración vive en datos o en código?**
Las reglas de negocio (IVA, categorías de menú, estaciones de impresión, marcas de market, porcentajes de food cost) deben vivir en la DB o en variables de entorno configurables, nunca hardcodeadas en el código fuente.

**3. ¿Un implementador nuevo podría usarlo sin hablar con nosotros?**
Si la respuesta es "no, tiene que preguntarle a Daniel" o "no, tiene que pedirle a Claude que corra un SQL", esa capacidad todavía no pertenece al producto.

**4. ¿Reduce una dependencia de Claude, Daniel o del equipo?**
Claude debe ayudar a construir Fullsite, pero nunca ser un componente operativo de Fullsite. Si una tarea requiere preguntarle a Claude para instalar, configurar, migrar o mantener un restaurante, es deuda de clonabilidad.

**5. ¿Hace más fácil instalar el restaurante número 100 que el número 2?**
El costo marginal de instalación debe bajar con cada restaurante, no mantenerse constante.

---

## Respuestas aceptables

| Respuesta | Consecuencia |
|---|---|
| Todas sí | PR puede proceder |
| Alguna no, con documentación de deuda | PR puede proceder si la deuda está documentada y acotada |
| Alguna no, sin documentación | PR se devuelve |

---

## Cómo documentar deuda de clonabilidad

Si un PR introduce o mantiene una dependencia que no cumple la Regla, documenta la deuda en el cuerpo del PR con este formato:

```
## Clonability Debt

- Pregunta 2: `MARKET_BRANDS` en `pos-constants.ts` está hardcodeada para AMALAY.
  Workaround: constante en código hasta que P-01 (Configuration Engine) esté listo.
  Bloqueado por: FSOS P-01.
  Riesgo: restaurante nuevo tendría que editar el archivo antes de desplegar.
```

La deuda documentada es aceptable. La deuda invisible no lo es.

---

## Ejemplos

### Compliant ✓
```typescript
// Viene de DB, configurable por restaurante
const taxRate = config.iva_rate ?? 0.16
```

### No compliant ✗
```typescript
// Hardcodeado — toda instalación nueva tiene IVA 16% sin poder cambiarlo
const IVA_RATE = 0.16
```

### Compliant ✓
```sql
-- client_id en el WHERE — aplica a cualquier tenant
WHERE id = p_order_id AND client_id = p_client_id
```

### No compliant ✗
```sql
-- ID hardcodeado de AMALAY
WHERE client_id = 'qjiomlvudfmzuvqvhwpk'
```

---

## Relación con el FSOS

La Regla de Clonabilidad es el gate de cada PR. El FSOS (Fullsite Operating System) es el roadmap para eliminar deuda de clonabilidad existente. Ver `docs/state/INITIATIVES.md` para el estado actual de las 9 iniciativas del FSOS.

La deuda documentada en los PRs alimenta el backlog del FSOS. No son dos sistemas separados — son el mismo problema en dos horizontes de tiempo distintos.

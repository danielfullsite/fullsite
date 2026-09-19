# AGENT SAFETY POLICY — niveles de autonomía y qué exige cada acción

> **INTERNO.** Diseño. **Ningún agente está corriendo. Ninguno tiene autorización.**
> **Fecha:** 2026-09-18 · Registro: `tools/brain/AGENT_REGISTRY.json`

---

## 0 · Las tres reglas que no se negocian

1. **Un agente no es fuente de verdad.** Lee evidencia determinista y produce *interpretaciones*.
   Una interpretación lleva `confidence`; un hecho no. Si un registro necesita `confidence`, no es
   un hecho y no entra al ledger.
2. **Un agente no sube su propio nivel.** El nivel lo fija una política escrita y lo cambia una
   persona. Un agente que puede ampliar sus permisos no tiene permisos: tiene acceso.
3. **Toda acción de agente entra al ledger con la misma forma que una humana.** Cambia
   `actor_type`, no el esquema. Un agente que escribe por una puerta propia vive fuera del sistema
   que observa.

---

## 1 · Los seis niveles

| Nivel | Qué puede hacer | Qué NO |
|---|---|---|
| **L0 · OBSERVE** | leer fuentes, emitir artefactos de observación | interpretar |
| **L1 · EXPLAIN** | explicar qué ve, citando evidencia | recomendar |
| **L2 · RECOMMEND** | proponer una acción, con su evidencia y su reversibilidad | prepararla |
| **L3 · PREPARE_ACTION** | dejar lista la acción —payload, rollback, compuertas— sin ejecutarla | ejecutar |
| **L4 · EXECUTE_WITH_APPROVAL** | ejecutar tras aprobación humana explícita, por acción | ejecutar sin aprobación |
| **L5 · AUTO_EXECUTE_WITHIN_POLICY** | ejecutar dentro de una política escrita, con presupuesto y rollback probado | salir de la política |

**Todos nacen en L0 o L1.** Hoy, los doce están ahí.

### 1.1 · Lo que nunca llega a L5

Ninguna política puede autorizar auto-ejecución de:

- **acciones financieras o fiscales** — cobros, cancelaciones, cortes, timbrado, movimientos de caja
- **DDL o borrado de datos** en cualquier base compartida
- **mutación de datos de cliente**
- **despliegues a producción** o cambios de configuración que armen un peligro latente
  *(p. ej. `pos.require_enrolled_terminal` — ver §5)*

Para estas, el techo es **L4**, y la aprobación es **por acción**, no por sesión ni por agente.

### 1.2 · Cómo se sube de nivel

Sólo con las cinco:

1. el agente lleva **≥ 30 días** en el nivel anterior sin un falso positivo no explicado
2. su detector tiene **autoprueba que falla** cuando se rompe *(un validador que sólo aprueba no valida)*
3. la acción tiene **rollback probado en base desechable**
4. existe **presupuesto** por hora y por tenant
5. **Daniel lo autoriza por escrito**, nombrando el agente y el nivel

---

## 2 · El registro de acción

Toda acción de agente, en cualquier nivel ≥ L3, emite:

```jsonc
{
  "action_id": "<uuid>",
  "agent_id": "<del registro>",
  "level": "L3|L4|L5",
  "evidence": [{ "artifact": "<ref>", "claim": "<qué sostiene>" }],
  "policy_decision": { "policy_id": "<id>", "allowed": true, "why": "<regla que aplicó>" },
  "approved_by": "<persona|null>",     // null sólo es válido en L5
  "command_id": "<client_op_id>",       // identidad lógica, generada ANTES del primer intento
  "authoritative_receipt": "<ref|null>",// null = la acción NO se puede declarar exitosa
  "rollback_or_compensation": "<statement|procedimiento>",
  "outcome": "COMMITTED|REJECTED|UNCONFIRMED|NOT_RUN"
}
```

**Dos reglas del registro:**

- **Sin `authoritative_receipt`, el resultado es `UNCONFIRMED`, nunca `COMMITTED`.** Un 200 no es un
  recibo. Es la misma regla que ya aplica el outbox de Pedro, que relee la fila antes de aceptar.
- **Sin `rollback_or_compensation`, la acción no se prepara.** No hay L3 sin salida.

---

## 3 · Silencio

Un agente que no reporta se ve idéntico a un agente sano. Ya costó meses de telemetría muerta y
nueve días de agentes que no corrían.

> **Todo agente declara su `SILENCE_POLICY`, y su ausencia es una alerta.**

El detector de ausencia no vive dentro del agente —un agente caído no se alerta a sí mismo—, sino en
`SIGNAL_EXPECTATIONS.json`, que lo vigila desde fuera.

---

## 4 · Escalamiento

| Severidad | Qué la define | A dónde va |
|---|---|---|
| `INFO` | observación sin acción posible | artefacto, sin notificación |
| `WARN` | desviación con umbral, sin daño confirmado | resumen diario |
| `CRITICAL` | dinero, stock, o un restaurante que no puede operar | notificación inmediata a Daniel |
| `SILENT_FAILURE` | una señal esperada dejó de llegar | **CRITICAL por defecto** |

**Un agente nunca escala a otro agente.** Escala a una persona o a un artefacto. Cadenas de agentes
que se despiertan entre sí son exactamente cómo un falso positivo se vuelve una tormenta.

---

## 5 · Peligros latentes que ningún agente puede tocar

| Peligro | Regla |
|---|---|
| `pos.require_enrolled_terminal` | **Ningún agente, en ningún nivel, cambia esta configuración.** La tabla `pos_terminals` no existe; encenderla responde 503 y deja al restaurante sin login de nube. Es una escritura de configuración, sin deploy. |
| `clients.pos_write_authority` | Cambiar la autoridad de escritura exige corte coordinado. Techo L2. |
| `supabase_migrations.schema_migrations` | Reparar el ledger es una operación humana con autorización propia. Techo L3. |
| Cualquier tenant que no sea de clase `CERT` | Techo L2 para acciones con efecto. |

---

## 6 · Constitución — las diez casillas del agente

Todo agente del registro declara las diez de
[`OPERATIONAL_BRAIN_ARCHITECTURE.md`](OPERATIONAL_BRAIN_ARCHITECTURE.md) §6.
**Un `UNKNOWN` se muestra como `UNKNOWN`.** Un agente con `BYPASS_PATHS = UNKNOWN` no pasa de L2:
no se puede autorizar a actuar sobre un efecto cuyos otros caminos nadie enumeró.

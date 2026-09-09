# Postmortem: el demo estuvo 14 días muerto y el CI lo reportó en verde

**Ventana:** 2026-08-26 → 2026-09-09 (14 días)
**Detectado:** 2026-09-09
**Severidad:** P2
**Tenant afectado:** `demo` (ningún restaurante real; ningún cliente que paga)
**Status:** CERRADO — las cinco causas y el hueco sistémico que las escondía

> Nota sobre la severidad: la escala del `README.md` de esta carpeta está escrita para restaurantes en operación, y este incidente no encaja limpio — no hubo restaurante afectado, pero tampoco había workaround. Se clasifica P2 por impacto comercial (el demo que se le enseña a un prospecto) y de ingeniería (la verificación del descuento de inventario, bloqueada).

---

## Resumen ejecutivo

Durante 14 días el restaurante demo no vendió nada. Había **cinco** causas encadenadas —PIN, curva horaria, turno inventado, renglones sin identidad, renglones sin importe— y cada arreglo destapaba la siguiente. Lo que hizo el incidente largo no fue ninguna de las cinco: fue que **sólo la primera fallaba en rojo**. Las otras cuatro salían en `success`. El día que se arregló el PIN, el workflow dejó de fallar y empezó a mentir, y así se quedó dos semanas.

Se cerró todo el 2026-09-09 en cuatro PRs. El cambio que importa no es ninguno de los cinco arreglos, sino las guardas que ahora hacen **imposible que una corrida vacía salga en verde**.

---

## Cronología

Toda la evidencia está verificada contra prod y contra los logs de Actions. Horas en local MX.

| Fecha / hora | Evento | Evidencia |
|---|---|---|
| 08-26 11:23 | Última orden del tenant `demo`. Después de esto, nada durante 14 días. | `max(created_at)` = `2026-08-26 17:23:27+00` |
| 08-26 13:10 | Entra `VIA_POS=1`: el simulador deja de escribir directo a `pos_orders` y pasa por `api/pos/save-order`. | commit `85c4cb17` (#150) |
| 08-26 → 09-09 | El cron horario falla **en rojo**, cada hora, durante dos semanas. | `ERROR: PIN rechazado: HTTP 401` — run [34311074051](https://github.com/danielfullsite/fullsite/actions/runs/34311074051) |
| 09-09 ~01:00 | Se corrige el PIN. La corrida sale **verde**… con `+0 órdenes`. | run [34323009183](https://github.com/danielfullsite/fullsite/actions/runs/34323009183) |
| 09-09 01:41 | Causa 2 cerrada. Al forzar la curva, el simulador por fin intenta: 4 órdenes, 4 rechazadas con `409`. | PR [#357](https://github.com/danielfullsite/fullsite/pull/357) · run [34324277618](https://github.com/danielfullsite/fullsite/actions/runs/34324277618) |
| 09-09 10:20 | Causa 3 cerrada. Ahora sí vende: 5 órdenes creadas, 5 cobradas… y 0 inventario. Verde. | PR [#362](https://github.com/danielfullsite/fullsite/pull/362) · run [34375190026](https://github.com/danielfullsite/fullsite/actions/runs/34375190026) |
| 09-09 10:44 | Causa 4 cerrada. El inventario se mueve por primera vez. | PR [#366](https://github.com/danielfullsite/fullsite/pull/366) |
| 09-09 11:03 | Causa 5 cerrada. | PR [#371](https://github.com/danielfullsite/fullsite/pull/371) |
| 09-09 11:19 | Estado medido: **226** movimientos de inventario, **32** órdenes en 12 h, turno vigente. | consulta a prod |

La correlación de las dos primeras filas no es casualidad: las órdenes se detuvieron el mismo día en que el simulador cambió al camino real del POS.

---

## Las cinco causas

| # | Causa | Cómo se veía | Cerrada en |
|---|---|---|---|
| 1 | PIN incorrecto: `api/pos/pin` devolvía `HTTP 401`. | **Rojo.** La única visible. | — |
| 2 | `CURVA_HORARIA: '1'` fijo en el `env:` y sin forma de apagarlo. De madrugada `factor_de_la_hora()` vale `0.0` y el simulador no entra al ciclo. | Verde, `+0 órdenes`. | #357 |
| 3 | `turno_id` inventado (`lab-turno-<AAAAMMDD>`). Servía para escribir directo a la tabla; `save-order` lo valida contra `pos_turnos` → `TURN_NOT_FOUND`. | Verde. El rechazo se imprimía a stderr y no cambiaba el estado. | #362 |
| 4 | Los renglones no llevaban `id`/`menuItemId`, y a `demo` le faltaba la cadena de recetas que `r1_reconcile_order` lee. La RPC descartaba todos los renglones y `save-order` traducía "cero filas" a `inventory_status = SKIPPED`, con HTTP 200. | Verde, **vendiendo**: 5 órdenes cobradas, 0 gramos movidos. | #366 |
| 5 | El renglón no llevaba `subtotal`, que es lo que `ops_consumo_cobertura` lee para medir cobertura por importe. | Verde. La métrica salía `NULL`. | #371 |

Ninguna de las causas 2 a 5 era un error de programación evidente. Las cuatro eran supuestos que habían sido ciertos —cuando el simulador escribía directo a `pos_orders`— y dejaron de serlo al pasar por el POS real, sin que nada se rompiera de forma visible.

---

## Por qué nuestros controles no lo vieron

Esta es la parte que importa.

| Control | Por qué no funcionó |
|---|---|
| Estado del workflow en Actions | `success` no distinguía "hizo el trabajo" de "no hizo nada". Un simulador que crea 0 órdenes era indistinguible de uno que crea 20. |
| El log del paso | Decía la verdad (`+0 órdenes`, `RECHAZADA … TURN_NOT_FOUND`, `inventario SKIPPED`). Nadie lee el log de un paso verde. |
| El step summary | Decía `curva horaria activa` y nada más. No traía el conteo de órdenes ni el estado del inventario. |
| Tests del repo | `test_curva_horaria.py`, `test_pos_client.py`, `test_menu_del_tenant.py` pasaban entonces y siguen pasando. Prueban las piezas, no que el sistema completo produzca algo. |
| Alguien mirando el demo | No hubo. Nadie abrió el tenant `demo` en 14 días. |

**El aprendizaje central: arreglar el PIN convirtió un rojo honesto en un verde mentiroso.** La falla no desapareció — se movió un eslabón hacia adelante en la cadena y cambió de forma, pero conservó el mismo disfraz. Y volvió a pasar tres veces más: cada arreglo destapaba la siguiente causa, y la siguiente también salía verde.

Un sistema cuyo único trabajo es generar datos y reporta `success` habiendo generado cero no está reportando su estado: lo está escondiendo.

---

## Un caso donde la evidencia corrigió la decisión

Vale registrarlo porque es la regla 4 de `docs/DECISION-BRAIN.md` funcionando ("el campo es el juez").

Para la causa 3 se decidió *"que el simulador lea el turno abierto del tenant"*. Al ir a implementarlo, la medición mostró que el turno abierto de `demo` (`msqlianea7sp`, abierto el 2026-08-12 y nunca cerrado) el POS lo declara **stale** — la vigencia se mide por día de venta, no por reloj. Adoptarlo habría metido las órdenes colgando de un corte de hace un mes, y un prospecto que entrara al POS demo habría visto *"Turno del día anterior → Corte Z"*.

La decisión se corrigió sobre la evidencia: el simulador abre y cierra turno como una terminal al arrancar el día (`pos_turno.py`), a nombre de quien tecleó el PIN. La decisión original era razonable con la información que había; la medición la invalidó antes de escribir el código, no después.

---

## Qué cambió permanentemente

Los cinco arreglos importan menos que esto: **el workflow ya no puede salir en verde sin haber hecho nada.** En una corrida forzada (`forzar_horario=true`), truena si:

1. el POS rechazó órdenes (`RECHAZADA` en el log);
2. se crearon `+0 órdenes` — *"corrida forzada con 0 órdenes creadas. Verde en vacío."*;
3. se cobraron órdenes sin conciliar inventario (`INVENTARIO SIN CONCILIAR`);
4. se vendió y el inventario no movió ni una fila.

El cron **no** lleva esas guardas: en franja cerrada, cero órdenes es el comportamiento correcto. La distinción es deliberada.

Además: el `Resumen` ahora sube al step summary el conteo de órdenes y el estado del inventario, que antes sólo vivían en el log del paso; y el paso del simulador lleva `set -o pipefail` explícito, porque el shell por omisión de un `run:` es `bash -e {0}` **sin** pipefail y el `| tee` habría tragado un fallo del simulador.

---

## Estado final (medido 2026-09-09 11:19 MX)

| Métrica | Antes | Después |
|---|---|---|
| `pos_inventory_movements` del tenant `demo` | 0 | **226** |
| Última orden de `demo` | 2026-08-26 | **2026-09-09 11:19** |
| Órdenes en las últimas 12 h | 0 | **32** |
| Turno vigente | uno stale del 08-12 | uno del día |

---

## Clasificación del aprendizaje

| Categoría | Aplica | Detalle |
|---|---|---|
| Producto | ☑ | El demo que se le enseña a un prospecto estuvo 14 días sin datos. |
| Proceso | ☑ | Verde en CI no es evidencia de que algo se ejecutó. Un job que produce datos tiene que afirmar cuántos produjo, y fallar si son cero. |
| Config | ☑ | Un `env:` fijo en un workflow es una decisión que nadie puede revocar sin editar el archivo. |
| Operación | ☑ | Nadie miró el tenant `demo` en 14 días. Las guardas cubren eso ahora, pero sólo en corridas forzadas. |

---

## Referencia cruzada

- `docs/postmortems/R0-INVENTORY-DEDUCTION.md` — el descuento de inventario que este incidente impidió verificar por el camino real del POS.
- `.github/workflows/demo-24-7.yml` · `.github/scripts/lab_simulator.py` · `.github/scripts/pos_turno.py` · `.github/scripts/pos_client.py` — el sistema afectado.
- `dashboard-app/src/app/api/pos/save-order/route.ts` — la validación de turno (`resolveTurnoForSave`) y el `inventory_status`.
- PRs: [#357](https://github.com/danielfullsite/fullsite/pull/357) · [#362](https://github.com/danielfullsite/fullsite/pull/362) · [#366](https://github.com/danielfullsite/fullsite/pull/366) · [#371](https://github.com/danielfullsite/fullsite/pull/371)

# ADR-003 · Addendum — Reglas de Eduardo y estado real del código

> **Fecha:** 2026-09-01 · **Extiende:** [`ADR-003-TURNO-LIFECYCLE.md`](ADR-003-TURNO-LIFECYCLE.md) (aprobado 2026-06-30)
> **No lo reemplaza.** El ADR sigue siendo el diseño; este documento dice **qué hace el código hoy**,
> **qué reglas puso Eduardo** que el ADR no contemplaba, y **dónde están los huecos**.

## Por qué existe este addendum

Tres cosas obligaron a escribirlo:

1. **Eduardo dictó reglas de dominio** que el ADR no cubre — y él es quien va a operar esto.
2. **El código diverge del ADR** en puntos que importan. El ADR dice "turno por terminal";
   la tabla no tiene `terminal_id`.
3. **La noche del 2026-08-31 en AMALAY** produjo evidencia de campo que corrigió hipótesis
   que se venían dando por buenas.

> **Regla de lectura.** Cada afirmación de este documento trae su fuente: `archivo:línea`,
> una consulta a la base, o una cita de Eduardo. Lo que no la trae, va marcado como
> **no verificado**.

---

## 1. Las reglas de Eduardo

Dictadas por Eduardo Esquivel (AMALAY) en sesión con Daniel. Son sus palabras, no un resumen.

### R1 — No se abre turno con cuentas abiertas del anterior

> *"No puedes abrir un turno si sigues teniendo cuentas abiertas del turno anterior… hay que
> matarlas todas."*

### R2 — Ninguna cuenta cruza el día

> *"No puede haber cuentas abiertas de un día para otro."*

### R3 — El folio de orden reinicia; el de movimiento no

> *"El sistema funciona con órdenes y con movimientos… Todos los días empieza con la orden uno,
> pero el consecutivo del movimiento [sigue]."*

Dos contadores distintos, con reglas opuestas. La orden es del día; el movimiento es de la vida
del sistema y **nunca reinicia** — es lo que permite auditar hacia atrás sin ambigüedad.

### R4 — Un turno no vive más de 24 horas

> *"El sistema te dice que no puede estar en turno más de 24 horas."*

### R5 — Corte X y corte Z son cosas distintas

- **Corte X** — arqueo intermedio. Se hace **varias veces al día**. No cierra nada.
- **Corte Z** — cierra el día. Uno por día de venta.

### R6 — El KDS lo configura el cliente, por estación

> *"Esta es una impresora digital. ¿Qué quieres que se vea?"*

No es una pantalla fija: cada estación decide qué muestra.

### R7 — La configuración se hace in-house

> *"La configuración tiene que darse in-house."*

Directamente ligado a la clonabilidad: si configurar exige tocar código, no escala.

### R8 — Alta de empleados desde POS y dashboard, con perfiles de permiso

Como Wansoft: perfiles, no permisos sueltos por persona.

---

## 2. Dónde el código no coincide con el ADR

Verificado contra `information_schema` y contra `origin/main` el 2026-09-01.

| El ADR dice | La realidad | Consecuencia |
|---|---|---|
| `pos_turnos.terminal_id` — *"turno es POR TERMINAL, no global"* | **La columna no existe.** El código consulta `pos_turnos?client_id=eq.X&closed_at=is.null` (`pos-data.ts`, `getActiveTurnos`) | El turno es **global por restaurante**. Dos terminales comparten turno. No es lo diseñado — pero coincide con R1/R2 de Eduardo, que razona por restaurante, no por caja. |
| `pos_turnos.status` (`'abierto'`/`'cerrado'`) | **No existe.** El estado se deriva de `closed_at IS NULL` | Funciona, pero no hay forma de expresar un estado intermedio (p. ej. "cerrando"). |
| `cajero`, `efectivo_declarado`, `notas_cierre` | Se llaman `opened_by`, `fondo_final` / `efectivo_sistema`, `notas` | Sólo nombres. Se anota para que nadie busque columnas que no existen. |

**Columnas reales de `pos_turnos`:** `id`, `client_id`, `opened_by`, `fondo_inicial`, `opened_at`,
`closed_by`, `fondo_final`, `efectivo_sistema`, `diferencia`, `closed_at`, `notas`.

> Esto ya costó caro: el 2026-08-31 `save-order` pedía `location_id` a `pos_turnos`. PostgREST
> devuelve **400** ante una columna inexistente, el código lo leía como "no hay turno" y
> respondía **409**. El POS no pudo enviar **ninguna** comanda esa noche.
> Prueba que lo impide: `pos-turnos-columnas.test.ts`.

---

## 3. Estado de cada regla

| Regla | ¿Implementada? | Evidencia |
|---|---|---|
| **R1** — no abrir con cuentas abiertas | ❌ **No** | `filterOpenOrders` (`pos-cierre-guard.ts`) sólo lo consume `CierreCajaWizard.tsx:188`. La guarda existe **al cerrar**, no al abrir. |
| **R2** — ninguna cuenta cruza el día | ⚠️ **Parcial** | El cierre bloquea con mesas abiertas y permite override auditado (`pos_cierres.cierre_con_ordenes_abiertas`, `ordenes_pendientes`, `cierre_autorizado_por`). Nada impide que el día termine sin cierre. |
| **R3** — folio de orden por día | ✅ **Corregida 2026-09-01** | ~~Reinicia por fecha de calendario~~ — **eso era falso**, ver corrección abajo. Reiniciaba **por turno**. Migración `20260901180000_folio_por_dia_de_venta.sql`: columna `dia_venta`, folio por día de venta, e índice único parcial desde `2026-09-02`. |
| **R3b** — consecutivo de movimiento | ❌ **No existe** | No hay contador de movimientos/pagos en el esquema. |
| **R4** — máximo 24 horas | ⚠️ **Sólo se avisa** | `getActiveTurnoWithStaleCheck` marca `isStale` a las **18 h** y `TurnoGate` ofrece Corte Z. Es un aviso, no un límite. |
| **R5** — corte X vs Z | ⚠️ **Parcial** | Existe `pos_cierres.folio_z`. No hay corte X como acto propio y repetible. |
| **R6** — KDS por estación | ⚠️ **Parcial** | Hay estaciones (`barra`, `caja`, `cocina`, `tickets`) y ruteo por categoría. La configuración de **qué se ve** no está expuesta al cliente. |
| **R7** — configuración in-house | ❌ **No** | Hoy configurar terminales exige tocar archivos en la máquina. Es el bloqueo de clonabilidad. |
| **R8** — alta de empleados con perfiles | ⚠️ **Parcial** | `pos_staff.role` + `pos-permissions.ts` dan perfiles. Falta el alta desde POS. |

**Ninguna regla de Eduardo está completa.** Tres no existen; cinco están a medias.

---

## 4. Lo que enseñó la noche del 2026-08-31

Cuatro fallos en producción, **todos de la misma familia**: *un fallo leído como si fuera otro*.

| Lo que pasó | Cómo lo leyó el código | Efecto |
|---|---|---|
| `400` (columna inexistente) | "no hay turno" → `409` | Ninguna comanda salió en toda la noche |
| `401` (sesión vencida) | "sin conexión" → caché viejo | Turno fantasma → Corte Z que no cerraba nada, en bucle |
| `TypeError` de un enum | "no hay conexión con la caja" | La comanda no llegaba al KDS |
| `401` en el plano | "no hay mesas ocupadas" | Todas las mesas libres **y** el caché de ocupadas borrado |

De ahí salió [`clasificar-fallo.ts`](../../dashboard-app/src/lib/clasificar-fallo.ts): separa
*"no se pudo alcanzar el servidor"* (vale caché) de *"el servidor rechazó la petición"* (sube
como error). **Servir datos viejos está permitido; servirlos sin decirlo, no.**

### El hallazgo mayor: los once turnos

Once turnos quedaron con `closed_at = 20:07:00.918` — **el mismo milisegundo** — varios de ellos
abiertos *después* de esa hora.

Durante horas se atribuyó a un `closed_at` calculado en el cliente. **Esa hipótesis era falsa.**
Los datos no cuadraban: once clics no caen en el mismo milisegundo. Fue **una sola escritura**.

La causa era una **posición de argumento**:

```ts
queueOperation(table, method, data, endpoint?, base_version?, transport?)
//                                  4º         5º

queueOperation('pos_turnos', 'PATCH', payload,
               undefined,                      // ← endpoint
               `pos_turnos?id=eq.${turnoId}`,  // ← base_version (!)
               'SUPABASE_REST')
```

El filtro caía en `base_version`. Con `endpoint` vacío, el replay armaba la URL como
`item.endpoint || item.table` → `/rest/v1/pos_turnos`, **sin filtro**, y el PATCH cerraba todos
los turnos del restaurante. Con `DELETE` habría borrado la tabla.

TypeScript no podía verlo: los dos parámetros son `string | undefined`.

> **La lección, y es la que vale para el producto:** las hipótesis cómodas sobreviven hasta que
> alguien mira el dato crudo. Aquí el dato era el milisegundo repetido. Si se hubiera "arreglado"
> el `closed_at`, se habría tocado el código equivocado y el bug real seguiría cerrando turnos en
> masa.

Defensas: [`mutacion-sin-filtro-toca-todo.test.ts`](../../dashboard-app/src/__tests__/mutacion-sin-filtro-toca-todo.test.ts)
— la llamada corregida, un guard que se niega a mandar `PATCH`/`DELETE` sin filtro, y un barrido
de todo `src/`.

---

### Corrección 2026-09-01 — el folio no reiniciaba por calendario, reiniciaba por turno

Este mismo documento afirmaba que `set_pos_order_number()` reiniciaba el folio por
**fecha de calendario**. Al ir a arreglarlo, la fuente de la función dijo otra cosa:

```sql
where client_id = new.client_id and turno_id = new.turno_id
```

Reiniciaba **por turno**. La rama de calendario es un *fallback legacy* que sólo corre
cuando `turno_id IS NULL`. La afirmación salió de leer la migración base sin leer la
función viva en producción.

El defecto real era **peor** que el documentado: con dos turnos en un día, el folio
volvía a empezar en 1. Evidencia en AMALAY, día de venta 2026-08-30:

| Turno | Folios |
|---|---|
| `mtgl6c29pkyt` | 1 – 15 |
| `mt9etv39o35q` | 2 – 4 |

Dos órdenes «#2» el mismo día, indistinguibles en un ticket o una factura.

**Sobre el índice único.** Medido en producción antes de crearlo: 129,016 órdenes con
folio, **115,227 filas involucradas en duplicados** (89%), peor caso el mismo folio
**167 veces**. Casi todo es data semilla de demos — `scyf-demo` (110,789),
`tekila-rg` (5,520), `diezmex-demo` (5,013). AMALAY tiene 24 órdenes y 2 filas
duplicadas. Un índice total habría fallado al crearse; renumerar historia de otros
tenants no corresponde a este arreglo. Por eso es **parcial desde 2026-09-02**, fecha
desde la cual el campo está limpio.

**Verificado en staging antes de producción:** folio continuo al cambiar de turno,
la 1 a.m. cuenta como el día anterior, las 9 a.m. abren día nuevo con folio 1, y el
índice rechaza un duplicado forzado. Al probar salió además que **staging no tenía el
trigger** `trg_pos_order_number` que producción sí tiene — deriva entre entornos.

---

## 5. Principios que quedan fijados

Salen de la evidencia de arriba, no de preferencia:

1. **Abrir el día nunca se bloquea por red.** Sin internet se abre local y se encola.
   Regla dura #3 de `OFFLINE-LAN-FIELD-PROVEN §4`.
2. **Insistir no debe multiplicar.** N toques en "Abrir turno" = **una** fila
   (`idParaAbrirTurno`, ventana de 10 min).
3. **Un fallo se clasifica antes de interpretarse.** `clasificar-fallo.ts`.
4. **Ninguna mutación sin filtro sale a la red.** `esMutacionSinFiltro`.
5. **Los datos viejos se sirven, pero se anuncian.** Nunca en silencio.
6. **El día de venta manda sobre el calendario.** `dia-de-venta.ts` (`business_day_start_local`,
   default `05:00`). Antes del 2026-08-31 **ningún** código del cliente leía esa columna.

---

## 6. Lo que sigue, en orden

| # | Qué | Por qué primero |
|---|---|---|
| 1 | **R1 al abrir turno** + cierre masivo de cuentas huérfanas | Es la regla que Eduardo va a probar, y hoy no existe |
| 2 | **Folio por día de venta + índice único** | Ya hubo un `#1` duplicado; sin índice, vuelve |
| 3 | **Consecutivo de movimiento** (R3b) | Sin él no hay auditoría continua |
| 4 | **Corte X como acto propio** (R5) | Hoy no se puede arquear sin cerrar |
| 5 | **Verificación WebAuthn server-side** | La huella cierra escalada, no suplantación |
| 6 | **Límite duro de 24 h** (R4) | Hoy sólo avisa a las 18 h |

**Nada de esto está certificado en campo.** El vocabulario aplica: *implementado* ≠ *probado
localmente* ≠ *validado en campo* ≠ *cerrado*.

---

## Fuentes

- Reglas R1–R8: sesión de Eduardo Esquivel con Daniel, transcripción.
- Esquema e índices: `information_schema.columns` y `pg_indexes`, consultados 2026-09-01.
- `set_pos_order_number`: `pg_proc.prosrc`, consultado 2026-09-01 (reinicia por fecha de calendario).
- Código: `origin/main` al 2026-09-01 (`95310a60`).
- Incidentes: [`docs/offline/TEST-MATRIX.md`](../offline/TEST-MATRIX.md) (T-26),
  PRs #276, #279, #280, #282, #283, #284, #285, #289, #290.

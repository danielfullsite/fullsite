# ADR: Ciclo de Vida del Turno (Abrir, Operar, Cerrar)

> Status: APROBADO por founder 2026-06-30 con 6 ajustes
> Fecha: 2026-06-30
> Cubre: P0-1 (Abrir turno), P0-2 (Cerrar turno), P0-3 (Persistir arqueo)
> Principios: auditado, sobrevive refresh, multi-device, compatible con Realtime

---

## Contexto

Hoy `pos_turnos` existe en la BD pero no hay UI para abrir ni cerrar turno.
El fondo de caja no se captura. El arqueo (declaracion de efectivo) no se
persiste. El corte muestra datos pero no hay acto formal de cierre.

El turno es la unidad fundamental de operacion de un restaurante. Todo lo
que pasa entre abrir y cerrar pertenece a un turno. Sin turno, el corte
no puede cuadrar.

---

## P0-1 — Abrir Turno con Fondo

### Objetivo

El primer cajero del dia abre el turno declarando cuanto efectivo hay en
caja. Esto establece la linea base para el corte.

### Flujo completo

```
1. Cajero abre Fullsite POS → login con PIN/huella
2. Sistema detecta: hay turno abierto para esta terminal?
   SI → ir a mesas, operar normal
   NO → mostrar modal "Abrir Turno"
3. Modal "Abrir Turno":
   - Campo: Fondo de caja ($ numerico, default $0)
   - Boton: "Abrir Turno"
4. Al confirmar:
   - INSERT en pos_turnos (id, terminal_id, cajero, fondo_inicial, status='abierto', opened_at)
   - Audit log: turno_opened {fondo, cajero, terminal}
   - Navegar a /pos/mesas
```

### Estados del turno

```
abierto → cerrado
         (no hay mas estados)
```

Un turno NO puede volver a `abierto` una vez cerrado. Si se necesita
reabrir, se crea un turno NUEVO (con nota de por que).

### Validaciones

| Regla | Que pasa si no se cumple |
|---|---|
| Solo 1 turno abierto por terminal | "Ya hay un turno abierto. Cierralo primero." |
| Fondo >= 0 | No permite negativos |
| Fondo es numerico | Validacion de input |
| Usuario con permiso `abrir_dia_operaciones` | Solo gerente/cajero/admin |

### Preguntas respondidas

**Puede haber dos turnos abiertos?**
No en la misma terminal. Si hay multiples terminales, cada una puede tener
su propio turno abierto (turno es POR TERMINAL, no global). Esto es
compatible con multi-terminal futuro.

**Quien puede abrir turno?**
Roles con permiso `abrir_dia_operaciones`: admin, gerente, cajero.
Mesero NO puede abrir turno.

**Que pasa si el sistema se reinicia?**
El turno esta en Supabase. Al recargar, el POS detecta el turno abierto
via `getActiveTurno()` y lo usa. No se pierde nada.

**Se puede editar el fondo despues?**
NO. El fondo se declara una vez al abrir. Si el gerente se equivoco,
tiene dos opciones:
1. Registrar un deposito/retiro para ajustar
2. Cerrar turno y abrir uno nuevo con el fondo correcto
Ambas opciones quedan auditadas.

**Donde queda auditado?**
- `pos_turnos.fondo_inicial` — persiste en BD
- `pos_audit_log` — evento `turno_opened` con actor, monto, terminal

**Como afecta el corte final?**
El corte calcula:
```
Efectivo esperado = fondo_inicial + ventas_efectivo + depositos - retiros - propinas_no_efectivo
Diferencia = declarado - esperado
```
Sin fondo_inicial, la formula esta incompleta. Con este cambio, se completa.

### Schema

```sql
-- pos_turnos ya existe, agregar/verificar estos campos:
pos_turnos (
  id TEXT PK,
  client_id TEXT DEFAULT 'amalay',
  terminal_id TEXT,           -- identifica la terminal
  cajero TEXT,                -- quien abrio
  fondo_inicial NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'abierto',  -- 'abierto' | 'cerrado'
  efectivo_declarado NUMERIC,     -- se llena al cerrar (P0-3)
  efectivo_esperado NUMERIC,      -- se calcula al cerrar
  diferencia NUMERIC,             -- declarado - esperado
  notas_cierre TEXT,              -- notas del cajero al cerrar
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT                  -- quien cerro
)
```

---

## P0-2 — Cerrar Turno

### Objetivo

El cajero/gerente cierra formalmente el turno al final del dia o al cambiar
de turno. Esto persiste los totales y marca el turno como cerrado.

### Flujo completo

```
1. Gerente va a /pos/corte
2. Ingresa PIN de gerente (ya existe este gate)
3. Ve el resumen del turno (ya existe)
4. Sube hasta la seccion de arqueo
5. Declara efectivo en caja (campo numerico)
6. Sistema calcula: esperado vs declarado → diferencia
7. Boton: "Cerrar Turno"
8. Modal de confirmacion:
   "Vas a cerrar el turno de [cajero].
    Efectivo declarado: $X,XXX.XX
    Diferencia: +$XX.XX (sobrante) / -$XX.XX (faltante) / $0 (cuadra)
    Esta accion no se puede deshacer."
   [Campo opcional: notas de cierre]
   [Cancelar] [Cerrar Turno]
9. Al confirmar:
   - UPDATE pos_turnos SET status='cerrado', efectivo_declarado, efectivo_esperado,
     diferencia, notas_cierre, closed_at=NOW(), closed_by
   - Audit log: turno_closed {fondo, ventas, retiros, depositos, esperado,
     declarado, diferencia, notas}
   - Imprimir corte (si bridge disponible)
   - Mostrar toast: "Turno cerrado. Diferencia: $X"
   - Redirigir a /pos/turno con estado "turno cerrado" y CTA "Abrir nuevo turno"
```

### Validaciones

| Condicion | Que pasa |
|---|---|
| Hay mesas abiertas | BLOQUEA. "Hay X mesas abiertas. Cierra todas las mesas antes de cerrar turno." Override: PIN gerente + razon auditada → permite cerrar con mesas abiertas (audit log: `turno_closed_with_open_tables` {mesas, razon, gerente}) |
| No hay turno abierto | Boton deshabilitado. "No hay turno abierto." |
| Efectivo no declarado | Boton deshabilitado. "Declara el efectivo antes de cerrar." |
| Usuario sin permiso | Solo admin/gerente con `cierre_dia_operaciones` |

### Preguntas respondidas

**Que condiciones impiden cerrar?**
Dos condiciones bloquean:
1. No haber declarado el efectivo
2. Mesas abiertas — BLOQUEA por default. Override con PIN gerente + razon
   auditada (ej: "turno noche, mesas pasan al siguiente turno").

**Puede haber mesas abiertas?**
No por default — bloquea cierre. Override con PIN gerente + razon auditada.
Las ordenes abiertas que pasan al siguiente turno se cobran con el
`turno_id` activo en el momento del cobro (turno nuevo).

**Puede haber pagos pendientes?**
Si. Los pagos pendientes (delivery, CxC) se muestran como warning pero
no bloquean el cierre.

**Que se imprime?**
Corte completo: KPIs, desglose financiero, metodos de pago, ventas por
mesero, movimientos de caja, arqueo con diferencia. Mismo formato que
ya existe en /pos/corte pero como ticket impreso.

**Que queda bloqueado despues del cierre?**
La terminal muestra pantalla de "turno cerrado" con resumen y boton
"Abrir nuevo turno". No redirige a login — el gerente puede querer
revisar el resumen o abrir turno nuevo inmediatamente. Las ordenes del
turno cerrado no se pueden modificar (reabrir con PIN de gerente sigue
funcionando pero la orden reabierta se asigna al turno NUEVO).

**Se puede reabrir un turno?**
NO. Si el gerente necesita corregir algo:
1. Reabrir la orden especifica (ya existe con PIN)
2. Crear un turno nuevo
3. Hacer la correccion en el turno nuevo
Todo queda auditado.

**Quien tiene permiso?**
Roles con `cierre_dia_operaciones`: admin, gerente. Cajero NO puede
cerrar turno solo.

---

## P0-3 — Persistencia del Arqueo

### Objetivo

El monto declarado por el cajero se guarda en la BD inmediatamente,
no solo en el estado local del componente. Sobrevive refresh, cambio
de dispositivo, y caida del sistema.

### Flujo completo

```
1. Gerente esta en /pos/corte
2. Escribe monto en campo "Efectivo en caja"
3. Al perder foco (onBlur), al presionar Enter, O al click en "Guardar arqueo":
   - PATCH pos_turnos SET efectivo_declarado = $monto WHERE id = $turno_id
   - Recalcular diferencia localmente
   - Mostrar diferencia en tiempo real (verde=cuadra, ambar=sobrante, rojo=faltante)
   - Toast: "Arqueo guardado"
   - Boton explicito "Guardar arqueo" siempre visible junto al campo
4. Si recarga la pagina:
   - El campo se llena con el valor de pos_turnos.efectivo_declarado
   - La diferencia se recalcula
5. Si cambia de dispositivo:
   - Mismo comportamiento — lee de Supabase
```

### Preguntas respondidas

**Cuando se guarda?**
Al perder foco del campo (onBlur) o al presionar Enter. NO en cada
keystroke (evita spam a Supabase). Tambien se guarda al cerrar turno.

**Se puede modificar?**
Si, mientras el turno este abierto. Cada modificacion se guarda en
Supabase. Al cerrar turno, el ultimo valor es el definitivo.
El audit log registra el valor al cierre, no cada cambio intermedio.

**Quien puede modificar?**
Solo quien tiene acceso al corte (admin, gerente). El corte ya tiene
gate de PIN.

**Que pasa si recargan la pagina?**
El campo se llena con `turno.efectivo_declarado` de Supabase. No se
pierde nada.

**Que pasa si cambia de dispositivo?**
Mismo comportamiento. Supabase es la fuente de verdad.

**Como se calcula la diferencia?**
```
efectivo_esperado =
    fondo_inicial
  + sum(pagos WHERE metodo='Efectivo' AND turno_id=turno)
  + sum(depositos WHERE turno_id=turno)
  - sum(retiros WHERE turno_id=turno)
  - sum(propinas WHERE metodo!='Efectivo' AND turno_id=turno)

diferencia = efectivo_declarado - efectivo_esperado
```

**Donde queda auditado?**
- `pos_turnos.efectivo_declarado` — valor persistido
- `pos_turnos.diferencia` — diferencia al cierre
- `pos_audit_log` — evento `turno_closed` con todos los valores

---

## Compatibilidad con arquitectura futura

| Principio | Como se cumple |
|---|---|
| Auditado | Eventos `turno_opened` y `turno_closed` en audit log |
| Sobrevive refresh | Todo en Supabase, nada en localStorage |
| Multi-device | `pos_turnos` es la fuente de verdad, no el estado local |
| Compatible con Realtime | Cuando agreguemos Realtime, los cambios en `pos_turnos` se propagaran a todas las terminales |
| Compatible con normalizacion | `pos_turnos` ya es una tabla separada, no un JSON blob |
| Compatible con event sourcing | Los eventos `turno_opened`/`turno_closed` son eventos naturales |

---

## Implementacion

### Orden de implementacion

1. Verificar/ajustar schema de `pos_turnos` (campos nuevos si faltan)
2. Implementar modal "Abrir Turno" en layout.tsx (se muestra al detectar
   que no hay turno abierto)
3. Implementar persistencia de arqueo en corte/page.tsx (onBlur → PATCH)
4. Implementar boton "Cerrar Turno" en corte/page.tsx
5. Conectar todo: abrir → operar → declarar → cerrar → login

### Archivos que se modifican

- `dashboard-app/src/app/pos/layout.tsx` — detectar turno, mostrar modal de apertura
- `dashboard-app/src/app/pos/corte/page.tsx` — persistir arqueo, boton cerrar
- `dashboard-app/src/lib/pos-data.ts` — funciones createTurno, closeTurno, updateArqueo

### Tiempo estimado

- Schema + funciones de datos: 1 hora
- Modal abrir turno: 2 horas
- Persistencia arqueo: 1 hora
- Cerrar turno: 2 horas
- Testing: 2 horas
- **Total: 8 horas (~1 dia)**

---

> Este ADR cubre los 3 P0 como un flujo unificado porque estan
> intrinsecamente conectados: abrir → operar → declarar → cerrar.
> No tiene sentido implementarlos por separado.
>
> Pendiente: aprobacion del founder antes de implementar.

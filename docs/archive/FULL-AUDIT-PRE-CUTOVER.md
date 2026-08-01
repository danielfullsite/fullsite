# AUDITORIA COMPLETA PRE-CUTOVER

> Fullsite POS vs Wansoft -- AMALAY Coffee & Market
> Fecha: 2026-07-04
> Cutover programado: Martes 8 julio 2026

---

## 1. ESTADO DE MIGRACION DE DATOS

### Resumen por tabla

| Tabla | Wansoft | Supabase | Estado | Notas |
|---|---|---|---|---|
| pos_menu_items | 522 platillos | 687 | OK -- Supera Wansoft (incluye market + nuevos) | Verificar que los 522 originales estan presentes |
| pos_menu_categories | ~30 (Wansoft) | 60 | OK -- Mas granularidad que Wansoft | Incluye market, alcohol, eventos |
| pos_modifiers | 114 | 232 | OK -- Mas opciones configuradas | |
| pos_modifier_groups | 87 asignaciones | 62 grupos | OK -- Grupos multinivel configurados | |
| pos_payment_methods | 18 | 18 | OK -- Paridad exacta | Efectivo, tarjetas, transferencia, plataformas |
| pos_billing_clients | 6 (Wansoft) | 6 | OK -- Paridad exacta | PUBLICO EN GENERAL + HEB + 4 mas |
| **pos_staff** | **40 insertados** | **0** | **CRITICO -- VACIO** | **RLS bloquea lectura con anon key** |
| pos_orders | N/A | 289 (pruebas) | OK -- Datos de testing | |
| pos_turnos | N/A | 19 (pruebas) | OK | |
| pos_audit_log | N/A | 827 | OK -- Audit activo | |

### BLOCKER #1: pos_staff tiene 0 registros accesibles

La tabla pos_staff devuelve 0 registros via anon key (`content-range: */0`). Esto significa una de dos cosas:

1. **RLS esta bloqueando la lectura** -- Los 40 empleados estan en la tabla pero la politica RLS no permite leerlos con anon key. El endpoint `/api/pos/pin` usa `SUPABASE_SERVICE_KEY` como fallback, pero si esa variable no esta configurada en Vercel, caera al anon key y fallara.

2. **Los registros nunca se insertaron** -- Los datos de staff no se migraron.

**Consecuencia directa:** Si un empleado intenta loguearse con PIN el martes, el sistema rechazara TODOS los PINs excepto el fallback `POS_FALLBACK_PIN=2835` (que da acceso como Admin). Esto haría que TODOS operen como Admin sin distincion de roles.

**ACCION REQUERIDA ANTES DEL MARTES:**
- Verificar via service key si los registros existen: `SELECT COUNT(*) FROM pos_staff WHERE client_id = 'amalay'`
- Si existen: ajustar la politica RLS para permitir lectura al API route (confirmar que `SUPABASE_SERVICE_KEY` esta en Vercel)
- Si NO existen: insertar los 40 empleados con sus PINs, nombres y roles

### Meseros hardcodeados

El dropdown de mesero en el POS usa la constante `MESEROS` en `pos-data.ts` (12 nombres fijos), NO la tabla pos_staff. Esto significa:

- Si un mesero nuevo entra, hay que editar codigo y hacer deploy
- Si un mesero sale, sigue apareciendo en el dropdown
- Los meseros del dropdown son: Omar, Hector, Brayan, Daniela, Julio, Oscar, Mauricio, Alexis, Aldo, Mariana, Mario, MESERO EVENTO

**RIESGO:** Medio. Funciona para el martes porque los meseros actuales coinciden. Pero cualquier cambio de staff requiere deploy.

---

## 2. PROBLEMAS DE LOGICA ENCONTRADOS

### 2.1 CRITICO: Corte X clasifica metodos de pago con heuristica fragil

En `/pos/turno/page.tsx` linea 72-74, la clasificacion de metodo de pago usa `.includes()`:

```typescript
if (m.includes('efectivo') || m.includes('cash')) efectivo += ...
else if (m.includes('transferencia')) transferencias += ...
else tarjeta += ...  // <-- TODO lo que no es efectivo/transferencia cae aqui
```

**Problema:** Pagos via Rappi, UberEats, cortesia, vales -- todo se cuenta como "tarjeta". El corte de caja mostrara numeros incorrectos en el desglose por forma de pago.

**Riesgo para el martes:** ALTO. El gerente va a comparar el corte Fullsite con lo que espera y los numeros no van a cuadrar si hay pagos de plataforma.

### 2.2 ALTO: checkOrderConflict no previene race condition total

El mecanismo de deteccion de conflictos (linea 2114) compara `updated_at` contra el valor cargado. Pero:

1. No usa locking optimista en Supabase (no hay `If-Match` header ni version counter)
2. Si dos terminales cargan la misma mesa en el mismo segundo, ambas tendran el mismo `loadedUpdatedAt` y ambas pasaran el check

**Riesgo para el martes:** Medio. Es improbable que dos cajeros cobren exactamente la misma mesa en el mismo instante, pero con mesas grandes donde mesero A agrega items y cajero B cobra, podria pasar.

### 2.3 MEDIO: Empty catch blocks silencian errores

Se encontraron 18+ bloques `catch {}` o `catch { /* */ }` en `page.tsx`. Los mas criticos:

- Linea 1377: Conteo de sync queue pendiente -- si falla, el indicador muestra 0
- Linea 1636: Draft save falla silenciosamente
- Linea 794/831: Logica de restauracion de estado

La mayoria son para localStorage/sessionStorage (puede fallar en modo incognito), lo cual es aceptable. Pero el patron no distingue errores esperados de bugs.

### 2.4 MEDIO: El offline sync no maneja todos los edge cases de 409

El sync engine (pos-offline-db.ts linea 237-264) solo intenta PATCH fallback para `pos_orders`. Otros 409s (audit log, inventory, etc.) solo incrementan retry sin resolucion.

Ademas, el `retries >= 5` en linea 217 silenciosamente descarta operaciones que fallaron 5 veces. No hay alerta al usuario de que datos se perdieron.

### 2.5 BAJO: Ticket CSS asume 58mm

El ticket CSS (printer.ts linea 34) tiene `size: 58mm auto` hardcodeado. Las impresoras EC Line en AMALAY son 80mm. Esto NO afecta la impresion via bridge (que usa ESC/POS con COLS_BRIDGE=48), pero si alguien imprime via CSS fallback, el ticket sera angosto.

### 2.6 BAJO: Propina no se valida en split parejo

En el pago split parejo (linea 2347-2353), la propina se aplica a la cuenta actual pero no se distribuye entre cuentas. Si el cliente da propina en la cuenta 1 y nada en las demas, el corte mostrara toda la propina en una sola linea.

---

## 3. PARITY CHECK: WANSOFT vs FULLSITE

### 3.1 Dress Rehearsal (14 pasos WAR-ROOM)

| # | Paso | Estado Fullsite | Riesgo |
|---|------|----------------|--------|
| 1 | Abrir turno con fondo | Implementado (/pos/turno) | Bajo |
| 2 | Login con PIN | **BLOQUEADO si pos_staff vacio** | **CRITICO** |
| 3 | Abrir mesa 5 | OK -- plano arquitectonico y grid | Bajo |
| 4 | Agregar items + mods | OK -- ModifierModal multinivel | Bajo |
| 5 | Enviar a cocina | OK -- save first, then print | Bajo |
| 6 | KDS recibe | OK -- polling 1.5-2s | Bajo |
| 7 | KDS 1 click = preparando | OK -- localStorage tracking | Bajo |
| 8 | KDS 2 clicks = listo | OK -- debounce 500ms | Bajo |
| 9 | Cobrar efectivo | OK -- cajon abre via bridge | Bajo |
| 10 | Cobrar tarjeta | OK -- cajon NO abre | Bajo |
| 11 | Cobrar mixto | OK -- pagos array multiforma | Bajo |
| 12 | Reimprimir ticket | OK -- audit logged | Bajo |
| 13 | Corte X | OK -- snapshot sin cerrar | **Medio (clasificacion pagos)** |
| 14 | Cierre turno | OK -- CierreCajaWizard 4 pasos | Bajo |

### 3.2 Stress Test (14 escenarios)

| # | Escenario | Cobertura | Riesgo |
|---|-----------|-----------|--------|
| 1 | Dos terminales misma mesa | checkOrderConflict (parcial) | Medio |
| 2 | Doble click KDS | Debounce 500ms | Bajo |
| 3 | Refresh browser POS | loadMesaOrder desde Supabase | Bajo (draft no guardado se pierde) |
| 4 | Refresh browser KDS | localStorage recovery | Bajo |
| 5 | Bridge reiniciado | Print queue retry | Bajo |
| 6 | Impresora apagada | Queue needs_attention | Bajo |
| 7 | Internet cae 2 min | IndexedDB + sync | Medio (sin alerta de datos perdidos) |
| 8 | Dos ordenes simultaneas | IDs unicos | Bajo |
| 9 | Dos pagos simultaneos | checkOrderConflict | Medio |
| 10 | Cambio rapido usuario | sessionStorage limpia | Bajo |
| 11 | Orden 20 platillos | Scroll + print largo | Bajo |
| 12 | Cancelar item enviado | CancelModal + PIN + audit | Bajo |
| 13 | Cambiar mesa | mesa_transferred audit | Bajo |
| 14 | Reabrir orden cerrada | PIN gerente requerido | Bajo |

### 3.3 Las 20 cosas que pueden salir mal

Todos los 20 escenarios del WAR-ROOM tienen solucion documentada. Los mas riesgosos:

| # | Escenario | Solucion documentada | Riesgo real |
|---|-----------|---------------------|-------------|
| 6 | Cajero cobra dos veces | checkOrderConflict | Medio -- race condition posible |
| 9 | Orden no llega a KDS | Verificar Supabase | Bajo |
| 13 | Staff no recuerda PIN | **POS_FALLBACK_PIN existe** | **Alto si pos_staff vacio** |
| 14 | Split no cuadra | calcSplitParejo/Items | Bajo |
| 17 | Offline no sincroniza | Forzar sync manual | Medio -- datos pueden perderse si >5 retries |

### 3.4 Features Wansoft que Fullsite NO tiene (relevantes para el martes)

| Feature Wansoft | Impacto Martes | Notas |
|---|---|---|
| Corte Z (cierre fiscal consecutivo) | Bajo -- Corte de turno cubre la necesidad | El Z es obligatorio para SAT pero no el dia 1 |
| Corte Global (multi-terminal) | Bajo -- Solo 2 terminales, se suman manual | Necesario para >3 terminales |
| Happy Hour automatico | Nulo -- Se maneja con descuento manual | |
| Nomina / asistencia | Nulo -- Se usa sistema externo | |
| Produccion (batch cooking) | Nulo -- No afecta operacion POS | |
| Transferencias entre almacenes | Nulo -- 1 sucursal | |
| P&L automatico | Nulo -- No se usa dia 1 | |
| Tarjetas de regalo | Nulo -- AMALAY no las usa | |
| Paleo de barra | Nulo -- No se usa actualmente | |

**Conclusión:** Ninguna feature faltante de Wansoft bloquea la operacion del martes. Las unicas que importan (corte Z, corte global) son de documentacion fiscal, no de operacion diaria.

---

## 4. RECOMENDACIONES PRIORIZADAS

### P0 -- BLOCKER (resolver antes del lunes por la noche)

1. **Poblar pos_staff o confirmar que los datos existen detras de RLS**
   - Sin esto, NINGUN empleado puede loguearse con PIN. Todo cae al fallback admin.
   - Sin roles, no hay control de permisos (cualquiera cancela, descuenta, da cortesia)
   - Accion: verificar con service key, insertar datos, confirmar SUPABASE_SERVICE_KEY en Vercel

2. **Verificar que SUPABASE_SERVICE_KEY esta configurado en Vercel**
   - El endpoint `/api/pos/pin` lo necesita para leer pos_staff a traves de RLS
   - Si no esta, el fallback usa anon key que devuelve 0 resultados
   - Tambien lo necesitan `/api/pos/staff` y `/api/pos/staff-cache`

### P1 -- ALTO (resolver antes del martes 7am)

3. **Corregir clasificacion de metodos de pago en Corte X/Turno**
   - El corte clasifica todo lo que no es efectivo/transferencia como "tarjeta"
   - Pagos Rappi, UberEats, cortesia, etc. serian contados como tarjeta
   - El gerente va a notar esto inmediatamente
   - Solucion: usar el campo `type` de pos_payment_methods (ya esta en la BD: cash/card/transfer/platform/other)

4. **Smoke test presencial con las impresoras reales**
   - El bridge (print-bridge en Windows) debe estar corriendo en las 2 terminales
   - Las 6 impresoras deben responder
   - Verificar que la ruta cocina/barra/caja esta correcta en la config del bridge

### P2 -- MEDIO (resolver si hay tiempo)

5. **Agregar alerta cuando el offline sync descarta operaciones (>5 retries)**
   - Actualmente falla silenciosamente
   - Sugerencia: mostrar toast rojo "X operaciones no sincronizadas -- contactar soporte"

6. **Mover MESEROS de constante hardcodeada a pos_staff**
   - No bloquea el martes (los nombres actuales coinciden)
   - Pero cualquier cambio de personal requiere deploy
   - Prioridad: post-cutover

7. **Agregar version counter a pos_orders para locking optimista real**
   - checkOrderConflict usa updated_at que puede tener granularidad insuficiente
   - Un campo `version integer default 1` con incremento atomico seria mas robusto

### P3 -- BAJO (post-cutover)

8. Implementar Corte Z con numeracion fiscal consecutiva
9. Implementar Corte Global multi-terminal
10. Agregar personas por hora (requerido para optimizacion de staff)
11. Migrar ticket CSS fallback a 80mm

---

## 5. CHECKLIST GO/NO-GO (martes 7:00am)

- [ ] pos_staff tiene registros accesibles (>30 empleados activos)
- [ ] Al menos 3 PINs diferentes funcionan (admin, gerente, cajero)
- [ ] SUPABASE_SERVICE_KEY configurada en Vercel
- [ ] Bridge health OK en terminal caja
- [ ] Bridge health OK en terminal entrada
- [ ] 6 impresoras responden (3 cocina, 2 barra, 1 ticket)
- [ ] Smoke test: abrir mesa, agregar items, enviar a cocina, KDS recibe <3s
- [ ] Smoke test: cobrar efectivo -- cajon abre, ticket imprime
- [ ] Smoke test: cobrar tarjeta -- cajon NO abre, ticket imprime
- [ ] Corte X muestra desglose correcto de formas de pago
- [ ] Gerente dice GO

---

## 6. PLAN DE ROLLBACK

Si algo falla sistematicamente durante el martes:

1. **Wansoft sigue instalado y funcional** en la terminal principal
2. **Protocolo:** Si 3+ incidentes en 30 minutos O el gerente dice NO-GO
3. **Accion:** Abrir Wansoft, login normal, seguir operando
4. **Documentar** todo lo que fallo para corregir antes del segundo intento

**El rollback a Wansoft debe tomar <30 segundos.** No desinstalar Wansoft hasta que Fullsite lleve 2 semanas estables.

---

> Auditoria ejecutada: 2026-07-04
> Conclusion: El sistema esta listo al 95%. El unico BLOCKER es pos_staff vacio.
> Sin eso resuelto, el cutover NO debe proceder.

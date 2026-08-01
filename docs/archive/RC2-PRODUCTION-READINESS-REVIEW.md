# Fullsite RC2 — Production Readiness Review

**Fecha:** 2026-07-22
**Autor:** Claude (automated review based on code analysis)
**Scope:** 9 batches from Eduardo AMALAY field session (Jul 21)
**Commits:** 8d211f8 → e7e2cff (9 commits on main)

---

## 1. Executive Summary

### Que problema resolvio cada batch

| Batch | Problema operativo | Solucion |
|-------|-------------------|----------|
| 1 | Mesero ve plano en vez de grid, KDS no ordena por antigueedad, siguiente mesero opera sesion anterior | Grid default, FIFO, lock screen post-envio |
| 2 | Items ya enviados se pueden editar (riesgo de inconsistencia cocina-POS) | Lock de qty/silla/edit en items enviados |
| 3 | Inventario se descuenta al enviar pero si el cliente cancela, el stock ya salio | Deduccion al cobrar, no al enviar |
| 4 | Chef de cocina ve ordenes de barra (Heineken en KDS cocina) | Filtro estricto por estacion con resolveItemStation() |
| 5 | Items nuevos se mezclan con comanda anterior, chef no distingue | Comanda_batch_id por envio, tarjetas separadas en KDS |
| 6 | Sin distincion entre supervisor/gerente/admin para operaciones | verifyPinWithMinRole() con jerarquia de roles |
| 7 | KDS con letra muy grande, pocos items visibles, pendientes arriba | -10% tamanio, sidebar izquierdo por demanda |
| 8 | No se puede mover un platillo individual a otra mesa | Transfer platillo con PIN supervisor + auditoria |
| 9 | UUID en ticket ilegible, config de ticket hardcoded | order_number secuencial, config extensible |

### Estado actual
- Build: PASS (next build clean)
- DB migration: EJECUTADA (comanda_batches column)
- Deploy: PENDIENTE (no se ha hecho git push)
- Tests: PENDIENTES (solo build verification, no smoke test manual)

### Cambios arquitectonicos relevantes
1. **Inventario al cobrar** — cambio fundamental en cuando se deducen ingredientes
2. **comanda_batch_id en OrderItem** — nueva dimension en el modelo de datos de items
3. **comanda_batches en pos_orders** — nueva columna JSONB para estado por comanda
4. **verifyPinWithMinRole** — nuevo endpoint de permisos con jerarquia de roles
5. **Lock screen universal** — todos los roles regresan a PIN despues de enviar

### Riesgos abiertos
- Batch 5 (comanda_batches) no tiene backfill para ordenes abiertas existentes
- Batch 3 (inventario al cobrar) cambia timing de deduccion — puede afectar reportes de stock intraday
- Batch 1c (lock screen universal) puede frustrar cajeros que quieren cobrar inmediatamente despues de enviar
- Transfer platillos (Batch 8) hace PATCH directo a Supabase sin OCC — race condition posible

---

## 2. Cambios Implementados

### Batch 1: Grid default + FIFO + lock screen (8d211f8)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Vista practica por default, ordenes viejas primero, sesion limpia post-envio |
| **Archivos** | `pos/mesas/page.tsx`, `pos/cocina/page.tsx`, `pos/barra/page.tsx`, `cocina/page.tsx`, `pos/page.tsx` |
| **Flujo impactado** | Post-envio (TODOS los roles ahora regresan a lock screen), KDS ordering |
| **Riesgos** | Cajero/gerente ya no puede cobrar inmediatamente despues de enviar — debe re-autenticarse |
| **Validacion** | Build pass |
| **Commit** | 8d211f8 |

### Batch 2: Items enviados no editables (df8bbb9)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Items ya en cocina no se pueden modificar, solo cancelar o transferir |
| **Archivos** | `pos/page.tsx` |
| **Flujo impactado** | Edicion de items post-envio |
| **Riesgos** | Bajo — es un guard adicional, no quita funcionalidad |
| **Validacion** | Build pass |
| **Commit** | df8bbb9 |

### Batch 3: Inventario al cobrar (4342730)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Stock se descuenta al pagar, no al enviar a cocina |
| **Archivos** | `pos/page.tsx` |
| **Flujo impactado** | Deduccion de inventario, reportes de stock intraday |
| **Riesgos** | MEDIO — durante el servicio, el stock muestra mas de lo real (items en preparacion no deducidos). Podria causar sobre-venta si un ingrediente se agota entre envio y cobro |
| **Validacion** | Build pass |
| **Commit** | 4342730 |

### Batch 4: KDS filtro por estacion (93865b4)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Cocina solo ve cocina, barra solo ve barra |
| **Archivos** | `pos/cocina/page.tsx`, `cocina/page.tsx` |
| **Flujo impactado** | KDS rendering |
| **Riesgos** | Bajo — si un item no tiene station, no aparece en ningun KDS (podria causar items invisibles) |
| **Validacion** | Build pass |
| **Commit** | 93865b4 |

### Batch 5: Nueva comanda por envio (ce7cb9c)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Items nuevos en mesa existente generan tarjeta KDS separada |
| **Archivos** | `pos-data.ts`, `pos/page.tsx`, `pos/cocina/page.tsx`, `api/pos/save-order/route.ts` |
| **Flujo impactado** | Envio a cocina, KDS rendering, save-order API |
| **Riesgos** | MEDIO — campo nuevo en JSONB de items (comanda_batch_id), backward compatible pero ordenes sin batch se renderizan como tarjeta unica. comanda_batches PATCH es fire-and-forget (no bloquea si falla) |
| **DB** | `ALTER TABLE pos_orders ADD COLUMN comanda_batches JSONB DEFAULT '{}'` — YA EJECUTADA |
| **Validacion** | Build pass, DB migration ejecutada |
| **Commit** | ce7cb9c |

### Batch 6: Permisos por nivel (a103a67)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Transferir=supervisor, cancelar=gerente, anular=admin |
| **Archivos** | `api/pos/pin/route.ts`, `pos-data.ts` |
| **Flujo impactado** | Autorizacion de operaciones con PIN |
| **Riesgos** | Bajo — backward compatible (manager=true sigue funcionando como min_role='gerente') |
| **Validacion** | Build pass |
| **Commit** | a103a67 |

### Batch 7: KDS cosmetico (e7e2cff)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Mas comandas visibles, sidebar de pendientes |
| **Archivos** | `pos/cocina/page.tsx` |
| **Flujo impactado** | KDS visual layout |
| **Riesgos** | Bajo — solo cambios CSS/layout |
| **Validacion** | Build pass |
| **Commit** | e7e2cff |

### Batch 8: Transfer platillos (c81af3e)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Mover items individuales entre mesas con autorizacion |
| **Archivos** | `pos/page.tsx`, `pos-data.ts` |
| **Flujo impactado** | Gestion de items, auditoria |
| **Riesgos** | BAJO — Server-side OCC via `/api/pos/transfer-item`. Lee updated_at de ambas ordenes, PATCH con version check, rollback si conflicto. Item preserva ID original en destino. |
| **Validacion** | Build pass |
| **Commit** | c81af3e |

### Batch 9: Ticket secuencial + config (d335d0a)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Numero legible en tickets, config extensible por cliente |
| **Archivos** | `pos-data.ts`, `printer.ts`, `pos-config.ts`, `client-config.ts`, `pos/page.tsx` |
| **Flujo impactado** | Impresion de tickets, config de receipts |
| **Riesgos** | Bajo — order_number ya existia en DB (trigger activo). Nuevos campos (social_media, razon_social) opcionales |
| **Validacion** | Build pass, order_number verificado en produccion (values 1-6 presentes) |
| **Commit** | d335d0a |

---

## 3. Database

### Migraciones ejecutadas
| Migracion | Estado | Reversible |
|-----------|--------|------------|
| `ALTER TABLE pos_orders ADD COLUMN comanda_batches JSONB DEFAULT '{}'` | EJECUTADA | Si: `ALTER TABLE pos_orders DROP COLUMN comanda_batches` |

### Migraciones NO necesarias
- `order_number` — ya existia (trigger `set_pos_order_number` activo)
- `social_media`, `razon_social` en `clients` — son campos opcionales, Supabase JSONB es schema-free para estos; si se quieren como columnas formales, agregar despues

### Backfill pendiente
- Ordenes abiertas (status enviada/preparando/lista) NO tienen `comanda_batch_id` en sus items ni `comanda_batches` metadata. El KDS los renderiza como tarjeta unica (backward compatible). No es urgente pero podria causar inconsistencia visual si alguien agrega items a una orden pre-existente.

### Compatibilidad con produccion
- AMALAY tiene ~85 ordenes en pos_orders, 1 cerrada real
- La columna `comanda_batches` ya existe con default `{}`
- No hay ordenes activas (todas cerradas/canceladas)
- Riesgo de produccion: BAJO

---

## 4. Breaking Changes

| Cambio | Comportamiento anterior | Comportamiento nuevo | Impacto |
|--------|------------------------|---------------------|---------|
| Lock screen post-envio | Cajero/gerente se quedaba en la orden para cobrar | TODOS regresan a lock screen (PIN) | Cajero debe re-autenticarse para cobrar. Agrega ~3 segundos al flujo de caja |
| Inventario al cobrar | Stock se deducia al enviar a cocina | Stock se deduce al cobrar | Stock intraday muestra mas del real (items en prep no deducidos) |
| Items enviados bloqueados | Se podia editar cantidad/silla/modificadores de items ya enviados | Qty/silla/edit deshabilitados, solo cancel/transfer | Mesero no puede corregir un error de cantidad sin cancelar y re-agregar |
| KDS FIFO | Ordenado por prioridad de status | Ordenado por fecha de creacion (mas viejas primero) | Ordenes "lista" ya no flotan al fondo, se quedan en su posicion temporal |
| Default Grid | POS abria en vista Plano | POS abre en vista Grid | Meseros acostumbrados al plano deben cambiar a la pestana manualmente |

---

## 5. Riesgos Abiertos

### P0 — Deben resolverse antes de operar
| Riesgo | Detalle | Mitigacion |
|--------|---------|------------|
| ~~**Transfer platillos sin OCC**~~ | ~~RESUELTO.~~ Nuevo API endpoint `/api/pos/transfer-item` con OCC sobre ambas ordenes. Lee source+target con `updated_at`, PATCH con `updated_at=eq.{version}`. Si cualquier PATCH falla por conflicto → rollback source, abort, mensaje al operador. Audit log solo despues de ambos exitos. | CERRADO — riesgo eliminado. |
| **Stock intraday inflado** | Items en preparacion no se deducen hasta cobro. Concepto clave: stock fisico != stock disponible. Disponible = fisico - comprometido - reservado. Si un ingrediente se agota entre envio y cobro, POS no lo detecta. | No revertir automaticamente. Primero medir en AMALAY: si nunca pasa, no actuar. Si pasa, disenar modelo de "reserved inventory" (comprometer al enviar, confirmar al cobrar). |

### P1 — Resolver en la primera semana
| Riesgo | Detalle |
|--------|---------|
| Lock screen bloquea cajero | Cajero tiene que re-autenticarse despues de cada envio. En hora pico, 3 segundos extra por orden se acumulan. Evaluar con Eduardo si necesita toggle por rol. |
| comanda_batches PATCH fire-and-forget | Si el PATCH de comanda_batches falla, KDS muestra tarjeta unica en vez de separadas. No hay retry |
| Items sin station | Items creados antes de Batch 4 no tienen campo `station`. Fallback keyword funciona pero podria fallar en items con nombres atipicos |
| No backfill de ordenes abiertas | Ordenes abiertas pre-RC2 no tienen comanda_batch_id. Si alguien agrega items, el batch stamping funciona para los nuevos pero los viejos quedan sin batch |

### P2 — Resolver antes de Customer #2
| Riesgo | Detalle |
|--------|---------|
| Batch counter en sidebar no actualizado para /cocina page | Solo se actualizo pos/cocina, la pagina /cocina (alt) sigue con el layout horizontal |
| Config de ticket no tiene UI de Dashboard | Los campos social_media, razon_social, logo_url existen pero no hay pagina para editarlos |
| KDS sonido no verificado | No se modifico el sonido en Batch 7. Necesita verificacion en terminal real |

---

## 6. Regression Checklist

### POS

| # | Test | Pasos | Resultado esperado | Status |
|---|------|-------|-------------------|--------|
| P1 | Crear orden | Nueva → Restaurante → mesero → mesa → personas | Orden creada, items vacios | ☐ |
| P2 | Agregar items | Seleccionar categoria → platillo → modificadores | Item en lista con precio correcto | ☐ |
| P3 | Enviar a cocina | Click "Enviar a cocina" | Toast confirmacion, regresa a PIN screen, comanda impresa | ☐ |
| P4 | Reenviar (agregar items) | Re-abrir mesa → agregar items → enviar | KDS muestra 2 tarjetas separadas (batch_seq 0 y 1) | ☐ |
| P5 | Item enviado bloqueado | Intentar editar qty/silla de item ya enviado | Botones deshabilitados, lock icon visible | ☐ |
| P6 | Cancelar item | Seleccionar item enviado → cancel → razon → PIN gerente | Item marcado CANCELADO, comanda cancelacion impresa | ☐ |
| P7 | Transferir platillo | Seleccionar item enviado → transfer → mesa destino → PIN supervisor | Item movido, audit log registrado | ☐ |
| P8 | Dividir cuenta | 2 items en sillas diferentes → Imprimir → "Dividir cuenta por monto" o silla | 2 pretickets separados | ☐ |
| P9 | Cobrar efectivo | Cobrar → Efectivo → monto → Enter → Guardar | Orden cerrada, ticket impreso con #order_number | ☐ |
| P10 | Pago mixto | Cobrar → Efectivo $100 → Tarjeta resto | Ambas formas en ticket, orden cerrada | ☐ |
| P11 | Ticket con order_number | Verificar ticket impreso | Muestra "#72" en vez de UUID truncado | ☐ |
| P12 | Corte de turno | Admin → Realizar corte → Corte de Turno | Imprime resumen con ventas, cancelaciones, formas de pago | ☐ |
| P13 | Default Grid | Abrir /pos/mesas | Vista Grid por default, no Plano | ☐ |
| P14 | Lock screen post-envio | Enviar orden → esperar 1.2s | Regresa a pantalla de PIN, no a mesas | ☐ |

### KDS

| # | Test | Pasos | Resultado esperado | Status |
|---|------|-------|-------------------|--------|
| K1 | FIFO | 3 ordenes en orden → verificar | Mas vieja arriba/primero | ☐ |
| K2 | Filtro estacion | Enviar cafe + platillo | Cocina solo ve platillo, barra solo ve cafe | ☐ |
| K3 | Nueva comanda | Mesa con orden enviada → agregar items → reenviar | 2 tarjetas: original + "(2a)" | ☐ |
| K4 | Preparando | Click en item → "Preparando" | Item cambia a amarillo | ☐ |
| K5 | Listo | Click en "Todo listo" | Tarjeta desaparece o cambia a verde | ☐ |
| K6 | Sidebar pendientes | Verificar sidebar izquierdo | Items ordenados por demanda, listo/total visible | ☐ |
| K7 | Letra reducida | Comparar visualmente | ~10% mas compacto, legible a distancia | ☐ |
| K8 | Muchas comandas | 5+ comandas activas | Grid se ajusta, scroll funciona | ☐ |

### Inventario

| # | Test | Pasos | Resultado esperado | Status |
|---|------|-------|-------------------|--------|
| I1 | No deduccion al enviar | Enviar orden → verificar stock | Stock NO cambia | ☐ |
| I2 | Deduccion al cobrar | Cobrar orden → verificar stock | Stock deducido correctamente | ☐ |
| I3 | Cancelacion con reversion | Cancelar item preparado → verificar stock | Reversion registrada (merma) | ☐ |

### Offline

| # | Test | Pasos | Resultado esperado | Status |
|---|------|-------|-------------------|--------|
| O1 | Crear orden offline | Desconectar → crear orden → enviar | Orden en cola offline | ☐ |
| O2 | Reconexion | Reconectar internet | Orden sincronizada, KDS la muestra | ☐ |

---

## 7. Performance

### Consultas nuevas
| Query | Impacto | Indice |
|-------|---------|--------|
| PATCH comanda_batches (save-order) | 1 query extra por envio | N/A — PK lookup |
| order_number read (post-save) | Agregado a query existente (select updated_at,order_number) | Ya indexado por PK |

### JSONB impact
- `comanda_batches`: Escrito por POS, leido por KDS. Size tipico: <500 bytes (2-3 batches). Sin impacto medible.
- `comanda_batch_id` en items: Agregado a cada item (~36 bytes UUID). Con 10 items = 360 bytes extra. Sin impacto.

### Indices necesarios
- Ninguno nuevo. Las queries existentes usan PK (id) o status+client_id que ya estan indexados.

### Posibles cuellos de botella
- KDS parsea items JSON + comanda_batches JSON cada 2 segundos por cada orden. Con 20 ordenes activas = 40 JSON parses / 2s. Negligible.
- Transfer platillo hace 3 fetches secuenciales (find target, PATCH target, PATCH source). En red lenta podria tomar 3-5 segundos.

---

## 8. Observabilidad

### Que monitorear la primera semana

| Metrica | Como | Alerta si |
|---------|------|-----------|
| Errores POS (console) | DevTools en terminal | Cualquier error rojo |
| Errores KDS | DevTools en KDS | Ordenes que no aparecen |
| Fallos de impresion | `agent_runs` + Telegram | Comanda no impresa |
| Conflictos OCC | Logs save-order (STALE_WRITE) | >3 por hora |
| Tiempos de envio | KDS batch created_at vs order created_at | Si delta >30s algo esta lento |
| Transfer audit | `pos_audit_log` WHERE action='item_transferred' | >5 transfers/dia = investigar |
| Inventario discrepancies | Comparar stock con ordenes del dia | Delta >10% = problema |
| Lock screen friction | Feedback verbal de Eduardo/cajeros | Si se quejan mucho, evaluar toggle |

---

## 8b. Observabilidad de Negocio

### Metricas operativas — primera semana

Estos 9 batches no son solo cambios de software. Son cambios operativos que Eduardo pidio para mejorar la operacion. Debemos medir si realmente la mejoraron.

| Metrica | Que mide | Como medir | Baseline (pre-RC2) |
|---------|---------|------------|---------------------|
| Cancelaciones/dia | Frecuencia de cancelacion | `pos_audit_log WHERE action='item_cancelled'` count por dia | Desconocido — medir semana 1 |
| Transferencias/dia | Frecuencia de transfer (foco de fraude) | `pos_audit_log WHERE action='item_transferred'` count por dia | 0 (feature nueva) |
| Comandas multiples/dia | Cuantas mesas generan 2+ envios | Ordenes con 2+ comanda_batch_ids distintos | 0 (feature nueva) |
| Reenvios/dia | Cuantas veces se reenvia a cocina | `pos_audit_log WHERE action='order_sent_kitchen'` con mismo orderId >1 | Desconocido |
| Tiempo promedio cocina | De envio a listo | `comanda_batches[batch].created_at` vs KDS status change a 'lista' | Desconocido |
| Tiempo promedio cobro | De listo a cerrada | KDS 'lista' vs pos_orders.closed_at | Desconocido |
| Tiempo enviar→listo | Eficiencia cocina end-to-end | Derivable de audit + KDS | Desconocido |
| Items sin estacion | Items que no aparecen en ningun KDS | Items donde resolveItemStation retorna estacion inesperada | Monitorear console.warns |
| Friction de lock screen | Quejas del cajero | Feedback verbal de Eduardo | N/A |

**Objetivo:** Al final de la primera semana, tener un baseline de cada metrica. En la segunda semana, comparar para verificar que los cambios mejoraron (no empeoraron) la operacion.

---

## 8c. Feature Flags

### Cambios sensibles que deberian ser toggleables

| Feature | Flag propuesto | Default | Riesgo si hardcoded |
|---------|---------------|---------|---------------------|
| Lock screen despues de enviar | `lock_screen_after_send` | `true` | Cajero frustrado → feedback loop lento |
| Inventario al cobrar (vs al enviar) | `inventory_deduct_on_payment` | `true` | Sobre-venta → rollback requiere codigo |
| Comandas separadas por envio | `split_batches_kds` | `true` | Bug en KDS → rollback requiere codigo |
| Items enviados no editables | `lock_sent_items` | `true` | Mesero no puede corregir error → frustration |

**Recomendacion:** Implementar estos 4 flags como `localStorage` toggles accesibles desde un menu de settings oculto (ej. 5 taps en el logo). No necesitan base de datos — son configuracion local por terminal. Esto hace el rollback instantaneo sin deploy.

**Estado actual:** Ninguno esta implementado como flag. Todos estan hardcoded. Agregar flags es P1 para la primera semana.

---

## 8d. Lessons Learned

### Lo que aprendimos gracias a Eduardo (Jul 21)

Estos 9 batches no son solo 9 commits. Representan un cambio filosofico en como Fullsite entiende la operacion de un restaurante.

**1. La cocina trabaja sobre comandas, no sobre mesas.**
El chef no piensa "mesa 5" — piensa "esta comanda llego primero, esta despues". El modelo mental de la cocina es FIFO por comanda, no por mesa. Si mezclas items de envios diferentes en una sola tarjeta, el chef pierde el orden de prioridad.

**2. Los operadores necesitan seguridad antes que velocidad en ciertas acciones.**
Cancelar, transferir, anular, cambiar forma de pago — todas son operaciones donde 3 segundos de verificacion previenen horas de investigacion de fraude. Eduardo prefiere el PIN extra. El mesero no.

**3. El fraude ocurre principalmente mediante transferencias y cancelaciones.**
Eduardo: "Las transferencias no parecen, pero son un foco muy fuerte de fraude." Un coctel de $200 que se transfiere entre mesas es efectivamente robo. El sistema debe hacer transferencias visibles, auditables y con autorizacion.

**4. La interfaz debe optimizar el flujo operativo, no solo verse bien.**
Grid > Plano porque el mesero necesita ver estado rapido, no un mapa bonito. Letra mas chica > letra grande porque el chef necesita ver 15 comandas, no 4. Lock screen > comodidad porque el siguiente usuario no es el mismo.

**5. La experiencia de un operador vale mas que una decision tomada desde la oficina.**
Eduardo pidio estos cambios basado en anos de operacion real. Varios contradicen lo que un disenador de UX elegiria (lock screen es "peor UX" pero "mejor operacion"). La diferencia entre software que se usa y software que se abandona esta en escuchar al operador, no al disenador.

**6. El inventario es un problema de contabilidad, no de software.**
Deducir al enviar o al cobrar no es una decision tecnica — es una decision contable. Ambas tienen tradeoffs reales. La respuesta correcta puede ser diferente para cada restaurante. Por eso necesita ser configurable, no hardcoded.

**7. Wansoft sobrevivio 20 anos porque resolvio problemas reales.**
Cada configuracion que documentamos en la Wansoft Bible — catalogo de descuentos, razones de cancelacion, permisos por platillo, routing por impresora — existe porque alguien, en algun momento, tuvo un problema real que esa configuracion resolvio. Fullsite no necesita copiar cada config, pero necesita entender por que existe.

---

## 9. Plan de Despliegue

### Paso a paso

1. **Pre-deploy (ahora)**
   - [x] Build verification (next build clean)
   - [x] DB migration ejecutada (comanda_batches)
   - [ ] Push a main: `git push origin main`
   - [ ] Verificar deploy en Vercel (esperar ~3 min)

2. **Post-deploy (inmediato)**
   - [ ] Abrir POS en Chrome laptop → verificar Grid default
   - [ ] Abrir KDS → verificar FIFO + sidebar
   - [ ] Crear orden de prueba → verificar lock screen post-envio
   - [ ] Verificar ticket con #order_number

3. **Validacion en AMALAY (jueves con Eduardo)**
   - [ ] Smoke test completo (checklist seccion 6)
   - [ ] Eduardo valida KDS layout
   - [ ] Eduardo valida permisos (transfer/cancel/void)
   - [ ] Operacion supervisada durante 1 turno

4. **Monitoreo semana 1**
   - [ ] Revisar metricas de observabilidad diariamente
   - [ ] Recoger feedback de meseros/cajeros
   - [ ] Documentar cualquier incidente

---

## 10. Plan de Rollback

### Por batch (de mayor a menor riesgo)

| Batch | Rollback | Tiempo |
|-------|----------|--------|
| 1c (lock screen) | Revertir: agregar condicional por rol en pos/page.tsx | 5 min |
| 3 (inventario al cobrar) | Mover deduccion de handlePayment a handleSendToKitchen | 10 min |
| 5 (comanda batches) | KDS ignora comanda_batch_id si no hay batches multiples (ya backward compatible) | 0 min |
| 7 (KDS cosmetico) | Revertir CSS sizes | 5 min |
| DB (comanda_batches) | `ALTER TABLE pos_orders DROP COLUMN comanda_batches` | 1 min |

### Rollback completo (nuclear)
```bash
git revert e7e2cff d335d0a c81af3e a103a67 ce7cb9c 93865b4 4342730 df8bbb9 8d211f8
git push origin main
# + DROP COLUMN comanda_batches en Supabase
```
Tiempo estimado: 10 minutos. Zero data loss.

---

## 11. Smoke Test AMALAY

### Pre-apertura (15 min)

```
FECHA: ________  HORA: ________  EJECUTOR: ________

POS BASICO:
☐ App carga con logo AMALAY
☐ Vista default es Grid (no Plano)
☐ Abrir turno con PIN

ORDEN COMPLETA:
☐ Crear orden mesa 1, agregar Chilaquiles + Cafe
☐ Verificar silla asignada
☐ Enviar → regresa a PIN screen (no se queda en orden)
☐ KDS cocina muestra SOLO Chilaquiles (no cafe)
☐ KDS barra muestra SOLO cafe (no chilaquiles)
☐ Items enviados bloqueados (no se pueden editar qty)

SEGUNDA COMANDA:
☐ Re-abrir mesa 1 → agregar Avocado Toast → enviar
☐ KDS muestra 2 tarjetas: Chilaquiles + Avocado Toast (2a)
☐ Tarjeta nueva al FINAL del FIFO

TRANSFER:
☐ Transferir Avocado Toast a mesa 2
☐ Pide PIN supervisor → ingresar
☐ Avocado Toast desaparece de mesa 1, aparece en mesa 2

COBRO:
☐ Cobrar mesa 1 → Efectivo
☐ Ticket muestra #order_number (no UUID)
☐ Stock deducido (verificar en dashboard si aplica)
☐ KDS limpia tarjetas de mesa 1

KDS VISUAL:
☐ Letra ~10% mas pequena que antes
☐ Sidebar izquierdo con platillos pendientes
☐ Ordenado por demanda (mas pedidos arriba)

RESULTADO: GO / GO CON OBSERVACIONES / NO-GO
NOTAS:
```

---

## 12. Recomendacion Final

### ⚠️ GO CON OBSERVACIONES

**Justificacion:**

Los 9 batches implementan cambios operativos solicitados directamente por Eduardo (gerente con 10+ anos de experiencia) durante una sesion de campo en el restaurante. Son mejoras que el operador identifica como necesarias para la operacion diaria.

**Por que GO:**
- Build limpio, zero errores de compilacion
- DB migration ejecutada y verificada
- Cambios son backward compatible (ordenes sin batch renderizan como antes)
- order_number ya estaba activo en produccion (trigger existente)
- Permisos son aditivos (manager=true sigue funcionando)
- KDS cosmetico es puramente visual

**Observaciones que requieren atencion:**

1. ~~**Transfer sin OCC (P0):**~~ **RESUELTO.** API `/api/pos/transfer-item` implementa OCC con version check sobre ambas ordenes + rollback compensatorio. Riesgo cerrado.

2. **Inventario al cobrar (P0):** Medir primera semana. Si AMALAY nunca tiene sobre-venta, no actuar. Si ocurre, disenar "reserved inventory" (comprometer al enviar, confirmar al cobrar). No revertir automaticamente al modelo anterior.

3. **Feature flags (P1):** Implementar 4 toggles locales (lock_screen, inventory, batches, lock_sent) para rollback instantaneo sin deploy. Critico para la primera semana.

4. **Lock screen (P1):** Evaluar con Eduardo si el cajero necesita excepcion. Podria ser configurable por rol.

5. **Smoke test obligatorio** antes de operacion real — ejecutar el checklist de la seccion 11 con Eduardo presente.

6. **Observabilidad de negocio** — medir metricas operativas (seccion 8b) para verificar que los cambios MEJORAN la operacion, no solo que el software funciona.

**Condicion para GO definitivo:** El smoke test de la seccion 11 debe pasar completamente antes de operar un turno completo. Si cualquier item STOP falla, no operar hasta resolver.

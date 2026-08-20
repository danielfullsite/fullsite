# Verdad de inventario — cómo hacerlo EXACTAMENTE (entradas + salidas)

> Plan técnico para resolver lo que Alejandro (Parrot/Bento) señaló. Verificado contra el código real
> de `origin/main`. Ver [[project_food_cost_truth]], `docs/strategy/LECCIONES-ALEJANDRO-PARROT-BENTO.md`,
> `dashboard-app/AGENTS.md` (contrato recordMovement).

## La buena noticia: el motor ya existe

`dashboard-app/src/lib/inventory.ts` → **`recordMovement()`** ya hace lo difícil, verificado:
- `MovementLine = { ingredient_id, quantity, unit_cost?, notes? }`. Para entradas, `unit_cost` = precio de compra.
- **Costo promedio ponderado automático:** `costAfter = (stockBefore*costBefore + qty*unit_cost) / stockAfter`
  (regla 2: stock=0 → adopta el nuevo; regla 3: unit_cost=0 → sin cambio).
- Ledger inmutable (`pos_inventory_movements`) + stock materializado (`pos_inventory.stock`) + `pos_ingredients.cost_per_unit` + **idempotencia** + **underflow prevention** (nunca stock negativo).
- Tipos ya definidos: `entry · invoice_entry · restock · transfer_in · waste · adjustment · deduction · transfer_out · return · reversal`.

Entonces **entradas y salidas son llamadas al contrato, no ingeniería nueva** — salvo el parseo de CFDI (net-new).

---

## FASE 1 — Entradas al contrato (bajo riesgo, ~1 día)

**Estado:** `inventario-real/entradas-factura` YA usa `recordMovement`. La deuda es la vieja
`pos/facturas-proveedor/page.tsx`, que hace **PATCH directo** a `cost_per_unit` + `pos_inventory.stock`
+ insert manual al ledger (prohibido por AGENTS.md).

**Cómo, exacto:** reemplazar su `handleSave` por UNA llamada (mismo patrón que ya apliqué a merma/físico):
```ts
await recordMovement({
  client_id: _cid(),
  movement_type: 'invoice_entry',
  actor: 'almacén',
  idempotency_key: `factura-${numFactura}-${proveedor}`,
  lines: items.map(it => ({
    ingredient_id: it.ingredient_id,
    quantity: +Math.abs(it.qty),      // entra stock
    unit_cost: it.unit_price,          // ← el contrato recalcula costo promedio
    notes: `Factura ${numFactura} — ${proveedor}`,
  })),
  metadata: { supplier: proveedor, folio: numFactura },
})
```
Borrar los 3 fetch manuales (PATCH cost + PATCH stock + insert movimiento). **Y consolidar:** deprecar
`pos/facturas-proveedor` o `inventario-real/entradas-factura` (hay dos UIs de lo mismo) — dejar una.
Cierra OP-21.

---

## FASE 2 — CFDI del proveedor + match físico (el net-new grande, ~1-2 semanas)

Es la tercera pata. El proveedor SIEMPRE emite CFDI → es el "papelito" digitalizado, sin pedirle que use nada.

**2a. Parsear el CFDI (XML 4.0).** Nuevo `src/lib/cfdi/parse-inbound.ts` con `fast-xml-parser` (nueva dep):
- Extraer de `cfdi:Comprobante`: `UUID` (del TimbreFiscalDigital), `Emisor.Rfc`, `Folio`, `Total`, IVA.
- De cada `cfdi:Conceptos > cfdi:Concepto`: `Cantidad`, `ValorUnitario`, `Importe`, `Descripcion`, `ClaveProdServ`, `Unidad`.
- Ruta `POST /api/inventory/cfdi/parse` (subir XML) → devuelve líneas normalizadas.

**2b. Mapear concepto → ingrediente.** El CFDI dice "TOMATE SALADETTE CAJA 20KG"; hay que mapearlo a un
`pos_ingredient`. Nueva tabla `pos_supplier_item_map (client_id, supplier_rfc, cfdi_descripcion, ingredient_id, factor)`:
- 1ª vez: el usuario confirma el mapeo (y el factor de conversión caja→kg). Se guarda.
- Siguientes CFDI del mismo proveedor → **auto-mapean**. (Esto es "limpiar la orden" que hacía Bento.)

**2c. Match esperado vs físico.** UI de recepción: muestra lo que dice el CFDI (esperado) y el usuario
confirma **lo que de verdad llegó** por línea (16, no 20). El delta = discrepancia → se marca.

**2d. Registrar.** Con las cantidades FÍSICAS y el `unit_cost` del CFDI:
```ts
recordMovement({
  movement_type: 'invoice_entry',
  idempotency_key: cfdi_uuid,                 // el UUID del CFDI es único → idempotencia perfecta
  lines: physicalLines,                        // cantidad REAL recibida
  metadata: { cfdi_uuid, supplier_rfc, folio, expected: cfdiLines, discrepancy },
})
```
Nueva tabla `pos_supplier_invoices (client_id, cfdi_uuid, supplier_rfc, folio, total, iva, status, received_at, discrepancy_json)`
para el ciclo de vida + alerta de faltantes (los 4 que no llegaron).

**Resultado:** "pedí 20, el CFDI dice 20, llegaron 16" queda registrado, valorizado y alertado. Y ese
registro verificado es el insumo para prestar crédito seguro (ver abajo).

---

## FASE 3 — Recetas con IA + food cost real (salidas, ~1 semana)

**Estado:** la deducción al vender/producir YA usa `recordMovement('deduction')` (desde `pos-data.ts` y
`inventario-real/`). El gap NO es el mecanismo — es que **71% de recetas tienen 1 ingrediente** → food cost falso.

**Cómo, exacto:**
- **3a. Auto-completar recetas:** ruta `POST /api/recipes/suggest` → recibe `{ nombre_platillo }` + el
  catálogo `pos_ingredients` → llama a Claude ("para 'Chilaquiles verdes', qué ingredientes y cuántos
  gramos, usando solo estos ingredientes disponibles") → devuelve receta borrador. UI de revisión (el
  humano ajusta gramos) → guarda a `pos_recipes`. Modo batch para las ~440 recetas flacas.
- **3b. Factor de rendimiento (yield):** agregar `yield_factor` por receta (crudo→limpio; camarón 1kg
  crudo = 0.7kg limpio) para que la deducción refleje consumo real.
- **3c. Sub-recetas:** una línea de receta puede apuntar a otra receta (salsa) → recursión en la
  deducción y en el cost-engine.

---

## FASE 4 — El pago: reconciliación, reorden, precios (después)

- **Varianza:** `SUM(quantity) GROUP BY ingredient_id` del ledger = stock teórico; vs último conteo
  físico = **merma no registrada** valorizada en $ (robo/desperdicio/error de receta). Una página + query.
- **Reorden:** ritmo de consumo (movimientos `deduction`) → predice quiebre → sugiere pedido.
- **Precios con contexto:** el agente lee el `unit_cost` de los `invoice_entry` en el tiempo, por
  ingrediente, con banda de normalidad → **solo alerta fuera de banda**, vía el experto único + gate de
  severidad (`agent_events`). **NO 70 alertas rojas** (la advertencia de Alejandro). Ver `docs/ai/AI-ARCHITECTURE-DIRECTION.md`.

---

## La conexión al endgame (crédito → pagos)

El registro de la Fase 2 (CFDI ↔ físico, discrepancia resuelta) es una **compra verificada**. Eso es
justo lo que Bento usaba para prestar seguro: sabes que la compra es real, cuánto y a qué precio. El
mismo dato que arregla el inventario **subscribe el crédito** — y crédito/pagos es el 85% del revenue de
Toast/Clip. Un solo camino.

---

## Net-new vs reuse (resumen honesto)

| Pieza | ¿Existe? | Trabajo |
|---|---|---|
| Motor (recordMovement, costo promedio, ledger, idempotencia) | ✅ | reusar |
| Deducción al vender/producir | ✅ | reusar |
| Entradas por factura → contrato | 🔶 (una UI ya; la vieja hace PATCH) | migrar + consolidar (Fase 1) |
| Parseo de CFDI de entrada | ❌ | net-new (Fase 2a) |
| Mapeo concepto→ingrediente | ❌ | net-new + tabla (Fase 2b) |
| Match esperado vs físico + alerta | ❌ | net-new (Fase 2c-d) |
| Auto-completar recetas con IA | ❌ | net-new (Fase 3a) |
| Yield / sub-recetas | ❌ | net-new (Fase 3b-c) |
| Varianza / reorden / precios-con-contexto | ❌ | net-new (Fase 4) |

**A confirmar al implementar:** schema exacto de `pos_recipes` (para 3a) y cuál de las dos UIs de entrada
es la que AMALAY usa (para 1). Nada de esto toca el camino offline — todo es dashboard/servidor, aditivo.

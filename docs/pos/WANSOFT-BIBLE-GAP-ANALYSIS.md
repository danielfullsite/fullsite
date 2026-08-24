# Gap Analysis Completo — Wansoft POS Bible vs Código LIVE de Fullsite

**Fecha:** 2026-08-16 · **Fuente:** `docs/product/WANSOFT-POS-BIBLE.md` (1081 líneas, 25 secciones + 4 apéndices) × código vivo del POS de Fullsite.
**Reemplaza** el análisis previo incompleto (~1/7). Evidencia por `file:line`.

## Hallazgo grande
El POS de Fullsite está **al nivel o ADELANTE** del bible en la gran mayoría de capacidades. Abajo solo lo que genuinamente falta o está más crudo.

---

## Fortalezas donde Fullsite YA SUPERA a Wansoft (no tocar — argumento de venta)
KDS digital cocina+barra (Wansoft solo imprime), manager-auth **offline** (PBKDF2/TTL 8h), inventory gate con LKG cache + recetas/merma/conteo físico, segunda pantalla cliente **funcional** (en AMALAY estaba rota), ~50 permisos granulares con perfiles, event store / audit log inmutable, integración terminal MP Point con recovery.

## Ya está hecho — NO reconstruir
- Modificadores multinivel (nivel/requerido/min/max) — `pos-data.ts:487–630`.
- Cancelación con razón + "¿se preparó?" (merma) + PIN gerente — `pos/page.tsx:993–1066`.
- Transferir item con PIN + log — `handleTransferItem` + `/api/pos/transfer-item`.
- Pago mixto, propina, cambio, drawer-kick, formas custom — cobro + `printer.ts:125`.
- Descuento prorrateado, cortesía con tope, 2x1, catálogo configurable — DiscountModal + `pos-combos`.
- Corte X/Z + guard de órdenes abiertas + Corte Mesero tip-out + comisión tarjeta + arqueo — `corte/page.tsx` + `pos-arqueo.ts` + `pos-cierre-guard.ts`.
- ~50 permisos por rol + PIN gerente offline (PBKDF2) — `pos-permissions.ts` + `pos-manager-auth.ts`.
- Silla por item, XX TIEMPO/coursing, barcode — `pos/page.tsx`.
- Plano visual con zonas + editor drag&drop — `pos/plano` + `pos/plano-editor`.
- KDS cocina + barra digitales — `pos/cocina`, `pos/barra`.
- QR CFDI en ticket + pre-ticket — `printer.ts:84,269,514`.
- Segunda pantalla cliente — `pos/cliente`.
- Inventory gate LKG + recetas/merma/conteo — `inventory-policy.ts` + `pos/recetas|inventario-fisico|merma`.

---

## Backlog priorizado

### Quick wins (<1h c/u)
1. **Split por silla** — los items ya guardan `silla`; agregar modo que agrupe automáticamente por silla en el modal de split (`pos/page.tsx:1993`). Alto valor, bajo costo.
2. **QR de lealtad/Megapuntos en ticket** — segundo QR en `printer.ts` (paridad Wansoft).
3. **Campo "torre/referencia" para Para llevar** en creación de orden.
4. **Post-envío → plano de mesas** (feedback Eduardo) — redirección tras Guardar.
5. **Límite de 3 intentos en arqueo** — `corte/page.tsx`.

### Medium flows
6. **Cambiar # de mesa (mover orden completa)** — endpoint + UI (permiso `cambio_mesa` ya existe, sin implementación).
7. **Order-type picker** (Restaurante/Llevar/Domicilio/Recoger) al crear — permisos ya existen sin UI.
8. **Editor de ticket desde POS** (logo, RFC, razón social, footer, IVA, tamaño QR) con preview + test print — la config vive en `pos_config` pero no hay UI POS-side.
9. **Envío de corte por Telegram/WhatsApp** al gerente al cerrar.
10. **Retiros programados con umbral** (auto-forzar retiro).
11. **Dólares/USD + tipo de cambio** como método de pago (permiso `tipo_cambio` ya existe).
12. **Filtro "solo mis mesas"** en plano (`ver_cuentas_propias`).
13. **Alerta de comanda no impresa** (falla de impresora) proactiva.
14. **Alerta 30 min órdenes desatendidas** (llevar/delivery).
15. **Dashboard POS-side de cancelaciones/descuentos/transferencias por mesero** + reglas dinámicas anti-fraude.

### Large features
16. **Juntar/Merge de mesas** preservando origen de cada item (2 cuentas → 1). Gap confirmado por dos biblias.
17. **Báscula por peso + barcode báscula** para Market.
18. **Autorización remota de gerente** (aprobar desde el celular).

---

## Top recomendaciones para el install de AMALAY (fiscal + operativo primero)
1. **Editor de ticket desde POS con RFC/razón social/logo/footer + preview** (Medium). ⚠️ Fiscal: si el ticket no lleva RFC/razón social/serie correctos, la facturación CFDI vía QR falla; hoy no se corrige desde la terminal sin tocar la BD.
2. **QR de lealtad/Megapuntos en ticket** (Quick). AMALAY usa Megapuntos; sin el QR se pierde retención que Wansoft sí imprimía.
3. **Split por silla** (Quick). Sillas activas + grupos que pagan separado; hoy el mesero reasigna a mano. Datos ya existen.
4. **Cambiar # de mesa + Merge de mesas** (Medium/Large). Operación diaria; hoy solo transfer item-por-item.
5. **Dólares/USD** (Medium). San Pedro/turistas reciben dólares; sin método USD el arqueo no cuadra.
6. **Envío de corte por Telegram** (Medium). Cierra loop con la infra de agentes; el gerente ve faltantes sin estar presente.
7. **Retiros programados con umbral + alerta** (Medium). Reduce riesgo de robo por acumulación de efectivo.

---

## Detalle por sección (evidencia)
Ver el reporte completo del análisis (25 secciones + apéndices) — resumen de estados 🟡/❌ más relevantes:
- **Sec 3 crear orden:** falta order-type picker (UI), campo torre (llevar), alerta 30min desatendidas.
- **Sec 9 mesas:** ❌ cambiar # mesa completa, ❌ merge de mesas.
- **Sec 11 cobro:** ❌ USD/FX; 🟡 split por silla (manual, no auto).
- **Sec 12 descuentos:** ❌ dashboard por mesero + alerta umbral; 🟡 "no dobles descuentos".
- **Secs 13/20 ticket:** ❌ QR lealtad; 🟡 editor de ticket POS-side (RFC/logo/footer/QR) + preview + test print.
- **Sec 17 caja:** ❌ retiros programados con umbral, foto conteo.
- **Sec 18 corte:** ❌ envío por Telegram/email; 🟡 tipos Global/Turno formales; 🟡 límite 3 intentos arqueo.
- **Sec 19 seguridad:** ❌ reglas dinámicas (>3 cancelaciones→auth), ❌ autorización remota.
- **Sec 21 periféricos:** ❌ báscula por peso.
- **Sec 25 pantalla cliente:** ❌ contenido publicitario entre órdenes.

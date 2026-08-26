# Client #2 Sandbox Smoke — turno → orden → KDS → cobro → corte

> **Estado: PREPARADO, NO EJECUTADO.** No declarar VERIFIED hasta correrlo contra
> el sandbox real (`fullsite-client2-demo`, staging DB, tenant `vantara`) y guardar
> evidencia (screenshots + filas de DB). Un plan no es una certificación.

## Prerequisitos (acción de Daniel — ver reporte)

- Deployment `fullsite-client2-demo` alcanzable (Deployment Protection = **off** en
  ESE proyecto; hoy los previews están tras Vercel SSO → no navegables).
- Env del proyecto apuntando a **staging** (`jkcnxfbbuyyfhwfjizgw`): `SUPABASE_SERVICE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ya seteadas), + `NEXT_PUBLIC_DEFAULT_CLIENT_ID=vantara`.
- Login demo: `owner@vantara.sandbox` (rol `dueño`). El password existe pero es
  desconocido → **setear un password demo conocido al desplegar** (staging, seguro).

## Arquitectura del demo (verificada)

- **Lecturas** POS → Supabase REST directo (cloud OK).
- **Escrituras** POS → rutas Next.js `/api/pos/*` server-side con `SUPABASE_SERVICE_KEY` (cloud OK).
- **Bridge** (`127.0.0.1:7717`) → `sendCommand` es **no-op graceful** sin WS: el KDS
  cross-device en tiempo real y la impresión degradan (KDS actualiza por refetch/poll,
  sin papel), pero el flujo de datos turno→orden→cobro→corte funciona sin Bridge.

## Pasos + assertions (ejecutar en navegador; capturar screenshot por paso)

| # | Paso | Acción UI | Assertion UI | Assertion DB (staging, client_id='vantara') |
|---|---|---|---|---|
| 1 | **TURNO** | Login `owner@vantara.sandbox` → abrir turno / apertura de caja con fondo | Turno abierto, fondo registrado, no aparece "AMALAY" en ninguna pantalla (TI-04) | fila de apertura en `pos_cash_movements` (o tabla de turnos) con fondo |
| 2 | **ORDEN** | Nueva orden (mesa o pickup) → agregar 2–3 ítems del menú vantara → enviar a cocina | Orden creada, total correcto, ítems del menú vantara (no AMALAY) | `pos_orders` fila nueva `client_id='vantara'`, status `enviada`/`preparando`, `items` correctos |
| 3 | **KDS** | Abrir `/pos/cocina` (o KDS) | La orden aparece en cocina; marcar preparando → lista | `pos_orders.status` avanza a `lista` |
| 4 | **COBRO** | Cobrar la orden (efectivo y/o tarjeta) | Pago registrado, cambio correcto, orden → cobrada/cerrada, pre-ticket/ticket | `pos_orders` status `cobrada`/`cerrada`, `payment_method`, montos; movimiento de venta |
| 5 | **CORTE** | Cerrar turno / corte de caja | Corte reconcilia fondo + ventas efectivo/tarjeta; totales cuadran | filas de corte en `pos_cash_movements`; suma = fondo + ventas del turno |

## Evidencia a guardar (antes de declarar VERIFIED)

- 5 screenshots (uno por paso) + 1 del corte final cuadrado.
- Query de verificación (staging):
  ```sql
  SELECT id, status, total, payment_method, created_at
  FROM pos_orders WHERE client_id='vantara' ORDER BY created_at DESC LIMIT 5;
  SELECT type, amount, created_at FROM pos_cash_movements
  WHERE client_id='vantara' ORDER BY created_at DESC LIMIT 10;
  ```
- Aislamiento: 0 filas/labels AMALAY visibles (TI-04/TI-06 pasan en UI).

## Criterio de PASS

Los 5 pasos completan en el navegador **y** las assertions de DB cuadran **y** el corte
reconcilia al centavo. Solo entonces se declara Client #2 smoke = VERIFIED, con la URL
y las capturas adjuntas. Hasta ese momento: **PREPARADO**, no verificado.

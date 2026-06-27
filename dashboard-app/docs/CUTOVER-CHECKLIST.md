# CUTOVER CHECKLIST — Fullsite reemplaza Wansoft en AMALAY

Status: **en preparacion**
Objetivo: apagar Wansoft sin que el restaurante necesite volver a abrirlo

Criterio de cada item:
- P0: si falla, el restaurante vuelve a Wansoft
- P1: el restaurante opera pero con friccion
- P2: mejora, no bloquea operacion

---

## 1. SOFTWARE — POS

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 1.1 | Crear orden, enviar a cocina | PASS | P0 | Certificado OFF-02 E2E |
| 1.2 | Cobro efectivo | PASS | P0 | Certificado COBRO-01 |
| 1.3 | Cobro tarjeta | PASS | P0 | Certificado COBRO-02 |
| 1.4 | Cobro mixto | PASS | P0 | Certificado COBRO-03 |
| 1.5 | Propina | PASS | P0 | Certificado COBRO-04 |
| 1.6 | Corte de caja | PASS | P0 | Certificado COBRO-06/10 |
| 1.7 | Bloqueo de cobro sin envio | PASS | P0 | Certificado COBRO-00 |
| 1.8 | Descuento con aprobacion | PENDIENTE | P0 | No certificado E2E |
| 1.9 | Cancelacion de item con PIN | PENDIENTE | P0 | No certificado E2E |
| 1.10 | Cancelacion de orden completa | PENDIENTE | P0 | No certificado E2E |
| 1.11 | Reapertura de orden | PENDIENTE | P1 | COBRO-07 pendiente |
| 1.12 | Split parejo | PENDIENTE | P1 | COBRO-12 pendiente |
| 1.13 | Split por items | PENDIENTE | P1 | COBRO-13 pendiente |
| 1.14 | Cambio de mesa | PENDIENTE | P1 | No certificado |
| 1.15 | Transferencia de mesa | PENDIENTE | P1 | No certificado |
| 1.16 | Reimpresion de ticket | PENDIENTE | P2 | No certificado |

## 2. SOFTWARE — Offline y sync

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 2.1 | Orden offline + sync | PASS | P0 | Certificado OFF-02 |
| 2.2 | Audit log offline | PASS | P0 | Certificado A3 |
| 2.3 | Inventory movements sync | PASS | P0 | Validado con 7 zombies resueltos |
| 2.4 | Print queue persistencia | PASS | P0 | BUG-005 certificado |

## 3. SOFTWARE — KDS / Cocina

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 3.1 | Ordenes llegan al KDS | PASS | P0 | Funciona en produccion |
| 3.2 | Filtro por estacion | PASS | P1 | cocina/barra/panaderia/market |
| 3.3 | Avance de status | PASS | P0 | enviada -> preparando -> lista |
| 3.4 | Cancelacion de item desde KDS | PASS | P1 | Con PIN y devolucion inventario |
| 3.5 | Notificacion sonora | PASS | P1 | Beep en nueva orden |
| 3.6 | Detalle de receta | PASS | P2 | Tap en nombre del platillo |

## 4. FACTURACION

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 4.1 | Cuenta Facturama activa | PENDIENTE | P0 | $1,650 MXN activacion. Sin esto no hay cutover |
| 4.2 | Timbrado CFDI desde POS | PENDIENTE | P0 | Endpoint /api/factura listo, falta Facturama activo |
| 4.3 | Cancelacion de CFDI | PENDIENTE | P1 | Necesario para correcciones |
| 4.4 | Datos fiscales del cliente | PASS | P1 | Formulario existe en /pos/facturacion |
| 4.5 | Volumen: 400-430 CFDI/mes | PENDIENTE | P0 | Verificar plan Facturama soporta volumen |

## 5. IMPRESION

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 5.1 | Print bridge instalado en terminal | PENDIENTE | P0 | Software existe, falta instalar en hardware AMALAY |
| 5.2 | Comanda cocina imprime fisicamente | PENDIENTE | P0 | Sin esto el chef no puede trabajar |
| 5.3 | Comanda barra imprime fisicamente | PENDIENTE | P0 | Mismo que cocina pero para bebidas |
| 5.4 | Ticket cliente imprime | PENDIENTE | P0 | Necesario para cobro |
| 5.5 | Apertura de cajon | PENDIENTE | P0 | Bridge o BT al cajon |
| 5.6 | IPs de impresoras configuradas | PENDIENTE | P0 | Necesitamos IPs de cada impresora en la red local |
| 5.7 | Impresora de respaldo | PENDIENTE | P1 | Que pasa si una impresora falla? |
| 5.8 | Print queue needs_attention visible | PASS | P1 | Banner rojo + reintentar en POS |

## 6. HARDWARE Y RED

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 6.1 | Terminal POS (touch) funcionando | PENDIENTE | P0 | Verificar que app.fullsite.mx carga en el hardware |
| 6.2 | Monitor KDS cocina | PENDIENTE | P0 | Verificar que la pantalla de cocina muestra el KDS |
| 6.3 | Red WiFi estable | PENDIENTE | P0 | Verificar cobertura en salon, cocina, barra |
| 6.4 | Internet estable | PENDIENTE | P0 | Verificar proveedor, velocidad, uptime |
| 6.5 | Red local para impresoras | PENDIENTE | P0 | Impresoras en misma red que terminal |
| 6.6 | UPS / respaldo de energia | PENDIENTE | P1 | Que pasa si se va la luz? |
| 6.7 | Browser actualizado en terminal | PENDIENTE | P1 | Chrome/Edge reciente para SW y IndexedDB |

## 7. CAPACITACION

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 7.1 | Meseros: abrir mesa, agregar items, enviar | PENDIENTE | P0 | Flujo basico que deben dominar |
| 7.2 | Meseros: cobrar (efectivo, tarjeta, mixto) | PENDIENTE | P0 | Incluye propina y cambio |
| 7.3 | Cajero: corte de caja | PENDIENTE | P0 | Fondo, arqueo, cierre |
| 7.4 | Cajero: facturacion | PENDIENTE | P0 | Depende de 4.1 Facturama |
| 7.5 | Gerente: descuentos y cancelaciones | PENDIENTE | P0 | PIN de gerente, motivos |
| 7.6 | Gerente: reapertura de orden | PENDIENTE | P1 | Flujo de correccion |
| 7.7 | Cocina: KDS basico | PENDIENTE | P0 | Ver orden, avanzar status |
| 7.8 | Todos: que hacer si no hay internet | PENDIENTE | P0 | Modo offline, no entrar en panico |
| 7.9 | Todos: que hacer si la impresora falla | PENDIENTE | P1 | Banner rojo, reintentar, alternativas |
| 7.10 | Sesion de practica con sistema real | PENDIENTE | P0 | Turno simulado antes del dia D |

## 8. DATOS Y MIGRACION

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 8.1 | Menu completo importado | PASS | P0 | 522 items importados |
| 8.2 | Precios actualizados | PENDIENTE | P0 | Verificar que precios match con Wansoft actual |
| 8.3 | Categorias correctas | PASS | P1 | Validado con Eduardo |
| 8.4 | Modificadores configurados | PENDIENTE | P1 | Extras, sin X, opciones |
| 8.5 | Recetas importadas | PASS | P1 | pos_recipes_old con ingredientes |
| 8.6 | Staff / PINs configurados | PENDIENTE | P0 | Cada mesero necesita su PIN |
| 8.7 | Metodos de pago configurados | PENDIENTE | P0 | Efectivo, tarjeta, Rappi, UberEats, etc |

## 9. PLAN DE ROLLBACK

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 9.1 | Wansoft sigue instalado y funcional | PENDIENTE | P0 | No desinstalar hasta 2 semanas despues |
| 9.2 | Criterio de rollback definido | PENDIENTE | P0 | Que condiciones disparan el regreso a Wansoft? |
| 9.3 | Tiempo maximo para decidir rollback | PENDIENTE | P0 | Ej: si en 2 horas no se resuelve, rollback |
| 9.4 | Responsable de decision de rollback | PENDIENTE | P0 | Daniel? Eduardo? Monica? |
| 9.5 | Datos no se pierden en rollback | PASS | P1 | Ordenes en Supabase, Wansoft independiente |

## 10. SOPORTE DIA D

| # | Item | Status | Prioridad | Notas |
|---|------|--------|-----------|-------|
| 10.1 | Daniel presente en el restaurante | PENDIENTE | P0 | Primeras 2-4 horas minimo |
| 10.2 | Acceso remoto a terminal | PENDIENTE | P1 | TeamViewer o similar para soporte remoto |
| 10.3 | Canal de comunicacion con staff | PENDIENTE | P1 | WhatsApp group o chat directo |
| 10.4 | Checklist de apertura dia D | PENDIENTE | P0 | Paso a paso de que verificar antes de abrir |
| 10.5 | Horario del cutover | PENDIENTE | P0 | Inicio de semana? Dia de bajo volumen? |

---

## Resumen de readiness

| Area | Status | % | Blocker principal |
|------|--------|---|-------------------|
| Core POS | PASS | 100% | — |
| Offline/Sync | PASS | 100% | — |
| Payments | PASS | 100% | — |
| KDS | PASS | 95% | Legibilidad a distancia (P2, LATER) |
| Print Bridge | PENDIENTE | 20% | No instalado en hardware real |
| Facturacion | PENDIENTE | 20% | Facturama no activado |
| Hardware/Red | PENDIENTE | 30% | No verificado in situ |
| Capacitacion | PENDIENTE | 10% | Ninguna sesion realizada |
| Datos/Migracion | PARCIAL | 70% | Precios, PINs, metodos de pago |
| Rollback Plan | PENDIENTE | 20% | Criterios no definidos |
| Soporte Dia D | PENDIENTE | 10% | Horario y logistica no definidos |

**TOTAL READINESS: ~55%**

Los items PASS son los que certificamos E2E en esta sesion.
Todo lo PENDIENTE es trabajo de implementacion, no de desarrollo.

---

## P0 criticos (ordenados por riesgo)

1. **Facturama** — sin facturacion, clientes reclaman dia 1
2. **Print bridge en terminal real** — sin comanda impresa, cocina no opera
3. **Capacitacion basica meseros** — sin entrenamiento, regresan a Wansoft en 10 min
4. **PINs y metodos de pago configurados** — sin esto, no pueden cobrar ni autorizar
5. **Verificacion de hardware y red in situ** — no sabemos si el hardware soporta la app

Ningun P0 pendiente es desarrollo de software.
Todos son implementacion, configuracion y operacion.

# FULLSITE — Executive Report

> Estado del Restaurant Operating System.
> 30 de junio de 2026.

---

## 1. Executive Summary

**¿Está Fullsite listo para operar un restaurante real?**

Sí, con condiciones. El sistema cubre el 90% de los procesos operativos
de un restaurante. Ventas, cobros, cocina, corte de caja, y auditoría
funcionan. Hay 6 P0s abiertos — todos bloqueados por acciones externas
(pago Facturama, XML fiscal, acceso a hardware), no por código.

**Nivel de confianza: 74%**

| Area | Confianza |
|---|---|
| Ventas/Ordenes | 90% |
| Cobro | 90% |
| Cocina/KDS | 85% |
| Impresion | 85% |
| Corte/Caja | 85% |
| Auditoria | 85% |
| Inventario | 30% (decorativo, desactivar) |
| Facturacion | 0% (bloqueado) |
| Concurrencia | 70% |
| Hardware | 50% |

**Target: 95% antes de cutover.**

---

## 2. P0s abiertos

| P0 | Tipo | Bloqueado por |
|---|---|---|
| IEPS modelo fiscal | Legal | XML CFDI de AMALAY |
| Facturama produccion | Legal | Pago $1,650 |
| XML CFDI validado | Legal | Los dos anteriores |
| Huella digital | Operacion | Acceso terminal AMALAY |
| Cajon de dinero | Operacion | Acceso admin terminal |
| Shadow Day | Operacion | Todo lo anterior |

No hay P0s de codigo. Los 4 parches de codigo (3 concurrencia + INV-1)
ya estan implementados y en Code PASS.

---

## 3. Top 10 — Donde Fullsite es superior

| # | Proceso | Por que ganamos |
|---|---|---|
| 1 | **KDS digital** | 0-1s vs 15s polling. Item tracking, progress bar, alerta sonora. Wansoft imprime papel |
| 2 | **Offline-first** | IndexedDB + sync queue. Wansoft muere sin SQL Server |
| 3 | **Comanda de actualizacion** | Detecta cambios post-envio, imprime "ACTUALIZACION". Unico de Fullsite |
| 4 | **Inventario automatico** | Recetas, merma, conteo fisico, alertas, compras. Wansoft: 23 KB |
| 5 | **Auto-factura QR** | Cliente escanea y factura solo. Wansoft no tiene |
| 6 | **Split de cuenta** | Parejo + por items + hasta 6 cuentas. Wansoft solo por monto |
| 7 | **Arqueo por denominacion** | Billetes y monedas MXN en wizard. Wansoft pide monto total |
| 8 | **13 agentes IA** | Anomalias, prediccion, anti-fraude, staffing, menu engineering. Wansoft: cero |
| 9 | **Dashboard 17 paginas** | Interactivo, tiempo real. Wansoft: papel impreso |
| 10 | **Instalacion 30 min** | PWA en cualquier device. Wansoft: USB + Windows + SQL Server |

---

## 4. Top 10 — Donde Wansoft sigue ganando

| # | Proceso | Que aprender |
|---|---|---|
| 1 | **Terminal bancaria** | 4 integraciones (Clip/NetPay/OEL/Wannapay). Fullsite: cero |
| 2 | **Intentos de corte** | Cada intento registrado con cantidad y diferencia. Anti-fraude clave |
| 3 | **Fondo de propinas** | Recoleccion, reparto por rol (mesero/mosito/capitan), comisiones |
| 4 | **Huella USB directa** | SDK DigitalPersona nativo. Fullsite depende de WebAuthn |
| 5 | **CRM de clientes** | 79 SPs. Historial, RFC guardado, CxC, tarjetas. Fullsite: parcial |
| 6 | **Catalogo de razones** | Cancelaciones/cortesias con razones estandarizadas, no texto libre |
| 7 | **Liquidacion de meseros** | Cuanto debe cada mesero al cierre, cuanto se le paga |
| 8 | **47 formatos impresion** | Cubren cada escenario operativo |
| 9 | **IEPS integrado** | Desglose fiscal por producto con tasa individual |
| 10 | **20 anos de campo** | Reglas de negocio validadas en miles de restaurantes |

---

## 5. Top 10 — Oportunidades de innovacion

Procesos donde ninguno es suficientemente bueno. Aqui se construye
la ventaja competitiva de los proximos 5 anos.

| # | Oportunidad | Moat potencial |
|---|---|---|
| 1 | **Onboarding automatizado** | Script que migra menu, configura impresoras, crea staff en <30 min. Imposible de copiar sin la arquitectura cloud-first |
| 2 | **IA predictiva de compras** | "Manana necesitas 200 huevos" basado en historico + reservaciones. Ningun POS en LATAM lo hace |
| 3 | **Conciliacion bancaria automatica** | POS habla con terminal, el cierre cuadra solo. Elimina la discrepancia mas comun |
| 4 | **Contabilidad integrada** | Asiento contable automatico a CONTPAQi al cierre. El contador aprueba, no captura |
| 5 | **Portal de proveedores** | El proveedor ve su OC, confirma entrega, sube factura. Elimina WhatsApp del proceso |
| 6 | **Orden desde la mesa** | QR en la mesa → cliente ordena → mesero confirma. Reduce tiempo de espera 50% |
| 7 | **Prioridades inteligentes en KDS** | La IA decide que cocinar primero basado en tiempo de espera y complejidad |
| 8 | **Reparto automatico de propinas** | Pool con reglas configurables por rol. Elimina el conflicto diario mas comun |
| 9 | **Health check pre-apertura** | Al abrir turno: bridge, impresoras, internet, menu sincronizado. Zero sorpresas |
| 10 | **Benchmark entre restaurantes** | "Tu food cost es 35%, el promedio de tus 100 sucursales es 31%". Solo posible con datos centralizados |

---

## 6. Roadmap

### Go-Live (Sprint 1-3, ~3 semanas)

**Sprint 1 — Legal:**
Obtener XML, implementar IEPS, pagar Facturama, validar factura real.

**Sprint 2 — Operativo:**
Huella, cajon, bridge NSSM, instalar en devices, Shadow Day.

**Sprint 3 — Certificacion:**
7 dias de operacion estable, cada proceso certificado en produccion.

### 30 dias post-cutover

- Normalizar items a pos_order_items (elimina concurrencia raiz)
- Supabase Realtime entre terminales
- Fondo de propinas (recoleccion, reparto, retiro)
- Corte Z formal con reglas de negocio
- Intentos de corte registrados
- Catalogo de razones predefinido
- Recetas: conversion de unidades + modificadores descuentan

### 90 dias

- Integracion terminal bancaria (Clip REST)
- CRM de clientes (historial, RFC guardado, CxC)
- Onboarding automatizado (script de migracion)
- Cancelacion CFDI ante SAT
- Catalogo editable desde POS
- IEPS completo con tasas por producto

### 12 meses

- Portal de proveedores
- IA predictiva de compras
- Conciliacion bancaria automatica
- Contabilidad integrada (CONTPAQi)
- App nativa comandero
- Event sourcing
- API publica
- 100 restaurantes

---

## 7. La pregunta final

**Si hoy fueras el CTO de una cadena de 500 restaurantes,
¿firmarias un contrato para operar unicamente con Fullsite?**

**No. Todavia no.**

Tres cosas tendrian que cambiar:

**1. Integracion bancaria.** El 60-70% de los pagos en Mexico son
con tarjeta. Sin integracion, cada pago es una oportunidad de fraude
y una fuente de discrepancia. A 500 restaurantes, esto genera miles
de tickets de soporte mensuales. Solucion: integrar Clip REST (~5 dias).

**2. Onboarding sin el fundador.** Hoy instalar Fullsite requiere
a Daniel. Las IPs de impresoras, el routing, el staff, el menu —
todo vive en su cabeza. A 500 restaurantes, esto es imposible.
Solucion: script de migracion + onboarding guiado (~10 dias).

**3. Cierre de turno completo.** Los intentos de corte, la liquidacion
de meseros, y el fondo de propinas son procesos diarios que el gerente
necesita. Sin ellos, el gerente no confia en el sistema. A 500
restaurantes, la desconfianza se multiplica. Solucion: ~10 dias.

**Pero.** Si me preguntas si firmaria para UN restaurante que conozco
bien, con soporte directo del fundador, y con la promesa de resolver
los 3 gaps en 90 dias: **si, firmaria.**

Y eso es exactamente lo que esta pasando con AMALAY.

---

> Fullsite no es un POS. Es un Restaurant Operating System.
>
> Hace dos semanas la conversacion era "nos falta un POS."
> Hoy la conversacion es "el XML CFDI refleja correctamente el IEPS
> y cuadra con el corte de caja?"
>
> Ese cambio de conversacion es la senal de que ya no estamos
> construyendo una app. Estamos construyendo infraestructura critica.
>
> Y la infraestructura critica se mide por confianza, no por features.

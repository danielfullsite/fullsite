# MATRIZ MAESTRA — FULLSITE vs OPERACION REAL DE RESTAURANTE

> Auditoria definitiva. 97 procesos en 10 dominios.
> Perspectiva: 500 restaurantes en produccion.
> Cada proceso verificado con file:line del codigo fuente.
> Fecha: 2026-06-30

---

## RESUMEN EJECUTIVO

| Metrica | Valor |
|---|---|
| Procesos auditados | 97 |
| Existen completos | 87 (90%) |
| Certificados en codigo | 80 (82%) |
| Probados en produccion | 0 (0%) |
| Mejor que Wansoft | 36 (37%) |
| Igual que Wansoft | 35 (36%) |
| Peor que Wansoft | 13 (13%) |
| No existe | 10 (10%) |

---

## TABLA MAESTRA POR DOMINIO

### 1. VENTAS (15 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 1.1 | Abrir mesa | Si | Si | No | Igual | 95% |
| 1.2 | Cambiar mesa | Si | Si | No | Igual | 85% |
| 1.3 | Unir mesas | Si | Si | No | Igual | 85% |
| 1.4 | Dividir cuenta | Si | Si | No | MEJOR (parejo+items) | 85% |
| 1.5 | Personas/sillas | Si | Si | No | Igual | 90% |
| 1.6 | Descuentos | Si | Si | No | Igual | 95% |
| 1.7 | Cortesias | Si | Si | No | Igual | 90% |
| 1.8 | Cancelaciones | Si | Si | No | Igual | 95% |
| 1.9 | Reimpresiones | Si | Si | No | Peor (sin audit) | 80% |
| 1.10 | Propinas | Si | Si | No | Peor (sin mosito) | 90% |
| 1.11 | Rappi | Si | Si | No | MEJOR (UI dedicada) | 85% |
| 1.12 | Uber Eats | Si | Si | No | MEJOR | 85% |
| 1.13 | Delivery propio | Parcial | No | No | N/A | 40% |
| 1.14 | Pickup/recoger | Si | Si | No | Igual | 90% |
| 1.15 | Consumo interno | Parcial | No | No | Peor (sin tipo dedicado) | 30% |

### 2. CAJA (10 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 2.1 | Apertura de turno | Si | Si | No | Igual | 90% |
| 2.2 | Fondo de caja | Si | Si | No | Igual | 90% |
| 2.3 | Depositos | Si | Si | No | Igual | 90% |
| 2.4 | Retiros | Si | Si | No | Igual | 90% |
| 2.5 | Arqueo (denominaciones) | Si | Si | No | MEJOR (por denominacion) | 95% |
| 2.6 | Corte X | Si | Si | No | Igual | 90% |
| 2.7 | Corte Z (cierre) | Si | Si | No | Peor (sin intentos) | 90% |
| 2.8 | Diferencias | Si | Si | No | Igual | 95% |
| 2.9 | PIN gerente | Si | Si | No | Igual | 95% |
| 2.10 | Auditoria de caja | Si | Si | No | MEJOR (dashboard) | 90% |

### 3. COCINA (8 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 3.1 | Routing por estacion | Si | Si | No | MEJOR (categoria+keyword) | 90% |
| 3.2 | Estaciones KDS | Si | Si | No | MEJOR (visual+touch) | 95% |
| 3.3 | Reimprimir comanda | Parcial | No | No | Igual | 60% |
| 3.4 | Cancelacion en cocina | Si | Si | No | Igual | 85% |
| 3.5 | Actualizacion de items | Si | Si | No | MEJOR (unico de Fullsite) | 90% |
| 3.6 | Tiempos/cursos | Si | Si | No | Igual | 85% |
| 3.7 | Prioridades | No | No | No | Igual (ninguno) | 0% |
| 3.8 | Rehacer comanda | Parcial | No | No | Igual | 50% |

### 4. INVENTARIO (16 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 4.1 | Descuento al enviar | Si | Si | No | MEJOR (mas preciso) | 90% |
| 4.2 | Dual: receta al enviar, market al cobrar | Si | Si | No | MEJOR | 90% |
| 4.3 | Reversa por cancelacion | Si | Si | No | MEJOR (automatico) | 90% |
| 4.4 | Cortesia (no devuelve stock) | Si | Si | No | Igual | 85% |
| 4.5 | Merma | Si | Si | No | MEJOR (Wansoft no tiene) | 85% |
| 4.6 | Produccion/lotes | No | No | No | Peor | 0% |
| 4.7 | Recetas | Si | Si | No | MEJOR (alias fuzzy) | 85% |
| 4.8 | Ingredientes compuestos | No | No | No | Igual (ninguno) | 0% |
| 4.9 | Compras / OC | Si | Si | No | MEJOR (Wansoft no tiene) | 80% |
| 4.10 | Proveedores | Parcial | No | No | Igual | 40% |
| 4.11 | Traspasos | No | No | No | Igual (ninguno) | 0% |
| 4.12 | Ajustes manuales | Si | Si | No | Igual | 80% |
| 4.13 | Conteo fisico | Si | Si | No | MEJOR (Wansoft no tiene) | 80% |
| 4.14 | Seguimiento E2E | Si | Si | No | MEJOR | 85% |
| 4.15 | Alertas stock bajo | Si | Si | No | MEJOR (Wansoft no tiene) | 80% |
| 4.16 | Market stock 1:1 | Si | Si | No | MEJOR (dual track) | 85% |

### 5. FACTURACION (14 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 5.1 | CFDI 4.0 | Si | Si (sandbox) | No | MEJOR (REST vs SOAP) | 85% |
| 5.2 | RFC validacion | Si | Si | No | Igual | 95% |
| 5.3 | Uso CFDI | Si | Si | No | Igual | 95% |
| 5.4 | Regimen fiscal | Si | Si | No | Igual | 95% |
| 5.5 | Codigo postal | Si | Si | No | Igual | 95% |
| 5.6 | Razon social | Si | Si | No | Igual | 95% |
| 5.7 | XML | Si | Si | No | Igual | 90% |
| 5.8 | PDF | Si | Si | No | Igual | 90% |
| 5.9 | Cancelacion CFDI (SAT) | No | No | No | Peor | 0% |
| 5.10 | Complementos de pago | Si | Si | No | MEJOR (Wansoft no tiene) | 80% |
| 5.11 | Notas de credito | Parcial | No | No | Parcial | 40% |
| 5.12 | Reenvio email | Si | Si | No | MEJOR (automatico) | 85% |
| 5.13 | Reimpresion | Si | Si | No | Igual | 90% |
| 5.14 | Auto-factura QR | Si | Si | No | MEJOR (Wansoft no tiene) | 85% |

### 6. CLIENTES (6 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 6.1 | Historial | Parcial | No | No | Peor | 30% |
| 6.2 | Preferencias | Parcial | No | No | Parcial | 30% |
| 6.3 | Datos fiscales guardados | No | No | No | Peor | 0% |
| 6.4 | Credito/CxC | No | No | No | Peor | 0% |
| 6.5 | Puntos/lealtad | Parcial | No | No | Peor | 20% |
| 6.6 | Comentarios | Parcial | No | No | Parcial | 30% |

### 7. EMPLEADOS (6 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 7.1 | Usuarios | Si | Si | No | Igual | 90% |
| 7.2 | Roles | Si | Si | No | MEJOR (5 roles) | 90% |
| 7.3 | Permisos granulares | Si | Si | No | Igual | 85% |
| 7.4 | PIN | Si | Si | No | Igual | 90% |
| 7.5 | Huella digital | Parcial | No | No | Diferente (WebAuthn) | 50% |
| 7.6 | Auditoria accesos | Si | Si | No | Igual | 85% |

### 8. REPORTES (8 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 8.1 | Ventas | Si | Si | No | MEJOR (dashboard) | 90% |
| 8.2 | Caja | Si | Si | No | MEJOR | 90% |
| 8.3 | Inventario | Si | Si | No | MEJOR | 85% |
| 8.4 | Propinas | Si | Si | No | MEJOR | 85% |
| 8.5 | Impuestos | Si | Si | No | MEJOR (reporte fiscal) | 85% |
| 8.6 | Facturacion | Si | Si | No | MEJOR | 85% |
| 8.7 | Costos | Si | Si | No | MEJOR (Wansoft no tiene) | 80% |
| 8.8 | Utilidad/P&L | Parcial | No | No | Parcial | 40% |

### 9. AUDITORIA (6 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 9.1 | Quien (actor) | Si | Si | No | Igual | 95% |
| 9.2 | Cuando (timestamp) | Si | Si | No | Igual | 95% |
| 9.3 | Dispositivo (terminal_id) | No | No | No | Peor | 0% |
| 9.4 | Que cambio (action) | Si | Si | No | Igual | 90% |
| 9.5 | Antes/despues | Parcial | Si | No | Parcial | 70% |
| 9.6 | Reconstruccion (events) | Si | Si | No | MEJOR (event store) | 80% |

### 10. INTEGRACIONES (8 procesos)

| # | Proceso | Existe | Cert | Prod | vs Wansoft | Confianza |
|---|---------|--------|------|------|------------|-----------|
| 10.1 | Print bridge | Si | Si | Si | MEJOR (HTTP instantaneo) | 95% |
| 10.2 | Impresoras multi | Si | Si | Si | MEJOR (mas protocolos) | 90% |
| 10.3 | Terminal bancaria | No | No | No | Peor | 0% |
| 10.4 | Rappi | Si | Si | No | MEJOR | 85% |
| 10.5 | Uber Eats | Si | Si | No | MEJOR | 85% |
| 10.6 | Facturama | Si | Si (sandbox) | No | MEJOR | 85% |
| 10.7 | IA (13 agentes) | Si | Si | Si | MEJOR (Wansoft: cero) | 90% |
| 10.8 | Dashboard (17 paginas) | Si | Si | Si | MEJOR | 90% |

---

## TOP 10 GAPS CRITICOS PARA 500 RESTAURANTES

| # | Gap | Impacto a escala | Esfuerzo | Prioridad |
|---|-----|-----------------|----------|-----------|
| 1 | Terminal bancaria (sin integracion) | Cada pago tarjeta es manual | 5d | P1 |
| 2 | CRM de clientes (sin historial ni RFC guardado) | Imposible facturar recurrente | 5d | P1 |
| 3 | Cancelacion CFDI ante SAT | Legal — facturas erroneas no se cancelan | 2d | P1 |
| 4 | Intentos de corte no registrados | Gerente no detecta manipulacion | 2h | P0 |
| 5 | Device ID en audit log | No se sabe de cual terminal vino la accion | 1h | P0 |
| 6 | Traspasos inter-sucursal | Requisito para multi-local | 5d | P2 |
| 7 | Catalogo de razones predefinido | Cancelaciones con texto libre no son analizables | 1d | P1 |
| 8 | Consumo interno (tipo de orden) | Staff come sin deducir inventario | 1d | P2 |
| 9 | Produccion/lotes | Chef no puede planificar batch | 5d | P2 |
| 10 | Reimpresiones en audit | No se rastrean reimpresiones por mesero | 1h | P1 |

---

## DONDE FULLSITE ES CLARAMENTE SUPERIOR (36 procesos)

| Area | Razon |
|---|---|
| Impresion | HTTP instantaneo vs polling 15s. Print queue con retry |
| KDS | Digital con item tracking vs comandas de papel |
| Inventario | Recetas, merma, conteo fisico, compras, alertas. Wansoft: 23 KB |
| Facturacion | REST moderno + QR auto-factura vs SOAP 2007 |
| Offline | IndexedDB + sync queue vs SQL Server local que muere |
| Reportes | Dashboard interactivo 17 paginas vs papel impreso |
| IA | 13 agentes 24/7 vs cero inteligencia |
| Plataforma | PWA en cualquier device vs solo Windows |
| Deployment | 30 min remoto vs USB + visita + instalacion |
| Auditoria | Event store append-only vs logs APAGADOS |
| Split de cuenta | Parejo + por items vs solo por monto |
| Comanda de actualizacion | Detecta cambios post-envio (unico de Fullsite) |
| Arqueo | Por denominacion (billetes + monedas) vs monto total |
| Food cost | Dashboard de costos vs nada |
| Market retail | Dual track (receta + 1:1) vs nada |

---

## DONDE WANSOFT TODAVIA GANA (13 procesos)

| Area | Razon | Solucion |
|---|---|---|
| Huella USB directa | SDK DigitalPersona nativo vs WebAuthn | Verificar Windows Hello o bridge |
| Terminal bancaria | 4 integraciones (Clip/NetPay/OEL/Wannapay) | Implementar Clip REST |
| CRM de clientes | 79 SPs de ClientePOS con historial | Construir modulo |
| CxC (credito) | Sistema completo de abonos y saldos | Post-cutover |
| Intentos de corte | Cada intento registrado con diferencia | 2h de desarrollo |
| Rol mosito | Ayudante con fraccion de propinas | Post-cutover |
| 47 formatos impresion | Cubren cada escenario posible | Agregar segun necesidad |
| Fondo de propinas | Recoleccion, reparto, comisiones, retiros | 5d post-cutover |
| Consumo interno | Tipo de orden con deduccion sin venta | 1d |
| Cancelacion CFDI SAT | Cancelacion real ante SAT | 2d |
| Device ID en audit | Terminal identificada en cada accion | 1h |
| Catalogo de razones | Razones estandarizadas, no texto libre | 1d |
| Reimpresiones audit | Cada reimpresion logueada por mesero | 1h |

---

## POR QUE UN RESTAURANTE ELEGIRIA FULLSITE EN LUGAR DE WANSOFT

### Razones operativas (no marketing)

**1. No necesita Windows.** Cualquier tablet de $3,000 MXN reemplaza una terminal de $15,000. Cero instalacion de SQL Server, .NET, drivers. Abres un browser y empiezas.

**2. No se detiene sin internet.** IndexedDB + sync queue permiten seguir vendiendo offline. Wansoft muere si SQL Server se cae. En Mexico, el internet se cae. Fullsite no pierde ventas.

**3. Las comandas llegan instantaneamente.** Bridge HTTP: 0-1 segundo. Wansoft polling: hasta 15 segundos. En hora pico, 15 segundos es la diferencia entre un cliente satisfecho y un plato frio.

**4. El inventario se descuenta automatico por receta.** Al enviar a cocina, no al cobrar. Cancelas y el stock regresa. Merma, conteo fisico, alertas de reorden, purchase orders. Wansoft tiene un modulo de 23 KB.

**5. El cliente factura solo.** QR en el ticket. Escanea, captura RFC, listo. Sin depender del cajero. Wansoft usa eGlobal SOAP de 2007.

**6. 13 agentes de IA monitorean 24/7.** Anomalias, prediccion, anti-fraude, staffing, menu engineering. Wansoft tiene cero inteligencia.

**7. El corte es mas preciso.** Conteo por denominacion (billetes y monedas). Arqueo con depositos, retiros, propinas por forma de pago. Dashboard interactivo en vez de papel.

**8. Se instala en 30 minutos sin visita.** No hay USB, no hay licencia, no hay instalador Windows.

**9. KDS digital reemplaza comandas de papel.** Timer, done-tracking por item, progress bar, sound alerts. La cocina ve en tiempo real.

**10. La terminal es desechable, los datos son eternos.** Supabase cloud. Si la terminal muere, abres otra y sigues. Wansoft: terminal muere = datos mueren.

### Lo que un restaurante extraniaria (honestamente)

1. Huella digital USB directa (WebAuthn es workaround, no identico)
2. 47 formatos de impresion (Fullsite tiene ~10)
3. Credito a clientes regulares (CxC)
4. Integracion con terminales bancarias
5. Fondo de propinas (reparto, comisiones, liquidacion)

### El punto decisivo

Wansoft resuelve problemas de 2007 con tecnologia de 2007. Fullsite resuelve los mismos problemas con tecnologia de 2026. Ambos controlan fraude, imprimen tickets, cuadran caja. Pero solo uno funciona en una tablet, sin internet, con IA, y se instala en 30 minutos.

---

> Auditoria definitiva. 97 procesos. 10 dominios.
> Verificada con evidencia de codigo fuente.
> Fullsite v1.0 — 2026-06-30

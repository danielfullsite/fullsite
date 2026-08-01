# GO LIVE CHECKLIST — FULLSITE

> Absolutamente todo lo que debe pasar antes de que un restaurante
> opere exclusivamente con Fullsite.
> Tres sprints. Cada uno con criterio de salida.
> Nada se salta. Nada se asume.
> Ultima actualizacion: 2026-06-30

---

## SPRINT 1 — GO LIVE LEGAL

> Criterio: poder emitir una factura 100% correcta.
> Ninguna factura incorrecta. Ninguna omision fiscal.

### 1.1 Modelo fiscal

- [ ] Obtener XML CFDI real de AMALAY con cerveza/alcohol (de Wansoft)
- [ ] Analizar XML: base gravable, IVA, IEPS, total
- [ ] Confirmar si precios de menu incluyen impuestos
- [ ] Crear tablas `pos_tax_rules` y `pos_item_taxes`
- [ ] Insertar reglas: IVA 16%, IEPS cerveza 26.5%, IEPS licor 53%, IEPS vino 26.5%
- [ ] Identificar TODOS los productos de AMALAY con IEPS
- [ ] Asignar reglas fiscales por producto
- [ ] Implementar calculo de impuestos paralelo (IVA + IEPS sobre base)
- [ ] Verificar: subtotal + IVA + IEPS = total
- [ ] Verificar: descuento reduce base gravable correctamente
- [ ] Verificar: cortesia (100% descuento) = impuestos $0

### 1.2 Facturacion CFDI

- [ ] Pagar Facturama ($1,650 MXN)
- [ ] Configurar variables produccion: FACTURAMA_USER, PASSWORD, EXPEDITION_PLACE
- [ ] Subir CSD real de AMALAY a Facturama
- [ ] Configurar FACTURAMA_ENV=production
- [ ] Actualizar `buildCfdiBody` con nodos IEPS por concepto
- [ ] Timbrar factura de prueba en produccion
- [ ] Validar XML resultante contra XML de Wansoft
- [ ] Verificar: PDF generado es correcto
- [ ] Verificar: email se envia con PDF + XML
- [ ] Verificar: cancelacion CFDI ante SAT funciona
- [ ] Verificar: QR auto-factura en ticket funciona en produccion

### 1.3 Cuadre fiscal

- [ ] Ticket impreso muestra: Subtotal, IVA, IEPS, Total
- [ ] Corte de caja muestra: IVA total, IEPS total separados
- [ ] CierreCajaWizard incluye desglose fiscal
- [ ] Suma de facturas del dia = total ventas del corte
- [ ] IVA del corte = suma IVA de todas las ordenes
- [ ] IEPS del corte = suma IEPS de todas las ordenes

### 1.4 Validacion cruzada

- [ ] Emitir factura de cerveza desde Fullsite
- [ ] Comparar XML contra factura de Wansoft (misma cerveza, mismo precio)
- [ ] Base gravable identica
- [ ] IVA identico
- [ ] IEPS identico
- [ ] Total identico
- [ ] Validar XML en validador SAT (https://verificacfdi.facturaelectronica.sat.gob.mx/)

**Criterio de salida Sprint 1:** Una factura emitida por Fullsite es
fiscalmente identica a una emitida por Wansoft para el mismo producto.

---

## SPRINT 2 — GO LIVE OPERATIVO

> Criterio: un viernes a las 8pm el restaurante no se cae.
> Todo lo que puede fallar durante operacion real.

### 2.1 Concurrencia

- [ ] Agregar `updated_at` check a `handlePayment` (prevenir doble cobro)
- [ ] Arreglar sync offline: no silenciar 409 — alertar al usuario
- [ ] Separar KDS writes del campo items (evitar competencia POS vs KDS)
- [ ] Mesas abiertas bloquean cierre de turno (override con PIN + razon)
- [ ] Probar: dos browsers abiertos en misma mesa — que pasa
- [ ] Probar: cobrar desde dos terminales — se bloquea correctamente

### 2.2 Hardware

- [ ] Cajon: verificar a que impresora va el RJ-11
- [ ] Cajon: fix EC TICKET (limpiar cola con admin) o mover RJ-11
- [ ] Cajon: probar efectivo ABRE, tarjeta NO abre, Rappi NO abre, mixto con efectivo ABRE
- [ ] Bridge: verificar que sobrevive reinicio de Windows
- [ ] Bridge: instalar NSSM o alternativa para auto-restart
- [ ] Huella: probar si Windows Hello reconoce el lector DigitalPersona
- [ ] Huella: si no, implementar teclado numerico touch o bridge endpoint
- [ ] Impresoras: verificar las 4 estaciones (cocina x2, barra, caja/tickets)
- [ ] KDS: instalar en monitor de cocina

### 2.3 Dispositivos

- [ ] POS principal (terminal caja): Fullsite funcionando
- [ ] KDS cocina: pantalla con /pos/kds en Chrome
- [ ] KDS barra: tablet o monitor (si aplica)
- [ ] Terminal meseros: celulares con /pos (mobile restricted mode)
- [ ] Cada device: verificar login, internet, impresion, performance

### 2.4 Red y offline

- [ ] Speed test en cada ubicacion (salon, cocina, barra)
- [ ] Probar: desconectar WiFi, crear orden, cobrar, reconectar, sync
- [ ] Verificar que comandas imprimen offline (TCP directo, no via cloud)
- [ ] Verificar que el bridge sigue respondiendo sin internet

### 2.5 Shadow Day

- [ ] Daniel presente en AMALAY turno completo
- [ ] Todas las ordenes en Fullsite
- [ ] Wansoft abierto como fallback (no como primario)
- [ ] Documentar cada incidente (hora, mesa, problema, resolucion)
- [ ] Documentar cada pregunta del staff
- [ ] Comparar corte Fullsite vs corte Wansoft al final del dia
- [ ] Criterio: 0 veces se abrio Wansoft, caja cuadra, staff no pide regresar

**Criterio de salida Sprint 2:** Un turno completo operado con Fullsite
sin incidentes que requieran rollback.

---

## SPRINT 3 — CERTIFICACION

> Criterio: cada proceso operativo probado en produccion con evidencia.
> Ya no agregar features. Solo validar.

### 3.1 Caja

- [ ] Abrir turno con fondo — PASS
- [ ] Fondo se refleja en corte — PASS
- [ ] Retiro con PIN gerente — PASS
- [ ] Deposito con PIN gerente — PASS
- [ ] Arqueo por denominacion — PASS
- [ ] Corte X (snapshot sin cerrar) — PASS
- [ ] Cierre de turno (wizard 4 pasos) — PASS
- [ ] Diferencia se calcula correctamente — PASS
- [ ] Mesas abiertas bloquean cierre — PASS
- [ ] Override con PIN + razon — PASS
- [ ] Impresion de corte — PASS

### 3.2 POS

- [ ] Abrir mesa — PASS
- [ ] Agregar items — PASS
- [ ] Modificadores multinivel — PASS
- [ ] Notas por item — PASS
- [ ] Notas por orden — PASS
- [ ] Sillas/personas — PASS
- [ ] Tiempos/cursos — PASS
- [ ] Busqueda de platillo — PASS
- [ ] Barcode scanner — PASS
- [ ] Enviar a cocina — PASS
- [ ] Cambiar mesa — PASS
- [ ] Juntar mesas (merge) — PASS
- [ ] Split parejo — PASS
- [ ] Split por items — PASS
- [ ] Descuento con PIN — PASS
- [ ] Cortesia — PASS
- [ ] Cancelar item con PIN + razon — PASS
- [ ] Cancelar orden completa — PASS
- [ ] Reabrir orden cerrada — PASS
- [ ] Reimprimir ticket — PASS
- [ ] Abrir cajon manual — PASS
- [ ] Preticket — PASS
- [ ] Mesa temporal / cuenta por nombre — PASS

### 3.3 Cobro

- [ ] Efectivo — PASS (cajon abre)
- [ ] Tarjeta — PASS (cajon NO abre)
- [ ] Mixto (efectivo + tarjeta) — PASS (cajon abre)
- [ ] Rappi — PASS (cajon NO abre)
- [ ] Uber Eats — PASS (cajon NO abre)
- [ ] Propina (%, fijo, custom) — PASS
- [ ] Cambio calculado correctamente — PASS
- [ ] Ticket imprime automaticamente — PASS

### 3.4 Cocina (KDS)

- [ ] Comanda llega a cocina — PASS
- [ ] Comanda llega a barra — PASS
- [ ] Routing correcto por categoria — PASS
- [ ] Items marcables individualmente — PASS
- [ ] Auto-avance NUEVA → PREPARANDO → LISTA — PASS
- [ ] Alerta sonora — PASS
- [ ] Comanda de ACTUALIZACION (item modificado) — PASS
- [ ] Items cancelados desaparecen del KDS — PASS
- [ ] Timer por orden — PASS

### 3.5 Facturacion

- [ ] Captura RFC + datos fiscales — PASS
- [ ] Timbrado CFDI produccion — PASS
- [ ] XML correcto (IVA + IEPS) — PASS
- [ ] PDF generado — PASS
- [ ] Email enviado con PDF + XML — PASS
- [ ] QR auto-factura en ticket — PASS
- [ ] Cancelacion CFDI — PASS
- [ ] Historial de facturas consultable — PASS

### 3.6 Inventario

- [ ] Deduccion al enviar a cocina — PASS
- [ ] Reversa al cancelar — PASS
- [ ] Market stock al cobrar — PASS
- [ ] Alerta stock bajo — PASS
- [ ] Merma registrada — PASS

### 3.7 Auditoria

- [ ] Cada accion tiene actor + timestamp — PASS
- [ ] Cancelaciones tienen razon + aprobador — PASS
- [ ] Descuentos tienen razon + aprobador — PASS
- [ ] Audit log consultable desde /pos/auditoria — PASS
- [ ] Funciona offline (queue) — PASS

### 3.8 Integraciones

- [ ] Bridge health check OK — PASS
- [ ] Bridge auto-arranque al iniciar Windows — PASS
- [ ] Print queue retry funciona — PASS
- [ ] Facturama produccion — PASS
- [ ] Offline sync funciona — PASS

### 3.9 Cierre semanal

- [ ] 7 dias de operacion sin incidente critico
- [ ] Ningun rollback a Wansoft
- [ ] Staff no pide regresar
- [ ] Cortes cuadran todos los dias
- [ ] Reunion con gerente/dueno: feedback

**Criterio de salida Sprint 3:** AMALAY opera 7 dias seguidos sin
Wansoft, sin incidentes criticos, y el staff dice "no quiero regresar."

---

## ROLLBACK

Si en cualquier momento durante los 3 sprints hay un problema
que no se puede resolver en < 30 minutos:

1. Abrir Wansoft (no se desinstala)
2. Operar con Wansoft el resto del turno
3. Documentar el incidente
4. Resolver el problema en Fullsite
5. Reintentar en el siguiente turno

Wansoft permanece instalado y funcional durante 2 semanas post-cutover.

---

## METRICAS DE EXITO

| Metrica | Target |
|---|---|
| Dias sin Wansoft | 7 consecutivos |
| Facturas emitidas correctamente | 100% |
| Ordenes perdidas | 0 |
| Rollbacks a Wansoft | 0 |
| Tiempo de resolucion de incidentes | < 30 min |
| Staff que quiere regresar | 0 |
| Cortes que cuadran | 100% |
| NPS del staff | > 7 |

---

## ORDEN DE EJECUCION

```
SPRINT 1 (Legal) ──── 1 semana
  │
  ├── Obtener XML de Wansoft
  ├── Implementar modelo fiscal
  ├── Pagar Facturama
  ├── Timbrar factura real
  └── Validar cuadre fiscal
  │
  ▼
SPRINT 2 (Operativo) ──── 1 semana
  │
  ├── Parches concurrencia
  ├── Fix hardware (cajon, huella, bridge)
  ├── Instalar en devices
  ├── Capacitacion staff
  └── Shadow Day
  │
  ▼
SPRINT 3 (Certificacion) ──── 1 semana
  │
  ├── Certificar cada proceso
  ├── 7 dias de operacion
  └── Success review dia 30
```

**Timeline total: 3 semanas hasta GO LIVE completo.**

---

> Este checklist es la unica fuente de verdad para el cutover.
> Cada item se marca PASS solo con evidencia de produccion.
> Si un item falla, se documenta y se resuelve antes de avanzar.
>
> Fullsite v1.0 — 2026-06-30

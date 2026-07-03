# CUTOVER CHECKLIST — AMALAY RC1

> Checklist operativo para el martes.
> Ejecutar paso por paso. No depender de memoria.
> Cada item se marca PASS solo con evidencia.

---

## ANTES DE ABRIR (06:30 - 07:00)

### Infraestructura

- [ ] Bridge CAJA corriendo (`127.0.0.1:7717/health` → `ok:true`)
- [ ] Bridge ENTRADA corriendo (`127.0.0.1:7717/health` → `ok:true`)
- [ ] Internet estable (speed test > 5 Mbps)
- [ ] Chrome abierto en modo PWA (F11 fullscreen) en cada terminal
- [ ] Supabase accesible (dashboard carga datos)

### Impresoras

- [ ] COCINA FRIA (192.168.1.21) — test print OK
- [ ] COCINA CALIENTE (192.168.1.40) — test print OK
- [ ] BARRA (192.168.1.30) — test print OK
- [ ] PANADERIA caja (USB PANADERIA / TCP 192.168.1.250) — test print OK
- [ ] TICKET caja (USB EC01) — test print OK
- [ ] TICKET entrada (USB TICKET) — test print OK

### KDS

- [ ] Pantalla cocina encendida con `/pos/cocina`
- [ ] Polling activo (ordenes aparecen en < 3 seg)
- [ ] Settings: alerta configurada (10 min)
- [ ] Batch counter visible
- [ ] Sin ordenes viejas (auto-archive 4h)

### POS

- [ ] Login funciona en CAJA (PIN)
- [ ] Login funciona en ENTRADA (PIN)
- [ ] Mapa de mesas carga correctamente
- [ ] Menu completo visible (522 items)
- [ ] Turno abierto con fondo de caja

### Datos

- [ ] Staff correcto (verificar 3 nombres al azar)
- [ ] Precios correctos (verificar 5 items al azar vs menu fisico)
- [ ] Formas de pago configuradas

---

## TEST DE HUMO (07:00 - 07:15)

Orden de prueba completa antes del primer cliente:

- [ ] Abrir mesa de prueba
- [ ] Agregar 1 item de cocina + 1 de barra + 1 de panaderia
- [ ] Agregar modificadores a al menos 1 item
- [ ] Enviar a cocina
- [ ] Verificar: comanda imprime en cocina
- [ ] Verificar: comanda imprime en barra
- [ ] Verificar: KDS recibe la orden (< 3 seg)
- [ ] En KDS: 1 click en item → cambia a preparando
- [ ] En KDS: 2 clicks → item desaparece
- [ ] Cobrar con efectivo → cajon abre
- [ ] Ticket imprime
- [ ] Cancelar/reabrir la orden de prueba (no afectar corte)

**Si alguno falla → resolver antes de abrir. Si no se resuelve en 15 min → usar Wansoft.**

---

## DURANTE EL TURNO

### Primera hora (monitoreo intensivo)

- [ ] Primera orden REAL procesada sin errores
- [ ] KDS recibe ordenes correctamente
- [ ] Impresoras responden consistentemente
- [ ] Bridge health check cada 30 min
- [ ] Ninguna orden perdida
- [ ] Ninguna comanda duplicada

### Incidentes — registrar en AMALAY-LOG

```
| Hora | Terminal | Mesa | Problema | Resolucion | Tiempo | Causa |
|------|----------|------|----------|------------|--------|-------|
|      |          |      |          |            |        |       |
```

### Señales de alarma (abrir Wansoft si ocurren)

- Bridge no responde despues de 2 reintentos
- Impresora de cocina deja de imprimir > 2 min sin recovery
- Ordenes no llegan al KDS > 1 min
- Mas de 3 incidentes en 30 minutos
- Staff pide regresar (escuchar, evaluar, no forzar)

---

## AL CERRAR

### Reconciliacion

- [ ] Total de ordenes Fullsite vs Wansoft (si ambos operaron)
- [ ] Total de ventas coincide
- [ ] Numero de tickets coincide
- [ ] Formas de pago cuadran
- [ ] Cancelaciones registradas
- [ ] Descuentos registrados
- [ ] Dashboard refleja datos del dia

### Cierre de turno

- [ ] Arqueo de caja (wizard de denominaciones)
- [ ] Diferencia aceptable (< $100)
- [ ] Turno cerrado con PIN gerente
- [ ] Corte impreso

### Integridad

- [ ] Audit log: verificar ultimas 10 acciones son correctas
- [ ] Event store: sin eventos duplicados
- [ ] Supabase: ordenes del dia coinciden con lo operado
- [ ] Bridge: uptime continuo (verificar en logs)

---

## RIESGOS ACEPTADOS PARA RC1

| Riesgo | Severidad | Aceptado | Mitigacion |
|---|---|---|---|
| KDS itemStatus en localStorage (no Supabase) | Medio | Si | Se limpia a las 4h. Chef refresca si hay inconsistencia |
| Sin audit de item_preparing/item_ready | Bajo | Si | El advance de orden si se loguea |
| Inventario desactivado | Medio | Si | No impacta ventas ni cobros |
| Sin IEPS | Bajo | Si | AMALAY IEPS=0 en todos los productos |
| Facturama no pagado | Alto | Si | Facturacion manual como workaround |
| Sin integracion Uber/Rappi | Medio | Si | Operan manual con tablet |
| Concurrencia multi-terminal limitada | Medio | Si | 1 terminal principal. Parches aplicados |
| Sin modo Comandero/Caja | Bajo | Si | Permisos por rol ya implementados |
| EC TICKET atascada en caja | Bajo | Si | Workaround EC01 funciona |
| Bridge depende de CMD abierto | Medio | Si | Startup bat configurado. Staff instruido |

---

## GO / NO-GO

**Criterios GO (todos deben cumplirse):**

- [ ] Bridge health OK en ambas terminales
- [ ] Las 6 impresoras responden
- [ ] Test de humo completo sin errores
- [ ] KDS recibe ordenes en < 3 segundos
- [ ] Al menos 1 cobro de prueba exitoso
- [ ] Gerente dice GO

**Si alguno falla → NO-GO → usar Wansoft hasta resolver.**

---

> RC1 — Release Candidate 1
> Martes 8 julio 2026
> Fullsite — Restaurant Operating System

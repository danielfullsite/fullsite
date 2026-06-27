# PRE-FLIGHT CHECKLIST — AMALAY

Objetivo: llegar al restaurante con la mayor cantidad de problemas resueltos.
Minimizar tiempo in situ. Maximizar probabilidad de exito.

---

## 0. REPORTE DE DIFERENCIAS WANSOFT vs FULLSITE

### Precios

Fullsite almacena precios SIN IVA. El POS agrega 16% al cobrar.
Wansoft reporta precio promedio real cobrado (CON IVA, incluye descuentos y cortesias).

Por eso los numeros no matchean directamente, pero el precio final al cliente
deberia ser comparable.

**Items con diferencia significativa (verificar contra menu fisico):**

| Item | Wansoft promedio | Fullsite + IVA | Diferencia |
|------|-----------------|---------------|------------|
| Enchiladas Suizas | $225.60 | $295.80 | -$70.20 |
| Combo Fit | $222.71 | $290.00 | -$67.29 |
| Egg and Pancake Combo | $224.90 | $290.00 | -$65.10 |
| Avocado Toast | $218.32 | $278.40 | -$60.08 |
| Machacado con Huevo | $227.99 | $278.40 | -$50.41 |
| Coca Cola Regular | $39.59 | $69.60 | -$30.01 |
| Croissant Nutella | $83.12 | $114.84 | -$31.72 |
| Jugo Verde de la Casa | $82.78 | $110.20 | -$27.42 |
| Concha de Mantequilla | $34.10 | $60.32 | -$26.22 |

**Nota:** las diferencias de Wansoft pueden ser por descuentos frecuentes,
cortesias, o precios de evento que bajan el promedio. El precio de Fullsite
debe coincidir con el menu fisico del restaurante, no con el promedio de Wansoft.

**Accion:** llevar menu fisico al restaurante y verificar los 9 items de arriba.

### Items

| Metrica | Valor |
|---------|-------|
| Items en Fullsite | 522 activos |
| Items en Wansoft (con ventas) | 517 |
| Items que matchean por nombre | 363 |
| Items solo en Fullsite | 1 |
| Items solo en Wansoft | 154 |

**154 items en Wansoft no estan en Fullsite.** Probablemente son items
descontinuados, temporales o de evento. Verificar con Monica que ningun
item activo del menu falte.

### Staff

| Metrica | Valor |
|---------|-------|
| Staff en Supabase | 50 |
| Staff con PIN | 50 (100%) |

**Accion:** verificar que los PINs son los reales del staff, no datos demo.

### Payment Methods

10 metodos configurados: Efectivo, TC, TD, Transferencia, UberEats,
Rappi, DiDi Food, Clip, NetPay, aDomicilio. Verificar que no falta ninguno.

---

## 1. SOFTWARE (verificable antes de ir)

| # | Item | Status | Notas |
|---|------|--------|-------|
| S1 | Menu items importados | OK (522) | Verificar precios de 9 items con menu fisico |
| S2 | Staff con PINs | OK (50/50) | Verificar que no son datos demo |
| S3 | Payment methods | OK (10) | Verificar completitud con gerente |
| S4 | Station routing | OK | 40+ keywords bebidas, 18+ caja |
| S5 | Mesas configuradas | OK (31) | Hardcoded del plano |
| S6 | Service Worker v2 | OK | Cache shell + API |
| S7 | PWA manifest | OK | Fullscreen, landscape |
| S8 | Offline sync | OK | Certificado OFF-02 |
| S9 | Print queue | OK | BUG-005 certificado |
| S10 | Audit queue | OK | A3 certificado |
| S11 | Cobros | OK | COBRO-01 a 04 certificados |
| S12 | Corte de caja | OK | COBRO-06/10 certificado |
| S13 | Bloqueo cobro sin envio | OK | COBRO-00 certificado |
| S14 | Facturama endpoint | OK (codigo) | FALTA: cuenta activa ($1,650) |

### Acciones ANTES de ir

- [ ] Activar Facturama ($1,650) y configurar API key
- [ ] Verificar PINs con Monica — son los reales?
- [ ] Preparar USB con `fullsite-print-bridge-win64.zip`
- [ ] Probar CFDI de prueba en sandbox
- [ ] Imprimir este documento

---

## 2. HARDWARE (solo verificable in situ)

| # | Item | Verificar |
|---|------|-----------|
| H1 | Terminal POS | Windows version, Chrome/Edge actualizado |
| H2 | Monitor KDS cocina | Pantalla, resolucion, conexion |
| H3 | Impresora cocina | Marca, modelo, IP, conexion |
| H4 | Impresora barra | Marca, modelo, IP, conexion |
| H5 | Impresora caja | Marca, modelo, IP, conexion |
| H6 | Cajon de dinero | Conectado a que impresora, que pin |
| H7 | Terminal tarjeta | Clip/NetPay, standalone o integrado |

**Llevar:** libreta, USB con bridge, cable Ethernet backup, impresora 58mm backup,
papel termico, cargador.

---

## 3. RED (solo verificable in situ)

| # | Item | Como verificar |
|---|------|----------------|
| R1 | WiFi salon | Speed test desde ubicacion de la terminal |
| R2 | WiFi cocina | Speed test desde ubicacion del KDS |
| R3 | WiFi barra | Speed test |
| R4 | Acceso Supabase | curl desde terminal |
| R5 | Acceso app.fullsite.mx | Abrir en browser |
| R6 | Acceso bridge local | http://127.0.0.1:7717/health |
| R7 | IPs fijas vs DHCP | Config del router |
| R8 | Latencia | ping a Supabase, target <200ms |

---

## 4. TIMELINE DE LA VISITA

```
08:00  Llegada. Revisar que la terminal encienda. Abrir app.fullsite.mx.
08:10  Speed test WiFi en salon, cocina, barra. Anotar resultados.
08:20  Instalar print bridge en terminal Windows.
       Ejecutar fullsite-print-bridge.exe.
       Verificar http://127.0.0.1:7717/health responde OK.
08:35  Configurar IP impresora cocina en bridge.
       Enviar test de impresion a cocina.
       Si falla: verificar IP, firewall, red.
08:45  Configurar IP impresora barra.
       Enviar test de impresion a barra.
09:00  Configurar IP impresora caja/ticket.
       Enviar test de impresion a caja.
09:15  Test cajon de dinero via bridge.
09:25  KDS: abrir /pos/cocina en monitor de cocina.
       Verificar legibilidad a distancia real.
09:35  Flujo completo #1:
       Mesa -> agregar item cocina + barra -> enviar ->
       comanda sale en cocina + barra -> cobrar efectivo ->
       ticket sale en caja + cajon abre.
09:50  Flujo offline:
       Desconectar WiFi -> crear orden -> reconectar -> sync.
10:05  Cobro tarjeta (cajon NO abre).
       Cobro mixto (cajon SI abre).
       Descuento con PIN gerente.
       Cancelacion item con PIN gerente.
10:30  Facturacion (si Facturama activo):
       Solicitar factura -> verificar timbrado.
10:45  Verificar precios de 9 items contra menu fisico.
       Verificar PINs con 2-3 meseros reales.
11:00  CAPACITACION:
       Meseros: abrir mesa, agregar items, modificadores, enviar, cobrar.
       Cajero: corte, fondo, arqueo.
       Gerente: descuentos, cancelaciones, reapertura.
       Cocina: KDS, avanzar status.
12:00  SHADOW PARCIAL (opcional si el turno lo permite):
       1-2 mesas reales operadas en Fullsite, Wansoft como respaldo.
12:30  Documentar: que funciono, que fallo, que preguntas hubo.
```

---

## 5. PLAN DE CONTINGENCIA

Para cada problema que pueda ocurrir durante la implementacion o el
Shadow Day, definir: que pasa, que hacer, quien decide, cuanto esperar.

### Impresion

| Problema | Que hacer | Tiempo maximo | Escalacion |
|----------|-----------|---------------|------------|
| Bridge no inicia | Verificar puerto 7717, firewall, antivirus. Reiniciar. | 10 min | Si no se resuelve: usar BT directo |
| Impresora no responde | Verificar IP, cable, encendido. Imprimir pagina test desde Windows. | 5 min | Cambiar a impresora backup USB |
| Comanda no sale | Verificar station routing. El item esta en la categoria correcta? | 5 min | Imprimir manualmente desde admin |
| Cajon no abre | Verificar conexion cajon-impresora. Probar ESC/POS manual. | 5 min | Abrir con llave. No bloquea operacion |

### Red

| Problema | Que hacer | Tiempo maximo | Escalacion |
|----------|-----------|---------------|------------|
| WiFi se cae | El POS sigue operando offline. Ordenes se encolan. | Ilimitado | Reconectar cuando vuelva. syncAll automatico |
| Supabase no responde | Verificar con otro device. Si es caida de Supabase: modo offline. | 15 min | Si >15 min: rollback a Wansoft |
| Latencia alta (>500ms) | Verificar carga de red. Desconectar devices no esenciales. | 10 min | Operar, pero sin features en tiempo real |

### POS

| Problema | Que hacer | Tiempo maximo | Escalacion |
|----------|-----------|---------------|------------|
| Login con PIN falla | Verificar PIN correcto. Verificar Supabase accesible. | 5 min | Crear PIN temporal via Supabase admin |
| Orden no se guarda | Verificar conexion. Si offline: verificar IndexedDB. | 5 min | Si persiste: rollback a Wansoft para esa mesa |
| Cobro falla | Verificar saveOrder. Si offline: orden se encola. | 5 min | Si no se resuelve: cobrar en Wansoft, documentar |
| Precio incorrecto | Verificar item en pos_menu_items. Corregir en admin. | 2 min | Si muchos items: pausar, corregir batch, continuar |

### Facturacion

| Problema | Que hacer | Tiempo maximo | Escalacion |
|----------|-----------|---------------|------------|
| Facturama no timbra | Verificar API key, saldo, sandbox vs produccion. | 10 min | Anotar datos del cliente. Facturar despues manualmente |
| Cliente pide factura y no funciona | Tomar datos manualmente. Timbrar despues. | 0 min (no bloquear) | Facturar en las siguientes 72 hrs (legal) |

### Decision de rollback

| Criterio | Accion |
|----------|--------|
| >3 mesas sin poder cobrar en 30 min | Rollback a Wansoft |
| Impresion no funciona despues de 15 min de troubleshoot | Rollback a Wansoft |
| Staff pide regresar a Wansoft unanimemente | Rollback a Wansoft |
| Bug critico que no se resuelve en 10 min | Rollback para esa mesa, seguir con Fullsite en las demas |

**Quien decide rollback:** Daniel (presente en el restaurante).
**Como regresar:** Wansoft sigue instalado. Solo abrir Wansoft y tomar la orden ahi.
**Que documentar:** hora, mesa, problema, resolucion, tiempo perdido.

---

## 6. CRITERIO DE EXITO

Al terminar la visita, responder SI a todas:

1. Las 3 impresoras imprimen desde Fullsite?
2. El cajon se abre desde Fullsite?
3. El KDS muestra ordenes en la cocina?
4. Un mesero puede login, tomar orden, enviar y cobrar?
5. El sistema funciona sin internet por 2 minutos?
6. Los precios de los 9 items verificados son correctos?
7. Al menos 3 meseros completaron el flujo de capacitacion?
8. La facturacion esta lista (o tiene fecha de activacion)?

Si alguna es NO: documentar por que y que falta.

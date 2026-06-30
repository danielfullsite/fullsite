> **ARCHIVED.** Replaced by: `deployment/CUTOVER-PLAYBOOK.md`
>
> This document is kept for historical reference only.

# Manual de migración: Wansoft → Fullsite POS (AMALAY)

> Para: Daniel. Última actualización: 2026-06-12.
> Plan: preparación → piloto sombra (3 turnos) → validación → cutover → post-cutover.
> Regla de oro: **Wansoft no se apaga hasta que 3 cortes seguidos cuadren al centavo.**

---

## Resumen en una página

| Fase | Qué pasa | Quién cobra de verdad | Duración |
|---|---|---|---|
| 0. Preparación | IPs, bridge, PINs, menú | Wansoft | 1 visita a AMALAY |
| 1. Piloto sombra | Los dos sistemas en paralelo | Wansoft | 3 turnos |
| 2. Validación | Comparar cortes, arreglar diferencias | Wansoft | 1-2 días |
| 3. Cutover | Fullsite toma el control | **Fullsite** | 1 día (lunes o martes, día flojo) |
| 4. Post-cutover | CFDI producción, Wansoft backup frío | Fullsite | 2 semanas de vigilancia |

---

## Fase 0 — Preparación (1 visita a AMALAY)

### 0.1 Sacar las IPs de las 5 impresoras
- [ ] En cada EC-PM-80250: apágala, mantén presionado el botón **FEED**, enciéndela sin soltar — imprime la self-test page con la IP.
- [ ] Anota ubicación + IP: cocina1, cocina2, barra, caja, entrada.
- [ ] Verifica que las 5 estén en la misma red que la terminal (ping desde la terminal).
- [ ] Mándame las IPs → yo lleno `printers.json` y compilo el bridge `.exe`.

**Mapeo final** (ya soportado por el código, no requiere cambios — solo `printers.json`):

| Impresora física | Estación en `printers.json` | Imprime |
|---|---|---|
| Cocina 1 + 2 | `cocina` (fan-out a ambas) | Comandas comida |
| Barra | `barra` | Comandas bebidas |
| Caja | `tickets` (**default**) | Tickets de cobro, pre-cuentas, QR factura + **cajón RJ11** |
| Entrada | `caja` | Comandas Market (toast, bakery, mkt-*) |

> Son **5 impresoras físicas** (Mónica 2026-06-12). El truco: el POS manda
> comandas Market con `station: "caja"`, pero tickets de cobro/precuenta/cajón
> van sin estación → caen al `default` (`tickets`). Entrada y Caja quedan en
> impresoras distintas sin tocar código. Ver `fullsite-os/tools/print-bridge/printers.example.json`.

### 0.2 Instalar el print bridge en la terminal Windows
- [ ] Copiar el `.exe` y `printers.json` a `C:\fullsite\`.
- [ ] Ejecutarlo y verificar `http://127.0.0.1:7717/health` en el browser de la terminal.
- [ ] Imprimir ticket de prueba a CADA una de las 5 impresoras desde el POS.
- [ ] Probar apertura de cajón (RJ11 en la impresora de caja).
- [ ] Dejarlo como tarea programada de Windows (inicia al arrancar).

### 0.3 Abrir el POS en la terminal
- [ ] Browser en modo kiosk apuntando al POS (misma terminal all-in-one de Wansoft — conviven).
- [ ] Login y verificar que carga el menú completo (248 items de BD).

### 0.4 Staff y PINs
- [ ] Capturar a TODO el staff real en `pos_staff` con su rol (admin/gerente/cajero/mesero).
- [ ] PIN de 4 dígitos por persona — el de gerente protege: cancelaciones, descuentos, reabrir cuentas, corte.
- [ ] Lista actual de meseros: Omar, Héctor, Brayan, Daniela, Julio, Mauricio, Oscar Ríos, Alexis, Aldo, Mariana, Mario (+ cajeros Oscar Ricardo y Rodrigo; Market: Fany, Ericka, Frida, Jorge).

### 0.5 Verificación de menú y precios
- [ ] Muestreo de 20 items contra el menú físico/Wansoft: nombre, precio, categoría correcta.
- [ ] Verificar que cada categoría tiene color y que el grid no necesita scroll (ya arreglado, confirmar en la pantalla real).
- [ ] Probar 1 item de cada estación: que la comanda salga en la impresora correcta.

---

## Fase 1 — Piloto sombra (3 turnos completos)

**Objetivo**: capturar TODO lo que pasa en el restaurante en ambos sistemas y comparar al final de cada turno.

### Reglas del piloto
1. **Wansoft sigue siendo el sistema oficial**: cobra, factura e imprime comandas de cocina.
2. Fullsite captura en paralelo TODAS las órdenes (un cajero o tú duplican la captura).
3. **Comandas físicas las imprime SOLO Wansoft** durante el piloto — en Fullsite se desactiva la impresión de comandas (o se usa el KDS en pantalla) para no duplicar papel en cocina.
4. Tickets de cobro de Fullsite: solo de prueba, no se entregan al cliente.
5. Abrir turno en Fullsite (`/pos/turno`) con el mismo fondo de caja que Wansoft.

### Al final de cada turno
- [ ] Corte Fullsite (`/pos/corte`, modo "Turno actual") vs corte Wansoft (corte X/Z).
- [ ] Comparar: ventas totales, # órdenes, efectivo, tarjeta, transferencia, descuentos, propinas, cancelaciones.
- [ ] Anotar CUALQUIER diferencia con su causa (orden no capturada, item con precio distinto, etc.).
- [ ] Conteo físico de efectivo vs "Efectivo en caja" de Fullsite.

### Criterio para pasar a Fase 2
- 3 turnos donde toda diferencia quede explicada (idealmente $0.00).
- Cero tickets corruptos / impresoras caídas durante el servicio.
- Staff capturando sin ayuda al tercer turno.

---

## Fase 2 — Validación y capacitación

- [ ] Arreglar todo lo que el piloto haya encontrado (yo).
- [ ] Capacitación de 30 min al staff: crear orden, sillas/tiempos, modificadores, enviar a cocina, pre-cuenta, cobrar (efectivo/tarjeta/mixto/split), propinas, y QUÉ requiere PIN de gerente.
- [ ] Imprimir hoja de referencia rápida y pegarla junto a la caja.
- [ ] Definir el flujo de facturas durante la transición: cliente escanea QR del ticket → llena datos → Mónica timbra manual desde `/pos/facturacion` (hasta activar PAC).
- [ ] Simulacro de contingencia: ¿qué hacemos si se cae internet? (el POS tiene cola offline — las órdenes se guardan local y sincronizan al volver; practicarlo una vez).

---

## Fase 3 — Cutover (día D)

**Elegir un día flojo (lunes/martes). Empezar desde la apertura, nunca a media jornada.**

Antes de abrir:
- [ ] Cerrar el último turno en Wansoft la noche anterior (corte Z final).
- [ ] Abrir turno en Fullsite con el fondo real contado.
- [ ] Activar impresión de comandas en Fullsite (ya no es sombra).
- [ ] Wansoft queda ABIERTO pero sin uso (backup caliente solo el día D).

Durante el día:
- [ ] Yo disponible todo el servicio (remoto o en sitio) para cualquier tema.
- [ ] Cualquier cosa que no se pueda resolver en 5 minutos → se anota y se resuelve después del servicio; el servicio no se detiene.

Criterio de rollback (volver a Wansoft ese mismo día) — solo si:
- Las impresoras de cocina fallan y no hay workaround (KDS en tablet como plan B), o
- El POS no puede cobrar (sin internet Y la cola offline falla).
- Rollback = volver a capturar en Wansoft; lo ya cobrado en Fullsite queda registrado y se suma manual al corte.

Al cierre:
- [ ] Corte Fullsite + conteo físico de efectivo.
- [ ] Si cuadra: día 1 logrado. Wansoft pasa a backup frío (no se desinstala).

---

## Fase 4 — Post-cutover (2 semanas)

- [ ] Corte diario vs depósitos Santander durante 2 semanas.
- [ ] Activar CFDI producción: contratar Facturama API (~$1,650/año + ~$0.50/timbre), subir CSD de AMALAY, env vars en Vercel (`FACTURAMA_USER/PASSWORD/EXPEDITION_PLACE`, `FACTURAMA_ENV=production`). Las solicitudes acumuladas en `pendiente` se timbran al activarlo.
- [ ] Cancelar/no renovar Wansoft solo después de 2 semanas en verde y CFDI funcionando.
- [ ] Después del cutover (no antes): promos MVP + barcode Market (lo pidió Eduardo, no bloquea), reconciliación delivery en corte.

---

## Estado actual de bloqueantes (2026-06-12)

| # | Tema | Estado |
|---|---|---|
| 1 | Corte por turno | ✅ Resuelto (toggle Turno actual / Por día) |
| 2 | SQL delivery_orders | ✅ Aplicado y verificado |
| 3 | Lógica de pagos/splits | ✅ Auditada, 1,440 tests en verde |
| 4 | IPs impresoras + bridge instalado | ⬜ Fase 0 — siguiente visita a AMALAY |
| 5 | PINs staff reales | ⬜ Fase 0 |
| 6 | CFDI producción | ⬜ Fase 4 (no bloquea piloto ni cutover; manual mientras) |

**El único paso entre hoy y el piloto es la Fase 0 — una visita a AMALAY con la terminal.**

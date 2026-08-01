# P0 Execution Plan — POS V2 Architecture Freeze
> Creado: 2026-07-23
> Aprobado: 2026-07-23 — Architecture Freeze confirmado. Reglas de certificación y milestone final definidos.
> Referencia: POS-V2-SPEC.md v2.1 (ARCHITECTURE FREEZE)

---

## Filosofía de validación

> "No buscamos demostrar que funciona. Buscamos encontrar la razón por la que podría fallar."
> — Daniel Ramonfaur, 2026-07-23

Cada gate de validación se ejecuta en modo adversarial: el objetivo es romper el flujo, no confirmarlo. Si el P0 sobrevive a ese nivel de estrés, merece CERTIFIED. Si no sobrevive, se corrige dentro del mismo ciclo — no se abre un P1 ni se avanza al siguiente P0.

---

## Definición oficial de CERTIFIED

### Criterios de entrada (antes de iniciar validación)
- [ ] Implementación completa en `main`
- [ ] Compilación TypeScript limpia
- [ ] Alcance congelado — ningún cambio de diseño durante la validación

### Evidencia requerida (durante la validación)
- [ ] Video continuo sin cortes del flujo completo
- [ ] Contexto operativo registrado: hora, order_id, estación, batch si aplica
- [ ] Condición de falla inducida documentada (qué se rompió y cómo)
- [ ] Resultado observado (comportamiento real vs. esperado)
- [ ] Audit log correspondiente (screenshot o export)

### Criterios de salida
Solo dos estados válidos:

**🟢 CERTIFIED** — todos los criterios de aceptación se cumplen con evidencia archivada. Bibles actualizadas. Estado actualizado en este documento con fecha y firma.

**🔴 DEFECTO** — existe una desviación reproducible respaldada por evidencia suficiente para corregirla sin estar presente en el restaurante. Vuelve al ciclo de corrección dentro del mismo P0.

**No existe:** "casi certificado", "parece funcionar", "aprobado por intuición". Si falta evidencia, el P0 sigue en validación. La certificación significa que funcionó en operación real bajo condiciones adversariales, no solo en pruebas.

---

## Regla de arquitectura post-freeze

Los bugs NO modifican el modelo. Las optimizaciones NO modifican el modelo. Las features P1 NO modifican el modelo. Los refactors NO modifican el modelo.

Si una implementación necesita cambiar el flujo canónico, un guard, ownership boundaries, domain events, entidades o invariantes: se abre primero un RFC, se aprueba, y solo entonces cambia la spec. Nunca al revés.

---

## Estado general

| P0 | Nombre | Estado |
|---|---|---|
| P0-1 | Cierre con órdenes abiertas (GUARD-08 soft block) | ABIERTO — Diseño aprobado, listo para implementar |
| P0-2 | Reimpresión de comanda desde KDS/cocina/barra | **EN VALIDACIÓN** — Código completo 2026-07-23, pendiente gates técnico y campo |
| P0-3 | Renovación y validación del CSD Facturama | ABIERTO — Acción de Daniel, vence 2026-08-03 |
| P0-4 | Local-First Restaurant Runtime & Offline Continuity | **DESIGN GATE** — RFC aprobado 2026-07-24, pendiente RCA técnico Fase 0 |

---

## Milestone: POS V2 Operational Certification

Este milestone se declara solo cuando los 4 P0 están CERTIFIED **y** el sistema ha demostrado funcionamiento sostenido en operación real.

**Requisitos del milestone (todos deben cumplirse):**

- [ ] P0-1 CERTIFIED
- [ ] P0-2 CERTIFIED
- [ ] P0-3 CERTIFIED
- [ ] P0-4 CERTIFIED
- [ ] 7 días consecutivos operando en AMALAY sin intervención
- [ ] Cero pérdida de órdenes
- [ ] Cero diferencias de arqueo no explicadas
- [ ] Cero pérdidas de inventario por software
- [ ] Cero fallas de impresión no recuperables en esos 7 días
- [ ] Facturación CFDI operando correctamente (≥1 CFDI emitido por día de operación)
- [ ] Sin incidentes P0 abiertos al finalizar los 7 días

Cuando este milestone se cumple: Fullsite POS V2 está **operacionalmente certificado**. Solo entonces se abren los P1.

---

## Secuencia oficial del proyecto

```
Research
    ↓
Architecture Freeze (POS V2.1)  ✓  2026-07-23
    ↓
P0 Execution                    ← AQUÍ ESTAMOS
    ↓
P0 Certification
    ↓
POS V2 Operational Certification
    ↓
P1 Features
    ↓
Pilot Expansion
    ↓
General Availability (GA)
```

---

---

## P0-1 — Cierre con órdenes abiertas (GUARD-08 soft block)

### HECHO — Estado actual en código
- `CierreCajaWizard.tsx` ejecuta un check de órdenes abiertas al iniciar el wizard.
- Si hay órdenes con `status in ('enviada','preparando','lista','entregada')` para el `turno_id`, el wizard **bloquea completamente** — no hay opción de continuar.
- Confirmado en auditoría (sesión 2026-07-22): el bloqueo es un hard block sin escalation posible.

### RCA
El hard block asume que un turno siempre puede esperar a que todas las mesas cierren. En operación real, un gerente necesita iniciar el cierre mientras la última mesa termina. La limitación da poder de veto operativo involuntario a una sola mesa.
Wansoft resuelve esto con una opción configurable de "permitir corte Z con órdenes abiertas". El modelo de negocio lo requiere.

### Diseño aprobado
Ver POS-V2-SPEC.md § Guards — GUARD-08 y § Cierre de turno — CierreCajaWizard.
Resumen de comportamiento:
1. Wizard detecta órdenes abiertas → muestra lista (mesa/nombre, status, total, mesero)
2. Opción A: volver al POS y cerrar las órdenes
3. Opción B (solo gerente/admin): escalation in-place
   - PIN de gerente en pantalla (sin cerrar sesión del cajero)
   - Segunda confirmación explícita
   - Nota obligatoria ≥ 10 caracteres
4. Las órdenes abiertas se registran en `pos_cierre_intentos.ordenes_pendientes`
5. Al abrir el siguiente turno: banner de alerta con lista expandible
6. Las órdenes huérfanas **nunca desaparecen del mapa** — la mesa sigue marcada como ocupada

### Implementación — Archivos y cambios

**DB:**
```sql
-- Agregar columnas a pos_cierre_intentos (si no existen):
ALTER TABLE pos_cierre_intentos
  ADD COLUMN IF NOT EXISTS ordenes_pendientes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cierre_con_ordenes_abiertas boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cierre_autorizado_por text,
  ADD COLUMN IF NOT EXISTS cierre_nota text;
```

**Archivos a modificar:**
- `src/components/pos/CierreCajaWizard.tsx`
  - Paso 1: cambiar hard block → soft block con lista de órdenes
  - Agregar botón "Continuar con autorización de gerente"
  - Agregar modal de escalation in-place (PIN + confirmación + nota)
  - Al guardar cierre exitoso: incluir `ordenes_pendientes`, `cierre_con_ordenes_abiertas`, `cierre_autorizado_por`, `cierre_nota`
- `src/app/pos/turno/page.tsx` (o donde se abre el turno)
  - Al abrir turno: verificar si el cierre anterior tiene `ordenes_pendientes.length > 0`
  - Si sí: mostrar banner de alerta con lista expandible antes de permitir crear órdenes

**Invariante que el código debe respetar:**
- Las órdenes en `ordenes_pendientes` deben seguir siendo cobables y visibles en el mapa después del cierre.
- El `turno_id` de esas órdenes no cambia — siguen perteneciendo al turno anterior. El nuevo turno las puede cobrar sin modificar su `turno_id`.

### Validación técnica
- [ ] Wizard avanza cuando hay órdenes abiertas + PIN de gerente + nota
- [ ] Wizard bloquea cuando hay órdenes abiertas + sin PIN de gerente
- [ ] `pos_cierre_intentos` guarda `ordenes_pendientes` con los order_ids correctos
- [ ] El mapa de mesas sigue mostrando las mesas con órdenes del turno anterior como ocupadas
- [ ] Al abrir el turno nuevo: el banner aparece y lista las órdenes pendientes
- [ ] El banner desaparece cuando las últimas órdenes pendientes son cobradas
- [ ] Sin regresión: el flujo de cierre limpio (sin órdenes abiertas) no cambia

### Validación en campo (AMALAY)
- [ ] Eduardo o supervisor ejecuta un cierre con una mesa abierta intencional
- [ ] Confirmar que el mapa sigue mostrando esa mesa como ocupada
- [ ] Confirmar que el cajero puede cobrar esa mesa al día siguiente
- [ ] Confirmar que el banner de alerta aparece al abrir el turno

### Documentación
- [ ] Actualizar WANSOFT-POS-BIBLE.md: sección de cierre de turno
- [ ] Actualizar FULLSITE-ENGINEERING-BIBLE.md: flujo del CierreCajaWizard
- [ ] Marcar P0-1 como CERRADO en este documento con fecha y evidencia

### Cierre con evidencia
**Evidencia requerida:** screenshot o video del flujo completo — cierre con mesa abierta, mapa mostrando mesa ocupada, banner al abrir nuevo turno, cobro exitoso de la orden del turno anterior.

---

## P0-2 — Reimpresión de comanda desde KDS/cocina/barra

**Estado: EN VALIDACIÓN — Código completo 2026-07-23**

### HECHO — Implementación completada 2026-07-23

**Función compartida en `src/lib/printer.ts`:**
- `interface ReprintOrderContext` — tipo mínimo para contexto de reimpresión
- `buildReprintTicketBytes()` — layout idéntico a `buildStationTicketBytes` con banner invertido `REIMPRESION`, "Envio #N" y timestamps "Reimp: HH:MM / Orig: HH:MM"
- `reprintByStation()` — exported. Bridge → Bluetooth. Sin auto-enqueue (reimpresión es manual)

**Pantallas modificadas:**
- `src/app/pos/kds/page.tsx` — botón "Reimprimir" bajo cada tarjeta; `panaderia` mapea a `caja` en el bridge
- `src/app/pos/cocina/page.tsx` — botón por batch card; pasa `batchSeq` y `batchCreatedAt` como `sentAt`
- `src/app/pos/barra/page.tsx` — botón bajo advance button; `todo` mapea a `barra`

**Audit trail:**
- `AuditAction` extendido con `'reprint_comanda'`
- Cada reimpresión registra: `action`, `actor` (kds/cocina/barra), `order_id`, `mesa`, `details.station`, `details.batchSeq`

**Feedback al usuario:**
- KDS: toast fijo en bottom con color success/error, 3 segundos
- Cocina y Barra: reutilizan `showToast()` existente

**Invariantes respetados:**
- La reimpresión no modifica el status de la orden en DB
- No genera una segunda comanda en el KDS
- No se encola para retry automático

**RCA (original):**
Si una impresora de cocina falla en el momento del envío, la comanda llega a DB pero no al papel. La cocina no tiene forma de recuperarla sin interrumpir al mesero o al cajero. En hora pico, es un bloqueador real.

### Validación técnica — PENDIENTE
- [ ] Botón "Reimprimir" visible en KDS, cocina y barra
- [ ] Ticket imprime con banner `REIMPRESION` invertido en la estación correcta
- [ ] Cocina: ticket muestra "Envio #N" y "Orig: HH:MM" del batch original
- [ ] No genera segunda comanda en KDS ni cambia status de la orden
- [ ] `pos_audit_log` registra `reprint_comanda` con actor, order_id, station, mesa
- [ ] Sin internet, con print bridge local disponible: reimpresión funciona

### Validación en campo (AMALAY) — PENDIENTE

**Regla antes de empezar:** Grabar video continuo sin cortes desde que se rompe el flujo hasta que se verifica el resultado. Si falla, NO improvisar workaround en el restaurante — documentar exactamente qué ocurrió, con qué orden y bajo qué condiciones, y regresar al código con el caso de reproducción.

**Registro requerido al inicio:**
- Hora de inicio
- ID de la orden
- Estación destino
- Batch seq (si aplica)

**Pasos:**
- [ ] Romper deliberadamente el flujo (desconectar bridge o apagar impresora)
- [ ] Enviar una orden real a cocina
- [ ] Verificar que el ticket original NO salió
- [ ] Restaurar la condición normal (reconectar bridge o encender impresora)
- [ ] Presionar "Reimprimir" desde la pantalla operativa correspondiente

**Verificación del ticket:**
- [ ] Banner `REIMPRESION` visible e invertido
- [ ] Llega a la estación correcta (no a cualquier impresora)
- [ ] Ítems y modificadores correctos y completos
- [ ] "Envio #N" visible cuando aplica (cocina, multi-batch)
- [ ] Hora original visible junto a hora de reimpresión
- [ ] Sin duplicación de estados en KDS (orden sigue igual)
- [ ] Evento `reprint_comanda` presente en `pos_audit_log` con order_id, actor, station y mesa

### Documentación — PENDIENTE (post-validación)
- [ ] Actualizar WANSOFT-POS-BIBLE.md: capacidad de reimpresión en cocina
- [ ] Actualizar FULLSITE-ENGINEERING-BIBLE.md: `reprintByStation()`, `ReprintOrderContext`, audit trail
- [ ] Marcar P0-2 como CERTIFIED en este documento con fecha y evidencia

### Cierre con evidencia
**Resultado posible solo uno de dos:**
- 🟢 **P0-2 CERTIFIED** — todos los checks pasaron, evidencia archivada (video + audit log)
- 🔴 **Defecto identificado** — evidencia suficiente para reproducirlo en código (hora, order_id, condición exacta)

**Evidencia a archivar:** video continuo del flujo completo + screenshot del audit log con el evento `reprint_comanda`.

**Firma de CERTIFIED:** __________________ Fecha: __________

---

## P0-3 — Renovación y validación del CSD Facturama

### HECHO — Estado actual
- El CSD (Certificado de Sello Digital) de AMALAY en Facturama **vence el 2026-08-03**.
- Después de esa fecha, Facturama no puede emitir CFDIs válidos.
- Este es un bloqueo operativo de facturación, no un bug de código.

### RCA
Los CSDs tienen vigencia de ~2 años. El de AMALAY venció sin que hubiera un proceso de alerta o renovación automática en Fullsite. La consecuencia es que el cliente comenzaría a recibir errores de facturación silenciosamente después del 3 de agosto.

### Ciclo — Acciones requeridas (Daniel)

**Paso 1: Renovar el CSD en el SAT**
- Acceder al portal del SAT (CertiSAT Web o SAT ID)
- Generar nuevo CSD para RFC `FTE260611P18`
- Descargar: archivo `.cer` + archivo `.key` + contraseña

**Paso 2: Actualizar en Facturama**
- Acceder al dashboard de Facturama
- Ir a Configuración → Certificados
- Subir el nuevo `.cer` y `.key` con la contraseña
- Confirmar que Facturama lo acepta como válido

**Paso 3: Validar en Fullsite**
- Desde el POS, emitir una factura de prueba para un orden cerrada
- Confirmar que llega al correo y tiene el sello válido
- Confirmar que el UUID del SAT es válido (verificable en https://verificacfdi.facturaelectronica.sat.gob.mx/)

**Paso 4: Validar que el flujo offline también funciona**
- Verificar que las solicitudes de CFDI que estaban en queue se procesan correctamente con el nuevo CSD

### Validación técnica
- [ ] Facturama responde 200 a una solicitud de CFDI de prueba
- [ ] El UUID del SAT en el XML es válido
- [ ] El PDF del CFDI tiene el sello correcto

### Validación en campo (AMALAY)
- [ ] Un cliente real solicita factura desde el POS y la recibe por correo sin error
- [ ] Andy (contador) confirma que el XML cumple con los requerimientos del SAT

### Cierre con evidencia
**Evidencia requerida:** screenshot del CFDI emitido con UUID válido del SAT, con fecha posterior a 2026-08-03.

---

## P0-4 — Local-First Restaurant Runtime & Offline Continuity  `DESIGN GATE`

> RFC completo: `docs/product/LOCAL-FIRST-RFC.md`
> Principio rector: Internet es sincronización y servicios remotos, no el bus operativo del restaurante.
> Este P0 no es implementable hasta que el RCA técnico (Fase 0 del RFC) esté completo y la arquitectura aprobada.

### Cambio de alcance — 2026-07-24

El alcance original ("boot offline real en Electron") describía un síntoma, no el problema completo. La investigación de campo en AMALAY reveló que KDS, cocina y barra también dependen de internet para funcionar. El alcance correcto es:

**Fullsite debe poder arrancar y operar completamente sin internet — POS, KDS, cocina, barra, impresoras, autorizaciones y comunicación entre terminales — y sincronizar sin pérdida al reconectar.**

Referencia arquitectónica: WANSOFT ARCHITECTURE.md § 15 — Wansoft resuelve esto vía LAN-first: SQL Server local + WebApi en IIS + Comandero APK en LAN. Fullsite adopta el principio con tecnologías propias.

### HECHO — Estado actual

**Funciona offline hoy:**
- Print bridge (localhost:3000) — LAN, sin internet ✅
- Cola de órdenes mid-operation (IndexedDB `pos-offline-db`) ✅
- PIN auth cache (localStorage, TTL 15 min) ✅ — pero vence

**Requiere internet hoy:**
- Boot del bundle (Electron carga desde Vercel CDN) ❌
- Catálogo y datos en POS (fetch a Supabase) ❌
- KDS / Cocina / Barra — polling de órdenes a Supabase ❌
- Staff y permisos (solo cacheados 15 min) ❌

### Fase 0 — RCA técnico (antes de cualquier implementación)

Ver RFC § 6 para la lista completa. Las 5 preguntas originales más 3 nuevas:

1. ¿Dónde está el código de Electron?
2. ¿Cómo se construye el `.exe`?
3. ¿Next.js usa `output: 'export'` o server-side?
4. ¿Qué rutas API usa el POS en operación?
5. ¿El IDB persiste entre reinicios?
6. ¿KDS/cocina/barra usan REST o Supabase Realtime?
7. ¿`better-sqlite3` tiene restricciones en el build actual?
8. ¿El print bridge es extensible o es un módulo del renderer?

**Sin responder estas preguntas: nadie toca código.**

### Arquitectura objetivo (ver RFC para detalle)

```
[Electron] — bundle embebido (static export)
    ↓
[Coordinador local — evolución del print bridge]
    ├── SQLite local (catálogo, staff, config, cola de eventos)
    ├── WebSocket LAN (KDS / Cocina / Barra)
    └── Sync daemon (Supabase cuando hay internet)
```

### Validación técnica — ver RFC § 7 para criterios completos
- [ ] La app Electron arranca sin internet → POS carga con catálogo local
- [ ] KDS/cocina/barra reciben órdenes por LAN sin internet
- [ ] PIN y autorizaciones de gerente funcionan sin internet
- [ ] Impresión funciona sin internet (ya funciona — verificar no regresión)
- [ ] Al reconectar: sync sin pérdida ni duplicados en ≤ 60 segundos

### Validación en campo (AMALAY)
- [ ] Apagar router → arrancar app → tomar orden → enviar a cocina → cobrar → imprimir ticket
- [ ] Todo lo anterior sin internet desde el primer paso hasta el último
- [ ] Reconectar → confirmar sync en Dashboard

### Documentación
- [ ] Actualizar FULLSITE-ENGINEERING-BIBLE.md: arquitectura local-first
- [ ] Actualizar P0-4-LOCAL-FIRST-RFC.md con decisiones de arquitectura tomadas
- [ ] Documentar proceso de build del `.exe` con bundle embebido
- [ ] Marcar P0-4 como CERTIFIED con fecha y evidencia

### Cierre con evidencia
**Evidencia requerida:** video continuo sin cortes desde que se desconecta el router hasta que se confirma sync post-reconexión. Incluye arranque, toma de orden, KDS activo, cobro, impresión y sincronización.

---

## Reglas del ciclo de ejecución

1. **No marcar CERTIFIED sin los 8 puntos completos.** "Pasa en staging" no es evidencia. "Eduardo lo usó y funcionó" sí. Sin evidencia archivada, no hay CERTIFIED.
2. **Un P0 a la vez.** No iniciar implementación de P0-2 si P0-1 no está en validación técnica terminada. P0-3 y P0-4 (DESIGN GATE) pueden correr en paralelo con los otros.
3. **Bugs encontrados durante validación son bugs del P0 en curso**, no P1s. Se corrigen en el mismo ciclo sin abrir tickets nuevos.
4. **Si la implementación necesita cambiar el modelo**: stop, abrir RFC, esperar aprobación, luego implementar. Nunca al revés.
5. **No iniciar P1s hasta alcanzar POS V2 Operational Certification.** El milestone define cuándo. No hay interpretación: los 11 requisitos son binarios.
6. **P0-4 es DESIGN GATE.** Nadie toca código de boot offline hasta que el RCA esté completo y la arquitectura elegida esté aprobada.

---

_Creado: 2026-07-23_
_Architecture Freeze aprobado: 2026-07-23_
_Próxima actualización: al CERTIFIED de cada P0_

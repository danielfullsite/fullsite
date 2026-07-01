# STATE OF THE COMPANY — 1 julio 2026

> Snapshot completo de Fullsite.
> Para cualquier ingeniero senior o cofundador que se una manana.
> Lectura: 45 minutos. Entendimiento completo del negocio y producto.

---

## Vision

Fullsite es un Restaurant Operating System. No un POS.

Construimos la infraestructura sobre la cual operan restaurantes —
desde que un proveedor entrega mercancia hasta que el contador
declara impuestos. Cada restaurante que se une hace el sistema
mas inteligente para todos los demas.

Nuestro estandar no es Wansoft, Toast, ni ningun competidor.
Nuestro estandar es como deberia operar un restaurante dentro
de 10 anos si se disenara desde cero con IA, datos, y automatizacion.

---

## North Star

**Restaurantes operando exitosamente con Fullsite.**

Hoy: **0.** Objetivo inmediato: **1** (AMALAY Coffee & Market, Monterrey).

Ventana: 33 dias (certificado de facturacion de Wansoft vence 3 ago 2026).

---

## Estado del producto

### Confidence Score: 74%

| Area | Score | Status |
|---|---|---|
| Ventas/Ordenes | 90% | Code PASS, 12/13 flujos certificados |
| Cobro | 90% | Code PASS, efectivo/tarjeta/mixto/split/delivery |
| Cocina/KDS | 85% | Code PASS, bridge produccion AMALAY |
| Impresion | 85% | Production PASS (4 estaciones verificadas en AMALAY) |
| Corte/Caja | 85% | Code PASS, wizard 4 pasos con denominaciones |
| Auditoria | 85% | Code PASS, log inmutable + 20 tipos de accion |
| Inventario | 30% | Desactivado (bugs criticos en recetas/unidades) |
| Facturacion | 0% | Bloqueado (IEPS no implementado, Facturama no pagado) |
| Concurrencia | 70% | 4 parches aplicados, normalizacion P1 |
| Hardware | 50% | Bridge OK, cajon/huella pendiente |

### Lo que funciona hoy

- POS completo con 30+ flujos operativos (mesas, ordenes, modificadores, sillas, tiempos, split, descuentos, cortesias, cancelaciones, reimpresiones)
- KDS digital con routing por estacion, item tracking, alerta sonora
- Print bridge HTTP en localhost (0-1s vs Wansoft 15s)
- Print queue con retry, escalamiento, y recovery
- Offline-first con IndexedDB sync queue
- Turno: abrir con fondo, Corte X, cierre con wizard 4 pasos
- 50+ permisos granulares por rol (5 roles)
- Audit log inmutable con trazabilidad completa
- Dashboard con 17 paginas de analytics
- 13 agentes de IA autonomos (anomalias, prediccion, anti-fraude)
- Compras: OC, recepcion, facturas, pagos
- Merma, conteo fisico, alertas de reorden
- Facturacion CFDI 4.0 (sandbox, falta produccion)
- Comanda de ACTUALIZACION (detecta cambios post-envio — unico de Fullsite)
- Deduccion de inventario idempotente (INV-1 fixed)

### Lo que NO funciona todavia

- IEPS (bebidas alcoholicas) — modelo fiscal no implementado
- Facturacion produccion — Facturama no pagado
- Huella digital — WebAuthn pendiente de validar con lector HID
- Cajon de dinero — EC TICKET atascada, workaround con EC01
- Produccion/batch cooking — no existe
- Sub-recetas — no existe
- Existencias por platillo ("cuantos puedo servir") — no existe
- Conversion de unidades en inventario — no funciona
- Food cost — lee tabla desconectada de recetas editables
- CRM de clientes — parcial
- Terminal bancaria integrada — no existe

---

## Estado de la empresa

| Metrica | Valor |
|---|---|
| Fundador | Daniel Ramonfaur (100% equity) |
| Empleados | 0 (founder solo) |
| Revenue | $0 (pre-revenue) |
| Clientes pagando | 0 |
| Clientes en implementacion | 1 (AMALAY) |
| Funding | $0 (bootstrapped) |
| Incorporacion | Pendiente (Mexico SA de CV o Delaware C-Corp) |
| YC | Rechazado una vez. Target: Winter 2027 |

### Cliente ancla: AMALAY Coffee & Market

- Ubicacion: San Pedro, Monterrey, NL, Mexico
- Tipo: cafe + restaurante + market (panaderia, retail)
- Mesas: 30+
- Staff: ~40 personas
- POS actual: Wansoft (NetSilver, .NET 4.5, SQL Server local, 2007)
- Volumen: ~400-430 facturas/mes
- Facturacion: ~$500K-700K MXN/mes estimado
- Relacion: Daniel opera AMALAY, conoce la operacion de primera mano

### Equipo

| Persona | Rol | Equity | Status |
|---|---|---|---|
| Daniel Ramonfaur | Founder/CEO | 100% | Activo |
| Monica | Operaciones AMALAY + ventas | Sin equity | Activa |
| Miguel Alvarado | Candidato CTO | Pendiente | Por contactar |
| Eduardo de la Garza | Ex-Wansoft, prospecto CCO | Sin equity | Evaluacion pausada |

---

## Roadmap

### P0 — Bloquean Go-Live (6 items, todos bloqueados por acciones externas)

- [ ] IEPS modelo fiscal (bloqueado: necesita XML de Wansoft)
- [ ] Facturama produccion (bloqueado: pago $1,650)
- [ ] XML CFDI validado contra Wansoft
- [ ] Huella digital (verificar Windows Hello con lector DP4500)
- [ ] Cajon (fix EC TICKET o mover RJ-11)
- [ ] Shadow Day

### Completados recientemente

- [x] Concurrencia: updated_at en handlePayment
- [x] Concurrencia: fix 409 en sync offline
- [x] Concurrencia: separar KDS writes del campo items
- [x] INV-1: deduccion idempotente de inventario

### P1 — Post-cutover (semanas 1-4)

- Normalizar items a pos_order_items (ADR Opcion B)
- Supabase Realtime entre terminales
- Corte Z formal con reglas de negocio
- Fondo de propinas
- NSSM para bridge auto-restart
- Device ID en audit log
- Intentos de corte registrados
- Catalogo de razones predefinido
- Inventario: conversion de unidades, modificadores, sync tablas recetas

### Estrategico — Vision del Restaurant OS

- Produccion/batch cooking
- Sub-recetas
- Existencias por platillo
- Stock comprometido vs disponible
- Compras sugeridas por IA basadas en recetas + ventas

### P2 — Primeros 10 restaurantes

- CRM de clientes
- Terminal bancaria (Clip REST)
- Catalogo editable desde POS
- Cancelacion CFDI ante SAT
- Multi-tenant onboarding automatizado

---

## Decisiones arquitectonicas mas importantes

### ADR-CONCURRENCY (aprobado)
- Opcion A (parches) ahora + Opcion B (normalizacion) post-cutover
- JSON monolitico de items es la raiz del problema — normalizar a pos_order_items
- Event sourcing (Opcion C) cuando haya equipo de 3+ devs

### ADR-FISCAL-MODEL (aprobado, bloqueado)
- Modelo generico con pos_tax_rules + pos_item_taxes (N:M)
- Soporta IVA, IEPS, exento, cuota fija, retenciones
- Bloqueado hasta tener XML CFDI real de Wansoft como referencia

### ADR-TURNO-LIFECYCLE (aprobado con ajustes)
- Turno por terminal (multi-terminal ready)
- Mesas abiertas bloquean cierre (override con PIN + razon)
- Turno cerrado no se reabre — se crea uno nuevo
- Fondo inicial no editable — correcciones via deposito/retiro

### Principio #13: La receta es la unidad fundamental
- El POS no es el centro del OS. La receta lo es
- Todo se deriva: ingredientes, costos, produccion, disponibilidad
- "Cuantos platillos puedo servir?" no "cuantos kilos quedan?"

---

## 15 Principios (Constitucion)

1. Nunca perder una orden
2. Nunca emitir factura incorrecta
3. Nunca cerrar caja sin auditoria
4. Todo cambio importante es trazable
5. Toda integracion tiene fallback
6. Offline primero
7. El restaurante siempre debe seguir operando
8. Los datos financieros cuadran siempre
9. Seguridad por defecto
10. La terminal es desechable, los datos son eternos
11. Prueba del viernes a las 8pm
12. Deducciones de inventario son idempotentes
13. La receta es la unidad fundamental del negocio
14. Pensar como empresa de categoria mundial
15. No copiamos. Aprendemos y superamos

---

## 10 Moats

1. **Data Flywheel** — cada restaurante mejora predicciones para todos
2. **Red de Proveedores** — compras grupales, poder de negociacion
3. **FinOps** — P&L en tiempo real, no a fin de mes
4. **Onboarding 30 min** — el Shopify de restaurantes
5. **AI Kitchen** — predecir demanda antes de que llegue el cliente
6. **Anti-Fraude Invisible** — Stripe Radar para operacion restaurantera
7. **Gemelo Digital** — estado del restaurante en tiempo real desde el celular
8. **Plataforma Integraciones** — hub central (SAT, Rappi, Uber, Clip, CONTPAQi)
9. **Capital Operativo** — credito basado en datos operativos reales
10. **Network del Conocimiento** — conocimiento colectivo = recomendaciones individuales

---

## Riesgos (top 5)

1. **Ventana de 33 dias** — el certificado eGlobal de Wansoft vence el 3 de agosto. Si no hacemos cutover antes, AMALAY pierde facturacion en ambos sistemas
2. **Founder solo** — sin CTO ni equipo de ingenieria. Bus factor = 1
3. **Inventario desactivado** — el modulo mas innovador esta apagado por bugs en recetas/unidades. Sin fecha de reactivacion
4. **Zero revenue** — sin un cliente pagando, la empresa no es sostenible. AMALAY debe pagar o definir terminos
5. **Sin prueba en produccion** — 90% de cobertura en codigo, 0% en operacion real

## Oportunidades (top 5)

1. **eGlobal vence = narrativa de rescate** — "tu facturacion va a fallar en 33 dias, nosotros lo resolvemos hoy"
2. **Miguel Alvarado** — CTO candidato con YC S21, Monterrey, disponible
3. **Wansoft extraction completa** — 3.21 GB de datos, 822 SPs analizados, 20 lecciones documentadas
4. **4 parches de concurrencia** — el sistema es significativamente mas robusto que hace 3 dias
5. **Documentacion de categoria mundial** — 15 principios, playbooks, ADRs, moats documentados. Listo para equipo

---

## Que NO construir

- Features por paridad con Wansoft (solo si resuelven problema real)
- Features por paridad con Toast (mercado diferente)
- Multi-sucursal antes de tener 10 restaurantes
- App nativa antes de validar PWA con 10 restaurantes
- Event sourcing antes de tener equipo de 3+ devs
- Terminal bancaria antes de cutover (Getnet standalone funciona)
- Lealtad/puntos antes de tener CRM basico
- Cualquier cosa que no responda: "esto acerca a Fullsite a operar 100 restaurantes?"

---

## Proximos 30 dias

| Semana | Objetivo |
|---|---|
| 1 (1-7 jul) | Pagar Facturama. Obtener XML. Contactar Miguel. Verificar bridge AMALAY |
| 2 (8-14 jul) | Sprint 1 Legal: implementar IEPS, timbrar factura real, validar XML |
| 3 (15-21 jul) | Sprint 2 Operativo: huella, cajon, devices, capacitacion. Shadow Day |
| 4 (22-28 jul) | Cutover AMALAY. Hypercare dia 1-7 |

## Proximos 90 dias

| Mes | Objetivo |
|---|---|
| Julio | AMALAY operando con Fullsite. North Star: 0 → 1 |
| Agosto | Hypercare + normalizacion de items + Realtime + inventario limpio |
| Septiembre | Segundo restaurante usando el playbook. North Star: 1 → 2 |

## Proximos 12 meses

| Trimestre | Objetivo |
|---|---|
| Q3 2026 | 1-2 restaurantes. Validar playbook. Contratar CTO |
| Q4 2026 | 5-10 restaurantes. Onboarding CLI. Terminal bancaria |
| Q1 2027 | 10-30 restaurantes. Apply YC Winter 2027 |
| Q2 2027 | 30-100 restaurantes. Serie Seed. Equipo de 5+ |

---

## Contexto tecnico para un CTO que se una manana

### Stack

- **Frontend:** Next.js 15 + React + Tailwind CSS (PWA)
- **Backend:** Supabase (Postgres + Auth + RLS + Realtime)
- **Impresion:** Node.js bridge en localhost (:7717) → ESC/POS via TCP/USB
- **IA:** 13 agentes Python en GitHub Actions (Groq/Claude Haiku)
- **Deploy:** Vercel (auto-deploy desde GitHub main)
- **Offline:** IndexedDB + Service Worker + sync queue
- **Monorepo:** dashboard-app (Next.js) + fullsite-os (bridge) + agents

### Donde vive todo

| Cosa | Ubicacion |
|---|---|
| Codigo del POS | `dashboard-app/src/app/pos/` |
| Logica de datos | `dashboard-app/src/lib/pos-data.ts` (~2400 lineas) |
| Impresion | `dashboard-app/src/lib/printer.ts` (~1500 lineas) |
| Permisos | `dashboard-app/src/lib/pos-permissions.ts` |
| Bridge | `fullsite-os/dist/bridge.js` |
| Agentes IA | `.github/scripts/*.py` |
| Principios | `/FULLSITE-PRINCIPLES.md` |
| Roadmap | `/ROADMAP.md` |
| Documentacion | `/docs/` (7 carpetas, 19 docs activos) |
| Wansoft reference | `/docs/reference/wansoft/` (4 archivos, 3.21 GB en Desktop) |
| Memoria persistente | `~/.claude/projects/-Users-danielrg/memory/` |

### Deuda tecnica conocida

| Deuda | Severidad | Plan |
|---|---|---|
| Items como JSON blob en pos_orders | Critica (concurrencia) | Normalizar post-cutover (ADR aprobado) |
| Sin Supabase Realtime | Alta (multi-terminal) | Post-cutover |
| Inventario: sin conversion de unidades | Alta (datos incorrectos) | Desactivado, fix post-cutover |
| Food cost: dos tablas desconectadas | Alta | Unificar post-cutover |
| Cache de PIN con btoa (reversible) | Media (seguridad) | Fix post-cutover |
| Fuzzy matching de recetas (50% threshold) | Media | Vincular por ID, no por nombre |

### Lo que un CTO nuevo debe leer primero

1. `FULLSITE-PRINCIPLES.md` — la constitucion (5 min)
2. `ROADMAP.md` — que hay que hacer (5 min)
3. `docs/operations/EXECUTIVE-REPORT.md` — estado del producto (10 min)
4. `docs/operations/MANUAL-OPERATIVO.md` — como funciona todo (15 min)
5. `docs/business/WHY-FULLSITE-WINS.md` — por que ganamos (10 min)
6. `docs/architecture/adr/` — decisiones tecnicas (10 min)
7. `docs/deployment/CUTOVER-PLAYBOOK.md` — como se implementa (10 min)

Total: ~65 minutos para entender Fullsite completamente.

---

> Este documento es un snapshot. No una guia.
> Para la guia, leer MANUAL-OPERATIVO.md.
> Para el plan, leer ROADMAP.md.
> Para la vision, leer WHY-FULLSITE-WINS.md.
>
> Fullsite — Restaurant Operating System
> North Star: 0 → 1
> Ventana: 33 dias

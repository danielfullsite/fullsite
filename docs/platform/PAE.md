# Platform Acceptance Environment (PAE)

> **Status:** Design — pendiente de implementación hasta que P1 Golden Skeleton esté completo.  
> **Category:** A — Camino crítico. Gate obligatorio antes de Cliente #2.  
> **Owner:** Platform Engineering  
> **Created:** 2026-08-01  
> **Regla de evolución:** Este documento solo cambia cuando la ejecución física revela un gap real. No por hipótesis.

---

## Propósito

El PAE es un restaurante ficticio que existe de forma permanente en staging.  
Es el gate entre desarrollo y deployment a un cliente real.

**Un feature que no pasa el PAE no llega a un cliente pagador.**

El PAE no es un entorno de pruebas ad hoc. Es una instalación certificada, con datos canónicos, que puede destruirse y re-provisionarse desde cero en menos de 30 minutos. Cada vez que se destruye y vuelve a levantar, el proceso de bootstrap es la prueba misma.

---

## El restaurante: Café Nómada

**Identidad**

| Campo | Valor |
|---|---|
| Nombre comercial | Café Nómada |
| `client_id` | `nomada` |
| Tipo | Café / bistro casual |
| Ubicación | Ficticio, México |
| RFC | `NOM000000XXX` (test — nunca real) |
| Email | `noreply@nomada.test` |
| Zona horaria | `America/Monterrey` |
| IVA | 16% |
| Moneda | MXN |
| Plan | `standard` |

**Por qué este concepto:** Un café-bistro es el contexto más genérico para ejercitar todas las capacidades del POS sin depender de particularidades de AMALAY (market, panadería, entradas especiales). Todo menú de Nómada representa comida real genérica, no el menú de ningún restaurante existente.

---

## 1. Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│          staging.app.fullsite.mx  (Vercel Preview)      │
│                                                         │
│  client_id = 'nomada' ← RLS aislado de 'amalay'        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  POS     │  │  KDS     │  │Dashboard │              │
│  │  Caja    │  │ Cocina   │  │ nomada   │              │
│  │  (tab)   │  │  Barra   │  │          │              │
│  └────┬─────┘  └────┬─────┘  └──────────┘              │
│       │             │                                   │
│  ┌────▼─────────────▼────────────────────┐              │
│  │     Supabase Staging                  │              │
│  │     (fullsite-warroom-staging)        │              │
│  │     client_id = 'nomada'             │              │
│  └───────────────────────────────────────┘              │
│                                                         │
│  Bridge: simulado por mock o instancia real en VM       │
│  Impresora: virtual (log-to-file) o física si hay       │
│  Agentes: 26 agentes activos para 'nomada'              │
└─────────────────────────────────────────────────────────┘
```

**Invariantes de arquitectura:**

- `client_id = 'nomada'` nunca toca datos de `'amalay'` ni de ningún otro tenant.
- RLS garantiza aislamiento completo — verificable con `SELECT` cruzado.
- El PAE vive en staging (`fullsite-warroom-staging`), nunca en producción.
- Cuando se destruye y re-crea, el `client_id` es el mismo: `nomada`.
- La URL de staging es permanente. No cambia entre provisiones.

**Relación con otros entornos:**

| Entorno | URL | Propósito |
|---|---|---|
| Producción AMALAY | `app.fullsite.mx` | Operación real. Nunca usar para pruebas. |
| PAE (staging) | `staging.app.fullsite.mx` | Gate de aceptación. Siempre `nomada`. |
| Sandbox libre | `sandbox.app.fullsite.mx` | Exploración. Sin garantías de persistencia. |

---

## 2. Dataset canónico

El dataset es la fuente de verdad del PAE. Está versionado. Bootstrap = aplicar el dataset limpio.

### 2.1 Menú

**10 categorías, 40 ítems.** Precios realistas pero ficticios.

| Categoría | Slug | Ítems (muestra) |
|---|---|---|
| Café caliente | `cafe-caliente` | Espresso $45, Americano $50, Latte $65, Capuchino $65, Cortado $55 |
| Café frío | `cafe-frio` | Cold Brew $70, Iced Latte $75, Frappé Caramel $80 |
| Jugos y aguas | `bebidas-frias` | Agua Jamaica $35, Limonada $40, OJ $50 |
| Tostadas y bagels | `tostadas` | Tostada Aguacate $85, Bagel Salmón $95, Tostada Tomate $75 |
| Bowls | `bowls` | Bowl Mediterráneo $110, Bowl Pollo $105, Bowl Vegetal $100 |
| Sándwiches | `sandwiches` | Club $95, Caprese $90, BLT $88 |
| Pancakes | `pancakes` | Pancakes x3 $85, Pancakes Frutas $90 |
| Bakery | `bakery` | Croissant $45, Muffin $40, Cookie $30, Pan Banana $38 |
| Especiales | `especiales` | Huevos Rancheros $95, Eggs Benedict $105 |
| Extras | `extras` | Shot extra $15, Leche oat $20, Syrup $10 |

**Reglas del dataset:**
- Sin slugs `mkt-*` (esos son AMALAY).
- Sin categorías de inventario de market ni panadería de producción.
- Precios en MXN, sin centavos (facilita los tests de aritmética).
- IVA incluido en precio de venta.

### 2.2 Staff

4 personas ficticias. Nombres genéricos.

| Nombre | Rol | PIN | Permisos |
|---|---|---|---|
| Ana Morales | Gerente | `1111` | Todos (incluyendo `corte_z`, `descuentos`, `cancelaciones`) |
| Carlos Vega | Mesero | `2222` | Órdenes, envío a cocina, cobro |
| Diana Ruiz | Mesero | `3333` | Órdenes, envío a cocina, cobro |
| Eduardo Lara | Cajero | `4444` | Cobro, turno, caja |

**Biometría:** Sin huellas registradas en PAE — biometría requiere hardware físico.

### 2.3 Mesas

15 mesas numeradas.

| Zona | Mesas |
|---|---|
| Interior | 1–10 |
| Terraza | 11–13 |
| Barra | B1, B2 |

### 2.4 Estaciones KDS

| Estación | Slug | Categorías asignadas |
|---|---|---|
| Cocina | `cocina` | tostadas, bowls, sándwiches, pancakes, especiales |
| Barra | `barra` | cafe-caliente, cafe-frio, jugos-aguas, bakery, extras |

### 2.5 Métodos de pago

Los 4 estándar: Efectivo, Tarjeta de crédito, Tarjeta de débito, Transferencia electrónica.  
Sin Uber Eats activo por defecto — se activa solo para los tests de integración.

### 2.6 Inventario básico

20 ingredientes que cubren los 10 ítems más vendidos del menú. Suficiente para que food cost muestre valores, sin necesidad de modelar el inventario completo.

| Ingrediente | Unidad | Stock inicial | Costo unitario |
|---|---|---|---|
| Espresso (shot) | ml | 2,000 | $2.50 |
| Leche entera | ml | 5,000 | $0.80 |
| Leche de avena | ml | 2,000 | $1.80 |
| Syrup vainilla | ml | 1,000 | $3.00 |
| Aguacate | g | 3,000 | $0.08 |
| Pan integral | pieza | 40 | $4.00 |
| Salmón ahumado | g | 1,000 | $0.35 |
| Huevo | pieza | 60 | $3.50 |
| Pechuga pollo | g | 2,000 | $0.12 |
| Lechuga mixta | g | 1,000 | $0.04 |
| Tomate | g | 2,000 | $0.03 |
| Crema | ml | 1,000 | $1.20 |
| Mantequilla | g | 500 | $0.25 |
| Harina | g | 5,000 | $0.01 |
| Azúcar | g | 2,000 | $0.02 |
| Cold brew (prep.) | ml | 2,000 | $4.00 |
| Croissant (horneado) | pieza | 20 | $12.00 |
| Muffin (horneado) | pieza | 20 | $8.00 |
| Jugo naranja | ml | 2,000 | $2.50 |
| Jamaica (concentrado) | ml | 2,000 | $1.50 |

### 2.7 Recetas (food cost)

10 recetas para los ítems de mayor volumen, con rendimiento y merma declarados.

| Platillo | Food cost % objetivo |
|---|---|
| Latte | ~28% |
| Cold Brew | ~22% |
| Tostada Aguacate | ~31% |
| Bowl Mediterráneo | ~29% |
| Club Sándwich | ~33% |
| Pancakes x3 | ~24% |
| Huevos Rancheros | ~27% |
| Croissant | ~35% |
| Bagel Salmón | ~38% |
| Espresso | ~18% |

### 2.8 Agentes

Los 26 agentes activos con `client_slug = 'nomada'`. Todos en modo producción (mismos umbrales que AMALAY — el PAE debe estresar el sistema real, no una versión suavizada).

---

## 3. Bootstrap

Proceso para levantar Café Nómada desde cero. Meta: < 30 minutos desde línea de comando hasta POS operativo.

### Fase A — Provisioning (≤10 min)

1. Ejecutar `onboard_client.py --client-id nomada --display-name "Café Nómada" --plan standard`
   - Crea fila en `clients`
   - Crea admin user `admin@nomada.test`
   - Aplica grants y RLS
   - Registra en `agent_runs` como evento de onboarding

2. Verificar aislamiento: `SELECT client_id FROM pos_orders WHERE client_id = 'amalay'` desde sesión `nomada` → 0 filas.

3. Verificar RLS: login con `admin@nomada.test` → solo ve datos de `nomada`.

### Fase B — Seed de datos canónicos (≤10 min)

4. Aplicar seed de menú: `seed_menu.sql --client-id nomada`  
   → 10 categorías, 40 ítems, precios del dataset canónico.

5. Aplicar seed de staff: `seed_staff.sql --client-id nomada`  
   → Ana, Carlos, Diana, Eduardo con sus PINs y roles.

6. Aplicar seed de inventario: `seed_inventory.sql --client-id nomada`  
   → 20 ingredientes, 10 recetas.

7. Configurar mesas: 10 interior + 3 terraza + 2 barra (desde UI o seed).

8. Configurar KDS routing: cocina ← tostadas/bowls/pancakes; barra ← café/bebidas.

### Fase C — Verificación (≤10 min)

9. Login POS con PIN `1111` (Ana) → turno abre sin error.
10. Tomar orden mesa 1: Latte + Tostada Aguacate → enviar a cocina → KDS muestra la orden.
11. Cobrar efectivo $150 → ticket imprime (o log si virtual).
12. Cerrar turno → arqueo cierra con diferencia $0.
13. Dashboard muestra ventas $150 para `nomada`, cero para `amalay`.

Bootstrap completo cuando los 5 pasos de verificación son PASS.

---

## 4. Smoke Tests

**Objetivo:** Confirmar en < 5 minutos que el PAE está operativo.  
**Frecuencia:** Antes de cada sesión de desarrollo, después de cada deploy a staging.  
**Criterio:** Todos PASS. Un FAIL bloquea el uso del entorno.

| ID | Módulo | Acción | Criterio de PASS |
|---|---|---|---|
| SM-01 | Auth | Login PIN `2222` en POS | Acceso concedido en ≤ 3s |
| SM-02 | POS | Abrir turno con fondo $500 | Turno ID generado, visible en Caja y PDV |
| SM-03 | POS | Agregar 3 ítems a mesa 1 | Total correcto con IVA incluido |
| SM-04 | KDS | Enviar orden a cocina | KDS Cocina muestra la orden en ≤ 5s |
| SM-05 | KDS | Enviar ítem de barra | KDS Barra muestra el ítem en ≤ 5s |
| SM-06 | Print | Enviar comanda | Log o ticket impreso sin error |
| SM-07 | Cobro | Pago efectivo $0 (cortesía interna) | Orden → `cobrada`, cajón abre (o log) |
| SM-08 | Cierre | Cerrar turno con PIN `1111` | Wizard completa, `pos_cierres` tiene registro |
| SM-09 | Dashboard | Ver ventas del día | Muestra datos de `nomada`, cero de `amalay` |
| SM-10 | AI | Chat: "¿cuánto vendimos hoy?" | Responde con contexto de Nómada, no de AMALAY |
| SM-11 | Agentes | GET `/api/agents/health?client=nomada` | `status: ok` en todos los agentes activos |
| SM-12 | Bridge | GET `http://bridge:7717/health` | `supabase_reachable: true`, `sync_queue_size: 0` |

---

## 5. Acceptance Tests

La suite completa de certificación. Idéntica en estructura al Protocolo Offline Fase 5, pero ejecutada sobre Nómada en staging.

**Duración:** 4 horas.  
**Periodicidad:** Antes de cada nueva instalación en cliente real.  
**Generación:** `docs/certifications/PAE-CERT-{fecha}.md`

### 5.1 Módulos cubiertos

| Módulo | Test principal | Criterio |
|---|---|---|
| POS — Órdenes | 30 órdenes completas (crear → enviar → cobrar) | 0 pérdidas, 0 duplicados |
| POS — Caja | Turno + depósitos + retiros + cierre + arqueo | Arqueo = $0 diferencia |
| KDS — Cocina | 30 comandas recibidas y confirmadas | 100% recepción en ≤ 10s |
| KDS — Barra | 15 ítems de barra recibidos | 100% recepción en ≤ 10s |
| Print | 30 impresiones de comanda + 10 tickets | 0 pérdidas permanentes |
| Offline | Desconectar WAN 60 min + operar normal | 0 pérdidas de datos |
| Replay | Reconectar + sync automático | Sync completa en ≤ 120s |
| Multi-terminal | 2 POS simultáneos | Sin conflictos ni datos divergentes |
| GUARD-08 | Intentar cierre con órdenes abiertas | Soft-block activo, escalación funciona |
| Concurrencia | Pago simultáneo desde 2 POS | 0 dobles cobros |
| IA | 5 preguntas al chat | Responde con datos de Nómada únicamente |
| Dashboard | KPIs en tiempo real | Datos correctos, 0 contaminación |
| Agentes | 3 ciclos de agentes (anomaly, close predictor, etc.) | Alertas llegan a Telegram para Nómada |
| Health | Bridge uptime durante 4h | 0 caídas sin recuperación automática |

### 5.2 Protocolo de evidencia

Mismo estándar que Offline Fase 5:

- Log de evidencia en tiempo real (tabla de 12 columnas)
- Screenshot por cada incidente
- Correlation IDs para trazabilidad
- ORS calculado al cierre (≥ 80 para PASS)

### 5.3 Criterio de certificación PAE

El PAE está CERTIFIED cuando:

1. Todos los módulos de la tabla 5.1 son PASS
2. ORS ≥ 80
3. 0 pérdidas de datos
4. 0 datos de `amalay` visibles en ninguna pantalla
5. Evidencia consolidada en `docs/certifications/PAE-CERT-{fecha}.md`
6. Commit con la evidencia

**PAE CERTIFIED ≠ Cliente listo.** El PAE verifica la plataforma. El Shadow Day verifica que el equipo del restaurante sabe operar la plataforma.

---

## 6. KPIs del entorno

Métricas que confirman que el PAE está saludable en todo momento, no solo durante certificaciones.

| KPI | Fuente | Umbral de PASS | Umbral de alerta |
|---|---|---|---|
| Smoke tests | Suite SM-01…SM-12 | 12/12 PASS | < 12/12 |
| Bridge uptime | `/health` endpoint | ≥ 99% | < 99% |
| Sync queue | `bridge.sync_queue_size` | = 0 después de cada sesión | > 10 persistente |
| IDB queue (Caja) | OfflineIndicator | = 0 tras reconexión | > 0 por más de 5 min |
| Contaminación AMALAY | `SELECT count(*) WHERE client_id='amalay' FROM session nomada` | = 0 | > 0 (bloquea bootstrap) |
| Food cost ratio | Dashboard Nómada | Dentro de ± 10% del dataset canónico | Fuera del rango |
| Últimas ventas en Dashboard | Timestamp | ≤ 15 min desde la última operación | > 15 min (staleness) |
| Chat IA responde | SM-10 | < 10s, contexto correcto | > 10s o contexto AMALAY |
| Agentes activos | `agent_runs WHERE client_slug='nomada'` | ≥ 1 run por agente en 48h | Agente sin actividad > 48h |
| Diferencia de arqueo | `pos_cierres.diferencia` | = $0 en sesiones de test | ≠ $0 sin justificación |

**Dashboard de KPIs:** El PAE debe tener su propio tab en el Dashboard donde estos KPIs son visibles en tiempo real. No requiere un panel separado — es la vista de `nomada` en el Dashboard existente.

---

## 7. Rollback

El PAE puede corromperse. El protocolo de rollback garantiza que puede restaurarse sin depender de backups externos.

### 7.1 Escenarios de rollback

| Escenario | Acción |
|---|---|
| Datos corruptos en `nomada` | Tear down + re-provision |
| RLS roto (datos cruzados con `amalay`) | Tear down + re-provision (no reparar sobre datos contaminados) |
| Bridge inaccesible | Reiniciar bridge, no tear down |
| Agentes no responden | Re-habilitar en GitHub Actions, no tear down |
| Dataset corrompido | Aplicar seed canónico sin tear down |
| Módulo con regresión | Revertir deploy, no tear down |

### 7.2 Tear down

```
1. Eliminar todos los datos de client_id = 'nomada' (cascada por FK)
2. Revocar auth user admin@nomada.test
3. Eliminar fila de clients WHERE id = 'nomada'
4. Verificar: SELECT count(*) FROM pos_orders WHERE client_id = 'nomada' = 0
```

Tear down debe ser reversible y no afectar ningún otro tenant.

### 7.3 Re-provision

Ejecutar Bootstrap completo (Fases A + B + C). RTO objetivo: < 30 minutos.

### 7.4 Dataset canónico — versionado

El dataset vive en `scripts/seed/nomada/` como archivos SQL versionados:

| Archivo | Contenido |
|---|---|
| `v1_menu.sql` | 10 categorías, 40 ítems con precios |
| `v1_staff.sql` | 4 personas con PINs y roles |
| `v1_inventory.sql` | 20 ingredientes, 10 recetas |
| `v1_settings.sql` | Mesas, KDS routing, métodos de pago |

Versionar el dataset es obligatorio: si cambia el schema de producción, el dataset se actualiza y se versiona (v2, v3…). Un seed desactualizado no puede aplicarse sobre el schema actual.

### 7.5 Regla de rollback

**Nunca corregir datos corruptos manualmente.** Si hay contaminación o inconsistencia, siempre es tear down + re-provision. Un PAE con datos parcialmente reparados no es un PAE confiable.

---

## Relación con el roadmap

| Workstream | Relación con PAE |
|---|---|
| P1 Golden Skeleton | PAE es el smoke test final de P1. Si el bootstrap falla, P1 no está cerrado. |
| FEOS Core | PAE es el primer restaurante provisionado desde FEOS. |
| Cliente #2 | PAE debe estar CERTIFIED antes del Shadow Day del cliente. |
| Offline Fase 5 | La acceptance suite del PAE incluye el Protocolo Offline v1.0 completo. |

---

> **Regla permanente:** Si el PAE no puede provisionarse desde cero en < 30 min con el bootstrap, el proceso de instalación de un restaurante nuevo está roto. Eso es una regresión de plataforma, no un bug menor.

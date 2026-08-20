# Pipeline de código — todo lo pedido, priorizado (Daniel: ventas+gente / yo: código)

> Síntesis de 3 investigaciones paralelas (features nombrados, features a medias + pedidos en juntas,
> street-wise → código) reconciliada contra `origin/main`. Fecha: 2026-08-20.
> Complementa `docs/PLAN-AHORA.md`, `docs/state/OPEN-ITEMS.md`, `docs/strategy/REALIDADES-DE-CALLE-INDUSTRIA.md`,
> `docs/product/INVENTARIO-ENTRADAS-SALIDAS-IMPL.md`, `docs/audit/EDUARDO-REQUISITOS.md`.

**⚠️ Nota de reconciliación:** las investigaciones leyeron el working tree viejo (`feat/pos-ui-kit`,
~228 commits atrás de main), así que reportaron como "faltantes" cosas que YA están en `main`
(OPEN-ITEMS.md, el emit de skimming en save-order, los docs de esta sesión). Este pipeline corrige eso.

---

## 0. El bug de "laboratorio" (arreglar YA — bloquea tu demo de AMALAY)

**Qué es:** hay un tenant real **"Laboratorio 24/7"** (`id: lab-resto`) en `clients`. Tu POS de AMALAY
aterriza en él por **impersonación residual**: entraste a `lab-resto` vía `/platform/tenants` y no diste
"Salir" → `localStorage['fullsite_actas']` deja el POS pegado en ese tenant.
- **Fix inmediato (0 código):** en el navegador, limpiar `localStorage` (`fullsite_actas`=vacío,
  `fullsite_client_id='amalay'`) o dar "Salir" en `/platform`.
- **Fix de código (P1):** que el POS resuelva el tenant de la misma fuente autoritativa que el dashboard
  y que "act-as" se limpie confiable al salir. `AuthContext.tsx:101-107`.
- **Higiene (P2):** 6 tenants de prueba mezclados con AMALAY en `clients`; y dos valores para "es Fullsite"
  (`supabase` en amalay/nomada/sushi/coffee vs `fullsite` en esqueleton/lab). Unificar + marcar los demo.

---

## Prioridad de código (olas)

### 🔴 OLA A — Dinero y seguridad (cierra el fraude real; casi todo ya hecho)
El fraude es tu riesgo #1 y lo que Alejandro/Eduardo enfatizan. Estado real en `main`:

| Item | Estado en main | Falta |
|---|---|---|
| **Skimming detect+consume** | ✅ emit (`9db50dff`) + agente consume (`e4d6f77c`), grace | Codificar **Fase 2 (rechazo)** + voltear flags tras tráfico jueves |
| **Enforcement cancelar/reabrir** | ✅ desplegado en grace (`7a8ba48b`, `ceea3927`) | Voltear `*_STRICT` a true tras observar |
| **merge-orders: totales server-side** (P0-F) | ❌ `TODO` en `merge-orders/route.ts:40` (confía en el cliente) | **Recalcular desde `pos_menu_items`** — es un vector de skimming abierto |
| **Permisos server-side** (PERM-07) | 🔶 gating client/PIN-side | Confirmar que `/api/pos/*` valida rol/PIN **server-side**, no solo registra |
| **Credenciales MP Point / Clip → vault** (P0-H/I) | ❌ `TODO` (client-supplied apiKey/token = riesgo) | Leer de `credentials_vault` por `clientId` |

→ Todo server-side, **no toca offline**. Es la ola más barata con más impacto (cierra dinero).

### 🟠 OLA B — Desbloquea venta + AMALAY 100% (los que nombraste)

| Item | Estado | Trabajo |
|---|---|---|
| **Bug laboratorio** | ver §0 | fix inmediato + de código |
| **Constructor de mapa de mesas** (`/pos/plano-editor`) | ✅ **funciona** (drag-drop, capacidad/personas ✓, guarda a `pos_mesas` por-tenant) — pero **solo en `feat/pos-ui-kit`, no en main**; sin link de nav; y las coords no se renderizan en la vista planograma (AMALAY usa `FLOOR_TABLES` hardcode + gate `client==='amalay'`) | **Mergear a main + link de nav + unificar coordenadas** para que el plano de un restaurante NUEVO se renderice (no solo AMALAY). Clave para clonabilidad. |
| **Cuenta admin / roles (PoloTab/Wansoft)** | 🔶 **3 sistemas desconectados:** `roles.ts` (dashboard, fuente=`client_users`, bien) + `pos_staff` (PIN) + `/admin/usuarios` (**cosmético** — escribe a un blob JSON en `wansoft_data`, no crea usuario real) | **Unificar en `client_users`** como fuente única + reconectar `/admin/usuarios` (crear Supabase Auth user + fila `pos_staff` con PIN) + colapsar 3 taxonomías + agregar tier `platform_admin` (super-admin Fullsite → dueño → gerente → mesero). |
| **Alta de mesero en ~30s** (rotación) | 🔶 motor listo (`roles.ts`, `pos-pin.ts`, `admin/usuarios`) | Wizard de un paso: nombre → rol-plantilla → PIN/huella. Sobre el motor existente. |
| **Mergear `feat/pos-ui-kit` → main** | ⬜ (228 commits divergidos) | Sesión dedicada; desbloquea el mapa de mesas + todo el rediseño POS. Es la Ola 1 de PLAN-AHORA. |

### 🟡 OLA C — Street-wise (el moat; el motor casi siempre existe)
De ~18 realidades de calle, 8 atacables por código:

| Landmine | Feature | Estado | Esfuerzo |
|---|---|---|---|
| Robo en turno de noche | **Alertas de fraude en tiempo real** (event-driven sobre `pos_audit_log`, no cron viernes) | ❌ net-new (la única brecha de arquitectura) | Medio-Alto |
| Cortesías fantasma / descuentos raros | Detección por umbral + `mesero==autorizador` | ✅ lógica en `antifraud_agent.py`; falta feed POS-nativo (capturar `autorizador`) | Bajo |
| Merma inflada | Detección de merma % fuera de baseline | 🔶 registro ✓ (`recordMovement('waste')`); falta la anomalía (= Fase 4 varianza) | Medio |
| Efectivo: hueco vs ventas | Arqueo + flag ratio anómalo | ✅ hecho (`pos-arqueo.ts`, `cash_shift`) | — |
| Impresora por estación | Health-check de cobertura al abrir turno (OFF-01) | ❌ no implementado | Bajo (aditivo; roza offline con cuidado) |
| "El sistema está mal" | Audit trail inmutable | ✅ hecho (`pos_audit_log` transaccional) | — |

### 🟢 OLA D — Verdad de inventario (el core de Alejandro; net-new con motor reusable)
Plan detallado en `INVENTARIO-ENTRADAS-SALIDAS-IMPL.md`. `recordMovement` (costo promedio, ledger, idempotencia) ya existe.
- **Fase 1:** entradas al contrato — migrar `pos/facturas-proveedor` (PATCH → `invoice_entry`). Bajo, ~1 día.
- **Fase 2:** CFDI de entrada (parse XML + mapeo concepto→ingrediente + match esperado vs físico). Alto.
- **Fase 3:** recetas con IA (`POST /api/recipes/suggest`, Claude) + yield + sub-recetas. Medio.
- **Fase 4:** varianza + reorden + precios con contexto.
- Nota: `entradas-factura` ya parsea CFDI parcialmente (`parseCFDI`); falta el agente DASH-03 que da entrada solo.

### 🔵 OLA E — Automatización / IA (roadmap post-venta)
| Item | Estado |
|---|---|
| **Fase 0 IA** (agent_events + get_monitoring_context) | ✅ desplegado esta sesión (`0b0912ad`); falta adoptar por-agente |
| **Un experto con contexto** (no 24 agentes ciegos) | 🎯 diseño escrito (`docs/ai/AI-ARCHITECTURE-DIRECTION.md`) |
| **CRM recovery agent** (Bernardo) | 🔶 `wa.me` manual; falta WhatsApp Business API + bulk + tracking |
| **DASH-03** agente lee factura → entrada de inventario | ❌ (parseo existe, falta el agente) |
| **DASH-06** transferencias inter-sucursal | ❌ no empezado |
| **pgvector / RAG** (idea Juan Carlos) | ❌ gap AI-native |
| **Split por N personas** (>3) | 🔶 parcial (C1/C2/C3) — confirmar N + división pareja |
| **Reorden analítico DASH-04** | 🔶 ~70% (`predict/route.ts` + UI); falta estacionalidad/colchón de Eduardo |

---

## Correcciones a la memoria (de-sincronizadas)
- **PAC = Facturama**, NO Facturapi (actualizar `project_facturacion_pac.md`).
- Ya HECHO (memorias los listan pendientes): pre-ticket, reimprimir ticket, facturación CFDI, MP Point ~80%, botones grandes POS, KDS Eduardo, app offline empaquetada.
- Estos NUEVOS no estaban en ningún tracker → van a `OPEN-ITEMS.md`: P0-F merge-orders, P0-H/I vault MP/Clip, enforcement permisos, laboratorio bug, plano-editor cierre, roles unify, DASH-03/06, CRM bulk, pgvector, split-N.

---

## Secuencia recomendada (código)

1. **Ahora → jueves:** solo AMALAY 100% (campo). No abrir frentes.
2. **Post-jueves, semana 1:** Ola A (dinero/seguridad — barato, cierra fraude) + el fix del bug laboratorio + mergear rama→main.
3. **Semana 2-3:** Ola B (mapa de mesas al 100% + roles unificados + alta rápida) — desbloquea venta y clonabilidad.
4. **Después:** Ola C (street-wise), Ola D (inventario verdad), Ola E (IA/automatización) — en ese orden de impacto/esfuerzo.

**Regla:** nada de A-B-C toca el camino offline congelado (salvo el health-check de impresoras, aditivo). D-E son dashboard/servidor. El fraude y la verdad de inventario son los dos que más mueven la aguja del negocio real.

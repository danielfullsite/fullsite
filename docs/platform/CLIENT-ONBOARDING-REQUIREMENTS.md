# Onboarding de clientes #2–10,000+ — Requisitos, flujo self-serve y de-risking de Claude Code

> Complemento operacional de `docs/platform/SCALE-STRATEGY-10K.md`.
> **Objetivo:** que un cliente nuevo se dé de alta **desde `/platform` (super-admin)**,
> de cualquier fuente, **sin que Daniel ni un ingeniero toquen código.**
> Backlog dirigido a la flota de clonabilidad (`TSK-015`) y provisioning.

---

## 1. Qué necesita un cliente para entrar

### A. Mínimo para ir en vivo (obligatorio)

| Input | Qué es | De dónde | Estado hoy |
|---|---|---|---|
| **Identidad** | nombre, ciudad, timezone, tipo, # mesas, logo, accent/theme | formulario | ✅ `provisionTenant` |
| **Dueño** | email + contraseña (crea su login) | formulario | ✅ `/api/platform/onboard` |
| **Menú** | platillos, precios, categorías, modificadores | connector (Wansoft / CSV / manual) | ⚠️ connector aún no self-serve |
| **Staff** | usuarios POS: nombre, PIN, rol | connector o formulario | ⚠️ `staff_import` existe, falta UI |
| **Hardware** | qué terminales: POS, KDS, impresora | provisioning por código | ⚠️ backend listo, falta wizard |

> Para ir en vivo basta **A**. Todo lo demás es incremental.

### B. Opcional (features avanzados — se agregan después)

| Feature | Requiere | Habilita |
|---|---|---|
| Food-cost / inventario | recetas, ingredientes, puntos de reorden, proveedores | alertas de stock, costeo |
| CFDI / facturación | RFC, razón social, régimen fiscal, CP, domicilio | facturación mexicana |
| Historia de ventas | export de ventas pasadas | reportes con historial (= "migración") |
| Delivery | creds Uber/Rappi + mapping de store | pedidos de plataformas |

### C. Su fuente de datos (define el connector)

| Fuente | Fricción | Frecuencia esperada a escala |
|---|---|---|
| **De cero** | ninguna — captura en Fullsite | **la más común** |
| **CSV / Excel** | el cliente llena una plantilla y la sube | común |
| **Wansoft** | captura cookie 1 vez (paso concierge — CAPTCHA) | segmento MX que ya usa Wansoft |
| **Otro POS** | connector por integración | largo plazo |

**Regla:** la fuente es solo la forma de llenar el menú/staff. **No debe cambiar el resto del alta.**

---

## 2. El flujo self-serve desde `/platform`

```
/platform → "Nuevo cliente"
  1. Identidad + dueño          → provisionTenant (esqueleton completo, idempotente)     [✅ existe]
  2. Fuente del menú            → selector: De cero / CSV / Wansoft / Otro POS           [⚠️ falta UI]
                                   → corre el connector → modelo canónico → escribe menú
  3. Staff                       → CSV/plantilla o captura                                [⚠️ falta UI]
  4. Terminales                  → genera código por terminal; cada POS/KDS se autoconfigura [⚠️ falta wizard]
  5. (Opcional) integraciones / fiscal / recetas                                          [incremental]
  6. Smoke test automático       → "listo / falta X"                                      [✅ existe]
```

**Base ya construida:** `lib/provision-tenant.ts`, `/api/platform/onboard` (2FA + audit), gate `CLON-ONBOARD` (<20 min ✅), smoke test ✅, `CLON-IMPORTS` (menu/staff import ✅).

**El gap:** la **capa de orquestación + UI** encima — selector de fuente, wizard, y el paso de terminales.

---

## 3. De-risking: las 7 piezas para NO depender de Claude Code

> Principio: **cada paso que hoy requiere que un ingeniero corra un script → se vuelve un botón/formulario en `/platform`.** Claude Code construye el producto **una vez**; no opera **cada alta**.

| # | Pieza | Qué elimina | Prioridad |
|---|---|---|---|
| **1** | **Wizard de alta self-serve** (formulario guiado en `/platform`) | correr `onboard_client.py` a mano | 🔴 P0 |
| **2** | **Import por plantilla CSV** (menú/staff) | dependencia de Wansoft para la mayoría | 🔴 P0 |
| **3** | **Selector de connector en la UI** (De cero / CSV / Wansoft / Otro) | ejecutar scripts de migración a mano | 🔴 P0 |
| **4** | **Provisioning de terminales por código** (POS/KDS se autoconfiguran) | editar `config.json` por terminal | 🟠 P1 |
| **5** | **Paso de cookie Wansoft guiado** (pantalla "pega tu cookie aquí") | ingeniero corriendo `wansoft_auth.py store` | 🟠 P1 |
| **6** | **Validación / smoke-test integrado** (autoverifica, dice "listo/falta X") | alguien revisando manualmente | 🟠 P1 |
| **7** | **Plantillas / starter kit** (categorías, roles, estaciones KDS por defecto) | configurar todo desde cero cada vez | 🟡 P2 |

**El norte medible:** *un vendedor — o el propio cliente — da de alta un restaurante desde `/platform`, de cualquier fuente, en < 20 min, sin que Daniel ni un ingeniero escriban una línea.*

---

## 4. La verdad sobre Wansoft en este flujo

Wansoft es **un connector con un paso concierge** (la cookie, por el CAPTCHA). NO es el core y NO debe frenar el producto:

- La **mayoría** de los 10,000 entrarán **de cero o por CSV** (piezas #1–#3) — sin tocar Wansoft.
- Para el **segmento que ya usa Wansoft**, la cookie es una pantalla guiada (pieza #5), no una tarea de ingeniería.
- El **65% de rechazo** del dry-run se resuelve en la **capa canónica** (aplica a todo connector), no en el connector de Wansoft. Ver `docs/platform/migrations/06-implementation-roadmap.md`.

---

## 5. Recomendación de secuencia para la flota (`TSK-015`)

1. **Piezas #1–#3** (wizard + CSV + selector de connector) → esto solo **desbloquea la mayoría de los 10,000** sin depender de Wansoft ni de Claude Code.
2. **Pieza #4** (terminales por código) → cierra el hardware self-serve.
3. **Piezas #5–#6** (cookie guiada + smoke integrado) → cubre el segmento Wansoft y la validación.
4. **Pieza #7** (starter kit) → acelera el tiempo-a-vivo.

Con #1–#4 hechos, **Daniel deja de ser el cuello de botella del alta** — que es el requisito real para escalar a 10,000.

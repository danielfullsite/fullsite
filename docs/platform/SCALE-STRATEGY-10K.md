# Estrategia de escala a 10,000+ clientes — Onboarding & Migración

> Norte de arquitectura para alinear a todas las sesiones/agentes.
> No es implementación: es la decisión de **hacia dónde** apunta la clonabilidad.
> Referencia el diseño existente en `docs/platform/migrations/` (00–07).

---

## 1. La tesis (una frase)

**A 10,000 clientes se llega con onboarding self-serve sobre una arquitectura de _connectors_ hacia un modelo canónico — NO scrapeando Wansoft por cliente.**

Wansoft es **un** connector, no el core. Enamorarse del scraper de Wansoft como mecanismo de escala es una trampa.

---

## 2. Por qué Wansoft NO es el camino de escala

| Límite | Consecuencia a escala |
|---|---|
| CAPTCHA (Cloudflare Turnstile) en el login | La cookie se captura **a mano, por cliente**. No hay forma de capturar 10,000 cookies automáticamente. Techo físico. |
| Solo sirve a clientes de Wansoft | De 10,000, la mayoría vendrá de otro POS o de cero. |
| 65% de rechazo en dry-run + `CLIENT_ID` hardcodeado a AMALAY | Es un one-off de AMALAY, no un producto reutilizable. |

**Conclusión:** si construyes la escala sobre el puente de Wansoft, no escala.

---

## 3. Lo que SÍ escala: connectors → modelo canónico → provisionTenant

La flota ya diseñó lo correcto (`04-canonical-model`, `05-connector-contract`). Elevado a estrategia:

```
CUALQUIER fuente ──[connector: EXTRAE + MAPEA]──> MODELO CANÓNICO ──[core: VALIDA + ESCRIBE]──> tenant nuevo

  Wansoft    = un connector (cookie = paso concierge, 1 vez)
  CSV/Excel  = un connector (el cliente sube su export)
  Otro POS   = un connector por integración
  De cero    = SIN connector (el caso más común a escala)
```

**Principio (de `05-connector-contract`):** el connector nunca escribe a tablas productivas. Extrae y mapea al canónico; el core valida, transforma y escribe. Eso hace los connectors **intercambiables** y el onboarding **source-agnostic**.

**La regla de oro de escala:** onboarding un cliente **NUNCA** debe requerir ingeniería por cliente. Debe ser: elegir fuente → correr connector → provisionar.

---

## 4. Desde dónde se hace — el punto único de control

**Super-admin / Control Plane (`daniel@fullsite.mx` → `/platform`).** Un solo lugar:

```
/platform → "Nuevo cliente" → elige FUENTE (Wansoft / CSV / otro POS / de cero)
          → corre el connector → modelo canónico → provisionTenant → cliente vivo
```

Ya existe la base: `/api/platform/onboard` + `lib/provision-tenant.ts` (admin-gated 2FA, idempotente, esqueleton completo). Falta el **selector de fuente + orquestación de connectors** encima de eso.

---

## 5. Prioridades (en orden de leverage)

1. **Modelo canónico + contrato de connector (`04`/`05`) — cerrarlos.** Palanca #1: convierte "migrar de Wansoft" en "migrar de lo-que-sea".
2. **Resolver el 65% de rechazo en la CAPA CANÓNICA**, no en el connector de Wansoft. Ese problema (orphan references) va a pegar en **todo** connector — resuélvelo una vez, donde se valida/transforma.
3. **Onboarding 100% self-serve desde `/platform`** — extender el `/api/platform/onboard` existente con selector de fuente.
4. **Wansoft = connector con cookie concierge.** Encapsular la fragilidad (cookie/CAPTCHA) en un solo connector, no dejarla filtrar al producto.
5. **Terminales config-as-data** (1 binario, config por manifest/código de provisioning) — el POS/KDS de cada cliente se autoconfigura sin ingeniería. Ver `docs/platform/PROVISIONING.md`.

---

## 6. Qué NO hacer

- ❌ No invertir en "automatizar" el scraper de Wansoft como mecanismo de escala (el CAPTCHA es un techo duro).
- ❌ No arreglar el 65% de rechazo dentro del connector de Wansoft (se repetiría por connector).
- ❌ No hardcodear ningún tenant en el pipeline (ver gate `CLON-HARDCODES`).
- ❌ No requerir que Daniel escriba código para dar de alta un cliente (ese es el objetivo `CLIENT_2_READY`).

---

## 7. Nota de alineación para la flota

Este doc es el **norte compartido**. Las sesiones que tocan clonabilidad (`TSK-015`), migración (`docs/platform/migrations/`) y provisioning deben converger aquí:

- La migración de un cliente **NO es un feature de Wansoft** — es "elegir connector".
- El trabajo de más alto leverage es el **canónico + contrato de connector**, no perfeccionar un scraper.
- El objetivo medible: **dar de alta un cliente nuevo (de cualquier fuente) desde `/platform`, sin ingeniería por cliente.**

Para el **Cliente #2** concretamente: la decisión de negocio es **¿arranca de cero (rápido, viable el 22 ago) o necesita traer su Wansoft (depende de la Fase 1 del motor, ~2-3 semanas)?** Ver `docs/platform/migrations/06-implementation-roadmap.md`.

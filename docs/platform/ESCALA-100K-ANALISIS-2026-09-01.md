# Escalar Fullsite a 100,000 restaurantes — análisis estructural

> **Fecha:** 2026-09-01 · **Pregunta que responde:** *"hay que poder escalar esto a nivel clon
> 100,000 a nivel estructura del sistema, ¿qué propones y en qué punto estamos?"* (Daniel)
>
> **Cómo leer esto.** Cada afirmación trae su fuente: una consulta a producción, un archivo del
> repo, o una medición con fecha. Lo que no la trae va marcado **[no verificado]**. Los números
> se midieron el 2026-09-01 sobre la base de producción.

---

## Resumen en cuatro líneas

- **La forma multi-tenant ya es correcta.** Una base, un deploy, `client_id` por host. Eso es lo
  caro de acertar y está acertado.
- **El muro que te frena hoy no es la base de datos: es que el sistema necesita a una persona que
  lo entienda, por restaurante.**
- Estás listo para ~10 clientes. La estructura aguanta ~1,000 con trabajo conocido. Para 100,000
  falta un **cambio de forma**, no más código.
- **El orden importa más que la velocidad.** Sumar clientes antes de quitar al humano del ciclo
  multiplica el trabajo manual por cada uno.

---

## 1. Lo medido, hoy

Consultas a producción, 2026-09-01:

| Métrica | Valor |
|---|---|
| Tenants dados de alta | **13** |
| Tenants con al menos una orden | **11** |
| `pos_orders` | **128,006 filas · 107 MB** (~876 bytes/fila) |
| Escenarios offline **certificados** | **0 de 26** ([TEST-MATRIX](../offline/TEST-MATRIX.md)) |
| Latidos de servidores locales recibidos | **0 — nunca se ha escrito una fila** |
| Tokens de aprovisionamiento emitidos | **0 — nunca se ha usado** |

### La extrapolación de datos

AMALAY opera alrededor de **167 tickets/día** (cifra de campo: es el umbral sobre el cual el
dashboard empezaba a truncar). Eso es ~**61,000 órdenes al año** por restaurante.

```
100,000 restaurantes × 61,000 órdenes/año  =  6,100 millones de filas/año
6,100 M × 876 bytes                        ≈  5.3 TB/año en UNA tabla
```

**Y ése no es el muro que pega primero.** Ni de cerca.

---

## 2. Los cinco muros, en el orden real en que llegan

### Muro 1 — la persona · pega entre **10 y 50 clientes** ← aquí estás

Instalar y sostener un restaurante requiere hoy a alguien que **entienda el sistema**, presente
físicamente. Es la regla **R7 de Eduardo** (*"la configuración tiene que darse in-house"*), y está
sin implementar.

**La evidencia es la sesión del 2026-08-31 → 09-01:** dos personas, toda la noche, **un** solo
restaurante. Con acceso remoto para borrar carpetas del Service Worker a mano. Eso no se
multiplica por dos, mucho menos por cien mil.

**Síntoma medible:** 0 de 26 escenarios certificados, y la única forma de certificar uno es
**mandar a una persona**.

### Muro 2 — no saber · pega hacia **200–1,000**

Hoy te enteras de que un KDS está caído **porque alguien está parado ahí**. Con 500 restaurantes,
el #347 lleva tres días imprimiendo mal y nadie lo sabe.

**Estado real, y es mejor de lo que parece:** el código existe en las **dos puntas** —
[`electron-app/local-server/telemetry/heartbeat.js`](../../electron-app/local-server/telemetry/heartbeat.js)
manda, [`api/platform/devices`](../../dashboard-app/src/app/api/platform/devices/route.ts) recibe —
pero `local_server_heartbeats` tiene **cero filas**.

> **Está construido y no corriendo.**

**Pero encenderlo NO es barato, y aquí está el nudo del asunto.** `heartbeat.js` vive en el
servidor local, no en el deploy web: **no viaja por Vercel**. Activarlo exige **instalador nuevo y
reinstalar terminal por terminal**.

O sea que **el muro 2 no se puede quitar sin quitar antes el muro 1**. Con 500 restaurantes, ir a
encender la telemetría de cada uno es exactamente el problema que la telemetría venía a resolver.

> **Ésta es la trampa de fondo:** casi todo lo que arreglaría la escala vive del lado que hoy
> requiere una visita física.

### Muro 3 — la configuración es código · **ya te está pegando**

**La plomería existe y está bien hecha:** `clients.pos_settings` (JSONB) y una API de plataforma
para ver y editar los settings de cualquier tenant sin tocar código.

**La política no la usa.** `pos-config.ts` sólo expone lo cosmético y lo fiscal (dirección, logo,
IVA, RFC). **Ni una sola regla de operación es configurable.**

Ejemplo del mismo día: la regla de Eduardo de no abrir turno con cuentas abiertas se implementó
**fija para todos los tenants**. Detalle en
[ADR-003 addendum §5-bis](../adr/ADR-003-ADDENDUM-REGLAS-EDUARDO.md).

Con 100k, cambiarle una regla a un cliente **no puede ser un deploy**.

### Muro 4 — un solo Postgres · hacia **5,000–10,000**

Escrituras concurrentes, límite de conexiones, y `pos_orders` sin particionar.

**Es el muro más lejano y el más fácil**: es ingeniería conocida — particionar por `dia_venta`
(la columna se creó hoy), archivar frío, réplicas de lectura. **No requiere inventar nada.**

### Muro 5 — geografía · al salir de México

Un restaurante en España pegándole a una base en EE.UU. Con el POS **local-first** esto casi
desaparece, porque la operación deja de depender del viaje de ida y vuelta.

---

## 3. La forma que se propone

> **Hoy el sistema necesita que alguien lo entienda. A 100,000 tiene que entenderse solo.**

Tres cambios de forma, en este orden:

| # | Cambio | Qué muro quita | Por qué en ese orden |
|---|---|---|---|
| **1** | **Local-first de verdad.** El servidor local es la autoridad durante el servicio; la nube es respaldo y consolidación | 5, alivia el 4 | Además **hace el offline probable**, que es lo que hoy exige una persona |
| **2** | **Toda regla operativa sale de datos**, no de código | 3 | Sin esto, cada cliente distinto es un deploy |
| **3** | **Instalación sin humano**: la terminal se aprovisiona sola con un código de un solo uso | 1 | Es el muro que te frena ahora |
| **0** | **Encender los latidos** | 2 | Ya está construido — pero vive en el servidor local: exige **instalador nuevo**. Va junto con el #3, no antes |

> **Corrección al orden intuitivo.** Los latidos parecen la fruta baja: el código ya existe. No lo
> son, porque vive del lado que requiere visita física. **Se agrupan con el #3 en el mismo
> instalador**, o se paga el viaje dos veces.
>
> La regla que se deriva: **todo cambio del servidor local se acumula y viaja junto.** Cada
> instalador que se suelta cuesta una visita por restaurante.

Y **atravesando los tres**: un **Electron de prueba en CI** que arranque sin red, mande comanda,
corte la WAN y verifique. Sin eso, los tres cambios se hacen a ciegas — y cada uno toca la pieza
más delicada del sistema.

### Por qué local-first va primero

No es preferencia técnica. Es que **hoy hay tres fuentes de verdad** —la nube, el servidor local,
y el caché de cada terminal— y cuando se cae el internet cada una opina distinto.

Los cuatro fallos de producción del 2026-08-31 **estaban todos en ramas de respaldo**, no en el
camino normal. Cada respaldo es un lugar donde poner un bug. Con local-first, el camino normal
**ya es** el local: la rama de respaldo desaparece en vez de multiplicarse.

**Y ya está a medio construir.** El servidor local mantiene mesas, turno y bloqueos, y los
transmite por WebSocket. Medido el 2026-08-31 en la caja de AMALAY:

```
Claves que el servidor local YA mantiene:
  sequence · mesas · kds_queue · kds_orders · turno · locks
```

Las terminales no le preguntan: le preguntan a la nube. El diseño de la Fase 2 está escrito desde
julio en [`OFFLINE-GAP-001`](../architecture/OFFLINE-GAP-001.md) y
[`OFFLINE-GAP-002`](../architecture/OFFLINE-GAP-002.md), con este comentario en el código:

> *"Supabase is still primary write authority (Phase 2 will change this)"*

**No hay que rediseñarlo. Hay que terminarlo.**

---

## 4. Construido · Diseñado · Nada

Distinguir esto es lo que separa un plan de una lista de deseos.

| Capacidad | Estado | Evidencia |
|---|---|---|
| Multi-tenant con `client_id` por host | ✅ **Construido y en uso** | 13 tenants vivos |
| Aislamiento por tenant (RLS) | ✅ **Construido** | Hoy se cerró además una escalada de privilegio en la huella |
| Servidor local con estado del restaurante | ✅ **Construido** | Mantiene mesas, turno, locks, KDS |
| Terminales que **leen** ese estado | ❌ **Nada** | Le preguntan a la nube |
| Latidos de salud | ⚠️ **Construido, apagado** | Código en ambas puntas · **0 filas** · encenderlo exige instalador nuevo |
| Config por tenant (plomería) | ✅ **Construido** | `pos_settings` + API de plataforma |
| Reglas de operación configurables | ❌ **Nada** | Ninguna sale de datos |
| Aprovisionamiento sin humano | ⚠️ **Diseñado** | Tabla y docs · **ningún código lo emite ni lo canjea** |
| Día de venta por tenant | ✅ **Construido hoy** | `tekila-rg` numera folios en `America/Chicago` |
| Prueba de offline sin humano | ❌ **Nada** | 0 de 26 certificados |

---

## 5. Dónde estás, sin adornos

| | |
|---|---|
| Forma multi-tenant | ✅ Correcta. Lo caro ya está acertado |
| Aislamiento | ✅ |
| Clonabilidad técnica | ⚠️ Un clon nace aislado y seguro, **pero necesita a una persona** |
| Certificación | ❌ **0 de 26** |
| Observabilidad | ⚠️ Construida, **apagada** |
| Escala de datos | ⚠️ Sirve para cientos. No para cien mil |

**Listo para 10. Aguanta 1,000 con trabajo conocido. Para 100,000 falta un cambio de forma.**

---

## 6. Lo que este documento NO dice

- **No es un plan con fechas.** Los rangos de los muros ("10–50", "200–1,000") son estimaciones de
  ingeniería, **no mediciones**. El único dato duro de escala es el de la tabla: 128,006 filas en
  107 MB.
- **No cubre lo comercial ni lo económico** — costo por tenant, soporte, márgenes.
- **No cubre el hardware.** Cada restaurante necesita terminales, impresoras y red. Eso no lo
  arregla ninguna arquitectura.
- **Ningún cambio propuesto está validado en campo.** El 2026-09-01 hay diez cambios en producción
  con 2,817 pruebas verdes y **cero** validación física. La hoja para cerrar esa brecha está en
  [`HUMO-AMALAY-2026-09-01.md`](../offline/HUMO-AMALAY-2026-09-01.md).

---

## Fuentes

- Producción (Supabase `qjiomlvudfmzuvqvhwpk`), consultada 2026-09-01: conteos de tenants, tamaño
  de `pos_orders`, `local_server_heartbeats`, `provisioning_tokens`.
- Repo en `origin/main` al 2026-09-01.
- [`docs/offline/TEST-MATRIX.md`](../offline/TEST-MATRIX.md) — 26 escenarios, 0 certificados.
- [`docs/architecture/OFFLINE-GAP-001.md`](../architecture/OFFLINE-GAP-001.md) y
  [`OFFLINE-GAP-002.md`](../architecture/OFFLINE-GAP-002.md) — el diseño de Fase 2, de julio.
- [`docs/adr/ADR-003-ADDENDUM-REGLAS-EDUARDO.md`](../adr/ADR-003-ADDENDUM-REGLAS-EDUARDO.md) — las
  reglas de dominio y la deuda de clonabilidad.
- Estado del servidor local: medido en la caja de AMALAY el 2026-08-31.

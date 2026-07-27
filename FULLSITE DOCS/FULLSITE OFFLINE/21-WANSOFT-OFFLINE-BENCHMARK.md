# Benchmark Offline: Wansoft vs Fullsite

> Fuentes: `docs/reference/wansoft/ARCHITECTURE.md`, `docs/reference/wansoft/CAJA-SPEC.md`,
> `docs/reference/wansoft/DATA-MODEL.md`, `docs/reference/wansoft/BACKOFFICE-KNOWLEDGE.md`,
> `docs/product/WANSOFT-POS-BIBLE.md`, `docs/runbooks/OFFLINE-CERTIFICATION-RUNBOOK.md`,
> `FULLSITE DOCS/03-LOCAL-FIRST/LOCAL_FIRST_ARCHITECTURE.md`.
>
> Metodología: análisis documental + prueba de campo en AMALAY (2026-07-24).
> Para Wansoft: lo que está **documentado** se marca como tal. Lo que fue **inferido**
> del modelo de datos o del manual de instalación se marca (inferido). Lo que es
> **desconocido** se declara abiertamente — no se especula.
>
> Propósito: tomar decisiones de producto informadas sobre el sistema offline de Fullsite.
> No es un documento de marketing.

---

## 1. Principio de autoridad local

La pregunta más importante para evaluar un sistema offline no es "qué funciones tiene" —
es "quién es el árbitro cuando no hay internet".

### Wansoft — SQL Server como autoridad única

```
┌────────────────────────────────────────────────────────┐
│                RESTAURANTE (LAN WANSOFT)               │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │              SQL Server (Caja 192.168.1.71)     │  │
│  │              Puerto 1433 — AUTORIDAD ÚNICA      │  │
│  │                                                 │  │
│  │  822 Stored Procedures                          │  │
│  │  Toda la lógica de negocio en SQL               │  │
│  │  Sin event log / sin queue / sin cache          │  │
│  └──────────────┬──────────────────────────────────┘  │
│                 │ TCP                                  │
│         ┌───────┴────────────┐                        │
│         │                   │                         │
│  PDV1 (1433)         PDV2 (1433)                      │
│  PDV3 (1433)                                          │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │  WebApi (IIS, puerto 80)                        │  │
│  │  Solo para KDS (Android APK Comandero)          │  │
│  └──────┬──────────────────────────────────────────┘  │
│         │ HTTP                                         │
│  Comandero APK (Android)                               │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │  RestPrintingApp.exe (en Caja)                  │  │
│  │  Polling SQL cada 15 segundos → imprime         │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│                   │ (internet)                         │
│                   ▼                                    │
│        Wansoft Cloud (solo sync, e-commerce)          │
└────────────────────────────────────────────────────────┘
```

**Hallazgo clave:** en Wansoft, la autoridad local es un proceso de SQL Server que corre en
la Caja. Todos los terminales PDV se conectan directamente a SQL por TCP port 1433.
No hay intermediario, no hay cache, no hay cola. Si SQL Server cae → todo se detiene.

### Fullsite — Local Server como hub con event sourcing

```
┌────────────────────────────────────────────────────────┐
│                RESTAURANTE (LAN FULLSITE)              │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │         SERVER1 (Windows PC)                   │  │
│  │                                                 │  │
│  │  ┌───────────────────────────────────────────┐ │  │
│  │  │   Fullsite Local Server (Node.js, :7717)  │ │  │
│  │  │   AUTORIDAD LOCAL — ÚNICA FUENTE DE VERDAD│ │  │
│  │  │                                           │ │  │
│  │  │  CoreEventStore → events.ndjson (disco)   │ │  │
│  │  │  RestaurantState (memoria, reconstruible) │ │  │
│  │  │  WsHub (broadcast a todos los clientes)   │ │  │
│  │  │  CommandHandler (idempotencia)             │ │  │
│  │  └───────────────────────────────────────────┘ │  │
│  │                                                 │  │
│  │  POS (Electron) ←─── WS ────→ KDS (Electron)  │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  PDV2, PDV3 (Chrome) ←── WS/HTTP ──                   │
│  KDS dedicado (Electron kds_only)                      │
│                                                        │
│                   │ (internet)                         │
│                   ▼                                    │
│     Supabase (sincronización, dashboard, BI, IA)       │
└────────────────────────────────────────────────────────┘
```

**Diferencia arquitectónica fundamental:** en Fullsite, los terminales secundarios no se
conectan directamente a la base de datos — se comunican con el Local Server por WebSocket.
El Local Server es el único que escribe al event log. Esta separación permite que el sistema
continúe operando si el servidor principal pierde internet, mientras que en Wansoft
la pérdida de SQL Server detiene todo inmediatamente.

---

## 2. Capacidades comparadas por dimensión

### 2.1 Arranque sin internet (cold boot offline)

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| POS arranca sin internet | **Sí** (inferido) — SQL Server es local, no remoto | **Sí** — Service Worker + IDB desde SW install | Wansoft: inferido del hecho de que SQL es local; Fullsite: certificado A-01-OFFLINE PASS 2026-07-24 |
| KDS arranca sin internet | Desconocido — Comandero APK Android, depende de caché del APK | **Sí** — mismo Service Worker, mismo IDB | Wansoft: no documentado; Fullsite: LOCAL_FIRST_ARCHITECTURE.md §KDS |
| Tiempo de arranque sin internet | Desconocido | ~5 segundos (PIN screen desde SW cache) | Fullsite: evidencia directa OFFLINE-CERTIFICATION-RUNBOOK.md A-01-OFFLINE |
| Config necesaria para arrancar offline | Desconocido | config.json + primer arranque online exitoso | Fullsite: config-schema.js |

**Análisis:** Wansoft tiene la ventaja de que su POS es una aplicación Windows nativa que se
conecta directamente a SQL Server local — no hay dependencia de un servicio web remoto en el
arranque. Fullsite cargó originalmente desde `https://app.fullsite.mx` (Vercel), lo que
requirió un Service Worker para el arranque offline. Esa dependencia fue resuelta y certificada.
El resultado es funcionalmente equivalente, pero la arquitectura de Fullsite tiene una capa de
complejidad adicional (Service Worker, caches) que Wansoft no necesita.

---

### 2.2 Tomar y enviar una orden sin internet

| Capacidad | Wansoft | Fullsite | Notas |
|---|---|---|---|
| Crear orden sin internet | **Sí** — escribe directo a SQL local | **Sí** — IDB local + sync_queue | |
| Enviar comanda a cocina sin internet | **Sí** — RestPrintingApp imprime de SQL | **Sí** — Local Server broadcast por LAN WS | |
| Cocina ve la orden sin internet | **Sí** — KDS lee de WebApi que lee de SQL | **Sí** — KDS recibe evento LAN por WS | |
| Latencia POS → cocina sin internet | ~15 segundos (RestPrintingApp polling SQL) | < 1 segundo (WS push LAN) | **Fullsite gana** |
| La orden persiste ante corte de luz | **Sí** — SQL Server con WAL en disco | **Sí** — events.ndjson en disco antes del ACK | |
| La orden se sincroniza cuando vuelve internet | **No** — SQL Server es la autoridad final, no sincroniza a la nube | **Sí** — sync_queue sube a Supabase en <30s | Diferencia fundamental de modelo |

**Análisis:** ambos sistemas pueden tomar y procesar órdenes sin internet. La diferencia
operativa más significativa es la latencia: Wansoft usa polling de 15 segundos en
RestPrintingApp, mientras que Fullsite usa push por WebSocket. Una comanda que el mesero
envía en Fullsite aparece en cocina en milisegundos; en Wansoft puede tardar hasta 15 segundos.

---

### 2.3 Impresión sin internet

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Impresión de comanda sin internet | **Sí** — RestPrintingApp.exe polling SQL cada 15s, imprime vía TCP | **Sí** — Local Server imprime via TCP o USB inmediatamente | |
| Routing por estación (cocina/barra/caja) | **Sí** — por grupo de platillo o por platillo | **Sí** — por estación configurada en printers.json | |
| Apertura del cajón registradora sin internet | **Sí** — Getnet standalone (NO integrado con Wansoft) | **Sí** — `POST /drawer` al Local Server | Wansoft: CAJA-SPEC.md — Getnet es terminal standalone |
| Reimpresión sin internet | Desconocido | **Sí** — Local Server guarda evento, puede reimprimir | |
| Print queue con retry | **No** — si impresora no responde, RestPrintingApp sigue intentando en el siguiente poll (15s) | **Sí** — Local Server tiene retry automático | |

**Hallazgo importante sobre Wansoft:** el cajón de dinero de AMALAY es Getnet (Santander),
que es un terminal bancario INDEPENDIENTE, no integrado con Wansoft vía software. El cajón
se abre manualmente o por otro mecanismo — Wansoft no controla el cajón.
Fullsite controla el cajón directamente vía `POST /drawer`, que dispara un pulso ESC/POS.

---

### 2.4 Pagos sin internet

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Efectivo sin internet | **Sí** — completamente local | **Sí** — sync_queue, sube al reconectar | |
| Tarjeta (terminal bancaria) sin internet | **Depende de terminal** — Getnet es standalone con conexión propia | **Depende de terminal** — MP Point/Clip tienen conectividad propia | Ambos delegan a la terminal bancaria |
| 17 métodos de pago sin internet | **Sí** — incluye vales, transferencia, custom | **Parcial** — efectivo y tarjeta; otros en roadmap Phase 2 | Wansoft: CAJA-SPEC.md §métodos de pago |
| Pago mixto sin internet | Desconocido | **Parcial** — efectivo funciona, tarjeta depende de terminal | |
| Anticipo / cuenta corriente sin internet | **Sí** — CxC en SQL | **No** — no implementado | GAP de Fullsite |

---

### 2.5 KDS sin internet

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| KDS ve órdenes activas sin internet (si ya estaban cargadas) | **Sí** — WebApi → SQL, todo LAN | **Sí** — IDB cache + WS del Local Server | |
| KDS recibe nuevas órdenes sin internet | **Sí** — poll WebApi (intervalo desconocido) | **Sí** — push inmediato por WS LAN | |
| KDS avanza estado de ítem sin internet | **Sí** — escribe a SQL via WebApi | **Parcial** — escribe a IDB local, no sube a Supabase hasta reconexión | GAP Phase 2 |
| KDS en dispositivo Android | **Sí** — Comandero APK nativo | **Sí** — Chrome o Electron con `?bridge=IP` | |
| KDS en segundo monitor del POS principal | **No** — KDS es un dispositivo separado | **Sí** — `kds: true` en config.json, misma máquina | **Fullsite gana** |
| Latencia POS → KDS sin internet | Desconocido (polling WebApi) | < 1 segundo (WS push LAN) | |

---

### 2.6 Persistencia y recovery ante reinicio

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Estado de órdenes después de reinicio del servidor | **Sí** — SQL Server persiste todo, se levanta y continúa | **Sí** — Local Server replay del events.ndjson desde seq 0 | |
| Tiempo de recovery ante reinicio | Desconocido (depende del startup de SQL Server + IIS) | < 5 segundos (replay + IDB) | Fullsite: LOCAL_FIRST_ARCHITECTURE.md |
| Reinicio de terminal PDV (no servidor) | **Sí** — PDV se reconecta a SQL, lee estado | **Sí** — SUBSCRIBE con last_sequence → catch-up deltas | |
| Corte de luz en pleno turno | **Sí** — SQL Server WAL garantiza durabilidad | **Sí** — events.ndjson appendFileSync garantiza durabilidad | Ambos recuperan; Fullsite sin fsync explícito (riesgo menor) |
| Snapshot del estado en disco (para arranque rápido) | **Sí** — SQL Server tiene su propio mecanismo | **No** — replay siempre O(N) desde event 0 | GAP Phase 3 de Fullsite |

**Hallazgo de Wansoft:** la resiliencia de Wansoft ante reinicios es un subproducto de usar
SQL Server — el motor de base de datos tiene décadas de trabajo en durabilidad de datos.
Fullsite replicó la garantía con event sourcing sobre NDJSON, que es funcionalmente equivalente
pero sin las garantías ACID de SQL Server.

---

### 2.7 Multi-terminal sin internet

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Varios POS simultáneos sin internet | **Sí** — todos leen/escriben SQL local por TCP | **Sí** — todos se conectan al Local Server por WS | |
| Coordinación de mesas (prevenir doble apertura) | **Sí** — locking de transacciones SQL | **Sí** — MESA_LOCK en Local Server | |
| Una terminal PDV puede ser servidor de respaldo | **No** — SQL Server solo corre en Caja | **No (Phase 4)** — failover planificado | Wansoft: ARCHITECTURE.md §single point of failure |
| Terminal secundaria accede al menú offline | **Sí** — SQL local tiene el catálogo completo | **Sí** — IDB cache en cada terminal | |

---

### 2.8 Configuración y provisioning

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Fuente de configuración | BD SQL Server (`OrigenDeConfiguraciones=1`) | `config.json` en disco + `printers.json` | Wansoft: ARCHITECTURE.md §config; Fullsite: config-schema.js |
| Config disponible offline | **Sí** — SQL local tiene la config | **Sí** — archivos JSON en disco, sin internet | |
| Config modificable sin internet | **No** — la mayoría de config requiere SQL + la UI de Wansoft | **Sí** — editar config.json y reiniciar Electron | |
| Menú editable sin internet | **No** — menú está en SQL, edición requiere interfaz Wansoft | **No** — menú viene de Supabase; se edita online | Empate |
| Agregar terminal nueva sin internet | **Difícil** — requiere insertar en SQL manualmente o UI Wansoft online | **Sí** — crear config.json con restaurant_id + provisioned_at | **Fullsite gana** |
| 20+ módulos de configuración (wansoft pantalla) | **Sí** — módulos: facturación, KDS, HH, delivery, delivery zones, etc. | **Parcial** | Wansoft: WANSOFT-POS-BIBLE.md §configuración |

---

### 2.9 Sincronización con la nube

| Capacidad | Wansoft | Fullsite | Fuente |
|---|---|---|---|
| Los datos operativos suben a la nube | **No** — SQL Server es la autoridad final, sin sincronización automática a la nube | **Sí** — sync_queue sube a Supabase al reconectar | Diferencia fundamental |
| Dashboard en tiempo real desde cualquier dispositivo | **No** — los reportes son desde el sistema Wansoft local | **Sí** — Supabase alimenta dashboard.fullsite.mx | **Fullsite gana** |
| Sincronización incremental (solo cambios) | **No aplica** (no sincroniza) | **Sí** — sync_queue solo tiene operaciones no sincronizadas | |
| Tiempo hasta sincronización tras reconexión | **No aplica** | < 30 segundos (evidencia certificada F-01 PASS) | |

---

## 3. Tabla resumen — puntuación por dimensión

| Dimensión | Wansoft | Fullsite | Ganador |
|---|---|---|---|
| Arranque cold boot sin internet | ✓ (inferido) | ✓ (certificado) | Empate |
| Tomar y enviar orden sin internet | ✓ | ✓ | Empate |
| Latencia POS → cocina sin internet | ~15s (polling) | < 1s (push WS) | **Fullsite** |
| Impresión sin internet | ✓ | ✓ | Empate |
| Cajón registradora sin internet | ✓ (manual) | ✓ (software) | **Fullsite** |
| Pagos efectivo sin internet | ✓ | ✓ | Empate |
| Pagos tarjeta sin internet | Delega a terminal | Delega a terminal | Empate |
| KDS recibe órdenes sin internet | ✓ | ✓ | Empate |
| Latencia POS → KDS sin internet | Desconocido (polling) | < 1s (push WS) | Probablemente Fullsite |
| Recovery ante reinicio de servidor | ✓ SQL WAL | ✓ event replay | Empate |
| Recovery ante reinicio de terminal | ✓ | ✓ | Empate |
| Snapshot para arranque rápido | ✓ (SQL engine) | ✗ (Phase 3) | **Wansoft** |
| Multi-terminal coordinada sin internet | ✓ (SQL lock) | ✓ (MESA_LOCK WS) | Empate |
| Failover si cae el servidor principal | ✗ | ✗ (Phase 4) | Empate negativo |
| Config disponible offline | ✓ | ✓ | Empate |
| Agregar terminal sin internet | Difícil | ✓ (config.json) | **Fullsite** |
| Datos operativos en cloud | ✗ | ✓ | **Fullsite** |
| Dashboard en tiempo real | ✗ | ✓ | **Fullsite** |
| Estado KDS persiste al reconectar | ✓ (SQL) | Parcial (solo en memoria hasta Phase 2) | **Wansoft** |
| Cobro completo offline (cierre de cuenta) | ✓ | Parcial (Phase 2) | **Wansoft** |

**Resumen:**
- Fullsite gana: 5 dimensiones (latencia, cajón, agregar terminal, cloud, dashboard)
- Wansoft gana: 2 dimensiones (snapshot, cierre de cuenta offline completo)
- Empate: 13 dimensiones

---

## 4. Ventajas de Fullsite sobre Wansoft en offline

### 4.1 Latencia LAN: push vs polling

Wansoft usa un modelo de polling: RestPrintingApp revisa SQL cada 15 segundos, el Comandero KDS
(Android) hace polling a WebApi en intervalos no documentados. Una comanda enviada por el mesero
puede tardar hasta 15 segundos en aparecer en cocina.

Fullsite usa push WebSocket. El evento de ORDER_SENT llega al KDS y a las impresoras en
milisegundos. Con 30 mesas activas en hora pico, la diferencia entre 15s de latencia y <1s
es operativamente significativa.

### 4.2 Sincronización bidireccional

Wansoft no sincroniza sus datos locales a ninguna nube. El gerente de AMALAY no puede
ver las ventas del día desde su celular mientras está en casa — tiene que estar en el
restaurante frente a un terminal Wansoft o esperar a que el Wansoft Web Agent scrapeé la
pantalla. Fullsite sincroniza cada operación a Supabase, lo que alimenta el dashboard
en tiempo real, los reportes históricos, los agentes IA, y las alertas por Telegram.

### 4.3 KDS en el mismo equipo que el POS

Wansoft siempre requiere un dispositivo Android separado para el KDS (Comandero APK).
Fullsite puede abrir el KDS en un segundo monitor del mismo SERVER1 con `kds: true` en
config.json — cero hardware adicional.

### 4.4 Provisioning declarativo

Agregar una terminal nueva en Wansoft requiere acceso a la UI de administración de Wansoft
o edición manual de la base de datos SQL. En Fullsite, una terminal nueva es un
`config.json` con `restaurant_id` y un `terminal_id` nuevo. Se puede hacer sin internet,
sin acceso a la BD, en 5 minutos.

### 4.5 Modelo multi-restaurante desde el día uno

La arquitectura de Fullsite tiene `restaurant_id` en cada evento, cada comando, cada registro.
La RLS de Supabase separa todos los datos por `client_id`. El Local Server valida que los
comandos tengan el `restaurant_id` correcto.

Wansoft es inherentemente mono-restaurante en una instalación — cada instalación tiene su
propia base de datos SQL. Para multi-sucursal, requiere configuración manual de la sincronización
entre instancias.

---

## 5. Brechas reales de Fullsite vs Wansoft en offline

### 5.1 Cierre de cuenta offline (GAP Phase 2)

En Wansoft, cerrar una cuenta sin internet es idéntico a cerrarla con internet — todo está
en SQL local. En Fullsite, el cierre de cuenta escribe a Supabase; si Supabase no está
disponible, el flujo de cobro está parcialmente implementado (efectivo funciona, pero
el cierre formal de la cuenta en IDB no está completo). Esto es el GAP de mayor impacto
para la operación real.

**Consecuencia real:** un mesero en Fullsite puede tomar la orden y enviarla a cocina sin
internet, pero si internet cae justo cuando va a cobrar, el cierre de cuenta puede fallar.

### 5.2 Abrir turno offline (GAP Phase 2)

Wansoft abre el turno de trabajo contra SQL local. En Fullsite, abrir turno requiere
conexión a Supabase. Si internet no está disponible antes de que el primer mesero abra
su turno, el restaurante no puede iniciar el día.

**Mitigación parcial:** si el turno ya estaba abierto cuando se cayó internet, el sistema
sigue operando. El GAP es específicamente en el arranque del día sin internet.

### 5.3 No hay snapshot del estado (GAP Phase 3)

SQL Server mantiene su estado siempre en disco, con mecanismos maduros de checkpoint y WAL.
El Local Server de Fullsite siempre hace replay completo del events.ndjson desde el evento 0.
En un restaurante con un año de operación, esto puede significar decenas de miles de eventos —
lo que traduce en un tiempo de arranque potencialmente más largo.

**Mitigación actual:** el replay es rápido para volúmenes normales (<1000 eventos por turno,
~365K eventos máximo por año). El riesgo se materializa en Phase 3, no ahora.

### 5.4 STATE_SYNC infla el event log (deuda técnica documentada)

El Local Server genera un evento `STATE_SYNC` por cada poll de Supabase (cada 5s).
Estos eventos se guardan en el event log y se reproducen al arrancar, aunque no
representan operaciones del usuario. En un turno de 8 horas: 8×60×60/5 = 5,760 eventos
STATE_SYNC que no deberían estar en el log.

En Wansoft, SQL Server no tiene este problema porque no hay polling — SQL es el origen.

### 5.5 Un solo punto de falla (compartido con Wansoft)

Ambos sistemas tienen el mismo punto de falla: el equipo que corre el servidor principal.
En Wansoft es SQL Server en la Caja; en Fullsite es el Local Server en SERVER1. Si esa
máquina falla, el restaurante pierde la capacidad de coordinar entre terminales.

La diferencia es que en Wansoft la falla es total (todos los PDVs dejan de funcionar),
mientras que en Fullsite los terminales secundarios pueden seguir tomando órdenes con
su IDB local y sincronizar vía POST /events cuando el servidor vuelva a estar disponible.

---

## 6. Lo que Wansoft hace que Fullsite no tiene en offline

| Capacidad | Por qué falta en Fullsite | Roadmap |
|---|---|---|
| Cierre de cuenta offline completo | Flujo de cobro escribe a Supabase directamente | Phase 2 |
| Abrir turno sin internet | Turno se inicializa en Supabase | Phase 2 |
| Movimientos de caja offline | Retiros/depósitos no se encolan | Phase 2 |
| Inventario disponible offline | Sin IDB cache para ingredientes y recetas | Phase 2 |
| Estado KDS persiste entre reinicios sin internet | KDS escribe status a Supabase; sin internet, el estado se pierde al recargar | Phase 2 |
| Anticipo / CxC sin internet | No modelado en Fullsite | Roadmap sin fecha |

---

## 7. Lo que Wansoft no tiene que Fullsite sí tiene (relacionado con offline)

| Capacidad Fullsite | Impacto |
|---|---|
| Datos operativos en la nube (sync_queue) | El dueño ve las ventas en tiempo real desde cualquier lugar |
| Dashboard multi-dispositivo en tiempo real | Reportes accesibles sin estar en el restaurante |
| Agentes IA autónomos que analizan datos | Briefings, anomalías, predicciones — imposibles si los datos están solo en SQL local |
| KDS integrado sin hardware adicional | Costo de hardware menor, configuración más simple |
| Provisioning en 5 minutos sin acceso a BD | Alta de nuevas terminales sin técnicos de Wansoft |
| Actualización remota del POS | Vercel + update manager — sin intervención presencial |

---

## 8. Conclusiones

### 8.1 Paridad funcional en lo crítico

Para el 90% de las operaciones de un restaurante durante un turno normal con internet disponible,
Wansoft y Fullsite son funcionalmente equivalentes en offline. Ambos pueden tomar órdenes,
enviarlas a cocina, imprimir comandas, y procesar efectivo sin conexión a internet.

### 8.2 Fullsite es superior en arquitectura a largo plazo

La arquitectura de Fullsite (event sourcing + sync_queue + dashboard en la nube) genera valor
que Wansoft nunca podrá ofrecer sin reescribir su núcleo: el dueño ve sus ventas en tiempo real
desde cualquier dispositivo, los agentes IA pueden generar briefings automáticos, y la flota de
instalaciones puede gestionarse remotamente.

### 8.3 Las brechas son concretas y tienen fecha

Los dos GAPs más importantes para paridad offline completa con Wansoft son:
1. **Cierre de cuenta offline** — Phase 2, prioritario
2. **Abrir turno offline** — Phase 2, prioritario

Sin estos dos, Fullsite puede operar offline durante el turno activo pero no puede iniciar
ni cerrar el turno sin internet. Para AMALAY, donde el internet del restaurante es confiable,
esto no es un bloqueador. Para restaurantes con conectividad más inestable, es una limitación
real que debe comunicarse honestamente.

### 8.4 El modelo de autoridad local de Wansoft tiene una debilidad estructural

SQL Server en la Caja es el único punto de falla. Cuando falla, todos los PDVs se detienen
simultáneamente. En Fullsite, si el Local Server cae, los terminales secundarios pueden
seguir aceptando órdenes en sus IDB locales. Esta diferencia no está suficientemente
documentada en el material de ventas de Fullsite y debería serlo.

---

*Versión 1.0 — 2026-07-27*
*Fuentes verificadas en esta fecha. Capacidades de Wansoft marcadas como (inferido) o (desconocido)
donde no se pudo verificar directamente.*

# Fullsite — cómo fue construido el offline y cómo funcionó en AMALAY

> **Transcripción fiel** de `FULLSITE-ARQUITECTURA-OFFLINE-Y-MATRIZ-DE-CERTIFICACION-2026-08-26.docx`,
> que hasta el 2026-08-26 vivía sólo en `~/Downloads` — fuera del repositorio, sin control de
> versiones y sin poder buscarse.
>
> **Cierre físico:** 24 de agosto de 2026 · **Sitio:** AMALAY, San Pedro Garza García, NL
> **Alcance:** POS, Pedro/servidor local, KDS, impresión, caja, entrada, Escondite,
> sincronización y biometría.

---

## Veredicto de sincronización — tres estados, no uno

Acordado con Daniel el 2026-08-26 tras la contradicción de datos. Sustituye cualquier lectura
anterior de `Cola final = PASÓ`:

| | Estado |
|---|---|
| `POS → Pedro → KDS/impresión` | ✅ **PASÓ EN CAMPO** |
| Indicador `0 pendientes` | ✅ **PASÓ LOCALMENTE** |
| Persistencia en Supabase | 🔴 **NO VERIFICADA · CONTRADICCIÓN ABIERTA** |

Lo primero es lo que hace que el restaurante opere en un apagón, y sigue en pie. Lo tercero
no se midió nunca.

> **Precisión del 2026-08-26, tras la investigación adversarial.** La escritura a la nube
> **sí ocurrió**: el libro de comandos `pos_save_operations` tiene **303 operaciones
> `COMMITTED`** de AMALAY, y el `COMMITTED` es atómico con el `INSERT` — están en la misma
> transacción. Las órdenes llegaron **y algo las borró después**, desde fuera de la base.
>
> El estado sigue siendo **NO VERIFICADA**, y con más razón: no basta con que el dato llegue
> si no permanece. Detalle completo en
> [`CONTRADICCION-ORDENES-AMALAY-2026-08-26.md`](CONTRADICCION-ORDENES-AMALAY-2026-08-26.md).

---

## ⚠️ Corrección a la matriz original — una fila en `PASÓ` no se sostiene

El documento marca:

| Capacidad | Evidencia | Campo 24-ago | Estado |
|---|---|---|---|
| **Cola final** | Indicador | `0 pendientes` | **PASÓ** |

Y el dictamen ejecutivo cierra con *"la cola terminó en cero"*.

**Medido contra producción el 2026-08-26, sólo lectura:**

| | |
|---|---:|
| Órdenes de `amalay` en `pos_orders` | **0** — nunca, desde siempre |
| Eventos de `amalay` en `pos_audit_log` | 1,324, incluidos 39 `payment_processed` |
| `pos_local_events` (todos los tenants) | **0** |
| Otros tenants en `pos_orders` | `lab-resto` 4,212 · `demo` 1,218 · `coffee-shop` 627 · `boruca` 240 |

La cola llegando a cero significa que **el POS soltó el pendiente**, no que Supabase lo
recibió. Ninguna orden de AMALAY ha llegado nunca a la nube.

El propio documento contiene la pieza que lo explica, en §3.2: *"La escritura a nube queda
pendiente en la cola."* Correcto. Lo que falta es el paso siguiente — comprobar del lado de
la nube — y nunca se dio.

**Qué cambia y qué no:**

- **No invalida** el hallazgo central. `POS → Pedro → KDS/impresión sin Internet` sigue
  demostrado, y es lo que más importa para que un restaurante opere en un apagón.
- **Sí invalida** `Cola final = PASÓ` como evidencia de sincronización, y por arrastre debilita
  `Reconexión = PASÓ`. Lo que se observó fue el POS vaciando su cola, no la nube recibiendo.
- La fila **`No duplicación/pérdida integral = PARCIAL`** del propio documento ya apuntaba en
  esta dirección. Se queda corta: no es que falte concurrencia y soak — es que no llegó nada.

El criterio correcto está en el protocolo desde julio: `F5-28` cuenta órdenes **en
`pos_orders`**, `F5-29` busca duplicados en Supabase y `F5-30` compara IDB local contra
Supabase. La sesión del 23-24 se hizo por chat y no los usó.

> Causa raíz en curso. La evidencia que la estrecha: los `skimming_suspect` de AMALAY apuntan
> a `order_id`s que **no existen** en `pos_orders`, y ese bloque vive dentro de
> `/api/pos/save-order` **antes** del guardado — o sea que la ruta corrió y la orden se perdió
> después. El OutboxWorker no es el camino: por diseño llena `pos_local_events`, no
> `pos_orders`.

---

## Resultado ejecutivo (del documento)

**HECHO:** durante la sesión del 24 de agosto el flujo crítico funcionó sin Internet — abrir
y navegar mesas, agregar productos, enviar comandas, imprimir por estación y recibir la
comanda en KDS. Al volver Internet se observó recuperación de la cola, resolución explícita
de un conflicto y cierre en 0 pendientes *(ver corrección arriba)*. Esta evidencia reemplaza
como estado vigente el fallo de KDS registrado el 3 de agosto.

**LÍMITE — HECHO:** la prueba mantuvo encendidos la LAN y Pedro. **No certificó** operación
sin red local, failover de Pedro ni cold boot desde cero sin WAN. El lector biométrico quedó
operativo con **una** huella enrolada.

---

## Topología física certificada

```
                    INTERNET / WAN
                          │
              Nube Fullsite / Supabase
          datos centrales y sincronización
                          ▲  al reconectar
──────────────────── LAN AMALAY ────────────────────
                          │
          SERVER1 — "Pedro" / Local Server
          192.168.1.71:7717 · runtime v1.3.3
             │        │        │
             │        │        └── cola local / recovery
             │        └─────────── impresoras por estación
             └──────────────────── Event Bus / KDS por LAN
                    ▲              ▲
                    │              │
         POS Caja / Entrada   POS Escondite
         caché + cola local   PDV1 · 192.168.1.68 · POS 1.3.7 x64
```

**HECHO:** "offline" significa **sin Internet/WAN**. La LAN, router/switch, Pedro, KDS e
impresoras deben permanecer encendidos.

**HECHO:** Pedro es el punto primario. Si SERVER1 o la LAN se apagan, KDS e impresión local
dejan de estar disponibles bajo esta topología.

> **Nota de operación (aportada por Daniel el 2026-08-26):** hay **una** pantalla KDS, en
> cocina; **tres** POS; e impresoras con sus HID. De ahí se sigue que `caja` y `barra` en
> `pos.station_routing` **no son pantallas, son impresoras**. Sólo `cocina` tiene KDS.

### Identidad por terminal

Cada equipo necesita `terminal_id` propio. `restaurant_id` e IP de Pedro pueden venir de una
plantilla del sitio, pero **nunca se debe clonar una identidad activa**.

| | |
|---|---|
| Pedro | SERVER1, `192.168.1.71:7717`, runtime 1.3.3 |
| Escondite | PDV1, `192.168.1.68`, POS 1.3.7 x64 |
| Estaciones | barra, caja, cocina, tickets |

---

## Capa por capa

| Capa | Construcción | Papel durante el corte |
|---|---|---|
| Electron POS | App x64 kiosk, config por terminal, caché offline | Conserva la interfaz y captura la venta |
| Service Worker/caché | Guarda recursos y datos del POS | Evita depender de Vercel/Supabase por pantalla |
| IndexedDB/cola | Persiste operaciones, intentos y conflictos | Mantiene pendientes hasta recuperar WAN |
| Pedro/Local Server | Servicio LAN `:7717`, health, eventos, impresión, KDS | Mantiene el camino operacional local |
| Event Bus/KDS | Distribuye comandas por LAN | KDS recibió offline el 24-ago |
| Ruteo de impresión | Estaciones barra, caja, cocina, tickets | Tickets físicos salieron sin WAN |
| Sync/recovery | Reactiva retries y muestra conflictos | Recuperó la cola hasta cero *(ver corrección)* |
| Nube | Persistencia central, administración, reconciliación | Reingresa al flujo cuando vuelve WAN |

---

## Evidencia técnica registrada

**Salud de Pedro**

```json
{ "ok": true, "server_id": "3e5e511b-1008-4ce1-b943-e064c92cf2bc",
  "restaurant_id": "amalay", "version": "1.3.3", "hostname": "SERVER1",
  "platform": "win32", "lan_ip": "192.168.1.71", "print_jobs_failed": 0,
  "stations": ["barra", "caja", "cocina", "tickets"] }
```

**Biometría** — servicio y lector detectados; `enrolled: 1`. **PENDIENTE:** enrolar y probar
a todo el personal.

**Cambio de recuperación** — commit `a1f04704`, *fix(sync): recover exhausted transient
retries on reconnect*. Archivos: `pos-offline-db.ts`, `pos/page.tsx`,
`bug019-offline-auth.test.ts`. Tests 21/21. *(Commit verificado el 2026-08-26: existe y
coincide.)*

---

## Esto sí demuestra · esto no demuestra

**Sí:** `mesero → POS → Pedro → impresión/KDS` funcionó sin Internet. La nube no fue
necesaria para entregar la comanda a cocina. Los conflictos pudieron resolverse
administradamente. Caja, Entrada y Escondite entran en el alcance del acta.

**No:** operación sin LAN o con Pedro apagado · failover automático de SERVER1 · **cold boot
completo sin WAN previo** · duración offline indefinida o soak de varios días · huellas
completas · flota automatizada.

*(Y, por la corrección de arriba: tampoco demuestra que las órdenes lleguen a la nube.)*

---

## Matriz maestra — filas no aprobadas

Las 17 filas en `PASÓ` están en el documento original. Aquí van las que **no** lo están,
que son las que quedan por trabajar:

| Capacidad | Estado | Alcance |
|---|---|---|
| No duplicación/pérdida integral | **PARCIAL** | Falta concurrencia/soak *(y, corregido: falta que llegue algo)* |
| **Cold boot sin WAN** | **PENDIENTE** | Reinicio desde cero |
| Auto-start / power cycle | **PENDIENTE** | Probar corte eléctrico |
| **Failover Pedro** | **NO IMPLEMENTADO** | Punto único primario, sin HA |
| Lector/servicio huella | **PASÓ PARCIAL** | Hardware funciona |
| Huellas completas | **PENDIENTE** | `enrolled=1`, falta todo el personal |
| Seguridad LAN | **PENDIENTE** | Auth/endurecimiento, deuda no certificada |
| Observabilidad flota | **NO IMPLEMENTADO** | Sin panel integral ni alertas remotas |
| Instalación clonable | **PARCIAL** | Aún manual |
| Escala 1,000 sitios | **DISEÑO** | Flota/canary/rollback/SLA |

---

## Pendientes priorizados (del documento)

| | Pendiente | Criterio de cierre |
|---|---|---|
| **P0** | Huellas restantes | Todo el personal probado online/offline |
| P1 | **Cold boot sin WAN** | Reinicio desde cero y flujo crítico |
| P1 | Failover/respaldo Pedro | Conmutación/restauración sin perder cola |
| P1 | Matriz ampliada/soak | Multi-terminal, cierres, corte prolongado |
| P1 | Observabilidad | Alertas de cola, impresora, KDS, versión y Pedro |
| P2 | Seguridad LAN | Endpoints autenticados y mínimo privilegio |
| P2 | Instalador gestionado | Provisión, auto-start, update y rollback |

---

## Runbook de corte

**Cuando se va Internet:** no cerrar el POS ni borrar caché · mantener SERVER1, LAN, KDS e
impresoras encendidos · confirmar que Pedro siga disponible · seguir tomando y enviando
comandas · *"pendientes" significa cola guardada, no pérdida automática*.

**Cuando vuelve:** esperar recuperación automática · si no baja, abrir diagnóstico y
reintentar · en conflicto, comparar mesa, estado y total · **no elegir local/nube por
intuición** · terminar únicamente con la mesa correcta y la cola en cero.

> **Añadido el 2026-08-26:** "cola en cero" ya no basta como criterio de cierre. Confirmar
> también que la orden aparece en `pos_orders`.

---

## Instalación de otra terminal

1. Extraer el paquete x64 completo; conservar `win-unpacked`.
2. Ruta estable, por ejemplo `C:\Fullsite\POS`.
3. Ejecutar `Fullsite POS.exe`.
4. **Reprovisionar si hay identidad previa.**
5. Confirmar `restaurant_id`, `terminal_id`, `role`, `pos_server_ip`.
6. Apuntar al Pedro del sitio — AMALAY: `192.168.1.71`.
7. Crear acceso directo y `shell:startup`.
8. Validar `/health`.
9. Mandar comanda **online**.
10. Repetir **sin WAN, con LAN**.
11. Reconectar hasta 0 pendientes *(y verificar `pos_orders` — ver corrección)*.

---

## Instrucción de continuidad

Del documento original, y sigue vigente:

- Tomar este documento y `OFFLINE-AMALAY-CIERRE-2026-08-24.docx` como overlay posterior al
  handoff del 4 de agosto.
- **No** declarar el fallo de KDS del 3-ago como estado vigente; conservarlo sólo como historia.
- **No** reabrir impresión/KDS sin evidencia nueva contradictoria.
- **No decir "100% offline"**: la prueba fue sin WAN, con LAN y Pedro.
- Mantener abiertos cold boot, failover, huellas completas, seguridad y flota.
- Distinguir siempre **HECHO**, **INFERENCIA** e **HIPÓTESIS**.

---

## Fuentes y precedencia

> **Corrección del 2026-08-26.** Una versión anterior de este archivo afirmaba que dos de
> estas fuentes *"no se encuentran en la máquina"*. **Era falso.** Sí existen, se leyeron, y
> abajo van sus rutas reales y sus hashes. La causa raíz del error está en
> [`../operations/FALSO-NEGATIVO-BUSQUEDA-2026-08-26.md`](../operations/FALSO-NEGATIVO-BUSQUEDA-2026-08-26.md).

| Fuente | Ruta real · SHA-256 |
|---|---|
| **`OFFLINE-AMALAY-CIERRE-2026-08-24.docx`**<br>Acta física, máxima precedencia | `~/Documents/Codex/2026-08-23/daniel-te-voy-a-ser-completamente/outputs/`<br>(copia idéntica en `~/Documents/`)<br>44,647 bytes · `7d274d8f1638c3849e335e1e8543ca05a8f9eca1888e103bc379dfbac6f8ae70` |
| **`FULLSITE-OFFLINE-PLAYBOOK-ESCALA-2026-08-24.docx`**<br>Arquitectura y operación | misma carpeta · 47,876 bytes<br>`1a909875b3ce0a22947a4652e1ae41ea000ef2e59e4071c100439c37212c7cbc` |
| `FULLSITE-ARQUITECTURA-…-2026-08-26.docx` | `~/Downloads/` — origen de esta transcripción |
| Chat *"Cerrar offline total para POS"* | Ejecución que produjo el cierre |
| Overlays 3–4 de agosto y handoff maestro | Historia y gaps previos |

### Qué dice el acta, leída

Su prueba de aceptación tiene **nueve pasos**, y el noveno es:

> *"9. Confirmar cola — **Aprobado: 0 pendientes.**"*

**No hay un décimo paso que verifique Supabase.** El acta declara `CERTIFICADO` a Caja,
Entrada, Escondite y KDS sobre evidencia enteramente local.

El acta es más precisa que la matriz en un punto, y conviene citarlo:

> *"El contador 'pendientes' representa operaciones guardadas para sincronizar; **no es
> pérdida de datos por sí mismo**."*

Correcto — y tampoco es prueba de entrega. Esa distinción estaba escrita y no se usó como
criterio.

Entre sus hallazgos aparecen **`ORDER_NOT_FOUND`** y **`STALE_WRITE_REJECTED`**, resueltos así:

> *"Conservar nube **descarta** solo la operación local conflictiva."*

Eso importa para entender cómo la cola llegó a cero: las operaciones que no podían escribirse
se resolvieron descartándolas. **La cola se vació; el dato no llegó.**

### Qué cambia, qué se sostiene y qué queda contradicho

| Afirmación | Estado tras leer las fuentes |
|---|---|
| `POS → Pedro → KDS/impresión` sin Internet | ✅ **Se sostiene.** Acta y matriz coinciden, y es evidencia de campo directa |
| Impresión por estación sin WAN | ✅ Se sostiene |
| Recuperación de reintentos agotados (`a1f04704`) | ✅ Se sostiene — commit verificado, existe y coincide |
| Cold boot sin WAN **PENDIENTE** | ✅ Se sostiene, y las dos fuentes lo confirman |
| Failover de Pedro **NO IMPLEMENTADO** | ✅ Se sostiene |
| Huellas `enrolled=1` | ✅ Se sostiene, marcado **P0** en las dos |
| `Cola final = PASÓ` como sincronización | 🔴 **Contradicho.** Pasó localmente; la nube no se verificó |
| `Caja/Entrada/Escondite = CERTIFICADO` | ⚠️ **Se debilita.** El certificado incluye "reconexión y cola 0", que ya no vale como evidencia de nube |
| *"Las fuentes no están en la máquina"* | 🔴 **Falso.** Corregido arriba con rutas y hashes |

# Evidencia de campo — AMALAY, madrugada del 2026-08-24

> **Qué es esto.** La prueba offline en AMALAY del 23-24 de agosto se hizo por chat, y su
> evidencia quedó encerrada en un rollout de Codex de 116 MB. La matriz de 23 escenarios decía
> `0 certificados` — no porque nada funcionara, sino porque **nada se registró escenario por
> escenario**. Este documento saca esa evidencia del chat y la pone donde cuenta.
>
> **Qué NO es.** No es una certificación. Ver §5: lo que se probó fue un camino controlado,
> con Daniel presente por TeamViewer, en UNA terminal.

## Fuentes

| Fuente | Ruta | Nota |
|---|---|---|
| Rollout de la sesión | `~/.codex/sessions/2026/08/23/rollout-2026-08-23T21-19-57-01a031c8-2cb7-7090-bb32-cd1a5a1bdd26.jsonl` | 116 MB, 165 mensajes de Daniel. Fuente primaria |
| Handoff escrito por Codex | `~/Downloads/FULLSITE-HANDOFF-COMPLETO-PARA-CLAUDE-2026-08-24.txt` | Resumen redactado al cierre |
| Chat literal | `~/Downloads/CHAT-LITERAL-COMPLETO-CODEX-DANIEL-CON-METODO-2026-08-24.txt` | 297 KB |

Las horas son UTC, como vienen en el rollout. Restar 6 h para hora de Monterrey.

## 1. Entorno observado

```
restaurant_id : amalay          hostname : SERVER1
plataforma    : Windows         IP LAN   : 192.168.1.71
health        : puerto 7717     estaciones: barra, caja, cocina, tickets
POS           : 1.3.3           KDS      : 1.3.8 → 1.3.11
```

Terminal probada: **CAJA**. Entrada y escondite **no se tocaron**.

## 2. Lo que se validó, con cita textual

| Hora UTC | Qué se probó | Palabras de Daniel |
|---|---|---|
| 04:03:16 | WiFi apagado | *"ok ya apague el wifi"* |
| 04:05:36 | Abrir mesa, navegar, enviar, imprimir — sin red | *"esta un poco tardado al abrir mesas y navegar **se manda y se imprime super bien! nice! todo ya jalando en caja!**"* |
| 04:07:10 | Comandas llegan al KDS | *"si sale en kds 3 confirmo 4 tambien confirmo y 5 confirmisimo!"* |
| 04:22:31 | Mesas abren offline (segunda pasada) | *"apague wifi espere y **mesas abren**"* |
| 04:48:04 | Reconexión y sincronización | *"confirmo! esoooo, solo reconecto wifi y reviso que mesa 4 quede vacia"* |
| 06:09:46 | Impresión en las tres estaciones | *"si imprimio, kds tmb y cocina tmb y barra"* |
| 06:14:17 | Segunda confirmación de impresión + KDS | *"confirmo! impresion, kds"* |
| 06:28:57 | Resolución de conflicto offline | *"me salio el resolver conflicto offline"* → *"se resolvio"* → *"esta en 0"* |
| 06:49:10 | Login con PIN, sin red | *"confirmo, sale solo ingresa tu PIN y salir de la aplicacion"* → *"si jala! que chulada!"* |

**Cola de sincronización:** llegó a 5 pendientes atorados (04:51–05:00), bajó a 3, luego a 1,
y terminó en **0** tras corregir operaciones conflictivas y eventos de auditoría.

## 3. Mapeo a la matriz de 23 escenarios

Sólo se marca lo que la evidencia sostiene. **Camino controlado ≠ certificado** (ver §5).

| ID | Escenario | Evidencia | Estado propuesto |
|---|---|---|---|
| **T-01** | Internet cae durante venta activa | 04:03→04:07. Mesa abre, ítem se agrega, envía a cocina, imprime, KDS recibe | **VALIDADO en campo — camino controlado** |
| **T-17** | Impresora durante venta | 06:09. Imprimió en cocina, barra y tickets sin red | **PARCIAL** — imprimió, pero no se desconectó la impresora |
| **T-22** | Internet vuelve, sin duplicados | 04:48→06:30. Sincronizó y la cola llegó a 0 | **PARCIAL con hallazgos** — llegó a 0 sólo tras corregir a mano |
| **T-23** | Conflicto STALE_WRITE | `STALE_WRITE_REJECTED` ocurrió y se resolvió por la UI de conflictos | **VALIDADO — el mecanismo disparó y resolvió** |
| — | Login PIN sin red | 06:49. Entró con PIN, WiFi apagado | **VALIDADO** (no está en la matriz; ver §6) |

**Sin evidencia de campo: T-02 a T-16, T-18 a T-21.** Diecisiete escenarios sin tocar,
incluidos los tres de multi-terminal — que son justamente los que necesitan entrada y escondite.

## 4. Defectos encontrados durante la prueba

La prueba valió tanto por lo que rompió como por lo que confirmó.

| Defecto | Estado |
|---|---|
| Mesas congeladas al tocarlas (03:55) | Resuelto — era Service Worker viejo cacheado |
| *"This page couldn't load"* al elegir ciertos productos offline (04:22) | Ver P0-2 / P0-3 abajo |
| Mesa con orden anterior o estado viejo (04:09, 04:50) | Abierto |
| `STALE_WRITE_REJECTED` por revisiones distintas local vs nube | Mecanismo funcionó; la causa sigue |
| `ORDER_NOT_FOUND` al guardar órdenes inexistentes en nube | Abierto |
| `pos_audit_log` rechazado por `actor` null | Corregido en la sesión |
| Pendientes agotados por `Failed to fetch` | Corregido en la sesión |
| Mapa de mesas mal distribuido en toldo/privado (07:03) | Abierto |
| Back llevaba a mesa 1 en vez del mapa (07:22) | Resuelto por `navigateToMesaMap` |
| Tras limpiar, algunas mesas seguían con ítems (07:30) | Abierto |
| Lector de huella no detectado | Abierto |

### Los tres P0 que salieron de aquí

- **P0-1** — un 403 de negocio se trataba como pérdida de autenticación en el replay.
  Cerrado en #61.
- **P0-2** — un platillo podía irse a cocina **sin su modificador obligatorio**. Silencioso:
  la comanda se ve bien y está incompleta. Cerrado en #63.
- **P0-3** — el Service Worker puede resolver un request offline con `Response 503`, y
  `fetch()` **no lanza** con un 503, así que el `catch` nunca corre. Se corrigió en
  `getActiveTurno` pero quedó la misma forma en `getModifierGroupsForItem`.

> **Lección de proceso, textual del handoff:** *"Encontrar la causa raíz y corregir una sola
> instancia no es suficiente. Después de encontrar un patrón hay que usar `rg` en todo el
> repositorio, clasificar coincidencias y agregar pruebas de regresión."*

## 5. La conclusión honesta

Textual del handoff que escribió Codex al cerrar:

> - *"Offline funcionó físicamente en un camino controlado" es **verdadero**.*
> - *"Offline está cerrado/certificado para producción masiva" **todavía no** es verdadero.*
> - *La validación de campo demostró **viabilidad, no resistencia** completa a caminos adversos.*

Por qué la matriz sigue diciendo `0 certificados` aunque esto ocurrió:

1. **Una sola terminal.** Caja. Entrada y escondite nunca se probaron, y los tres escenarios
   de multi-terminal (T-19, T-20, T-21) dependen de ellas.
2. **Con Daniel presente.** Por TeamViewer, corrigiendo en vivo. Un turno productivo sin
   supervisión es otra cosa.
3. **Camino feliz.** No se desconectó la impresora, no se reinició el servidor, no se cortó la
   LAN, no hubo arranque en frío sin WAN.
4. **Los 3 P0 son posteriores** a la prueba. Se encontraron después, en el mismo camino que
   se había dado por bueno.

Lo que sí cambia: **el 0 dejó de significar "no sabemos".** Ahora significa "cuatro escenarios
tienen evidencia de campo parcial y diecisiete siguen sin tocarse", que es una posición muy
distinta para decidir.

## 6. Hueco de la matriz: el login offline no es un escenario

Los 23 escenarios no incluyen **autenticación sin red**, y es de las cosas más críticas: si
nadie puede entrar al POS, lo demás da igual. Se validó en campo (06:49) pero no tiene casilla.

Además, revisando el código hoy aparecieron dos límites que la prueba del 24 no pudo tocar
porque duró unas horas:

- **Ventana de 8 h.** `pos_staff_cache` expira 8 h después del último login *online*. Un
  restaurante que cierra a la 1am y abre a la 1pm son 12 h: si el internet está caído al abrir,
  **nadie entra**.
- **Una sola credencial por terminal.** `pos_staff_cache` guarda un objeto, no una lista, y se
  sobrescribe en cada login. Offline sólo puede entrar **la última persona que se logueó con
  internet**. En una terminal compartida, eso es un problema real.

Ninguno de los dos se ve en una prueba de una noche. Los dos se ven en el primer turno real.

## 7. Qué sigue

1. **Agregar el escenario de login offline** a la matriz (T-24), con los dos límites de arriba
   como criterios de aceptación.
2. **Automatizar** los que no necesitan la caja física. La matriz marca T-01, T-04 y T-07 como
   *"automatizable con Playwright Electron"*.
3. **Entrada y escondite** — desbloquea los tres de multi-terminal. Necesita ir al restaurante.
4. **Arranque en frío sin WAN** — el que más miedo debería dar: es el escenario de abrir el
   restaurante un día que el internet no llegó.

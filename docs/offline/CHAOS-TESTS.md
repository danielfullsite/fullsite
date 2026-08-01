# OFFLINE-CHAOS-TESTS — Plan de Chaos Testing

> Versión: 2026-07-27 | OFFLINE-100
> Objetivo: demostrar que el restaurante sigue operando bajo condiciones adversas deliberadas.
> NOTA: Este documento es de DISEÑO. No escribir código todavía.

---

## Principio

El chaos testing no prueba si el sistema funciona en condiciones normales. Prueba si el restaurante puede:
1. **Continuar cobrando** — la operación primaria nunca se interrumpe
2. **No perder datos** — ninguna orden pagada se pierde
3. **Recuperarse solo** — sin intervención manual del operador

Un sistema que "degrada elegantemente" pasa chaos testing. Un sistema que "se rompe silenciosamente" falla.

---

## Categoría 1: Inyección de Fallos de Red

### C-01: Kill switch de internet cada 60 segundos

**Descripción**: Un script externo corta internet cada 60s durante 30s, lo restaura 30s, y repite por 30 minutos.

**Objetivo**: Verificar que el sistema no acumula estado inconsistente en ciclos rápidos de online/offline.

**Métricas de éxito**:
- `syncAll()` no entra en bucle infinito
- `syncAllRunning` se resetea correctamente en cada ciclo
- El conteo de unsynced_count en heartbeat converge a 0 cuando hay internet

**Cómo romperlo**: Deshabilitar Wi-Fi desde la configuración del OS, repetir con script bash o PowerShell.

**Señal de fallo**: sync_queue crece indefinidamente, o items marcados como synced sin haber llegado a Supabase.

---

### C-02: Latencia de red extrema (packet loss 50%)

**Descripción**: Introducir 50% packet loss y 2000ms de latencia en la interfaz de red.

**Objetivo**: Verificar que los timeouts son correctos y no hay deadlocks de recursos.

**Métricas de éxito**:
- HTTP requests al Local Server responden o fallan limpiamente (no cuelgan)
- Supabase poll no acumula promesas pendientes
- WS keepalive termina conexiones lentas dentro de 25s (15s ping + 10s timeout)

**Cómo romperlo en Windows**: `netsh interface ip set address "Ethernet" static 192.168.x.x 255.255.255.0` con `netem` (requiere Linux) o herramienta como Clumsy.

**Señal de fallo**: proceso de Node.js consume 100% CPU, o memoria crece sin límite.

---

### C-03: Servidor Local en IP que cambia cada 2 minutos

**Descripción**: El servidor se reinicia con una nueva IP de red simulada cada 2 minutos.

**Objetivo**: Verificar que los clientes se redescubren sin intervención.

**Métricas de éxito**:
- KDS reconecta en <60s sin acción del operador
- Tablets secundarias reconectan sin configuración manual
- mDNS anuncia la nueva IP correctamente

**Señal de fallo**: operador necesita ingresar IP manualmente para retomar operación.

---

## Categoría 2: Inyección de Fallos de Proceso

### C-04: Kill del proceso Electron cada 5 minutos durante 1 hora

**Descripción**: Un script mata `electron.exe` cada 5 minutos. El auto-start lo vuelve a abrir.

**Objetivo**: Verificar que el evento store es durable y el estado se reconstruye correctamente.

**Métricas de éxito**:
- events.ndjson no se corrompe con ningún kill
- El estado de mesas al reiniciar es idéntico al estado antes del kill
- No se pierden órdenes abiertas
- Los print jobs pendientes se reintentan al reiniciar

**Cómo romperlo**: `taskkill /f /im electron.exe` en bucle PowerShell.

**Señal de fallo**: mesa que estaba "ocupada" aparece como "libre" después del reinicio, o events.ndjson tiene líneas corruptas.

---

### C-05: OOM killer (memoria del proceso al límite)

**Descripción**: Forzar alto consumo de memoria en el proceso Electron hasta que Windows lo mata.

**Objetivo**: Verificar que los writes pendientes a events.ndjson se completan antes de la muerte del proceso.

**Métricas de éxito**:
- events.ndjson no tiene líneas a medias (el write es `appendFileSync` — atómico a nivel de syscall)
- Al reiniciar, el replay desde el archivo es completo

**NOTA**: `fs.appendFileSync` es síncrono, lo que da cierta protección, pero no garantía contra SIGKILL del OS.

---

### C-06: Crash del renderer (BSOD / render-process-gone)

**Descripción**: Provocar un crash del proceso renderer de Electron (ej. via `process.crash()` desde la consola).

**Objetivo**: Verificar el recovery automático.

**Métricas de éxito**:
- `render-process-gone` handler relanza `loadURL(POS_URL)` en 2s
- El Local Server no se ve afectado (corre en main process)
- Los datos en IDB (renderer) sobreviven el crash

---

## Categoría 3: Inyección de Fallos de Almacenamiento

### C-07: Truncar events.ndjson a la mitad durante la ejecución

**Descripción**: Abrir events.ndjson y borrar la segunda mitad del archivo mientras el servidor está corriendo.

**Objetivo**: Verificar que el servidor detecta el archivo modificado al reiniciar y no replica estado inconsistente.

**Métricas de éxito**:
- El servidor carga sin crash (líneas corruptas se saltan)
- Warning en logs: `[event-store] N corrupt line(s) skipped`
- Estado resultante es el estado derivado de los eventos válidos restantes

**Señal de fallo**: servidor no arranca, o arranca con estado incorrecto sin ningún warning.

---

### C-08: IDB corrupto (borrar IndexedDB manualmente)

**Descripción**: Desde DevTools de Electron, borrar la base de datos IndexedDB (`fullsite_pos`) mientras el POS está en uso.

**Objetivo**: Verificar que el POS no se rompe y hace reload limpio del menú/datos desde el servidor.

**Métricas de éxito**:
- POS no muestra error irrecuperable
- Al recargar: menú se descarga de nuevo, se reconstruye IDB
- Órdenes del evento store del Local Server se recargan via SNAPSHOT WS

**Señal de fallo**: POS muestra pantalla en blanco o error no manejado sin recovery.

---

### C-09: Disco lleno (0 bytes disponibles)

**Descripción**: Llenar el disco de Windows hasta que no haya espacio libre.

**Objetivo**: Verificar que el servidor no falla silenciosamente al escribir events.ndjson.

**Métricas de éxito**:
- `appendFileSync` lanza excepción que se captura
- El servidor responde con error 500 al intento de escritura
- El servidor NO acepta el evento (mejor fallar abiertamente que aceptar y no persistir)

**Señal de fallo**: El servidor responde 200 OK pero no escribió nada al disco.

---

## Categoría 4: Inyección de Fallos de Concurrencia

### C-10: 10 terminales enviando MESA_LOCK a la misma mesa simultáneamente

**Descripción**: 10 clientes WS simulados envían `MESA_LOCK` para mesa 5 exactamente al mismo tiempo.

**Objetivo**: Verificar que solo 1 lock es otorgado.

**Métricas de éxito**:
- Exactamente 1 ACK y 9 REJECT en <200ms
- Estado del servidor: solo 1 lock para mesa 5
- events.ndjson tiene solo 1 evento MESA_LOCK para mesa 5

**Cómo testear**: Script Node.js que crea 10 WS connections y envía el lock simultáneamente.

---

### C-11: Flood de comandos (100 ORDER_SENT por segundo durante 30s)

**Descripción**: Un script envía 100 ORDER_SENT/segundo al Local Server via HTTP POST /events.

**Objetivo**: Verificar que el servidor no se satura, que el NDJSON no se corrompe con escrituras concurrentes.

**Métricas de éxito**:
- Servidor responde a todos los requests (200 o 429 si hay rate limiting)
- events.ndjson al final es parseable línea por línea sin errores
- El proceso no muere por OOM o ENOMEM

**NOTA**: `appendFileSync` no es thread-safe en el sentido estricto, pero Node.js es single-threaded — no hay race conditions reales. El riesgo es el rendimiento.

---

## Categoría 5: Chaos Combinado

### C-12: Operación real completa bajo condiciones adversas

**Descripción**: Simular un servicio completo de restaurante (desayuno, 2 horas) con:
- Internet cortado aleatoriamente 5 veces
- Impresora desconectada 2 veces
- Local Server reiniciado 1 vez a la mitad
- 3 POS simultáneos

**Objetivo**: Responder la pregunta original: ¿puede Fullsite operar un restaurante completo aunque Internet desaparezca?

**Criterios de certificación PASS**:
1. Ninguna mesa queda con estado inconsistente al final
2. 0 órdenes perdidas (todas las que se tomaron llegan a Supabase cuando vuelve internet)
3. Impresora de cocina nunca bloquea el flujo (comanda → needs_attention, no exception no manejada)
4. El cierre del turno puede completarse con todos los números correctos

**Señal de fallo**: cualquiera de los anteriores no se cumple.

---

## Infraestructura de Chaos Testing

### Herramientas recomendadas

| Tool | Propósito | Plataforma |
|---|---|---|
| PowerShell scripts | Kill/restart Electron, cortar Wi-Fi | Windows |
| Clumsy (Windows) | Packet loss, latencia, duplicados | Windows |
| Playwright Electron | Automatizar interacción con el POS | Cross-platform |
| Node.js WS client | Simular múltiples terminales | Cross-platform |
| Custom HTTP flood script | C-11 (100 req/s) | Node.js |

### Entorno de chaos

- NO ejecutar en producción (AMALAY)
- Usar una VM o laptop dedicada con instalación limpia de Fullsite
- Tener un snapshot del estado previo al chaos
- Loguear todos los eventos con timestamps en un archivo separado
- Comparar estado inicial vs estado final automáticamente

### Métricas a capturar durante chaos

```
cada 10s:
  - GET /health → { sync_queue_size, clients_connected, print_jobs_failed }
  - window.idb.getPendingCount()
  - console logs del Local Server
  - events.ndjson line count
```

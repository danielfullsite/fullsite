# RUNBOOK DE CERTIFICACIÓN OFFLINE
> Versión: 1.0
> Fecha: 2026-07-24
> Propósito: Documentar el comportamiento real del sistema con y sin internet.
> Referencia: FULLSITE-RUNTIME-SPECIFICATION.md §5 (Modelo de fallos)

---

## Reglas de la prueba

1. **No hipótesis durante la prueba.** Registrar solo lo que se observa.
2. **Cada resultado usa una de estas cuatro clasificaciones:**

   | Clasificación | Significado |
   |---|---|
   | **PASS** | El comportamiento coincide con el diseño actual del sistema. |
   | **FAIL** | El comportamiento contradice el diseño actual o rompe una capacidad que ya existe. |
   | **GAP** | El comportamiento evidencia una capacidad que aún no está implementada pero forma parte de la visión del Runtime. No es un fallo — es evidencia de roadmap. |
   | **UNKNOWN** | No se pudo ejecutar el caso (error de setup, terminal apagada, etc.). |

3. **Evidencia mínima**: screenshot o descripción exacta de lo que aparece en pantalla.
4. **Distinción clave entre FAIL y GAP:** si el sistema nunca fue diseñado para hacer algo (ej. cold boot offline), que no lo haga es un GAP, no un FAIL. Si el sistema se diseñó para hacerlo y dejó de funcionar, eso es un FAIL.
5. Al terminar, los FAIL se convierten en bugs a corregir. Los GAP se convierten en justificación de roadmap.

---

## Configuración del entorno de prueba

### Terminales involucradas

| Terminal | IP | Rol | Incluida en prueba |
|---|---|---|---|
| Caja (AMALAY) | 192.168.1.71 | POS principal + Runtime + Bridge | Sí |
| PDV1 | 192.168.1.68 | POS secundario | Opcional — solo si está encendido |
| PDV2 | 192.168.1.4 | POS secundario | Opcional |
| PDV3 | 192.168.1.69 | POS secundario | Opcional |
| KDS cocina | (confirmar IP) | KDS | Sí |
| KDS barra | (confirmar IP) | KDS | Sí |

### Cómo aislar internet manteniendo LAN activa

**Método recomendado: desconectar cable WAN del router**
1. Localizar el cable que va del router al módem o al proveedor (suele ser el puerto etiquetado "WAN" o "Internet")
2. Desconectar ese cable
3. Verificar en la Caja que la LAN sigue activa: `ping 192.168.1.68` debe responder
4. Verificar que internet no está disponible: `ping 8.8.8.8` debe fallar

**Método alternativo: bloquear en Windows (si no hay acceso al router)**
En la Caja, abrir PowerShell como administrador:
```cmd
netsh advfirewall firewall add rule name="BLOCK-INTERNET-TEST" ^
  dir=out action=block remoteip=0.0.0.0/0 ^
  remoteport=443,80
```
Para revertir:
```cmd
netsh advfirewall firewall delete rule name="BLOCK-INTERNET-TEST"
```
Luego verificar: `ping 192.168.1.68` responde, `ping 8.8.8.8` no responde.

**Antes de desconectar internet:**
- [ ] La Caja tiene el POS abierto y funcionando normalmente
- [ ] Hay al menos una orden activa en pantalla
- [ ] El KDS está mostrando órdenes
- [ ] Confirmar que `/health` responde: abrir `http://127.0.0.1:7717/health` en el browser de la Caja

---

## FASE 1 — Con internet (baseline)

**Objetivo:** documentar el estado de referencia. Ejecutar cada caso y marcar PASS/FAIL/UNKNOWN.

---

### Grupo A: POS — Boot y carga inicial

#### A-01 — Apertura del POS desde cero

```
ACCIÓN:
  Cerrar la aplicación Electron del POS.
  Volver a abrirla.

OBSERVAR:
  ¿La pantalla carga sin errores?
  ¿Cuántos segundos tarda en mostrar la pantalla de turno/login?
  ¿Aparece algún error de conexión?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de carga: _______ segundos
  Notas:
```

#### A-02 — Menú cargado correctamente

```
ACCIÓN:
  Con el POS abierto, navegar a la pantalla de nueva orden.
  Verificar que las categorías y productos del menú son visibles.

OBSERVAR:
  ¿Aparecen todas las categorías?
  ¿Los precios son correctos?
  ¿Las imágenes cargan?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Categorías visibles: Sí / No
  Imágenes visibles: Sí / No
  Notas:
```

#### A-03 — Login con PIN

```
ACCIÓN:
  En la pantalla de turno o acceso, ingresar un PIN válido de un mesero.

OBSERVAR:
  ¿El PIN es aceptado?
  ¿Aparece el nombre del mesero?
  ¿Cuántos segundos tarda la respuesta?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de respuesta: _______ segundos
  Notas:
```

#### A-04 — Abrir turno

```
ACCIÓN:
  Abrir un turno nuevo (si no hay turno activo).

OBSERVAR:
  ¿El turno queda abierto correctamente?
  ¿Aparece el turno activo en pantalla?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo B: POS — Operación de órdenes

#### B-01 — Crear orden nueva

```
ACCIÓN:
  Seleccionar una mesa disponible (o nueva orden).
  Agregar al menos 3 productos de categorías distintas.

OBSERVAR:
  ¿Los productos se agregan sin error?
  ¿El total se calcula correctamente?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### B-02 — Enviar comanda a cocina

```
ACCIÓN:
  Con la orden creada en B-01, presionar "Enviar" o el equivalente para
  mandar la comanda a cocina.

OBSERVAR:
  ¿La acción se completa sin error?
  ¿El status de la orden cambia a "enviada" o equivalente?
  ¿Cuántos segundos tarda?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de respuesta: _______ segundos
  Notas:
```

#### B-03 — Cerrar orden con pago en efectivo

```
ACCIÓN:
  Tomar una orden enviada. Procesarla como pago en efectivo.
  Confirmar el cierre.

OBSERVAR:
  ¿El cierre se completa sin error?
  ¿La orden desaparece de las órdenes activas?
  ¿Cuántos segundos tarda?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de respuesta: _______ segundos
  Notas:
```

#### B-04 — Cerrar orden con pago en tarjeta

```
ACCIÓN:
  Igual que B-03 pero con método de pago "Tarjeta".

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### B-05 — Modificar orden existente (agregar ítem)

```
ACCIÓN:
  Abrir una orden que ya fue enviada a cocina.
  Agregar un producto adicional.
  Reenviar.

OBSERVAR:
  ¿Se permite modificar la orden?
  ¿El nuevo ítem se envía a cocina?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo C: Hardware y Bridge

#### C-01 — Bridge health check

```
ACCIÓN:
  En el browser de la Caja, abrir: http://127.0.0.1:7717/health

OBSERVAR:
  ¿Responde con JSON?
  Copiar la respuesta completa aquí:

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Respuesta:
  {
    [pegar JSON aquí]
  }
```

#### C-02 — Impresión en estación cocina

```
ACCIÓN:
  Enviar una comanda a cocina via el POS (ejecutar B-02 si no hay una activa).

OBSERVAR:
  ¿La impresora de cocina imprime físicamente?
  ¿El ticket tiene todos los ítems correctos?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-03 — Impresión en estación barra

```
ACCIÓN:
  Si hay una estación barra configurada, enviar una comanda o hacer
  POST /test desde el browser.

OBSERVAR:
  ¿La impresora de barra imprime?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-04 — Impresión de ticket (caja)

```
ACCIÓN:
  Cerrar una orden con pago y confirmar la impresión del ticket al cliente.

OBSERVAR:
  ¿La impresora de caja imprime el ticket?
  ¿El total en el ticket es correcto?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-05 — Apertura del cajón de dinero

```
ACCIÓN:
  Ejecutar la acción de apertura del cajón desde el POS.
  O directamente: POST http://127.0.0.1:7717/drawer desde el browser.

OBSERVAR:
  ¿El cajón abre físicamente?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-06 — Verificación de huella digital

```
ACCIÓN:
  Usar el lector de huellas para autenticar un empleado.

OBSERVAR:
  ¿El lector responde?
  ¿La verificación es exitosa?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo D: KDS

#### D-01 — KDS carga y muestra órdenes activas

```
ACCIÓN:
  Verificar que el KDS (cocina o barra) tiene la pantalla activa.
  Observar las órdenes que aparecen.

OBSERVAR:
  ¿Hay órdenes activas visibles?
  ¿Los datos son correctos (mesa, ítems, tiempo)?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### D-02 — KDS recibe nueva orden en tiempo real

```
ACCIÓN:
  Desde el POS, enviar una nueva comanda a cocina (ejecutar B-02).
  Observar el KDS simultáneamente.

OBSERVAR:
  ¿La orden aparece en el KDS sin recargar la pantalla?
  ¿Cuántos segundos tarda en aparecer?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de aparición en KDS: _______ segundos
  Notas:
```

#### D-03 — KDS actualiza estado de ítem

```
ACCIÓN:
  En el KDS, marcar un ítem como listo.
  Observar el POS simultáneamente.

OBSERVAR:
  ¿El estado del ítem cambia en el KDS?
  ¿El POS refleja el cambio?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo E: Dashboard (web)

#### E-01 — Dashboard carga

```
ACCIÓN:
  Abrir app.fullsite.mx/dashboard (o la URL del Dashboard) en el browser.

OBSERVAR:
  ¿Carga correctamente?
  ¿Aparecen datos del día?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### E-02 — Dashboard muestra ventas del día

```
ACCIÓN:
  Navegar a la sección de ventas del día.

OBSERVAR:
  ¿Las cifras corresponden a las órdenes cerradas en esta sesión?

RESULTADO FASE 1 (con internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

## FASE 2 — Sin internet (LAN activa)

**Antes de continuar:**
1. Desconectar internet siguiendo las instrucciones de configuración (ver arriba)
2. Verificar `ping 192.168.1.68` — debe responder
3. Verificar `ping 8.8.8.8` — debe fallar
4. Registrar la hora exacta de desconexión: _____________

**Regla:** No recargar el POS ni el KDS entre Fase 1 y Fase 2 a menos que el caso así lo indique.

---

### Grupo A: POS — Boot y carga inicial (sin internet)

#### A-01-OFFLINE — Apertura del POS desde cero (sin internet)

> Nota de caracterización: este caso documenta el comportamiento actual sin asumir cuál debería ser.
> El POS carga desde `https://app.fullsite.mx/pos` (Vercel). Si no arranca sin internet, el resultado
> es GAP (cold boot offline no está implementado aún), no FAIL. Si arranca mostrando offline.html
> o alguna pantalla funcional, es PASS.

```
ACCIÓN:
  Cerrar la aplicación Electron del POS.
  Sin reconectar internet, volver a abrirla.

OBSERVAR:
  ¿La pantalla carga algo?
  ¿Qué aparece exactamente? (offline.html / error de red / pantalla en blanco / spinner infinito)
  ¿Cuántos segundos esperar antes de declarar que no cargó? → esperar 30 segundos.

RESULTADO FASE 2 (sin internet):
  Estado: [x] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Fecha: 2026-07-24 02:55 a.m.
  Tiempo hasta estado final: ~5 segundos
  Descripción exacta de la pantalla: PIN/huella screen cargó desde Service Worker caché.
  Login con PIN exitoso → Mesas con 17 ocupadas visible sin internet.
  Reconexión automática al restaurar internet (datos en tiempo real en 02:57 a.m.).
  Bridge /health ok:true accesible durante toda la prueba.

  Implementación: Service Worker re-habilitado (commit 54feab6).
    - dashboard-app/src/lib/service-worker.ts: registro SW con flag rollback FULLSITE_OFFLINE_DISABLED
    - electron-app/offline.html: reescrito con bridge health check y protección Escenario C
  Rollback disponible: localStorage.setItem('FULLSITE_OFFLINE_DISABLED','1') → reload
  Notas: build arm64 inicial no compatible con Caja x64. Se recompiló con --x64.
```

#### A-02-OFFLINE — Menú visible sin internet

```
ACCIÓN:
  Con el POS que estaba abierto ANTES de desconectar internet,
  navegar a la pantalla de nueva orden.

OBSERVAR:
  ¿Las categorías y productos siguen visibles?
  ¿Las imágenes cargan?
  ¿Hay algún indicador visual de modo offline?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Categorías visibles: Sí / No
  Imágenes visibles: Sí / No
  Indicador offline visible: Sí / No — descripción:
  Notas:
```

#### A-03-OFFLINE — Login con PIN sin internet

```
ACCIÓN:
  Cerrar sesión en el POS (si aplica) e intentar ingresar un PIN.

OBSERVAR:
  ¿El PIN es aceptado?
  ¿La respuesta usa cache local o intenta contactar el servidor?
  ¿Cuántos segundos tarda?
  ¿Aparece algún mensaje de error o advertencia?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de respuesta: _______ segundos
  Mensaje mostrado (si aplica):
  Notas:
```

#### A-04-OFFLINE — Abrir turno sin internet

```
ACCIÓN:
  Intentar abrir un nuevo turno sin internet.

OBSERVAR:
  ¿Se permite abrir el turno?
  ¿Hay algún mensaje de error?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo B: POS — Operación de órdenes (sin internet)

#### B-01-OFFLINE — Crear orden nueva sin internet

```
ACCIÓN:
  Seleccionar una mesa disponible. Agregar al menos 3 productos.

OBSERVAR:
  ¿Los productos se agregan?
  ¿El total se calcula?
  ¿Aparece algún indicador de que la orden quedará pendiente de sync?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### B-02-OFFLINE — Enviar comanda a cocina sin internet

```
ACCIÓN:
  Con la orden de B-01-OFFLINE, presionar "Enviar".

OBSERVAR:
  ¿La acción se completa?
  ¿El status cambia?
  ¿Cuánto tarda?
  ¿Hay algún indicador de que la orden fue guardada localmente?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de respuesta: _______ segundos
  Mensaje mostrado:
  Notas:
```

#### B-03-OFFLINE — Cerrar orden con pago sin internet

```
ACCIÓN:
  Cerrar la orden de B-01-OFFLINE con pago en efectivo.

OBSERVAR:
  ¿El cierre se permite?
  ¿La orden desaparece de activas?
  ¿El ticket se imprime?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### B-04-OFFLINE — La orden aparece en sync queue

```
ACCIÓN:
  Después de B-02-OFFLINE y B-03-OFFLINE, abrir el browser en la Caja
  y consultar: http://127.0.0.1:7717/health

OBSERVAR:
  ¿El campo sync_queue_pending muestra un número > 0?
  Copiar la respuesta completa.

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  sync_queue_pending:
  Respuesta /health:
  Notas:
```

---

### Grupo C: Hardware y Bridge (sin internet)

#### C-01-OFFLINE — Bridge health check sin internet

```
ACCIÓN:
  En el browser de la Caja: http://127.0.0.1:7717/health

OBSERVAR:
  ¿Sigue respondiendo?
  ¿El campo supabase_reachable cambió?
  Copiar respuesta.

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  supabase_reachable: ___________
  Respuesta completa:
  Notas:
```

#### C-02-OFFLINE — Impresión en estación cocina sin internet

```
ACCIÓN:
  Ejecutar B-02-OFFLINE (enviar comanda) y observar la impresora.

OBSERVAR:
  ¿La impresora de cocina imprime físicamente?
  ¿El contenido es correcto?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-03-OFFLINE — Impresión de ticket (caja) sin internet

```
ACCIÓN:
  Ejecutar B-03-OFFLINE (cerrar orden) y observar la impresora de caja.

OBSERVAR:
  ¿El ticket se imprime?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-04-OFFLINE — Apertura del cajón sin internet

```
ACCIÓN:
  Ejecutar apertura del cajón desde el POS o via POST /drawer.

OBSERVAR:
  ¿El cajón abre?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### C-05-OFFLINE — Verificación de huella sin internet

```
ACCIÓN:
  Verificar un empleado con huella digital.

OBSERVAR:
  ¿El lector responde?
  ¿La verificación es exitosa?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

### Grupo D: KDS (sin internet)

#### D-01-OFFLINE — KDS mantiene órdenes existentes sin internet

```
ACCIÓN:
  Observar el KDS que estaba funcionando en Fase 1.
  No recargarlo.

OBSERVAR:
  ¿Las órdenes que estaban visibles siguen ahí?
  ¿Aparece algún indicador de modo offline?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Indicador offline visible: Sí / No — descripción:
  Notas:
```

#### D-02-OFFLINE — KDS recibe nueva orden sin internet

```
ACCIÓN:
  Ejecutar B-02-OFFLINE (enviar comanda desde el POS).
  Observar el KDS simultáneamente.

OBSERVAR:
  ¿La nueva orden aparece en el KDS?
  ¿Cuánto tarda?
  ¿O el KDS muestra un spinner/error?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Tiempo de aparición (si aplica): _______ segundos
  Notas:
```

#### D-03-OFFLINE — KDS después de recargar (sin internet)

```
ACCIÓN:
  En la terminal del KDS, recargar la página (F5 o equivalente).

OBSERVAR:
  ¿El KDS vuelve a cargar?
  ¿Muestra las órdenes activas?
  ¿O queda en pantalla de error?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Descripción exacta de la pantalla:
  Notas:
```

---

### Grupo E: Dashboard (sin internet)

#### E-01-OFFLINE — Dashboard sin internet

```
ACCIÓN:
  Intentar abrir o recargar el Dashboard en el browser.

OBSERVAR:
  ¿Carga?
  ¿Error de conexión?
  ¿Cache del browser muestra algo?

RESULTADO FASE 2 (sin internet):
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Descripción exacta:
  Notas:
```

---

### Grupo F: Reconexión

**Acción:** Volver a conectar internet. Registrar la hora: _____________

#### F-01 — Sync automático al reconectar

```
OBSERVAR en los primeros 60 segundos después de reconectar:
  ¿El bridge detecta la reconexión automáticamente?
  ¿El campo sync_queue_pending baja a 0 en /health?
  ¿Hay algún indicador visual en el POS?
  ¿Cuántos segundos tarda en sincronizar?

RESULTADO FASE 2 (sin internet):
  Estado: [x] CONDITIONAL PASS
  Fecha: 2026-07-24 03:32 a.m.

  Evidencia:
    - Orden de prueba: Mesa 32 · Ribeye Smash Burger · $245 · turno activo Daniel
    - Toast "Sin conexión — orden guardada localmente" confirmado
    - Indicador "Pendiente" visible en barra de POS (orden en IndexedDB sync_queue)
    - Orden llegó a Supabase (id: d661387c) al reconectar vía re-mount del layout
    - created_at offline: 08:18 UTC / sync: 09:32 UTC (~14 min)
    - Motor de sync end-to-end CERTIFICADO: guarda → cola → Supabase ✓
    - Reconciliación correcta: mesa, total, status = enviada ✓
    - Sin duplicados ✓

  GAP identificado:
    - syncAll() no dispara en reconexiones silenciosas donde navigator.onLine
      nunca transiciona (ej. bloqueo vía hosts file)
    - El intervalo de 30s solo llama updatePendingCount(), no syncAll()
    - Botón "Pendiente" no dispara syncAll()
    - Fix aprobado: agregar recovery sync al intervalo periódico
      (FULLSITE_RECOVERY_SYNC_DISABLED=1 para rollback)

  Para convertir en PASS completo:
    Implementar recovery sync en usePosOffline.ts y re-ejecutar prueba
    con reconexión silenciosa confirmando sync dentro de 30 segundos.
```

#### F-02 — Órdenes offline visibles en Dashboard

```
ACCIÓN:
  Después de sync completo (F-01 PASS), abrir el Dashboard.
  Buscar las órdenes creadas en Fase 2.

OBSERVAR:
  ¿Las órdenes offline aparecen en el Dashboard?
  ¿Los datos son correctos?

RESULTADO:
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

#### F-03 — KDS regresa a modo normal

```
OBSERVAR después de reconectar:
  ¿El KDS vuelve a recibir actualizaciones en tiempo real?
  ¿Sin recargar la página?

RESULTADO:
  Estado: [ ] PASS  [ ] FAIL  [ ] GAP  [ ] UNKNOWN
  Notas:
```

---

## Registro de resultados — Resumen

Completar al terminar toda la prueba.

### Fase 1 — Con internet

| ID | Caso | PASS | FAIL | GAP | UNKNOWN | Notas |
|---|---|---|---|---|---|---|
| A-01 | POS abre desde cero | | | | | |
| A-02 | Menú visible | | | | | |
| A-03 | Login PIN | | | | | |
| A-04 | Abrir turno | | | | | |
| B-01 | Crear orden | | | | | |
| B-02 | Enviar comanda | | | | | |
| B-03 | Cerrar orden efectivo | | | | | |
| B-04 | Cerrar orden tarjeta | | | | | |
| B-05 | Modificar orden | | | | | |
| C-01 | Bridge /health | | | | | |
| C-02 | Print cocina | | | | | |
| C-03 | Print barra | | | | | |
| C-04 | Print ticket caja | | | | | |
| C-05 | Abrir cajón | | | | | |
| C-06 | Huella digital | | | | | |
| D-01 | KDS carga órdenes | | | | | |
| D-02 | KDS recibe orden | | | | | |
| D-03 | KDS actualiza estado | | | | | |
| E-01 | Dashboard carga | | | | | |
| E-02 | Dashboard ventas | | | | | |

### Fase 2 — Sin internet

| ID | Caso | PASS | FAIL | GAP | UNKNOWN | Notas |
|---|---|---|---|---|---|---|
| A-01-OFFLINE | POS abre desde cero | | | | | |
| A-02-OFFLINE | Menú visible | | | | | |
| A-03-OFFLINE | Login PIN | | | | | |
| A-04-OFFLINE | Abrir turno | | | | | |
| B-01-OFFLINE | Crear orden | | | | | |
| B-02-OFFLINE | Enviar comanda | | | | | |
| B-03-OFFLINE | Cerrar orden | | | | | |
| B-04-OFFLINE | Sync queue visible | | | | | |
| C-01-OFFLINE | Bridge /health | | | | | |
| C-02-OFFLINE | Print cocina | | | | | |
| C-03-OFFLINE | Print ticket caja | | | | | |
| C-04-OFFLINE | Abrir cajón | | | | | |
| C-05-OFFLINE | Huella digital | | | | | |
| D-01-OFFLINE | KDS mantiene órdenes | | | | | |
| D-02-OFFLINE | KDS recibe orden nueva | | | | | |
| D-03-OFFLINE | KDS recarga | | | | | |
| E-01-OFFLINE | Dashboard | | | | | |
| F-01 | Sync al reconectar | | | | | |
| F-02 | Órdenes offline en Dashboard | | | | | |
| F-03 | KDS regresa a normal | | | | | |

---

## Clasificación de dependencias de internet

Completar al terminar la prueba. Para cada componente, marcar si requiere internet.

| Componente | Requiere internet | Evidencia (caso ID) |
|---|---|---|
| POS — boot inicial | ? | |
| POS — carga de menú (primera vez) | ? | |
| POS — carga de menú (si ya cargó antes) | ? | |
| POS — login con PIN | ? | |
| POS — crear orden | ? | |
| POS — enviar comanda | ? | |
| POS — cerrar orden | ? | |
| Print bridge — /health | ? | |
| Print bridge — impresión cocina | ? | |
| Print bridge — impresión caja | ? | |
| Print bridge — cajón | ? | |
| Fingerprint service | ? | |
| KDS — carga inicial | ? | |
| KDS — recibir orden en tiempo real | ? | |
| KDS — recargar página | ? | |
| Dashboard — carga | ? | |
| Dashboard — datos en tiempo real | ? | |
| Sync queue — acumula offline | ? | |
| Sync queue — vacía al reconectar | ? | |

---

## Próximos pasos (completar DESPUÉS de la prueba)

No completar durante la prueba. Solo al final.

### FAILs identificados (bugs — corregir)

| # | Componente | Descripción del fallo | Impacto operativo | Prioridad |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

### GAPs identificados (roadmap — priorizar en fases del Runtime)

| # | Componente | Capacidad faltante | Fase del Runtime que lo resuelve | Prioridad |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

### Conclusión

```
¿El sistema puede completar un turno completo sin internet?
  [ ] Sí — completamente
  [ ] Parcialmente — con estas limitaciones:
  [ ] No

¿Qué es lo más crítico que falla sin internet?


¿Qué cambio de las fases del Runtime resolvería el mayor número de FAILs?


Firma del observador: ________________________________  Fecha: 2026-07-24
```

---

> Este documento es evidencia de campo.
> Los resultados aquí registrados son la base para priorizar las fases de P0-4.
> No modificar los resultados después de la prueba. Si se re-ejecuta un caso, agregar nueva fila.

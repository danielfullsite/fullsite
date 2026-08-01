# Sesión de Certificación — Domingo 27 Jul
> Propósito: certifica B-01 (impresión offline), confirma F-01 bajo condiciones reales,
> investiga PIN tras restart. La meta es convertir evidencia en certificaciones, no escribir código.
> Duración estimada: 45–60 minutos.

---

## ESTADO INICIAL

| Caso | Estado | Nota |
|---|---|---|
| F-01 (sync automático) | **PASS** | Certificado 2026-07-24, commit c312fac |
| A-01-OFFLINE (boot desde SW) | **PASS** | Certificado 2026-07-24, commit 54feab6 |
| B-01-OFFLINE (impresión offline) | **FIX DEPLOYED, SIN CERTIF.** | Commit 2edcca1 — pendiente prueba física |
| A-03-OFFLINE (login PIN offline) | **PENDIENTE** | No certificado |
| F-01 condiciones reales | **PENDIENTE** | Solo certificado con Chrome DevTools, no WAN cable |
| PIN tras restart | **INVESTIGANDO** | Mensaje mejorado en next deploy |

---

## PRE-FLIGHT (con internet, ~5 min)

Hacer TODO esto antes de desconectar el cable WAN.

- [ ] **Bridge arriba**: abrir en Caja → `http://127.0.0.1:7717/health` → debe responder `{"ok":true,...}`
- [ ] **Login normal**: abrir POS Electron → ingresar PIN 1234 → login exitoso
- [ ] **Reload SW**: en el POS, abrir DevTools → Application → Service Workers → Update
  - *Esto carga el commit más reciente (networkError fix + B-01 fix)*
- [ ] **Turno abierto**: confirmar que hay turno activo
- [ ] **Limpiar items TERMINAL** del sync_queue (paste en consola del POS):
  ```javascript
  (async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('fullsite_pos', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    const all = await new Promise(res => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res([]);
    });
    const terminal = all.filter(i => !i.synced && (!i.endpoint || i.endpoint === 'undefined') && i.retries >= 3);
    for (const item of terminal) {
      console.log('Borrando terminal:', item.id, item.table);
      store.delete(item.id);
    }
    console.log(`Borrados ${terminal.length} items terminales`);
  })();
  ```
  - Resultado esperado: "Borrados 3 items terminales"

---

## BLOQUE 1 — A-03-OFFLINE: Login PIN offline (~10 min)

> Objetivo: confirmar que el login funciona desde caché cuando internet no está disponible.
> Requisito: el caché expira en 15 minutos → este bloque DEBE ejecutarse dentro de los 15 min
> después de que Daniel hizo login normal en Pre-flight.

1. Anotar la hora del login en pre-flight: ___________
2. **Desconectar cable WAN** del router (puerto etiquetado "WAN" o "Internet")
3. Verificar: `ping 8.8.8.8` → debe fallar (timeout)
4. Verificar: `ping 192.168.1.68` → debe responder (LAN activa)
5. En el POS Electron, **cerrar sesión** (lock/logout del staff actual)
6. Intentar login con PIN 1234

**Criterio PASS:**
- Login exitoso, muestra nombre del staff
- Tiempo de respuesta < 2 segundos (es de caché local)

**Criterio FAIL:**
- Mensaje "Sin conexión — espera un momento e intenta de nuevo" (fetch lanzó error, sin caché)
  - Esto significa que el caché de 15 min expiró o no se generó
  - Acción: anotar hora, intentar de nuevo → si pasan más de 15 min desde el login, hay que repetir
- Mensaje "PIN incorrecto" (este mensaje ahora SOLO aparece si el servidor responde 401 — no debería
  verse si internet está desconectado con nuestro fix)

**Registro:**
```
Estado: [ ] PASS  [ ] FAIL
Mensaje mostrado exacto:
Tiempo de respuesta: _______ seg
Hora de desconexión WAN: _______
Hora de intento login: _______
Diferencia (debe ser < 15 min): _______
Notas:
```

---

## BLOQUE 2 — B-01-OFFLINE: Impresión offline (~10 min)

> Objetivo: confirmar que una orden creada sin internet SÍ imprime comanda en cocina.
> Prerequisito: WAN desconectado desde Bloque 1. NO reconectar entre bloques.

1. En el POS (ya sin internet, ya logueado desde Bloque 1 o logueado antes del WAN pull)
2. Seleccionar **Mesa de prueba** (usar mesa con número alto para no confundir con producción)
   - Mesa recomendada: 99 o una que esté libre
3. Agregar 2–3 productos (cualquiera del menú)
4. Presionar **"Enviar"** (o equivalente)
5. Observar en la siguiente secuencia:

**Criterio PASS (los DOS deben ocurrir):**
- Toast en pantalla: "Sin conexión — orden guardada localmente, se enviará al reconectar"
- Impresora cocina: imprime comanda física en los siguientes 5 segundos

**Criterio FAIL:**
- Toast: cualquier mensaje de error que no sea "Sin conexión"
- Sin print: la impresora no imprime nada en 10 segundos
- Pantalla se congela o muestra spinner indefinido

**Si FAIL:** verificar que el bridge sigue activo: `http://127.0.0.1:7717/health`
- Si bridge no responde: es un problema de bridge/Electron, no del código
- Si bridge responde: el problema está en la lógica de printByStation

**Registro:**
```
Estado: [ ] PASS  [ ] FAIL
Toast exacto mostrado:
¿Imprimió la comanda? Sí / No
Tiempo entre "Enviar" y print: _______ seg
Mesa usada: _______ | Productos: _______
Notas:
```

---

## BLOQUE 3 — F-01 real: Sync con cable WAN (~10 min)

> Objetivo: confirmar F-01 bajo condiciones reales (cable físico, no Chrome DevTools).
> Prerequisito: orden creada en Bloque 2 está en la queue offline.

1. Confirmar que hay orden pendiente: verificar badge en POS o `sync_queue_pending` en /health
2. Anotar la hora: ___________
3. **Reconectar cable WAN**
4. NO recargar el POS en ningún momento
5. Esperar 60 segundos observando el POS
6. Después de 60s, verificar en Supabase (desde laptop o teléfono):
   - Table Editor → `pos_orders` → filtrar por `created_at > [hora de Bloque 2]`
   - La orden debe aparecer exactamente **una vez** con el mesa y total correctos

**Criterio PASS:**
- Orden en Supabase: ✓
- Badge de pendientes en POS: desapareció (0 pendientes)
- Sin duplicados
- Todo sin haber recargado la app

**Criterio FAIL:**
- No aparece en Supabase después de 90 segundos
- Aparece dos veces (duplicado)
- Badge sigue mostrando pendientes después de 90s

**Registro:**
```
Estado: [ ] PASS  [ ] FAIL
Hora reconexión WAN: _______
Hora aparición en Supabase: _______
Segundos hasta sync: _______
ID orden en Supabase: _______
Duplicados: Sí / No
Badge pendientes después de 90s: Sí (FAIL) / No (PASS)
Notas:
```

---

## BLOQUE 4 — Investigación PIN tras restart (~10 min)

> Objetivo: aislar si el PIN bug del jueves fue Electron-específico o API-general.
> Ejecutar SOLO si Bloques 1–3 completaron.

1. Abrir **Chrome browser** en la Caja (no Electron) → `https://app.fullsite.mx/pos`
2. Abrir DevTools Console (F12)
3. Correr: `localStorage.getItem('fullsite_client_id')` → anotar resultado
4. Intentar login con PIN 1234

**Escenario A — Chrome acepta PIN:**
- Indica que el PIN en DB es correcto y la API funciona
- El bug del jueves fue transitorio (race condition post-restart)
- Clasificación: GAP (no bug activo), documentar como "probable race condition de bridge/SW")

**Escenario B — Chrome rechaza PIN:**
- Indica problema en la API o en la DB
- Copiar el mensaje exacto de error
- Abrir Supabase → Table Editor → `pos_staff` → filtrar `client_id=amalay,active=true`
- Verificar que existe el registro con `pin=1234`
- Clasificación: BUG ACTIVO, escalar

**Registro:**
```
Estado: [ ] A (transitorio)  [ ] B (bug activo)
localStorage.getItem('fullsite_client_id'): _______
PIN 1234 en Chrome: PASS / FAIL
Mensaje exacto en Chrome:
PIN 1234 en Electron: PASS / FAIL
Mensaje exacto en Electron:
Registro en pos_staff visible en Supabase: Sí / No
Notas:
```

---

## BLOQUE 5 — KDS offline (stretch, si tiempo lo permite)

Solo ejecutar si Bloques 1–3 resultaron en PASS.

1. Con internet activo, observar el KDS: anotar cuántas órdenes activas muestra
2. Desconectar WAN (pull de cable)
3. En el POS (offline): enviar una comanda a cocina
4. Observar el KDS: ¿aparece la nueva orden?

**Criterio PASS:** KDS muestra la orden nueva sin internet
**Criterio GAP:** KDS no la muestra → es una limitación conocida (KDS depende de Supabase realtime)
**Criterio FAIL:** KDS pierde las órdenes que ya tenía

---

## AL TERMINAR

- [ ] Reconectar WAN si sigue desconectado
- [ ] Verificar que el POS funciona normalmente (crear y cerrar una orden de prueba)
- [ ] Actualizar el runbook en `docs/offline/RUNBOOK.md` con los resultados
- [ ] Si B-01-OFFLINE es PASS → actualizar estado a PASS en runbook y en memoria
- [ ] Si F-01 real conditions PASS → agregar evidencia con WAN cable en el caso F-01 del runbook

---

## ROLLBACK RÁPIDO

Si algo sale mal y necesitas restaurar el estado normal:
```javascript
// Deshabilitar SW (si causa problemas)
localStorage.setItem('FULLSITE_OFFLINE_DISABLED', '1')
// Luego recargar

// Deshabilitar recovery sync (si causa duplicados)
localStorage.setItem('FULLSITE_RECOVERY_SYNC_DISABLED', '1')
// No requiere reload
```

Para limpiar todos los items del sync_queue (nuclear — solo si es necesario):
```javascript
// Pegar en consola del POS
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('fullsite_pos', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction('sync_queue', 'readwrite');
  tx.objectStore('sync_queue').clear();
  console.log('sync_queue limpiado');
})();
```

# CFG-01 — Protocolo de Validación: Restaurante Norte Demo

**Versión:** 1.0  
**Fecha:** 2026-07-27  
**Autor:** Daniel Ramonfaur  
**Commit base:** `9f13f91` (feat: printer configuration wizard in setup.html)  
**Estado:** BORRADOR — pendiente de ejecución

---

## Objetivo

Demostrar que CFG-01 permite desplegar la misma build de Fullsite POS en un restaurante distinto
a AMALAY usando únicamente configuración, sin editar código fuente.

El protocolo usa datos completamente ficticios ("Restaurante Norte Demo"). Ningún escenario
toca Supabase, el servidor de AMALAY, ni archivos de producción.

---

## Prerequisitos

### Entorno

| Requisito | Valor esperado |
|---|---|
| OS | macOS 13+ o Windows 10+ (el protocolo anota diferencias donde aplica) |
| Node | ≥ 18 |
| Electron | versión definida en `electron-app/package.json` |
| Build disponible | `npm start` en `electron-app/` arranca la app sin errores |
| userData vacío | Sin `printers.json` previo (ver sección Cleanup antes de empezar) |

### Verificación previa

```bash
# Confirmar que no existe config previa
ls "~/Library/Application Support/fullsite-pos/"   # macOS
# o
ls "%APPDATA%\fullsite-pos\"                        # Windows

# Correr tests unitarios — deben ser 17/17
node --test electron-app/local-server/tests/printer-wizard.test.js
```

**El protocolo NO debe ejecutarse si los tests unitarios tienen algún fallo.**

---

## Paths del filesystem

| Archivo | macOS | Windows |
|---|---|---|
| `printers.json` (primario) | `~/Library/Application Support/fullsite-pos/printers.json` | `%APPDATA%\fullsite-pos\printers.json` |
| `printers.json.tmp` (transitorio) | mismo dir, sufijo `.tmp` | mismo dir, sufijo `.tmp` |
| `config.json` (terminal) | `~/Library/Application Support/fullsite-pos/config.json` | `%APPDATA%\fullsite-pos\config.json` |
| Legacy (sólo Windows) | `C:\fullsite\printers.json` | mismo |

En adelante se usa la notación `{userData}/printers.json` para independizar del OS.

---

## Configuración inicial ficticia

Esta configuración se usará a lo largo de todos los escenarios. No debe contener ninguna
referencia a AMALAY ni a datos de producción.

### Identidad del restaurante

| Campo | Valor |
|---|---|
| `restaurant_id` | `norte-demo` |
| Nombre visible | Restaurante Norte Demo |
| `terminal_name` | `Caja Norte 01` |
| `terminal_role` | `server_pos` |
| `local_server_host` | `192.168.10.50` |
| `local_server_port` | `7717` |

### Impresoras ficticias

| `printer_id` | Nombre | Tipo | Host / Nombres Windows | Estaciones | Docs |
|---|---|---|---|---|---|
| `epson-cocina-norte` | Epson TM-T88 Cocina | TCP | `192.168.10.101:9100` | cocina | kitchen_ticket |
| `star-barra` | Star TSP100 Barra | TCP | `192.168.10.102:9100` | barra | bar_ticket, pre_ticket |
| `ec-caja-norte` | EC PM-80 Caja | windows | `EC NORTE`, `EC01`, `TICKET` | caja | receipt, corte, invoice |

---

## Escenarios

### Nomenclatura de evidencia

Cada escenario indica qué capturar. Las abreviaturas son:

- **SS** — screenshot de la ventana del wizard
- **FS** — estado del filesystem (listado de archivos + contenido)
- **LOG** — salida de consola de Electron (View → Toggle Developer Tools → Console)
- **IPC** — resultado del IPC call (visible en la consola del renderer o del main process)
- **JSON** — contenido de `{userData}/printers.json`

---

### N-01 — Terminal virgen: sin configuración previa

**Dimensión:** onboarding / estado inicial

**Preconditions:**
- `{userData}/printers.json` no existe
- `C:\fullsite\printers.json` no existe (o no aplica en macOS)
- La app arranca y abre el wizard automáticamente (sin `config.json` válido)

**Steps:**
1. Arrancar la app: `npm start` en `electron-app/`
2. Observar el paso 1 del wizard

**Expected UI:**
- `#legacyAlert` vacío (sin banner de migración)
- Botón "Migrar config anterior" (`#btnMigrate`) con `display: none`
- Visible: "Configurar nueva terminal →" y "Importar respaldo..."

**Expected filesystem:**
- `{userData}/printers.json` — no existe
- `{userData}/printers.json.tmp` — no existe

**Expected logs (main process):**
```
[config] Printers: no printers.json found — PRINTER_NOT_CONFIGURED state.
```

**Expected IPC:**
- No hay IPC en paso 1 (aún no se ha entrado al paso 5)

**Expected config.json:**
- No existe todavía

**Evidencia a capturar:** SS del paso 1 completo; FS listado del userData.

---

### N-02 — Paso 2: ingresar identidad `norte-demo`

**Dimensión:** onboarding / identidad

**Preconditions:** App en paso 1, sin config previa (continúa de N-01)

**Steps:**
1. Click "Configurar nueva terminal →"
2. En `#restaurantId` escribir `norte-demo`
3. En `#terminalName` escribir `Caja Norte 01`
4. En `#terminalRole` seleccionar `server_pos`
5. Click "Siguiente →"

**Expected UI:**
- Sin mensajes de error en los campos
- Wizard avanza a paso 3
- Paso 2 en steps bar pasa a `done`

**Expected filesystem:** sin cambios

**Expected logs:** ninguno relevante

**Expected IPC:** ninguno

**Expected config.json:** no existe todavía

**Evidencia:** SS del paso 3 ya visible.

---

### N-03 — Paso 2: `restaurant_id` vacío bloqueado

**Dimensión:** validación / identidad

**Preconditions:** App en paso 2

**Steps:**
1. Dejar `#restaurantId` vacío
2. Ingresar cualquier nombre en `#terminalName`
3. Click "Siguiente →"

**Expected UI:**
- `#restaurantId` tiene clase `error` (borde rojo)
- Hint del campo muestra el mensaje de error
- Wizard **no** avanza; permanece en paso 2

**Expected filesystem:** sin cambios

**Expected logs:** ninguno

**Expected IPC:** ninguno

**Expected config.json:** no existe

**Evidencia:** SS del campo con error.

---

### N-04 — Paso 3: IP distinta de AMALAY

**Dimensión:** onboarding / servidor

**Preconditions:** App en paso 3

**Steps:**
1. Verificar que `#serverHost` contiene `127.0.0.1` (default server_pos)
2. Limpiar el campo e ingresar `192.168.10.50`
3. Verificar que `#serverPort` = `7717`
4. Click "Siguiente →"

**Expected UI:**
- Wizard avanza a paso 4
- Sin advertencia sobre IP

**Expected filesystem:** sin cambios

**Expected logs:** ninguno

**Expected IPC:** ninguno

**Expected config.json:** no existe

**Verificación post-escenario:**
```javascript
// En consola del renderer:
state.serverHost  // debe ser "192.168.10.50"
state.serverPort  // debe ser 7717
```

**Evidencia:** SS del paso 4; captura de consola con `state.serverHost`.

---

### N-05 — Paso 5: estado vacío sin impresoras

**Dimensión:** empty state / PRINTER_NOT_CONFIGURED

**Preconditions:** App en paso 4, avanzar a paso 5 (click "Siguiente →")

**Steps:**
1. Click "Siguiente →" en paso 4 para entrar a paso 5
2. Observar el panel de lista

**Expected UI:**
- `#pfEmpty` visible: "Sin impresoras configuradas / La terminal operará, pero los tickets no se imprimirán."
- `#pfList` vacío (sin cards)
- `#pfRoutingSection` oculto (`display: none`)
- Botones "Agregar impresora" e "Importar respaldo..." visibles
- Botón "Siguiente →" visible y habilitado

**Expected filesystem:** sin cambios

**Expected logs (main process):**
```
[config] Printers: no printers.json found — PRINTER_NOT_CONFIGURED state.
```

**Expected IPC:**
```json
// provision:load-printers retorna:
{ "state": "not_configured", "config": null, "migrated": false,
  "errors": ["No printers.json found"], "legacyV1": null }
```

**Expected config.json:** no existe

**Evidencia:** SS del paso 5 con empty state; captura de IPC en consola.

---

### N-06 — Agregar primera impresora TCP (`epson-cocina-norte`)

**Dimensión:** alta de impresora / TCP

**Preconditions:** App en paso 5, lista vacía

**Steps:**
1. Click "+ Agregar impresora"
2. En **Nombre visible** escribir `Epson TM-T88 Cocina`
3. Observar que **ID lógico** se auto-rellena
4. En **Tipo de conexión** seleccionar `TCP/IP — red local`
5. En **Host / IP** escribir `192.168.10.101`
6. En **Puerto** escribir `9100`
7. En **Estaciones** marcar `Cocina`
8. En **Tipos de documento** marcar `Comanda cocina`
9. Click "Guardar impresora"

**Expected UI:**
- Formulario cierra, panel de lista visible
- Card "Epson TM-T88 Cocina" con punto verde (`●`) y `TCP · 192.168.10.101:9100`
- Routing chip: `Cocina → Comanda cocina`
- `#pfEmpty` ya no visible

**Expected filesystem:** sin cambios (aún no se ha llamado Siguiente →)

**Expected logs:** ninguno

**Expected IPC:** ninguno (guardado es en memoria; IPC ocurre al click Siguiente →)

**Expected state interno:**
```javascript
state.printers.length  // 1
state.printers[0].printer_id       // "epson-tm-t88-cocina" o el auto-slug
state.printers[0].connection.type  // "tcp"
state.printers[0].connection.host  // "192.168.10.101"
state.printers[0].connection.port  // 9100
state.printers[0].station_ids      // ["cocina"]
state.printers[0].document_types   // ["kitchen_ticket"]
state.printers[0].enabled          // true
```

**Evidencia:** SS de la lista con la primera card.

---

### N-07 — Auto-slug del ID lógico

**Dimensión:** UX / generación de ID

**Preconditions:** Formulario de agregar impresora abierto

**Steps:**
1. Click "+ Agregar impresora"
2. En **Nombre visible** escribir `Star TSP100 Barra`
3. Sin tocar el campo ID, observar su contenido

**Expected UI:**
- `#pfId` contiene `star-tsp100-barra`
- Sin espacios, sin mayúsculas, sin caracteres especiales

**Steps adicionales:**
4. Editar el nombre a `Barra & Grill 2`
5. Observar que el ID se actualiza automáticamente a `barra-grill-2`
6. Editar manualmente el ID a `mi-id-manual`
7. Cambiar el nombre nuevamente

**Expected UI (paso 6-7):**
- Una vez editado manualmente, el ID ya NO sigue al nombre
- El campo ID permanece en `mi-id-manual` aunque el nombre cambie

**Evidencia:** SS del campo ID con varios estados.

---

### N-08 — Agregar segunda impresora TCP (`star-barra`)

**Dimensión:** alta múltiple / TCP

**Preconditions:** App en paso 5 con `epson-cocina-norte` ya en lista

**Steps:**
1. Click "+ Agregar impresora"
2. Nombre: `Star TSP100 Barra`
3. ID se auto-rellena (verificar `star-tsp100-barra`)
4. Tipo: TCP, Host: `192.168.10.102`, Puerto: `9100`
5. Estaciones: `Barra`
6. Documentos: `Comanda barra`, `Pre-cuenta`
7. Click "Guardar impresora"

**Expected UI:**
- Dos cards en la lista
- Segunda card: `Star TSP100 Barra · TCP · 192.168.10.102:9100`

**Expected state:**
```javascript
state.printers.length  // 2
state.printers[1].printer_id       // "star-tsp100-barra"
state.printers[1].connection.port  // 9100
state.printers[1].document_types   // ["bar_ticket","pre_ticket"]
```

**Evidencia:** SS de la lista con dos cards.

---

### N-09 — Agregar impresora Windows/USB (`ec-caja-norte`)

**Dimensión:** alta de impresora / Windows

**Preconditions:** App en paso 5 con 2 impresoras TCP ya en lista

**Steps:**
1. Click "+ Agregar impresora"
2. Nombre: `EC PM-80 Caja`
3. Tipo: `Windows — USB / cola de impresión`
4. Verificar que el campo Host/IP desaparece y aparece el textarea de nombres
5. En textarea escribir:
   ```
   EC NORTE
   EC01
   TICKET
   ```
6. Estaciones: `Caja`
7. Documentos: `Ticket cliente`, `Corte de caja`, `Factura`
8. Click "Guardar impresora"

**Expected UI:**
- Formulario TCP oculto, textarea Windows visible
- Tres cards en la lista
- Tercera card: `EC PM-80 Caja · Windows · EC NORTE, EC01, TICKET`

**Expected state:**
```javascript
state.printers[2].connection.type   // "windows"
state.printers[2].connection.names  // ["EC NORTE","EC01","TICKET"]
state.printers[2].station_ids       // ["caja"]
state.printers[2].document_types    // ["receipt","corte","invoice"]
```

**Evidencia:** SS del formulario con textarea; SS de lista con 3 cards.

---

### N-10 — Tabla de routing con 3 impresoras activas

**Dimensión:** routing / display

**Preconditions:** App en paso 5 con las 3 impresoras del fixture

**Steps:**
1. Observar la sección "Routing activo" debajo de la lista

**Expected UI:**
La tabla `#pfRoutingTable` debe contener exactamente estas 6 filas (orden puede variar):

| Estación | → | Documento | Impresora |
|---|---|---|---|
| Cocina | → | Comanda cocina | Epson TM-T88 Cocina |
| Barra | → | Comanda barra | Star TSP100 Barra |
| Barra | → | Pre-cuenta | Star TSP100 Barra |
| Caja | → | Ticket cliente | EC PM-80 Caja |
| Caja | → | Corte de caja | EC PM-80 Caja |
| Caja | → | Factura | EC PM-80 Caja |

**Expected filesystem:** sin cambios

**Verificación:**
```javascript
// En consola del renderer:
document.querySelectorAll('#pfRoutingTable tr').length  // 6
```

**Evidencia:** SS de la tabla de routing completa.

---

### N-11 — Test TCP con IP inalcanzable

**Dimensión:** connection test / error codes

**Preconditions:** `star-barra` en lista; `192.168.10.102` no existe en red real

**Steps:**
1. Click "Editar" en la card de `Star TSP100 Barra`
2. Click "Probar conexión"
3. Esperar hasta 4 segundos (timeout configurado)

**Expected UI:**
- Botón cambia a "Probando..." durante la espera
- Alert rojo con uno de los siguientes mensajes según error de red:
  - `HOST_NOT_FOUND`: "Host no encontrado — verifica la IP o nombre de host."
  - `NETWORK_UNREACHABLE`: "Red no alcanzable..."
  - `TIMEOUT`: "Timeout — impresora no responde..."
  - `PORT_CLOSED`: "Puerto cerrado..."
- Botón vuelve a "Probar conexión"

**Expected IPC:**
```json
// provision:test-printer retorna:
{ "ok": false, "error": "<mensaje OS>",
  "code": "HOST_NOT_FOUND" | "TIMEOUT" | "PORT_CLOSED" | "NETWORK_UNREACHABLE" }
```

**Expected filesystem:** sin cambios

**Evidencia:** SS del alert de error con el código visible; LOG de consola con el IPC result.

---

### N-12 — Routing overlap (barra + kitchen_ticket en segunda impresora)

**Dimensión:** routing / overlaps permitidos

**Preconditions:** 3 impresoras en lista

**Steps:**
1. Click "+ Agregar impresora" para agregar una cuarta (backup)
2. Nombre: `Epson Barra Backup`, ID: `epson-barra-backup`
3. TCP: `192.168.10.104:9100`
4. Estaciones: `Barra`
5. Documentos: `Comanda cocina` ← overlap intencional con `star-barra` en barra
6. Click "Guardar impresora"

**Expected UI:**
- El wizard **no bloquea** el overlap (es información, no error)
- La card aparece en lista
- La tabla de routing muestra `Barra → Comanda cocina` con `Epson Barra Backup`
  además de la fila de `star-barra`

**Rationale:** el wizard permite routing ambiguo porque en producción puede haber
rutas de failover. El POS resuelve el target final; el wizard no decide por él.

**Evidencia:** SS de routing table con la fila duplicada; SS de las 4 cards.

---

### N-13 — Test en impresora Windows/USB: UNTESTABLE

**Dimensión:** connection test / USB

**Preconditions:** `ec-caja-norte` (tipo windows) en lista

**Steps:**
1. Click "Editar" en la card de `EC PM-80 Caja`
2. Click "Probar conexión"

**Expected UI:**
- Alert azul (clase `alert-migrate`): "Las impresoras Windows/USB no pueden probarse sin imprimir. Guarda la configuración y usa 'Imprimir prueba' desde el POS."
- Sin spinner, respuesta inmediata

**Expected IPC:**
```json
{ "ok": null, "code": "UNTESTABLE",
  "message": "Las impresoras Windows/USB no pueden probarse sin imprimir..." }
```

**Evidencia:** SS del alert azul.

---

### N-14 — Editar impresora existente (`star-barra` → cambio de puerto)

**Dimensión:** edición / persistencia en memoria

**Preconditions:** `star-barra` en lista con puerto 9100

**Steps:**
1. Click "Editar" en la card de `Star TSP100 Barra`
2. Cambiar `#pfPort` de `9100` a `9101`
3. Click "Guardar impresora"

**Expected UI:**
- Card actualizada: `TCP · 192.168.10.102:9101`
- El total de impresoras permanece en 4 (o el número actual)

**Expected state:**
```javascript
state.printers.find(p => p.printer_id === 'star-tsp100-barra').connection.port  // 9101
```

**Evidencia:** SS de la card con el puerto actualizado.

---

### N-15 — Formulario con IP inválida bloqueado

**Dimensión:** validación / host

**Preconditions:** Formulario de agregar/editar abierto con tipo TCP

**Steps:**
1. Click "+ Agregar impresora"
2. Nombre: `Impresora Inválida`, Tipo: TCP
3. Host: `999.0.0.1`
4. Puerto: `9100`
5. Click "Guardar impresora"

**Expected UI:**
- `#pfFormErrors` visible con mensaje que menciona el host inválido
- Formulario permanece abierto; no se agrega ninguna impresora
- `state.printers` sin cambio

**Expected filesystem:** sin cambios

**Evidencia:** SS del alert de error en el formulario.

---

### N-16 — Puerto 0 bloqueado

**Dimensión:** validación / puerto

**Preconditions:** Formulario abierto con tipo TCP

**Steps:**
1. Nombre: `Test Puerto Cero`, Tipo: TCP
2. Host: `192.168.10.100`, Puerto: `0`
3. Click "Guardar impresora"

**Expected UI:**
- Error en `#pfFormErrors` mencionando el puerto
- No se agrega la impresora

**Evidencia:** SS del error.

---

### N-17 — ID duplicado bloqueado

**Dimensión:** validación / duplicate ID

**Preconditions:** `epson-cocina-norte` ya existe en la lista

**Steps:**
1. Click "+ Agregar impresora"
2. Nombre: cualquier cosa
3. Editar manualmente el ID a `epson-cocina-norte` (el ID ya existente)
4. TCP válido
5. Click "Guardar impresora"

**Expected UI:**
- Error en `#pfFormErrors`: "El ID 'epson-cocina-norte' ya está en uso por otra impresora."
- No se agrega

**Expected filesystem:** sin cambios

**Evidencia:** SS del error de ID duplicado.

---

### N-18 — Eliminar impresora backup

**Dimensión:** baja / routing cleanup

**Preconditions:** `epson-barra-backup` en lista (del N-12)

**Steps:**
1. Click ✕ en la card de `Epson Barra Backup`
2. Confirmar el diálogo de confirmación

**Expected UI:**
- Card desaparece de la lista
- Routing table ya no incluye la fila duplicada de `Barra → Comanda cocina`
- Total vuelve a 3 impresoras

**Expected state:**
```javascript
state.printers.length  // 3
state.printers.find(p => p.printer_id === 'epson-barra-backup')  // undefined
```

**Evidencia:** SS de la lista con 3 cards; SS de routing table sin la fila extra.

---

### N-19 — Guardado atómico: click "Siguiente →"

**Dimensión:** atomic save / write-tmp-rename

**Preconditions:** 3 impresoras en lista (`epson-cocina-norte`, `star-tsp100-barra`, `ec-caja-norte`)

**Steps:**
1. Click "Siguiente →" en el panel de lista (no dentro del formulario)
2. Observar transición y consola

**Expected UI:**
- Botón cambia a "Guardando..." brevemente
- Wizard avanza a paso 6 (Verificación)
- Sin alert de error

**Expected filesystem — DURANTE el save (ventana de ~ms):**
- `{userData}/printers.json.tmp` puede existir brevemente

**Expected filesystem — DESPUÉS del save:**
- `{userData}/printers.json` existe
- `{userData}/printers.json.tmp` **no existe** (renameSync lo movió)

**Expected logs (main process):**
```
[provision] Printers saved to /Users/<user>/Library/Application Support/fullsite-pos/printers.json
```

**Expected IPC:**
```json
// provision:save-printers retorna:
{ "ok": true, "path": "{userData}/printers.json" }
```

**Expected JSON (`{userData}/printers.json`):**
```json
{
  "schema_version": 2,
  "printers": [
    {
      "printer_id": "epson-tm-t88-cocina",
      "name": "Epson TM-T88 Cocina",
      "enabled": true,
      "connection": { "type": "tcp", "host": "192.168.10.101", "port": 9100 },
      "station_ids": ["cocina"],
      "document_types": ["kitchen_ticket"],
      "copies": 1,
      "encoding": "cp850"
    },
    {
      "printer_id": "star-tsp100-barra",
      "name": "Star TSP100 Barra",
      "enabled": true,
      "connection": { "type": "tcp", "host": "192.168.10.102", "port": 9101 },
      "station_ids": ["barra"],
      "document_types": ["bar_ticket", "pre_ticket"],
      "copies": 1,
      "encoding": "cp850"
    },
    {
      "printer_id": "ec-caja-norte",
      "name": "EC PM-80 Caja",
      "enabled": true,
      "connection": { "type": "windows", "names": ["EC NORTE","EC01","TICKET"] },
      "station_ids": ["caja"],
      "document_types": ["receipt", "corte", "invoice"],
      "copies": 1,
      "encoding": "cp850"
    }
  ],
  "routing": {}
}
```

**Verificación adicional:**
```bash
# Validar con el schema:
node -e "
const s = require('./electron-app/local-server/adapters/printer-config-schema')
const c = JSON.parse(require('fs').readFileSync(
  require('os').homedir() + '/Library/Application Support/fullsite-pos/printers.json','utf8'))
console.log(s.validate(c))
"
# Debe imprimir: { valid: true, errors: [] }
```

**Evidencia:** FS antes y después; LOG de consola; contenido de printers.json.

---

### N-20 — Resumen final sin referencias a AMALAY

**Dimensión:** summary / multi-tenant isolation

**Preconditions:** Wizard en paso 7 (después de pasar paso 6 de verificación)

**Steps:**
1. Completar paso 6 (Verificación) — puede fallar la conexión al servidor, eso es esperado
2. Click "Siguiente →" cuando se habilite (aunque el servidor no responda)
3. Observar la tabla resumen en paso 7

**Expected UI — tabla resumen debe contener:**

| Campo | Valor |
|---|---|
| Restaurant ID | `norte-demo` |
| Terminal ID | `<uuid generado>` |
| Rol | `server_pos` |
| Nombre | `Caja Norte 01` |
| Servidor local | `192.168.10.50:7717` |
| Impresoras | `3 habilitada(s) de 3` |

**Expected UI — NO debe aparecer:**
- `amalay`
- `qjiomlvudfmzuvqvhwpk`
- cualquier IP de AMALAY (192.168.1.x del restaurante real)
- datos de Supabase

**Evidencia:** SS de la tabla de resumen completa; grep del printers.json para verificar aislamiento:
```bash
grep -i "amalay\|qjioml\|supabase" \
  ~/Library/Application\ Support/fullsite-pos/printers.json
# Debe retornar vacío
```

---

## Escenarios negativos adicionales

---

### N-21 — `printers.json` corrupto (JSON malformado)

**Dimensión:** carga / resiliencia ante archivo corrupto

**Preconditions:** Hay un `{userData}/printers.json` con contenido inválido

**Setup:**
```bash
echo '{"schema_version":2,"printers":[{MALFORMED' \
  > ~/Library/Application\ Support/fullsite-pos/printers.json
```

**Steps:**
1. Entrar al paso 5 del wizard

**Expected UI:**
- Alert naranja/warn: error al cargar configuración de impresoras (mensaje específico del parse error)
- La lista aparece vacía (empty state)
- El wizard **no crashea**; el usuario puede agregar impresoras manualmente

**Expected logs:**
```
[config] Printers: failed to parse printers.json: <SyntaxError>
```

**Expected IPC:**
```json
// provision:load-printers retorna:
{ "state": "not_configured", "config": null, "errors": ["SyntaxError: ..."] }
```

**Tipo:** MANUAL — requiere setup previo en filesystem

**Evidencia:** SS del alert de error; LOG del parse error.

---

### N-22 — Permisos de escritura denegados

**Dimensión:** guardado / filesystem permissions

**Preconditions:** userData existe pero es de solo lectura

**Setup (macOS):**
```bash
chmod 555 ~/Library/Application\ Support/fullsite-pos/
```

**Steps:**
1. Agregar una impresora
2. Click "Siguiente →" (intent de guardar)

**Expected UI:**
- Alert rojo en el panel de lista: "Error al guardar las impresoras: EACCES: permission denied..."
- Wizard **no avanza** al paso 6
- No se crea ni modifica ningún archivo

**Expected IPC:**
```json
{ "ok": false, "error": "EACCES: permission denied, mkdir '...'" }
```

**Expected filesystem:**
- `{userData}/printers.json` — no existe o sin cambios
- `{userData}/printers.json.tmp` — no existe (cleanup exitoso)

**Cleanup post-escenario:**
```bash
chmod 755 ~/Library/Application\ Support/fullsite-pos/
```

**Tipo:** MANUAL

**Evidencia:** SS del alert de error; LOG con el EACCES.

---

### N-23 — `rename()` falla (cross-device)

**Dimensión:** atomic save / rename failure

**Preconditions:** Esta es una condición difícil de reproducir en mismo filesystem.
Se puede simular apuntando `tmpPath` a un volumen distinto.

**Método alternativo de verificación:**
Inspeccionar el código en `main.js:394-416` y confirmar que:
1. El `catch` hace `unlinkSync(tmpPath)` si existe
2. Retorna `{ ok: false, error: e.message }`
3. El original `printers.json` no es tocado (el rename nunca ocurrió)

**Tipo:** CODE REVIEW (no requiere ejecución; verificado estáticamente en commit `9f13f91`)

**Expected behavior:**
- `{userData}/printers.json` queda intacto (o sin cambios si era la primera vez)
- `{userData}/printers.json.tmp` eliminado por el catch
- IPC retorna `{ ok: false, error: "..." }`

**Evidencia:** Referencia al código en `main.js:411-414`.

---

### N-24 — Disco lleno (simulado)

**Dimensión:** atomic save / ENOSPC

**Preconditions:** Difícil de simular en macOS sin herramientas adicionales.

**Método de verificación:** Code review de `main.js:401-415`.

El `writeFileSync(tmpPath, ...)` lanzará `ENOSPC`. El `catch` lo captura,
limpia el `.tmp` si existe, y retorna `{ ok: false, error: "ENOSPC: no space left..." }`.
El `printers.json` original no es tocado porque el `rename` nunca se ejecutó.

**Para simular en entornos de CI que soporten tmpfs:**
```bash
# Crear disco virtual de 1KB
hdiutil create -size 1k -fs HFS+ -volname TinyDisk /tmp/tinydisk.dmg
hdiutil attach /tmp/tinydisk.dmg
# Apuntar userData al volumen (requiere hack en la app)
```

**Tipo:** CODE REVIEW + CI (simulación en macOS requiere privilegios)

**Evidencia:** Referencia al código + descripción del comportamiento esperado.

---

### N-25 — Doble click rápido en "Guardar impresora"

**Dimensión:** UX / doble submit / race condition

**Preconditions:** Formulario de impresora abierto con datos válidos

**Steps:**
1. Completar el formulario con datos válidos
2. Hacer doble click rápido en "Guardar impresora"

**Expected UI:**
- Solo una impresora agregada (no duplicada)
- El formulario cierra normalmente

**Mecanismo de protección actual:** `pfSaveForm()` es síncrono — escribe en
`state.printers` y llama `pfShowList()`. No hay async entre el click y el write,
por lo que el doble click simplemente ejecuta dos veces `pfSaveForm()`.

**Comportamiento real esperado:** puede agregar la impresora DOS veces si los
dos clicks ocurren antes del re-render. El segundo save detectará ID duplicado
en el array — pero `pfValidate()` solo chequea duplicados en `state.printers`
en el momento de la validación; si el primer push ya ocurrió, el segundo fallará
con "ID ya en uso".

**Conclusión:** El primer click siempre gana; el segundo será bloqueado por el
check de ID duplicado. Sin embargo, si el usuario edita el ID antes del segundo
click, podría haber dos entradas. **Riesgo bajo.**

**Evidencia:** SS con el estado de `state.printers` después del doble click.

**Tipo:** MANUAL

---

### N-26 — Doble apertura del wizard

**Dimensión:** multi-instance / singleton window

**Preconditions:** Wizard ya abierto

**Steps:**
1. Intentar abrir una segunda instancia del wizard (desde `main.js` o desde menú si existe)

**Verificación:** Buscar en `main.js` si `setupWindow` es singleton:

```bash
grep -n "setupWindow\|BrowserWindow\|setup.*window\|singleton" electron-app/main.js | head -20
```

**Expected behavior:** `main.js` debe verificar si `setupWindow` ya existe y hacer
`focus()` en lugar de crear una segunda ventana. Si no hay protección, dos ventanas
podrían guardar configuraciones distintas en carrera.

**Tipo:** CODE REVIEW + MANUAL

**Evidencia:** Resultado del grep; comportamiento observado al intentar doble apertura.

---

### N-27 — `printer_id` extremadamente largo

**Dimensión:** validación / límites de ID

**Preconditions:** Formulario abierto

**Steps:**
1. Click "+ Agregar impresora"
2. En **ID lógico** escribir una cadena de 100 caracteres: `aaaa...aaaa`
3. Click "Guardar impresora"

**Expected UI:**
- El auto-slug trunca a 40 caracteres (`slugifyId` tiene `.slice(0, 40)`)
- Si el usuario escribe manualmente más de 40: el validador acepta cualquier longitud
  (no hay maxLength en el validador actual — esto es un **gap conocido**)

**Gap identificado:** `pfValidate()` en setup.html no limita la longitud del ID.
`printer-wizard-logic.js:validatePrinterForm()` tampoco. El schema `printer-config-schema.js`
podría no validarlo. Verificar:

```bash
node -e "
const s = require('./electron-app/local-server/adapters/printer-config-schema')
const c = { schema_version: 2, printers: [{
  printer_id: 'a'.repeat(100), name:'X', enabled:true,
  connection:{type:'tcp',host:'1.2.3.4',port:9100},
  station_ids:[], document_types:[], copies:1, encoding:'cp850'
}], routing:{} }
console.log(s.validate(c))
"
```

**Expected:** Si el schema acepta el ID largo, el sistema lo guarda sin error.
Documentar si es un comportamiento aceptable o si se necesita un límite.

**Tipo:** MANUAL + CÓDIGO

**Evidencia:** Resultado del comando node; SS de la UI.

---

### N-28 — Hostname IPv6

**Dimensión:** validación / IPv6

**Preconditions:** Formulario TCP abierto

**Steps:**
1. En **Host / IP** escribir `::1`
2. Click "Guardar impresora"

**Expected UI:**
- `pfIsValidHost('::1')` retorna `false` (la regex actual sólo valida IPv4 y hostnames DNS)
- Error de validación: "Host inválido"

**Verificación:**
```bash
node -e "
const {isValidHost} = require('./electron-app/local-server/adapters/printer-config-schema')
console.log('::1 =>', isValidHost('::1'))
console.log('2001:db8::1 =>', isValidHost('2001:db8::1'))
"
```

**Gap:** IPv6 no soportado actualmente. Documentar como limitación conocida de CFG-01.

**Tipo:** MANUAL + CÓDIGO

**Evidencia:** Output del comando; SS del error de validación.

---

### N-29 — Hostname con caracteres de inyección

**Dimensión:** validación / seguridad / input sanitization

**Preconditions:** Formulario TCP abierto

**Steps:**
1. En **Host / IP** probar cada uno de estos valores:
   - `192.168.1.1; rm -rf /`
   - `$(whoami)`
   - `<script>alert(1)</script>`
   - `../../../etc/passwd`
   - `192.168.1.1' OR '1'='1`

**Expected UI para cada uno:**
- `pfIsValidHost()` retorna `false`
- Error de validación visible
- El valor **nunca** llega al IPC `provision:test-printer` ni al filesystem

**Verificación adicional:** El host se pasa a `net.Socket.connect(port, host, ...)`.
Node.js no ejecuta el host como shell command — pero un hostname malicioso podría
causar DNS lookups indeseados. El `pfIsValidHost` valida antes del IPC.

**Tipo:** MANUAL

**Evidencia:** SS de los errores de validación para cada input.

---

### N-30 — Puerto 65536 (uno sobre el máximo)

**Dimensión:** validación / puerto límite

**Preconditions:** Formulario TCP abierto

**Steps:**
1. En **Puerto** escribir `65536`
2. Click "Guardar impresora"

**Expected UI:** Error de validación: "Puerto inválido (1–65535)"

**Verificación:** `pfValidate()` en setup.html: `!form.port || form.port < 1 || form.port > 65535`

**Tipo:** MANUAL

**Evidencia:** SS del error.

---

### N-31 — Archivo legacy `printers.json` v1 parcialmente válido

**Dimensión:** migración v1→v2 / resiliencia

**Preconditions:** `C:\fullsite\printers.json` existe (solo en Windows) con un v1 incompleto

**Setup (Windows):**
```json
// C:\fullsite\printers.json — v1 con campos faltantes
{
  "schema_version": 1,
  "printers": [
    { "id": "caja", "host": "192.168.1.10" }
  ]
}
```
*(Faltan: `name`, `connection.type`, `connection.port`, `station_ids`, `document_types`)*

**Steps:**
1. Entrar al paso 5 del wizard (en Windows con este archivo presente)

**Expected UI:**
- Banner de migración visible
- Si `fromV1()` puede migrar el registro parcial: se muestra con datos default (port: 9100, encoding: cp850)
- Si `fromV1()` falla en el registro incompleto: se muestra error y lista vacía

**Expected IPC:**
```json
// Si migración parcial funciona:
{ "state": "configured", "migrated": true, "config": { "schema_version": 2, ... } }
// Si migración falla:
{ "state": "not_configured", "errors": ["..."] }
```

**Tipo:** MANUAL (requiere Windows con el archivo legacy)

**Evidencia:** SS del banner de migración o del error; contenido del printers.json resultante.

---

### N-32 — Rollback después de save fallido

**Dimensión:** atomic save / integridad ante fallo

**Preconditions:** `{userData}/printers.json` existe con un contenido válido conocido (estado de N-19)

**Setup:**
1. Guardar el contenido actual de `printers.json` como referencia:
   ```bash
   cp ~/Library/Application\ Support/fullsite-pos/printers.json /tmp/printers-backup.json
   ```
2. En el formulario, agregar una impresora para que el save tenga un nuevo contenido
3. Inmediatamente antes de que `rename()` ocurra, simular un fallo (difícil sin code patch)

**Método alternativo — verificación estática:**
El handler en `main.js:394-416` sigue este orden:
```
1. validate() — si falla, retorna sin tocar disco
2. writeFileSync(tmp) — falla aquí → catch limpia tmp, original intacto
3. renameSync(tmp, configPath) — falla aquí → catch limpia tmp, original intacto
4. verify readFileSync() — falla aquí → ya se renombró (original sobreescrito)
```

**Gap identificado:** Si el paso 4 (verify) falla, el archivo ya fue renombrado.
El `printers.json` nuevo existe pero podría ser inválido. El handler retorna error,
pero el archivo corrupto quedó en disco. Documentar como gap de CFG-01.

**Tipo:** CODE REVIEW

**Evidencia:** Referencia al código `main.js:406-414`; descripción del gap.

---

## Matriz de cobertura

### Por escenario

| Escenario | Dimensión cubierta |
|---|---|
| N-01 | Onboarding — estado inicial sin config |
| N-02 | Identidad del restaurante — campo restaurant_id |
| N-03 | Validación — campo requerido vacío |
| N-04 | Onboarding — IP de servidor personalizada |
| N-05 | Empty state — PRINTER_NOT_CONFIGURED path |
| N-06 | Alta TCP — flujo completo |
| N-07 | UX — auto-slug / generación de ID |
| N-08 | Alta múltiple — segunda impresora TCP |
| N-09 | Alta Windows/USB — tipo de conexión alternativo |
| N-10 | Routing display — expansión de routing table |
| N-11 | Connection test — error TCP (host inalcanzable) |
| N-12 | Routing overlap — comportamiento permisivo |
| N-13 | Connection test — UNTESTABLE (Windows/USB) |
| N-14 | Edición — modificar impresora existente |
| N-15 | Validación — IP inválida en formulario |
| N-16 | Validación — puerto 0 |
| N-17 | Validación — ID duplicado |
| N-18 | Baja — eliminar impresora + routing cleanup |
| N-19 | Atomic save — write-tmp-rename-verify |
| N-20 | Multi-tenant isolation — sin referencias a AMALAY |
| N-21 | Resiliencia — printers.json corrupto en disco |
| N-22 | Resiliencia — permisos de escritura denegados |
| N-23 | Resiliencia — rename() falla |
| N-24 | Resiliencia — disco lleno (ENOSPC) |
| N-25 | UX — doble click en Guardar |
| N-26 | Multi-instance — doble apertura del wizard |
| N-27 | Validación — printer_id extremadamente largo |
| N-28 | Validación — hostname IPv6 (no soportado) |
| N-29 | Seguridad — hostname con caracteres de inyección |
| N-30 | Validación — puerto 65536 |
| N-31 | Migración v1→v2 — archivo legacy parcialmente válido |
| N-32 | Atomic save — rollback / integridad ante fallo en verify |

### Por componente del sistema

| Componente | Escenarios que lo validan | Cobertura |
|---|---|---|
| `setup.html` paso 5 — empty state | N-01, N-05 | ✅ |
| `setup.html` pasos 1-4 | N-01, N-02, N-03, N-04 | ✅ |
| `setup.html` paso 6 (verificación) | N-20 (parcial) | ⚠ parcial |
| `setup.html` paso 7 (resumen) | N-20 | ✅ |
| `pfStartAdd / pfSaveForm` | N-06, N-07, N-08, N-09, N-15, N-16, N-17, N-25 | ✅ |
| `pfStartEdit` | N-14 | ✅ |
| `pfDelete` | N-18 | ✅ |
| `pfTestConn` (TCP) | N-11 | ✅ |
| `pfTestConn` (Windows/USB) | N-13 | ✅ |
| `pfRenderRoutingTable` | N-10, N-12, N-18 | ✅ |
| `pfAutoId / pfSlugify` | N-07 | ✅ |
| `pfValidate` (host) | N-15, N-28, N-29 | ✅ |
| `pfValidate` (puerto) | N-16, N-30 | ✅ |
| `pfValidate` (ID duplicado) | N-17 | ✅ |
| `pfValidate` (ID longitud) | N-27 | ⚠ gap |
| `pfProceed` (PRINTER_NOT_CONFIGURED) | N-05 → N-19 path alternativo | ✅ |
| `provision:load-printers` IPC | N-05, N-21, N-31 | ✅ |
| `provision:save-printers` IPC | N-19, N-22, N-23, N-24, N-32 | ✅ |
| `provision:test-printer` IPC | N-11, N-13, N-28, N-29 | ✅ |
| `provision:import-printers` IPC | N-05 (botón visible) | ⚠ no ejercido |
| Atomic save — write + rename | N-19 | ✅ |
| Atomic save — cleanup on failure | N-22, N-23, N-24, N-32 | ✅ code review |
| v1→v2 migration | N-31 | ⚠ Windows only |
| Multi-tenant isolation | N-20 | ✅ |
| IPv6 (no soportado) | N-28 | ✅ gap documentado |
| Singleton window | N-26 | ⚠ code review |

### Gaps no cubiertos por este protocolo

| Gap | Razón | Acción recomendada |
|---|---|---|
| `provision:import-printers` flujo completo | Requiere archivo de respaldo pre-creado | Agregar N-33 en v2 del protocolo |
| `printer_id` con longitud máxima | Schema no limita hoy | Añadir validación o documentar límite |
| IPv6 | No soportado en `isValidHost` | Documentar como limitación de CFG-01 |
| Verify-after-rename falla | El archivo nuevo quedó con contenido potencialmente inválido | Fix: guardar backup antes de rename |
| Doble apertura del wizard | Depende de impl. de setupWindow en main.js | Code review N-26 |
| Paso 6 de verificación con servidor caído | Solo cobertura parcial en N-20 | Agregar escenario dedicado |
| Encoding no-cp850 | No ejercido | Bajo riesgo; postergado |

---

## Criterios PASS / FAIL globales

### PASS si:

- N-01 a N-10, N-13 a N-15, N-16 a N-20 pasan todos (core flows)
- `{userData}/printers.json` generado en N-19 valida con `printer-config-schema.js` sin errores
- Ningún archivo generado contiene referencias a `amalay`, `qjiomlvudfmzuvqvhwpk`, o IPs de AMALAY
- N-21, N-22, N-29, N-30 pasan (resiliencia básica)
- Ningún escenario provoca crash del proceso Electron principal
- Ningún escenario deja `printers.json.tmp` huérfano en disco

### FAIL si:

- Cualquiera de N-06, N-09, N-19, N-20 falla (flujos críticos)
- El wizard crashea en algún escenario (incluyendo negativos)
- `printers.json` escrito contiene `schema_version` ≠ 2
- `printers.json` contiene referencias a AMALAY
- El formulario agrega impresoras duplicadas (N-25)
- Algún input de inyección (N-29) llega al IPC o al filesystem sin ser rechazado
- `printers.json.tmp` queda en disco después de N-22, N-23, o N-24

### PENDIENTE (documentar, no bloquea PASS):

- N-23, N-24, N-32 (difíciles de reproducir sin entorno especial)
- N-26 (depende de singleton impl.)
- N-27, N-28, N-31 (gaps documentados)

---

## Cleanup

Ejecutar después de terminar todos los escenarios:

```bash
# macOS
rm -f ~/Library/Application\ Support/fullsite-pos/printers.json
rm -f ~/Library/Application\ Support/fullsite-pos/printers.json.tmp
rm -f ~/Library/Application\ Support/fullsite-pos/config.json

# Verificar que no quedan archivos del protocolo:
ls ~/Library/Application\ Support/fullsite-pos/
# Expected: directorio vacío o inexistente

# Restaurar permisos si se ejecutó N-22:
chmod 755 ~/Library/Application\ Support/fullsite-pos/ 2>/dev/null || true

# Windows
del "%APPDATA%\fullsite-pos\printers.json"
del "%APPDATA%\fullsite-pos\printers.json.tmp"
del "%APPDATA%\fullsite-pos\config.json"
```

---

## Registro de ejecución

| # | Fecha | Ejecutado por | Resultado | Notas |
|---|---|---|---|---|
| — | — | — | — | Pendiente de primera ejecución |

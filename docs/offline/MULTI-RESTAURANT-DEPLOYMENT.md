# Fullsite Offline — Deployment Multi-Restaurante

> Versión: 1.0 — 2026-07-27
>
> **Principio rector de este documento:** Fullsite Offline es un producto, no una
> instalación de AMALAY. El mismo código, el mismo instalador, el mismo Local Server
> funcionan en cualquier restaurante. Lo único que cambia es la configuración.
> AMALAY es la instalación de referencia — no el caso especial.

---

## Índice

0. [Tres capas que nunca deben mezclarse](#0-tres-capas-que-nunca-deben-mezclarse)
1. [El contrato del producto](#1-el-contrato-del-producto)
2. [Schema de configuración](#2-schema-de-configuración)
3. [Template de configuración genérico](#3-template-de-configuración-genérico)
4. [Wizard de provisioning](#4-wizard-de-provisioning)
5. [Proceso de instalación](#5-proceso-de-instalación)
6. [Preload de datos](#6-preload-de-datos)
7. [Validación antes del go-live](#7-validación-antes-del-go-live)
8. [Operación offline](#8-operación-offline)
9. [Recovery ante reinicios](#9-recovery-ante-reinicios)
10. [Sync-back cuando vuelve internet](#10-sync-back-cuando-vuelve-internet)
11. [Agregar terminales nuevas](#11-agregar-terminales-nuevas)
12. [Checklist de go-live](#12-checklist-de-go-live)

---

## 0. Tres capas que nunca deben mezclarse

Para que Fullsite funcione con cualquier restaurante sin cambiar código, las tres capas del sistema
deben estar claramente separadas. Confundirlas produce instalaciones que son difíciles de reproducir,
de actualizar y de soportar.

### Capa 1 — Producto (universal, sin tocar por instalación)

Lo que Fullsite distribuye. Nunca cambia de un cliente a otro.

| Componente | Dónde vive |
|---|---|
| Código fuente (Next.js + Node.js + Electron) | Repositorio git |
| Instalador compilado (`.exe`) | Distribución Electron (Squirrel/NSIS) |
| Schema de configuración (`config-schema.js`) | Incluido en el instalador |
| Schema de impresoras (`printers-schema.js`, pendiente) | Incluido en el instalador |
| Wizard de provisioning | Incluido en el instalador |
| Validadores de config en arranque | Incluido en el instalador |
| Tests automatizados | CI/CD |
| Migraciones de schema (cuando el schema evoluciona) | `fromLegacy()` en config-schema.js |
| Diagnósticos y health check | Local Server /health + /identity |

**Regla:** si algo de esta capa cambia entre un cliente y otro, es un bug de configuración.

### Capa 2 — Deployment del cliente (específico por sucursal, declarativo)

Lo que cambia de un restaurante a otro. Generado por el wizard, nunca escrito a mano en producción.

| Dato | Dónde vive |
|---|---|
| `restaurant_id` (UUID) | Supabase + `config.json` |
| `branch_id` (UUID, future) | Supabase + `config.json` (pendiente) |
| `terminal_id` (UUID por máquina) | `config.json` (generado por wizard) |
| `terminal_name` (nombre humano) | `config.json` |
| `terminal_role` | `config.json` |
| `local_server_host` / `local_server_port` | `config.json` |
| `pos_server_ip` (para terminales KDS/POS adicionales) | `config.json` |
| IPs de impresoras | `printers.json` |
| Nombres de impresoras USB | `printers.json` |
| Estaciones de impresión (cocina, barra, caja...) | `printers.json` |
| Canal de actualización (`stable` / `pilot`) | `config.json` |

**Regla:** estos valores son específicos de la sucursal, pero su formato y schema son
universales (misma Capa 1). El wizard genera los archivos; el instalador los valida.

### Capa 3 — Datos operativos (gestionados en Supabase, no en config)

Lo que el restaurante configura en el sistema, no el técnico de instalación.

| Dato | Dónde vive |
|---|---|
| Menú (categorías, productos, precios) | Supabase |
| Modificadores y grupos de modificadores | Supabase |
| Staff y PINs | Supabase |
| Mesas y mapa de mesas | Supabase |
| Métodos de pago | Supabase |
| Recetas e ingredientes | Supabase |
| Inventario inicial | Supabase |
| Permisos por rol | Supabase |

**Regla:** estos datos nunca van en `config.json` ni en `printers.json`. Si alguien propone
meterlos ahí, es señal de que falta una pantalla de configuración en el dashboard, o que el
prefetch offline no está cubriendo ese dato.

### El contrato del instalador

```
un mismo schema (Capa 1)
+ wizard que genera config por sucursal (Capa 2)
+ datos cargados en Supabase (Capa 3)
+ mismo .exe para todos los clientes
= instalación offline reproducible para cualquier restaurante
```

El archivo `config.json` es declarativo y específico de la sucursal, pero el contrato
(schema, validaciones, wizard) es universal. No se copia el mismo `config.json` de AMALAY a
todos los clientes — se usa el mismo wizard para generar una config válida para cada uno.

---

## 1. El contrato del producto

Fullsite Offline cumple estos requisitos para cualquier restaurante, sin excepción:

| Requisito | Garantía | Implementación |
|---|---|---|
| Operar sin internet durante un turno completo | Un restaurante debe poder tomar órdenes, enviarlas a cocina, imprimir comandas y registrar pagos en efectivo, independientemente de si hay internet | Service Worker + IDB + Local Server |
| Sin código específico por restaurante | Ningún archivo de código contiene el nombre, UUID, IP, menú, ni config de un restaurante en particular | Toda la config va en `config.json` y `printers.json` |
| Sin forks | El mismo binario `.exe` se instala en todos los restaurantes | Un solo instalador de Electron con `oneClick: true` |
| Provisioning sin programadores | Un instalador no-técnico puede dar de alta un restaurante con el wizard; no necesita saber de Node.js ni de Electron | Wizard CLI incluido en el instalador |
| Recovery automático | Si el restaurante pierde luz, reinicia el servidor, o pierde internet, recupera exactamente el estado anterior sin intervención manual | Replay del event log + Service Worker cache + IDB |
| Multi-terminal desde el primer día | Múltiples POS y KDS en la misma LAN, coordinados por el Local Server | WS hub + MESA_LOCK + broadcast de DELTAs |

**Regla que no tiene excepciones:**
```
Si necesitas cambiar código para instalar Fullsite en un restaurante nuevo,
el producto tiene un bug de configuración — no importa si "funciona".
```

---

## 2. Schema de configuración

Todo lo que diferencia una instalación de otra está declarado en dos archivos JSON.

### 2.1 `config.json` — Configuración del servidor principal (SERVER1)

```json
{
  "config_version": 1,
  "restaurant_id": "UUID-DEL-RESTAURANTE",
  "terminal_id": "UUID-UNICO-DE-ESTA-TERMINAL",
  "terminal_role": "server_pos",
  "terminal_name": "Caja Principal",
  "local_server_host": "127.0.0.1",
  "local_server_port": 7717,
  "protocol_version": "1.0",
  "provisioned_at": "2026-01-01T00:00:00.000Z",
  "channel": "stable",
  "instance_name": "Restaurante — Sucursal Principal",
  "kds": false,
  "kds_only": false
}
```

**Campos obligatorios:**

| Campo | Tipo | Descripción | Quién lo genera |
|---|---|---|---|
| `config_version` | number | Siempre `1` hoy. Incrementar cuando cambie el schema | Constante |
| `restaurant_id` | UUID | Identifica al restaurante en Supabase y en el event log | Admin Fullsite al crear el cliente |
| `terminal_id` | UUID | Identifica esta terminal física. Único por máquina | Wizard (genera automáticamente) |
| `terminal_role` | string | `server_pos` / `pos` / `kds` / `admin` | Wizard |
| `terminal_name` | string | Nombre humano para logs y soporte | Instalador |
| `local_server_host` | string | `127.0.0.1` para SERVER1; IP LAN para terminales secundarias | Wizard |
| `local_server_port` | number | `7717` (cambiar solo si hay conflicto de puerto) | Default |
| `protocol_version` | string | `1.0` | Constante |
| `provisioned_at` | ISO 8601 | Timestamp de instalación. Nunca se modifica después | Wizard |

**Campos opcionales:**

| Campo | Tipo | Descripción |
|---|---|---|
| `channel` | string | `stable` / `pilot` / `development`. Determina qué updates recibe |
| `instance_name` | string | Nombre del servidor para mDNS discovery |
| `kds` | boolean | `true` → abre ventana KDS en segundo monitor |
| `kds_only` | boolean | `true` → omite ventana POS, solo KDS |
| `pos_server_ip` | string | IP del SERVER1 (para terminales `kds_only`) |

### 2.2 `printers.json` — Configuración de hardware de impresión

```json
{
  "stations": {
    "cocina": {
      "type": "tcp",
      "host": "192.168.X.X",
      "port": 9100,
      "name": "Impresora Cocina"
    },
    "barra": {
      "type": "tcp",
      "host": "192.168.X.X",
      "port": 9100,
      "name": "Impresora Barra"
    },
    "caja": {
      "type": "usb",
      "names": ["TICKET", "EC01"],
      "name": "Impresora Caja"
    }
  }
}
```

**Tipos soportados:**

| Tipo | Cuándo usarlo | Campos requeridos |
|---|---|---|
| `tcp` | Impresora en red con IP fija | `host`, `port` (default 9100) |
| `usb` | Impresora USB conectada directamente a SERVER1 | `names` (lista de nombres como aparece en Windows) |

**Restaurante sin barra:** omitir el key `barra`. El sistema no asignará comandas a esa estación.

**Restaurante con panadería:** agregar `"panaderia": { ... }` con el mismo formato.

### 2.3 Qué NO va en la config

Estos valores nunca se escriben en `config.json` o `printers.json`:

- `supabaseUrl` / `supabaseAnonKey` — van como variables de entorno o en el instalador empaquetado
- Menú, categorías, precios, modificadores — vienen de Supabase al sincronizar
- Lista de meseros, PINs — vienen de Supabase al sincronizar
- Recetas, ingredientes, inventario — vienen de Supabase
- Reglas de impresión por grupo de platillo — vienen de Supabase

Si alguien sugiere poner datos de negocio en `config.json`, esa es la señal de que algo
falta en el schema de Supabase o en el módulo de prefetch.

---

## 3. Template de configuración genérico

Copiar este template para cada instalación nueva. Reemplazar los valores en mayúsculas.

### Archivo `C:\fullsite\config.json`

```json
{
  "config_version": 1,
  "restaurant_id": "RESTAURANT_UUID",
  "terminal_id": "TERMINAL_UUID",
  "terminal_role": "server_pos",
  "terminal_name": "NOMBRE_DEL_TERMINAL",
  "local_server_host": "127.0.0.1",
  "local_server_port": 7717,
  "protocol_version": "1.0",
  "provisioned_at": "FECHA_ISO8601",
  "channel": "stable",
  "instance_name": "NOMBRE_DEL_RESTAURANTE",
  "kds": false,
  "kds_only": false
}
```

### Archivo `C:\fullsite\printers.json`

```json
{
  "stations": {
    "cocina": {
      "type": "tcp",
      "host": "IP_IMPRESORA_COCINA",
      "port": 9100,
      "name": "Cocina"
    },
    "caja": {
      "type": "usb",
      "names": ["NOMBRE_IMPRESORA_EN_WINDOWS"],
      "name": "Caja"
    }
  }
}
```

*Para restaurantes sin barra: eliminar la sección `barra`. Para restaurantes con múltiples
estaciones de cocina: agregar `cocina2`, `cocina3`, etc.*

### Generar UUIDs

En PowerShell (disponible en Windows 10/11 sin instalación):

```powershell
# Para restaurant_id — generado por el admin de Fullsite al crear el cliente en Supabase
# Para terminal_id — generado en cada máquina
[System.Guid]::NewGuid().ToString()

# Para provisioned_at
(Get-Date -Format "o")
```

---

## 4. Wizard de provisioning

El wizard elimina la posibilidad de error manual en los UUIDs y las fechas.

### 4.1 Cómo invocar el wizard

En la primera instalación, cuando no existe `C:\fullsite\config.json`, el Electron muestra
automáticamente la pantalla de provisioning antes de intentar cargar el POS.

También puede invocarse manualmente:

```batch
REM Desde la terminal de Windows, en el directorio del ejecutable
"Fullsite POS.exe" --provision
```

### 4.2 Flujo del wizard

```
PANTALLA 1 — Identificación del restaurante
  ┌─────────────────────────────────────────────┐
  │  Código de restaurante                      │
  │  ┌─────────────────────────────────────┐   │
  │  │ RESTAURANT_CODE                     │   │
  │  └─────────────────────────────────────┘   │
  │                                             │
  │  Ingresa el código que te proporcionó       │
  │  el equipo de Fullsite. Ejemplo: FST-0042   │
  │                                             │
  │  [Siguiente →]                              │
  └─────────────────────────────────────────────┘
  
  → El wizard consulta Supabase con el código
  → Obtiene: restaurant_id, restaurant_name, supabaseUrl, supabaseAnonKey
  → Si no hay internet: pide entrada manual del restaurant_id (UUID)

PANTALLA 2 — Tipo de terminal
  ┌─────────────────────────────────────────────┐
  │  ¿Qué hace esta máquina?                   │
  │                                             │
  │  ○ Caja principal (POS + servidor)          │
  │    Esta máquina corre el Local Server       │
  │                                             │
  │  ○ Terminal adicional (POS)                 │
  │    Se conecta a la caja principal           │
  │                                             │
  │  ○ KDS dedicado (cocina/barra)              │
  │    Solo muestra órdenes para cocina         │
  │                                             │
  │  [← Atrás]  [Siguiente →]                  │
  └─────────────────────────────────────────────┘

PANTALLA 3 — Nombre del terminal
  ┌─────────────────────────────────────────────┐
  │  Nombre de este terminal                    │
  │  ┌─────────────────────────────────────┐   │
  │  │ Caja Principal                      │   │
  │  └─────────────────────────────────────┘   │
  │                                             │
  │  Aparece en los logs y en soporte.          │
  │  Ej: "Caja Principal", "Bar", "KDS Cocina" │
  │                                             │
  │  [← Atrás]  [Siguiente →]                  │
  └─────────────────────────────────────────────┘

PANTALLA 4 — IP del servidor (solo si es terminal adicional o KDS)
  ┌─────────────────────────────────────────────┐
  │  IP de la caja principal                    │
  │  ┌─────────────────────────────────────┐   │
  │  │ 192.168.1.71                        │   │
  │  └─────────────────────────────────────┘   │
  │                                             │
  │  Puedes encontrarla en la caja principal:   │
  │  http://127.0.0.1:7717/health → lan_ip     │
  │                                             │
  │  [← Atrás]  [Siguiente →]                  │
  └─────────────────────────────────────────────┘

PANTALLA 5 — KDS en segundo monitor (solo si es caja principal)
  ┌─────────────────────────────────────────────┐
  │  ¿Hay un segundo monitor conectado?         │
  │                                             │
  │  ○ Sí — abrir KDS en el segundo monitor     │
  │  ○ No — solo ventana POS                    │
  │                                             │
  │  [← Atrás]  [Siguiente →]                  │
  └─────────────────────────────────────────────┘

PANTALLA 6 — Resumen y confirmación
  ┌─────────────────────────────────────────────┐
  │  Configuración lista                        │
  │                                             │
  │  Restaurante:  NOMBRE DEL RESTAURANTE       │
  │  Terminal:     Caja Principal               │
  │  Rol:          Caja + servidor              │
  │  ID terminal:  a1b2c3d4-...                 │
  │  Servidor:     127.0.0.1:7717               │
  │  KDS:          No (sin segundo monitor)     │
  │                                             │
  │  Esta configuración se guardará en:         │
  │  C:\fullsite\config.json                    │
  │                                             │
  │  [← Atrás]  [Instalar y abrir POS]         │
  └─────────────────────────────────────────────┘
```

### 4.3 Qué genera el wizard

Al confirmar, el wizard:
1. Genera un UUID único para `terminal_id` (`crypto.randomUUID()`)
2. Escribe `C:\fullsite\config.json` con todos los campos
3. Valida el archivo generado con `config-schema.js`
4. Si la validación falla, muestra los errores y no avanza
5. Reinicia el proceso Electron con la nueva config

Si el wizard no puede alcanzar Supabase para obtener el `restaurant_id`, permite ingresarlo
manualmente (UUID). El resto del flow es idéntico.

---

## 5. Proceso de instalación

### Roles: quién hace qué

| Persona | Responsabilidad |
|---|---|
| Admin Fullsite | Crea el restaurante en Supabase (genera `restaurant_id`), configura el menú, crea usuarios |
| Instalador (técnico o gerente) | Ejecuta el wizard en cada máquina, configura impresoras, conecta hardware |
| Verificador (puede ser el mismo instalador) | Ejecuta el checklist del §7 |

### Paso 1 — Prerrequisitos de red

Antes de tocar ningún hardware:

```
☐ Las impresoras tienen IP fija (configuradas en el router o en la impresora misma)
☐ Las IPs de las impresoras están documentadas (anota aquí):
   cocina:  192.168.___._____
   barra:   192.168.___._____
   caja:    USB (nombre en Windows: _______________)

☐ SERVER1 tiene IP fija o reservada en el router: 192.168.___._____
☐ Puerto 7717 no está bloqueado por el firewall corporativo (si lo hay)
☐ Hay acceso al router para verificar la LAN (NO necesario para instalar)
```

### Paso 2 — Prerrequisitos de Supabase (Admin Fullsite)

El admin de Fullsite debe completar esto antes de la visita de instalación:

```
☐ Restaurante creado en Supabase con client_id único
☐ Menú cargado (categorías, productos, precios)
☐ Modificadores cargados
☐ Staff cargado con PINs
☐ Código de restaurante entregado al instalador (ej: FST-0042)
```

El código de restaurante es el único dato que el instalador necesita. Con ese código,
el wizard obtiene todo lo demás de Supabase.

### Paso 3 — Instalar en SERVER1 (caja principal)

```batch
REM 1. Copiar el instalador
REM    Fullsite POS Setup X.X.X.exe

REM 2. Ejecutar como Administrador (clic derecho → "Ejecutar como administrador")
REM    La instalación es oneClick: sin pantallas adicionales.
REM    Tiempo: ~2 minutos.

REM 3. El wizard de provisioning aparece automáticamente.
REM    Completar las 6 pantallas del §4.2
```

### Paso 4 — Crear printers.json

Después del wizard, crear `C:\fullsite\printers.json` con las IPs reales:

```json
{
  "stations": {
    "cocina": {
      "type": "tcp",
      "host": "192.168.X.X",
      "port": 9100,
      "name": "Cocina"
    },
    "barra": {
      "type": "tcp",
      "host": "192.168.X.X",
      "port": 9100,
      "name": "Barra"
    },
    "caja": {
      "type": "usb",
      "names": ["TICKET", "EC01"],
      "name": "Caja"
    }
  }
}
```

Para saber el nombre exacto de la impresora USB:
`Panel de Control → Dispositivos e Impresoras` — el nombre que aparece ahí es el que va en `names`.

### Paso 5 — Primer arranque con internet (CRÍTICO)

Este paso activa el Service Worker y cachea todas las páginas para el modo offline.
**Sin este paso, el POS no funciona offline.**

```
☐ SERVER1 tiene internet disponible
☐ Abrir Fullsite POS
☐ Login con PIN → verificar que el menú es correcto
☐ Navegar a /pos/plano (mapa de mesas)
☐ Navegar a /pos/kds (aunque sea 10 segundos)
☐ Navegar a /pos/cocina y /pos/barra
☐ Dejar el POS abierto 3-5 minutos (el SW completa el precache en segundo plano)
☐ Abrir Chrome DevTools (F12) → Application → Cache Storage →
  verificar que existe "fullsite-static-v6" con entradas
```

El primer arranque online también ejecuta `prefetchOfflineData()` que cachea en IDB:
- Menú completo con imágenes
- Modificadores y grupos de modificadores
- Métodos de pago
- Staff con PINs (TTL 8h)
- Órdenes activas

### Paso 6 — Instalar terminales adicionales (si aplica)

**Para POS secundario en otra máquina:**

Instalar el mismo `Fullsite POS Setup X.X.X.exe`. En el wizard:
- Seleccionar "Terminal adicional (POS)"
- Código de restaurante: el mismo del SERVER1
- IP del servidor: la IP LAN de SERVER1 (ej. 192.168.1.71)

El wizard genera un `terminal_id` diferente automáticamente. El mismo `restaurant_id`.

**Para KDS en máquina dedicada:**

Instalar el mismo instalador. En el wizard:
- Seleccionar "KDS dedicado"
- IP del servidor: IP LAN de SERVER1

El wizard pone `kds_only: true` en config.json. Electron abre directamente la vista KDS.

**⚠️ NO usar Chrome con `https://app.fullsite.mx/pos/kds` para el KDS.** Una página `https`
NO puede leer una IP LAN por `http` (muro mixed-content / Private Network Access de Chromium) →
el KDS se queda en 0 órdenes offline. Es la **regla dura #1** de `OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`.

**El KDS correcto es el build dedicado (Electron, `kds_only: true`)**, que carga
`http://127.0.0.1:7717/kds` servido por su propio Pedro local (una página `http` sí puede leer
`http://<caja>:7717/state` por la LAN). Funciona offline, incluso en frío. Ver `main.js` (kds_only)
y `local-server/index.js` (`GET /kds`).

---

## 6. Preload de datos

El preload garantiza que el restaurante puede operar offline desde el primer turno.

### ¿Qué se preload automaticamente?

Al iniciar sesión con internet, `prefetchOfflineData()` hace esto en segundo plano:

| Dato | IDB Store | Cuándo se actualiza |
|---|---|---|
| Categorías y productos del menú | `menu` | Cada inicio de sesión online |
| Grupos de modificadores | `modifier_groups` | Cada inicio de sesión online |
| Modificadores individuales | `modifiers` | Cada inicio de sesión online |
| Relaciones ítem-modificador | `item_modifier_links` | Cada inicio de sesión online |
| Métodos de pago | `payment_methods` | Cada inicio de sesión online |
| Staff y PINs | `staff` | Cada inicio de sesión online (TTL 8h) |
| Órdenes activas | `orders` | Cada WS DELTA recibido + al conectar |

El Service Worker cachea adicionalmente:
- HTML de todas las rutas POS (`/pos`, `/pos/plano`, `/pos/kds`, `/pos/cocina`, etc.)
- Todos los chunks JS/CSS de Next.js (crítico para arranque offline en Electron)

### ¿Qué NO se preload?

| Dato | Razón | Cómo acceder offline |
|---|---|---|
| Inventario (ingredientes, existencias) | Volumen demasiado alto para IDB en Phase 1 | No disponible offline (Phase 2) |
| Historial de órdenes (más de 24h) | No necesario para operación del turno | No disponible offline |
| Reportes y analytics | Requieren Supabase y BI | No disponible offline por diseño |
| Fotos de platillos (alta resolución) | Cache del browser las tiene si se visitaron online | Disponibles si el browser las cacheó |

### Forzar un preload completo manualmente

Si hay dudas de que el IDB esté completo (p.ej., primer arranque en un restaurante nuevo):

1. Con internet disponible, abrir el POS
2. Iniciar sesión con un PIN válido
3. El `prefetchOfflineData()` corre automáticamente
4. Verificar en DevTools → Application → IndexedDB → `fullsite-pos-v2`:
   - `menu` tiene filas
   - `modifier_groups` tiene filas
   - `staff` tiene filas

Si algún store está vacío, puede deberse a un error de permisos en Supabase (RLS no configurada para este `restaurant_id`). Revisar con el admin de Fullsite.

---

## 7. Validación antes del go-live

Ejecutar este checklist en orden antes de que el restaurante empiece a operar con Fullsite.
Todos los casos deben ser PASS.

### Bloque 1 — Conectividad básica (con internet)

```
☐ V-01  http://127.0.0.1:7717/health retorna JSON con ok:true
         lan_ip muestra la IP correcta de SERVER1
         Anotar la IP: 192.168.___.___

☐ V-02  El menú del restaurante aparece correctamente en el POS
         (categorías correctas, precios correctos, modificadores funcionan)

☐ V-03  Login con PIN de mesero funciona (< 3 segundos)

☐ V-04  Login con PIN incorrecto (3 intentos) → bloqueo temporal visible

☐ V-05  Abrir turno → turno queda activo y visible
```

### Bloque 2 — Hardware (con internet)

```
☐ V-06  Enviar comanda de prueba → impresora de cocina imprime físicamente
         Verificar: mesa, ítems, cantidades correctas en el papel

☐ V-07  Enviar comanda de barra → impresora de barra imprime (si aplica)

☐ V-08  Cerrar cuenta de prueba → impresora de caja imprime ticket al cliente
         Verificar: total correcto, métodos de pago correctos

☐ V-09  Abrir cajón de dinero → cajón abre físicamente

☐ V-10  http://127.0.0.1:7717/test retorna {"ok":true} para todas las estaciones
```

### Bloque 3 — KDS (con internet)

```
☐ V-11  KDS muestra órdenes activas

☐ V-12  Enviar orden desde POS → aparece en KDS en < 2 segundos (sin recargar)

☐ V-13  Marcar ítem como listo en KDS → estado cambia en KDS
```

### Bloque 4 — Multi-terminal (si hay terminales adicionales)

```
☐ V-14  Abrir mesa desde Terminal 1 → mesa aparece ocupada en Terminal 2 (en tiempo real)

☐ V-15  Enviar orden desde Terminal 1 → KDS la recibe

☐ V-16  Intentar abrir la misma mesa desde Terminal 2 → bloqueado / muestra ocupada
```

### Bloque 5 — Offline (CRÍTICO — sin internet)

**Cómo aislar internet sin afectar LAN:**
```batch
REM Opción A: desconectar el cable WAN del router
REM Verificar: ping 192.168.1.68 responde, ping 8.8.8.8 falla

REM Opción B: bloquear con Windows Firewall (desde CMD como Administrador)
netsh advfirewall firewall add rule name="OFFLINE-TEST" dir=out action=block remoteip=0.0.0.0/0 remoteport=443,80
REM Para revertir:
netsh advfirewall firewall delete rule name="OFFLINE-TEST"
```

```
☐ V-17  Desconectar internet. El POS que estaba abierto sigue mostrando el menú
         (sin loaders, sin mensajes de error, sin pantalla en blanco)

☐ V-18  Login con PIN sin internet → funciona (TTL 8h desde última validación online)

☐ V-19  Agregar productos al carrito → funcionan normalmente

☐ V-20  Enviar comanda a cocina sin internet → impresora de cocina imprime

☐ V-21  KDS recibe la orden sin internet (vía WS LAN)

☐ V-22  http://127.0.0.1:7717/health sigue respondiendo sin internet
         Anotar sync_queue_pending después de enviar la orden: ___

☐ V-23  Reconectar internet → sync_queue_pending baja a 0 en < 60 segundos
         La orden aparece en Supabase
```

### Bloque 6 — Recovery ante reinicio

```
☐ V-24  Cerrar Fullsite (Ctrl+Shift+Q) → volver a abrir
         El estado de las mesas se recupera correctamente

☐ V-25  Reiniciar Windows → Fullsite abre automáticamente al login
         El turno sigue activo, mesas en el mismo estado
```

### Criterio de go-live

```
V-01 a V-25: todos PASS → ✓ Restaurante listo para operar

Si algún caso falla:
- FAIL en V-01 a V-10: problema de configuración o hardware — resolver antes de go-live
- FAIL en V-11 a V-13: problema de KDS — resolver antes de go-live si el restaurante usa KDS
- FAIL en V-17 a V-23: problema crítico de offline — resolver SIEMPRE antes de go-live
- FAIL en V-24 a V-25: riesgo de pérdida de estado — resolver antes de go-live
```

---

## 8. Operación offline

> **Precisión de términos:** "sin internet" = sin acceso a la nube (Supabase, Vercel, etc.) mientras
> la red local (LAN) sigue activa. "Sin LAN" = una terminal aislada del Local Server, lo que impide
> la coordinación multi-terminal y la impresión. No son equivalentes.
>
> | Estado de red | POS toma órdenes | KDS recibe en tiempo real | Impresión | Supabase |
> |---|---|---|---|---|
> | Internet + LAN activos | ✓ | ✓ | ✓ | ✓ |
> | Sin internet, LAN activa | ✓ | ✓ (WS LAN) | ✓ (Local Server) | ✗ |
> | LAN caída, Local Server inalcanzable | ✓ (IDB local) | ✗ | ✗ | ✗ (si hay internet) |
> | Sin internet, sin LAN | ✓ (IDB local) | ✗ | ✗ | ✗ |

### ¿Qué funciona sin internet?

| Operación | Sin internet | Notas |
|---|---|---|
| Abrir mesa | ✓ | Desde estado en memoria del Local Server |
| Seleccionar mesero con PIN | ✓ | Cache IDB, TTL 8h |
| Ver menú y agregar productos | ✓ | Cache IDB |
| Ver y agregar modificadores | ✓ | Cache IDB |
| Enviar comanda a cocina | ✓ | Local Server → impresora TCP/USB |
| KDS recibe y muestra orden | ✓ | WS LAN |
| Cobrar en efectivo | Parcial | Efectivo OK; cierre formal pendiente Phase 2 |
| Cobrar con tarjeta | Depende de terminal | Terminal bancaria tiene conectividad propia |
| Abrir cajón de dinero | ✓ | Local Server → impulso ESC/POS |
| Reimprimir comanda | ✓ | Local Server tiene el evento |
| Abrir turno | ✗ | Requiere Supabase (Phase 2) |
| Cerrar turno | ✗ | Requiere Supabase (Phase 2) |
| Ver historial de ventas | ✗ | Dashboard requiere Supabase |
| Editar menú | ✗ | Requiere Supabase siempre |
| Cambiar PINs | ✗ | Requiere Supabase siempre |

### Qué ve el mesero cuando no hay internet

El OfflineIndicator (barra superior del POS) cambia a estado rojo cuando el sistema detecta
que Supabase no está disponible. El indicador muestra:

- Ícono de señal roja
- "Sin conexión — N pendiente(s)"
- Botón "Sincronizar ahora" (activo cuando hay internet)

El flujo de trabajo del mesero no cambia: abre mesa, agrega productos, envía. El sistema
maneja la diferencia entre online y offline de manera transparente.

### Qué NO debe hacer el personal durante offline

```
✗ No apagar el SERVER1 si hay órdenes offline pendientes
  (el sync_queue está en el IDB del browser; si se borra, se pierden)

✗ No borrar datos del navegador en Electron
  (equivale a borrar el IDB, incluyendo el sync_queue)

✗ No intentar abrir un turno nuevo si internet no está disponible
  (el sistema mostrará un error; esperar a que vuelva internet)

✓ Sí continuar tomando y enviando órdenes normalmente
✓ Sí cobrar en efectivo
✓ Sí imprimir comandas y tickets
```

---

## 9. Recovery ante reinicios

### Escenario 1 — Reinicio normal del servidor (SERVER1)

```
1. Electron cierra → el Local Server se detiene → events.ndjson permanece en disco
2. Windows reinicia
3. Electron abre automáticamente (auto-start en login)
4. Local Server se levanta → lee events.ndjson desde seq 0 → reconstruye RestaurantState
5. La ventana POS carga desde Service Worker cache (sin internet necesario)
6. Los terminales secundarios reconectan automáticamente (BridgeClient retry cada 3s)
7. Al recibir SUBSCRIBE con last_sequence, el Local Server envía los eventos faltantes
8. Estado recuperado: las mesas vuelven al mismo estado que tenían antes del reinicio
```

Tiempo esperado: 30-90 segundos dependiendo del hardware y del tamaño del event log.

### Escenario 2 — Corte de luz (apagón)

Igual que el Escenario 1. `fs.appendFileSync` en Linux/Windows garantiza que el evento llega
a disco antes de que el ACK llegue al POS. Una línea incompleta (si el corte ocurre mid-write)
se ignora silenciosamente al hacer replay.

**Riesgo conocido:** si el corte ocurre en el microsegundo entre `append()` y
`saveProcessedCommand()`, el mismo evento puede procesarse dos veces al reiniciar.
El `command_id` garantiza idempotencia: el segundo procesamiento retorna `duplicate: true`
sin side effects.

### Escenario 3 — Reinicio de terminal secundaria (no SERVER1)

```
1. La terminal PDV secundaria se reinicia
2. El Local Server sigue corriendo en SERVER1
3. La terminal abre Electron → carga POS desde SW cache
4. BridgeClient envía SUBSCRIBE con last_sequence
5. El Local Server responde con todos los eventos que se perdió (catch-up)
6. Estado sincronizado en < 5 segundos
```

### Escenario 4 — El Local Server no arranca después del reinicio

Síntomas: `http://127.0.0.1:7717/health` no responde después del boot.

```batch
REM Verificar si el puerto 7717 está en uso por otro proceso
netstat -ano | findstr :7717
REM Si hay un PID listado que no es el proceso de Fullsite:
taskkill /PID <PID> /F

REM Verificar logs del proceso Electron
REM En Windows: %APPDATA%\fullsite-pos\logs\
```

---

## 10. Sync-back cuando vuelve internet

El sync-back es automático y transparente. El personal no necesita hacer nada.

### Flujo automático

```
1. navigator.onLine cambia a true
2. window.online event dispara syncAll()
3. registerAutoSync() (corriendo en background cada 30s) detecta conectividad real
   (fetch real a /api/ping, no solo navigator.onLine)
4. syncAll() lee sync_queue donde synced=false
5. Por cada item, en orden de created_at:
   a. POST a Supabase con el payload original
   b. Si OK → markSynced(id) → IDB delete
   c. Si error → increment attempts, continúa con el siguiente
6. El OfflineIndicator muestra "Sincronizando..." → vuelve a verde
7. Las órdenes offline aparecen en el Dashboard en tiempo real
```

### Garantías del sync-back

| Garantía | Implementación |
|---|---|
| Sin duplicados | `command_id` único en cada operación; Supabase ignora el segundo insert con el mismo ID |
| Orden cronológica | sync_queue procesa en orden de `created_at` |
| Sin pérdida de datos | IDB persiste entre sesiones; solo se borra si el usuario limpia datos del browser |
| Retry automático | Items con error se reintentan en la siguiente ejecución de syncAll() |
| Mutex de ejecución | syncAll() solo corre una instancia a la vez (`syncAllRunning` flag) |

### Cuánto tarda el sync

En la prueba de certificación (OFFLINE-CERTIFICATION-RUNBOOK.md F-01):
- Tiempo hasta sync completo: < 30 segundos desde reconexión
- Órdenes sincronizadas: 2 órdenes, sin duplicados, correctas en Supabase

En condiciones normales (< 50 operaciones en cola): < 60 segundos.
En condiciones extremas (día completo sin internet, > 500 operaciones): puede tomar 5-10 minutos.

### Si el sync no ocurre automáticamente

```
1. Verificar que hay internet real: abrir un browser y navegar a cualquier página
2. En el POS: Settings → Sincronización → Sincronizar ahora
3. Si sigue sin sincronizar:
   DevTools → Application → IndexedDB → fullsite-pos-v2 → sync_queue
   Ver campo last_error de los items pendientes
4. Si last_error indica auth: cerrar sesión → volver a entrar → reintenta
5. Si last_error indica 409 Conflict: la orden ya está en Supabase (otro terminal la sincronizó)
   Marcar como synced manualmente en la consola:
   await db.clearSyncedItems()
```

---

## 11. Agregar terminales nuevas

### Terminal POS adicional

Prerrequisitos:
- La máquina puede llegar a SERVER1 por LAN (`ping 192.168.X.X` responde)
- El puerto 7717 no está bloqueado

Instalación:
1. Correr el mismo instalador en la máquina nueva
2. En el wizard: seleccionar "Terminal adicional (POS)"
3. Código de restaurante: el mismo
4. IP del servidor: la IP LAN de SERVER1 (visible en `/health → lan_ip`)

El wizard genera un `terminal_id` nuevo. El `restaurant_id` es el mismo que el del SERVER1.
Sin esto, el Local Server rechazaría comandos con un `restaurant_id` diferente.

### KDS adicional

Opción A — Electron:
1. Instalar el mismo instalador
2. Wizard: "KDS dedicado"
3. IP del servidor: IP LAN de SERVER1

Opción B — ~~Chrome (sin instalación)~~ **PROHIBIDA para KDS.** `https://app.fullsite.mx/pos/kds`
en Chrome NO funciona offline (una página https no puede leer la IP LAN por http → mixed-content).
Usar siempre la **Opción A (Electron `kds_only`)**, que carga `http://127.0.0.1:7717/kds` de su Pedro
local. Ver regla dura #1 en `OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`.

### Verificar que la terminal nueva está conectada

En SERVER1, abrir:
```
http://127.0.0.1:7717/health
```

El campo `clients_connected` debe incrementar cuando la terminal nueva se conecta.
El campo `clients` lista todos los terminales activos con su `client_id` y `client_type`.

---

## 12. Checklist de go-live

Completar en orden. No saltarse pasos.

### Días antes de la instalación

```
☐ El admin de Fullsite creó el restaurante en Supabase
☐ El menú está cargado y correcto en Supabase
☐ Los PINs del staff están cargados en Supabase
☐ El código de restaurante (FST-XXXX) está documentado
☐ Las IPs de las impresoras están documentadas
☐ El restaurante tiene una PC Windows 10/11 x64 disponible
☐ El restaurante tiene switch/router con LAN funcional
☐ El instalador descargó Fullsite POS Setup X.X.X.exe
```

### Día de instalación

```
☐ Instalar en SERVER1 (§5.3)
☐ Completar el wizard de provisioning (§4.2)
☐ Crear printers.json con IPs reales (§5.4)
☐ Ejecutar V-01 a V-10 (conectividad y hardware)
☐ Primer arranque con internet y prefetch de IDB (§5.5)
☐ Instalar terminales adicionales si las hay (§5.6)
☐ Ejecutar V-11 a V-16 (KDS y multi-terminal)
☐ Ejecutar V-17 a V-23 (offline)
☐ Ejecutar V-24 a V-25 (recovery)
☐ Todos los bloques V: PASS ✓
```

### Entrega al restaurante

```
☐ Personal conoce: cómo iniciar sesión con PIN
☐ Personal conoce: qué significa el indicador rojo (offline) y que no deben preocuparse
☐ Personal conoce: NO apagar el SERVER1 durante el turno sin avisar
☐ Número de soporte Fullsite entregado al encargado
☐ Documento de runbook operativo entregado (LOCAL_FIRST_ARCHITECTURE.md §14)
```

### Monitoreo post-instalación

```
☐ A las 24h: heartbeat del servidor llegando a Supabase (agent_runs)
☐ A las 48h: sync_queue no tiene items con attempts > 5
☐ A la semana: el restaurante no ha contactado soporte por problemas offline
```

---

## Apéndice A — Variables de entorno

Algunos valores sensibles no van en `config.json`. El instalador los empaqueta en el binario:

| Variable | Descripción | Cómo se entrega |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase | Empaquetada en el instalador por el proceso de build |
| `SUPABASE_ANON_KEY` | Anon key de Supabase | Empaquetada en el instalador por el proceso de build |

Estos valores son los mismos para todos los restaurantes — apuntan al mismo proyecto Supabase
de Fullsite. La separación entre restaurantes la hace el `restaurant_id` + RLS, no diferentes
proyectos Supabase.

## Apéndice B — Directorio de archivos en disco

```
C:\fullsite\
├── config.json           ← Configuración del terminal (generado por wizard)
├── printers.json         ← Configuración de impresoras (creado por el instalador)
├── server-id             ← UUID estable del servidor (generado automáticamente)
├── event-log.ndjson      ← Event log del Local Server (fuente de verdad local)
├── processed-commands.ndjson  ← Registro de command_ids para idempotencia
└── fingerprint-service.exe    ← (Opcional) Solo si hay lector de huella digital
    DPUruNet.dll               ← (Opcional) DLL del lector DigitalPersona

%APPDATA%\fullsite-pos\
├── logs\                 ← Logs del proceso Electron
└── (IDB managed by Chromium)
```

---

*Versión 1.0 — 2026-07-27*
*Aplica a: Fullsite POS 1.x con Local Server 1.x*
*Próxima revisión: al completar Phase 2 (turno offline + cierre offline)*

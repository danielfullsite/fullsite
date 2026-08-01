# ZERO-TOUCH RESTAURANT ONBOARDING

> Objetivo: un restaurante nuevo queda listo para operar en < 2 horas.
> Disenado para que cualquier miembro del equipo lo ejecute sin Daniel.
> Si un paso requiere "Daniel tiene que revisar esto", no esta resuelto.
> Version 1.0 — 2026-06-30

---

## Flujo completo

```
INFORMACION          CONFIGURACION         INSTALACION         VERIFICACION
(30 min remoto)      (45 min remoto)       (30 min in situ)    (15 min)
                                                               
Formulario       →   Script migra      →   Bridge + Chrome →   Health check
Menu (CSV/foto)  →   Menu importado    →   Impresoras      →   Test impresion
Staff (lista)    →   Staff + PINs      →   KDS             →   Test comanda
Layout (foto)    →   Mesas config      →   Cajon           →   Test cajon
Impresoras (IPs) →   Routing config    →   PWA instalada   →   Test cobro
Fiscal (RFC)     →   Facturama config  →                   →   Migration Diff
```

---

## FASE 1 — RECOLECCION (30 min, remoto)

### Que necesitamos del restaurante

| # | Dato | Formato | Quien lo da | Automatizable |
|---|------|---------|-------------|---------------|
| 1 | Nombre del restaurante | Texto | Dueno | Hoy |
| 2 | Menu completo (platillos, precios, categorias) | CSV, Excel, PDF, o foto | Gerente | 6 meses (OCR/IA) |
| 3 | Modificadores/extras por platillo | Lista o "igual que el menu" | Gerente | 6 meses |
| 4 | Lista de empleados con rol (mesero/cajero/gerente) | Lista | Gerente | Hoy |
| 5 | PINs deseados por empleado | 4 digitos por persona | Gerente | Hoy (auto-generar) |
| 6 | Plano de mesas / layout | Foto o dibujo | Gerente | Siempre humano |
| 7 | IPs de impresoras | Self-test de cada impresora | Tecnico/implementador | 6 meses (network scan) |
| 8 | Tipo de conexion por impresora (TCP/USB) | Observacion | Implementador | 6 meses (auto-detect) |
| 9 | Routing: que categoria va a que impresora | Pregunta al gerente/chef | Gerente | Hoy (default inteligente) |
| 10 | Datos fiscales (RFC, razon social, regimen, CP) | Constancia SAT | Contador | Hoy |
| 11 | Formas de pago aceptadas | Lista | Cajero | Hoy |
| 12 | Impuestos especiales (IEPS en alcohol) | Si/no + lista de productos | Contador | Hoy |
| 13 | POS actual (Wansoft, Soft Restaurant, otro, ninguno) | Nombre | Gerente | Hoy |
| 14 | Horarios de operacion | Texto | Gerente | Hoy |
| 15 | Numero de terminales POS | Numero | Gerente | Hoy |

### Formulario de onboarding

Un solo formulario web (Google Forms o Typeform) que el gerente llena
en 15 minutos. El implementador lo revisa en 15 minutos mas.

**Criterio de salida Fase 1:** Todos los campos llenos. Menu recibido.
Staff listado. IPs conocidas (o visita programada para obtenerlas).

### Clasificacion de automatizacion

| Paso | Hoy | 6 meses | Siempre humano |
|---|---|---|---|
| Formulario web | ✓ Automatizable | -- | -- |
| Parsear menu CSV/Excel | ✓ Script existente | -- | -- |
| Parsear menu PDF/foto | -- | IA + OCR | -- |
| Auto-generar PINs | ✓ Automatizable | -- | -- |
| Plano de mesas | -- | -- | ✓ Requiere foto + config manual |
| IPs de impresoras | -- | Network scan | Verificacion humana |
| Routing por defecto | ✓ Heuristica (comida→cocina, bebida→barra) | -- | Override humano si no coincide |
| Datos fiscales | ✓ Formulario | -- | -- |

---

## FASE 2 — CONFIGURACION (45 min, remoto)

### Script de migracion

Un solo script que toma los datos del formulario y configura todo:

```
fullsite-setup --client-id "nuevo-restaurante" \
               --menu menu.csv \
               --staff staff.csv \
               --printers printers.json \
               --fiscal fiscal.json \
               --layout layout.json
```

### Que hace el script (paso a paso)

| # | Accion | Input | Output | Automatizable |
|---|--------|-------|--------|---------------|
| 1 | Crear client_id en Supabase | Nombre restaurante | Row en tenant table | ✓ Hoy |
| 2 | Importar menu (categorias + items + precios) | CSV/Excel | pos_menu_categories + pos_menu_items | ✓ Hoy |
| 3 | Asignar routing por defecto | Categorias del menu | CATEGORY_TO_STATION mapping | ✓ Hoy (heuristica) |
| 4 | Importar staff con PINs y roles | CSV | pos_staff_members | ✓ Hoy |
| 5 | Configurar formas de pago | Lista | pos_payment_methods | ✓ Hoy |
| 6 | Configurar datos fiscales | JSON | pos_fiscal_config | ✓ Hoy |
| 7 | Configurar IEPS por producto (si aplica) | Lista de productos con IEPS | pos_tax_rules + pos_item_taxes | ✓ Hoy (cuando modelo fiscal exista) |
| 8 | Generar printers.json | IPs + tipos | Archivo JSON | ✓ Hoy |
| 9 | Configurar layout de mesas | JSON con posiciones | pos_mesas o config | ✓ Hoy (pero input es manual) |
| 10 | Generar Migration Diff Report | Menu importado vs fuente | Reporte de diferencias | ✓ Hoy |
| 11 | Configurar Facturama (si aplica) | RFC + credenciales | Variables de entorno | ✓ Hoy |
| 12 | Verificar 0 errores en la configuracion | Todo lo anterior | OK / lista de errores | ✓ Hoy |

### Que NO hace el script (requiere humano)

| Paso | Por que | Cuando se automatiza |
|---|---|---|
| Verificar precios contra menu fisico | Requiere comparacion visual | 6 meses (foto del menu → IA compara) |
| Asignar modificadores por platillo | Logica de negocio del chef | Siempre humano (pero defaults inteligentes) |
| Validar routing con el chef | "Los croissants van a cocina o a panaderia?" | Siempre humano |
| Configurar recetas de inventario | Requiere conocimiento del chef | Siempre humano |
| Subir CSD a Facturama | Archivo del contador | Siempre humano |

### Migration Diff Report

Despues de importar, el sistema genera automaticamente:

```
MIGRATION DIFF REPORT — Restaurante Nuevo
==========================================
Items importados:    245 / 245 (100%)
Categorias creadas:  18
Staff importado:     12 / 12 (100%)
Formas de pago:      6
Impresoras:          4

ALERTAS:
⚠ 3 items sin categoria asignada (asignados a "Otros")
⚠ 2 items con precio $0.00 (verificar)
⚠ Routing: 5 categorias sin estacion asignada (default: cocina)

VERIFICAR MANUALMENTE:
□ Precios correctos (comparar contra menu fisico)
□ Routing correcto (confirmar con chef)
□ Formas de pago completas
□ Datos fiscales correctos
```

**Criterio de salida Fase 2:** Migration Diff Report con 0 alertas criticas.
Todas las alertas verificadas y resueltas.

---

## FASE 3 — INSTALACION (30 min, in situ o remoto)

### Checklist de instalacion

| # | Paso | Tiempo | Automatizable | Detalle |
|---|------|--------|---------------|---------|
| 1 | Copiar bridge.js + printers.json a terminal | 2 min | ✓ Hoy (script de copia) | Via TeamViewer o USB |
| 2 | Instalar Node.js (si no existe) | 5 min | ✓ Hoy (instalador silencioso) | node-v20-win-x64.msi |
| 3 | Configurar auto-arranque del bridge | 2 min | ✓ Hoy (script bat en Startup) | `cd C:\fullsite && node bridge.js` |
| 4 | Abrir Chrome con Fullsite PWA | 1 min | ✓ Hoy | `https://app.fullsite.mx/pos` |
| 5 | Login con PIN del gerente | 1 min | Siempre humano | Verifica que el PIN funciona |
| 6 | Health check del bridge | 1 min | ✓ Hoy | `http://127.0.0.1:7717/health` |
| 7 | Test impresion cocina | 2 min | ✓ Hoy (boton "Test" en config) | Enviar comanda de prueba |
| 8 | Test impresion barra | 2 min | ✓ Hoy | Idem |
| 9 | Test impresion tickets | 2 min | ✓ Hoy | Idem |
| 10 | Test cajon de dinero | 1 min | ✓ Hoy (boton "Abrir cajon") | Verificar que abre |
| 11 | Test cobro completo (orden → cocina → cobro → ticket) | 5 min | Siempre humano | Flujo E2E real |
| 12 | Configurar KDS en monitor cocina | 3 min | ✓ Hoy | Chrome fullscreen en `/pos/kds` |
| 13 | Verificar offline (desconectar WiFi, crear orden) | 3 min | Siempre humano | Verificar que funciona sin internet |

### Kit de instalacion

Contenido del USB o carpeta remota:

```
fullsite-install/
├── bridge.js              # Bridge de impresion
├── printers.json          # Configurado por el script
├── start-bridge.bat       # Auto-arranque
├── node-v20-installer.msi # Node.js (si no existe)
├── install.bat            # Script que hace pasos 1-3 automatico
├── test-print.bat         # Envia test a cada impresora
└── README.txt             # Instrucciones para el implementador
```

**`install.bat`** (automatiza pasos 1-3):

```batch
@echo off
echo Instalando Fullsite Print Bridge...
mkdir C:\fullsite 2>nul
copy /Y bridge.js C:\fullsite\
copy /Y printers.json C:\fullsite\
copy /Y start-bridge.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
echo Verificando Node.js...
where node >nul 2>&1 || (echo Instalando Node.js... && msiexec /i node-v20-installer.msi /qn)
echo Iniciando bridge...
cd /d C:\fullsite
start "Fullsite Bridge" node bridge.js
timeout /t 3
curl -s http://127.0.0.1:7717/health
echo Listo.
```

**Criterio de salida Fase 3:** Health check OK, 4 impresoras responden,
cajon abre, cobro de prueba exitoso.

---

## FASE 4 — VERIFICACION (15 min)

### Go/No-Go checklist

| # | Verificacion | Metodo | Criterio |
|---|-------------|--------|----------|
| 1 | Bridge responde | `GET /health` | `{"ok":true}` |
| 2 | Cocina imprime | Enviar comanda de prueba | Papel sale |
| 3 | Barra imprime | Enviar comanda de prueba | Papel sale |
| 4 | Tickets imprimen | Cobrar orden de prueba | Ticket sale |
| 5 | Cajon abre | Cobro efectivo | Cajon se abre |
| 6 | Cajon NO abre | Cobro tarjeta | Cajon no se abre |
| 7 | KDS recibe ordenes | Enviar a cocina | Card aparece en KDS |
| 8 | Login funciona (3 roles) | PIN gerente, cajero, mesero | Cada uno ve lo correcto |
| 9 | Menu completo | Navegar categorias | Todos los items visibles |
| 10 | Precios correctos | Comparar 10 items al azar contra menu fisico | 10/10 match |
| 11 | Offline funciona | Desconectar WiFi, crear orden | Orden se guarda local |
| 12 | Turno se abre | Abrir turno con fondo | Turno activo en `/pos/turno` |
| 13 | Migration Diff Report | Revisar reporte | 0 alertas criticas |

**Si TODOS pasan:** restaurante listo para capacitacion + Shadow Day.
**Si alguno falla:** resolver antes de avanzar. Documentar el fallo.

---

## METRICAS DEL SISTEMA DE ONBOARDING

| Metrica | Target R1 | Target R10 | Target R100 |
|---|---|---|---|
| Tiempo total (recoleccion → verificacion) | 4-6h | 2-3h | < 2h |
| Tiempo de configuracion (script) | 45 min | 15 min | 5 min |
| Tiempo de instalacion (in situ) | 30 min | 20 min | 10 min |
| Items que requieren intervencion de Daniel | 5-10 | 1-2 | 0 |
| Tasa de exito primer intento | 70% | 90% | 98% |
| Errores en Migration Diff Report | < 5 | < 2 | 0 |

---

## CUELLOS DE BOTELLA REALES

### Hoy (R1-R5)

| Cuello de botella | Por que | Solucion |
|---|---|---|
| **Parsear menu** de POS anterior | Cada POS exporta diferente (Wansoft CSV, Soft Restaurant XML, etc.) | Parsers por POS. Hoy solo Wansoft |
| **IPs de impresoras** | Requiere self-test fisico o acceso a la red | Network scanner en el bridge |
| **Plano de mesas** | Cada restaurante tiene layout unico | Editor visual en `/pos/plano` (ya existe parcial) |
| **Routing de categorias** | El chef decide que va donde | Default inteligente + override manual |
| **Recetas** | Captura manual, lenta, propensa a error | Post-cutover, no bloquea onboarding |

### Proximo ano (R10-R100)

| Cuello de botella | Solucion | Tiempo |
|---|---|---|
| Parsear menu de foto/PDF | IA + OCR: foto del menu → CSV | 3 meses |
| Auto-detect impresoras en red | Bridge hace network scan al arrancar | 1 mes |
| Auto-routing por nombre de platillo | IA clasifica: "Cerveza XX" → barra | 1 mes |
| Auto-generar printers.json | Bridge detecta impresoras y genera config | 2 meses |
| Onboarding self-service | El gerente llena todo desde una app | 6 meses |

---

## DEPENDENCIAS QUE BLOQUEAN ESCALA

| Dependencia | Status | Impacto |
|---|---|---|
| Script de migracion de menu | No existe como CLI. Hoy es SQL manual | Sin esto, cada restaurante toma horas de SQL |
| Multi-tenant real | `client_id` existe en BD pero no hay admin UI | Sin esto, crear un restaurante requiere Supabase SQL |
| Modelo fiscal (IEPS) | ADR listo, bloqueado por XML | Sin esto, restaurantes con alcohol no pueden facturar |
| Bridge auto-install | Script `install.bat` no existe | Sin esto, cada instalacion es manual |
| Facturama multi-cuenta | Hoy es 1 cuenta Facturama por restaurante | A 100, necesita gestion centralizada |

---

## PROXIMO PASO

Construir el **script de migracion CLI** (`fullsite-setup`) que toma
un CSV de menu + un JSON de configuracion y configura todo en Supabase.

Este es el componente que mas reduce el tiempo de onboarding y mas
elimina la dependencia de Daniel.

Sin este script, cada restaurante es un proyecto artesanal.
Con este script, cada restaurante es una ejecucion de 15 minutos.

---

> Este documento define el sistema, no el proceso.
> El proceso (Cutover Playbook, Shadow Day, etc.) se construye encima.
> Actualizar con lecciones de cada implementacion.
>
> Fullsite — Restaurant Operating System

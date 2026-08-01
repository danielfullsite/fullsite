# Offline Certification Suite v1

> **Versión:** v1  
> **Fecha:** 2026-07-28  
> **Estado:** EN CURSO — Fase 4 completada, Fase 5 pendiente (ejecución en AMALAY)  
> **Bloquea:** P0-4 en `state/CERTIFICATIONS.md`

---

## Los 12 criterios bloqueantes (OC-01 a OC-12)

Todos deben estar en estado PASS para que P0-4 pase a CERTIFIED.

| ID | Criterio | Categoría | Estado |
|---|---|---|---|
| OC-01 | POS toma órdenes sin internet durante mínimo 4 horas | Core | PENDING FIELD |
| OC-02 | Órdenes enviadas a cocina/barra offline sin pérdida | Core | PENDING FIELD |
| OC-03 | Al reconectar, sync_queue sincroniza todas las órdenes pendientes | Sync | PENDING FIELD |
| OC-04 | No hay duplicados de órdenes post-sync | Sync | PENDING FIELD |
| OC-05 | Turno se puede abrir offline y cerrar online | Turno | PENDING FIELD |
| OC-06 | Cierre de turno refleja correctamente las ventas offline | Turno | PENDING FIELD |
| OC-07 | Impresión de ticket funciona offline (bridge local) | Print | PENDING FIELD |
| OC-08 | Si la impresora falla offline, la cola de retry persiste y reintenta | Print | PENDING FIELD |
| OC-09 | Staff puede autenticarse offline (credentials en IDB) | Auth | PASS (código) |
| OC-10 | Menú disponible offline (categories + items en IDB) | Auth | PASS (código) |
| OC-11 | Indicador visual de estado offline es claro para el mesero | UX | PENDING FIELD |
| OC-12 | Tiempo de reconexión + sync < 30 segundos en condiciones normales | Perf | PENDING FIELD |

---

## Las 8 prioridades P0

Los criterios que bloquean absolutamente si fallan:

- OC-01, OC-02 — si el POS no toma órdenes offline, no sirve
- OC-03, OC-04 — si la sync pierde o duplica datos, el negocio pierde dinero
- OC-05, OC-06 — si el turno no cierra correctamente, la caja no cuadra
- OC-07, OC-08 — si no hay impresión, cocina no funciona

---

## Las 11 prioridades P1

Los criterios que deben pasar en la primera iteración post-P0:

- OC-09, OC-10 — ya en PASS (código) pero necesitan validación de campo
- OC-11 — UX crítico para adopción del equipo
- OC-12 — performance bajo condiciones reales de red

Y criterios adicionales P1 (fuera del OC-01–12):

| ID | Criterio |
|---|---|
| OC-P1-01 | Multi-terminal: 2 terminales sin conflictos en el mismo turno |
| OC-P1-02 | Reconexión intermitente (WiFi que cae y regresa) no corrompe estado |
| OC-P1-03 | IDB v3 schema (turnos + cash_movements) migra correctamente |
| OC-P1-04 | Electron restart durante operación offline no pierde estado |
| OC-P1-05 | KDS muestra órdenes offline correctamente |
| OC-P1-06 | Modo solo-efectivo offline funciona end-to-end |
| OC-P1-07 | Backup de IDB confirmado en todos los dispositivos de AMALAY |

---

## Las 13 pruebas de la suite

| # | Prueba | Herramienta |
|---|---|---|
| 1 | Desconectar WiFi + tomar 5 órdenes + reconectar + verificar sync | Manual |
| 2 | Abrir turno offline + cerrar online + verificar totales | Manual |
| 3 | Imprimir ticket offline + verificar cola si impresora apagada | Manual |
| 4 | Autenticar staff offline + verificar que el PIN funciona sin red | Manual |
| 5 | Cargar menú offline + verificar que categories/items están en IDB | Manual |
| 6 | Enviar misma orden dos veces (simular doble-tap) + verificar idempotencia | Manual |
| 7 | Caída de internet durante pago + verificar recovery | Manual |
| 8 | Reiniciar Electron durante operación offline + verificar que no se perdieron órdenes | Manual |
| 9 | 2 terminales simultáneas + órdenes en paralelo + sync + verificar no duplicados | Manual (2 devices) |
| 10 | WiFi intermitente (10 ciclos de on/off) + verificar estabilidad | Network sim |
| 11 | IDB migration v2→v3 + verificar que los datos migran | Automated |
| 12 | 4 horas de operación offline + verificar que IDB no se llena | Long-running |
| 13 | Reconexión + sync + tiempo total < 30s en WiFi normal | Cronometrado |

---

## Fases de certificación

| Fase | Estado | Descripción |
|---|---|---|
| 1 — Diseño de criterios | COMPLETE | OC-01–OC-12 definidos |
| 2 — Implementación base | COMPLETE | Turno offline, IDB v3 schema (commit 7e17828) |
| 3 — Tests unitarios | COMPLETE | Suite de pruebas en código |
| 4 — Code review | COMPLETE | Auditoría LOCAL-FIRST-CODE-AUDIT.md |
| 5 — Ejecución en AMALAY | **PENDING** | Smoke test físico con hardware real |

La Fase 5 es el único bloqueante actual para P0-4 CERTIFIED.

---

## Wansoft como benchmark

El benchmark de confiabilidad offline es Wansoft. Wansoft opera durante cortes de internet sin pérdida de datos. Fullsite debe igualar o superar ese estándar antes de certificar P0-4.

Ver [`offline/WANSOFT-BENCHMARK.md`](../offline/WANSOFT-BENCHMARK.md) para el análisis detallado.

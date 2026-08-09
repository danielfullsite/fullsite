# Fullsite Restaurant Operations — Knowledge Base

> **Versión:** 1.0  
> **Fecha inicio:** 2026-08-04  
> **Mantenedor:** Chief Knowledge Engineer  
> **Estado:** EN CONSTRUCCIÓN  
>
> **Regla fundamental:** No es un manual de Fullsite. Es el conocimiento operacional de cómo operan los restaurantes — observado en AMALAY, reverse-engineered de Wansoft/NetSilver, y verificado en campo.

---

## Propósito

Capturar el conocimiento operacional de restaurantes de manera que:
- Alimente decisiones de producto sin requerir re-leer código
- Documente comportamiento real vs. comportamiento esperado
- Preserve contradicciones y unknowns sin resolverlos artificialmente
- Sirva como memoria institucional transferible

---

## Archivos

| Archivo | Dominio | Patrones |
|---|---|---|
| [01-operacion.md](01-operacion.md) | Flujo del día, turnos, apertura, cierre | OP-001 a OP-0XX |
| [02-caja.md](02-caja.md) | Caja, efectivo, cortes, métodos de pago | CJ-001 a CJ-0XX |
| [03-cocina-barra.md](03-cocina-barra.md) | Cocina, barra, routing de órdenes | CB-001 a CB-0XX |
| [04-inventario-compras.md](04-inventario-compras.md) | Inventario, recetas, compras sugeridas | IN-001 a IN-0XX |
| [05-meseros-servicio.md](05-meseros-servicio.md) | Meseros, propinas, servicio | MS-001 a MS-0XX |
| [06-delivery.md](06-delivery.md) | Rappi, Uber Eats, estados, integración | DL-001 a DL-0XX |
| [07-impresion-kds.md](07-impresion-kds.md) | Impresión, bridge, KDS, routing físico | PR-001 a PR-0XX |
| [08-configuracion.md](08-configuracion.md) | Config del sistema, taxonomía, actores | CF-001 a CF-0XX |
| [09-offline-recuperacion.md](09-offline-recuperacion.md) | Operación offline, sync, recuperación | OF-001 a OF-0XX |
| [10-errores-edge-cases.md](10-errores-edge-cases.md) | Errores conocidos, bugs de campo, casos límite | EC-001 a EC-0XX |
| [11-heuristicas-buenas-practicas.md](11-heuristicas-buenas-practicas.md) | Reglas de oro, heurísticas, mejores prácticas | HP-001 a HP-0XX |
| [12-wansoft-netsilver-patterns.md](12-wansoft-netsilver-patterns.md) | Patrones exclusivos de Wansoft/NetSilver | WN-001 a WN-0XX |
| [13-amalay-field-knowledge.md](13-amalay-field-knowledge.md) | Conocimiento específico observado en AMALAY | AM-001 a AM-0XX |
| [14-unknowns.md](14-unknowns.md) | Preguntas abiertas, observaciones pendientes | UNK-001 a UNK-0XX |
| [PATTERN-REGISTER.md](PATTERN-REGISTER.md) | Índice maestro de todos los patrones | — |

---

## Clasificaciones

| Símbolo | Significado |
|---|---|
| `SURPASS` | Fullsite supera a Wansoft en este patrón |
| `MATCH` | Comportamiento equivalente |
| `UNKNOWN` | No hay evidencia suficiente para comparar |
| `WANSOFT-ONLY` | Wansoft tiene esto; Fullsite no |

## Niveles de evidencia

| Nivel | Descripción |
|---|---|
| `FIELD VERIFIED` | Probado físicamente en AMALAY con hardware real |
| `CODE VERIFIED` | Confirmado leyendo código fuente directamente |
| `DOCUMENTED` | Registrado en docs oficiales del proyecto |
| `INFERRED` | Inferido de comportamiento observable o analogía |

---

## Fuentes primarias consultadas

| Fuente | Tipo | Fecha |
|---|---|---|
| `docs/archive/bibles/FULLSITE-OPERATIONS-BIBLE.md` | Fullsite Bible | 2026-07-xx |
| `docs/archive/bibles/FULLSITE-POS-OPERATIONAL-BIBLE.md` | Fullsite POS Bible | 2026-07-xx |
| `docs/archive/bibles/FULLSITE-POS-BIBLE.md` | Fullsite POS Technical | 2026-07-xx |
| `docs/archive/BREAK-THE-RESTAURANT.md` | QA destructivo pre-cutover | 2026-07-04 |
| `docs/archive/KNOWN_GOTCHAS.md` | Gotchas conocidos | 2026-07-xx |
| `docs/certifications/KDS-WANSOFT-GAP-ANALYSIS.md` | Gap analysis KDS | 2026-07-31 |
| `docs/certifications/OFFLINE-SUITE-v1.md` | Suite offline P0-4 | 2026-07-28 |
| `docs/strategy/WANSOFT-BIBLE.md` | 211 pantallas Wansoft | 2026-07-xx |
| `docs/product/WANSOFT-POS-BIBLE.md` | Wansoft POS en vivo | 2026-07-xx |
| `FULLSITE DOCS/15-AMALAY/wansoft/ARCHITECTURE.md` | Arquitectura Wansoft | 2026-07-xx |
| `FULLSITE DOCS/15-AMALAY/wansoft/DATA-MODEL.md` | 822 SPs, 23 dominios | 2026-07-xx |
| `FULLSITE DOCS/15-AMALAY/wansoft/CAJA-SPEC.md` | Configuración real AMALAY | 2026-07-xx |
| `FULLSITE DOCS/FULLSITE OFFLINE/21-WANSOFT-OFFLINE-BENCHMARK.md` | Benchmark offline | 2026-07-xx |
| `docs/archive/bibles/FULLSITE-MASTER-BIBLE.md` | Arquitectura sistema | 2026-07-xx |
| Memory: `project_wansoft_lessons.md` | 41 lecciones estratégicas | 2026-07-28 |

---

## Instrucciones para mantener este KB

1. Nunca convertir una inferencia en hecho sin elevar el nivel de evidencia
2. Nunca resolver contradicciones por intuición — registrar ambos lados
3. Nunca duplicar un patrón entre archivos — usar referencias cruzadas `→ [ID]`
4. Al cerrar un UNKNOWN: actualizar `14-unknowns.md`, actualizar `PATTERN-REGISTER.md`
5. Al descubrir un patrón nuevo de campo: agregar a la fuente correspondiente + `PATTERN-REGISTER.md`

# FOUNDER-INBOX

*Actualizado: 2026-08-05*

---

## Decisiones pendientes

| ID | Urgencia | Decisión | Habilita |
|---|---|---|---|
| **D-002** | ~~CRÍTICA~~ **APPROVED** | VISITA DE CERTIFICACIÓN FÍSICA — Gate actual: T-01 Diagnostic Session (PDV3 → SERVER1, 30-45 min, SIN instalación). Siguiente acción: copiar Field Kit a USB + coordinar acceso físico | F1 FIELD VERIFIED · R1-G02 · inicio formal F2 |
| **D-003** | ALTA | PRECIO: resolver contradicción $1,999 vs $4,999 MXN/mes por sucursal (ver PRICING.md) | Toda comunicación externa · F17 |
| **D-004** | ALTA | GRUPO GALERÍA: agendar Operational Assessment con Marcelo Gracia (COO) | Prep F19 |
| **D-005** | — DEFERRED | EDUARDO DE LA GARZA — RELATIONSHIP: FOUNDER-REPORTED · CONTRACT: UNKNOWN · CLAIMS: NOT VERIFIED · TECHNICAL BLOCKER: NO | Hiring track |

### D-002 — Visita de Certificación (**APPROVED**)

**Estado:** APPROVED. El gate pendiente ya NO es la decisión — es la ejecución del T-01 Diagnostic Session.

**Secuencia crítica:**
1. Copiar Field Kit a USB (canónico v2: Fullsite POS Setup 1.3.3.exe — SHA-256 80F0A819…C03A, 81,757,545 bytes — kit en `~/Desktop/FULLSITE-FIELD-KIT`, SHA verificado en disco 2026-08-06)
2. Coordinar acceso físico con AMALAY
3. T-01 Diagnostic Session — PDV3 primero, SERVER1 segundo · 30-45 min · SIN instalación
4. Salida T-01: DEPLOYMENT TYPE + MIGRATION BRANCH + INSTALL AUTH/BLOCKED
5. Si INSTALL AUTHORIZED → OCS-P2.5.9 Fases A–D (~90 min)
6. Si INSTALL BLOCKED → documentar blocker y resolver antes de proceder

**Release para instalación:** `release/offline-field-2026-08-06` · artefacto canónico v2 build de `21f6b87` (run 31066570237, supersede al build `7cc59ec`). Branch head actual `e4db737` es solo `tests/twin` — electron-app sigue en `21f6b87`, el instalador NO cambia.

**Origen:** Decision aprobada — release/offline-field-2026-08-06 · GHA 31033026398 BUILD PASS · canónico v2: run 31066570237 (ver `docs/RELEASE-MANIFEST.md` del Field Kit)

### D-003 — Precio (ALTA)

`docs/strategy/PRICING.md` registra $1,999 MXN/mes como hipótesis no aprobada.
Una sesión anterior registra $4,999 MXN/mes como precio decidido.
Ningún número puede usarse en comunicación externa hasta resolución.
No hay validación de mercado real — solo entrevistas cualitativas (Carlos, Gil, Eduardo).
Wansoft cobra $2,800+IVA/mes según survey 2026-05.

### D-004 — Grupo Galería (ALTA)

LOI firmado 2026-07-28. Contacto: Marcelo Gracia (COO Grupo Galería).
LOI ≠ contrato. No hay revenue hasta F18 (PRR ≥ 7/10).
Siguiente paso comercial: Operational Assessment.

### D-005 — Eduardo de la Garza (DEFERRED)

**RELATIONSHIP STATUS:** FOUNDER-REPORTED

**CONTRACT STATUS:** UNKNOWN
No existe artefacto de contrato localizado en el repositorio actual. No mostrar ningún término (equity, rol, compensación) como hecho verificado.

**ROLE / PERFORMANCE CLAIMS:** NOT VERIFIED IN CURRENT REPOSITORY
Métricas de crecimiento, historial Wansoft, y caracterizaciones de rol son FOUNDER-REPORTED. No han sido verificadas en fuentes independientes presentes en el repositorio.

**TECHNICAL BLOCKER:** NO
D-005 no bloquea ningún gate técnico en el critical path actual.

**FOUNDER FOLLOW-UP:** DEFERRED
No requiere acción hasta que cierre F1 FIELD VERIFIED o Daniel reabra activamente el hiring track.

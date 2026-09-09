# Plan de Certificaciones de Ciberseguridad — Fullsite

**Fullsite Technologies S.A. de C.V.** · v1.0 · 2026-09-05 · Responsable: Daniel Ramonfaur, CEO

Este documento hace las **cuentas** (qué es gratis, qué se paga, cuánto y cuándo) y da los
pasos exactos para **obtener las certificaciones/atestaciones que Fullsite puede reclamar sin
gastar**. Regla que se respeta en todo el plan: **no reclamar públicamente ninguna certificación
no obtenida** (lo mismo que ya enforza el test `security-trust-center.test.ts`).

---

## TL;DR — estás al ~80% del piso gratis

Fullsite ya tiene construido, de gratis, lo que a la mayoría de las startups les falta:

- **11 políticas ISMS** completas ([`docs/security/policies/`](policies/README.md)) — el set exacto que pide SOC 2 / ISO 27001.
- **Aviso de Privacidad Integral LFPDPPP** real y publicado (`/privacidad`, `dashboard-app/src/app/privacidad/page.tsx`).
- **PCI-DSS SAQ-A** documentado y elegible (`policies/11-pci-dss-saq-a.md`) — la tarjeta nunca toca Fullsite.
- **Trust center público** (`/seguridad`) con la disciplina de no reclamar certs no obtenidas.
- **`security.txt`** para reporte responsable (`public/.well-known/security.txt`).
- **Auditoría de seguridad full** (`docs/audit/AUDITORIA-FULL-2026-08-19.md`) + controles reales (RLS multi-tenant, roles server-side, HMAC en webhooks, audit log).

Lo que falta para **reclamar** los certificados gratis es **ejecución de submission**, no escribir de cero.

---

## Las cuentas — gratis vs pagado

Burn actual de Fullsite ≈ **$6,850 MXN/mes** (~$4,400 USD/año). Contra eso:

### GRATIS — obtenible ahora ($0)

| Certificación / señal | Qué te da | Costo | Tiempo | Estado |
|---|---|---|---|---|
| **CSA STAR Nivel 1** (CAIQ self-assessment) | Listado **público** en el registro de Cloud Security Alliance — señal de trust reconocida | $0 | ~1 semana (CAIQ ya redactado, ver abajo) | ⬜ Falta submit |
| **PCI-DSS SAQ-A (AOC firmado)** | Poder reclamar "PCI DSS compliant (SAQ-A)" legítimamente | $0 | 1-2 días | 🟡 Documentado, falta AOC oficial firmado |
| **Escaneos públicos** (Mozilla Observatory, SSL Labs, Hardenize) | Evidencia pública verificable, ya linkeada en `/seguridad` | $0 | 1 día | 🟡 Correr y fijar grado A |
| **ISC2 "Certified in Cybersecurity (CC)"** | Credencial real a nivel persona (tú/equipo) | $0 (programa gratis de ISC2*) | Examen a tu ritmo | ⬜ Inscribir |
| Políticas ISMS + Aviso de Privacidad | Base SOC 2 + cumplimiento legal MX | $0 | — | ✅ Hecho |

\* Verificar disponibilidad actual del programa de ISC2 (ha ofrecido training + examen CC gratis).

### PAGADO — solo cuando un deal enterprise lo justifique

| Certificación | Costo año 1 (USD aprox) | Tiempo | Trigger para pagarla |
|---|---|---|---|
| **SOC 2 Tipo I** | ~$8-15K (plataforma Vanta/Drata ~$7-12K + auditor ~$3-5K) | Readiness 1-2 meses | Primer comprador enterprise que la pida en su vendor review |
| **SOC 2 Tipo II** | +$5-15K auditor (misma plataforma) | Ventana de observación 3-6 meses | Cuando el Tipo I ya no baste (contratos grandes) |
| **ISO 27001** | ~$15-40K (consultoría + organismo certificador) | 6-12 meses | Comprador LatAm/global que lo exija; se agrupa con SOC 2 |
| **PCI-DSS Nivel 1 (QSA)** | $$$ auditoría formal | meses | **Solo si te vuelves subadquirente/payfac — evítalo** |

**La cuenta clara:** SOC 2 vía Vanta cuesta ~3-5x tu burn anual. **No se paga antes de tener el
cliente que la exige.** Gratis ahora = postura real + atestaciones self-service + señales públicas
que responden el ~80% de un cuestionario de seguridad de comprador. El sello pagado espera al deal.

---

## Los 4 free wins accionables — pasos exactos

### 1. CSA STAR Nivel 1 (el cert público nuevo) — el de mayor ROI
El CAIQ ya está contestado con la postura real de Fullsite en [`CAIQ-STAR-L1.md`](CAIQ-STAR-L1.md).
Pasos (los hace Daniel; requieren crear cuenta/firmar, que yo no puedo hacer por ti):
1. Bajar el workbook oficial CAIQ v4 de cloudsecurityalliance.org (gratis).
2. Vaciar las respuestas de `CAIQ-STAR-L1.md` al workbook.
3. Crear cuenta en el **STAR Registry** y subir el CAIQ como **Nivel 1 (Self-Assessment)** — $0.
4. Al publicarse: agregar la insignia/enlace STAR al trust center `/seguridad` (ahí sí ya es "obtenido").

### 2. PCI-DSS SAQ-A — formalizar el AOC
Ya cumples elegibilidad (`policies/11-pci-dss-saq-a.md`: Stripe/Clip/MercadoPago Level 1, tarjeta
nunca toca Fullsite). Falta:
1. Bajar el formulario oficial **SAQ A + AOC** de pcisecuritystandards.org (gratis).
2. Marcar las respuestas contra los controles ya documentados.
3. Firmar el **AOC** (Daniel, como CEO) → guardar en `docs/security/`.
4. Recién entonces se puede agregar "PCI-DSS SAQ-A" al trust center como obtenido (hoy está listado como no reclamado, correcto).

### 3. Escaneos públicos gratis (evidencia verificable)
Correr y fijar grado alto (el trust center ya enlaza los dos primeros):
- **Mozilla Observatory** → `observatory.mozilla.org` (host: `app.fullsite.mx`) — meta A/A+.
- **SSL Labs** → `ssllabs.com/ssltest` (dominio: `fullsite.mx`) — meta A/A+.
- **Hardenize** / **securityheaders.com** — headers HTTP.
Si algún grado sale bajo, es fix de configuración (CSP, HSTS, headers) — barato y sube la nota pública.

### 4. ISC2 CC (equipo) — credencial personal gratis
Inscribir a Daniel (y a quien haga seguridad) al programa gratuito de ISC2 → training + examen CC.
El trust center ya tiene el slot marcado como "todavía no obtenido" — se actualiza al aprobar.

---

## Roadmap

```
AHORA (gratis, esta semana)     →   CUANDO HAYA DEAL ENTERPRISE     →   SI LO PIDE LATAM/GLOBAL
─────────────────────────────       ──────────────────────────────      ──────────────────────
CSA STAR L1 (CAIQ submit)           SOC 2 Tipo I  (Vanta + auditor)      ISO 27001
PCI SAQ-A AOC firmado               SOC 2 Tipo II (ventana 3-6 mo)       (agrupado con SOC 2)
Scans públicos A/A+
ISC2 CC (equipo)
[políticas + aviso ya hechos]
```

Diferenciador de mercado (del README de políticas): **ningún competidor de POS restaurantero en
México (Parrot, Wansoft) tiene SOC 2 publicado.** El piso gratis + STAR L1 ya te pone adelante hoy;
el SOC 2 pagado sella la ventaja cuando el revenue lo financie.

---

## Disciplina de honestidad (no negociable)

Todo lo que se publique en `/seguridad` debe estar **realmente obtenido**. El test
`security-trust-center.test.ts` ya lo enforza: hoy SOC 2 / ISO 27001 aparecen como **"No
certificado"** y PCI/credenciales de equipo como no reclamadas — eso es correcto y se mantiene.
Cada free win de arriba solo se marca como obtenido en el trust center **después** de tener la
evidencia (listado STAR publicado, AOC firmado, examen aprobado).

## Estado

- Versión: 1.0 · 2026-09-05
- Próxima revisión: al cerrar el primer free win (CSA STAR L1)
- Aprobado por: _pendiente_ — Daniel Ramonfaur, CEO

# CAIQ — CSA STAR Nivel 1 (Self-Assessment) — Fullsite

**Fullsite Technologies S.A. de C.V.** · Basado en CSA CCM/CAIQ v4 · 2026-09-05
Responsable: Daniel Ramonfaur, CEO · Producto evaluado: plataforma SaaS Fullsite (POS + IA para restaurantes)

Este es el contenido para el **workbook oficial CAIQ v4** que se sube al STAR Registry como
**Nivel 1 (auto-evaluación, gratis)**. Cada dominio del CCM se responde con la postura real de
Fullsite y se referencia la política/control que ya existe. Respuestas honestas: donde algo es
parcial o no implementado se marca así (misma disciplina que el trust center).

**Modelo:** SaaS multi-tenant. Infra en PaaS certificados (Supabase, Vercel, Cloudflare) — los
controles físicos y de datacenter se **heredan** de esos proveedores (ver dominio DCS/STA).

Leyenda: ✅ Sí · 🟡 Parcial · ⬜ No / Planeado · ➖ N/A (heredado del proveedor)

---

| # | Dominio CCM v4 | Resp. | Implementación / evidencia |
|---|---|---|---|
| **A&A** | Audit & Assurance | 🟡 | Auditoría de seguridad interna documentada (`docs/audit/AUDITORIA-FULL-2026-08-19.md`); política de evaluación de riesgos (`policies/09`). Auditoría externa (SOC 2) planeada, aún no ejecutada. |
| **AIS** | Application & Interface Security | ✅ | Aislamiento multi-tenant por `client_id` + **RLS** en Postgres; roles server-side; validación de firma **HMAC-SHA256** en webhooks entrantes; code review obligatorio y CI (`policies/05`). Suite de tests de autorización (`security-authorization.test.ts`, `pos-db-policy.test.ts`). |
| **BCR** | Business Continuity & Resilience | ✅ | Plan de continuidad y DR con RTO/RPO (`policies/04`); backups gestionados por Supabase (point-in-time). |
| **CCC** | Change Control & Config Mgmt | ✅ | Política de gestión de cambios (`policies/05`): PR + code review + CI verde + merge; migraciones versionadas; rollbacks documentados. |
| **CEK** | Cryptography, Encryption & Keys | ✅ | TLS en tránsito (todo el tráfico); cifrado en reposo del proveedor (Supabase/Vercel); **Fullsite no almacena datos de tarjeta** (tokenización, ver `policies/11`); secretos en secret store, nunca en repo. |
| **DCS** | Datacenter Security | ➖ | Sin datacenter propio. Heredado de Supabase / Vercel / Cloudflare (SOC 2 / ISO 27001 / PCI — ver `policies/07` y dominio STA). |
| **DSP** | Data Security & Privacy Lifecycle | ✅ | Política de manejo de datos: recolección, retención, eliminación (`policies/06`); **Aviso de Privacidad Integral LFPDPPP** publicado (`/privacidad`) con derechos ARCO; clasificación de datos (`policies/01`). |
| **GRC** | Governance, Risk & Compliance | ✅ | Programa formal de 11 políticas aprobado por CEO (`policies/README.md`); registro y metodología de riesgos (`policies/09`). |
| **HRS** | Human Resources Security | 🟡 | Política de uso aceptable para empleados/contratistas (`policies/08`); aprovisionamiento/desaprovisionamiento de accesos (`policies/02`). Capacitación formal de concientización: en formalización (equipo pequeño). |
| **IAM** | Identity & Access Management | ✅ | Política de control de acceso (`policies/02`): identidades, roles, mínimo privilegio; PIN server-side en POS; autenticación gestionada (Supabase Auth); RLS por tenant. |
| **IPY** | Interoperability & Portability | ✅ | Datos exportables por el cliente; APIs documentadas; sin lock-in de formato (`policies/06`). |
| **IVS** | Infrastructure & Virtualization Security | ➖/✅ | Infra virtual heredada de PaaS certificados; aislamiento lógico por RLS; **WAF y protección DDoS por Cloudflare**; sin servidores propios que administrar. |
| **LOG** | Logging & Monitoring | ✅ | Política de logging (`policies/10`); **audit log** de aplicación (`lib/integrations/audit-logger.ts`, `platform/audit`); logs de plataforma (Vercel/Supabase). |
| **SEF** | Incident Mgmt & Forensics | ✅ | Plan de respuesta a incidentes: detección, contención, erradicación, post-mortem (`policies/03`); canal de reporte responsable (`.well-known/security.txt`, seguridad@fullsite.mx). |
| **STA** | Supply Chain & Transparency | ✅ | Inventario de sub-procesadores con sus certificaciones (`policies/07`): Supabase (SOC 2 Type II), Vercel (SOC 2), Cloudflare (SOC 2/ISO 27001/PCI), Stripe/Clip/MercadoPago (PCI L1), Groq (en evaluación). |
| **TVM** | Threat & Vulnerability Mgmt | 🟡 | Evaluación de riesgos (`policies/09`); escaneos públicos (Mozilla Observatory, SSL Labs) enlazados en `/seguridad`; dependencias vía plataforma. Pentest formal: planeado, aún no ejecutado. |
| **UEM** | Universal Endpoint Management | 🟡 | Reglas de endpoint en uso aceptable (`policies/08`); equipo pequeño. Gestión centralizada de dispositivos (MDM): no implementada (tamaño de equipo). |

---

## Notas de honestidad para el submission

- Los 🟡 y ⬜ se responden **tal cual** en el CAIQ (parcial/no) — no se inflan. STAR L1 es
  auto-evaluación pública; exagerar es peor que un "No" honesto y contradiría la disciplina del
  trust center.
- Los ➖ (DCS/IVS parcial) se responden como **heredados**, referenciando las certificaciones de
  los sub-procesadores (dominio STA). Es la respuesta correcta para un SaaS sobre PaaS.
- Al publicarse el listado STAR, agregar el enlace en `/seguridad` (ahí sí ya está "obtenido").

## Fuentes (todo ya existente en el repo)

- Políticas ISMS: `docs/security/policies/01`…`11` + `README.md`
- PCI SAQ-A: `docs/security/policies/11-pci-dss-saq-a.md`
- Aviso de Privacidad: `dashboard-app/src/app/privacidad/page.tsx`
- Trust center / `security.txt`: `/seguridad`, `public/.well-known/security.txt`
- Auditoría: `docs/audit/AUDITORIA-FULL-2026-08-19.md`

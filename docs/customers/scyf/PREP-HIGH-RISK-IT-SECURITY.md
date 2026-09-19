# Paso 8 — "High Risk IT Security Assessment" (SCYF / HEINEKEN)

**Fecha:** 2026-09-14 · **Estado del archivo:** NO LOCALIZADO DESPUÉS DE BÚSQUEDA GLOBAL

```
scripts/buscar-evidencia.sh "High Risk IT Security"   →   0 coincidencias
(los 8 pasos: repo y worktrees · outputs de sesiones · ~/Downloads · ~/Documents ·
 ~/Documents/Codex · ~/Desktop · búsqueda global en ~ · volúmenes externos)
```

Esto **no** es ausencia confirmada, y lo más probable es que sea simple secuencia: en el
infográfico de SCYF el cuestionario de alto riesgo es el paso **8**, y Ciber Seguridad lo
manda *después* del BIA (paso 7). Lo que sigue es la base de respuestas para cuando
llegue — no un cuestionario inventado.

---

## Lo que hay que decidir antes, no después

El paso 8 **solo se dispara si el BIA sale HIGH RISK**, y eso depende de dos respuestas
que todavía son una decisión de alcance, no un hecho:

1. **¿El piloto usa huella digital o solo PIN?** La huella es dato biométrico → sensible
   → alto riesgo casi con certeza. Con PIN por empleado, no.
2. **¿Hay cobro con tarjeta en el comedor, o el consumo se descuenta por nómina/prepago?**

Si ambas salen por el lado simple, este paso probablemente no ocurre.

---

## Lo que Fullsite puede sostener hoy (con evidencia)

| Dominio | Postura | Evidencia |
|---|---|---|
| Políticas de seguridad | 11 políticas escritas y versionadas | `docs/security/policies/` — infosec, control de acceso, respuesta a incidentes, BCDR, cambios, manejo de datos, proveedores, uso aceptable, riesgos, logging, PCI DSS SAQ A |
| Cifrado | AES-256 en reposo, TLS 1.3 en tránsito | `06-data-handling-policy.md:38-39,55` |
| Aislamiento multi-inquilino | RLS en Postgres por `client_id`; `role` y `client_id` viven en `app_metadata` (solo escribible por service_role) | `SECURITY-FOUNDATION-P0.md` (P0-A, P0-B, P0-C cerrados) |
| Control de acceso | MFA obligatorio para el equipo Fullsite en consolas de infraestructura; PIN individual por empleado en el POS; huella opcional | `02-access-control-policy.md:30,96` |
| Respuesta a incidentes | Severidades S1–S4 con tiempos: S1 < 1 h, S2 < 4 h, S3 < 24 h, S4 < 72 h. Canal público `seguridad@fullsite.mx`, respuesta en 48 h hábiles | `03-incident-response-plan.md:31-34`; `docs/security/SECURITY-GLOBAL.md` |
| Continuidad | RTO < 4 h, RPO < 24 h, respaldos diarios con 30 días de retención, PITR, prueba de restauración trimestral | `04-business-continuity-disaster-recovery.md:19-20,32,109` |
| Pagos / PCI | Alcance SAQ A: Fullsite no captura, transmite ni almacena datos de tarjeta; la terminal del PSP lo hace todo | `policies/11-pci-dss-saq-a.md`; verificado en código: 0 campos de PAN |
| Subprocesadores | Supabase (SOC 2 Type II), Vercel (SOC 2), Cloudflare (SOC 2 / ISO 27001 / PCI-DSS), Anthropic (SOC 2, zero-retention), Groq (en evaluación) | `07-vendor-management-policy.md:19-25` |
| Auditorías internas | Auditoría full 2026-08-19, fugas multi-inquilino 2026-08-30, auditoría de campo 2026-08-29 | `docs/audit/` |
| Continuidad operativa del cliente | Local-first real: el comedor sigue cobrando y mandando a cocina sin internet | Certificación offline, `docs/certifications/OFFLINE-SUITE-v1.md` |

---

## Lo que NO podemos sostener — hay que decirlo así

Un cuestionario de alto riesgo de una corporación pregunta esto textualmente. Contestar
"sí" sin respaldo es exactamente el tipo de afirmación que revienta después:

| Pregunta típica | Respuesta honesta hoy |
|---|---|
| ¿Tienen SOC 2 Type II? | **No.** Las 11 políticas son el primer paso hacia esa certificación (`policies/README.md:31`). Cotización de Vanta sobre la mesa: ~$12K USD/año + $3–5K de auditoría |
| ¿ISO 27001? | **No** |
| ¿Pentest externo en los últimos 12 meses? | **No.** Hay auditorías internas documentadas, no una prueba de terceros |
| ¿Programa formal de gestión de vulnerabilidades / escaneo continuo? | Parcial: guardianes automáticos y CI, sin herramienta formal de SCA/DAST |
| ¿Seguro de responsabilidad cibernética? | Por confirmar con Daniel |
| ¿Hallazgos de seguridad abiertos? | Sí, conocidos y rastreados: P0-D (tokens de sesión en `localStorage`, pendiente de migrar a `@supabase/ssr`) y totales calculados del lado cliente en algunas rutas de pago |
| ¿Cuántas personas en el equipo de seguridad? | Empresa fundada en 2026, equipo mínimo. La honestidad aquí vale más que el maquillaje |

**Cómo se juega esto:** una empresa joven no pierde por no tener SOC 2 — pierde por decir
que lo tiene. La postura que sí funciona es: políticas escritas, arquitectura defendible,
hallazgos rastreados por nombre, y un compromiso con fecha (p. ej. SOC 2 Type II iniciado
antes del go-live, o un pentest externo acotado pagado por Fullsite antes de producción).

---

## Qué pedirle a SCYF

1. El archivo del *High Risk IT Security Assessment* (o el acceso al tenant de OneTrust).
2. Si existe un DPA / anexo de tratamiento de datos que Fullsite deba firmar.
3. Si el piloto incluye huella y cobro con tarjeta — decide el perfil de riesgo completo.

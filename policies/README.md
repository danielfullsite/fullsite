# Politicas de Seguridad — Fullsite

Programa de seguridad de la informacion de Fullsite Technologies S.A. de C.V.
Estas politicas son requisito para la certificacion SOC 2 Type II.

## Indice

| # | Politica | Descripcion |
|---|---|---|
| 01 | [Seguridad de la Informacion](01-information-security-policy.md) | Marco general, clasificacion de datos, responsabilidades |
| 02 | [Control de Acceso](02-access-control-policy.md) | Identidades, roles, permisos, aprovisionamiento |
| 03 | [Respuesta a Incidentes](03-incident-response-plan.md) | Deteccion, contencion, erradicacion, post-mortem |
| 04 | [Continuidad y Recuperacion](04-business-continuity-disaster-recovery.md) | RTO/RPO, backups, escenarios de desastre |
| 05 | [Gestion de Cambios](05-change-management-policy.md) | Code review, deploys, rollbacks, migraciones |
| 06 | [Manejo de Datos](06-data-handling-policy.md) | Recoleccion, almacenamiento, retencion, eliminacion |
| 07 | [Gestion de Proveedores](07-vendor-management-policy.md) | Evaluacion, inventario, certificaciones de terceros |
| 08 | [Uso Aceptable](08-acceptable-use-policy.md) | Reglas para empleados y contratistas |
| 09 | [Evaluacion de Riesgos](09-risk-assessment-policy.md) | Metodologia, registro de riesgos, tratamiento |
| 10 | [Logging y Monitoreo](10-logging-monitoring-policy.md) | Que se registra, retencion, alertas, forense |
| 11 | [PCI-DSS SAQ-A](11-pci-dss-saq-a.md) | Autoevaluacion PCI — evidencia de que no tocamos datos de tarjeta |

## Estado

- Version: 1.0
- Fecha: 2026-05-25
- Proxima revision: 2026-11-25
- Aprobado por: Daniel Ramonfaur, CEO

## Objetivo

Estas politicas son el primer paso hacia la certificacion SOC 2 Type II.
Ningun competidor en el vertical de POS para restaurantes en Mexico
(Parrot, Wansoft) tiene SOC 2 publicado — este es el diferenciador.

## Siguiente paso

Contratar plataforma de compliance automatizado (Vanta, Drata, Secureframe o Scytale)
para mapear estos controles a los Trust Service Criteria de SOC 2 y conectar evidencia
automatica desde GitHub, Supabase, Vercel y Cloudflare.

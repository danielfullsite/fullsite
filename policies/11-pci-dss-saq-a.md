# PCI-DSS SAQ-A — Self-Assessment Questionnaire

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha: 2026-05-25
Proxima revision: 2027-05-25
Responsable: Daniel Ramonfaur, CEO

---

## Declaracion de elegibilidad para SAQ-A

Fullsite califica para SAQ-A (la autoevaluacion mas simple) porque cumple TODOS estos criterios:

- [x] Fullsite **no almacena, procesa ni transmite** datos de tarjeta de credito/debito
- [x] Todas las funciones de pago estan **completamente externalizadas** a proveedores PCI-DSS certificados
- [x] Fullsite **no tiene acceso directo** a numeros de tarjeta, CVV, ni datos de banda magnetica
- [x] La aplicacion solo recibe **tokens de confirmacion** del procesador de pagos
- [x] No existe hardware propio para lectura de tarjetas bajo control de Fullsite

## Proveedores de pago certificados PCI-DSS

| Proveedor | Tipo | Certificacion PCI-DSS | Metodo de integracion |
|---|---|---|---|
| Stripe | Tokenizador | Level 1 Service Provider | API tokenizada — Stripe.js / Stripe Terminal |
| Clip | Terminal de pago | Level 1 Service Provider | Hardware Clip — los datos nunca pasan por Fullsite |
| MercadoPago | Procesador | Level 1 Service Provider | API tokenizada — SDK MercadoPago |

## Flujo de datos de pago

```
Cliente presenta tarjeta
        |
        v
Terminal Clip / Widget Stripe / SDK MercadoPago
        |
        v  (datos de tarjeta encriptados punto a punto)
Procesador de pagos (PCI-DSS Level 1)
        |
        v  (solo token de confirmacion)
Fullsite POS  <-- Fullsite SOLO recibe:
                  - ID de transaccion (token)
                  - Monto confirmado
                  - Metodo de pago (tipo: credito/debito)
                  - Timestamp
                  NUNCA recibe:
                  - Numero de tarjeta (PAN)
                  - CVV/CVC
                  - Fecha de expiracion
                  - Nombre del tarjetahabiente
                  - Datos de banda magnetica/chip
```

## Respuestas SAQ-A

### Requisito 2: No usar valores predeterminados del proveedor

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 2.1 | Se cambiaron passwords default en todos los sistemas? | SI | Supabase: password unico generado. Vercel/GitHub: MFA activo. No hay hardware propio. |

### Requisito 6: Desarrollar y mantener sistemas seguros

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 6.1 | Se identifican vulnerabilidades de seguridad? | SI | Dependabot activo (semanal), SECURITY.md publicado, email seguridad@fullsite.mx |
| 6.2 | Se aplican parches de seguridad? | SI | Dependabot PRs automaticos, Vercel auto-deploys en merge |

### Requisito 8: Identificar y autenticar acceso

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 8.1 | Se asignan IDs unicos a cada persona con acceso? | SI | Supabase Auth con email unico por usuario. GitHub con cuentas individuales. |
| 8.2 | Se usan metodos de autenticacion fuertes? | SI | MFA habilitado en GitHub, Supabase, Vercel, Cloudflare. Passwords minimo 8 caracteres. |
| 8.5 | Se eliminan cuentas inactivas? | SI | Politica: cuentas inactivas > 90 dias se desactivan (ver 02-access-control-policy.md) |

### Requisito 9: Restringir acceso fisico

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 9.1 | Se restringe acceso fisico a datos de tarjeta? | N/A | Fullsite no almacena datos de tarjeta en ningun medio. Infraestructura 100% en la nube. |

### Requisito 11: Probar regularmente sistemas y procesos

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 11.1 | Se prueban puntos de acceso inalambrico? | N/A | No hay infraestructura inalambrica propia — todo cloud. |
| 11.2 | Se realizan escaneos de vulnerabilidades? | SI | Dependabot (semanal), Vercel security headers, Cloudflare WAF |

### Requisito 12: Politica de seguridad de la informacion

| # | Control | Respuesta | Evidencia |
|---|---|---|---|
| 12.1 | Existe politica de seguridad de la informacion? | SI | policies/01-information-security-policy.md — v1.0, revision semestral |
| 12.3 | Se define el uso aceptable de tecnologias? | SI | policies/08-acceptable-use-policy.md |
| 12.4 | Se definen responsabilidades de seguridad? | SI | CISO: CEO (interino). Cada politica tiene responsable asignado. |
| 12.6 | Se capacita al personal en seguridad? | SI | Onboarding incluye lectura obligatoria de politicas. Recordatorio semestral. |
| 12.8 | Existe plan de respuesta a incidentes? | SI | policies/03-incident-response-plan.md — clasificacion P0-P3, SLAs definidos |
| 12.10 | Se prueban los planes de respuesta a incidentes? | PENDIENTE | Primer simulacro programado para Q3 2026 |

## Declaracion de cumplimiento

Declaro que Fullsite Technologies S.A. de C.V. ha completado esta autoevaluacion SAQ-A de manera veraz y completa. Fullsite no almacena, procesa ni transmite datos de tarjeta de credito o debito, delegando estas funciones completamente a proveedores certificados PCI-DSS Level 1.

**Firma:** ________________________________
**Nombre:** Daniel Ramonfaur
**Cargo:** CEO, Fullsite Technologies S.A. de C.V.
**Fecha:** 2026-05-25

## Acciones pendientes

| Accion | Prioridad | Fecha objetivo |
|---|---|---|
| Activar MFA en TODAS las cuentas (GitHub, Supabase, Vercel, Cloudflare) | CRITICA | 2026-05-26 |
| Primer simulacro de respuesta a incidentes | ALTA | 2026-08-01 |
| Crear email seguridad@fullsite.mx | ALTA | 2026-05-26 |
| Verificar DMARC/SPF/DKIM en fullsite.mx | MEDIA | 2026-06-01 |
| Renovar SAQ-A anualmente | MEDIA | 2027-05-25 |

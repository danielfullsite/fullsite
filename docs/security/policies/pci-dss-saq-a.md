# PCI-DSS Self-Assessment Questionnaire A (SAQ-A)

**Fullsite Technologies S.A. de C.V.**
Fecha: 2026-05-25
Tipo de SAQ: A — Card-not-present merchants, all cardholder data functions fully outsourced

---

## Elegibilidad para SAQ-A

Fullsite califica para SAQ-A porque:
- [x] No almacenamos datos de tarjeta (numeros, CVV, fecha de expiracion)
- [x] No procesamos datos de tarjeta en nuestros servidores
- [x] No transmitimos datos de tarjeta a traves de nuestra red
- [x] Todas las funciones de pago con tarjeta estan delegadas a procesadores certificados PCI-DSS
- [x] El unico dato que recibimos es un token de confirmacion de la transaccion

## Procesadores de pago utilizados

| Procesador | Metodo de integracion | Certificacion PCI-DSS |
|---|---|---|
| Stripe | Tokenizacion client-side (Stripe.js/Elements) | PCI-DSS Level 1 Service Provider |
| Clip | Dispositivo fisico de lectura de tarjeta | PCI-DSS Level 1 |
| MercadoPago | Checkout Pro / tokenizacion | PCI-DSS Level 1 Service Provider |

## Requisitos SAQ-A

### Requisito 2: No usar defaults del proveedor para passwords

| # | Requisito | Cumple | Evidencia |
|---|---|---|---|
| 2.1 | Cambiar defaults de passwords en sistemas | Si | Credenciales unicas en todos los servicios |
| 2.1.1 | Cambiar defaults en wireless (si aplica) | N/A | No operamos redes wireless propias |

### Requisito 9: Restriccion de acceso fisico a datos de tarjeta

| # | Requisito | Cumple | Evidencia |
|---|---|---|---|
| 9.5 | Proteger fisicamente todos los medios | N/A | No almacenamos datos de tarjeta en ningun medio |

### Requisito 12: Politica de seguridad de la informacion

| # | Requisito | Cumple | Evidencia |
|---|---|---|---|
| 12.1 | Establecer y publicar politica de seguridad | Si | policies/01-information-security-policy.md |
| 12.1.1 | Revisar politica al menos anualmente | Si | Revision semestral programada |
| 12.3.1 | Uso aceptable de tecnologias | Si | policies/08-acceptable-use-policy.md |
| 12.8 | Politica de gestion de proveedores | Si | policies/07-vendor-management-policy.md |
| 12.8.1 | Lista de proveedores de servicios | Si | Inventario en vendor-management-policy |
| 12.8.2 | Acuerdos escritos con proveedores | Si | ToS/DPA con Stripe, Supabase, Vercel |
| 12.8.3 | Proceso de due diligence de proveedores | Si | Evaluacion documentada en vendor-management-policy |
| 12.8.4 | Monitoreo de compliance de proveedores | Si | Revision trimestral programada |
| 12.8.5 | Info de que PCI-DSS reqs gestiona cada proveedor | Si | Stripe/Clip/MercadoPago gestionan 100% de datos de tarjeta |
| 12.10.1 | Plan de respuesta a incidentes | Si | policies/03-incident-response-plan.md |

## Declaracion de cumplimiento

Fullsite Technologies S.A. de C.V. declara que:

1. Todas las funciones de procesamiento, almacenamiento y transmision de datos de tarjeta estan completamente delegadas a procesadores certificados PCI-DSS (Stripe, Clip, MercadoPago).

2. Nuestros sistemas no almacenan, procesan ni transmiten datos de tarjeta en ningun formato (numero de tarjeta, CVV, fecha de expiracion, datos de banda magnetica).

3. Hemos implementado los controles de seguridad requeridos por SAQ-A segun se documenta en este cuestionario.

4. Mantenemos politicas de seguridad de la informacion, gestion de proveedores y respuesta a incidentes conforme a los requisitos de PCI-DSS.

---

**Firmado por:** Daniel Ramonfaur, CEO
**Fecha:** 2026-05-25
**Proxima evaluacion:** 2027-05-25

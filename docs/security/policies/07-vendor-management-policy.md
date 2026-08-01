# Politica de Gestion de Proveedores

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Asegurar que los proveedores de servicios de Fullsite cumplan con estandares de seguridad adecuados y que los riesgos asociados a terceros sean identificados y gestionados.

## 2. Inventario de proveedores criticos

| Proveedor | Servicio | Datos que accede | Certificaciones | Riesgo |
|---|---|---|---|---|
| **Supabase** | Base de datos, autenticacion | Todos los datos de clientes | SOC 2 Type II | Critico |
| **Vercel** | Hosting, CDN, deployments | Codigo fuente, assets estaticos | SOC 2 | Alto |
| **Cloudflare** | DNS, WAF, DDoS protection | Trafico de red (no datos en reposo) | SOC 2, ISO 27001, PCI-DSS | Alto |
| **Anthropic** | API de IA (Claude) | Datos operativos en sesion (zero-retention) | SOC 2 | Medio |
| **GitHub** | Repositorio de codigo, CI/CD | Codigo fuente, secrets (encriptados) | SOC 2 | Alto |
| **Stripe/Clip/MercadoPago** | Procesamiento de pagos | Tokens de pago (no datos de tarjeta) | PCI-DSS | Alto |
| **Groq** | API de LLM (agentes) | Datos operativos en sesion | En evaluacion | Medio |
| **Telegram** | Notificaciones de agentes | Mensajes de reporte (datos agregados) | N/A | Bajo |
| **Facturapi/PAC** | Facturacion electronica | RFC, datos fiscales, CSD | SAT autorizado | Critico |

## 3. Evaluacion de proveedores

### Antes de contratar
1. Verificar certificaciones de seguridad (SOC 2, ISO 27001, PCI-DSS segun aplique)
2. Revisar politica de privacidad y terminos de servicio
3. Evaluar historial de incidentes de seguridad
4. Verificar ubicacion de datos y jurisdiccion legal
5. Evaluar plan de continuidad de negocio del proveedor

### Criterios minimos
- Proveedores que acceden a datos criticos: deben tener SOC 2 o equivalente
- Proveedores de pagos: deben ser PCI-DSS certificados
- Proveedores de facturacion: deben ser PAC autorizado por el SAT
- Todos: deben soportar encriptacion en transito (TLS)

## 4. Revision continua

| Frecuencia | Actividad |
|---|---|
| **Trimestral** | Revisar status de certificaciones de proveedores criticos |
| **Semestral** | Evaluar si hay alternativas mas seguras disponibles |
| **Anual** | Revision completa del inventario de proveedores |
| **Inmediata** | Si un proveedor reporta un breach o incidente |

## 5. Contratos y acuerdos

Todo proveedor critico debe tener:
- Terminos de servicio aceptados y archivados
- Clausula de proteccion de datos o DPA (Data Processing Agreement) cuando aplique
- SLA definido para disponibilidad y soporte
- Clausula de notificacion de breach

## 6. Acceso de proveedores

- Ningun proveedor tiene acceso directo a datos de clientes salvo lo necesario para el servicio
- Accesos de soporte de proveedores son temporales y auditados
- No se comparten credenciales de produccion con proveedores

## 7. Terminacion de proveedor

Al cambiar de proveedor:
1. Migrar datos al nuevo proveedor
2. Verificar que datos esten eliminados en el proveedor anterior
3. Revocar todos los accesos y tokens
4. Actualizar configuracion y documentacion
5. Notificar a clientes si el cambio afecta el servicio

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

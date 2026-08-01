# Politica de Seguridad de la Informacion

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Establecer el marco de seguridad de la informacion de Fullsite para proteger los datos de nuestros clientes, empleados y operaciones. Esta politica es el documento raiz del programa de seguridad y aplica a todos los sistemas, datos y personal de Fullsite.

## 2. Alcance

Esta politica aplica a:
- Todos los empleados, contratistas y terceros con acceso a sistemas de Fullsite
- Todos los sistemas de informacion, incluyendo infraestructura en la nube, codigo fuente, bases de datos y herramientas internas
- Todos los datos de clientes procesados por la plataforma Fullsite POS

## 3. Principios de seguridad

1. **Minimo privilegio**: cada persona y sistema tiene unicamente el acceso necesario para cumplir su funcion
2. **Defensa en profundidad**: multiples capas de controles de seguridad
3. **Seguridad por diseno**: la seguridad se incorpora desde el diseno, no como parche
4. **Zero trust**: no confiar implicitamente en ningun usuario, dispositivo o red
5. **Transparencia**: comunicar incidentes y riesgos de forma clara y oportuna

## 4. Clasificacion de datos

| Nivel | Descripcion | Ejemplos | Controles |
|---|---|---|---|
| **Critico** | Datos que, si se comprometen, causan dano directo al cliente | Credenciales, tokens de pago, CSD del SAT | Encriptacion AES-256, acceso restringido, audit log |
| **Confidencial** | Datos de negocio del cliente | Ventas, meseros, inventario, reportes | Encriptacion en transito/reposo, RLS, autenticacion |
| **Interno** | Datos operativos de Fullsite | Codigo fuente, configuraciones, logs | Control de acceso, repositorios privados |
| **Publico** | Informacion publicada intencionalmente | Pagina web, documentacion publica | Ninguno adicional |

## 5. Responsabilidades

### CEO (Daniel Ramonfaur)
- Aprobar politicas de seguridad y asignar recursos
- Revisar incidentes criticos y decisiones de riesgo
- Designar responsable de seguridad

### Responsable de Seguridad
- Mantener y actualizar politicas
- Coordinar evaluaciones de riesgo trimestrales
- Gestionar respuesta a incidentes
- Supervisar cumplimiento de controles

### Desarrolladores
- Seguir practicas de desarrollo seguro (OWASP Top 10)
- No commitear secretos en repositorios
- Reportar vulnerabilidades descubiertas
- Completar capacitacion de seguridad anual

### Todos los empleados
- Proteger credenciales de acceso
- Reportar incidentes de seguridad inmediatamente
- Completar capacitacion de seguridad en onboarding y anualmente
- No compartir accesos con terceros no autorizados

## 6. Controles tecnicos implementados

### Infraestructura
- **Hosting**: Vercel (SOC 2 certificado) con CDN global
- **Base de datos**: Supabase PostgreSQL (SOC 2 Type II) con encriptacion AES-256 en reposo
- **DNS/WAF**: Cloudflare con proteccion DDoS, WAF y DNSSEC
- **IA**: Anthropic Claude API (SOC 2) con zero-retention policy

### Aplicacion
- Row Level Security (RLS) para aislamiento multi-tenant
- Autenticacion JWT con expiracion automatica
- PIN por empleado en POS con roles granulares
- Audit trail inmutable para todas las acciones criticas

### Red
- TLS 1.3 obligatorio en todas las conexiones
- Rate limiting en APIs publicas
- CORS configurado por dominio
- Headers de seguridad (CSP, HSTS, X-Frame-Options)

## 7. Gestion de vulnerabilidades

- Dependencias escaneadas automaticamente via GitHub Dependabot
- Revisiones de codigo obligatorias antes de merge a main
- Divulgacion responsable disponible en seguridad@fullsite.mx
- Tiempo de respuesta: 48 horas habiles para vulnerabilidades reportadas

## 8. Capacitacion

- Onboarding de seguridad para todo nuevo empleado/contratista
- Capacitacion anual de concientizacion de seguridad
- Capacitacion especializada para desarrolladores (OWASP, secure coding)

## 9. Cumplimiento y sanciones

El incumplimiento de esta politica puede resultar en:
- Revocacion de accesos
- Accion disciplinaria
- Terminacion de contrato
- Acciones legales si aplica

## 10. Revision

Esta politica se revisa semestralmente o cuando ocurra:
- Un incidente de seguridad significativo
- Un cambio mayor en la infraestructura
- Un cambio regulatorio relevante
- Resultados de una evaluacion de riesgo

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

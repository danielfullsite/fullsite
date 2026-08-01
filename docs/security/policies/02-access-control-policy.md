# Politica de Control de Acceso

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Definir los controles para gestionar el acceso a los sistemas, datos e infraestructura de Fullsite, asegurando que solo personas autorizadas tengan acceso a los recursos que necesitan.

## 2. Principio de minimo privilegio

Todo acceso se otorga bajo el principio de minimo privilegio: cada usuario recibe unicamente los permisos necesarios para realizar su trabajo. No se otorgan permisos "por si acaso".

## 3. Gestion de identidades

### 3.1 Cuentas de empleados
- Cada empleado tiene una cuenta unica e intransferible
- Las cuentas se crean al inicio de la relacion laboral y se desactivan el mismo dia de la baja
- Cuentas compartidas estan prohibidas
- Cuentas genericas (admin@, info@) solo se permiten para servicios automatizados con dueno asignado

### 3.2 Autenticacion
- **Dashboard (clientes)**: email + contrasena con JWT, expiracion configurable
- **POS (empleados del restaurante)**: PIN unico de 4-6 digitos por empleado
- **Infraestructura (equipo Fullsite)**: autenticacion con MFA obligatorio en:
  - GitHub (repositorios de codigo)
  - Supabase (base de datos)
  - Vercel (hosting/deploys)
  - Cloudflare (DNS/WAF)
  - Telegram Bot (agentes operativos)

### 3.3 Contrasenas
- Minimo 8 caracteres para clientes
- Minimo 12 caracteres para equipo Fullsite
- No se almacenan en texto plano (bcrypt hash via Supabase Auth)
- No se transmiten sin encriptacion

## 4. Roles y permisos

### 4.1 Plataforma Fullsite (clientes)

| Rol | Permisos | Quien |
|---|---|---|
| **Admin** | Todo: configuracion, usuarios, datos, facturacion | Dueno del restaurante |
| **Gerente** | POS completo, reportes, cancelaciones, cortes | Gerente de sucursal |
| **Cajero** | POS: cobrar, abrir/cerrar caja, reimprimir tickets | Cajero |
| **Mesero** | POS: tomar ordenes, ver mesas asignadas | Mesero |

### 4.2 Infraestructura Fullsite (equipo interno)

| Rol | Acceso | Responsable |
|---|---|---|
| **Owner** | Todos los sistemas, secrets, produccion | CEO |
| **Developer** | Codigo, staging, logs (no produccion directa) | Desarrolladores |
| **Read-only** | Dashboards, metricas, logs (no escritura) | Soporte, analistas |

## 5. Aprovisionamiento y desaprovisionamiento

### Alta de acceso
1. Solicitud del manager directo
2. Aprobacion del responsable de seguridad
3. Creacion de cuenta con permisos minimos
4. Verificacion de MFA activado (equipo interno)
5. Registro en inventario de accesos

### Baja de acceso
1. Notificacion de RRHH o manager
2. Desactivacion de todas las cuentas el mismo dia
3. Revocacion de tokens y sesiones activas
4. Rotacion de secrets compartidos si aplica
5. Confirmacion documentada

### Cambio de rol
1. Solicitud del manager
2. Revision de permisos actuales vs requeridos
3. Ajuste de permisos (agregar nuevos, remover innecesarios)
4. Documentacion del cambio

## 6. Revision de accesos

- **Trimestral**: revision de todos los accesos a infraestructura
- **Semestral**: revision de roles y permisos de la plataforma
- **Inmediata**: tras cualquier incidente de seguridad
- **Automatica**: tokens JWT expiran automaticamente segun configuracion

## 7. Acceso remoto

- Todo acceso a sistemas de produccion requiere conexion encriptada (HTTPS/TLS)
- No se permite acceso directo a la base de datos desde redes publicas
- Las API keys de produccion se almacenan en GitHub Secrets y Vercel Environment Variables, nunca en codigo
- El acceso a la consola de Supabase requiere autenticacion con MFA

## 8. Acceso de terceros

- Terceros (contratistas, consultores) reciben acceso temporal con fecha de expiracion
- Acceso limitado al scope del proyecto
- NDA firmado antes de otorgar acceso
- Revision y revocacion al terminar el proyecto

## 9. Logs de acceso

- Todos los accesos a infraestructura se registran con timestamp, usuario y accion
- Logs de autenticacion retenidos por 90 dias minimo
- Accesos fallidos generan alerta despues de 5 intentos consecutivos
- Logs no son editables ni eliminables por usuarios regulares

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

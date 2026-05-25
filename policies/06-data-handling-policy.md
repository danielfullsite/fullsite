# Politica de Manejo de Datos

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Definir como Fullsite recolecta, almacena, procesa, transmite y elimina datos, asegurando la proteccion de la informacion de clientes y el cumplimiento regulatorio.

## 2. Tipos de datos que procesamos

| Tipo | Ejemplos | Clasificacion | Retencion |
|---|---|---|---|
| **Datos de autenticacion** | Email, contrasena (hash), JWT tokens | Critico | Mientras la cuenta exista |
| **Datos operativos** | Ventas, tickets, mesas, ordenes, inventario | Confidencial | Mientras el cliente tenga contrato |
| **Datos de empleados (del cliente)** | Nombre, PIN, rol, ventas, propinas | Confidencial | Mientras el cliente tenga contrato |
| **Datos fiscales** | RFC, CSD, CFDI emitidos, XMLs | Critico | 5 anos (obligacion fiscal SAT) |
| **Datos de contacto** | Nombre, telefono, email de reservaciones | Confidencial | Mientras el cliente tenga contrato |
| **Logs y telemetria** | Acciones en POS, audit trail, logs de agentes | Interno | 90 dias (logs), indefinido (audit trail) |
| **Datos de IA** | Prompts enviados a Anthropic, respuestas | Interno | No retenidos (zero-retention en Anthropic API) |

## 3. Principios de manejo

1. **Minimizacion**: solo recolectar datos necesarios para la funcion
2. **Proposito limitado**: usar datos solo para el proposito declarado
3. **Precision**: mantener datos actualizados y correctos
4. **Seguridad**: proteger datos segun su clasificacion
5. **Transparencia**: informar al cliente que datos recolectamos y por que

## 4. Almacenamiento

### 4.1 Base de datos (Supabase)
- Encriptacion en reposo: AES-256
- Encriptacion en transito: TLS 1.3
- Aislamiento: Row Level Security (RLS) por cliente
- Ubicacion: region configurada en Supabase
- Acceso: solo via API autenticada o consola con MFA

### 4.2 Codigo fuente (GitHub)
- Repositorio privado
- No se almacenan datos de clientes en el repositorio
- Secrets y tokens en GitHub Secrets, nunca en codigo

### 4.3 Archivos temporales
- Archivos de exportacion (CSV) se generan bajo demanda y se eliminan despues de descarga
- No se almacenan copias de datos en dispositivos locales

## 5. Transmision

- Toda transmision de datos usa TLS 1.3 (HTTPS)
- APIs internas y externas forzadas a HTTPS
- No se transmiten datos por canales no encriptados (email plano, HTTP, FTP)
- Tokens de pago se manejan via tokenizacion — nunca pasan por nuestros servidores

## 6. Datos de tarjetas de pago

**Fullsite NO almacena, procesa ni transmite datos de tarjetas de credito o debito.**

Los pagos con tarjeta se procesan a traves de tokenizadores certificados PCI-DSS:
- Stripe
- Clip
- MercadoPago

El POS solo recibe un token de confirmacion. Los datos reales de la tarjeta nunca tocan nuestros servidores.

## 7. Datos de IA

- Los datos operativos se envian a Anthropic Claude API unicamente durante la sesion de consulta
- Anthropic opera con zero-retention policy en su API comercial: no almacena prompts ni respuestas
- No se envian datos de autenticacion ni datos fiscales a la API de IA
- No se usan datos de clientes para entrenar modelos

## 8. Eliminacion y retencion

### Retencion por defecto
- Datos operativos: mientras el cliente tenga contrato activo
- Datos fiscales (CFDI, XMLs): 5 anos desde emision (obligacion SAT)
- Logs de sistema: 90 dias
- Audit trail: indefinido (requerido para compliance)
- Backups: 30 dias (rotacion automatica)

### Eliminacion al terminar contrato
1. Cliente solicita baja
2. Se ofrece exportacion completa de datos (CSV)
3. Datos operativos se eliminan dentro de 30 dias posteriores a la baja
4. Datos fiscales se retienen por 5 anos (obligacion legal)
5. Backups se purgan naturalmente por rotacion (30 dias)
6. Confirmacion escrita de eliminacion al cliente

### Derecho de eliminacion (ARCO)
- Clientes pueden solicitar eliminacion de datos personales conforme a LFPDPPP
- Solicitudes se procesan dentro de 20 dias habiles
- Excepciones: datos requeridos por obligacion legal (fiscales)

## 9. Transferencia internacional

- Los datos se almacenan en la region configurada de Supabase
- Vercel CDN puede servir contenido desde cualquier region, pero los datos persisten en la region primaria
- Las consultas de IA se envian a servidores de Anthropic (Estados Unidos) — solo datos operativos, en sesion, sin retencion

## 10. Datos de prueba

- No se usan datos reales de clientes en entornos de desarrollo o testing
- Entornos de prueba usan datos sinteticos
- Si se requieren datos reales para debugging, se anonimizan primero

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

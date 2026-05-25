# Politica de Logging y Monitoreo

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Definir los requisitos de logging y monitoreo para detectar, investigar y responder a eventos de seguridad y operativos en los sistemas de Fullsite.

## 2. Que se registra

### 2.1 Eventos de autenticacion
- Login exitoso y fallido (dashboard y POS)
- Cambio de contrasena o PIN
- Creacion y eliminacion de cuentas
- Sesiones expiradas o revocadas

### 2.2 Acciones criticas en POS
- Cancelaciones de ordenes (quien, cuando, monto, PIN de autorizacion)
- Descuentos aplicados (quien, porcentaje, PIN de autorizacion)
- Voids y devoluciones
- Apertura y cierre de caja (corte)
- Cambio de mesa o reabrir cuenta
- Reimprimir ticket

### 2.3 Acceso a infraestructura
- Acceso a consola de Supabase
- Deployments en Vercel
- Cambios en configuracion de Cloudflare
- Commits y merges en GitHub
- Ejecucion de agentes autonomos (agent_runs)

### 2.4 Eventos de seguridad
- Intentos de acceso no autorizado
- Cambios en permisos o roles
- Errores de API (4xx, 5xx)
- Rate limiting activado
- WAF rules triggered

## 3. Formato de logs

Cada entrada de log debe incluir:
- **Timestamp**: ISO 8601 con timezone (UTC)
- **Actor**: usuario, sistema o agente que ejecuto la accion
- **Accion**: que se hizo
- **Recurso**: sobre que se hizo (tabla, registro, endpoint)
- **Resultado**: exitoso o fallido
- **Contexto**: IP, user agent, session ID cuando aplique

## 4. Almacenamiento y retencion

| Tipo de log | Ubicacion | Retencion |
|---|---|---|
| Audit trail POS | Supabase (tabla dedicada) | Indefinido |
| Logs de aplicacion | Vercel Logs | 30 dias |
| Logs de WAF | Cloudflare | 72 horas (free) |
| Logs de base de datos | Supabase Logs | 7 dias |
| Ejecucion de agentes | Supabase (agent_runs) | Indefinido |
| Logs de CI/CD | GitHub Actions | 90 dias |

## 5. Monitoreo

### 5.1 Monitoreo automatico

| Que | Como | Alerta |
|---|---|---|
| Disponibilidad del sitio | Uptime checks (Vercel/externo) | Si downtime > 5 minutos |
| Staleness de datos Wansoft | wansoft-staleness agent (8am diario) | Si sync > 24 horas |
| Anomalias en metricas | anomaly_detector agent (2pm, 4pm, 6pm) | Si metrica fuera de patron |
| Errores en agentes | agent_runs con status=error | Si falla > 2 veces consecutivas |
| Reservas sin confirmar | reservas-pendientes agent (10am) | Si hay reservas pending |

### 5.2 Monitoreo manual
- Revision semanal de logs de acceso a infraestructura
- Revision mensual de agent_runs para detectar patrones
- Revision trimestral de eventos de seguridad

## 6. Alertas

### Severidad de alertas

| Severidad | Ejemplo | Canal | Tiempo de respuesta |
|---|---|---|---|
| **Critica** | Downtime de produccion, breach detectado | Telegram inmediato + llamada | < 1 hora |
| **Alta** | 5+ intentos de login fallidos, error persistente en agente | Telegram inmediato | < 4 horas |
| **Media** | Staleness de datos, agente fallido | Telegram morning briefing | < 24 horas |
| **Baja** | Dependencia vulnerable, warning de performance | Daily briefing | < 72 horas |

## 7. Proteccion de logs

- Los logs no pueden ser modificados ni eliminados por usuarios regulares
- Audit trail es append-only (no UPDATE, no DELETE)
- Acceso a logs de produccion restringido a personal autorizado
- Logs no contienen datos sensibles (passwords, tokens de pago, numeros de tarjeta)

## 8. Investigacion forense

En caso de incidente de seguridad:
1. Preservar logs antes de cualquier accion de remediacion
2. Exportar logs relevantes del periodo del incidente
3. Analizar timeline de eventos
4. Documentar hallazgos en reporte de incidente
5. Retener logs del incidente por minimo 1 ano

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

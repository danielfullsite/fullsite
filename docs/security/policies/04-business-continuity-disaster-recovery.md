# Plan de Continuidad de Negocio y Recuperacion ante Desastres

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Asegurar la continuidad de los servicios de Fullsite y la recuperacion rapida de datos y sistemas en caso de interrupcion, desastre o falla catastrofica.

## 2. Objetivos de recuperacion

| Metrica | Objetivo | Justificacion |
|---|---|---|
| **RTO** (Recovery Time Objective) | < 4 horas | Restaurantes operan en turnos — una interrupcion de medio turno es el maximo tolerable |
| **RPO** (Recovery Point Objective) | < 24 horas | Backups diarios automaticos; perdida maxima aceptable = 1 dia de datos |
| **Disponibilidad objetivo** | 99.9% mensual | ~43 minutos de downtime permitidos por mes |

## 3. Arquitectura de resiliencia

### 3.1 Hosting (Vercel)
- CDN distribuido globalmente con failover automatico
- Deployments inmutables — rollback instantaneo a version anterior
- Sin servidor unico de falla (serverless architecture)

### 3.2 Base de datos (Supabase)
- PostgreSQL con replicacion automatica
- Backups automaticos diarios con retencion de 30 dias
- Point-in-Time Recovery (PITR) disponible
- Region primaria con failover gestionado por Supabase

### 3.3 DNS/CDN (Cloudflare)
- DNS distribuido con anycast
- DDoS mitigation automatico
- Failover de DNS en < 5 minutos

### 3.4 Procesamiento IA (Anthropic)
- Fallback: si la API de Anthropic no esta disponible, las funciones de IA se degradan graciosamente
- El POS y dashboard operan sin IA — la funcionalidad core no depende de IA

## 4. Escenarios de desastre y respuesta

### Escenario 1: Caida de Vercel
- **Impacto**: Dashboard y POS web inaccesibles
- **Deteccion**: Monitoring automatico (uptime checks)
- **Respuesta**: Vercel tiene SLA de 99.99%; si falla > 30 min, evaluar deploy en proveedor alternativo
- **RTO**: < 1 hora (rollback) o < 4 horas (proveedor alternativo)

### Escenario 2: Caida de Supabase
- **Impacto**: Datos no accesibles, POS no puede registrar ventas
- **Deteccion**: Health checks automaticos, wansoft-staleness agent
- **Respuesta**: Supabase tiene SLA con failover automatico; si falla > 1 hora, restaurar backup en instancia alternativa
- **RTO**: < 2 horas
- **RPO**: < 24 horas (ultimo backup diario)

### Escenario 3: Compromiso de base de datos
- **Impacto**: Datos potencialmente expuestos o corrompidos
- **Deteccion**: Audit logs, alertas de acceso anomalo
- **Respuesta**: Seguir Plan de Respuesta a Incidentes, restaurar de PITR a punto antes del compromiso
- **RTO**: < 4 horas
- **RPO**: Minutos (PITR)

### Escenario 4: Eliminacion accidental de datos
- **Impacto**: Datos de cliente perdidos
- **Deteccion**: Reporte de usuario o monitoreo
- **Respuesta**: Restaurar tabla/rows especificos de backup diario o PITR
- **RTO**: < 2 horas

### Escenario 5: Falla de proveedor de pagos
- **Impacto**: No se pueden procesar pagos con tarjeta
- **Deteccion**: Errores en integracion de pagos
- **Respuesta**: El POS sigue funcionando — puede registrar ventas en efectivo y cobrar tarjeta manualmente
- **RTO**: Inmediato (degradacion graciosa)

## 5. Backups

| Que | Frecuencia | Retencion | Donde | Responsable |
|---|---|---|---|---|
| Base de datos completa | Diario (automatico) | 30 dias | Supabase (region primaria) | Automatico |
| Codigo fuente | Cada commit | Indefinida | GitHub (repositorio privado) | Automatico |
| Secrets y configuracion | Al cambiar | Version actual | GitHub Secrets + Vercel Env | CEO |
| Datos de clientes (export) | Bajo demanda | N/A | Entregado al cliente | Soporte |

## 6. Procedimiento de restauracion

### Restaurar base de datos desde backup
1. Acceder a Supabase Dashboard > Settings > Backups
2. Seleccionar backup mas reciente anterior al incidente
3. Iniciar restauracion (PITR si disponible, backup diario si no)
4. Verificar integridad de datos restaurados
5. Confirmar que la aplicacion funciona correctamente
6. Notificar a clientes afectados del periodo de datos perdidos (si aplica)

### Rollback de aplicacion
1. Acceder a Vercel Dashboard > Deployments
2. Identificar ultimo deployment funcional
3. Click "Promote to Production" en ese deployment
4. Verificar que el rollback funciona
5. Investigar causa del fallo en el deployment mas reciente

## 7. Pruebas

| Prueba | Frecuencia | Alcance |
|---|---|---|
| Restauracion de backup | Trimestral | Restaurar backup en entorno de prueba, verificar datos |
| Rollback de aplicacion | Trimestral | Hacer rollback en staging, verificar funcionalidad |
| Simulacro completo | Anual | Simular escenario de desastre end-to-end |

## 8. Comunicacion durante incidentes

- Clientes: notificacion via email y/o Telegram dentro de 1 hora de detectar interrupcion
- Status page: actualizar cada 30 minutos durante incidente activo
- Post-resolucion: comunicar causa raiz y acciones tomadas dentro de 48 horas

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

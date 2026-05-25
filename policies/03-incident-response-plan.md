# Plan de Respuesta a Incidentes

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Definir el proceso para detectar, contener, erradicar y recuperarse de incidentes de seguridad de forma rapida y coordinada, minimizando el impacto en clientes y operaciones.

## 2. Definicion de incidente

Un incidente de seguridad es cualquier evento que comprometa o amenace la confidencialidad, integridad o disponibilidad de los datos o sistemas de Fullsite, incluyendo:

- Acceso no autorizado a sistemas o datos
- Fuga o exposicion de datos de clientes
- Compromiso de credenciales o tokens
- Malware o codigo malicioso en sistemas
- Denegacion de servicio (DoS/DDoS)
- Vulnerabilidad explotada activamente
- Perdida o robo de dispositivos con acceso a sistemas

## 3. Clasificacion de severidad

| Severidad | Descripcion | Ejemplo | Tiempo de respuesta |
|---|---|---|---|
| **Critica (S1)** | Compromiso activo de datos de clientes o sistemas de produccion | Breach de base de datos, ransomware | Inmediata (< 1 hora) |
| **Alta (S2)** | Vulnerabilidad explotable sin evidencia de explotacion activa | SQL injection descubierta, credencial expuesta | < 4 horas |
| **Media (S3)** | Incidente contenido sin impacto en datos de clientes | Intento de acceso fallido masivo, phishing detectado | < 24 horas |
| **Baja (S4)** | Anomalia o debilidad sin riesgo inmediato | Dependencia vulnerable sin exploit conocido, policy violation menor | < 72 horas |

## 4. Equipo de respuesta

| Rol | Responsable | Responsabilidades |
|---|---|---|
| **Incident Commander** | CEO (Daniel Ramonfaur) | Decision final, comunicacion con clientes, coordinacion general |
| **Technical Lead** | Desarrollador senior | Investigacion tecnica, contencion, remediacion |
| **Comunicaciones** | CEO | Notificacion a clientes afectados, comunicacion publica si aplica |

## 5. Proceso de respuesta

### Fase 1: Deteccion e identificacion (0-30 min)

1. Recibir alerta (monitoreo automatico, reporte de usuario, divulgacion responsable)
2. Confirmar que es un incidente real (no falso positivo)
3. Clasificar severidad (S1-S4)
4. Notificar al Incident Commander
5. Crear canal de comunicacion dedicado (Telegram grupo privado)
6. Registrar timestamp de deteccion

### Fase 2: Contencion (30 min - 2 horas)

**Contencion inmediata:**
- Revocar credenciales comprometidas
- Bloquear IPs atacantes en Cloudflare WAF
- Deshabilitar cuentas sospechosas
- Aislar sistemas afectados

**Contencion a corto plazo:**
- Aplicar parches temporales
- Activar reglas de WAF adicionales
- Rotar secrets y tokens afectados
- Preservar evidencia (logs, snapshots)

### Fase 3: Erradicacion (2-24 horas)

1. Identificar causa raiz del incidente
2. Remover artefactos maliciosos
3. Parchear vulnerabilidad explotada
4. Verificar que la causa raiz esta eliminada
5. Rotar todas las credenciales potencialmente afectadas

### Fase 4: Recuperacion (24-72 horas)

1. Restaurar sistemas a operacion normal
2. Verificar integridad de datos
3. Monitorear de cerca por recurrencia
4. Confirmar que todos los controles estan operativos
5. Comunicar a clientes afectados el estado de resolucion

### Fase 5: Post-mortem (dentro de 5 dias)

1. Documentar timeline completo del incidente
2. Analizar causa raiz (5 Whys)
3. Identificar que funciono y que no en la respuesta
4. Definir acciones correctivas con responsable y fecha
5. Actualizar politicas/controles segun lecciones aprendidas
6. Archivar reporte de incidente

## 6. Comunicacion

### Interna
- Incidentes S1/S2: notificacion inmediata a todo el equipo
- Incidentes S3/S4: notificacion en siguiente reunion de equipo

### Clientes afectados
- S1 (breach confirmado): notificacion dentro de 72 horas conforme a LFPDPPP
- S2: notificacion si hay riesgo potencial para sus datos
- S3/S4: no requiere notificacion individual

### Reguladores
- Si aplica bajo LFPDPPP: notificacion al INAI dentro de 72 horas
- Documentar toda comunicacion con reguladores

## 7. Preservacion de evidencia

- No modificar ni eliminar logs de sistemas afectados
- Tomar snapshots de sistemas antes de remediar
- Documentar cada accion tomada con timestamp
- Preservar evidencia por minimo 1 ano

## 8. Contactos de emergencia

| Servicio | Contacto | Para que |
|---|---|---|
| Supabase Support | support@supabase.io | Incidentes en base de datos |
| Vercel Support | support@vercel.com | Incidentes en hosting |
| Cloudflare Emergency | Portal de soporte | DDoS, WAF bypass |
| INAI | www.inai.org.mx | Reporte regulatorio de breach |

## 9. Simulacros

- Simulacro de respuesta a incidentes cada 6 meses
- Incluir al menos un escenario S1 al ano
- Documentar resultados y areas de mejora

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

# Politica de Evaluacion de Riesgos

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Establecer el proceso para identificar, evaluar y gestionar riesgos de seguridad de la informacion en Fullsite de forma continua y sistematica.

## 2. Frecuencia

| Actividad | Frecuencia |
|---|---|
| Evaluacion completa de riesgos | Anual |
| Revision de riesgos existentes | Trimestral |
| Evaluacion ad-hoc | Al introducir nuevo sistema, proveedor o funcionalidad significativa |

## 3. Metodologia

### 3.1 Identificacion de riesgos
- Amenazas externas: ataques, breach de proveedor, regulacion
- Amenazas internas: error humano, acceso indebido, fuga de datos
- Amenazas tecnicas: vulnerabilidades, dependencias, configuracion
- Amenazas operativas: downtime, perdida de datos, falla de proveedor

### 3.2 Evaluacion

Cada riesgo se evalua en dos dimensiones:

**Probabilidad:**
| Nivel | Descripcion | Criterio |
|---|---|---|
| 1 - Raro | Muy improbable | < 1 vez en 5 anos |
| 2 - Improbable | Poco probable | 1 vez en 2-5 anos |
| 3 - Posible | Puede ocurrir | 1 vez al ano |
| 4 - Probable | Esperado | Varias veces al ano |
| 5 - Casi seguro | Muy frecuente | Mensual o mas |

**Impacto:**
| Nivel | Descripcion | Criterio |
|---|---|---|
| 1 - Minimo | Sin impacto en clientes | Error interno menor |
| 2 - Menor | Molestia temporal | Downtime < 1 hora |
| 3 - Moderado | Interrupcion de servicio | Downtime > 1 hora, datos parciales |
| 4 - Mayor | Perdida de datos o breach | Datos de clientes comprometidos |
| 5 - Catastrofico | Breach masivo, cierre | Todos los datos expuestos, legal |

**Riesgo = Probabilidad x Impacto**

| Score | Nivel | Accion |
|---|---|---|
| 1-4 | Bajo | Aceptar y monitorear |
| 5-9 | Medio | Mitigar con controles, revisar trimestralmente |
| 10-15 | Alto | Mitigar urgentemente, revisar mensualmente |
| 16-25 | Critico | Mitigar inmediatamente, escalar a CEO |

## 4. Registro de riesgos actual

| # | Riesgo | P | I | Score | Mitigacion | Status |
|---|---|---|---|---|---|---|
| R1 | Breach de base de datos | 2 | 5 | 10 | RLS, encriptacion, backups, WAF | Mitigado |
| R2 | Credencial de produccion expuesta | 3 | 4 | 12 | GitHub Secrets, rotacion, MFA | Mitigado |
| R3 | Dependencia con vulnerabilidad critica | 3 | 3 | 9 | Dependabot, actualizaciones rapidas | Mitigado |
| R4 | Caida de Supabase | 2 | 4 | 8 | Backups diarios, PITR, SLA de Supabase | Mitigado |
| R5 | Empleado de cliente roba datos | 2 | 3 | 6 | Roles POS, audit trail, PIN por accion | Mitigado |
| R6 | DDoS attack | 2 | 3 | 6 | Cloudflare DDoS protection, WAF | Mitigado |
| R7 | Error humano borra datos | 3 | 3 | 9 | Backups, PITR, confirmaciones en UI | Mitigado |
| R8 | Proveedor de IA (Anthropic) no disponible | 3 | 2 | 6 | Degradacion graciosa, POS funciona sin IA | Aceptado |
| R9 | Fuga de datos via API de IA | 2 | 3 | 6 | Zero-retention, no enviar datos criticos | Mitigado |
| R10 | Phishing a empleado de Fullsite | 3 | 3 | 9 | MFA obligatorio, capacitacion | Mitigado |

## 5. Tratamiento de riesgos

| Estrategia | Cuando usar | Ejemplo |
|---|---|---|
| **Mitigar** | Reducir probabilidad o impacto | Implementar MFA para reducir riesgo de credencial robada |
| **Transferir** | Pasar riesgo a tercero | Usar tokenizador PCI-DSS para pagos |
| **Aceptar** | Riesgo bajo o costo de mitigacion > beneficio | Aceptar riesgo de downtime de Anthropic API |
| **Evitar** | Eliminar la actividad riesgosa | No almacenar datos de tarjeta |

## 6. Responsabilidades

- **CEO**: aprobar evaluacion anual, decidir sobre riesgos criticos
- **Responsable de seguridad**: ejecutar evaluaciones, mantener registro, proponer mitigaciones
- **Desarrolladores**: identificar y reportar riesgos tecnicos

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

# Production Readiness Review v1

> **Score:** 4.7 / 10  
> **Fecha:** 2026-07-28  
> **Veredicto:** NO CERTIFICADO para Cliente #2  
> **Regla:** Solo actualizar hallazgos existentes. No expandir scope de este documento.

---

## Resumen ejecutivo

Fullsite está operando en producción en AMALAY (Cliente #1) pero no está listo para ser desplegado en un segundo cliente sin trabajo adicional. El score de 4.7/10 refleja que los bloqueantes críticos son de confiabilidad operacional, no de funcionalidad — el POS funciona, pero hay escenarios de fallo que no tienen procedimiento de recuperación documentado ni probado.

Los 27 hallazgos están clasificados en 3 niveles: P0 (bloquea deployment en Cliente #2), P1 (debe resolverse en el primer mes post-deployment), P2 (mejora deseable pero no bloqueante).

---

## Hallazgos por categoría

### Offline y resiliencia (P0 — bloquea Cliente #2)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-01 | Turno offline sin certificación de campo | OPEN |
| PRR-02 | sync_queue no tiene retry con backoff — pérdida silenciosa posible | FIXED `dacf364` — slow-retry backoff (60s→5min) + evento `pos-sync-degraded` al operador; 8 tests incl. soak 4h simulado. Pendiente retest físico |
| PRR-03 | Conflictos de sincronización multi-terminal sin resolución documentada | OPEN |
| PRR-04 | Recovery de impresora falla si el bridge se reinicia durante operación | FIXED `80a8d7d` — jobs en `printing` al crash se reviven a `retrying`/`recoverable` en init(); 6 tests. Pendiente retest físico |

### Aprovisionamiento (P0 — bloquea Cliente #2)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-05 | onboard_client.py requiere intervención manual de Daniel en 4 pasos | OPEN |
| PRR-06 | No hay smoke test automatizado post-provisioning | OPEN |
| PRR-07 | Configuración de menú no es transferible entre clientes sin SQL manual | OPEN |

### Operaciones y soporte (P0 — bloquea Cliente #2)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-08 | No hay playbook de "POS no arranca" para soporte remoto | OPEN |
| PRR-09 | No hay Manager Panel para diagnóstico sin acceso a código | OPEN |
| PRR-10 | Rollback de Electron app no está documentado | OPEN |

### Seguridad (P1)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-11 | PIN de caja no tiene rate limiting a nivel server | OPEN |
| PRR-12 | Logs de audit no están protegidos contra edición por rol manager | OPEN |
| PRR-13 | Backup automático de IDB no confirmado en todos los dispositivos | OPEN |

### Confiabilidad fiscal (P1)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-14 | P0-3 (CSD Facturapi) no certificado en producción | OPEN — bloqueado en SAT |
| PRR-15 | CFDI con IEPS requiere XML de Wansoft que no se tiene | OPEN — bloqueado upstream |
| PRR-16 | Factura de cortesía no tiene flujo documentado | OPEN |

### Documentación operacional (P1)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-17 | Guía de cajero incompleta — secciones "Pendiente de documentar" | OPEN |
| PRR-18 | Guía de mesero no cubre el flujo de órdenes a cocina offline | OPEN |
| PRR-19 | AMALAY Shadow Day no ejecutado con equipo de Cliente #2 | OPEN |

### Platform y multi-tenant (P1)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-20 | 13 bugs en BUGS.md con descripción "Pendiente de documentar" | OPEN |
| PRR-21 | Hardcodes P2/P3 en HARDCODE-REGISTRY.md no eliminados | OPEN |
| PRR-22 | Sandbox (`fullsite-warroom-staging`) no tiene monitoring activo | OPEN |

### UX y capacitación (P2)

| ID | Hallazgo | Estado |
|---|---|---|
| PRR-23 | Flujo de capacitación de meseros estimado en 2+ horas (meta: 30 min) | OPEN |
| PRR-24 | KDS no tiene modo "pausa" para eventos sin cocina | OPEN |
| PRR-25 | Split de cuenta por persona no implementado | OPEN |
| PRR-26 | Reimpresión de ticket sin autorización de gerente posible | OPEN |
| PRR-27 | No hay modo "demo" sin datos reales de producción | OPEN |

---

## Criterios de certificación para PRR v2

Para alcanzar PRR v2 (objetivo: 7.5/10), los siguientes grupos deben estar CLOSED:

1. **Todos los P0** (PRR-01 a PRR-10) — bloquea absolutamente
2. **PRR-20** (bugs documentados) — bloquea confianza en el sistema
3. **PRR-19** (Shadow Day) — bloquea aprendizaje operacional del Cliente #2

Los P1 de seguridad (PRR-11/12/13) pueden cerrarse en el primer mes post-deployment bajo supervisión.

---

## Relación con otras certificaciones

- **P0-4** en `state/CERTIFICATIONS.md` debe estar CERTIFIED antes de cerrar PRR-01/02/03.
- **OFFLINE-SUITE-v1.md** define los criterios específicos para PRR-01.
- **`customers/amalay/DEPLOYMENT-STATE.md`** documenta el estado físico actual que informa PRR-04/08/09.

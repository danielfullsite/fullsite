> ⚠️ **DOCUMENTO HISTÓRICO / DESACTUALIZADO** (snapshot de julio 2026 — verificar antes de citar).
> Estado real vigente: docs/pos/PLAN-INSTALACION-AMALAY-JUEVES.md (topología y versiones reales; este doc dice "Tablet+Chrome" y "offline pendiente" — ambos falsos hoy).

# AMALAY — Estado de Deployment

> Documento vivo. Actualizar con cada visita.  
> **Última actualización:** 2026-07-31  
> **Estado:** Producción activa. Offline: CODE ONLY — pendiente certificación de campo (Fase 5).

---

## Datos del cliente

| Campo | Valor |
|---|---|
| Nombre | AMALAY Restaurante |
| RFC | AFO200806JI0 |
| Razón social | AMALAY FOOD OPERATIONS, SA de CV |
| CP | 66220 (San Pedro Garza García, NL) |
| Régimen | 601 |
| Contacto principal | Eduardo Esquivel |
| POS anterior | Wansoft ($1,500 MXN/mes) |
| client_id | `amalay` |
| Supabase ref | `qjiomlvudfmzuvqvhwpk` (NUNCA tocar directo) |

---

## Topología de hardware

| Dispositivo | Modelo / Descripción | Estado | Notas |
|---|---|---|---|
| Terminal POS principal | Tablet + Chrome (mostrador) | Activo | Turno abierto aquí |
| Terminal meseros | Tablet + Chrome (piso) | Activo | Toma órdenes |
| KDS Cocina | Tablet en cocina | Activo | Recibe comandas |
| KDS Barra | Tablet en barra | Activo | Recibe bebidas |
| Impresora POS | EC-PM-80250 (térmica 80mm) | Activo | Tickets de caja |
| Impresora Cocina | Térmica (red) | Activo | Comandas cocina |
| Cajón de dinero | Conectado a impresora POS | Activo | Apertura automática en cobro |
| Terminal bancaria | Mercado Pago Point | Activo | Pagos con tarjeta |
| Router | — | Activo | WiFi para todas las terminales |

---

## Estado por P0/P1/P2

### P0 — Bloquea operación normal

| ID | Descripción | Estado | Blocker |
|---|---|---|---|
| P0-1 | Concurrencia multi-terminal sin pérdida de órdenes | CERTIFIED | commit 91379b5 |
| P0-2 | Recovery de RecoverableOperation (MP Point) | CERTIFIED | commit 672871a |
| P0-3 | CSD Facturapi para CFDI 4.0 | OPEN | Andy tramita ante SAT |
| P0-4 | Turno offline certificado (campo) | OPEN | Fase 5 pendiente |

### P1 — Debe resolverse en el primer mes

| ID | Descripción | Estado |
|---|---|---|
| P1-01 | Multi-terminal en el mismo turno (2 tablets paralelas) | OPEN |
| P1-02 | Huella digital del gerente para autorizar en lugar de PIN | OPEN — hardware-contingent |
| P1-03 | Cajón de dinero abre automáticamente en cualquier impresora (no solo la principal) | OPEN |
| P1-04 | KDS sin conectividad — notificación visual de "sin cocina" | PASS |
| P1-05 | Reimpresión de comanda desde POS principal | PASS |

### P2 — Mejora deseable

| ID | Descripción | Estado |
|---|---|---|
| P2-01 | Split de cuenta por persona | OPEN |
| P2-02 | Modo "evento" para cobro anticipado | OPEN |
| P2-03 | Integración Uber Eats nativa | OPEN |

---

## Historial de visitas

### Visita 1 — Go-Live (2026-07-16)

- R1 Validation: **PASS** (12/12 criterios)
- Primer turno real en Fullsite
- Eduardo Esquivel capacitado en apertura/cierre
- Observaciones: cajón tardaba 2s en abrir — resuelt configurando baud rate

### Visita 2 — Seguimiento (2026-07-21)

- Primera sesión de food cost con Eduardo
- Ajuste de modificadores (cocina confirmó que los combos estaban incorrectos)
- KDS de cocina perdía conexión intermitente — identificado como WiFi inestable cerca del extractor
- Acción: mover router o usar cable para KDS cocina

### Visita 3 — Preflight P0-4 (2026-07-27)

- IDB v3 deployado (commit 7e17828: turnos + cash_movements stores)
- Prueba manual de offline básico: POS tomó órdenes sin internet ✓
- Sync al reconectar: 8 órdenes sincronizadas correctamente ✓
- **Pendiente:** prueba de 4 horas continuas (Fase 5 del Offline Certification Suite)

---

## Próximos pasos

1. **Certificación offline Fase 5** — ejecutar el runbook completo (`offline/RUNBOOK.md`) con hardware real de AMALAY. Target: primera semana de agosto.
2. **Resolución P0-3 (CSD)** — Andy debe obtener el CSD del SAT para configurar Facturapi. Fecha estimada: agosto 2026.
3. **P1-01 multi-terminal** — prueba con 2 tablets paralelas en hora pico.

---

## Instrucciones de emergencia (para el gerente)

Si el POS no arranca:
1. Cerrar Chrome completamente
2. Reabrir Chrome e ir a `app.fullsite.mx`
3. Si sigue sin funcionar: reiniciar la tablet
4. Si persiste: llamar a soporte (número en MANUAL-OPERATIVO.md)

Si el internet se cae:
- El POS sigue funcionando. Continuar operando normalmente.
- Al volver el internet, las órdenes se sincronizan automáticamente.
- No hay que hacer nada manual.

Si la impresora no imprime:
1. Verificar que el bridge de impresión está activo (icono en la taskbar del Windows)
2. Reiniciar el bridge (doble click → Restart)
3. Si sigue sin imprimir: usar la impresora de cocina como respaldo temporal

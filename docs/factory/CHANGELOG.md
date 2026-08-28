# Changelog / decision log — Fullsite Factory

> Orden cronológico inverso. Cada entrada: fecha, qué cambió, PR, y a qué **supersede**.
> "Abierto (PR)" ≠ "desplegado": ver estado en [`README.md`](README.md).

## 2026-08-27

- **Documentación viva formalizada** (Diátaxis) bajo `docs/factory/`, descubrible desde
  `docs/README.md`. Índice + estado vivo + referencia + ADRs + how-to + tutorial + runbooks +
  trazabilidad + plantilla de PR. · PR #197 (rama maestra). *Supersede:* nada; complementa el
  plan `FULLSITE-FACTORY.md`.

- **Segundo lote de interfaces abierto** (Impl · Probado local):
  - Offline métricas p50/p95 (motor + harness, sin tocar hot path). · PR #201
  - Wizard reanudable/idempotente, sin exportar secretos. · PR #202
  - Soporte con consentimiento/RBAC/audit, sin shell. · PR #203
  - Autoconfig capabilities + confidence topado + fallback manual. · PR #204
  - Fullsite IQ read-only + preview/diff, nada autónomo. · PR #205

- **Camino crítico + turnos abiertos** (Impl · Probado local):
  - Contratos + envelope v2 (tenant+location+device+shift). · PR #197
  - Estaciones/routing por sucursal (apilado sobre #195). · PR #198
  - KDS aislado por location+shift (apilado sobre #198). · PR #199
  - Turnos por sucursal + una caja activa + corte Z (aditivo). · PR #200

- **Modelo de dispositivos: identidad generada por la plataforma.** El POST de alta dejó de
  aceptar `device_id` del cliente; se agregó el flujo enroll→claim con código de un solo uso
  hasheado. · PR #195. *Supersede:* el contrato previo de #195 que aceptaba `device_id` del body
  (ADR-0002).

- **Decisión: extender `pos_terminals`, no crear tabla `devices`.** · PR #195. *Supersede:* la
  propuesta inicial de PR-1 con tabla `devices` (ADR-0001).

- **Corrección de inspección (regla de la cita):** un agente reportó `pos_turnos` inexistente;
  verificado directo en el baseline que `pos_turnos`, `pos_staff_shifts`, `pos_cash_movements`,
  `pos_cierres`, `pos_cfdi_requests` **sí existen**. El Programa 5 pasó de "crear" a "extender".

## Pendientes registrados (no abiertos como PR)

- **Programa 7 (skeleton multisucursal):** Diseñado, **sin PR** en este lote.
- **Persistir el envelope v2 en `events` + cerrar su RLS:** PR stacked posterior (ADR-0007 nota).
- **Wiring de Electron** (métricas en hot path, escaneo USB/HID, `location_id` obligatorio en
  `config-schema.js`): PR(s) de local-server con instalador (ADR-0006).
- **Endurecimiento de migraciones** (`NOT NULL` + backfill): ver
  `supabase/migrations/README-pos-terminals-endurecimiento.md`.
- **Ejecución confirmada** de propuestas de soporte/IQ: endpoints separados.

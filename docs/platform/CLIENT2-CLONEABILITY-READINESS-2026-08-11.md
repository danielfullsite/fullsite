# Client #2 + Cloneability Readiness — 2026-08-11

Scope: avanzar hacia 100% sin contar Field Batch offline físico de AMALAY.

## Score reproducible

Ejecutar:

```bash
python3 scripts/onboarding/readiness_report.py --scope client2-clone
```

Resultado actual:

- Overall sin offline físico: **75%**
- Client #2: **64%**
- Cloneability: **86%**

## Qué ya está cerrado

- Café Nómada (`client_id=nomada`) existe como tenant sintético de staging.
- Seeds canónicos existen: `scripts/seed/nomada/v1_*.sql`.
- Verificación E2E read-only existe: `scripts/onboarding/verify_nomada_e2e.sql`.
- Verificación RLS/JWT existe: `scripts/onboarding/tenant_jwt_smoke.py`.
- Guardrails anti-producción existen (`qjiomlvudfmzuvqvhwpk` abort en scripts sandbox).
- PR #23 delivery/KDS está verde: GitHub tests PASS + Vercel PASS.
- No hay hardcodes runtime críticos de AMALAY en la ruta de clonabilidad escaneada.
- Demo Nómada está marcada como `DEMO / DATOS SINTÉTICOS` en evidencia local.

## Bloqueadores reales

### B1 — URL pública navegable de Client #2

Estado: **BLOCKER**

La evidencia actual de UI Nómada es local/preview protegido, no URL comercial abierta.

Requisito para PASS:

- URL pública accesible.
- Login Nómada real.
- Pantallas etiquetadas “DEMO / DATOS SINTÉTICOS”.
- Red sin requests a producción AMALAY (`qjiomlvudfmzuvqvhwpk`).

### B2 — Flujo manual hosted completo

Estado: **BLOCKER**

Falta ejecutar en URL pública:

`login → PIN → abrir turno → agregar producto → enviar a KDS → cobrar → corte → refrescar`

Requisito para PASS:

- Captura/video de cada paso.
- Order ID.
- Monto.
- Corte.
- Refresh mostrando persistencia.

### B3 — Demo deployment repeatable

Estado: **BLOCKER**

Existe handoff para deploy público Nómada, pero todavía no está convertido en artefacto repetible certificado.

Requisito para PASS:

- `onboard_client.py` + Vercel/DNS o preview público produce URL funcional sin pasos manuales ambiguos.
- Smoke JWT/RLS ejecutado con credenciales demo vigentes.

## Nota sobre credenciales demo

Las credenciales históricas documentadas para Nómada no autenticaron contra staging durante este check. El smoke JWT está listo, pero requiere contraseña demo vigente.

Comando:

```bash
set -a
source /private/tmp/tenant_jwt_smoke.env
set +a
python3 scripts/onboarding/tenant_jwt_smoke.py
```

Usar `scripts/onboarding/tenant_jwt_smoke.env.example` como plantilla, sin commitear secretos.

## Próxima acción que sube más el porcentaje

Crear o desbloquear una URL pública de staging para `nomada` y correr el flujo manual hosted. Eso sube Client #2 de 64% a ~90% y cloneability general de 75% a ~90%.

## No tocado

- Producción AMALAY.
- DB producción.
- Offline frozen.
- Bridge.
- Ramas/worktrees de diseño.

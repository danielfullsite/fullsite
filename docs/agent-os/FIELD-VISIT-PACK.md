# FIELD VISIT PACK

*Actualizado: 2026-08-08T21:59:18Z*

## LOCATION: AMALAY
**Tiempo total estimado:** ~90 min · **Tareas:** 1 · **Gates desbloqueados:** REL-OFFLINE-FIELD

### 1. Certificación física offline OCS-P2.5.9 en AMALAY  (`REL-OFFLINE-FIELD`)
- **Por qué:** Único gate que valida offline real en hardware real; bloquea GO-LIVE Client #2
- **Tiempo:** 90 min
- **Preparación de agentes:** Field Package v2 canónico (v1.3.4), THURSDAY-RUNBOOK.md, OFFLINE-TEST-MATRIX.md, FIELD-KIT scripts listos
- **Haz exactamente:**
  1. Lleva laptop + USB con FULLSITE-FIELD-KIT (docs/agent-os/field/)
  2. Sigue docs/agent-os/field/THURSDAY-RUNBOOK.md paso a paso
  3. Ejecuta cada escenario de OFFLINE-TEST-MATRIX.md y anota PASS/FAIL
  4. Ante un FAIL: detén el caso, captura evidencia (RUN-CERT-CAPTURE.cmd) y continúa con el siguiente escenario independiente
- **Resultado esperado:** Matriz completa con PASS/FAIL por escenario + capturas
- **Evidencia a regresar:** Fotos de tickets, archivo de captura del FIELD-KIT, matriz marcada
- **Fallback seguro:** ROLLBACK.ps1 del FIELD-KIT restaura el estado previo; el POS de AMALAY sigue en su versión actual si no instalas

Para marcar completada:
```
python3 scripts/agent-os/agent_company.py human-done <GATE-ID> "evidencia"
```

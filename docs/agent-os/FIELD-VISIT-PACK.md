# FIELD VISIT PACK

*Actualizado: 2026-08-09T01:31:31Z*

## LOCATION: AMALAY
**Tiempo total estimado:** ~120 min · **Tareas:** 2 · **Gates desbloqueados:** REL-OFFLINE-FIELD, REL-INSTALLER

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

### 2. Preflight físico del installer v1.3.4 en hardware Windows  (`REL-INSTALLER`)
- **Por qué:** El build GHA verifica silent-install en runner limpio, pero la certificación requiere hardware real (impresora, cold start, offline)
- **Tiempo:** 30 min
- **Preparación de agentes:** Build GREEN run 31288311728; artifact fullsite-pos-win-678d7d47e49cf57c7ff7a2d0e84de0bb6f8a80a7 listo para descarga (gh run download 31288311728 -n fullsite-pos-win-678d7d47e49cf57c7ff7a2d0e84de0bb6f8a80a7); SHA256.txt incluido
- **Haz exactamente:**
  1. Descarga el artifact del run 31288311728 (o el que indique el gate) y cópialo al USB del FIELD-KIT
  2. Verifica SHA-256 contra SHA256.txt antes de instalar
  3. Instala en la terminal Windows de AMALAY siguiendo INSTALLER-VERIFICATION.md
  4. Ejecuta escenarios de preflight: cold start, restart, offline, sync, sin duplicados, logs
- **Resultado esperado:** Installer v1.3.4 instalado y preflight PASS en hardware real
- **Evidencia a regresar:** SHA-256 verificado + resultado por escenario + foto de ticket de prueba
- **Fallback seguro:** ROLLBACK.ps1 + PRE-INSTALL-BACKUP.ps1 del FIELD-KIT restauran el estado previo

Para marcar completada:
```
python3 scripts/agent-os/agent_company.py human-done <GATE-ID> "evidencia"
```

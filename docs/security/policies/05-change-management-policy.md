# Politica de Gestion de Cambios

**Fullsite Technologies S.A. de C.V.**
Version: 1.0
Fecha de vigencia: 2026-05-25
Proxima revision: 2026-11-25
Aprobado por: Daniel Ramonfaur, CEO

---

## 1. Proposito

Asegurar que todos los cambios a los sistemas de produccion de Fullsite se realicen de forma controlada, revisada y rastreable, minimizando el riesgo de interrupciones o vulnerabilidades.

## 2. Alcance

Esta politica aplica a todos los cambios en:
- Codigo fuente de la aplicacion (dashboard, POS, API)
- Configuracion de infraestructura (Vercel, Supabase, Cloudflare)
- Esquema de base de datos (migraciones)
- Variables de entorno y secrets
- Dependencias y paquetes
- Workflows de CI/CD (GitHub Actions)
- Agentes autonomos y sus configuraciones

## 3. Clasificacion de cambios

| Tipo | Descripcion | Aprobacion | Ejemplo |
|---|---|---|---|
| **Standard** | Cambio de bajo riesgo, pre-aprobado | Autor + code review | Bug fix, UI tweak, nueva feature aislada |
| **Normal** | Cambio con riesgo moderado | Autor + code review + aprobacion explicita | Migracion de BD, cambio de arquitectura, nueva integracion |
| **Emergencia** | Cambio urgente para resolver incidente activo | Post-facto review dentro de 24 horas | Hotfix de vulnerabilidad, rollback de produccion |

## 4. Proceso de cambio standard/normal

### 4.1 Desarrollo
1. Crear branch desde `main`
2. Implementar cambio con tests cuando aplique
3. Verificar que no se incluyen secrets en el codigo
4. Verificar que no se introducen vulnerabilidades (OWASP Top 10)

### 4.2 Code review
1. Crear Pull Request en GitHub
2. Descripcion clara del cambio y su justificacion
3. Minimo 1 reviewer aprueba antes de merge
4. Reviewer verifica: funcionalidad, seguridad, performance, edge cases

### 4.3 Testing
1. Tests automatizados pasan en CI
2. Para cambios normales: verificar en staging/preview antes de produccion
3. Para migraciones de BD: verificar en entorno de prueba primero

### 4.4 Deploy
1. Merge a `main` activa deploy automatico via Vercel
2. Verificar que el deploy fue exitoso
3. Monitorear por 15 minutos post-deploy para detectar regresiones
4. Si hay problemas: rollback inmediato via Vercel dashboard

### 4.5 Documentacion
- El PR description y commits documentan el cambio
- Cambios significativos se reflejan en CHANGELOG
- Cambios de arquitectura se documentan en CLAUDE.md o docs

## 5. Proceso de cambio de emergencia

1. Implementar fix directamente en `main` si es necesario
2. Deploy inmediato
3. Crear PR retrospectivo documentando el cambio dentro de 24 horas
4. Code review post-facto dentro de 48 horas
5. Documentar en reporte de incidente si aplica

## 6. Cambios en base de datos

Las migraciones de base de datos tienen riesgo elevado y requieren:
1. Script de migracion revisado por al menos 1 persona
2. Backup de la tabla/base afectada antes de ejecutar
3. Script de rollback preparado antes de ejecutar
4. Ejecucion en horario de bajo trafico cuando sea posible
5. Verificacion de integridad de datos post-migracion

## 7. Cambios en secrets y configuracion

- Rotacion de secrets se documenta con fecha y razon
- Secrets viejos se revocan inmediatamente despues de rotar
- No se reutilizan secrets entre entornos (staging vs produccion)
- Cambios en variables de entorno se tratan como cambios normales

## 8. Rollback

- Todo deploy en Vercel es inmutable — rollback es instantaneo
- Para migraciones de BD: script de rollback debe existir antes de ejecutar
- Decision de rollback: si el cambio causa errores en produccion, rollback inmediato sin esperar investigacion

## 9. Audit trail

Todos los cambios quedan registrados en:
- **Git history**: commits con autor, fecha, mensaje y diff
- **GitHub PRs**: discusion, review, aprobacion
- **Vercel**: historial de deployments con commit asociado
- **Supabase**: logs de migraciones ejecutadas

---

**Historial de cambios**

| Version | Fecha | Cambio | Autor |
|---|---|---|---|
| 1.0 | 2026-05-25 | Creacion inicial | Daniel Ramonfaur |

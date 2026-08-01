# Release — Build y distribución del Electron app

Cómo construir una nueva versión del POS y distribuirla a los restaurantes activos.

---

## Versioning

Formato: `MAJOR.MINOR.PATCH` (semver)

| Tipo | Cuándo incrementar |
|---|---|
| PATCH | Bug fixes sin cambios de API/schema |
| MINOR | Features nuevas backward-compatible |
| MAJOR | Cambios de schema de IDB o rotura de compatibilidad |

Versión actual: ver `electron-app/package.json` → campo `version`.

**Regla crítica:** un cambio de schema de IDB (nueva store, nuevo índice) siempre es MINOR o MAJOR. Requiere migration automática en el startup del Electron.

---

## Antes de hacer el release

Checklist pre-release:
- [ ] Todos los P0 activos en `state/BUGS.md` están CLOSED o tienen workaround documentado
- [ ] Los tests pasan: `cd dashboard-app && bun test`
- [ ] El build de Electron no tiene errores: `cd electron-app && npm run build`
- [ ] La versión en `electron-app/package.json` está actualizada
- [ ] El CHANGELOG tiene entrada para esta versión
- [ ] Si hay cambio de schema IDB: la migration está implementada y probada

---

## Build del Electron app

```bash
cd electron-app
npm install
npm run build
# Genera: dist/Fullsite-X.Y.Z-Setup.exe (Windows)
#          dist/Fullsite-X.Y.Z.dmg (Mac, si aplica)
```

El build de producción usa:
- `electron-builder` para packaging
- Los secrets de producción vienen de variables de entorno (no hardcodeados)
- El `.exe` se firma digitalmente si está configurado el certificado de código

---

## Distribución

**Método actual:** distribución manual via link de descarga.

Proceso:
1. Subir el `.exe` a Google Drive (carpeta compartida con restaurantes activos)
2. Enviar WhatsApp a los gerentes con el link y las instrucciones
3. El gerente descarga e instala (requiere cerrar el Electron actual primero)

**Instrucciones para el gerente:**
1. Cerrar el POS (el ícono de la bandeja → Exit)
2. Descargar el nuevo instalador
3. Ejecutar el instalador (doble click en el `.exe`)
4. El instalador actualiza automáticamente sin borrar datos
5. Reabrir el POS

---

## Verificación post-release

Después de que el gerente instala:
1. Verificar que la versión correcta aparece en `Configuración → Acerca de`
2. Abrir turno y tomar una orden de prueba
3. Verificar que la impresión funciona
4. Si hay cambio de IDB schema: verificar que los datos anteriores están intactos

---

## Rollback

Si la nueva versión tiene un problema crítico:
1. Tener el instalador de la versión anterior guardado en Google Drive
2. El gerente reinstala la versión anterior siguiendo el mismo proceso
3. Los datos de IDB no se pierden (el rollback no afecta la DB local)
4. Supabase siempre está en la versión más reciente — el Electron app es backward-compatible

**Regla de compatibilidad:** el Electron app debe ser backward-compatible con la API de Supabase por al menos 2 versiones MINOR anteriores. Esto permite rollback sin coordinación de versiones.

---

## Automatización futura

El proceso actual es manual. El roadmap incluye:
- Auto-update via `electron-updater` (el app verifica si hay nueva versión al arrancar)
- Canal de distribución: GitHub Releases o un bucket S3
- Rollout gradual: actualizar primero el sandbox, luego AMALAY, luego nuevos clientes

Hasta que eso esté implementado, el proceso manual de arriba es el único método.

---

## Archivos relevantes

| Archivo | Descripción |
|---|---|
| `electron-app/package.json` | Versión actual y dependencias |
| `electron-app/main.js` | Punto de entrada del Electron |
| `electron-app/local-server/` | Servidor local para el bridge de impresión |
| `electron-app/local-server/config-schema.js` | Schema de configuración del servidor |

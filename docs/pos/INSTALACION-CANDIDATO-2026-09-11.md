# Instalación, migración, recuperación y rollback — candidato `cert/instalador-2026-09-10`

Complementa [ROLLBACK-INSTALADOR.md](ROLLBACK-INSTALADOR.md) (topología y
artefactos de AMALAY) y [CANDIDATO-POS-KDS-2026-09-10](../audit/CANDIDATO-POS-KDS-2026-09-10.md).
Nada de aquí se ejecutó en AMALAY. Es el procedimiento que se ejecutará **con
Daniel presente** y sobre el mismo commit del instalador.

## 0. Qué cambia en cada capa

| Capa | Cómo llega | Qué trae este candidato |
|---|---|---|
| Web (Vercel, `app.fullsite.mx`) | deploy del merge a `main`; la caja lo toma con F5 | SW v48, cola offline por orden, cierre con preflight, guardia desde Pedro, KDS con disposición, cache de PIN por rol |
| Pedro / Electron | **instalador nuevo** en cada terminal | foto de nube sin log, compactación, T-09 completo, corrección por nube, TURNO_CLOSED durable |
| Base de datos | migraciones | `20260910090000` (aditiva, ya existe en AMALAY) y las `PENDIENTE_` de inventario (**despliegue coordinado**, no aplicadas en ningún entorno salvo PostgreSQL local) |

## 1. Antes de instalar (30 min, con internet)

1. Respaldar en cada terminal: `C:\fullsite\` completo y `%APPDATA%\fullsite-pos\`
   (contiene `events.ndjson`, `cloud-snapshot.json`, `caja-conocida.json`,
   `cursor-caja.json`, `print-queue.json`). Copia con fecha en USB y en la nube.
2. Anotar versión e identidad actual de cada terminal (`/identity` de su Pedro en
   `http://127.0.0.1:7717/identity`) en la bitácora de ROLLBACK-INSTALADOR.md.
3. Verificar el instalador: SHA-256 del `.exe` contra el publicado en el PR y
   `build-info.json` dentro del ASAR con el commit exacto (`limpio: true`).
4. Confirmar que **no** hay turno abierto (hacer Z antes) y que la cola de cada
   terminal está en 0 (`/pos` → indicador de pendientes).
5. Migración `20260910090000`: comprobar que en AMALAY la columna
   `pos_cierres.cola_pendiente_al_cerrar` ya existe (sí, desde el MCP del 09-09);
   en staging aplicarla antes del deploy web.

## 2. Orden de instalación

1. **Caja** primero (Pedro autoritativo del salón). Cerrar Electron, instalar,
   arrancar, esperar `[server] listo` y comprobar en la consola de Pedro la línea
   de compactación (`compactedSnapshots`) — la primera carga puede tardar
   1-2 min si el log traía meses de fotos; las siguientes son instantáneas.
2. KDS de cocina (kds_only) y después las secundarias, una por una. Cada
   secundaria debe mostrar el salón de la caja en `/pos/mesas` sin internet
   (desconectar el módem para la prueba: la LAN sigue).
3. Reactivar internet y esperar 30 s: la caja debe aceptar el poll (mesas y KDS
   iguales en las tres pantallas).

## 3. Matriz mínima de aceptación física (misma versión en todas)

| # | Prueba | Evidencia esperada |
|---|---|---|
| 1 | Arranque en frío de la caja sin WAN | salón visible desde `cloud-snapshot.json`; sin pantalla negra |
| 2 | Mesa nueva → enviar → imprimir en cocina | ticket físico; comanda en KDS con antigüedad correcta |
| 3 | Reiniciar Pedro con 3 comandas abiertas | las comandas conservan sus minutos, no vuelven a 0 |
| 4 | Cobrar en efectivo sin WAN; reconectar | cajón abre; cola llega a 0; la orden aparece `cerrada` en la nube una sola vez |
| 5 | Cancelar un platillo desde el KDS | pregunta «¿ya se preparó?»; el aviso dice merma/regresa/pendiente según el servidor |
| 6 | Anular cuenta completa | pide disposición por renglón; stock no regresa lo preparado |
| 7 | Cambiar la IP de la caja (DHCP) | las secundarias la encuentran solas; reenvíos HTTP y KDS siguen funcionando sin reinstalar |
| 8 | Corte Z con la nube caída | la guardia lista las mesas vivas (de Pedro); el turno cierra; el cierre sube al reconectar con `fecha` del día de venta |
| 9 | Corte Z con nube viva y columna faltante (staging) | el wizard se detiene con «La nube rechazó el cierre»; el turno NO se cierra |
| 10 | Huella | sólo en terminales que ya tienen `DPUruNet.dll` y el servicio; una instalación nueva queda sin huella (bloqueo conocido) |

## 4. Migraciones PENDIENTE (inventario) — despliegue coordinado

**Aplicadas el 2026-09-11** en staging y en producción (autorizado por Daniel),
en orden 010000 → 050000 → 060000 → 070000 (esta última en tres partes), con
humo sintético OK en ambos entornos (tenant `smoke-inv`, sin residuos). Por eso
ya no llevan el prefijo `PENDIENTE_`. Las otras siete `PENDIENTE_` siguen sin
aplicar.
Rollback de migraciones: son `create or replace` de funciones más columnas
aditivas; revertir = reaplicar las definiciones del baseline (`git show
origin/main:supabase/migrations/00000000000000_baseline_esquema.sql`).

## 5. Recuperación

- **Pedro no arranca** tras actualizar: revisar `events.ndjson.torn-tail` y el
  log; si el arranque dice `EVENT_LOG_CORRUPT`, restaurar el respaldo del paso 1
  y reinstalar la versión anterior (sección 6). No editar el log a mano.
- **Cola con conflictos** (`STALE`, `TERMINAL`): el modal de conflictos del POS
  conserva el payload; nunca se borra sin decisión de Daniel.
- **Inventario «pendiente sin salida»**: el banner ofrece «Descartar este
  guardado» sólo tras un rechazo por llave repetida; anotar qué se descartó.
- **La caja cambió de IP y una terminal no la ve**: borrar `caja-conocida.json`
  de esa terminal y reiniciar; el barrido de red la vuelve a encontrar.

## 6. Rollback

1. Cerrar Electron en la terminal.
2. Instalar el `.exe` anterior (inventario en ROLLBACK-INSTALADOR.md).
3. Restaurar `%APPDATA%\fullsite-pos\` del respaldo del paso 1 **sólo si** el
   log nuevo quedó inutilizable; si Pedro nuevo funcionó, el log compactado es
   compatible con la versión anterior (misma cadena de secuencias; los
   STATE_SYNC compactados se ignoran).
4. La capa web no requiere rollback local: revertir el deploy en Vercel.
5. Las migraciones aditivas no se revierten; las PENDIENTE sólo se aplican
   cuando el rollback ya no sea una opción prevista.

## 7. Bloqueos externos vigentes

- ~~Variable de CI~~ corregida el 11-09: el instalador de CI `4e81b93e` es el
  candidato (hashes en CIERRE-SOFTWARE). Las cuatro migraciones de inventario ya
  están en staging; en producción siguen pendientes (sección 4).
- Binarios de huella fuera del repo.
- Aceptación física completa (impresoras, cajón, corte eléctrico, Windows real).

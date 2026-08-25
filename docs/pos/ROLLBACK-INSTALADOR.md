# Rollback del instalador — AMALAY

> **Qué es:** cómo volver una terminal a su versión anterior si una instalación sale mal.
> Existe porque hasta hoy no había ninguno: el único rollback documentado era
> `docs/release/BUG-019-ROLLBACK.sql`, que es de base de datos, no de la cáscara Electron.
>
> **Creado:** 2026-08-24. Inventario verificado con checksums el mismo día.

---

## Topología y versión por terminal

Fuente: [`PLAN-INSTALACION-AMALAY-JUEVES.md`](PLAN-INSTALACION-AMALAY-JUEVES.md) §1.
**Verificar contra la máquina antes de actuar** — este cuadro es del 2026-08-20.

| Terminal | Máquina | IP | Rol | Versión | Artefacto de rollback |
|---|---|---|---|---|---|
| **Caja** | SERVER1 | .71 | `server_pos` | POS 1.3.3 | `Fullsite POS Setup 1.3.3.exe` |
| **Cocina/KDS** | PDV2 | .4 | `kds_only` | KDS 1.3.5 → 1.3.8 | `Fullsite KDS Setup 1.3.5.exe` |
| **Entrada** | PDV3 | .69 | `pos` | POS 1.3.6 | `Fullsite POS Setup 1.3.6.exe` |
| **Escondite** | PDV1 | .68 | `pos` | sin instalar | *(no aplica — nada que revertir)* |

La **caja es el Local Server** (Pedro, `0.0.0.0:7717`). Revertirla afecta a TODAS las
terminales: impresión, KDS y descubrimiento LAN dependen de ella. Es la última que se toca
y la primera que se verifica.

---

## Inventario de artefactos — verificado 2026-08-24

SHA-256 (primeros 16 caracteres). **Comparar antes de instalar**: un artefacto que no
coincide no se usa.

| Artefacto | Tamaño | SHA-256 (16) |
|---|---|---|
| `dist-pos/Fullsite POS Setup 1.3.3.exe` | 78 MB | `7a5110e76340c447` |
| `dist-pos/Fullsite POS Setup 1.3.4.exe` | 78 MB | `de91e93977845509` |
| `dist-pos/Fullsite POS Setup 1.3.5.exe` | 78 MB | `5e409c78a34b7538` |
| `dist-pos/Fullsite POS Setup 1.3.6.exe` | 78 MB | `1e5ada6906cca51e` |
| `dist-pos/Fullsite-POS-1.3.7-x64-portable.zip` | 109 MB | `ed6972d6e05c4489` |
| `dist-kds/Fullsite KDS Setup 1.3.3.exe` | 78 MB | `cd9721a1b6adba7c` |
| `dist-kds/Fullsite KDS Setup 1.3.4.exe` | 78 MB | `61e367c91e634b20` |
| `dist-kds/Fullsite KDS Setup 1.3.5.exe` | 78 MB | `af1f0f0203731a93` |
| `dist-kds/Fullsite-KDS-1.3.7-x64-portable.zip` | 109 MB | `6d715b87475d6f83` |
| `dist-kds/Fullsite-KDS-1.3.8-x64-CANONICO.zip` | 109 MB | `4c14b72ce102b5b9` |

Regenerar la tabla:

```bash
cd electron-app && for f in dist-pos/* dist-kds/*; do
  [ -f "$f" ] && printf "%s  %s\n" "$(shasum -a 256 "$f" | cut -c1-16)" "$f"
done
```

### 🔴 Riesgo abierto — los artefactos no están respaldados

`electron-app/dist-pos/` y `dist-kds/` están en `.gitignore` (son 3.1 GB; versionarlos
ahogaría el repo). **Existen únicamente en la Mac de Daniel.**

Si esa Mac falla, **no hay forma de volver a 1.3.3** — la versión que hoy corre en la caja.
Reconstruir 1.3.3 desde el código exigiría hacer checkout del commit correspondiente y
rebuildear, y no está verificado que produzca un binario equivalente.

**Mitigación pendiente (decisión de Daniel):** copiar los artefactos de rollback vigentes
—POS 1.3.3, POS 1.3.6, KDS 1.3.5— a un segundo lugar (disco externo, Drive, o releases de
GitHub). Son ~234 MB. No lo ejecuto sin autorización: subir binarios a un servicio externo
es publicación.

---

## Antes de instalar cualquier cosa

1. **Fuera de horario de servicio.** Nunca con mesas abiertas.
2. **Corte de caja hecho y verificado.** Sin turno abierto.
3. **La cola de sincronización vacía.** En el POS: diagnóstico de sincronización → 0
   pendientes. Si hay pendientes, **no instalar**: reinstalar puede dejarlos huérfanos.
4. **Anotar la versión actual** de la terminal (Ajustes → versión) en la bitácora de abajo.
5. **Verificar el checksum** del artefacto contra la tabla.

> Si cualquiera de los cinco no se cumple, se pospone. Ninguna instalación es urgente
> comparada con perder una cola de órdenes.

---

## Procedimiento de rollback

Aplica cuando una terminal recién instalada no arranca, no imprime, no recibe órdenes, o
se comporta distinto a como se documentó.

1. **Detenerse.** No intentar arreglar en caliente ni reinstalar la versión nueva encima.
2. **Anotar el síntoma exacto**: qué pantalla, qué acción, qué se ve, qué NO pasa.
   Foto de la pantalla si se puede.
3. **Cerrar la app** por completo (Administrador de tareas → no debe quedar proceso
   `Fullsite`). Confirmar que el puerto 7717 quedó libre si es la caja.
4. **Instalar el artefacto de rollback** de la tabla de arriba, tras verificar su checksum.
5. **Verificar la reversión** con la lista de abajo.
6. **Registrar** en la bitácora.

### Verificación tras revertir

| | Qué comprobar |
|---|---|
| Arranque | La app abre y muestra el mapa de mesas (no pantalla negra) |
| Versión | Ajustes muestra la versión esperada |
| Caja / Local Server | Otras terminales vuelven a imprimir y el KDS recibe órdenes |
| Offline | Apagar SOLO internet (LAN viva) → la app sigue respondiendo |
| Cola | Diagnóstico de sincronización: sin errores nuevos |

Si tras revertir **el síntoma persiste**, el problema no era la versión. Detenerse y
escalar a Daniel — no seguir instalando versiones.

---

## Lo que NO se hace en un rollback

- **No** borrar `%APPDATA%` ni el directorio de datos: ahí vive la cola offline sin
  sincronizar. Borrarlo pierde órdenes y cobros reales.
- **No** limpiar caché del navegador ni del Service Worker "por si acaso".
- **No** editar `config-*.json` a mano — el BOM que metió un editor manual ya rompió el
  Escondite una vez. Siempre por el asistente.
- **No** reinstalar la caja para arreglar un problema de una terminal distinta.
- **No** tocar la base de datos. El rollback de esquema es otro documento
  (`docs/release/BUG-019-ROLLBACK.sql`) y **requiere autorización explícita de Daniel**.

---

## Bitácora de instalaciones y rollbacks

| Fecha | Terminal | De → a | Motivo | Resultado | Quién |
|---|---|---|---|---|---|
| _(sin registros)_ | | | | | |

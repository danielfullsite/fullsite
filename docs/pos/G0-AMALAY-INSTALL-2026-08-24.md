# G0 — Run card de instalación AMALAY

Fecha objetivo: lunes 2026-08-24.

Estado al 2026-08-21: **NO-GO para tocar PDV2 todavía; GO condicionado para canary supervisado**.

Alcance: instalación y evidencia. No incluye cambios de producto, offline, RLS ni integraciones.

## Decisión conjunta

Fullsite puede instalarse el lunes únicamente como canary/shadow, con Wansoft o contingencia manual disponible. No puede declararse todavía sistema exclusivo para dinero y servicio.

El alcance recomendado es:

- Caja: no reinstalar; solo verificar salud y recargar la web.
- KDS PDV2: primer y único canary.
- Escondite: después de que KDS pase reinicio y prueba física; nunca bajo presión durante servicio.
- Entrada: no reinstalar salvo que falle su prueba offline.

## Evidencia verificada

### Fuente

- `origin/main`: `df8265dcb913b2850101e517d2eea813fecacebc`.
- Fuente de los artefactos: `feat/pos-ui-kit` en `429bf997d204342fa8396b9512097b5cafa45792`.
- La fuente está 48 commits adelante y 103 atrás de `origin/main`.
- `origin/backup/pos-ui-kit-20260819` conserva la rama hasta `a8eb58a3`, pero le falta el último commit `429bf997`.
- Los archivos críticos dentro de ambos `app.asar` coinciden byte por byte con `main.js`, `preload.js` y `local-server/kds-ui.html` de `429bf997`.
- Pruebas del Local Server sobre esa fuente: **184/184 PASS**.

### Artefactos

| Artefacto | SHA-256 | Tamaño | Estado |
|---|---|---:|---|
| `Fullsite-KDS-1.3.8-x64-CANONICO.zip` | `4c14b72ce102b5b982430c2781925eaa67d8ac57b6cadf9f4dfa83e83c72921e` | 115,260,245 bytes | Portable, no instalador |
| `Fullsite-POS-1.3.7-x64-portable.zip` | `ed6972d6e05c4489aeaa3420bfc2a0417c7723890e283c16b3405ba3a411526c` | 115,261,016 bytes | Portable; no instalar por default |
| `Fullsite KDS Setup 1.3.5.exe` | `af1f0f0203731a9334aac62d6833d0de1e2375c8594ed815b67e11cb8f46e35e` | 81,839,546 bytes | Rollback conocido |
| `config-KDS.json` | `ad8b108bfd118509da8e5a472022e6787553c4663333d365170499a12ef226c0` | 411 bytes | Config AMALAY |

## STOP-SHIP antes de tocar KDS

Todos deben quedar resueltos:

1. **Elegir y probar el mecanismo de despliegue 1.3.8.** El ZIP contiene `win-unpacked/Fullsite KDS.exe`; no existe `Setup 1.3.8.exe`. No desinstalar 1.3.5 hasta:
   - generar un NSIS 1.3.8 reproducible, o
   - probar el portable en ruta fija, configurar autostart y demostrar reinicio de Windows.
2. **Preservar la fuente.** Subir `429bf997` a una rama/tag remoto y registrar la relación fuente→artefacto. Esta acción requiere aprobación de Daniel.
3. **Backup y rollback.** Respaldar config, impresoras, eventos, cola de impresión, server-id y userData de PDV2; conservar y comprobar el Setup 1.3.5.
4. **LAN contenida.** Confirmar que Wi-Fi de invitados y equipos no confiables no llegan a `:7717`. El Local Server aún no autentica comandos LAN.
5. **Contingencia activa.** Wansoft debe estar disponible. Si no puede venderse, imprimirse o verse la comanda en menos de 10 minutos, se revierte; no se repara durante servicio.

## Preflight

- [ ] Ventana fuera de servicio confirmada; Daniel decide GO.
- [ ] Wansoft abre y puede registrar una operación.
- [ ] Dos copias locales del artefacto 1.3.8, Setup 1.3.5 y config KDS.
- [ ] Los cuatro SHA-256 coinciden con esta tarjeta.
- [ ] Backup de PDV2 copiado y verificable.
- [ ] Caja `192.168.1.71`: `/health` y `/state` responden.
- [ ] Cola de sync e impresión en cero; cualquier fallo previo está explicado.
- [ ] Desde PDV2 se alcanza `192.168.1.71:7717`; la red invitada no lo alcanza.
- [ ] Solo un proceso usa el puerto local `7717`.
- [ ] Estaciones e impresoras esperadas inventariadas.
- [ ] Mecanismo 1.3.8 pasa arranque, autostart y reinicio en Windows.

Si falta una casilla, no se desinstala 1.3.5.

## Ejecución canary

1. Registrar hora, versiones instaladas, hostname, IP y hash de config de PDV2.
2. Cerrar el KDS anterior con `Ctrl+Shift+Q`.
3. Aplicar únicamente el mecanismo 1.3.8 ya aprobado.
4. Importar config mediante el asistente; no editar JSON manualmente.
5. Confirmar versión 1.3.8.
6. Confirmar que carga `http://127.0.0.1:7717/kds`, no HTTPS.
7. Confirmar que lee el estado de Caja en `192.168.1.71`.
8. Reiniciar PDV2 y demostrar que KDS y Pedro vuelven solos.
9. Solo después ejecutar la matriz física.

## Matriz física mínima

- [ ] Caja online: orden → impresión en estación correcta → KDS.
- [ ] Entrada online: orden → reenvío a Caja → impresión → KDS.
- [ ] Segunda ronda en la misma mesa: aparecen los ítems correctos y no se marca otro por error.
- [ ] Cortar WAN, nunca LAN, con las aplicaciones abiertas.
- [ ] Caja sin WAN: orden → impresión → KDS.
- [ ] Entrada sin WAN: orden → Caja → impresión → KDS.
- [ ] Restaurar WAN: sincronización sin duplicados y colas en cero.
- [ ] Cobro y cierre online comparados con Wansoft.

No usar esta sesión para certificar dinero offline ni arranque del día sin WAN.

## Rollback

Disparadores: KDS carga HTTPS, `7717` falla, no sobrevive reinicio, falta una estación, una comanda no aparece, existe duplicación, una segunda ronda altera el ítem equivocado, Entrada falla sin WAN o una cola no drena.

1. Detener Fullsite y continuar en Wansoft.
2. Retirar 1.3.8.
3. Reinstalar `Fullsite KDS Setup 1.3.5.exe` con el hash registrado.
4. Restaurar el backup de PDV2.
5. Verificar `/health`, `/state` y una orden online.
6. Registrar hora, mesa, síntoma y resultado; no corregir en caliente.

## Diferencias resueltas por evidencia

- **Turno offline no está cerrado.** Existe un flujo nuevo que encola apertura `POST` y cierre `PATCH` con filtro; pero `TurnoGate` todavía llama `openTurno()` en `pos-data.ts`, que usa la cola legacy `addToQueue()`. Al migrarse, esa cola pierde el método. Por eso no se permite cold-start offline todavía.
- **`itemKey` no es puramente índice.** Prefiere `item.id` y usa el índice como fallback. El riesgo es menor, pero la segunda ronda sigue siendo prueba obligatoria.
- **Timeout real:** el guard web usa 5 segundos en la fuente revisada, no 7 como afirma el plan anterior.
- **Checklist post-instalación:** existe en `origin/main` y en el worktree documental. No aparece en `feat/pos-ui-kit` por la divergencia de ramas; no es un archivo inexistente globalmente.
- **Artefacto vs rama:** el KDS local del ZIP sí está verificado; lo que no está cerrado es su distribución reproducible y recuperación física.

## Criterio de cierre G0

G0 pasa solamente si:

- el KDS canary sobrevive un reinicio;
- el flujo físico completo pasa online y con WAN cortada;
- ninguna comanda o impresión se pierde o duplica;
- las colas terminan en cero;
- el rollback queda disponible y probado;
- Wansoft sigue activo como respaldo;
- se archivan versiones, hashes, config y evidencia de la sesión.

Pasar G0 autoriza preparar `CUT-01`; no autoriza declarar `Offline Certified` ni retirar Wansoft.

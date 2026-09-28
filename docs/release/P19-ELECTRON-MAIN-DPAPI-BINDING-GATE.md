# Gate P19 — binding DPAPI en Electron main

> Estado: **preparación de revisión**. Este documento no autoriza integración,
> cambios de producto, despliegue, empaquetado ni operación en AMALAY.
>
> Base de coordinación: `0dcaea11276d75775fa65efb070452da19e8d9c565d9762e9db29558ce5756cc`.

## Propósito

Revisar un binding Node-API que invoque DPAPI desde el proceso real Electron
`main`, sin broker ni helper externo. La evaluación aislada anterior midió 131
comparaciones en 117.7 ms dentro de un proceso nativo de laboratorio; eso no
acredita compatibilidad con Electron, guardado P19, ni cancelación de llamadas
nativas colgadas.

## Invariantes que no pueden cambiar

- UI HOLD por defecto y plazo de interacción de 45 s.
- P17, P19, actor, ACL, frame, catálogo, CAS, fencing, journals y recibos.
- Las 131 verificaciones: las primeras 74 permanecen frescas y las otras 57
  no se agrupan sin equivalencia de entrada demostrada por llamada.
- Sin secretos, entropy, blobs DPAPI o material criptográfico en renderer,
  IPC, consola, evidencia ni manifiesto JEV.
- Sin red, servicios live, producción, VM, F:, NSIS ni empaquetado.

## Evidencia mínima que debe producir Windows

| Tema | Evidencia exigida | No cuenta como evidencia |
| --- | --- | --- |
| Proceso | Addon cargado y llamado por Electron `main` real, con ABI declarado | `runAsNode`, Electron Node o un proceso Node aparte |
| Integridad | Hash de fuente, compilador y addon; estado de firma declarado | Confiar en una ruta o un nombre de archivo |
| Semántica | `CryptProtectData`/`CryptUnprotectData`, CurrentUser y entropy exactos, con vectores sintéticos | API parecida o metadata inventada |
| Frescura | Inventario nominal de 131 llamadas y prueba antes/después | Declarar que 74/57 es equivalente sin demostrarlo |
| Deadline | Epoch/correlación en main; al vencer, `UNKNOWN/HOLD` y sin publicación | Aumentar timeout, bloquear el hilo o aceptar una respuesta tardía |
| Recuperación | Crash, reinicio y replay sin inferir que no hubo commit | Suponer que timeout significa rollback |
| Limpieza | Procesos y listeners finales en cero; perfiles/evidencia preservados | Borrar perfiles o evidencia para obtener un resultado limpio |

## Matriz obligatoria

Los resultados se reportan por motor y cada caso es `PASS`, `FAIL`,
`BLOCKED` u `OMITTED`; los omitidos nunca cuentan como aprobados.

1. Carga correcta del addon en Electron main y rechazo de entrada/entropy/
   contexto CurrentUser inválidos.
2. Las 131 comparaciones sintéticas y sus lecturas frescas antes/después.
3. Fallo de carga, hash inesperado si se afirma control de integridad y API
   nativa que devuelve error.
4. Deadline ya vencido, deadline durante operación, operación colgada simulada
   y respuesta que llega después del deadline.
5. Main responsivo durante la operación asíncrona: un sentinel independiente
   debe responder sin usar una GUI como sustituto.
6. Epoch o correlación obsoleta, retry no correlacionado, crash de main y
   reapertura. Ningún resultado tardío publica, confirma o reintenta.
7. Los negativos P19 existentes: actor/ACL incorrectos, frame destruido, CAS
   obsoleto y turno cerrado continúan rechazados.

## Interpretación correcta del timeout

Node-API no puede demostrar una cancelación segura de una llamada nativa
síncrona arbitraria. El criterio aceptable es más estricto: el trabajo se hace
fuera del event loop de Electron main y, al vencer el deadline, `main` invalida
la epoch y conserva `UNKNOWN/HOLD`. Una finalización posterior se registra sólo
como tardía y se descarta. Esto no certifica que el SO interrumpió la llamada.

## Condición de salida del gate

El gate puede ser `scoped pass` únicamente si cada fila de la matriz se
ejecuta en Electron main y pasa, los 38 hashes permanecen idénticos y el
reporte declara explícitamente que **no** se certificaron `businessSave`, GUI
ni integración de producto. Cualquier incompatibilidad de ABI, bloqueo del
event loop, resultado tardío aceptado, secreto expuesto o falta de evidencia
es `BLOCKED`; no se vuelve al broker descartado.

Después de un `scoped pass`, una integración aislada tendrá que comparar el
guardado real P19 contra el mismo perfil sintético antes de reanudar el gate
GUI POS → ORDER_SEND → KDS.

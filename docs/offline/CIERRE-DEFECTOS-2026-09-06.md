# Cierre de defectos del candidato — 2026-09-06

Rama `lab/pin-real-desde-pantalla`, seis commits sobre `b5791890`. Nada de esto
está desplegado ni validado en campo: AMALAY sigue operando con Wansoft.

## De dónde salió la lista

Auditoría de 61 agentes sobre la rama candidata (28 commits sobre `origin/main`):
seis auditores de estado por área, seis lentes buscando huecos, y dos refutadores
independientes por hallazgo. 73 hallazgos brutos, de los que sobrevivieron los
que se arreglan aquí. Los refutados no se tocaron.

## Respuestas de producto que fijaron el alcance (Daniel, 2026-09-05)

| Pregunta | Respuesta | Consecuencia |
|---|---|---|
| ¿Cocina marca las comandas? | Sí, ya lo hacen con Wansoft | La decisión D2 de ADR-005 encaja con la operación; el síntoma 2 se cierra |
| ¿Qué corre en cocina y barra? | Sólo el KDS de comida que sirve Pedro en `/kds`; barra imprime | El hallazgo de tableros web ciegos NO aplica en AMALAY |
| ¿Huella o PIN? | La huella es indispensable | Regresión bloqueante, ver pendientes |
| ¿Servicio real? | No, siguen en pruebas hasta estar al 100% | No hay hotfix urgente; todo va en un instalador |

## Defectos cerrados

Cada uno con prueba de comportamiento, verificada contra el código anterior para
descartar que sea tautológica.

| Commit | Defecto | Prueba | ¿Falla antes? |
|---|---|---|---|
| `0c79be36` | El hub mataba cada 15 s a toda terminal que sólo escucha | 4/4 | 2 de 4 |
| `f3d52ada` | Diez errores de PIN en una terminal bloqueaban a las tres | 5/5 | 2 de 5 |
| `630a7e65` | Una nube saturada contestaba «PIN rechazado» a quien tecleó bien | 6/6 | 4 de 6 |
| `57fc7ede` | Un archivo de credenciales dañado dejaba la terminal sin Pedro | 11 comprobaciones | sí, en la primera |
| `7e408def` | Reinstalar la Caja dejaba ciegas a las secundarias | 7/7 | 2 de 7 |
| `18eff681` | La mesa quedaba inservible después de cobrar | 6/6 | n/a, función nueva |
| `9e95ae08` | La huella, rota por transporte y por el guard del login | 19/19 | n/a, módulo nuevo |

**El del hub ya está en producción hoy**, idéntico en `origin/main`. Es candidato
directo al «no muestran lo mismo» que Eduardo reportó el 2026-09-02. Medido con
un tablero pasivo contra el código anterior: vivo a los 8 s, desconectado a los 16.

**El de la mesa lo introdujo esta rama**, cero ocurrencias en `origin/main`, y
reproduce el síntoma 2 en forma peor: además de mostrar platillos de una orden
cerrada, deja la mesa sin poder usarse en esa terminal.

Una prueba de regresión existente atrapó un error mío en el camino: al normalizar
el cursor guardado, `Number(null)` es 0, así que una terminal sin cursor
arrancaba en 0 en vez de -1 y reprocesaba el historial completo en cada arranque.
Quedó cubierto con su propio caso.

## Verificación

- Servidor local: **133/133** sobre 17 archivos de prueba, incluidos los que
  levantan Pedros reales.
- Aplicación: **102/102** sobre las siete suites relacionadas.
- TypeScript: los mismos 25 errores preexistentes, todos en archivos de prueba
  por `@testing-library/react` y `jsdom` ausentes. Ninguno en lo tocado.
- `node --test tests/` sobre el directorio completo no reporta bien en este
  entorno; la verificación es por archivo.

## Pendientes, con su diagnóstico

**La huella quedó devuelta** en `9e95ae08`, por los dos lados. El transporte
ahora lleva la credencial de red en las ocho llamadas al lector, y el guard del
login pregunta por el modo de la instalación en vez de por el navegador. Se
descartó exentar `/fp` por loopback, que era lo obvio: rompe una prueba viva,
contradice una decisión escrita, y con el comodín de origen que responde el proxy
dejaría enrolar huellas bajo un identificador ajeno desde cualquier página
abierta en esa máquina.

Queda un límite dicho sin adornos: con autoridad de Caja la huella seguirá
pidiendo PIN mientras no exista una ruta de autorización por huella en Pedro. No
se construyó a propósito. El servicio del lector no firma su respuesta ni recibe
un desafío, y la pantalla de alta acepta el identificador de cualquiera sin
verificar rol, así que un permiso nacido de ahí valdría menos que el PIN al que
sustituye. El siguiente paso tiene nombre: que el servicio firme su respuesta con
una llave que Pedro le entregue al arrancar.

**La identidad al cambiar de mesa, diagnosticado y no arreglado.** El reset de
`orderId`, `loadedOrderId` y `sentItemIds` empieza con `if (requiereCaja()) return`,
así que bajo Electron nunca corre y nada lo reemplaza. Si la mesa destino está
ocupada, la primera lectura sin base anexa los renglones no enviados de la cuenta
origen al borrador de la cuenta ajena y los persiste como propios, sin PIN y sin
aviso. El camino autorizado de «Transferir mesa» es correcto y ya limpia.

No se arregló porque exige tocar el ciclo de vida de un componente de 6.700
líneas y en este entorno no hay forma de probarlo: `jsdom` y
`@testing-library/react` no están instalados y no se pueden instalar aquí. Un
arreglo sin prueba en ese archivo es exactamente lo que el protocolo prohíbe.

**Lo demás del plan** sigue abierto: la ronda enviada sin internet que llega sin
revisión y congela la mesa en modo legacy, la poda del snapshot, el secreto de
red que se copia a mano sin procedimiento, la versión visible, el rollback no
ensayado y la pasada en Windows.

## Nota de método

Dos intentos de repartir estos arreglos entre agentes en paralelo se atascaron
sin escribir una línea: se quedaban leyendo documentación en bucle y agotaban su
presupuesto. El worktree quedó intacto las dos veces. Lo que funcionó fue
hacerlos de uno en uno, con la prueba escrita antes del arreglo y verificada
contra el código anterior.

# Laboratorio de pantallas y cuenta compartida

Ejecutar desde la raíz: `node electron-app/lab/laboratorio-ui-multiterminal.cjs`.

El laboratorio arranca el POS real con Next local y cuatro procesos Electron independientes: Caja, POS 2, POS 3 y cocina. Cada proceso tiene perfil, puerto y Pedro propios. Catálogo, personal y turno usan datos sintéticos; las órdenes, credenciales LAN, retransmisión y snapshots pasan por los servidores reales. El corte WAN aborta peticiones de API/REST mientras conserva la red local y `navigator.onLine=true`.

Resultado verificado: **5/5**.

1. Comanda enviada desde POS 2 aparece en cocina.
2. POS 3 abre la misma cuenta sin WAN: mismo ID, dos cafés y total de $116.00.
3. Liquidar por el evento legacy de cierre conserva la preparación pendiente en cocina.
4. Apagar el binario real de Caja provoca el aviso de sólo borradores en POS 2.
5. El recorrido no deja errores de JavaScript sin manejar.

Encontró dos defectos de integración: CSP permitía sólo el puerto 7717, bloqueando instalaciones con otro puerto; la carga opcional de recetas rechazaba todo el arranque cuando la LAN estaba viva pero no había WAN. Ambos corregidos. La consulta de recetas para inventario conserva su error; únicamente su uso como sugerencia de pantalla degrada.

La evidencia se guarda en `output/closure/ui/`: resultados, capturas en el momento de la comprobación, texto de pantallas y logs. Datos y credenciales de laboratorio son temporales. La suite no acepta origen remoto ni hereda credenciales de nube del entorno.

## Alcance preciso

La sesión está preparada: no prueba PIN, enrolamiento ni permisos. Assets servidos por Next: no certifica arranque frío sin internet, Service Worker ni paquete offline. No pulsa un cobro ni prueba proveedor bancario; la semántica financiera durable tiene su suite separada. No certifica Windows, huella ni impresoras físicas.

La cuenta del fixture no tiene revisión: puede leerse y conservar borradores, pero no cobrar ni modificar la orden confirmada. El catálogo del POS 3 no estaba preparado antes del corte: la captura documenta esa falta. Todavía se debe verificar preparar catálogo completo, iniciar sesión offline, crear/modificar/enviar desde las pantallas, cobrar, reiniciar y conciliar contra nube. Este laboratorio no equivale al cierre del turno completo.

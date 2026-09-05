# Laboratorio de pantallas y cuenta compartida

Ejecutar desde la raíz: `node electron-app/lab/laboratorio-ui-multiterminal.cjs`.

El laboratorio arranca el POS real con Next local y cuatro procesos Electron independientes: Caja, POS 2, POS 3 y cocina. Cada proceso tiene perfil, puerto y Pedro propios. Catálogo, personal y turno usan datos sintéticos; las órdenes, credenciales LAN, retransmisión y snapshots pasan por los servidores reales. El corte WAN aborta peticiones de API/REST mientras conserva la red local y `navigator.onLine=true`.

Resultado verificado: **10/10**.

1. Comanda enviada desde POS 2 aparece en cocina.
2. POS 3 abre la misma cuenta sin WAN: mismo ID, dos cafés y total de $116.00.
3. Un comando WS del secundario se confirma en Caja.
4. Sin WAN, dividir $116 en dos cuentas y cobrar $29 desde POS 2 deja saldo $87 visible en POS 3.
5. Matar el binario real de Caja y reiniciarlo con el mismo perfil recupera las dos cuentas, el pago de $29, el saldo de $87 y la preparación pendiente.
6. Liquidar desde POS 3 por los comandos financieros durables conserva la preparación pendiente en cocina.
7. Pulsar «Todo listo» en cocina confirma preparación en Caja sin cambiar los $116 cobrados.
8. Apagar el binario real de Caja provoca el aviso de sólo borradores en POS 2.
9. El recorrido no deja errores de JavaScript sin manejar y ningún componente registra un Service Worker mientras está deshabilitado para este laboratorio.
10. POS 3 sin caché de menú consulta el catálogo de Caja sin WAN: navega Bebidas, abre el café y sólo habilita Agregar después de elegir su opción obligatoria. Se cancela la selección; no se afirma envío de esa nueva ronda.

Encontró dos defectos de integración: CSP permitía sólo el puerto 7717, bloqueando instalaciones con otro puerto; la carga opcional de recetas rechazaba todo el arranque cuando la LAN estaba viva pero no había WAN. Ambos corregidos. La consulta de recetas para inventario conserva su error; únicamente su uso como sugerencia de pantalla degrada.

La ampliación encontró otros defectos: cocina añadía metadatos legítimos que el bloqueo financiero rechazaba; HTTP 200 podía contener un rechazo que la pantalla interpretaba como confirmación; el aviso de instalar PWA ignoraba la bandera de desactivación del SW y provocaba cargas/recargas; AppShell esperaba al login cloud antes de montar el gate de PIN del POS. Las correcciones verifican recibos por ID, respetan una única gestión del SW y permiten montar el POS mientras la autenticación cloud sigue pendiente. El PIN conserva su validación propia.

Verificación del candidato local tras estas correcciones: Pedro **369/369**, frontend Node **2,982/2,982**, componentes DOM **200/200**, dominio financiero/acceso sobre Electron Node 20 **31/31**, TypeScript **0 errores**. Las dependencias de prueba ausentes se completaron en un runtime temporal aislado, sin modificar las del checkout principal.

La evidencia se guarda en `output/closure/ui/`: resultados, capturas en el momento de la comprobación, texto de pantallas y logs. Datos y credenciales de laboratorio son temporales. La suite no acepta origen remoto ni hereda credenciales de nube del entorno.

## Alcance preciso

La sesión está preparada: no prueba PIN, enrolamiento ni permisos. Assets servidos por Next: no certifica arranque frío sin internet, Service Worker ni paquete offline. No pulsa un cobro ni prueba proveedor bancario; envía los comandos financieros por HTTP real y verifica el saldo en la pantalla. La semántica financiera durable tiene además su suite separada. No certifica Windows, huella ni impresoras físicas.

La cuenta del fixture tiene una revisión explícita; los comandos financieros usan sesiones firmadas preparadas en la Caja sintética antes de arrancar. No se acepta un rol enviado por el body. El catálogo se prepara una sola vez en el perfil de Caja; POS 3 lo obtiene por el [contrato compartido](CATALOGO-COMPARTIDO-2026-09-05.md). Todavía se debe verificar iniciar sesión offline desde la pantalla, crear/modificar/enviar rondas, cobrar desde sus controles, cerrar turno y conciliar contra nube. Este laboratorio no equivale al cierre del turno completo.

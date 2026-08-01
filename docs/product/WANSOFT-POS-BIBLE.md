# Wansoft POS Bible — Ingenieria Inversa Completa

**Fecha inicio:** 2026-07-21
**Fuente:** NetSilver/Wansoft instalado en AMALAY, acceso via TeamViewer
**Objetivo:** Documentar TODA la logica operativa para replicar y superar en Fullsite
**Metodo:** Pantalla por pantalla, flujo por flujo

---

## Indice

1. [Apertura y Login](#1-apertura-y-login)
2. [Mapa de Mesas](#2-mapa-de-mesas)
3. [Crear Orden](#3-crear-orden)
4. [Modificadores](#4-modificadores)
5. [Enviar a Cocina / Imprimir Comanda](#5-enviar-a-cocina)
6. [Editar Orden (post-envio)](#6-editar-orden)
7. [Cancelar Items / Orden](#7-cancelar)
8. [Transferir Platillos](#8-transferir-platillos)
9. [Juntar / Separar Mesas](#9-juntar-separar-mesas)
10. [Cobrar / Formas de Pago](#10-cobrar)
11. [Split de Cuenta](#11-split-de-cuenta)
12. [Descuentos y Cortesias](#12-descuentos-y-cortesias)
13. [Ticket / Recibo](#13-ticket)
14. [KDS Cocina](#14-kds-cocina)
15. [KDS Barra](#15-kds-barra)
16. [Impresoras y Estaciones](#16-impresoras)
17. [Caja: Retiros y Depositos](#17-caja)
18. [Corte / Cierre de Turno](#18-corte)
19. [Permisos y Seguridad](#19-permisos)
20. [Configuracion de Ticket](#20-config-ticket)
21. [Configuracion de Perifericos](#21-config-perifericos)
22. [Inventario (desde POS)](#22-inventario)
23. [Reportes Locales](#23-reportes)
24. [Huellas Digitales](#24-huellas)
25. [Pantalla Cliente](#25-pantalla-cliente)

---

## 1. Apertura y Login

**Objetivo:** Identificar quien opera el POS y abrir sesion de trabajo.

**Problema operativo que resuelve:** Sin login, no hay trazabilidad de quien hizo cada operacion. Cualquiera podria hacer cancelaciones, descuentos o transferencias sin registro.

**Flujo completo:**
1. App abierta, muestra pantalla de bloqueo
2. Eduardo pone huella digital → identifica al usuario automaticamente
3. Sistema carga directo a la vista principal (lista de ordenes, NO mapa de mesas)
4. Header muestra: usuario logueado, turno activo, fecha/hora
5. Si no hay turno abierto, hay que abrirlo (fondo de caja)

**Permisos:**
- Huella digital es el metodo principal (rapido, sin PIN)
- PIN como alternativa
- Usuario PRUEBAS 1 = cuenta de pruebas con acceso total (creada por Eduardo para Daniel)
- En operacion real: cada mesero tiene su huella registrada

**Reglas de negocio:**
- El turno ya estaba abierto (Turno 3) — no tuvo que abrirlo
- La vista post-login es lista de ordenes, no mapa de mesas
- Eduardo prefiere que post-login vaya a pantalla de bloqueo/mapa (feedback Jul 21)

**UX actual (Wansoft):**
- Login por huella = instantaneo, 1 toque
- Va directo a la vista de ordenes (lista vacia si no hay)
- Header siempre visible: usuario, turno, mesa(s), fecha

**Como hacerlo mejor en Fullsite:**
- Login por huella ya implementado (lector HID)
- Post-login deberia ir a Grid de mesas (feedback Eduardo), no a pantalla de orden
- Cada mesero solo ve sus mesas asignadas (feedback Eduardo)
- Pantalla de bloqueo post-envio para forzar re-identificacion

---

## 2. Mapa de Mesas

**Objetivo:** Mostrar visualmente la distribucion del restaurante para que meseros y cajeros vean estado de mesas en tiempo real.

**Problema operativo que resuelve:** Sin mapa, el personal no sabe que mesas estan ocupadas, libres o esperando cobro. AMALAY decidio desactivarlo porque nunca configuraron el layout — usan lista de ordenes en su lugar.

**Flujo completo:**
1. Wansoft tiene la funcion de mapa pero AMALAY la tiene DESACTIVADA
2. En lugar del mapa, AMALAY usa una lista de ordenes en formato card view
3. Cada card muestra: Mesa, Hora Abrir, Total, Numero de Orden
4. Tarjeta roja = orden activa, tarjeta negra = seleccionada
5. El layout editor existe (drag & drop de cuadrados/circulos) pero nunca fue configurado
6. Se puede configurar por seccion con permisos por seccion

**Casos borde:**
- Si el layout nunca se configura, el sistema funciona con la lista de ordenes como fallback
- El editor permite cuadrados y circulos para representar mesas

**Permisos:**
- Se pueden asignar permisos por seccion (ej. solo ciertos meseros ven ciertas secciones)

**Reglas de negocio:**
- El mapa es opcional — AMALAY opera sin el desde siempre
- La lista de ordenes como card view es el modo operativo real
- Ordenes se identifican por numero secuencial (72, 73, etc.)

**UX actual (Wansoft):**
- Card view con ordenes activas en rojo
- Seleccion con click (tarjeta se pone negra)
- Informacion rapida visible: mesa, hora, total, orden
- Layout editor arrastrable pero sin uso en AMALAY

**Como hacerlo mejor en Fullsite:**
- Fullsite YA tiene un plano visual mejor con zonas nombradas (terraza, interior, barra, etc.)
- Incluir ambas vistas: mapa visual + lista de ordenes
- El mapa debe ser configurable con drag & drop (similar a Wansoft pero con zonas reales)
- Cada mesa debe mostrar estado con color: libre, ocupada, esperando cobro

---

## 3. Crear Orden

**Objetivo:** Registrar una nueva orden de restaurante o para llevar con mesero, mesa, personas y nombre de cliente asignados.

**Problema operativo que resuelve:** Sin un flujo estructurado de creacion, no se sabe quien tomo la orden, en que mesa, ni cuantas personas hay. Esto afecta servicio, tiempos y cobro.

**Flujo completo:**
1. Click en "Nueva"
2. Seleccionar tipo: Restaurante o Para llevar
3. Seleccionar Mesero (de una lista)
4. Ingresar numero de Mesa
5. Ingresar numero de Personas
6. Ingresar Nombre del cliente
7. Presionar Enter
8. Se abre la pantalla de captura de items

**Pantalla de captura:**
- Izquierda: lista de items agregados
- Centro: controles CANT +/- (cantidad) y SILLA +/- (asignar silla)
- Derecha: botones de categorias con colores
- Arriba: campo "Codigo" para escaneo de codigo de barras
- Abajo izquierda: No. articulos, Descuentos, Total
- Abajo botones: Avanzadas, Cancelar, Imprimir, Cobrar, Guardar

**Categorias (botones con color):**
ALIMENTOS, BEBIDAS, MARKET, ALCOHOL, POSTRES, APPETIZERS, VENTAS TERCEROS, EVENTO/MENU

**Subcategorias de ALIMENTOS:** 18 subcategorias con codificacion por color

**Elementos automaticos:**
- XX TIEMPO: se agrega automaticamente como separador para tracking de duracion de mesa

**Casos borde:**
- Para llevar pide: nombre cliente + numero de torre
- Alerta a los 30 minutos si una orden para llevar o delivery no se ha atendido
- Campo de codigo de barras arriba para productos de Market

**Permisos:**
- Cualquier usuario logueado puede crear ordenes
- La lista de meseros disponibles depende de los registrados en el turno activo

**Riesgos de fraude:**
- Crear ordenes y no cobrarlas (se debe monitorear ordenes abiertas sin cerrar)
- Asignar a un mesero distinto para evitar trazabilidad

**Reglas de negocio:**
- Tipo de operacion: Modo completo (vs mesero, llevar, retail)
- Tipo punto de venta: Caja
- Tipos habilitados: Restaurante y Para llevar
- Tiempos activados (XX TIEMPO tracking)
- Sillas activadas
- Numero de orden es secuencial (72, 73, etc.), no UUID

**UX actual (Wansoft):**
- Flujo lineal: Nueva → tipo → mesero → mesa → personas → nombre → captura
- Botones grandes con color por categoria
- Asignacion de silla durante captura con +/- controles
- Campo de barcode siempre visible arriba

**Config de diseno:**
- Ancho de boton: 90, alto: 50, fuente: 11 (todo ajustable con sliders)
- Boton de preview en vivo para ver cambios

**Como hacerlo mejor en Fullsite:**
- Simplificar: al seleccionar mesa del plano, auto-llenar mesa y tipo
- Mesero auto-asignado por login de huella (no seleccionar de lista)
- Silla asignada con interfaz mas intuitiva (drag & drop o tap en silla visual)
- Barcode scanner integrado para Market sin campo manual

---

## 4. Modificadores

**Objetivo:** Permitir personalizacion de platillos con opciones escalonadas por nivel (requeridas y opcionales).

**Problema operativo que resuelve:** Sin modificadores estructurados, la cocina recibe notas de texto libre que generan errores. Con niveles escalonados, se garantiza que el mesero capture todas las especificaciones obligatorias.

**Flujo completo:**
1. Seleccionar platillo del menu
2. Si tiene modificadores, se abre ventana de nivel 1
3. Seleccionar opcion(es) segun reglas del nivel (requerido/opcional, cantidad maxima)
4. Si hay mas niveles, avanzar al siguiente
5. Boton azul de check para saltar niveles opcionales
6. El modificador seleccionado se concatena al nombre del item: "CHILAQUILES. VERDES"

**Ejemplos reales de AMALAY:**
- CHILAQUILES:
  - NIVEL 1 SALSA (Requerido, solamente 1): Mixtos, Rojos, Verdes
  - NIVEL 2 EXTRAS (Opcional, maximo 4): Aguacate, Chicharron 50g, Ext. Huevo, Pollo Desmenuzado
- ACAI BOWL:
  - NIVEL 1 PROTEINA (Opcional, maximo 2): Habits Vainilla Proteina Vegana, Habits Colageno

**Casos borde:**
- Si nivel es Requerido, no se puede avanzar sin seleccionar
- Si nivel es Opcional, boton azul de check permite saltar
- Maximo de selecciones por nivel se valida (ej. maximo 4 extras)

**Reglas de negocio:**
- Modificadores son escalonados por nivel (step by step), no lista plana
- Cada nivel tiene: nombre, requerido/opcional, minimo/maximo selecciones
- El nombre concatenado aparece en comanda de cocina y en ticket
- El precio de extras se suma al precio base del platillo

**UX actual (Wansoft):**
- Ventana modal por nivel
- Botones para opciones de cada nivel
- Check azul para skip de opcionales
- Nombre resultante visible inmediatamente: "CHILAQUILES. VERDES"

**Como hacerlo mejor en Fullsite:**
- Fullsite ya tiene modifier steps implementados
- Mejorar: mostrar resumen visual de todos los niveles seleccionados antes de confirmar
- Permitir edicion rapida de modificadores despues de captura (antes de enviar a cocina)
- Iconos o fotos en modificadores para meseros nuevos

---

## 5. Enviar a Cocina

**Objetivo:** Transmitir la orden capturada a la estacion de cocina via impresion de comanda.

**Problema operativo que resuelve:** Sin comanda impresa, la cocina no sabe que preparar. El flujo de Guardar asegura que todo lo capturado se envie y se imprima en la impresora correcta.

**Flujo completo:**
1. Presionar boton "Guardar" en la pantalla de captura
2. Aparece dialogo de confirmacion: "NO OLVIDES ANOTAR TODAS LAS ESPECIFICACIONES" con botones Si/No
3. Si confirma: se imprime comanda en la impresora de cocina asignada
4. Regresa a la lista de ordenes (NO al mapa de mesas — Eduardo quiere que esto cambie)
5. La orden aparece como tarjeta roja en la lista

**Formato de comanda impresa:**
- EN MESA (header)
- Numero de Orden
- Mesa
- Personas
- Mesero
- Separador XX TIEMPO
- Items con numero de Silla asignada

**Casos borde:**
- Si un item tiene [NO IMPRIMIR] configurado (ej. productos Market), no genera comanda
- Si un item rutea a otra impresora (ej. cafe → BARRA), se imprime en esa impresora, no en COCINA
- Numero de orden es secuencial (72, 73, etc.)

**Reglas de negocio:**
- Guardar = enviar a cocina (no hay estado intermedio de "guardado sin enviar")
- El dialogo de confirmacion es intencional para que el mesero verifique especificaciones
- La tarjeta roja indica orden activa en la lista
- Eduardo quiere que post-envio regrese al mapa de mesas, no a la lista

**UX actual (Wansoft):**
- Boton Guardar como accion principal
- Dialogo de confirmacion con texto recordatorio
- Impresion automatica de comanda
- Retorno a lista de ordenes

**Como hacerlo mejor en Fullsite:**
- Post-envio: regresar al plano de mesas (no a lista) — feedback Eduardo
- Bloquear pantalla post-envio para forzar re-identificacion por huella
- Mostrar confirmacion visual de que la comanda se imprimio exitosamente
- Si la impresora falla, alerta inmediata con opcion de reimprimir

---

## 6. Editar Orden

**Objetivo:** Permitir agregar items a una orden ya enviada a cocina, o gestionar items ya enviados.

**Problema operativo que resuelve:** Los clientes piden mas cosas despues de que la primera comanda ya se envio. Se necesita poder agregar sin perder lo anterior.

**Flujo completo:**
1. Doble click en la tarjeta de orden en la lista (NO single click)
2. Se abre la pantalla de captura con los items existentes
3. Se pueden agregar nuevos items normalmente
4. Los items YA ENVIADOS no se pueden editar — solo cancelar
5. Al Guardar de nuevo, se envia nueva comanda solo con los items nuevos

**Casos borde:**
- Single click solo selecciona la tarjeta (la pone negra), no entra a la orden
- Items enviados requieren cancelacion formal (con razon + pregunta de inventario) para removerse
- No se puede cambiar cantidad de un item ya enviado — hay que cancelar y re-capturar

**Permisos:**
- Cualquier usuario puede agregar items a una orden abierta
- Cancelar items enviados requiere permiso (ver seccion 7)

**Riesgos de fraude:**
- Agregar items despues de cobrar parcialmente
- Editar ordenes de otro mesero para transferir responsabilidad

**Reglas de negocio:**
- Doble click para entrar a la orden (prevencion de edicion accidental)
- Items enviados son inmutables — solo se cancelan
- Cada Guardar genera una nueva comanda con solo los items nuevos

**UX actual (Wansoft):**
- Doble click para entrar
- Items enviados visualmente diferenciados de items nuevos
- Boton Guardar genera comanda incremental

**Como hacerlo mejor en Fullsite:**
- Single tap para entrar (en touch screen, doble click es incomodo)
- Diferenciar visualmente items enviados (gris) vs nuevos (color)
- Permitir modificar cantidad de items NO enviados antes de guardar
- Historial de comandas enviadas visible dentro de la orden

---

## 7. Cancelar

**Objetivo:** Cancelar items individuales de una orden ya enviada, con razon documentada y decision de impacto en inventario.

**Problema operativo que resuelve:** Cancelaciones sin razon ni control son el vector de fraude #1 en restaurantes. El flujo obliga a documentar por que se cancela y si el producto ya se preparo (merma vs devolucion a inventario).

**Flujo completo:**
1. Seleccionar el item a cancelar
2. Presionar boton X
3. Aparece dialogo: "Proporcione razon de cancelacion" con teclado y campo de texto
4. Ingresar razon y confirmar
5. Aparece pregunta: "SE PREPARO LA ORDEN (SALIERON LOS PRODUCTOS DE INVENTARIO)?" con botones SI/NO
6. SI = merma (stock no regresa al inventario)
7. NO = stock regresa al inventario
8. Se imprime aviso de CANCELADA en la misma impresora de la comanda original

**Formato de impresion de cancelacion:**
- "CANCELADA" en texto grande
- Nombre del item
- Razon de cancelacion
- Hora
- Mesero

**Casos borde:**
- Con permisos de admin, no se pide autorizacion de gerente
- Sin permisos de admin, se requiere autorizacion de gerente (huella o PIN)
- La cancelacion se imprime en la impresora de cocina para que sepan que ya no preparar

**Permisos:**
- Con permisos de admin: cancelacion directa sin autorizacion adicional
- Sin permisos: requiere autorizacion de gerente

**Riesgos de fraude:**
- Cancelar para no cobrar al cliente (el mesero se queda con el dinero)
- Marcar como "NO preparado" cuando si se preparo (regresa stock fantasma)
- Cancelaciones excesivas del mismo mesero = patron sospechoso

**Reglas de negocio:**
- Toda cancelacion REQUIERE razon escrita — no hay cancelacion silenciosa
- La pregunta de inventario (merma vs devolucion) es obligatoria
- Se imprime notificacion en cocina para que sepan dejar de preparar
- El registro de cancelacion queda asociado al mesero y hora

**UX actual (Wansoft):**
- Boton X para cancelar
- Dialogo de razon con teclado en pantalla
- Pregunta de inventario con SI/NO
- Impresion automatica de aviso de cancelacion

**Como hacerlo mejor en Fullsite:**
- Catalogo de razones predefinidas + texto libre (mas rapido que escribir cada vez)
- Dashboard de cancelaciones por mesero para deteccion de fraude (agente anti-fraude ya existe)
- Foto del platillo cancelado (evidencia de merma real)
- Alerta al gerente cuando un mesero excede umbral de cancelaciones

---

## 8. Transferir Platillos

**Objetivo:** Mover items individuales de una orden/mesa a otra orden/mesa diferente.

**Problema operativo que resuelve:** Clientes cambian de mesa, o se juntan con otro grupo. Se necesita mover items sin cancelar y re-capturar.

**Flujo completo:**
1. Dentro de la orden, presionar "Avanzadas"
2. Seleccionar el item a transferir
3. Seleccionar "Transferir de mesa"
4. Ingresar el numero de la nueva mesa
5. Presionar "Continuar"
6. El item se mueve a la orden de la mesa destino

**Casos borde:**
- Si la mesa destino no tiene orden abierta, se crea una nueva
- Se puede transferir item por item (no toda la orden de golpe — para eso esta "Cambiar # de mesa")

**Permisos:**
- Requiere permiso de gerente si esta configurado en Seguridad: "Cambio de platillos a otra mesa" habilitado
- En AMALAY esta habilitado el requerimiento de autorizacion

**Riesgos de fraude (CRITICO — Eduardo):**
- Las transferencias son un VECTOR PRINCIPAL de fraude segun Eduardo
- Un mesero puede transferir items a una mesa que luego cancela
- Transferir items cobrados a una mesa nueva para cobrar doble
- Sin control, se pierde trazabilidad de quien consumio que
- Debe haber log inmutable de toda transferencia con usuario, hora, origen, destino

**Reglas de negocio:**
- La transferencia mueve el item — no lo duplica
- Se debe registrar: usuario que transfiere, mesa origen, mesa destino, item, hora
- Requiere autorizacion si asi esta configurado en seguridad

**UX actual (Wansoft):**
- Acceso via menu Avanzadas
- Seleccionar item → Transferir de mesa → ingresar mesa destino → Continuar
- Dialogo simple con campo numerico

**Como hacerlo mejor en Fullsite:**
- Log inmutable de TODA transferencia (ya existe event store)
- Alerta al gerente en tiempo real cuando ocurre una transferencia
- Dashboard de transferencias por mesero (patron de fraude)
- Requirir huella de gerente para TODA transferencia (no opcional)
- Mostrar historial de movimientos de cada item en la orden

---

## 9. Juntar / Separar Mesas

**Objetivo:** Mover una orden completa de una mesa a otra, o juntar dos mesas en una sola cuenta.

**Problema operativo que resuelve:** Grupos que se cambian de mesa o que quieren juntar sus cuentas necesitan que el sistema mueva toda la informacion sin perder items ni trazabilidad.

**Flujo completo:**
1. Dentro de la orden, presionar "Avanzadas"
2. Seleccionar "Cambiar # de mesa"
3. Tiene 2 campos de entrada (posiblemente para fusionar mesa A con mesa B)
4. Ingresar nuevo numero de mesa
5. Confirmar — toda la orden se mueve a la nueva mesa

**Casos borde:**
- Si la mesa destino ya tiene una orden, posiblemente se fusionan (2 campos sugieren merge)
- Diferencia con Transferir: Cambiar mesa mueve TODA la orden, Transferir mueve items individuales

**Reglas de negocio:**
- Cambiar # de mesa = operacion sobre la orden completa
- Los 2 campos de entrada sugieren capacidad de merge (juntar mesa A + mesa B)
- El historial de la orden debe mantener registro del cambio de mesa

**UX actual (Wansoft):**
- Acceso via menu Avanzadas → Cambiar # de mesa
- 2 campos de entrada en el dialogo
- Operacion inmediata al confirmar

**Como hacerlo mejor en Fullsite:**
- Drag & drop en el plano de mesas para mover ordenes visualmente
- Confirmar merge con vista previa de ambas cuentas antes de fusionar
- Registrar todo cambio de mesa en event store
- Permitir deshacer merge dentro de un tiempo limite

---

## 10. Cobrar

**Objetivo:** Cerrar una orden procesando el pago, con soporte para multiples metodos de pago y pago mixto.

**Problema operativo que resuelve:** Sin un flujo de cobro estructurado, se pierde control del efectivo, no se registra el metodo de pago, y no hay forma de conciliar al final del dia.

**Flujo completo:**
1. Dentro de la orden, presionar boton "Cobrar"
2. Se muestra pantalla de cobro con:
   - Izquierda: lista scrolleable de metodos de pago
   - Centro: Total de cuenta, Cantidad recibida, Propina (+), Cambio (auto-calculado), Saldo
   - Derecha: tabla de pagos aplicados con columnas: Forma de Pago | Pagado | Propina | Total
3. Seleccionar metodo de pago
4. Ingresar cantidad (o presionar "Auto" para asignar el total completo)
5. Para pago mixto: repetir con segundo metodo de pago para el saldo restante
6. Confirmar pago
7. Pregunta de confirmacion: numero de personas
8. Se intenta abrir cajon de dinero automaticamente (DRAWER_KICK)
9. Se imprime ticket
10. Regresa a lista de ordenes (la tarjeta desaparece)

**Metodos de pago disponibles:**
Efectivo, Dolares, Cortesia, Tarjeta credito, Tarjeta debito, Rappi, Netpay, aDomicilio, Influencer, Mercadotecnia, Transferencia

**Casos borde:**
- Pago mixto: parte efectivo + parte tarjeta (el saldo se actualiza en tiempo real)
- Boton "Auto" asigna todo el saldo pendiente al metodo seleccionado
- Si hay propina, se suma al total del metodo
- Cambio se calcula automaticamente si pago en efectivo excede el total
- Confirmacion de personas al final (para estadisticas de ticket promedio)

**Permisos:**
- Algunos metodos de pago pueden requerir autorizacion de gerente (configurable en seguridad)
- Cortesia como metodo de pago requiere razon

**Riesgos de fraude:**
- Cobrar en efectivo y registrar como cortesia
- No registrar propina en efectivo
- Cobrar mas de lo que dice la cuenta y quedarse con la diferencia

**Reglas de negocio:**
- Saldo debe llegar a $0 para cerrar la orden
- Pago mixto soportado nativamente (no workaround)
- Propina se registra por metodo de pago
- Confirmacion de personas para KPI de ticket promedio
- DRAWER_KICK automatico al completar pago en efectivo

**Terminal bancaria:**
- Integraciones disponibles: Clip, Operaciones en Linea, NetPay, BBVA
- Se puede configurar para esperar confirmacion de terminal antes de cerrar la orden

**UX actual (Wansoft):**
- Lista scrolleable de metodos de pago a la izquierda
- Tabla de pagos aplicados a la derecha (trackea pagos parciales)
- Boton Auto para asignacion rapida
- Cambio calculado en tiempo real
- Ticket impreso automaticamente al cerrar

**Como hacerlo mejor en Fullsite:**
- Botones grandes de metodo de pago (no lista scrolleable)
- Highlight del metodo mas comun (efectivo/tarjeta)
- Confirmar propina con pantalla dedicada (no inline)
- Integracion directa con terminal bancaria para confirmacion automatica
- Vista previa de ticket antes de imprimir

---

## 11. Split de Cuenta

**Objetivo:** Dividir una orden en multiples cuentas separadas basandose en la asignacion de silla.

**Problema operativo que resuelve:** Grupos que quieren pagar por separado necesitan que sus items se separen en cuentas independientes sin errores manuales.

**Flujo completo:**
1. Dentro de la orden, presionar "Avanzadas"
2. Seleccionar "Dividir cuenta"
3. Se muestran todas las sillas como botones: "Seleccione la(s) silla(s) que crearan una nueva orden"
4. Seleccionar la(s) silla(s) a separar
5. Los items de esas sillas se convierten en una orden separada
6. La orden original conserva los items restantes
7. Cada orden se cobra de forma independiente

**Casos borde:**
- Si un item no tiene silla asignada, no se puede splitear automaticamente
- Multiples sillas pueden ir a la misma nueva orden
- La orden original puede quedarse con 1 sola silla

**Reglas de negocio:**
- CLAVE: el split funciona POR SILLA — la asignacion de silla al momento de captura es lo que habilita el split despues
- Sin asignacion de silla, no hay split automatico
- Cada orden splitteada tiene su propio numero de orden
- Cada orden se cobra y se imprime ticket independientemente

**UX actual (Wansoft):**
- Menu Avanzadas → Dividir cuenta
- Botones por silla para seleccionar
- Operacion inmediata al confirmar

**Como hacerlo mejor en Fullsite:**
- Vista previa del split: mostrar items de cada silla con subtotales antes de confirmar
- Permitir drag & drop de items entre cuentas (no solo por silla)
- Split por porcentaje (ej. "dividir en partes iguales entre 3 personas")
- Split por item individual (no solo por silla)
- Mantener vinculo entre ordenes splitteadas para trazabilidad

---

## 12. Descuentos y Cortesias

**Objetivo:** Aplicar descuentos parciales o cortesias totales a items o a toda la cuenta, con razones documentadas y catalogos predefinidos.

**Problema operativo que resuelve:** Descuentos sin control son el segundo vector de fraude mas comun despues de cancelaciones. Los catalogos predefinidos limitan los descuentos posibles y documentan la razon.

**Flujo completo — Descuentos:**
1. Avanzadas → Aplicar descuento (item individual) o Descuento prorrateado a la cuenta (toda la orden)
2. Se muestra catalogo de descuentos predefinidos con porcentajes
3. Opciones del catalogo: 10%, 15%, 20%, 50%, 60%, 70%, 80%, 90%
4. Razones predefinidas: 50% DESCUENTO EMPLEADOS, TELCEL 15%, DESCUENTO INFLUENCER 50%, SRA MONICA 50%, REFILL VASO REUSABLE $10, DESCUENTO MARKET 20%, BBVA 15%
5. Tambien permite: Monto abierto (cantidad fija) o Porcentaje abierto (% libre)
6. Descuento prorrateado = se distribuye proporcionalmente entre todos los items

**Flujo completo — Cortesias:**
1. Avanzadas → Aplicar cortesia
2. Se muestra catalogo: CLAUDIA SADA 100%, INFLUENCER 100%
3. Tambien permite texto libre para cortesia no catalogada
4. Cortesia = 100% gratis, siempre requiere razon

**Permisos:**
- Descuentos y cortesias tienen catalogos separados en configuracion de seguridad
- Algunos descuentos requieren autorizacion de gerente
- Se puede configurar "No dobles descuentos" (no aplicar descuento sobre descuento)

**Riesgos de fraude:**
- Aplicar descuento de empleado a un cliente regular
- Cortesia sin que el gerente lo sepa
- Descuentos excesivos del mismo mesero
- Porcentaje abierto sin justificacion real

**Reglas de negocio:**
- Descuento por item vs descuento prorrateado a la cuenta son operaciones distintas
- Cortesia siempre es 100% — si es parcial, es descuento
- Toda cortesia requiere razon escrita
- No dobles descuentos si esta habilitado en seguridad
- 2x1 es operacion separada (Avanzadas → Aplicar 2x1)
- Promociones es otra operacion separada (Avanzadas → Promociones)

**UX actual (Wansoft):**
- Catalogos predefinidos con botones
- Opcion de monto/porcentaje abierto como alternativa
- Prorrateado se distribuye automaticamente
- Razon siempre visible en el registro

**Como hacerlo mejor en Fullsite:**
- Dashboard de descuentos por mesero, por tipo, por turno
- Alerta cuando descuento total del dia excede umbral
- Aprobacion de cortesia via notificacion push al gerente (no solo huella presencial)
- Catalogo configurable por tenant (cada restaurante define sus descuentos)
- Bloquear porcentaje abierto para meseros (solo gerente)

---

## 13. Ticket

**Objetivo:** Generar recibo impreso con toda la informacion de la orden, pago, y datos fiscales.

**Problema operativo que resuelve:** El ticket es la unica evidencia fisico del consumo. Debe incluir todo para facturacion, propinas, y disputas de cobro.

**Contenido del ticket:**
- Logo AMALAY (imagen configurable con slider de tamano)
- "Ticket de Pagado" (header)
- Folio
- Fecha
- Mesa
- Personas
- Mesero
- Hora de apertura / envio / cierre
- Items con precios
- Gran Total
- Formas de pago aplicadas
- Propina
- Cambio
- Footer: "SERVICIOS NO INCLUIDOS"
- QR para app Megapuntos (lealtad)
- QR para facturacion CFDI

**Configuracion disponible:**
- IVA: 16%
- Tamano de impresion: 72mm
- Tamano QR: 270x270
- Fuentes configurables: total (12), mesa (12), orden (8)
- Header: Logo + slider de tamano, Nombre, Direccion, RFC, Razon social, Telefono 1/2
- Footer: 7 lineas de texto configurable
- Preview en vivo cuando se edita la configuracion
- Boton de prueba de impresion

**Reglas de negocio:**
- QR de facturacion electronica activado (Serie A)
- QR de Megapuntos activado
- Servicios no incluidos se imprime siempre en footer
- El ticket muestra TODAS las formas de pago si fue pago mixto

**UX actual (Wansoft):**
- Impresion automatica al cerrar orden
- Configuracion completa con preview en vivo
- Test print disponible
- QR codes integrados

**Como hacerlo mejor en Fullsite:**
- Ticket digital via QR (cliente escanea y ve su ticket en el celular)
- Facturacion directa desde el ticket digital (sin ir a portal externo)
- Diseno visual mas moderno con branding del restaurante
- Opcion de no imprimir (solo digital) para sustentabilidad

---

## 14. KDS Cocina

**Pendiente de documentar en proxima sesion.**

Lo que sabemos por feedback de Eduardo y sesiones anteriores:
- Wansoft imprime comandas fisicas — no tiene KDS digital nativo
- AMALAY usa impresoras termicas en cocina, no pantallas
- Fullsite ya tiene KDS V2 diseñado con spec completo (ver project_kds_v2_spec.md)
- KDS V2 incluye: tiempo real, batch-aware, distancia visible, station-aware
- Documentar en proxima sesion: flujo de cocina con comanda impresa, tiempos, alertas, prioridades

---

## 15. KDS Barra

**Pendiente de documentar en proxima sesion.**

Lo que sabemos:
- BARRA tiene su propia impresora separada de COCINA
- Items de cafe y bebidas rutean a impresora BARRA (ver seccion 16)
- No hay KDS digital en barra — solo comanda impresa
- Documentar en proxima sesion: flujo de barra, diferencias con cocina, tiempos de preparacion, coordinacion con cocina

---

## 16. Impresoras y Estaciones

**Objetivo:** Configurar que items se imprimen en que impresora, con que formato y que informacion.

**Problema operativo que resuelve:** Sin routing por item, la cocina recibiria comandas de cafe y la barra recibiria comandas de alimentos. Cada estacion debe recibir solo lo que le corresponde preparar.

**Configuracion de routing:**
- El routing se configura POR PLATILLO (no por grupo/categoria) en AMALAY
- Ejemplo: CHILAQUILES → impresora COCINA
- Ejemplo: Items de COFFEE → impresora BARRA
- Cada item puede rutearse a hasta 5 impresoras
- [NO IMPRIMIR] = el item no genera comanda (ej. productos de Market)

**Configuracion de comanda:**
- Header: campos configurables (orden, mesa, personas, mesero, nombre cliente)
- Detalle: silla, tamano, grupo
- Fuentes configurables por campo
- Separadores de linea
- Separadores de tiempo (XX TIEMPO)

**Reglas de negocio:**
- Routing es por platillo individual, no por categoria — permite granularidad total
- Un platillo puede ir a multiples impresoras (ej. item que requiere cocina + barra)
- [NO IMPRIMIR] es critico para Market items que no requieren preparacion
- La comanda de cancelacion se imprime en la MISMA impresora que la comanda original

**UX actual (Wansoft):**
- Configuracion por platillo en el catalogo de productos
- Selector de hasta 5 impresoras por item
- Opcion [NO IMPRIMIR] disponible
- Configuracion de formato de comanda separada de formato de ticket

**Como hacerlo mejor en Fullsite:**
- Routing por categoria como default + override por platillo (menos configuracion)
- Preview de comanda en pantalla antes de configurar
- Alertas si un item nuevo no tiene impresora asignada
- Dashboard de impresiones fallidas para detectar problemas de conectividad

---

## 17. Caja: Retiros y Depositos

**Objetivo:** Gestionar el efectivo en caja con retiros programados y depositos documentados.

**Problema operativo que resuelve:** Sin control de caja, el efectivo se acumula sin trazabilidad. Los retiros programados previenen acumulacion excesiva y reducen riesgo de robo.

**Flujo completo:**
- Retiros y depositos manuales disponibles desde el menu de caja
- Retiros programados: se puede configurar un umbral automatico — cuando el efectivo en caja excede el limite, el sistema fuerza un retiro
- En AMALAY: retiros programados NO activados (se hacen manuales)

**Permisos:**
- Retiros y depositos requieren autorizacion de gerente (configurable)

**Riesgos de fraude:**
- Retiros no documentados
- Depositos fantasma (registrar un deposito que nunca se hizo)
- No hacer retiro cuando se deberia (acumulacion de efectivo = riesgo de robo)

**Reglas de negocio:**
- Retiros programados = auto-forzar retiro cuando cash > umbral (no activado en AMALAY)
- Todo retiro/deposito debe registrar: monto, hora, usuario, razon
- El saldo de caja se actualiza en tiempo real

**UX actual (Wansoft):**
- Menu de caja con opciones de retiro/deposito
- Configuracion de retiros programados disponible pero no usada en AMALAY

**Como hacerlo mejor en Fullsite:**
- Activar retiros programados por default con umbral configurable
- Notificacion push al gerente cuando se hace un retiro
- Foto de conteo de efectivo al hacer retiro (evidencia)
- Conciliacion automatica: caja vs sistema al hacer retiro

---

## 18. Corte / Cierre de Turno

**Objetivo:** Cerrar el periodo operativo con conciliacion de ventas, pagos y efectivo.

**Problema operativo que resuelve:** Sin corte, no hay forma de saber si el dinero en caja cuadra con lo que el sistema dice. El corte es el momento de verdad donde se detectan faltantes o sobrantes.

**Flujo completo:**
1. Seleccionar tipo de corte
2. Si hay ordenes abiertas, no se puede hacer Corte Z (hay que cerrarlas primero)
3. Se genera reporte de ventas por metodo de pago
4. Arqueo de caja: contar efectivo fisico vs lo que dice el sistema (3 intentos maximo)
5. Se puede enviar por email (no configurado en AMALAY)

**Tipos de corte:**
- **Corte Z (diario):** Cierre total del dia — no se puede hacer con ordenes abiertas
- **Corte X (parcial):** Corte intermedio sin cerrar el turno
- **Corte Turno:** Cierre del turno especifico
- **Corte Mesero:** Cada mesero obtiene su propio resumen — se pueden hacer multiples por mesero
- **Corte Global:** Resumen general

**Contenido del corte:**
- Ventas por metodo de pago
- Descuentos aplicados
- Cancelaciones
- Propinas
- Arqueo de caja (efectivo contado vs sistema)
- Diferencia (faltante/sobrante)

**Reglas de negocio:**
- Corte Z requiere CERO ordenes abiertas
- Arqueo de caja permite 3 intentos maximo (despues se acepta la diferencia)
- Corte Mesero = resumen individual por mesero, util para tip-out y rendimiento
- Email de corte disponible pero no configurado en AMALAY

**Propinas:**
- Tip-out: 5% de ventas (el mesero paga al pool)
- Plaque: $0

**Comisiones:** No activadas

**UX actual (Wansoft):**
- Menu con 5 tipos de corte
- Bloqueo de Corte Z si hay ordenes abiertas
- Arqueo interactivo con 3 intentos
- Opcion de email (no usada)

**Como hacerlo mejor en Fullsite:**
- Corte digital con dashboard en tiempo real (no esperar al cierre)
- Alertas de diferencia en arqueo en tiempo real
- Corte automatico a cierta hora si no se ha hecho
- Comparativo historico: hoy vs promedio de la semana
- Envio automatico de corte por Telegram/WhatsApp al gerente

---

## 19. Permisos y Seguridad

**Objetivo:** Controlar que operaciones requieren autorizacion de gerente y definir catalogos de opciones permitidas.

**Problema operativo que resuelve:** Sin permisos, cualquier mesero puede hacer descuentos, cortesias, transferencias y cancelaciones sin supervision. El sistema de permisos es la capa de prevencion de fraude.

**Niveles de permiso:**
- Mesero: operaciones basicas (crear orden, agregar items, cobrar)
- Gerente: operaciones sensibles (cancelar, descuento, transferir, cortesia)
- Admin: acceso total (configuracion, reportes, permisos)

**Toggles de seguridad:**
- Bloquear pantalla en cada operacion
- Transferir platillos requiere autorizacion
- No dobles descuentos
- Otros toggles configurables por operacion

**6 catalogos de permisos:**
1. **Platillos que requieren gerente:** items especificos que no se pueden ordenar sin autorizacion
2. **Grupos que requieren gerente:** categorias completas restringidas
3. **Metodos de pago que requieren gerente:** formas de pago sensibles (ej. cortesia)
4. **Catalogo de descuentos:** lista de descuentos permitidos con porcentajes y razones
5. **Catalogo de cortesias:** lista de cortesias permitidas con nombres y razones
6. **Catalogo de razones de cancelacion:** razones predefinidas para cancelaciones

**Operaciones que requieren autorizacion:**
- Cancelar items enviados
- Aplicar descuentos (segun catalogo)
- Aplicar cortesias
- Transferir platillos a otra mesa
- Cambiar metodo de pago sensible
- Acceso a reportes y configuracion

**Reglas de negocio:**
- La autorizacion se da por huella digital o PIN del gerente
- Cada operacion autorizada queda registrada con: quien solicito, quien autorizo, hora
- Los catalogos son configurables por sucursal/tenant

**UX actual (Wansoft):**
- Panel de seguridad con toggles on/off
- 6 catalogos editables
- Autorizacion por huella en el momento

**Como hacerlo mejor en Fullsite:**
- Permisos por rol (no solo gerente/no-gerente, sino niveles intermedios)
- Autorizacion remota: gerente puede autorizar desde su celular
- Log inmutable de toda autorizacion (event store)
- Dashboard de operaciones autorizadas para audit trail
- Reglas dinamicas: si un mesero tiene >3 cancelaciones en un turno, siguiente requiere autorizacion

---

## 20. Configuracion de Ticket

**Objetivo:** Personalizar el formato, contenido y apariencia del ticket impreso.

**Campos configurables:**
- **Header:**
  - Logo (imagen con slider de tamano)
  - Nombre del restaurante
  - Direccion
  - RFC
  - Razon social
  - Telefono 1
  - Telefono 2
- **Contenido:**
  - IVA: 16%
  - Tamano de impresion: 72mm
  - Tamano QR: 270x270
  - Fuentes: total (12), mesa (12), orden (8)
- **Footer:**
  - 7 lineas de texto configurable
  - QR de Megapuntos (lealtad)
  - QR de facturacion CFDI
- **Factura electronica:**
  - Serie: A
  - QR en ticket: activado
- **Preview:** vista previa en vivo al editar
- **Test:** boton de prueba de impresion

**UX actual (Wansoft):**
- Panel de configuracion completo con todos los campos
- Preview en vivo que actualiza al cambiar valores
- Sliders para tamanos de fuente y QR
- Test print para verificar resultado

**Como hacerlo mejor en Fullsite:**
- Templates predefinidos (minimalista, completo, sin logo) seleccionables
- Preview en pantalla que simula ticket real a escala
- Configuracion desde dashboard web (no solo desde terminal POS)
- A/B testing de formatos de ticket (para optimizar propinas, por ejemplo)

---

## 21. Configuracion de Perifericos

**Objetivo:** Conectar y configurar todos los dispositivos externos que interactuan con el POS.

**Dispositivos soportados y estado en AMALAY:**

| Periferico | Estado | Notas |
|---|---|---|
| Cajon de dinero | Activado | Ethernet, DRAWER_KICK automatico al cobrar |
| Lector de huella | Activado | Imprime recibos de entrada/salida |
| Bascula | Activada | COM1, 9600 baud — para productos Market por peso |
| Codigo barras bascula | Activado | Lectura de barcode integrada con bascula |
| CashDro | No activado | Maquina contadora de efectivo — no instalada |
| Segunda pantalla cliente | No activada | Hardware roto — ver seccion 25 |

**UX actual (Wansoft):**
- Panel de perifericos con toggle activado/desactivado por dispositivo
- Configuracion de puerto COM y baud rate para bascula
- Tipo de conexion seleccionable (Ethernet, USB, COM)

**Como hacerlo mejor en Fullsite:**
- Auto-deteccion de perifericos conectados
- Status de salud de cada periferico en tiempo real (online/offline)
- Alerta cuando un periferico se desconecta
- Configuracion guiada paso a paso para nuevos perifericos

---

## 22. Inventario (desde POS)

**Objetivo:** Validar existencias en tiempo real y opcionalmente bloquear la venta cuando el stock llega a cero.

**Flujo completo:**
- Existencias locales: funcionalidad disponible pero NO activada en AMALAY
- Se puede activar para bloquear venta cuando stock = 0
- Se seleccionan que grupos de productos validar (no todos necesariamente)
- Al cancelar un item, la pregunta "SE PREPARO?" determina si el stock regresa o no (merma)

**Reglas de negocio:**
- El inventario es opcional — AMALAY no lo usa desde el POS
- Si se activa, se puede elegir por grupo que productos validan stock
- Bloqueo de venta en stock 0 es configurable
- La cancelacion con merma NO devuelve stock; sin merma SI devuelve stock

**UX actual (Wansoft):**
- Toggle de activacion en configuracion
- Selector de grupos de productos a validar
- Mensaje de bloqueo cuando stock = 0 (si esta activo)

**Como hacerlo mejor en Fullsite:**
- Inventario siempre activo con alertas (no bloqueo silencioso)
- Recetas con auto-deduccion de ingredientes (feedback Monica)
- Reorder points con alerta automatica al proveedor
- Dashboard de stock critico en tiempo real
- Conteo fisico guiado desde el POS (workflow de Alex — almacen)

---

## 23. Reportes Locales

**Pendiente de documentar en proxima sesion.**

Lo que sabemos:
- Wansoft tiene reportes locales accesibles desde la terminal
- Los cortes (Z, X, Turno, Mesero, Global) generan reportes — ver seccion 18
- Wansoft web tiene reportes adicionales (explorer, query agent ya implementados en Fullsite)
- Documentar en proxima sesion: tipos de reportes disponibles, filtros, exportacion, graficas

---

## 24. Huellas Digitales

**Pendiente de documentar en proxima sesion.**

Lo que sabemos:
- Lector de huella HID esta instalado y activado en AMALAY
- Se usa para: login, autorizacion de gerente, registro de entrada/salida
- Imprime recibos de entrada/salida del personal
- Fullsite ya tiene lector HID integrado (sesion Jul 7-8)
- Documentar en proxima sesion: flujo de registro de huellas, numero de huellas por usuario, fallback cuando huella no lee, administracion de usuarios

---

## 25. Pantalla Cliente

**Pendiente de documentar en proxima sesion.**

Lo que sabemos:
- Segunda pantalla de cliente existe como periferico en Wansoft
- En AMALAY: NO activada porque el hardware esta roto
- Deberia mostrar items conforme se capturan y el total en tiempo real
- Documentar en proxima sesion: contenido mostrado, configuracion, resolucion, rotacion de pantalla, contenido publicitario entre ordenes

---

## Apendice A: Menu Avanzadas (13 operaciones)

Operaciones disponibles desde el boton "Avanzadas" dentro de una orden:

| # | Operacion | Descripcion |
|---|---|---|
| 1 | Borrar partida | Eliminar item no enviado |
| 2 | Aplicar descuento | Descuento a item individual |
| 3 | Aplicar cortesia | Cortesia 100% a item individual |
| 4 | Aplicar 2x1 | Promocion 2x1 |
| 5 | Transferir de mesa | Mover item individual a otra mesa |
| 6 | Cambiar # de silla | Reasignar silla de un item |
| 7 | Cambiar estatus cancelada-anulada | Cambiar tipo de cancelacion |
| 8 | Ver detalle | Ver detalle del item seleccionado |
| 9 | Descuento prorrateado a la cuenta | Descuento distribuido en toda la orden |
| 10 | Cambiar # de mesa | Mover toda la orden a otra mesa |
| 11 | Cambiar # de personas | Actualizar numero de personas |
| 12 | Dividir cuenta | Split por silla |
| 13 | Promociones | Aplicar promocion del catalogo |

---

## Apendice B: Configuracion Operativa

| Parametro | Valor en AMALAY |
|---|---|
| Tipo de operacion | Modo completo |
| Tipo punto de venta | Caja |
| Restaurante | Habilitado |
| Para llevar | Habilitado |
| Tiempos (XX TIEMPO) | Activado |
| Sillas | Activadas |
| Para llevar pide | Nombre cliente + numero torre |
| Alerta ordenes desatendidas | 30 min para llevar/delivery |

---

## Apendice C: Configuracion de Diseno

| Parametro | Valor default |
|---|---|
| Ancho de boton | 90 |
| Alto de boton | 50 |
| Fuente de boton | 11 |
| Ajuste | Sliders en tiempo real |
| Preview | Boton de preview en vivo |

---

## Apendice D: Propinas y Comisiones

| Concepto | Valor |
|---|---|
| Tip-out | 5% de ventas (mesero paga al pool) |
| Plaque | $0 |
| Comisiones | No activadas |

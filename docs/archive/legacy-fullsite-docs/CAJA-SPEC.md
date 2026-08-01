# Wansoft Caja (Netsilver) — Spec de referencia completa

> Documentado el 2026-06-11 ~23:30-23:48 desde capturas en vivo de la terminal de caja
> de AMALAY (acceso remoto). Usuario: Oscar Bernal Aguilar, Turno 3.
> Objetivo: replicar TODO el flujo en Fullsite POS y superarlo en cada punto.
> Contexto técnico: Wansoft POS = "Netsilver" internamente (.NET 4.5, VB.NET,
> Enterprise Library 2007, SQL Server LOCAL en la terminal, update API SOAP sin HTTPS).
> Ver `~/.claude/.../memory/reference_netsilver.md`.

---

## 1. Pantalla principal de Caja

**Header (barra azul):** logo wansoft · Usuario actual · Turno: 3 · Fecha · MESA(S): · Ventas Pendientes: 0 · icono señal (sync/online)

**Toolbar:**
| Botón | Función |
|---|---|
| Opciones (hamburguesa) | Abre menú de operaciones (sección 2) |
| Editar (lápiz) | Edita la cuenta seleccionada |
| Imprimir | Reimprime ticket de cuenta seleccionada |
| Cobrar ($) | Va a pantalla de cobro (sección 9) |
| Filtros (embudo) | Modal de filtro (sección 5) |
| Puntos rojo/verde/morado | Semáforo de estatus de cuentas (abiertas/impresas/por cobrar) |
| Nueva | Alta de cuenta (sección 6) |
| Actualizar | Refresh de la lista |
| Delivery (badge contador) | Módulo delivery (sección 4) |
| Admin (engrane) | Menú administración (sección 3) |
| Bloquear (candado) | Bloquea la terminal (vuelve a login/PIN) |

**Cuerpo:** lista de cuentas abiertas. Footer: "Sin registros que mostrar" + paginación "Pág. 0 de 0".

---

## 2. Menú Opciones — 4 columnas

| Mesa | Domicilio | CXC | Otros |
|---|---|---|---|
| Juntar mesas | Ventas a domicilio | Cobranza *(gris/deshabilitado)* | Cambiar cuenta |
| Cambiar de mesa | Asignar repartidor | Clientes VIP *(gris)* | Ver detalle |
| Cambiar mesero | Cambiar billete | | Órdenes abiertas |
| Activar HH *(Happy Hour/Half&Half)* | Cerrar por repartidor | | Existencias *(gris)* |
| Ventas de mesero | Cambiar tiempo | | Cerrar con cód. barra |
| | | | Asignar cliente |
| | | | Nombre cliente |
| | | | Agregar Propina |
| | | | Código CheckIn |

Notas:
- "Cerrar con cód. barra" = cierre rápido escaneando el ticket.
- "Código CheckIn" = integración de lealtad/reservas.
- Botones grises = módulos no contratados/deshabilitados → Wansoft cobra por módulo.

---

## 3. Menú Admin (Administración)

Grid de botones:
- **Configurar netsilver** (config interna del POS)
- **Realizar corte** · **Emitir factura** · **Huella digital**
- **Reimprimir ticket** · **Cambiar forma de pago** (post-cobro) · **Registrar vale** · **Cambiar No. Personas**
- **Cancelaciones** · **Reimprimir factura** · **Propinas**
- **Reportes locales** · **Depurar BD** · **Abrir Cajón** · **Depósitos**
- **Retiros** · **Reimpresión de voucher** · **Pagos anticipados**
- **Salir del sistema** · **Regresar**

Notas:
- "Cambiar forma de pago" después de cobrada = riesgo de fraude si no hay audit trail (Eduardo lo pidió blindado).
- "Depurar BD" expuesto al usuario de caja = señal del stack viejo (SQL local que se llena).
- "Abrir Cajón" sin venta = otro punto de auditoría.

---

## 4. Módulo Delivery

- **Filtro por estatus:** En proceso · Por entregar · Entregada · Rechazada/Cancelada
- **Filtro por plataforma:** UberEats · Rappi · DiDi Food · (genérica) · Wansoft eCommerce · OTROS
- **Lista de órdenes:** logo plataforma + número de orden (ej. 2448434002) + nombre plataforma + estatus doble ("Confirmada" / "Pendiente")
- Botón Regresar, Filtros, Actualizar. Paginación.

Lo visto en vivo: 3 órdenes Rappi confirmadas pendientes a las 23:30.

---

## 5. Modal de Filtros

- Radio: **Número Orden · Número Mesa · Nombre Mesero · Nombre Cliente**
- Campo de texto + **teclado táctil completo en pantalla** (QWERTY con Ñ, números, Esc/Borrar/Clr/Espacio/Enter)
- El teclado en pantalla aparece en todo input (terminal touch sin teclado físico)

---

## 6. Nueva cuenta

- **Lista de meseros** (selección obligatoria): Aldo Ruiz, Alexis Alejandro Ocampo Vera, Antonio Sanchez, APLICACIONES, Brayan, Dany Rico, Hector Enrique Rodriguez Lopez, Julio, Mariana Salas, Mario García Ramírez, Mauricio Rodriguez…
  - "APLICACIONES" = pseudo-mesero para ventas de plataformas delivery
- Campos: **Mesa** (numpad) · **Personas** · **Nombre cliente** (opcional)
- Teclado táctil + numpad lado derecho

---

## 7. Pantalla de captura (cuenta abierta)

**Header:** mesero (Aldo Ruiz) · Turno · Mesa: 99 · fecha/hora

**Izquierda — ticket:**
- Campo **Código:** + ACEPTAR (captura por código de barras / código de producto)
- Tabla: # · Descripción · Total · **Silla**
- Primera línea automática: "XX TIEMPO: 1 XX" → **separador de tiempos** (1er tiempo, 2do tiempo para cocina)
- Footer: No. artículos · Descuentos · Total

**Centro — controles:**
- **CANT.** +/- (cantidad del siguiente item)
- **SILLA** +/- (asiento al que se asigna el item → permite dividir por persona)
- Columna de iconos: ✕ borrar partida · ✎ editar · ☰ lista/detalle · 🕐 **tiempos** (agregar separador de tiempo) · 🔥 enviar a cocina/fuego · ⏩ apurar · ⧉ duplicar partida · ⚙/badge descuentos
- 🔍 búsqueda de producto

**Derecha — navegación de menú (3 niveles):**
1. **Categorías raíz** (botones guinda): ALIMENTOS · BEBIDAS · MARKET · ALCOHOL · POSTRES · APETTIZERS · VENTAS TERCEROS · EVENTO/MENU
2. **Subcategorías** (ej. ALIMENTOS, color-coded): PIZZAS & PASTAS · EGGS & KETO · EVERYDAY SPECIALS · CEVICHE · ACTIVACIONES · SIGNATURE · BOWLS · TOAST & BAGELS · CHILAQUILES & ENCHILADAS · CROISSANTS BREAKFAST · KETO MENU · PANCAKES & WAFFLES · KIDS MENU · SOUPS & SALADS · PANINIS · MUNCHIES · EXTRAS · ENVIOS — con flecha ← para regresar
3. **Items** (ej. BOWLS): ACAI B KIND BOWL · ACAI LOVE BOWL · FRUIT BOWL · YOGURT Y GRANOLA BOWL

**Barra inferior:** Avanzadas · Cancelar · Imprimir · Cobrar · Guardar

**Al guardar/imprimir** aparece prompt: *"¡NO OLVIDES ANOTAR TODAS LAS ESPECIFICACIONES A TUS PLATILLOS! ¿Desea continuar?"* (Sí/No) → recordatorio de modificadores, es un nag, no validación real.

---

## 8. Edición de cuenta (Avanzadas / Ver detalle)

Partida ejemplo: "ACAI B KIND BOWL, Habits Vainilla Proteina Vegana, Habits Colágeno — $295.00"
(los **modificadores van concatenados en la descripción**, suman al precio)

Tabla: Cant · Descripción · Importe · Descuento · Total · Silla

**Acciones (columna derecha):**
- Borrar partida
- Aplicar descuento
- Aplicar cortesía
- **Aplicar 2 x 1**
- Transferir de mesa
- Cambiar # de silla
- Cambiar estatus de cancelada-anulada
- Ver detalle
- **Descuento prorrateado a la cuenta**
- Cambiar # de mesa
- Cambiar # de personas
- **Dividir cuenta**
- **Promociones**
- Regresar (rojo)

**Reglas observadas en vivo (mesa 99 de prueba, 2026-06-12 00:18):**
- **2x1 es por platillo**: al intentar aplicar 2x1 a un item no elegible → modal "EL PLATILLO 'ACAI B KIND BOWL' NO ACEPTA 2X1." La elegibilidad 2x1 se configura en el catálogo de platillos, no es global.
- **Cambiar # de personas** abre pantalla dedicada con numpad: "Proporcione el número de personas en esta orden." (7-8-9/4-5-6/1-2-3/0-. + Enter/Borrar/ESC)

---

## 9. Pantalla de cobro

**Izquierda — formas de pago (lista COMPLETA, confirmada con scroll 2026-06-12 00:15):**
Efectivo · Dolares · Cortesia · Tarjeta de crédito · Tarjeta de débito · **Rappi** · **Netpay** · **aDomicilio** · **Influencer** · **Mercadotecnia** · Transferencia electrónica · **Claudia Sada** · **Vale Amalay** · **Venta Terceros** · **Ubereats** · **Pago Open Table** · "Otras formas de pago"
→ formas de pago **custom configurables** — incluso por PERSONA ("Claudia Sada" es una forma de pago con nombre propio). Influencer/Mercadotecnia = cuentas internas de marketing; Vale Amalay = vales propios.

**Centro:**
- "Cliente no asignado." (liga a cliente para factura/CXC)
- Total de la cuenta: 295.00
- Cantidad recibida (input)
- Propina (+ botón para agregar)
- Cambio (calculado)
- Saldo: 295.00
- Botones: Pago con tarjeta · Pago electrónico · Descuento VIP *(gris)* · Recompensas

**Derecha:**
- Tabla **Forma de Pago · Pagado · Propina · Total** → soporta **pago mixto** (multi-forma en una cuenta)
- Botón **Auto** (autocompleta el saldo restante)
- Numpad grande + display verde $0.00
- Enter · Borrar · Regresar · 0 · . · Guardar
- Header muestra "Ventas Pendientes: 0" durante el cobro

**Modal "pagar" (Tarjeta de crédito / pago electrónico, 00:16):** popup con input "tarjeta" (swipe/captura del número), monto "pesos a pagar", botones consultar / pagar / recompensas / cerrar — es la integración de cobro con tarjeta/monedero (consultar saldo, cobrar, acumular recompensas) directamente en el flujo.

**Menú de cortes (00:11):** pantalla con 4 botones — **Corte de Mesero · Corte de Turno · Corte X · Corte Z** — más **Reenviar por mail** y **Reimpresiones** (reimprimir cortes anteriores). Confirma el modelo de 5 cortes de la sección 12.9.

---

## 10. Gap analysis vs Fullsite POS (`dashboard-app/src/app/pos/page.tsx`, 2026-06-11)

### Ya lo tenemos
- ✅ Split de cuenta (dividir) — básico
- ✅ Cortesías
- ✅ Propinas
- ✅ Barcode
- ✅ Corte
- ✅ Descuentos con aprobación de manager (mejor que Wansoft: audit trail)
- ✅ PIN lock / kiosko
- ✅ Categorías → items (2 niveles)

### Gaps (no existe en Fullsite POS hoy)
| Gap | Prioridad | Nota |
|---|---|---|
| **Sillas/asientos por partida** | ALTA | Base para dividir por persona; Wansoft lo tiene en captura Y edición |
| **Tiempos de platillo** (1er/2do tiempo a cocina) | ALTA | Crítico para cocina en servicio real |
| **Pago mixto** (multi-forma de pago + Auto) | ALTA | Wansoft lo resuelve bien; indispensable |
| **Formas de pago custom** (Influencer, Mercadotecnia, vales) | ALTA | Config por cliente |
| **Módulo Delivery** (Rappi/Uber/DiDi: estatus + repartidores) | ALTA | AMALAY recibe Rappi a diario |
| **Promociones / 2x1** | ALTA | Eduardo lo pidió #1 |
| **Juntar mesas / transferir mesa / cambiar mesero** | MEDIA | Operación diaria de piso |
| **Descuento prorrateado a la cuenta** | MEDIA | |
| **Cambiar forma de pago post-cobro** (con auditoría) | MEDIA | Punto de fraude en Wansoft → nosotros con approval + log |
| **Facturación (CFDI)** | MEDIA | Wansoft emite factura desde caja |
| **Retiros / Depósitos / Abrir cajón** (con motivo + log) | MEDIA | |
| **Asignar cliente / CXC / pagos anticipados** | BAJA | Wansoft lo tiene gris (módulo extra) |
| **Código CheckIn / Recompensas / VIP** | BAJA | Lealtad |
| **Huella digital** | BAJA | Nosotros: PIN ya resuelto |

### Dónde ganarle a Wansoft (no copiar — superar)
1. **Especificaciones**: Wansoft solo muestra un nag "no olvides anotar". Fullsite: modificadores estructurados obligatorios por item (ya los tenemos) + sugerencias IA de upsell en el momento de captura.
2. **Nada borrable**: Wansoft permite "Depurar BD" y cambiar forma de pago sin rastro visible. Fullsite: todo es append-only + approval de manager (tesis Eduardo).
3. **Offline-first real**: Netsilver depende de SQL Server local — si la terminal muere, los datos mueren con ella. Fullsite: Capacitor offline + sync a Supabase = respaldo continuo en la nube, restaurable en cualquier dispositivo en minutos. **"Netsilver pero mil veces mejor": la terminal es desechable, los datos son eternos.**
4. **Cualquier hardware**: Wansoft = terminal propietaria con huella y cajón. Fullsite = cualquier browser/tablet.
5. **IA en la caja**: el cajero pregunta "¿cuánto llevamos hoy?" y el copilot contesta — Wansoft requiere ir a reportes.
6. **Delivery unificado**: no solo listar órdenes Rappi — conciliar automáticamente contra el corte y detectar faltantes de plataforma.

---

## 11. Estrategia de respaldo "anti-Netsilver"

Netsilver guarda todo en SQL Server local cifrado con DPAPI (descifrable en la propia máquina). Nuestra arquitectura ya es superior, pero formalizar:

- **Cada orden** se escribe local (IndexedDB/Capacitor) Y a Supabase en cuanto hay red (ya existe).
- **Backup diario** automático de todas las tablas pos_* (endpoint `/api/backup` con Bearer admin ya existe) → agregar retención (30 días) y export descargable.
- **Restore en 1 paso**: cualquier tablet nueva con login = POS operativo con todo el historial.
- (Opcional futuro) si AMALAY necesita migrar histórico de Wansoft: la DB local de Netsilver es accesible en la terminal — el connection string se descifra con DPAPI en la propia máquina.

## 12. Configuración de Terminal ("Configurar Netsilver") — capturas 14-18, 2026-06-11 23:53-23:56

Admin → Configurar Netsilver abre el panel de configuración de la terminal. Es la "config impecable" que Eduardo elogió: TODO es configurable desde la propia caja, sin tocar archivos.

### 12.1 Menú principal de configuración (~20 módulos)

| Fila | Botones |
|---|---|
| 1 | Operativas · Seguridad · Cierre de cuentas · Periféricos |
| 2 | Cortes y apertura · Ticket · Comanda · Factura electrónica |
| 3 | Retiros · Diseño · Billares |
| 4 | Reportes · Megapuntos · Propinas · Nómina |
| 5 | Control de mesas (gris/deshabilitado) · Comisiones · Terminales bancarias · Mapa de mesas |
| 6 | Anticipos · Tiempo aire · Notificaciones |
| 7 | Existencias locales · Wannapay (gris/deshabilitado) |

Notas: módulos no contratados aparecen en gris (Control de mesas, Wannapay). "Billares" y "Tiempo aire" revelan que Netsilver es genérico multi-vertical (no específico de restaurantes). Header muestra Turno: 3.

### 12.2 Configuración de Comanda (la más rica)

Cuatro grupos:

**Encabezado** (checkboxes + tamaños de letra):
- Fecha, Terminal, Tipo de orden ✓, Número de orden ✓, Número de mesa ✓, Número de personas ✓, Nombre de mesero ✓, Imprimir mesero actual al editar, Hora de impresión, Nombre del cliente ✓, Dirección del cliente
- Tamaños de letra independientes: tipo de orden (14), número torre (10), nombre mesero (10), número mesa (12), número orden (10)

**Detalle**:
- Agregar silla ✓, Agregar tamaño antes del platillo ✓, Agregar grupo, Cantidad de modificadores, Imprimir modificadores por renglón ✓, Distancia entre concepto (15), Imprimir línea entre conceptos ✓, Imp. conceptos agrupados al inicio, Imp. platillos agrupados al inicio, Imp. modificadores agrupados al inicio, Tamaño letra (14)

**Imp. comanda al cerrar cuenta**: por tipo de orden — Restaurante, Para llevar, A domicilio, Por recoger (checkboxes independientes)

**Mensaje**: texto custom, agregar en encabezado, tamaño letra (10)

**Tiempos**: Texto firebutton = `***PREPARAR Y SAC...` (mensaje que se imprime en cocina al disparar un tiempo), "Por tiempo sin detalle" (en rojo)

**Etiquetas**: activar impresión de etiquetas, configurar grupos de etiquetas, configurar tamaño impresión

**Impresoras** (columna derecha): Configurar impresión por grupo, Configurar impresión por platillo, Duplicar impresión, Impresoras involucradas, Catálogo de Impresoras

### 12.3 Ruteo de impresión por grupo (Impresoras Grupo)

- Selector de tipo grupo (ej. ALCOHOL → subgrupos LICORES 2OZ, BEBIDAS OH, VINOS, CERVEZA)
- Cada grupo del menú mapea a **impresora primaria + secundaria**:
  - COCINA CALIENTE: Bowls, Toast & Bagels, Chilaquiles & Enchiladas, Pancakes & Waffles, Soups & Salads, Paninis, Appetizers, Croissants Breakfast, Desserts, Kids Menu
  - BARRA: Jugos, Coffee Hot/Ice
- Checkbox "Permitir configurar un grupo en 2 imp. primarias"
- Al cambiar de modo, advertencia destructiva: *"El direccionamiento actual es por platillo ¿Está seguro de querer cambiar la configuración?"* — el ruteo puede ser por grupo O por platillo individual, y cambiarlo pisa la config existente

### 12.4 Mapa de mesas

- Checkbox "Activar mapa de mesas" (AMALAY lo tiene DESACTIVADO — usan número de mesa directo)
- Layout (editor visual), Permisos por sección, Sección default

### 12.5 Configuración de Propinas (captura 19, 23:58)

- Imprimir reporte de propinas a pagar (checkbox, off)
- **Porcentaje de venta que el mesero pagará: 5** — el mesero "paga" 5% de su venta (descuento de propinas por comisiones de tarjeta / fondo común)
- Plaque (en pesos): 0
- Impresiones: número de impresiones de retiro de fondo (1), de pago de propina (1)

### 12.6 Configuración de Seguridad (captura 20, 23:58) — config real de AMALAY

**Toggles de seguridad** (estado actual AMALAY):

| Opción | AMALAY |
|---|---|
| Bloquear pantalla en cada operación | off |
| Bloquear con protector de pantalla | off |
| Pedir clave al reimprimir preticket | off |
| **Cambio de platillos a otra mesa** | **ON** |
| Descuentos sobre descuentos | off |
| Cambio forma de pago de días anteriores | off |
| Cancelar ventas de días anteriores | off |
| Cambiar tipo de impresión días anteriores | off |
| **Permite editar cuenta después de preticket** | **ON** |
| Guardar logs de acciones | off (!) |

**Permisos de gerente** (6 catálogos configurables):
- Platillos que requieren permiso de gerente
- Grupos que requieren permiso de gerente
- Formas de pago que requieren permiso de gerente
- Catálogo de descuentos
- Catálogo de cortesías
- Catálogo de cancelaciones/anulaciones/devoluciones

Hallazgo crítico: **"Guardar logs de acciones" está APAGADO en AMALAY** — Wansoft ni siquiera audita por default. Fullsite debe auditar SIEMPRE (no opcional), que es exactamente el requisito anti-fraude de Eduardo: "nothing deleteable, audit trail". Aquí Wansoft trata la auditoría como checkbox; Fullsite la trae de fábrica.

### 12.7 Operativas (captura 21, 2026-06-12 00:07) — config core de AMALAY

**Tipo de operación**: Modo completo (otros: mesero, para llevar, retail) · Tipo punto de venta: **Caja**
**Tipos de órdenes activos**: Restaurante ✓, Para llevar ✓, eCommerce ✓ · A domicilio ✗, Por recoger ✗
**Retail** (sección gris, no contratada): devoluciones sobre artículos con descuento, ticket de regalo, asignación de vendedor, tipo de precio

**Restaurante**: Activar tiempos ✓ (lo demás off: excluir platillos preparados por tiempo, reiniciar silla en cada tiempo, consecutivo en comanda, control de mesas con lista)
**Para llevar**: Asignar mesa y personas ✓, Preguntar nombre de cliente ✓ (¿comer aquí? ✗, número de torre ✗)
**A domicilio**: Preguntar cantidad a pagar ✓ (asignar repartidor ✗, tiempo de entrega ✗, cargo por envío ✗)
**Lista de órdenes**: alerta a los 30 min en llevar/domicilio/recoger; vista "Impresa" para todas

**Pantalla de captura**: Activar funcionalidad de sillas ✓, Cambiar platillo de silla ✓, Mostrar tipo de grupos ✓, Permitir captura de decimales ✓ · OFF: botón código de barras, **Happy Hour**, actualizar mesero al editar, forzar tamaño, preticket por silla, control automático de sillas, popup de marcas, clave al eliminar partida no guardada
**Pantalla clientes**: Buscar cliente por teléfono ✓, Validar dígitos ✓ (10 dígitos) · OFF: cargar lista de clientes, **registrar huella del cliente** (la huella existe como feature)

### 12.8 Cierre de cuentas (captura 22, 00:07)

**General**: Cerrar múltiples cuentas ✓, Preguntar personas al cerrar ✓, Confirmar captura correcta al cerrar/guardar ✓, cierre automático ecommerce ✗
**Cuentas a crédito (CXC)**: desactivado; límite de crédito $20,000.00; vista preliminar de órdenes por cobrar ✓
**Pagos**: Activar propina ✓, Mostrar propinas en corte ✓, **Activar auto pago ✓** (botón "Auto" del cobro), pagos parciales ✗, forma de pago default Ninguna, **incluir el cambio como propina en pagos con cuenta bancaria ✓**, número de tarjeta de regalo ✓, grupos para tarjetas de regalo configurables

### 12.9 Cortes y apertura (captura 23, 00:07) — anatomía del corte Wansoft

Hay **5 tipos de corte**: X (parcial), Turno, Z (cierre día), Global y de Mesero.

- **Corte Z y Global**: vista preliminar de corte global ✓; permitir corte Z con órdenes abiertas ✗; horas máximas para corte: 9; impresiones Z: 1, global: 0; opcionales (todos off en AMALAY): reporte platillos/modificadores, ventas por terminal, detalle de vales, desglose de impuestos
- **Corte X y Turno**: bloquear botón corte X ✗; impresiones X: 1, Turno: 1
- **Corte de mesero**: impresiones: 1; permite varios cortes por mesero ✗
- **Apertura de caja**: "llenar fondo de caja con efectivo real del corte Z anterior" ✗
- **Arqueo de caja**: desactivado; monto considerando propina ✓; 3 intentos de arqueo
- **Envío por email**: apertura/corte turno/corte global por correo — todo OFF (otra señal: AMALAY no recibe sus cortes digitalmente; Fullsite los manda a Telegram)

### 12.10 Ticket (captura 24, 00:07) — formato exacto a clonar

**Generales**: IVA 16% · 1 impresión · Imprimir ticket de pagado ✓ y delivery ✓ · **QR de encuestas en preticket ✓** (270×270) · Tamaño de impresión: **72 mm** · tamaños de letra: gran total 12, mesa 12, orden 8 · % default propina en ticket: 0 · botón "Configurar encabezado, pie de página y logo"
**Preticket**: 1 impresión · **mostrar propina sugerida ✓** con catálogo de propinas sugeridas configurable · impresora de órdenes integradas: EC01
**Campos visibles** (✓): encabezado, mesa, personas, mesero/cajero, hora entrada, hora cierre, fecha preticket, hora impresión, pie de página · (✗): IVA y subtotal, total por tipo de grupo

### 12.11 Factura electrónica (captura 25, 00:08)

Serie A · **Mostrar QR de código de facturación en ticket ✓** (autofacturación) · complemento de pago CXC ✗ · desglosar IEPS ✗ · PPD como CXC ✗

### 12.12 Retiros (captura 26, 00:08)

**Retiros programados**: desactivado (existe la feature: forzar retiro al acumular $X de ventas, reiniciar al corte de turno, considerar fondo de caja) · Mostrar detalle de saldos en pantalla de retiros ✓

### 12.13 Reportes (captura 27, 00:08)

Solo 2 opciones: impresora de reportes (= PANADERIA) e imprimir automáticamente (✗). Los reportes reales viven en el portal web.

### 12.14 Comisiones (captura 28, 00:09)

Pago de comisiones a cajero: desactivado · permitir corte turno/Z con comisiones pendientes ✓✓ · comisiones en corte de mesero ✗

### 12.15 Terminales bancarias (captura 29, 00:09)

**Integraciones nativas: Clip, Operaciones en Línea, NetPay, BBVA** — 4 procesadores de pago integrados. "Esperar en pantalla de cobro" (mesa/llevar/recoger) todo off · imprimir detalle de pagos bancarios en cortes (turno/Z/X/global) todo off

### 12.16 Anticipos (captura 30, 00:09)

Una sola opción: número de impresiones de ticket de anticipos (1). El flujo de anticipos vive en otra parte — relevante para eventos AMA-XXXX.

### 12.17 Existencias locales (captura 31, 00:10)

Desactivado. La feature: validar existencias por grupo en la terminal (bloquear venta sin stock). AMALAY no la usa.

### 12.18 Implicaciones para Fullsite POS (ver también sección 13)

1. **Ruteo de impresión por grupo/platillo con primaria+secundaria** es el core de la operación de cocina — gap ALTA nuevo (el POS actual imprime todo igual).
2. **Comanda configurable** (qué campos, tamaños de letra, por tipo de orden) — Wansoft lo resuelve con 30 checkboxes; Fullsite puede hacerlo con presets + preview en vivo, mucho mejor UX.
3. **Firebutton/tiempos** confirma que los tiempos disparan impresión en cocina con mensaje custom.
4. **Sillas** aparecen también a nivel impresión ("Agregar silla" en comanda) — refuerza prioridad ALTA.
5. AMALAY tiene mapa de mesas y Control de mesas apagados — el mapa visual NO es prioridad para la migración.
6. Ventaja Fullsite: config en la nube por sucursal (no por terminal), versionada, con rollback — Netsilver la guarda local en cada terminal.
7. **Audit log SIEMPRE activo** (en Wansoft es checkbox y AMALAY lo tiene apagado) — argumento de venta directo con el feedback anti-fraude de Eduardo.
8. **Permisos de gerente granulares** por platillo/grupo/forma de pago/descuento/cortesía/cancelación — el POS ya tiene manager PIN; falta la matriz configurable de QUÉ lo requiere.
9. Propinas: soportar % que el mesero paga sobre venta (5% en AMALAY) en el corte y en tips_analyzer.
10. **Sillas confirmadas ACTIVAS en AMALAY** (Operativas: funcionalidad de sillas ✓, cambiar platillo de silla ✓) — gap ALTA validado: lo usan a diario.
11. **Tiempos confirmados ACTIVOS** (Operativas: activar tiempos ✓) — ídem.
12. **Modelo de cortes**: X (parcial) / Turno / Z (día) / Global / Mesero + apertura con fondo + arqueo opcional. El corte de Fullsite debe cubrir al menos Turno + Z + Mesero. "Horas máximas para corte: 9" implica validación de duración de turno.
13. **Ticket 72mm** con QR de encuestas en preticket + QR de autofacturación en ticket pagado + propina sugerida configurable — clonar formato exacto (campos visibles listados en 12.10).
14. **Pagos**: auto-pago activo, "cambio como propina en pagos bancarios" activo — regla de negocio real de AMALAY que el POS debe replicar.
15. **Integraciones bancarias**: Clip, NetPay, BBVA, Operaciones en Línea — para migrar, Fullsite necesita mínimo NetPay (la que usan) o registro manual de referencia.
16. Features que Wansoft tiene pero AMALAY NO usa (prioridad baja): CXC/crédito, arqueo, retiros programados, existencias locales, huella de cliente, Happy Hour automático, cargo por envío, asignar repartidor, email de cortes, modo retail.

## 13. Flujos operativos en vivo (capturas 37-46, 2026-06-12 00:15-00:26, mesa 99 de prueba)

### 13.1 Cancelación de orden

Flujo completo observado:
1. Botón Cancelar → pantalla **"Proporcione razón de cancelación."**: lista de razones predefinidas (scrolleable) + campo de texto libre + teclado touch completo (QWERTY con Ñ, números, símbolos)
2. Pregunta crítica de inventario: **"¿SE PREPARÓ LA ORDEN (SALIERON LOS PRODUCTOS DE INVENTARIO)?" NO / SI**
   - SI → la cancelación descuenta inventario (merma) aunque no se cobró
   - NO → regresa insumos al stock
   - Esto alimenta el reporte de cancelaciones de Wansoft que ya scrapeamos (kitchen_quality_agent)

### 13.2 Tiempos (firebutton) en acción

- La cuenta muestra el separador `XX TIEMPO: 1 XX` ($0.00, silla 0) como partida — los tiempos SON partidas especiales en el modelo de datos
- Botón de fuego (🔥 icono) → pantalla **"Impresión por tiempos"**: muestra "Tiempo siguiente: 1" + botones Regresar / **Imprimir** → dispara la comanda del siguiente tiempo a cocina (con el texto firebutton "***PREPARAR Y SAC..." de la config 12.2)
- Cuenta de prueba: 2x KETO PANELA WALLANDER $350.00 c/u = $700.00

### 13.3 Permisos en cascada (retiros)

1. Usuario sin permiso intenta retiro → **"Lo sentimos pero no cuenta con permisos para retiros, ¿desea apoyo de otra persona con permiso?" Si / No**
2. Si → pantalla **"Validación de permisos"**: numpad para que el gerente capture su clave SIN cerrar la sesión del cajero
- Patrón clave: **escalation in-place** — el gerente autoriza con su clave sobre la marcha. Fullsite ya tiene manager PIN; falta este flujo de "pedir apoyo" elegante + registrar QUIÉN autorizó en el audit log (Wansoft ni guarda logs)

### 13.3b Permisos restringidos al cajero (confirmados en vivo)

Operaciones que el usuario de caja NO puede hacer sin permiso (todas con el flujo de escalation 13.3):
- **Retiros**
- **Depósitos**
- **Asignar repartidores** ("LO SENTIMOS PERO NO CUENTA CON PERMISOS PARA ASIGNAR REPARTIDORES.")

### 13.3c Ventas a domicilio — pantalla de repartidores (captura 47, 00:28)

"Seleccione el repartidor" con dos tablas:
- **Órdenes asignadas** (filtro dropdown "Todas") y **Órdenes sin asignar**
- Columnas: No. · Cliente · Dirección · Repartidor · Captura · En ruta · Tiempo · F. Pago · Total · **Billete** · **Cambio**
  - "Billete" y "Cambio": capturan con cuánto paga el cliente para mandar el cambio exacto con el repartidor
  - "Captura / En ruta / Tiempo": timestamps de pipeline — mide tiempo de entrega
- Botones: Asignar repartidor · Cambiar billete · Actualizar · Cerrar · **Ver Cerradas**
- AMALAY: vacía (domicilio propio desactivado en Operativas; usan Rappi/Uber)

### 13.4 Detalle de captura adicional

- Menú raíz confirmado (8 tipos grupo, frame watcher 00:31): ALIMENTOS · BEBIDAS · MARKET · ALCOHOL · POSTRES · APETTIZERS (sic) · **VENTAS TERCEROS** · **EVENTO/MENU**
  - "VENTAS TERCEROS" como categoría raíz coincide con la forma de pago "Venta Terceros" — productos vendidos por cuenta de terceros se aíslan a nivel menú Y pago
  - "EVENTO/MENU" — menú especial para eventos (paquetes)
- Subcategorías cocina: PIZZAS & PASTAS, EGGS & KETO, EVERYDAY SPECIALS, KIDS MENU, SOUPS & SALADS, PANINIS, MUNCHIES, EXTRAS, ENVIOS
- "ENVIOS" existe como categoría de menú (cargo de envío como producto)
- Meseros vistos en flujos: Oscar Bernal Aguilar (caja), Aldo Ruiz

### 13.5 Edición de cuenta — dropdown de selección de partidas (captura 50, 00:35)

En la pantalla de edición (mesa 99, $700.00), arriba de la tabla de partidas hay un dropdown de selección masiva con 3 opciones:
- **Deseleccionar todos**
- **Seleccionar todos**
- **Seleccionar todos los platillos que apliquen descuento** ← confirma que la elegibilidad de descuento es flag por platillo en catálogo (igual que 2x1)

Lista completa de botones laterales confirmada: Borrar partida · Aplicar descuento · Aplicar cortesía · Aplicar 2 x 1 · Transferir de mesa · Cambiar # de silla · Cambiar estatus de cancelada-anulada · Ver detalle · Descuento prorrateado a la cuenta · Cambiar # de mesa · Cambiar # de personas · Dividir cuenta · Promociones · Regresar.

### 13.6 Pantalla de Promociones (captura 51, 00:36)

Layout de 3 columnas:
- **Detalle de la orden** (tabla # · Descripción, con dropdown "Seleccionar todos" arriba)
- **Promociones disponibles**
- **Promociones aplicadas**
- Footer: contador "0 artículos seleccionados" + botones Regresar · Aplicar

Modelo: se seleccionan partidas de la orden, el sistema muestra qué promociones aplican a esa selección, y al aplicar pasan a la columna de aplicadas. **AMALAY no tiene NINGUNA promoción configurada** (columnas vacías) — el gap "promociones" en Fullsite puede ser MVP simple: motor de promos por selección de partidas, sin necesidad de replicar complejidad.

### 13.7 Asignación de repartidores — "Seleccione empleado" (captura 52, 00:37)

Tras pedir asignar repartidor (con permiso de gerente), aparece selector de empleado:
- Lista de TODOS los empleados (no hay rol "repartidor" separado): ALDO RUIZ, ALEXIS ALEJANDRO OCAMPO VERA, ANTONIO SANCHEZ, APLICACIONES, BRAYAN, DANY RICO, HECTOR ENRIQUE RODRIGUEZ LO…, JULIO, MARIANA SALAS, MARIO GARCÍA RAMÍREZ, MAURICIO RODRIGUEZ, MESERO EVENTO, OMAR, OSCAR ALAVARADO, PRUEBAS 1, RODRIGO CHÁVEZ, SAMUEL FRAUSTO
  - Nota: existen empleados "utilitarios": **APLICACIONES**, **PRUEBAS 1**, **MESERO EVENTO** — Wansoft no distingue cuentas de sistema de personas reales
- Panel derecho de totales del repartidor: **Total de Pedidos #** (0) · **Total de Cambios $** ($0.00) · **Total Asignados #** ($0.00) — controla efectivo/cambio que carga el repartidor
- Botones: Cancelar selección · **T. estimado** (tiempo estimado de entrega) · **Billete** · Aplicar · Actualizar · Cerrar cuentas (deshabilitado sin selección)

## 14. Hardware físico y ticket de corte real (fotos 2026-06-12 00:37)

### 14.1 Hardware de la caja AMALAY

- **Terminal**: monitor touch all-in-one marca **Wansoft** (hardware propietario, sticker de garantía atrás) + teclado físico USB
- **Cajón de dinero**: cajón metálico estándar con llave, debajo del mostrador, conectado a la impresora (apertura por RJ11)
- **Terminales bancarias**: 2x **Getnet** (Santander) — Android, rojas, con impresora integrada
  - OJO: Getnet NO aparece en las integraciones de "Terminales bancarias" del config (Clip / Operaciones en Línea / NetPay / BBVA) → las Getnet operan STANDALONE, el cajero teclea el monto a mano = riesgo de descuadre, sin conciliación automática
- En el mueble: pilas de comanderos/cuentas físicas, ticket de corte impreso al lado del cajón

### 14.2 Ticket "Reporte Corte Turno" — estructura completa (impreso real, 06/12/2026 0:37:47)

Encabezado: Fecha (11 junio 2026) · Terminal: 1 · Cajero: Oscar Ricardo Bernal Aguilar · No. Turno: 3

**TOTALES GENERALES**
- Total de Venta s/Impts. · IVA · IEPS · Total de Venta c/Impts.

**VENTAS POR FORMA DE PAGO**
- Una línea por forma usada (Efectivo $0.00...) · Total Ventas

**PROPINA POR FORMA DE PAGO**
- Efectivo... · Total Propina

**CONTROL POR FORMA PAGO** (sección Efectivo — el arqueo del turno)
- Fondo de Caja: $1,700.00
- (+) Por Ventas · (+) Por Propina · (+) Depósitos · (−) Vales
- **Efectivo Real**: $1,700.00
- **Ef.Real−PropinasXTarjeta**: $1,700.00 ← el efectivo que debe haber en el cajón (resta las propinas de tarjeta que se pagan en efectivo al mesero)

**INFORMACIÓN OPERATIVA** (KPIs del turno)
- Total de Órdenes · Total de Platillos · Total de Personas
- Promedio platillos/orden · Promedio $/orden · Promedio $/persona
- Ventas en mesa · Ventas a domicilio · Ventas para llevar · Ventas por recoger
- Cortesías en Cuentas · Cortesías en Platillos
- Cancelaciones de Cuentas · Cancelaciones en Platillos
- Anulaciones de Cuentas · Anulación en Platillos
- Descuentos en Platillos · DXU en Platillos (descuento por 2x1) · Descuento Megapuntos
- Tarjeta de Regalo · Promociones
- Pagos de anticipos · Anticipos cancelados · Devolución de anticipos
- Footer: "Fecha impresión: MM/DD/YYYY H:MM:SS"

**Implicación Fullsite**: este es EL formato de referencia para el corte de turno del POS. El fondo de caja ($1,700.00) persiste entre turnos. La fórmula clave del arqueo: `Efectivo esperado = Fondo + Ventas efectivo + Propinas efectivo + Depósitos − Vales − PropinasXTarjeta pagadas`. Fullsite debe generar este mismo ticket 72mm + versión digital con drill-down.

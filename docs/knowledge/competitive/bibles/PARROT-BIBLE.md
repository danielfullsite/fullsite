# PARROT BIBLE — el competidor directo, de pies a cabeza

**Fecha:** 2026-08-27 · **Método:** sitio oficial (parrotsoftware.com.mx), blog propio ("99 razones"), ecosistema parrot.rest, comparativa de Last.app (sesgada, marcada), prensa de funding, insider (llamada Alejandro ex-Parrot 2026-08-20). Convención: [HECHO] / [INFERENCIA] / [HIPÓTESIS].
**Complementa:** `../COMPETITIVE-INTELLIGENCE.md` §2.3 (estrategia) y `../../strategy/LECCIONES-ALEJANDRO-PARROT-BENTO.md` (insider). Este doc es la **anatomía del producto**.

---

## 1. Ficha

- CDMX. YC S20. Funding: $2.1M seed (dic-2020: Liquid2/Joe Montana, Foundation Capital, Superhuman angels, Ed Baker de Uber) + **$9.5M Series A ene-2022 (F Prime Capital)** = $11.7M total. **Sin Series B anunciada a 2026-08** [HECHO] — 4.5 años sin ronda nueva: o hay revenue sano, o hay presión [HIPÓTESIS].
- **1,500+ restaurantes** (marketing dice "más de 1,000 dueños") [HECHO].
- Clientes notables visibles en su portal de facturación: **Mochomos MTY (Grupo Costeño)**, Rosso Vivo, RamenYa, Lázaro y Diego, Casa de Huésped, Mata de Chile [HECHO]. Que Mochomos use Parrot = ya venden a grupos serios de Monterrey.
- Venta: WhatsApp directo (+52 1 55 3473 8304) + demo agendada + account manager. Marketing de contenido agresivo (blog HubSpot en blog.parrotsoftware.io). **Compran ads de YouTube contra las búsquedas de Soft Restaurant** (verificado 2026-08-27: buscar "soft restaurant 12 tutorial" muestra anuncio de Parrot arriba) — cazan la base instalada del incumbente sobre sus propias búsquedas de soporte [HECHO].
- **Ecosistema de dominios** [HECHO]: `admin.parrot.rest` (back-office **"ParrotConnect"**) · `facturacion.parrot.rest/{restaurante}` (portal CFDI de autofactura por cliente) · `pedidos.parrot.rest/{restaurante}` (ordering online por cliente).

## 2. Mapa completo del producto [HECHO]

| Pieza | Qué es |
|---|---|
| **POS Android** | Cajas todo-en-uno (impresora integrada) · segunda caja · tablets comanderas · doble pantalla al cliente (promos/agregadores en mostrador, claim +23% ticket) |
| **Parrot Pay** | Terminal de pagos propia "la única creada para restaurantes en México" — split por partes iguales o por artículo, propinas, **autoconciliación automática con el POS** (su diferenciador #1) |
| **KDS** | Pantalla de cocina, órdenes por tiempos, notificación automática a cocina |
| **ParrotConnect** | Back-office web (admin.parrot.rest) — ~30 pantallas de reportes |
| **Parrot App** | App del dueño (iOS/Android): ventas, cancelaciones, descuentos, ticket promedio en tiempo real |
| **Inventario** | Recetas a nivel ingrediente, multicanal, categorías, proveedores, merma |
| **Facturación** | QR en ticket → comensal autofactura en **<45 segundos** · folios LIMITADOS por plan (100–500) |
| **Personal** | Checador con **lector de huella integrado**, asistencias/horas desde el celular (solo plan alto) |
| **Delivery** | Integración Uber Eats + Rappi + DiDi Food directo al POS (su cuña original de mercado) |
| **Reservas** | NO nativas — integración OpenTable, solo planes altos |
| **Loyalty/CRM** | Certificados de regalo · "conoce quiénes vuelven" · promociones personalizadas |
| **Parrot Grow** | NUEVO 2026 — marketing con IA por WhatsApp (ver §5) |

Claims de marketing: recupera 10 h/semana · +28% ventas · recupera $276,000 MXN por discrepancias de cortes · +40% propinas con Parrot Pay · +126% crecimiento por integraciones [HECHO que lo dicen; INFERENCIA sobre veracidad].

## 3. El POS de pies a cabeza

- **Android nativo y exclusivo** — sin iOS, sin iPad, sin Windows para operar [HECHO].
- Entrenamiento: "2 horas máximo" para un empleado nuevo [HECHO — su claim].
- Multi-mesa y multi-canal; modo quick-service; **dark kitchens multi-marca** (varias marcas virtuales en una cocina — feature que nosotros no tenemos) [HECHO].
- Permisos multiusuario personalizados.
- **Offline: "modo offline con sync al reconectar"** [HECHO que lo afirman — profundidad NO documentada públicamente. Ni una página técnica sobre qué pasa con multi-dispositivo offline. Contraste: nosotros tenemos protocolo certificado en campo]. Pregunta de venta sugerida: "¿qué pasa en Parrot si se va el internet con 10 mesas abiertas y dos cajas?"
- Hardware: la terminal suele venir incluida con la suscripción [HECHO — per comparativa Last.app].
- **Parrot Pay no es procesamiento propio**: la letra chica del sitio dice "integra distintos partners y proveedores" — es white-label; no pueden negociar tasas ni controlar el stack [HECHO la letra chica; INFERENCIA la implicación].

## 4. ParrotConnect (back-office) + Parrot App

- ~**30 pantallas de reportes** [HECHO — su blog]: ventas por hora/día/mes/año, rentabilidad por platillo, cancelaciones, descuentos, ticket promedio, export a Excel, reportes configurables.
- Tiempo real desde navegador o app del dueño. Monitoreo de desempeño por empleado.
- Título de su página de reportes: "El patrón de los restaurantes rentables" — venden el reporte como insight, no como tabla [HECHO].
- Autoconciliación de pagos visible desde el celular (cobros, cancelaciones, conciliaciones).
- API: **solo en tiers premium** [HECHO — per Last.app].

## 5. Parrot Grow — su jugada de IA (2026, en lista de espera) [HECHO]

La pieza más importante para nosotros. Marketing automático por WhatsApp:

1. **Base de clientes** unificada desde POS + delivery + WiFi del local + códigos QR.
2. **IA analiza ventas** → detecta días/horarios/productos flojos.
3. **La IA propone la campaña, redacta el mensaje** (con nombres de platillos y tono de la marca), **la programa** a la hora de mejor respuesta, cuida frecuencia de envío → envío por **WhatsApp** → **mide la venta real** generada (no clicks).

- Claims: +45% ticket promedio en el turno activado · +200% contactos nuevos/semana · +70% venta en un día flojo.
- Onboarding: "conecta tu punto de venta, tu router y tu WhatsApp Business en minutos".
- Roadmap anunciado: **Lealtad con sellos digitales en wallet** del celular (piloto) · **Pedidos en Línea propios sin comisión** (este año).
- Estado: lista de espera, acceso por grupos pequeños [HECHO].

**Lectura para Fullsite [INFERENCIA]:**
- Valida nuestra dirección (IA + WhatsApp + datos del POS) — y valida el CANAL: WhatsApp, no app.
- Pero Grow es **solo marketing/CRM**. No tienen nada público de IA **operativa**: stock, fraude, staffing, predicción de cierre, clima, mermas — todo ese terreno es nuestro hoy.
- Nuestro crm-recompra + campañas es choque frontal con Grow. Diferenciador nuestro: el copiloto responde PREGUNTAS del dueño y cubre operación completa; Grow solo dispara promociones.
- Su “mide ventas, no interacciones” es el estándar correcto — nuestros agentes deben reportar `value` en pesos SIEMPRE (ya es la dirección de agent_events con value+outcome).

## 6. Pricing [HECHO]

| Plan | MXN/mes + IVA | Notas |
|---|---|---|
| Starter | $1,800 | 100 folios de factura |
| Pro | $2,100 | |
| All-In-One / Full Service | $2,800 | 500 folios; time clock; OpenTable |

- Terminal incluida con suscripción típicamente. Comisiones de procesamiento estimadas: $3,200–7,000 MXN/año extra [HECHO — per Last.app].
- Actualizaciones cada 45 días. Soporte 365 días, call center + account manager.
- vs Fullsite (~$1,999 todo incluido): su All-In-One cuesta 40% más y la IA (Grow) ni siquiera está disponible general.

## 7. Debilidades

1. **Ecosistema cerrado**: hardware propio obligatorio, Android-only, Parrot Pay white-label sin margen de negociar tasas [HECHO/INFERENCIA].
2. **Folios de factura limitados por plan** (100–500/mes) — cobrar por facturar es fricción absurda en un país donde el SAT obliga [HECHO].
3. **Sin reservas nativas**; OpenTable solo en planes altos [HECHO].
4. **API solo premium** [HECHO].
5. **Offline sin documentación técnica** — claim sin evidencia [HECHO que no hay docs].
6. **Sin IA operativa** — Grow es marketing y está en waitlist [HECHO].
7. Precio alto para el mercado ($2,800 All-In-One) [HECHO].
8. Insider (Alejandro): la rotación del equipo temprano y el rebuild Windows→cloud costaron años [HECHO de la llamada].

## 8. Qué copiar · qué evitar · cómo ganarle

**Copiar:**
- **Autofactura QR en <45 segundos** con portal por restaurante (facturacion.parrot.rest/{slug}) — es EL benchmark para nuestro CFDI/Facturapi. El comensal no debe hablar con nadie para facturar.
- **Autoconciliación pagos-POS como mensaje de venta** ("recupera $276K por discrepancias de cortes") — nuestro cuadre/matriz-dinero contado en pesos recuperados, no en features.
- **Grow mide venta generada, no opens** — estándar para nuestros agentes de marketing.
- Lector de huella para checador — hardware barato, dolor real, los dueños lo citan.
- Doble pantalla al cliente en mostrador (upsell pasivo, +23% ticket su claim).
- Interactive demo en el sitio ("Prueba este Demo en tiempo real") — bajar la fricción de ver el producto sin agendar llamada.
- Dark kitchens multi-marca: una cocina, N marcas virtuales — si aparece un prospecto así hoy, no lo cubrimos.

**Evitar:**
- Cobrar por folios de factura. Jamás.
- API solo premium: nuestra API abierta es diferenciador contra ellos.
- Waitlist de un año para la feature estrella (Grow) — nosotros embarcamos IA desde el día 1.

**Cómo ganarle (choque directo — mismo ICP, misma ciudad a veces):**
- **IA operativa completa vs Grow-marketing**: demo de agentes de stock/fraude/cierre + copiloto respondiendo "¿cuánto vendí hoy vs el martes pasado?" por WhatsApp. Parrot no tiene respuesta a eso hoy.
- **Offline demostrable**: "apaga el módem" en la demo. Ellos no publican ni una página técnica de su offline.
- **Facturación sin límite de folios** + precio menor ($1,999 vs $2,800).
- **Reservas nativas** (amalay_reservaciones ya existe) vs su dependencia de OpenTable.
- Donde ellos ganan hoy y hay que reconocerlo: agregación de delivery madura (Uber/Rappi/DiDi estable — nuestra integración Uber sigue en cert), terminal con autoconciliación (nuestro gap de pagos), y marca/pipeline YC.

## 9. Así se ve — recorrido visual del POS y la terminal (2026-08-27) [HECHO — tour interactivo oficial recorrido pantalla por pantalla]

Recorrí completo su demo Arcade oficial ("Crear nueva orden", `demo.arcade.software/CCdAuXAK7oXAYWW3T7SC`). Lo que se ve:

**1. Vista Mesas (home del POS):**
- Nav superior negro: Menú · **Mesas** · Pedidos · Configuración · Cajas + iconos de sync/usuario/ayuda + "Cerrar sesión". Corre sobre Android (barra de estado visible).
- Áreas como tabs (Comedor / Terraza) + botón Historial. Grid de mesas como tarjetas blancas planas (B01–B24) **paginado en 5 páginas** — no hay plano del piso, solo lista cuadriculada; con 100+ mesas se navega por paginación.
- Estética: fondo gris claro, tarjetas blancas, acento rojo Parrot. Limpia pero plana; sin estados visuales ricos por mesa (solo la ocupada muestra total + folio + "2P" en verde/amarillo).

**2. Abrir mesa:** modal "Elige el número de personas" (1–5 y "+") → Aceptar. Los comensales son dato obligatorio de entrada.

**3. Pantalla de orden (el corazón):**
- Header: selector de **marca** ("ParrotFood Tacos" con dropdown — el multimarca/dark-kitchen es real y visible) + búsqueda de artículo.
- Tres niveles de filtro apilados: MENÚ (comida/bebida/total/promoción/sucursal) → CATEGORÍA (chips de colores: Tacos verde, Entrada rosa, etc.) → ARTÍCULO (tarjetas nombre+precio con franja de color por categoría).
- Ticket a la derecha: mesa/área/personas + tipo de servicio ("Comer aquí") + botón Acciones · secciones Artículos/Resumen · "+ Notas" y "+ Descuentos" · Total · CTA negro "Enviar a cocina" (deshabilitado hasta tener items).
- El tap en el artículo suma cantidad directo (2 taps = 2×) — sin modal de modificadores en el flujo feliz.

**4. Enviar a cocina:** regresa a Mesas; la mesa ocupada muestra total ($45.00), folio (060125-P0006) y "2P". Toast verde: "La orden de la mesa B06 fue creada con éxito" + tooltip: **"sincronizada automáticamente a la terminal Parrot Pay"** — el POS→terminal es EL momento que su demo vende.

**5. Terminal Parrot Pay (hardware propio, marca "parrotconnect | pay"):**
- Pantalla de la terminal: usuaria logueada ("Andrea H."), botón Sync, y **lista de órdenes abiertas por mesa con folio, hora y total** — la terminal VE las mesas del POS sin reteclear nada. Tabs: Órdenes / Movimientos / Ayuda.
- Cobro: teclado numérico con **"Dividir"** (split desde la terminal), Limpiar, Total → "Continuar a propina".
- Propina la elige el comensal en la terminal: **5% / 10% / 15% / Otro / Sin propina** (sugerencias BAJAS vs Toast 18/20/22% — calibradas a México).
- "Pago exitoso": desglose Consumo $45.00 + Propina $4.50 = $49.50, tarjeta •••• 1987 → Imprimir voucher / Enviar por correo / Cerrar.

**6. Cierre:** en el POS, la mesa refleja el pago (Subtotal $40.00 + IVA $5.00 = $45.00, faltante $0.00 en rojo→verde) con botones Reimprimir / Editar / **Cerrar orden** / Pagar. Cerrar libera la mesa.

**Lecturas [INFERENCIA]:**
- Su demo entero es la venta de UNA cosa: cero recaptura entre POS y terminal (la autoconciliación). El flujo de orden en sí es estándar.
- El IVA se muestra desglosado en el ticket del POS ($40 + $5) — desglose fiscal visible al mesero.
- No aparecen en el tour: modificadores, tiempos de platillo, cursos, KDS, ni transferencia de mesa. El segundo tour (Parrot Pay, `demo.arcade.software/1aFAWESVHJZJ55KsKauk`) repite el ángulo de cobro.
- Grid de mesas paginado y sin plano = experiencia pobre para salones grandes; nuestro table map tiene ventaja visual ahí.

## 10. Material de estudio [HECHO]

- Interactive demo en su homepage: parrotsoftware.com.mx ("Prueba este Demo en tiempo real").
- YouTube: canal de Parrot con tutoriales en español — ej. "Cómo establecer descuentos" (kRI24RieRGw), "Cómo actualizar tu POS Parrot 2025" (J9XeSDPpg3U). Recorrer el canal completo = ver el producto pantalla por pantalla.
- Portales vivos para inspección: facturacion.parrot.rest/mochomos-mty (flujo de autofactura real, sin login) · pedidos.parrot.rest/taqueria-el-mexicano (su ordering).
- Login del back-office: admin.parrot.rest/signin (la pantalla dice mucho del producto).
- Blog: blog.parrotsoftware.io + "99 razones" (inventario de features de su propia boca).
- Parrot Academy: parrotsoftware.com.mx/parrot-academy (cómo entrenan a clientes).
- Comparativa de Last.app (sesgada pero con datos): last.app/mx/last-lessons/last-app-vs-parrot-...

## 11. Qué falta por verificar

- [ ] Recorrer el interactive demo del sitio y capturar pantallas del POS a `assets/`.
- [ ] Recorrer el flujo completo de facturacion.parrot.rest/mochomos-mty (cronometrar los "45 segundos").
- [ ] ¿Series B o revenue? — monitorear prensa/LinkedIn (headcount) trimestralmente.
- [ ] Precio real de Parrot Grow cuando salga de waitlist.
- [ ] Profundidad real del offline (preguntar a un cliente actual de Parrot o ex-empleado; Alejandro puede saber).
- [ ] ¿Tienen ya pedidos en línea GA (pedidos.parrot.rest sugiere que sí, al menos en beta)?

# SOFT RESTAURANT BIBLE — el incumbente, de pies a cabeza

**Fecha:** 2026-08-27 · **Método:** sitios oficiales (softrestaurant.com, nationalsoft.com.mx, nationalsoft.store), búsqueda pública. Convención: [HECHO] / [INFERENCIA] / [HIPÓTESIS].
**Complementa:** `../COMPETITIVE-INTELLIGENCE.md` §2.4. Este doc es la **anatomía del producto**. Wansoft (el otro legacy, ya de Clip) tiene biblia propia en `../../wansoft/BIBLE.md`.

---

## 1. Ficha

- National Soft, Mérida + CDMX. **25+ años. 42,000+ restaurantes. 14 países.** [HECHO — su sitio]
- **El POS #1 de México por base instalada.** Canal: red de **distribuidores autorizados** (venden, instalan, capacitan, dan soporte de primera línea) [HECHO].
- **SR 12 recién lanzado (2026)** — el producto vive, no está congelado [HECHO].
- Jugada notable: **licenciamiento académico** — siembran SR gratis/barato en escuelas de gastronomía. Cada generación de gerentes/meseros sale sabiendo SR. Ese es su verdadero moat de distribución [HECHO el programa; INFERENCIA el efecto].

## 2. Arquitectura — su fortaleza y su condena [HECHO]

- **Windows-only, client-server LAN clásico**: un equipo servidor (Win 10/11 PRO LTSC o Server 2022, i3–i5, 4–8 GB RAM, 64–128 GB disco) + estaciones comanderas Windows. **No compatible con ARM.**
- Consecuencias:
  - **Offline-first por diseño** (el servidor está EN el local — igual que Wansoft, igual que nuestro Bridge). Los legacy MX nunca tuvieron el problema de offline de los cloud-POS; ese es el benchmark que ya conocíamos.
  - Pero: hardware caro (PC + estaciones Windows vs tablets Android), instalación por distribuidor (días, no minutos), actualizaciones lentas de distribuir, cero movilidad nativa (SR Móvil es add-on de pago).
- Licencias por "nodos" (equipos simultáneos): LITE = 2 nodos, PRO = 10 nodos. Cambio de equipo: 1 vez al año [HECHO].

## 3. SR 12 — qué trae (lanzamiento 2026) [HECHO — su página de precios]

- **SR Admin disponible en iOS** (por fin app del dueño).
- **Analytics 3.0**: 25+ reportes en tiempo real — bitácora, cortes de caja, efectivo, cuentas, productos cancelados.
- **Importación de compras por XML (CFDI) con vinculación automática de insumos** — LA feature. Es exactamente la "Fase 1" que Alejandro nos recomendó (anclar entradas de inventario con la factura del proveedor). **El incumbente ya la tiene; nosotros la tenemos en OP-21 pendiente.**
- **WhatsApp Business v2.0**: envío de cortes X y alertas de seguridad por WhatsApp — los legacy TAMBIÉN ya están en WhatsApp (v2.0 implica que la v1 tiene tiempo).
- Corte Z por email · Recall en KDS (modo ventanas) · selección de propina por comensal en 2ª pantalla All-in-One · Look&Feel nuevo (Light/Classic/**Dark Mode**) · protector de pantalla en comanderos · actualizaciones automáticas.

## 4. Mapa del producto [HECHO]

**Core SR 12:** punto de venta + administración + inventarios (insumos, recetas, almacenes) + facturación CFDI nativa (paquetes de folios aparte) + promociones/combos + monitoreo web remoto de ventas/mesas.

**Add-Ons (cada uno se cobra aparte):**
| Add-On | Qué hace |
|---|---|
| **SR Móvil** | Comandera en tablet/celular en la mesa (claim: +30% ventas) |
| **Menú Digital** | Fotos, descripciones, valor nutricional, traducción automática |
| **e-Delivery** | Pedidos a domicilio/pickup desde web o app propia del restaurante |
| **SR Payments** | Terminal de pagos integrada — NUEVA: el incumbente también entró a la guerra de pagos |
| **Delivery Manager** | Agregador de apps de delivery al POS con descarga automática de órdenes + portal web |
| **Kiosko autoservicio** | Con terminal de pago integrada |
| Monitor de cocina (KDS) | Módulo clásico |
| Reservaciones | Módulo |

**Lectura:** el modelo es **fragmentación** — todo lo que Parrot/Fullsite incluyen, SR lo vende en pedazos. El precio base engaña: un SR "completo" (PRO + Móvil + Delivery Manager + KDS + folios + hardware Windows + distribuidor) se acerca o rebasa el costo de los cloud-POS [INFERENCIA].

## 5. Pricing [HECHO]

| Plan | MXN/mes + IVA | Nodos |
|---|---|---|
| SR 12 LITE | $799 (promo "tiempo limitado") | 2 |
| SR 12 PRO | $1,099 (promo) | 10 |

- También licencia anual. Add-ons, folios CFDI, instalación/capacitación/configuración: **todo aparte, cotizado por distribuidor**.
- Soporte técnico + academia en línea: incluidos sin costo extra [HECHO — su claim].
- El costo REAL de entrada incluye el hardware Windows (~$130K MXN en un caso Wansoft comparable — ver `project_wansoft_real_costs`) y los servicios del distribuidor [INFERENCIA por analogía].

## 6. Debilidades

1. **UX de otra década** — Windows desktop, mouse/teclado, densidad de menús (mismo ADN que Wansoft) [INFERENCIA fuerte por familia de producto].
2. **Cero IA** en todo el catálogo — ni un feature de IA anunciado en SR 12 [HECHO — su propia lista de novedades].
3. **Fragmentación de add-ons** — el dueño compra 6 SKUs para tener lo que un cloud-POS da en uno.
4. **Dependencia del distribuidor** — la calidad de instalación/soporte varía por región; el dueño no le compra a National Soft, le compra a un intermediario.
5. **Windows + no-ARM** — hardware caro, sin tablets baratas, sin Android.
6. **Movilidad tardía** — SR Admin iOS apenas en SR 12 (2026); Toast Now existe desde 2022, Parrot App desde el inicio.

## 7. Qué copiar · qué evitar · cómo ganarle

**Copiar:**
- **Importación de compras por XML CFDI con vinculación de insumos** — no es opcional: si el legacy lo tiene, un prospecto que migra DE SR nos lo va a pedir. Sube la prioridad de OP-21 (recepción-factura).
- **WhatsApp para cortes X y alertas** — validación de que hasta el incumbente eligió WhatsApp como canal del dueño. Nuestra ventaja: nuestro WhatsApp conversa (copiloto), el suyo solo empuja.
- **Licenciamiento académico** — sembrar Fullsite en 1-2 escuelas de gastronomía de MTY cuando tengamos 10+ clientes: cada egresado es un vendedor.
- Propina por comensal en la pantalla del cliente.
- Su página de "casos de éxito" + academia gratuita + videotutoriales como máquina de contenido.

**Evitar:**
- El modelo de add-ons fragmentados: nuestro "todo incluido" es el anti-SR.
- La dependencia de intermediarios para instalar (nuestro instalador <30 min es el anti-distribuidor).

**Cómo ganarle:**
- El flanco es **el dueño joven que hereda un SR del papá**: UX moderna + IA + WhatsApp conversacional + precio todo-incluido vs SKUs sueltos. Coincide con nuestro ICP de dueño-operador (Alejandro).
- NO atacar por precio base ($799 es imbatible) — atacar por **costo total real** (hardware Windows + add-ons + distribuidor) y por **lo que no tienen ni tendrán: IA**.
- Respetar su offline: es tan bueno como el nuestro (servidor local). El argumento contra SR no es offline — es inteligencia, movilidad y modernidad.

## 8. Material de estudio [HECHO]

- Videotutoriales oficiales: softrestaurant.com/videotutoriales (el producto pantalla por pantalla).
- Academia gratuita: softrestaurant.com/academia-gratuita-soft-restaurant.
- Manuales: softrestaurant.com/recursos/manuales · presentación comercial: /recursos/presentacion-comercial (su pitch, en PDF).
- Catálogo de módulos y precios: nationalsoft.store (tienda en línea con precios reales por SKU).
- Casos de éxito: softrestaurant.com/casos-de-exito.
- Integraciones: softrestaurant.com/integraciones.
- Requisitos de sistema (arquitectura): softrestaurant.com/soft-restaurant-precio (sección requerimientos).

## 9. Qué falta por verificar

- [ ] Precios reales de cada add-on en nationalsoft.store (la tienda carga con sesión; el WebFetch falló por certificado — entrar con navegador).
- [ ] SR Cloud (/cloud): qué es exactamente — ¿SaaS real o VDI del desktop? [pendiente]
- [ ] Costo de paquetes de folios CFDI.
- [ ] Demo de SR 12: conseguir video completo o demo con distribuidor (anónimo).
- [ ] Cuánto cobra un distribuidor típico de MTY por instalación + capacitación.

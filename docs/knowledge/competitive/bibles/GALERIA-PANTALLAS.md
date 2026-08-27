# Galería de pantallas — POS · KDS · Dashboard, lado a lado

**Fecha:** 2026-08-27 · Imágenes descargadas de fuentes oficiales (CDNs de cada empresa, demo Arcade de Parrot, video-tutoriales públicos de SR) a `assets/`. Cada biblia tiene el detalle; esto es para VER y comparar de un vistazo. Huecos marcados — se cierran con las demos del [`GUION-DEMOS-COMPETENCIA.md`](GUION-DEMOS-COMPETENCIA.md).

---

## 1. El POS — la pantalla de venta

### Toast — Quick Order (mostrador) y Table Order (mesa, oscuro)

![Toast POS Quick Order](assets/toast-pos-quickorder.jpg)

![Toast POS Table Order](assets/toast-pos-tableorder-dark.jpg)

**Qué mirar:** jerarquía Menus→Groups→Items siempre visible (cero taps de profundidad) · **contador de stock pre-86 en el tile** (15, 14...) · dark contextual para comedor con el MISMO layout · Pay azul (identidad ≠ interacción, ver TOAST-BIBLE §15).

### Parrot — Mesas → Orden → Cobro (demo oficial)

![Parrot Mesas](assets/parrot-pos-01.jpg)

![Parrot Orden](assets/parrot-pos-05.jpg)

![Parrot Cobro](assets/parrot-pos-08.jpg)

**Qué mirar:** mesas en grid paginado SIN plano (5 páginas — con salón grande se navega a clics) · selector de MARCA arriba de la orden (multimarca/dark kitchen real) · 3 niveles de filtro (menú→categoría→artículo con franjas de color) · **IVA desglosado en el ticket** ($40+$5) · panel de cobro con Reimprimir/Editar/Cerrar orden. Los pasos 02-04, 06-07 y 09 del tour están en `assets/parrot-pos-*.jpg`.

### Soft Restaurant — home del POS y comandero (SR 10/11; SR12 = misma estructura, piel nueva)

![SR home](assets/sr-admin.jpg)

![SR comandero](assets/sr-comandero.jpg)

**Qué mirar:** ventana Windows con barra de MENÚS (11 menús) + ribbon de F-keys (F7 COMEDOR, F8 DOMICILIO, F9 RÁPIDO, F2/F3 TURNO, CORTE CAJA X) — **operación por teclado de 2010** · el comandero: modal "Captura de productos" con grid rojo de categorías, botonera F12/eliminar/separador, panel de mesero y áreas. Ventanas dentro de ventanas. El contraste con cualquier grid táctil ES la demo de venta.

### Square — menú con fotos (iPad)

![Square POS](assets/square-pos-menu.jpg)

**Qué mirar:** el POS más visual de todos — categorías en colores saturados con conteo de items, **fotos de platillo como protagonistas**, check a la derecha con tabs Check/Actions/Guest, y menú contextual "Edit item / **Make item unavailable**" — el 86 a un long-press.

### Fullsite — dónde estamos parados [INFERENCIA]

Mismo patrón convergente (ticket + grid). Nuestras ventajas visibles hoy: table map real (vs grid paginado de Parrot), web/PWA sin lock-in de hardware. Robar: contador pre-86 en tile (Toast), fotos protagonistas (Square), IVA visible en ticket (Parrot ya lo hace, nosotros también — mantener).

---

## 2. El KDS — la pantalla de cocina

### Toast — el estándar de oro (claro y oscuro)

![Toast KDS claro](assets/toast-kds-light.jpg)

![Toast KDS oscuro](assets/toast-kds-dark.jpg)

**Qué mirar:** cronómetro + semáforo por ticket · **"NOT PAID"** (cocina ve qué cuenta sigue abierta) · contorno naranja = orden online · secciones por curso · Recall / All Day View / Recently fulfilled · filtro por estación en el título.

### Square — KDS en iPad

![Square KDS](assets/square-kds.jpg)

**Qué mirar:** columnas con header de color por estado (rojo/naranja/gris programado, fila VOID en rojo oscuro), toggle "Open/Completed", paginación por estaciones. Más simple que Toast — sin cursos visibles ni not-paid.

### Parrot — ❌ sin material público
Ni el demo ni el canal muestran su KDS. Se cierra en la demo comercial (pregunta 2 del guion). Sospecha [HIPÓTESIS]: básico — lista de comandas por tiempos, sin routing por estación.

### Soft Restaurant — ❌ sin captura aún
El "Monitor de producción" existe (módulo clásico + Recall en SR12) pero no hay screen-recording público decente. Se cierra con el distribuidor (pregunta 2 del guion).

---

## 3. El Dashboard / back-office — la pantalla del dueño

### Toast — Toast Web + Toast Now (celular)

![Toast Web nav](assets/toast-web-nav.jpg)

![Toast Now](assets/toast-now-app.jpg)

**Qué mirar:** sidebar naranja con árbol de reportes (74 en 9 categorías) · en el celular, **cada KPI = valor + % vs referencia + sparkline** (nunca un número solo) · SPLH en primera pantalla.

### Parrot — ParrotConnect (visto en tutoriales; sin captura descargable de reportes actuales)
Navegación confirmada: **Menú · Personal · Facturación · Configuración · Reportes** con selector de marca. Pantallas vistas en video: Descuentos (tabla minimal, restringido/abierto), Menu Maker (draft→publicar a canales). Los REPORTES actuales (~30 pantallas): demo comercial (pregunta 1 del guion).

### Soft Restaurant — el admin Windows

La imagen de arriba (`sr-admin.jpg`) es también su "dashboard": menús en cascada hasta "Catálogo de SAT - México", MONITOR VENTAS y CORTE CAJA X como botones F-key. Analytics 3.0 (SR12, 25+ reportes) sin captura pública — demo con distribuidor.

### Square — ❌ sin captura buena
Su Dashboard web (reportes, close-of-day) no tiene screenshots públicos decentes; benchmark secundario, baja prioridad.

---

## 4. La lectura transversal (lo accionable)

1. **POS**: todos convergieron en ticket+grid; la batalla es el dato del tile (stock/foto/color) y los taps al 86.
2. **KDS**: Toast juega solo en otra liga (cursos, not-paid, recall, estación). Parrot y SR ni lo enseñan — **nuestro KDS 1.3.x ya compite arriba del promedio del mercado MX** [INFERENCIA].
3. **Dashboard**: la tripleta de Toast Now (valor+delta+sparkline) es el estándar a igualar en móvil; ParrotConnect es limpio pero pobre en insight; SR es un ERP de 2010.
4. **Diseño**: Toast = sistema público (Buffet) con identidad≠interacción; Parrot = plano rojo/blanco funcional; SR = naranja Windows denso; Square = fotos + redondeado friendly. Nuestro ds-v2.x compite bien en modernidad; el gap es consistencia de tokens (ver TOAST-BIBLE §15.6).

## Mantenimiento

Nueva captura → `assets/` con prefijo del competidor → fila aquí + detalle en su biblia. Las capturas de demos comerciales (Parrot KDS/reportes, SR12/KDS) entran en cuanto existan.

# Debrief — Junta con Billy Newell (2026-09-01)

> Fuente: transcripción de la junta compartida por Daniel el 2026-09-01. Billy vio el demo
> de Fullsite en vivo (dashboard de AMALAY + montaje del tenant ChickIn) y dio feedback de
> operador experto (ex-franquiciatario Carl's Jr., opera restaurantes en Canadá, consultor
> de aperturas, contactos en CKE/asociación). Este doc separa **lo que ya existe** de **lo
> que NO existe hoy** — no confundir intención con capacidad.

## 0. Veredicto de Billy sobre el producto

- Comparó Fullsite contra su sistema actual (inglés, oficina en Tampa, ~US$70/terminal/mes,
  tipo Toast). Dijo: **"se me hace que está más completo el tuyo"**, "te felicito, está muy bien".
- Le impresionó la **velocidad de implementación**: montar el Excel de ChickIn (productos,
  precios, recetas, costeo, uniones ingrediente→gramo) tomó ~16–30 min en vivo. AMALAY (3 años
  de datos) tomó 2 días. La competencia tarda semanas/meses. → **Diferenciador de venta central.**
- Le gustaron las gráficas (ventas mensuales comparativa anual, ticket promedio día/semana/mes,
  top platillos, métodos de pago, nómina por persona con horas, conciliación fiscal, predicción
  de inventario con IA, días críticos de stock, cierre de inventario en celular, merma por área).

## 1. Requerimientos que salieron (clasificados)

### YA EXISTE hoy (validado en el demo)
- POS con productos + precios + categorías; dashboard con gráficas y reportes; nómina por persona;
  conciliación fiscal (reporte, no presentado al SAT); predicción de inventario + días críticos con IA;
  cierre de inventario desde celular; merma por área (cocina/barra/panadería) con motivo y cantidad;
  chat con agentes de IA; costeo/food cost por platillo (ver §3).

### NO EXISTE hoy — pedido explícito, con detalle de diseño
1. **Tacómetro de mano de obra en tiempo real (KILLER FEATURE internacional).**
   - Semáforo grande verde/amarillo/rojo del **% de mano de obra sobre venta**, en vivo.
     Verde ~14–15 %, rojo ~37 %.
   - Cálculo **por hora**: sueldo del empleado ÷ horas del perfil = valor/hora; al fichar entrada
     empieza a acumular; suma a todos los que están trabajando en ese momento vs la venta.
   - Solo cuenta personal de operación (meseros, cocina, gerentes de área, supervisores). NO
     corporativo/oficina, NO mantenimiento, NO chofer. (Es el mismo criterio con que se vende un
     restaurante: se saca el G&A para mostrar la utilidad operativa.)
   - **Por qué importa el enfoque:** en México se trabaja por jornada, no por hora → a full-service
     MX "les vale madre". Pero fast food internacional (KFC ~14 %, buscando 13 %; Carl's Jr) lo vive
     a diario y **nadie lo tiene**. Es lo que abre la puerta con CKE (ver §4).
   - El agente de IA detecta y manda el aviso ("checa esto").

2. **Captura de facturas → inventario (OCR + validación humana).**
   - Facturas de proveedor (Pacific Star, Sygno Alimentos, Cisco) llegan por correo → se suben y
     **actualizan inventario automáticamente**.
   - La factura trae: número de parte, cantidad comprada, cantidad por caja, **precio unitario**.
   - Dolor actual (RO humano): se captura a mano y hay que cuadrar el precio unitario contra el del
     sistema; si cambió, actualizar precio → mueve costos.
   - Flujo que quiere: subir factura (PDF/foto) → **IA extrae** → **pantalla de validación** (revisión
     humana) → confirmar → actualiza inventario. Si hubo error de captura, **corregir requiere código
     de gerente/dueño** (no cualquiera).
   - **UI: BOTÓN explícito "Subir factura" / "Editar factura" / "Eliminar factura"**, idealmente en la
     caja. Billy rechaza que sea solo por chat libre ("cada quien habla diferente y se hace un pedo";
     debe haber orden y manual). El chat puede ser atajo, pero el botón es el flujo canónico.
   - Categorías de factura: proteínas, limpieza, cartón, papel → cada ítem cae en su rubro.
   - También compras chicas de Oxxo (recibo) deben poder subirse.

3. **Módulo de Entrenamiento / Capacitación (add-on estratégico, cobrado por usuario).**
   - Cursos por platillo/producto nuevo, con examinación final e historial por empleado.
   - Al **dar de alta un empleado en el POS**, el POS lanza una **alerta/foco** de curso pendiente.
     El curso NO se toma en el POS: el empleado hace login en otra terminal/computadora de atrás.
   - **Bloqueo duro:** a las 72 h, "no puedes trabajar hoy si no tomas el curso" — no deja proceder
     ni agendarse al siguiente horario.
   - Acceso de empleado súper limitado: solo su turno + sus cursos.
   - Dashboard de dirección: sucursales en **rojo** que no terminaron entrenamientos → escala al
     regional → el regional presiona.
   - **Tesis de Billy:** "este negocio no es de sandwiches, es de recurso humano." El entrenamiento es
     el costo más caro y el cuello de botella del crecimiento (Tío Ben abrió 15 sucursales con fondo
     y "van a tronar" por no poder capacitar; Galería crecía 3–5/año por capacidad de entrenar).

4. **Rendimiento (yield) por ingrediente.** El pollo no rinde 10 pechugas/kg si lo cortan mal (salen
   ~8 = 80 %). Por pieza no importa; por peso sí (1 kg de pollo cocido → ½ kg; tacos de 50 g). El
   costeo debe castigar por rendimiento real, no teórico. (Coincide con el "yield factor" de Eduardo.)

5. **Modificadores con swap en el POS.** Al picar un platillo, break-down de sus ingredientes desde la
   receta; opciones: "no pan", "extra", swap ("queso amarillo → blanco → suizo"). Botones, no teclear.

6. **Fotos de producto en POS.** Irrelevante para comida; **crítico para retail** (4 camisas vaqueras
   → ¿cuál?). Relevante si expandimos a tiendas.

## 2. Estrategia de producto y enfoque

- **"Vete más por fast food. Perfecciona AMALAY y lo demás viene de calle."** Fast food no lleva
  alcohol → se lo agregamos (AMALAY ya lo tiene). Perfeccionando AMALAY (full-service + alcohol) +
  las features de fast food (tacómetro, facturas) cubres ambos extremos.
- **Multiplicador de unidades:** full-service es ~10 % de los restaurantes del mundo pero fast food
  tiene muchísimas unidades por marca (Carl's Jr ~450 unidades solo esa marca). Un cliente = decenas
  de terminales.
- **Todo-en-uno clonable:** juntar POS + inventario + RH + entrenamiento + proveedores + costeo en un
  solo sistema (antes eran add-ons separados de distintos proveedores). "Que se pueda replicar para
  absolutamente cualquier restaurante." Recetas = BOM genérico para saltar a otras industrias (retail).

## 3. Pricing / empaquetado (validado por Billy)

- **Modelo por niveles: paquete básico + add-ons, cobrado POR TERMINAL** (no por restaurante).
  Referencia: su sistema canadiense cobra ~US$70/terminal/mes; Carl's Jr con 3 terminales = 3×.
- **Básico (PSC):** POS + inventario + **mano de obra (tacómetro)**. (Analogía: antes inventario y RH
  eran add-ons; hoy son core.)
- **Add-ons cobrados aparte:** Entrenamiento (**por usuario**, ~$50/usuario), captura de facturas, etc.
- **Implementación = one-shot.** Se puede cobrar (US$ miles) o regalar como gancho. La velocidad de
  Fullsite (IA sube el Excel) la vuelve casi gratis para nosotros → argumento de cierre.
- No abaratar por miedo ("solo soy yo, con 10 quiero ganar" → nadie lo compra). El valor está; los
  agentes de IA "están durísimos". Consistente con [[project_pricing]] ($1,999 / $4,999).

## 4. Go-to-market internacional (vía Billy)

- Las marcas gringas (Carl's Jr USA) dictan a México qué POS usar, **pero ni ellos saben qué usar**
  → "propónganme". Hueco abierto.
- Billy tiene la red: Maritza Reynoso (asociación), Mike Goira (ex-presidente CKE), y Raúl (su papá /
  el tío de Daniel) los conoce. Se ofrece a abrir puertas.
- El gancho para que USA lo apruebe: **tacómetro de labor por hora + facturas automáticas** — "es lo
  que buscan y nadie tiene".

## 5. Billy como partner comercial

- Se ofrece a facilitar el lado comercial: está metido en consultoría de restaurantes, recomienda la
  herramienta, abre puertas. "Cada consultoría es un animal diferente" → cada cliente hace el sistema
  más robusto. Sin ask ni equity definidos aún (consistente con [[project_jc_tame_brand_partner]]).

## 5b. Sesión 2 (2026-09-01 tarde) — de DEMO a CLIENTE OPERATIVO como AMALAY

Cambio de objetivo (directiva textual de Daniel): **"Hay que meter todo el excel para poder empezar a
operar con ellos (como AMALAY)... que funcione OFFLINE igual que AMALAY, cargue recetas platillos etc."**
ChickIn deja de ser demo → cliente que va a OPERAR. Estrategia de Daniel: *"ya existe el esqueleto de
AMALAY, nada más ligo los datos de ChickIn ahí — está toda la arquitectura, nada más pongo tus datos."*
(Ver [[project_p1_golden_skeleton]] / [[project_skeleton_productization]].)

Requerimientos técnicos para "operar como AMALAY":
1. **Receta ↔ inventario ligados:** vender un platillo DESCUENTA sus insumos del stock; cuando un insumo
   se agota, el POS BLOQUEA el platillo. Historial de consumo por venta. (AMALAY: `pos_menu_item_recipes`
   mapea menu_item→recipe, 69 filas; el descuento cruza receta→ingredientes→`pos_inventory`.)
2. **Offline como AMALAY** (SW/LAN/local server ya existen a nivel app; validar en su hardware real).
3. **Costo de receta ligado a materia prima** → se actualiza solo cuando cambia el precio del insumo.
4. **Modificadores = ingredientes REALES de cada receta** (curados uno por uno): sin/extra SOLO de lo
   removible (pepinillos, salsa, lechuga, tomate, queso); NUNCA sin pan/pechuga/empanizador/paprika (batter).
   Deluxe lleva lechuga+tomate → esos sí son sin/extra. Los genéricos que puse estaban mal.
5. **Fast food NO lleva mesas/meseros** — quitar selección de mesa del POS de ChickIn.
6. **Fotos de producto** en el POS (por platillo).
7. **Usuarios reales:** sucursal ChickIn = gerente + auxiliares (no cajero fijo), 4–6 personas. Para el demo
   Billy autorizó meter a Billy + Daniel + Luisa con accesos, y **ventas chicas (3,8,12,14 uds)** para que
   se vean las gráficas (matiz vs "todo en cero" — CONFIRMAR con Daniel antes de re-meter ventas).

Migración Polo (contexto de campo):
- ChickIn corre **Polo** en terminales Windows táctiles BLOQUEADas (solo abre Polo; el back-office está
  candado por falta de pago). Quieren migrar a Fullsite en el MISMO hardware (desbloquear, instalar la
  extensión Chrome). Sí se le puede conectar teclado (confirmado por Raúl chico). Visita a la sucursal
  **Plaza Bonita, Av. Acapulco** con teclado para desbloquear; Billy coordina. ~40 sucursales.
- Migrar **historial de Polo** (ventas 2024–2025, por sucursal). Dashboard multi-sucursal (corporativo ve
  todo, sucursal ve la suya, por permisos).
- Fraude/merma detectado en el costeo: ~**12% de food cost sin contabilizar** (roban producto / merma no
  registrada; rinden 8 de 10 pechugas = 80%). Gancho: el sistema predice merma y la vigila. 80/20: 5
  productos = 80% del valor del inventario (proteína) → contarlos diario.

Leads nuevos de la sesión:
- **Grupo Cuauhtémoc**: comedores industriales + piden **plataforma de eventos** (empleados reservan eventos
  privados ligados al POS). Piden protocolo de ciberseguridad (Fullsite tiene ~5 certificados). Posible add-on.
- **Tequila Group** (K): restaurantes en EE.UU. sobre Toast; dando feedback del sistema.
- Clonabilidad: para escalar, el cliente sube su receta en **formato estándar** (producto, rendimiento, costo…)
  o el equipo de implementación se lo formatea. "Fullsite: dame la info, la organizo en el formato que el
  sistema lee." El AI que auto-detecta un Excel arbitrario se atora cuando hay data que no existe en el sistema.

## 6. Entregable inmediato (pedido para HOY)

Billy se va **mañana a CDMX** a ver sucursales; quiere **el demo del POS de ChickIn HOY** para
enseñarlo a la gerente de operaciones y a "Intelligence". Pidió: POS con productos + precios + recetas +
**modificadores (swap)** + agentes de IA. Le manda la liga para entrar.

**Estado del tenant `chickin-demo` (verificado 2026-09-01 por MCP):**
34 productos (34 con receta), 6 categorías, 34 recetas, 163 insumos, chat IA OK, food cost OK.
**Hueco:** `pos_modifiers = 0` → el momento "no pan / extra / swap de queso" NO funciona sin cargar
modificadores. Es el único gap para el demo del POS de mañana. Ver [[project_chickin_demo]].

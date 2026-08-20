# Requisitos de Eduardo (sesión de campo AMALAY) — fuente de verdad para la auditoría

> Extraído de la sesión grabada con Eduardo Esquivel (operador ex-Wansoft, dominio experto).
> Cada requisito tiene un ID para que la auditoría lo referencie (KDS-01, POS-03, …).
> Referencia visual: KDS de Wansoft ("Órdenes cerradas en PDV y terminadas en KDS") — tarjeta por
> orden con nº orden, mesa/para-llevar, [CERRADA], mesero, terminal, cliente, personas, hora de
> entrada, tiempo transcurrido, e items con modificadores en cascada por renglón + cantidad + estación (S1).

---

## KDS — pantalla de cocina

| ID | Requisito | Nota de Eduardo |
|---|---|---|
| **KDS-01** | Cada tarjeta muestra: **nº de orden** (secuencial del día, ej. "orden 50"), **nº de mesa/cuenta**, **mesero**, **personas**, **hora de entrada** de la comanda, y **tiempo transcurrido** | "que salga el nº de orden, personas, etc. El tiempo es importante" |
| **KDS-02** | Item + **modificadores en cascada** (por renglón), **muy legible/textual** (nombre y modificador grandes) | "tiene que ser muy legible el nombre del platillo y el modificador; si viene mal, salen mal los platillos" |
| **KDS-03** | Config de **tamaño de letra** (agrandar platillo y modificador) — "hay chefs medio ciegos" | ajustable en settings |
| **KDS-04** | Interacción: **1 clic sobre el platillo = preparando**; **2 clics = listo y desaparece**; **2 clics sobre el título de la comanda = toda la comanda lista/desaparece** | por-item, no todo junto |
| **KDS-05** | **Por tiempos/cursos**: no matar todo junto; marcar item por item (desayuno raro tiene tiempos; cena sí) | "los de las cenas te van a decir: necesito manejar tiempos" |
| **KDS-06** | El platillo se **baja del inventario solo cuando se PAGA/cierra la cuenta**, NO al marcar listo en KDS | "cuando se mata la cuenta se baja del inventario" |
| **KDS-07** | **Alerta por tiempo**: a los N min (configurable, ej. 10–15) el platillo parpadea / fondo rojo / letras rojas | "configuras cuánto tiempo quieres que empiecen a parpadear" |
| **KDS-08** | El tiempo se **actualiza** (hoy cada 15 s; aceptable, podría ser tiempo real) | "se sincroniza cada N; este es cada 15 s" |
| **KDS-09** | **Filtro por estación** configurable: por defecto **expo (ve todo)**; cada estación ve **solo lo que produce** (fría = ensaladas/sándwiches fríos; caliente = caliente) | "todas con modalidad expo, pero que puedan discriminar por estación" |
| **KDS-10** | **Resumen/lista de platillos pendientes** dentro del KDS (cuántos de cada platillo faltan; conforme matas comandas bajan) — **compacto** (hoy tiene mucho espacio de sobra) | "1 ceviche de atún, ¿cuántos faltan?" |
| **KDS-11** | **Sin opción de cancelar** en el KDS — "solamente es para producir" | seguridad |
| **KDS-12** | Cuando un item se marca listo, **desaparece** (no solo cambia); al terminar todos, la comanda desaparece | |
| **KDS-13** | KDS **no integra impresoras** — es una pantalla sobre Pedro; funciona offline (LAN) | |
| **KDS-14** | **KDS solo en cocina** (caliente/expo); panadería y barra = impresora térmica (salvo cafetería que quiera pantallas) | "pantallas grandes y funcionales; barra va impreso" |
| **KDS-15** | Settings (engrane): filtro de estación + tiempo de alerta + tamaño de letra | |

## POS — punto de venta

| ID | Requisito | Nota |
|---|---|---|
| **POS-01** | **Funcional Y amigable** — es lo que MÁS usan los restauranteros | prioridad #1 |
| **POS-02** | **Modo comandero** (mesero: tras cada transacción regresa al mapa de mesas o se bloquea) y **modo caja** (solo cobra, no mete comandas; se bloquea al cerrar cuenta) | evita mal uso |
| **POS-03** | **Modalidad "cabeza" quitable**: la terminal debe poder abrir **directo al POS/comandero/caja**, no al navegador/dashboard, para que operadores no anden por todo | "que no te mande a la página del Dashboard; hablo directo al punto de venta" |
| **POS-04** | Si un platillo **no tiene modificador**, no abrir la pantalla de modificadores | |
| **POS-05** | En la pantalla de modificadores poder **sumar/restar cantidad** (ej. "2 cervezas") sin volver a picar | |
| **POS-06** | **Verificar** (pantalla): útil para modificadores largos / órdenes grandes; dudoso en rush | el mesero lo vio "muy" |
| **POS-07** | **Tipos de tarjeta** separados (crédito/débito/AmEx) **configurable** — la comisión cambia por tipo; unos lo necesitan (conciliación por ticket), otros no (AMALAY no) | |
| **POS-08** | **Pago mixto** (varias formas), **propina** (con/sin), **confirmar nº de personas** antes de cobrar | |
| **POS-09** | POS **no maneja inventario** (eso es dashboard) | |
| **POS-10** | Config **muy textual** (sin abreviaciones): el KDS muestra EXACTO lo configurado en POS → configurar mal = comandas mal leídas | "todo se tiene que ver acá tal cual" |
| **POS-11** | POS **rápido** — corre en UN sistema (ventaja vs Wansoft, donde KDS es aparte) | |
| **POS-12** | Login por **huella** del mesero → aplica sus permisos (ver PERM-*) | |

## PERMISOS — matriz por rol (dictada por Eduardo)

Roles: **administración · gerente · capitán · cajero · mesero**

| ID | Acción | Quién puede |
|---|---|---|
| PERM-01 | Abrir mesas | todos |
| PERM-02 | Abrir para llevar | todos **menos mesero** |
| PERM-03 | Abrir domicilio | capitán, cajero (**mesero no**) |
| PERM-04 | Abrir para recoger | cajero **sí**; capitán, mesero **no** |
| PERM-05 | Abrir restaurante (cuentas de mesa) | **cajero NO** (no abre cuentas) |
| PERM-06 | Cerrar cuentas / cobrar | **SOLO cajero** |
| PERM-07 | **Cancelar órdenes** | **SOLO administración** (el permiso más crítico) |
| PERM-08 | Cambio de mesas | capitán, gerente, administración |
| PERM-09 | Cambio de mesero | capitán, gerente, administración (mesero/cajero no) |
| PERM-10 | Juntar mesas | capitán, gerente, administración |
| PERM-11 | Ver todas las cuentas | cajero (debe pagarlas), capitán, gerente, administración |
| PERM-12 | Ver solo mis cuentas | mesero (solo las suyas) |
| PERM-13 | Descuentos (mesero/cajero) | **ninguno** (fuente de fraude) |
| PERM-14 | Descuentos de dinero en orden | capitán **no** |
| PERM-15 | Platillos gratis | solo gerente y administración (capitán no) |
| PERM-16 | Reportes | mesero **no**, cajero **no** |
| PERM-17 | Ventas por mesero | administración, gerente, capitán |
| PERM-18 | Ventas globales / reportes | administración, gerente, capitán |
| PERM-19 | Abrir día | todos **menos mesero** |
| PERM-20 | Configurar terminal / impresora | **solo administrador** |
| PERM-21 | Reimprimir ticket | **no** mesero, **no** cajero |
| PERM-22 | Registro de comanda | todos |

## DASHBOARD / INVENTARIO

| ID | Requisito | Nota |
|---|---|---|
| DASH-01 | **Entrada manual de inventario** (no atada a proveedor; solo las facturas atan proveedor vía RFC) | |
| DASH-02 | Carga por **XML/Excel drag-and-drop** (arrastrar el archivo, no abrir el buscador de la compu) | |
| DASH-03 | **Agente IA que lee la factura/archivo** y da entrada solito (no manual) | |
| DASH-04 | **Punto de reorden por analítica** (no solo max/min manual): proyección de crecimiento + estacionalidad. Ej: 100kg tomate → +5% proyección → 105 → +5% colchón → 110 → /4 semanas = 27.5kg/sem | preferido por Eduardo |
| DASH-05 | Max/min no sirven hasta llegar a **capacidad instalada** → por eso la proyección IA es clave para negocios nuevos/en crecimiento | |
| DASH-06 | **Transferencias inter-sucursal** (mismo grupo): almacén→almacén vía transferencia/OC/factura (AMALAY será proveedor de otro) | como Wansoft intersucursal |
| DASH-07 | **Un agente IA por sección/módulo** (agente especializado del módulo analiza todo lo que entra) | idea nueva |
| DASH-08 | Dashboard lo usan **pocos** (sobre todo cargar platillos) — POS es más importante | |
| DASH-09 | Doc de **reglas de configuración** (sin puntuación, MAYÚSCULAS, sin acentos) para que búsqueda/filtro/carga-Excel funcionen | |

## OFFLINE / INFRAESTRUCTURA / INTEGRACIONES

| ID | Requisito | Nota |
|---|---|---|
| OFF-01 | **Sincronización del ecosistema**: TODOS los POS de la red ligados a TODAS las impresoras + KDS. Al agregar terminal/impresora, sincroniza a todos | Eduardo vio que un POS de AMALAY solo tenía ~3 impresoras ligadas |
| OFF-02 | KDS recibe comandas por **LAN aunque no haya internet** (offline probado) | |
| OFF-03 | **Cold-boot / modo app** dedicado que abra directo al POS (no navegador) | ver POS-03 |
| OFF-04 | **Uber/Rappi**: comentarios/modificadores de la app de delivery fluyen a POS → impresora → KDS **exacto** (un comentario "carita feliz" debe imprimir) | |

## GO-TO-MARKET / ESTRATEGIA (Eduardo)

| ID | Idea |
|---|---|
| GTM-01 | **Cero costo de cambio**: usa el hardware que ya tienen (pantallas/impresoras), sin cabezas, menos impresoras → "con lo que ya tienes puedes superar" |
| GTM-02 | Value prop: POS amigable + **el agente IA que te da la info al día** (el valor agregado principal) |
| GTM-03 | Debilidad Wansoft: **soporte pésimo** + Clip enfocado en pagos, no en el POS → empezarán a perder clientes en 4–5 años = la oportunidad |
| GTM-04 | Wansoft **no puede meter agentes IA** (demasiado rígido, tendría que rehacer desde cero); Fullsite tiene la IA **al centro**, el sistema alrededor = ventaja estructural |
| GTM-05 | **Parrot**: inventario 70% en 10 años, nunca terminado. Si Fullsite clava inventario, lo rebasa |
| GTM-06 | Target inicial: locales chicos (1–2 sucursales); el juego es **volumen** |
| GTM-07 | Marketing: ads pautados, webinars, contenido de tips de POS, benchmark, posicionamiento de marca (Daniel es malo en marketing → necesita gente) |
| GTM-08 | Implementación: Once Soft instala con su propio hardware (ventaja). Fullsite puede ofrecer setup de red/hardware o que el user lo ponga |
| GTM-09 | **La configuración lo es todo** — detrás de una buena config tiene que estar alguien que sepa cómo funciona todo |
| GTM-10 | Fases: clavar POS → luego inventario → luego dashboard. Meter AMALAY 100% (quitar Wansoft), perfeccionar, y de ahí escalar |

## NOTAS DE CONTRATACIÓN

- Eduardo Esquivel = el hire correcto (operador, conoce Wansoft a fondo, construyó los agentes IA, 2 meses, arma el POS). Pide **equity + escalar juntos** (Daniel solo puede ofrecer equity, no sueldo). Ver [[project_eduardo_esquivel_amalay]] / [[project_eduardo_valuation]].
- Eduardo de la Garza (Lalo, ex-Wansoft época dorada) descartado: pedía sueldo muy alto.

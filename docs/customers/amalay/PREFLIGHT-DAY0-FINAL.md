# PRE-FLIGHT CHECKLIST — Day 0 AMALAY
## Migración crítica. No se abre hasta que TODO esté en verde.

---

## A. DATOS MAESTROS

### Menú y precios
| # | Verificación | Método | Status |
|---|---|---|---|
| A1 | 522 platillos activos en Fullsite | Supabase count = 522 | [ ] |
| A2 | Precios iguales al menú físico | Verificar 10 platillos clave vs menú impreso | [ ] |
| A3 | IVA_RATE = 0 (precios ya incluyen IVA) | Verificado en código jul 4 | [ ] |
| A4 | Platillos inactivos no aparecen en POS | Abrir POS, buscar platillo inactivo | [ ] |
| A5 | Categorías correctas y en orden | Navegar categorías en POS vs menú físico | [ ] |

**Verificar estos 10 precios contra el menú físico:**
| Platillo | Fullsite | Menú físico | OK? |
|---|---|---|---|
| Chilaquiles | $195 | | [ ] |
| Americano | $48 | | [ ] |
| Avocado Toast | $240 | | [ ] |
| Enchiladas Suizas | $255 | | [ ] |
| Cappuccino | $85 | | [ ] |
| Coca Cola | $60 | | [ ] |
| Salmon Bagel | $360 | | [ ] |
| Half Half Combo | | | [ ] |
| Machacado con Huevo | $240 | | [ ] |
| Latte Frío | | | [ ] |

### Modificadores
| # | Verificación | Método | Status |
|---|---|---|---|
| A6 | Modificadores cargados (114 en Wansoft) | Abrir un platillo con mods (smoothie, café) y verificar opciones | [ ] |
| A7 | Asignaciones correctas (87 platillos con mods) | Verificar 3 platillos: smoothie (proteína/leche), café (leche/tamaño), chilaquiles (extras) | [ ] |
| A8 | Precios de modificadores correctos | Verificar que "Extra Salmón $140" cobra correcto | [ ] |

### Staff y permisos
| # | Verificación | Método | Status |
|---|---|---|---|
| A9 | 40 empleados en pos_staff | Supabase count = 40 | [ ] |
| A10 | PINs funcionan (probar 3) | Login con: Daniel 1234, Eduardo 4567, un mesero cualquiera | [ ] |
| A11 | Roles correctos | Verificar: mesero no ve corte, cajero no abre mesas vacías, gerente puede cancelar | [ ] |
| A12 | Staff que ya no trabaja NO está en el sistema | Preguntar al gerente: "¿alguien nuevo o alguien que se fue?" | [ ] |

### Métodos de pago
| # | Verificación | Método | Status |
|---|---|---|---|
| A13 | 18 métodos de pago activos | Supabase count = 18 | [ ] |
| A14 | Todos aparecen en pantalla de cobro | Abrir cobro de prueba, verificar lista | [ ] |
| A15 | Verificar con gerente: "¿falta alguna forma de pago?" | Pregunta directa | [ ] |

### Mesas
| # | Verificación | Método | Status |
|---|---|---|---|
| A16 | Mapa de mesas carga correctamente | Abrir /pos/mesas, contar mesas | [ ] |
| A17 | Números de mesa coinciden con el plano físico | Comparar pantalla vs restaurante | [ ] |

### Facturación
| # | Verificación | Método | Status |
|---|---|---|---|
| A18 | 6 clientes FE en pos_billing_clients | Supabase count = 6 | [ ] |
| A19 | Facturama pagado | ¿Se pagó? Sí/No | [ ] |
| A20 | Si Facturama NO está pagado: informar al staff que facturación es manual hoy | Comunicar | [ ] |

---

## B. INVENTARIO — RECOMENDACIÓN

### ¿Importar de Wansoft, conteo físico, o combinación?

**RECOMENDACIÓN: NO importar inventario para Day 0.**

Razones:
1. El POS opera perfecto sin inventario — ventas, cobros, comandas, tickets, corte, todo funciona
2. El inventario de Wansoft tiene problemas conocidos: stock=null en muchos productos, 439 recetas de 1 ingrediente, 81 ingredientes fantasma
3. Importar inventario malo es peor que no tener inventario — genera alertas falsas y deducciones incorrectas
4. Agregar inventario el Day 0 duplica los puntos de falla
5. El inventario correcto requiere conteo físico, no export de sistema

### Plan de inventario (post Day 0):

| Paso | Cuándo | Qué |
|---|---|---|
| 1 | Semana 1 (después de Day 0) | Conteo físico de los 50 insumos más importantes (Pareto) |
| 2 | Semana 1 | Cargar esos 50 a Fullsite con existencias reales |
| 3 | Semana 2 | Extender a 200 insumos |
| 4 | Mes 1 | Inventario completo con deducciones automáticas |

### Los 50 insumos a contar primero (los de mayor valor hoy):
1. Jamón de pierna ($10,751)
2. Rib Eye ($9,555)
3. Café en grano bolsa 500g ($8,500)
4. Nieve vainilla ($5,200)
5. Prosciutto ($4,898)
6. Queso crema ($4,460)
7. LMNT Electrolyte ($4,073)
8. Café molido 500g ($3,955)
9. Matcha ceremonial ($3,872)
10. Café descafeinado ($3,645)
(+ 40 más por valor)

**El archivo de existencias frescas (745 productos, $217K) ya está guardado como referencia para cuando se haga el conteo.**

---

## C. POS — QUÉ EMPIEZA LIMPIO, QUÉ SE CONSERVA

### Empieza en CEROS (ya limpio):
| Tabla | Registros | Status |
|---|---|---|
| pos_orders | 0 | [ ] Verificado |
| pos_turnos | 0 | [ ] Verificado |
| pos_cierres | 0 | [ ] Verificado |
| pos_audit_log | 0 | [ ] Verificado |
| pos_cash_movements | 0 | [ ] Verificado |

### Se CONSERVA (datos maestros):
| Tabla | Registros | Status |
|---|---|---|
| pos_menu_items | 522 activos | [ ] Verificado |
| pos_menu_categories | 60 | [ ] Verificado |
| pos_staff | 40 | [ ] Verificado |
| pos_payment_methods | 18 | [ ] Verificado |
| pos_billing_clients | 6 | [ ] Verificado |
| pos_modifier_groups | existentes | [ ] Verificado |
| pos_modifiers | existentes | [ ] Verificado |

---

## D. OPERACIÓN — VERIFICACIONES POR ROL

### Gerente (antes de abrir)
- [ ] D1 | ¿Staff del turno sabe que hoy se usa Fullsite?
- [ ] D2 | ¿Cada persona del staff sabe su PIN?
- [ ] D3 | ¿Wansoft sigue disponible como respaldo?
- [ ] D4 | ¿Hay fondo de caja listo para abrir turno?
- [ ] D5 | ¿El gerente sabe cómo abrir turno en Fullsite? (/pos/turno)
- [ ] D6 | ¿El gerente sabe cómo hacer Corte X?
- [ ] D7 | ¿El gerente tiene PIN de gerente para cancelaciones/descuentos?

### Caja
- [ ] D8 | ¿Cajero sabe cobrar efectivo, tarjeta, mixto?
- [ ] D9 | ¿Cajero sabe reimprimir ticket?
- [ ] D10 | ¿Cajón de dinero abre con efectivo y NO abre con tarjeta?
- [ ] D11 | ¿Cajero sabe qué hacer si el sistema no responde? (F5, esperar, Wansoft)
- [ ] D12 | ¿Ticket imprime correctamente? (nombre restaurante, items, total, IVA)

### Cocina
- [ ] D13 | ¿Chef entiende la pantalla KDS?
- [ ] D14 | ¿Chef sabe: 1 click = preparando (amarillo), 2 clicks = listo (desaparece)?
- [ ] D15 | ¿Comandas imprimen en la estación correcta? (cocina fría, cocina caliente, barra)
- [ ] D16 | ¿Chef sabe qué hacer si KDS no muestra orden? (F5 para refrescar)

### Meseros
- [ ] D17 | ¿Meseros saben entrar con PIN?
- [ ] D18 | ¿Meseros saben abrir mesa, agregar items, enviar a cocina?
- [ ] D19 | ¿Meseros saben agregar modificadores?
- [ ] D20 | ¿Meseros saben cambiar cantidad?
- [ ] D21 | ¿Meseros saben que después de enviar, regresan a mesas? (Modo Comandero)

### Dueño (tú / tus papás)
- [ ] D22 | ¿Saben acceder al dashboard? (app.fullsite.mx)
- [ ] D23 | ¿Saben que hoy los datos del dashboard son solo de Fullsite, no de Wansoft?
- [ ] D24 | ¿Saben que el corte de hoy debe cuadrar con el conteo físico de caja?
- [ ] D25 | ¿Tienen el WAR-ROOM impreso?
- [ ] D26 | ¿Tienen la libreta para anotar observaciones?

---

## E. INFRAESTRUCTURA

### Terminales
| # | Verificación | Status |
|---|---|---|
| E1 | Terminal CAJA: Chrome abierto en app.fullsite.mx/pos (kiosk mode) | [ ] |
| E2 | Terminal ENTRADA: Chrome abierto en app.fullsite.mx/pos (kiosk mode) | [ ] |
| E3 | KDS COCINA: Chrome en app.fullsite.mx/pos/cocina (fullscreen) | [ ] |
| E4 | Todas las terminales con carga / conectadas a corriente | [ ] |

### Bridge
| # | Verificación | Status |
|---|---|---|
| E5 | Bridge CAJA corriendo (127.0.0.1:7717/health → ok:true) | [ ] |
| E6 | Bridge ENTRADA corriendo (127.0.0.1:7717/health → ok:true) | [ ] |
| E7 | CMD del bridge VISIBLE (no minimizado, no cerrado) | [ ] |

### Impresoras
| # | Verificación | Status |
|---|---|---|
| E8 | COCINA FRÍA (192.168.1.21) — test print | [ ] |
| E9 | COCINA CALIENTE (192.168.1.40) — test print | [ ] |
| E10 | BARRA (192.168.1.30) — test print | [ ] |
| E11 | PANADERÍA (USB/TCP 192.168.1.250) — test print | [ ] |
| E12 | TICKET CAJA (USB EC01) — test print | [ ] |
| E13 | TICKET ENTRADA (USB TICKET) — test print | [ ] |
| E14 | Todas con papel suficiente para el turno | [ ] |

### Red
| # | Verificación | Status |
|---|---|---|
| E15 | Internet estable (speed test > 5 Mbps) | [ ] |
| E16 | WiFi funcionando en todas las terminales | [ ] |
| E17 | UPS/No-Break encendidos | [ ] |

### Cajón de dinero
| # | Verificación | Status |
|---|---|---|
| E18 | Cajón conectado (cable RJ-11 a impresora de ticket) | [ ] |
| E19 | Cajón abre con comando de prueba | [ ] |
| E20 | Llave del cajón disponible (respaldo manual) | [ ] |

---

## F. CONTABILIDAD — QUÉ DEBE CUADRAR

| # | Verificación | Método | Status |
|---|---|---|---|
| F1 | Total de ventas Fullsite = total de tickets impresos | Contar tickets vs reporte | [ ] |
| F2 | Desglose por forma de pago correcto | Efectivo + tarjeta + otros = total | [ ] |
| F3 | Efectivo en caja = reportado por Fullsite + fondo inicial | Conteo físico vs sistema | [ ] |
| F4 | Diferencia de caja < $100 | Aceptable para Day 0 | [ ] |
| F5 | Si Wansoft también operó hoy: sumar ambos | Documentar qué fue Wansoft y qué Fullsite | [ ] |
| F6 | Cancelaciones registradas con motivo y PIN | Audit log | [ ] |
| F7 | Descuentos registrados con motivo y PIN | Audit log | [ ] |

---

## G. RIESGOS — PRIMERAS 24 HORAS

| # | Qué puede pasar | Probabilidad | Impacto | Qué hacer |
|---|---|---|---|---|
| G1 | Bridge se cae | Media | Alto — no imprime | CMD → cd C:\fullsite → node bridge.js (30 seg) |
| G2 | Impresora no responde | Media | Alto — cocina no recibe | Verificar papel, encendida, red. Restart bridge si TCP |
| G3 | Internet cae | Baja | Medio — funciona offline | Seguir operando. NO usar 2 terminales misma mesa |
| G4 | Mesero no encuentra platillo | Alta | Bajo | Usar búsqueda. Si no existe, documentar y agregar |
| G5 | Precio diferente al menú | Media | Alto — confianza | Verificar IVA=0. Si precio real es diferente, corregir en Supabase |
| G6 | Cajón no abre | Baja | Bajo | Abrir con llave. Verificar cable RJ-11 |
| G7 | KDS no recibe orden | Baja | Alto | F5 en pantalla cocina. Verificar internet |
| G8 | Dos terminales misma mesa | Baja | Alto | El fix B2 detecta y carga la orden existente |
| G9 | Staff pide regresar a Wansoft | Media | Alto — confianza | Escuchar, evaluar, no forzar. Si es sistemático, regresar esa mesa |
| G10 | Corte no cuadra | Media | Alto — confianza | Verificar forma de pago por forma de pago. La diferencia debe ser < $100 |

---

## H. SEÑALES DE ROLLBACK A WANSOFT

| Señal | Acción |
|---|---|
| Bridge no responde después de 2 reintentos | Esa terminal va a Wansoft |
| Impresora de cocina no imprime > 2 min | Esa estación va manual o Wansoft |
| 3+ incidentes en 30 minutos | Evaluar rollback total |
| Staff pide regresar unanimemente | Regresar. No forzar |
| Corte no cuadra > $500 | Investigar antes de abrir día siguiente |
| Gerente dice NO-GO | Se respeta. Wansoft no está desinstalado |

**Wansoft NO se desinstala. Está ahí como respaldo. Siempre.**

---

## I. GO / NO-GO — Checklist final

**NO se abre el restaurante con Fullsite hasta que TODOS estén en verde:**

### Infraestructura
- [ ] Bridge health OK ambas terminales
- [ ] 6 impresoras responden
- [ ] Internet estable
- [ ] KDS cocina encendido y recibiendo

### Datos
- [ ] 522 platillos activos
- [ ] 10 precios verificados contra menú físico
- [ ] 40 staff con PINs
- [ ] 18 métodos de pago
- [ ] POS en ceros (0 órdenes, 0 turnos)

### Operación
- [ ] Staff sabe usar Fullsite (PIN, mesa, cobro)
- [ ] Chef entiende KDS (1 click / 2 clicks)
- [ ] Cajero sabe cobrar efectivo/tarjeta/mixto
- [ ] Gerente sabe abrir/cerrar turno
- [ ] Wansoft disponible como respaldo

### Smoke test
- [ ] Abrir mesa de prueba
- [ ] Agregar 1 cocina + 1 barra + 1 modificador
- [ ] Enviar a cocina → comanda imprime + KDS recibe
- [ ] Cobrar efectivo → cajón abre + ticket imprime
- [ ] Cancelar orden de prueba → limpiar

### Humano
- [ ] WAR-ROOM impreso y en mano
- [ ] Libreta física lista
- [ ] Teléfono cargado (video + fotos)
- [ ] Eduardo confirmado (o Daniel solo)
- [ ] Fondo de caja listo

**Si TODOS los checks están en verde → GO**
**Si CUALQUIER check de infraestructura falla → resolver antes de abrir**
**Si CUALQUIER check de datos falla → corregir antes de abrir**
**Si gerente dice NO-GO → se respeta**

---

> Este documento se imprime y se lleva al restaurante.
> Cada check se marca con pluma en el papel.
> No se abre hasta que todo esté en verde.

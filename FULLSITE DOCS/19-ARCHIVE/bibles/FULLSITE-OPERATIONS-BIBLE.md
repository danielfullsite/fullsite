# Fullsite Operations Bible

> Fuente de verdad operativa de Fullsite.
> Última actualización: 2026-07-23
> Mantenido por: Daniel Ramonfaur / Fullsite

---

## 1. Propósito

Este documento es la biblia operativa de Fullsite. Está escrito para supervisores y gerentes que van a operar un restaurante usando el sistema, y para cualquier persona del equipo que necesite entender cómo funciona la operación de principio a fin.

**No es un manual técnico.** Los detalles de código están en los playbooks de desarrollo y en el MANUAL-OPERATIVO.md. Este documento describe cómo opera el sistema desde la perspectiva del restaurante.

**No reemplaza la capacitación.** Leer este documento no sustituye hacer el smoke test, la capacitación práctica con el staff, y el Shadow Day. Es el complemento escrito de esa experiencia.

**Sí es la fuente de verdad operativa.** Si hay conflicto entre este documento y otro sobre cómo debe funcionar algo operativamente, este gana. Si hay conflicto entre este documento y el código, el código gana y hay que actualizar este documento.

**Público:**
- Gerentes nuevos de AMALAY u otros restaurantes que adopten Fullsite
- Supervisores que cubran turnos sin el gerente principal
- Eduardo y otros implementadores que necesiten capacitar al staff
- Daniel como referencia operativa al tomar decisiones de producto

---

## 2. Filosofía

### 2.1 El restaurante olvida que Fullsite existe

El principio central de diseño de Fullsite es que el sistema debe ser tan confiable que el staff no tenga que pensar en él. Como la electricidad: funciona. Cuando falla, lo sabes. Cuando funciona, operas.

Lo contrario de este principio es un sistema que genera fricción: que requiere que alguien esté pendiente de que no falle, que interrumpe el servicio, o que el staff tiene que compensar sus limitaciones con workarounds manuales.

Toda decisión de producto parte de esta pregunta: ¿esto hace que el restaurante olvide que Fullsite existe, o lo recuerda?

### 2.2 Confiabilidad antes que funcionalidad

Fullsite prefiere hacer menos cosas y hacerlas bien, que hacer muchas cosas y que alguna falle cuando importa. Un POS que falla un viernes a las 8pm le cuesta al restaurante más que un POS sin alguna función avanzada.

Por eso el código core (guardar orden, sincronizar offline, imprimir, cobrar) está congelado: no se toca sin evidencia de un problema real.

#### Rationale: Por qué MTBS (Mean Time Between Surprises) como métrica de confiabilidad

**Problema:** Las métricas tradicionales de confiabilidad (uptime, SLA 99.9%) no capturan lo que le importa a un restaurante. Un sistema puede tener 99.9% de uptime y aun así sorprender al cajero 3 veces por turno con un modal de error, un ticket que no imprimió, o un cambio de precio que no se propagó. [INFERENCIA — basado en experiencia de operación en AMALAY]

**Alternativa descartada:** Medir uptime clásico o tiempo de respuesta de API como proxy de confiabilidad.

**Por qué no:** El restaurante no sabe qué es un API. Lo que sabe es si hubo algo inesperado durante el servicio que lo hizo dudar del sistema. Cada vez que el staff tiene que hacer algo fuera del flujo normal (reiniciar el bridge, recargar la página, pedir ayuda) es una "sorpresa". Eso es lo que hay que minimizar. [INFERENCIA]

**Cuándo replantear:** Cuando Fullsite tenga suficientes restaurantes activos para medir el MTBS estadísticamente. Con un solo restaurante, la muestra es demasiado pequeña para distinguir tendencias de ruido. [PENDIENTE]

### 2.3 Todo queda registrado

A diferencia de sistemas como Wansoft (donde los logs se pueden desactivar y las acciones se pueden borrar), en Fullsite cada cancelación, descuento, modificación, apertura de cajón, y cambio de mesa queda en un log inmutable. Nadie puede borrar ese registro. Nadie puede hacer una acción "sin que quede huella".

Esto no es un mecanismo de vigilancia. Es la base de confianza del restaurante: el dueño puede saber exactamente qué pasó, cuándo, y quién lo hizo.

### 2.4 Offline primero

El restaurante no puede permitirse depender del internet para operar. Si se cae el WiFi, el POS sigue tomando órdenes. Las impresoras siguen recibiendo comandas porque están en red local, no en internet. Al reconectarse, todo se sincroniza automáticamente.

### 2.5 Cutover es adopción, no instalación

El objetivo de implementar Fullsite en un restaurante no es que el sistema técnicamente funcione. El objetivo es que después de 2 semanas nadie quiera regresar al sistema anterior. Esa distinción cambia todo sobre cómo se implementa, cómo se capacita, y cómo se mide el éxito.

---

## 3. Arquitectura

### 3.1 Componentes del sistema

```
┌──────────────────────────────────────────────────────┐
│                    BROWSER (PWA)                      │
│                                                       │
│   /pos         → POS principal (órdenes, cobro)      │
│   /pos/kds     → Cocina (KDS)                        │
│   /pos/turno   → Abrir/cerrar turno                  │
│   /pos/corte   → Corte de caja, reportes             │
│   /pos/factura → CFDI 4.0 (Facturama)                │
│   /pos/delivery→ Monitor delivery                    │
│   /pos/auditoria→ Log inmutable                      │
│   /pos/monitor → Bridge health, cola de impresión    │
│   /pos/inventario → Stock, movimientos               │
│   /ventas, /meseros, /platillos, /recetas, ... → Dashboard (17 páginas)
└──────────────────────┬───────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
   ┌──────▼──────┐         ┌────────▼────────┐
   │  SUPABASE   │         │    BRIDGE       │
   │  (cloud)    │         │  (localhost:7717)│
   │             │         │                 │
   │ pos_orders  │         │ Cocina TCP      │
   │ pos_turnos  │         │ 192.168.1.21    │
   │ pos_cierres │         │ 192.168.1.40    │
   │ pos_staff   │         │                 │
   │ pos_audit   │         │ Barra TCP       │
   │ pos_menu    │         │ 192.168.1.30    │
   │ pos_cash    │         │                 │
   │ events      │         │ Tickets USB     │
   │ ops_daily   │         │ "EC TICKET"     │
   └─────────────┘         │                 │
                           │ Caja USB        │
   ┌─────────────┐         │ "PANADERIA"     │
   │  AGENTES IA │         └─────────────────┘
   │  GitHub     │
   │  Actions    │
   │  13 agentes │
   └─────────────┘
```

### 3.2 El bridge

El bridge es el componente más crítico de hardware. Es un servidor Node.js que corre en la computadora principal del restaurante (`C:\fullsite\bridge.js`) y escucha en el puerto 7717.

Su función: recibir instrucciones de impresión desde el browser y enviarlas a cada impresora usando el protocolo correcto (ESC/POS via TCP para impresoras de red, o via el sistema de impresión de Windows para USB).

Sin el bridge, el POS puede tomar órdenes y guardarlas, pero no puede imprimir. Las comandas no llegan a cocina.

El bridge tiene un sistema de autoarranque en la carpeta Startup de Windows. Si la computadora se reinicia, el bridge debería arrancar solo. Si alguien cierra la ventana de terminal del bridge, hay que reiniciarlo manualmente.

#### Rationale: Por qué el print bridge corre en local (127.0.0.1:7717) y no en la nube

**Problema:** La impresión térmica requiere acceso a puertos serie o USB, o a conexiones TCP directas a la IP de la impresora en la red local. Los navegadores no tienen acceso a estos recursos por razones de seguridad (CORS, sandbox). [HECHO — implementado en electron-app/bridge.js]

**Alternativa descartada:** Impresión cloud via API externa. El browser envía el payload a un servidor en internet, que a su vez lo reenvía a la impresora.

**Por qué no:** Ese flujo agrega latencia de red y crea dependencia de internet en el momento más crítico de la operación: cuando el mesero toca "Enviar a cocina". Si el internet cae a media comanda, la cocina no recibe nada. El bridge local elimina esa dependencia porque las impresoras están en la misma red LAN. [INFERENCIA — basado en diseño de sección 2.4 Offline primero]

**Tradeoff real:** El bridge requiere Electron (o un ejecutable equivalente) y un proceso local corriendo permanentemente. Agrega un componente que puede fallar (ver caso borde 9.1) y que el staff debe saber reiniciar. [HECHO — bridge.js en C:\fullsite\]

**Cuándo replantear:** Si los navegadores exponen APIs de impresión térmica directa (como el estándar Web Serial API maduro o Web USB con soporte ESC/POS), el bridge podría eliminarse y la impresión podría ocurrir directamente desde el browser. [PENDIENTE — Web Serial API existe pero no está estandarizado para todos los browsers en uso]

### 3.3 La cola de impresión (print queue)

La print queue es una máquina de estados que vive en localStorage. Cuando se envía una comanda, el sistema primero la pone en la cola (estado: `pending`) y luego intenta enviarla al bridge.

Estados de la cola:
- `pending` → intento inicial
- `printing` → el bridge está procesando
- `success` → imprimió correctamente
- `bridge_unavailable` → el bridge no responde, reintentando
- `needs_attention` → varios reintentos fallidos, requiere intervención

Si el bridge no está disponible, la cola acumula las comandas y las reintenta automáticamente cuando el bridge vuelve. El banner "Comandas sin imprimir" aparece en el POS cuando hay items en la cola pendientes.

### 3.4 Sincronización offline

Las órdenes se guardan en IndexedDB (base de datos local del browser) antes de enviarse a Supabase. Si no hay internet, la orden queda en la sync queue de IndexedDB y se sube automáticamente al reconectarse.

> ℹ️ COMPORTAMIENTO REAL (corregido): Los conflictos de escritura se señalan via HTTP 200 con `{ ok: false, conflict: true }` en el body — no via HTTP 409. Un STALE_WRITE_CONFLICT es terminal: el item se elimina de la queue de reintentos y se cuenta como `failed`, no como `success`. El conflicto nunca se silencia ni se trata como éxito. La descripción original de DT-2 era incorrecta. Evidencia: `offline-sync.ts:66–81`.

### 3.5 Los agentes de IA

Los 13 agentes corren en GitHub Actions con crons. No necesitan que el restaurante haga nada. Leen datos de Supabase, los analizan con Groq/Claude, y mandan resultados a Telegram o los guardan en `agent_runs`.

Los agentes son inteligencia, no operación. El restaurante funciona perfectamente sin ellos. Si un agente falla, es un problema de analítica, no un problema de cobro.

---

## 4. Flujos principales

### 4.1 Un día completo — apertura hasta cierre

#### APERTURA (antes del primer cliente)

**Quién:** Gerente o supervisor

**Paso 1 — Verificar el bridge:**
Ir a /pos/monitor. La sección Bridge debe mostrar "Conectado" en verde. Si muestra rojo o amarillo, ver sección 9 (Casos borde).

**Paso 2 — Abrir turno:**
1. Ir a /pos/turno
2. Ingresar PIN de gerente
3. Seleccionar "Abrir turno"
4. Ingresar el fondo inicial (el efectivo que ya hay en la caja)
5. Confirmar

Sin turno abierto, el POS no permite tomar ni cobrar órdenes. El sistema lo bloquea.

**Paso 3 — Verificar impresoras:**
Desde /pos/monitor, verificar que cada impresora aparece en la lista. Opcionalmente, imprimir una comanda de prueba.

En AMALAY las impresoras son:
- Cocina: TCP 192.168.1.21:9100 y 192.168.1.40:9100 (copia)
- Barra: TCP 192.168.1.30:9100
- Tickets/caja: Windows printer "EC TICKET"
- Panadería/market: Windows printer "PANADERIA"

**Paso 4 — Verificar KDS:**
La pantalla del KDS en cocina (/pos/kds) debe mostrar "Sin órdenes pendientes". Si muestra órdenes de ayer que no se cerraron, hay que cerrarlas o transferirlas antes de empezar.

**Paso 5 — Revisar alertas de inventario:**
En /pos/inventario, revisar qué ingredientes están en alerta roja (por debajo del punto de reorden). Comunicar al chef si hay escasez de algo que se necesitará hoy.

**Paso 6 — Revisar el briefing:**
El briefing llega por Telegram a las 7am. Contiene las ventas de ayer, alertas de inventario, predicción de hoy, y reservaciones. Es el primer insumo de información del día.

---

#### TOMAR UNA ORDEN (mesero)

1. **Abrir mesa:** Tocar la mesa en el planograma (/pos/mesas). Las mesas libres aparecen sin color o en gris. Las mesas con orden abierta tienen color.

2. **Agregar items:** Navegar por las categorías en los tabs superiores. Tocar cada platillo para agregarlo al ticket.

3. **Modificadores:** Si el platillo tiene modificadores obligatorios, el sistema muestra el modal automáticamente. El mesero no puede continuar sin completar los modificadores obligatorios. Los opcionales se seleccionan en el mismo modal.

4. **Notas:** El mesero puede agregar notas a un item individual o a la orden completa. Ejemplos: "sin picante", "término medio", "es cumpleaños".

5. **Sillas:** Asignar qué silla ([S1], [S2], etc.) corresponde a cada platillo. Aparece en la comanda de cocina.

6. **Tiempos:** Si el cliente quiere que los platillos lleguen en dos momentos, el mesero inserta un separador de "Tiempo" antes de los items del segundo tiempo.

7. **Enviar a cocina:** El botón "Enviar a cocina" guarda la orden en Supabase, determina qué impresora recibe qué, y envía las instrucciones al bridge. La cocina recibe la comanda impresa. El KDS se actualiza.

---

#### COCINA (cocinero)

El cocinero opera únicamente en el KDS (/pos/kds). No necesita login.

1. Al llegar una orden nueva, el KDS emite alerta sonora y muestra una tarjeta con los items.
2. El cocinero puede marcar cada item como "preparado" al ir terminando.
3. Cuando todos los items están listos, toca "Listo". La mesa se actualiza en el POS para que el mesero sepa que la orden está lista.
4. Si el KDS no está disponible (la pantalla se apagó, hay problema de red), la comanda impresa es el respaldo. Cocina sigue funcionando con las comandas físicas.

---

#### COBRAR (cajero)

1. Seleccionar la mesa o buscar la orden por número.
2. Revisar el resumen de la cuenta.
3. **Propina (opcional):** En el modal de cobro, ingresar el monto de propina si el cliente la deja.
4. **Descuento (si aplica):** Requiere PIN del gerente. Ver reglas de negocio.
5. **Split (si aplica):** Dividir la cuenta entre varios pagadores antes de cobrar.
6. **Seleccionar método de pago.**
7. Para efectivo: ingresar el monto recibido, el sistema calcula el cambio.
8. Para tarjeta: operar la terminal bancaria externamente, luego confirmar en el sistema.
9. Para pago mixto: agregar múltiples métodos hasta que el saldo quede en $0.
10. Confirmar. El cajón abre si hubo efectivo. Se imprime el ticket. La orden queda cerrada.

---

#### FACTURA CFDI (cajero o cliente)

**Opción A — QR en ticket:**
El ticket impreso lleva un QR. El cliente lo escanea, ingresa RFC, razón social, código postal, email, y uso de CFDI. El sistema timbra via Facturama y manda el PDF/XML al correo.

**Opción B — Captura en caja:**
1. Ir a /pos/facturacion
2. Seleccionar la orden a facturar
3. Ingresar datos del receptor (RFC, razón social, CP, email, uso CFDI)
4. Confirmar. El sistema timbra y genera el CFDI

> ⚠️ ESTADO ACTUAL: Facturación CFDI 4.0 está implementada en producción. CSD: FTE260611P18. Las Facturas Globales (para clientes sin RFC) están pendientes.

---

#### CIERRE DE TURNO (gerente)

1. Verificar que no hay mesas con órdenes abiertas. El sistema advierte si las hay. El gerente puede cerrar con PIN ignorando la advertencia, pero las órdenes abiertas quedan sin cobrar.

2. Ir a /pos/turno → "Cerrar turno"

3. **CierreCajaWizard — Paso 1:** Contar billetes. Ingresar cuántos billetes hay de cada denominación ($20, $50, $100, $200, $500, $1,000).

4. **CierreCajaWizard — Paso 2:** Contar monedas. Ingresar cuántas monedas hay de cada denominación ($1, $2, $5, $10).

5. **CierreCajaWizard — Paso 3:** El sistema muestra el total contado vs lo que el sistema espera. La diferencia se calcula automáticamente.
   - El sistema espera: fondo inicial + ventas efectivo - retiros + depósitos
   - Si la diferencia es > $50, investigar antes de cerrar
   - Si la diferencia es esperada (faltante o sobrante pequeño), el gerente anota el motivo

6. **CierreCajaWizard — Paso 4:** El gerente ingresa su PIN para autorizar el cierre. Esto firma el corte.

7. El sistema imprime el ticket de cierre, guarda en pos_cierres, cierra el registro en pos_turnos, y libera todas las mesas.

---

#### Rationale: Por qué el cierre filtra STALE_WRITE_CONFLICT y TERMINAL_NON_RETRYABLE y no bloquea en ellos

**Problema:** Algunos items en la sync queue pueden quedar en estado `STALE_WRITE_CONFLICT` (conflicto de versión) o `TERMINAL_NON_RETRYABLE` (error permanente que el sistema ya clasificó como irrecuperable automáticamente). Estos items nunca se van a resolver solos. Si el CierreCajaWizard bloquea el cierre hasta que todos los items de la queue estén en `success`, el turno quedaría atascado indefinidamente. [HECHO — filtrado implementado en CierreCajaWizard]

**Alternativa descartada:** Bloquear el cierre hasta que un operador resuelva manualmente cada conflicto antes de poder cerrar.

**Por qué no:** En operación real, un cajero no puede quedarse sin poder cerrar su turno a las 11pm porque hay un conflicto técnico de hace 6 horas que nunca se va a resolver automáticamente. El cierre del turno es una operación contable que no debe depender de la salud de la sync queue. [INFERENCIA — basado en filosofía de operación § 2.2]

**Tradeoff real:** Al filtrar y permitir el cierre, el operador queda con la responsabilidad de revisar los conflictos manualmente después del cierre. Si no lo hace, puede haber órdenes que no quedaron en Supabase aunque el turno esté cerrado. La diferencia aparecería en el conteo físico de caja vs el sistema. [INFERENCIA]

**Cuándo replantear:** Si se agrega una pantalla de resolución de conflictos explícita antes del paso de PIN en el CierreCajaWizard, el operador podría ver y decidir sobre cada conflicto de forma informada antes de cerrar, en vez de que el sistema los filtre silenciosamente. [PENDIENTE]

#### INVENTARIO (almacén)

**Deducción automática:** Al cobrar cada orden, el sistema descuenta los ingredientes de la receta correspondiente de forma automática. Nadie hace nada.

**Recibir mercancía:**
1. /pos/compras → "Recibir mercancía"
2. Buscar la orden de compra si existe, o crear entrada directa
3. Ingresar cantidades y precio de factura
4. Confirmar → el sistema suma al inventario

**Registrar merma:**
1. /pos/inventario o /pos/merma
2. Seleccionar ingrediente
3. Ingresar cantidad a dar de baja
4. Seleccionar motivo: vencido, derramado, dañado, error de preparación
5. Confirmar → el sistema descuenta y registra el movimiento

**Conteo físico:**
1. /pos/inventario-fisico
2. Ingresar el conteo real de cada ingrediente
3. El sistema compara contra el inventario teórico
4. Las diferencias quedan documentadas para investigar

---

#### DELIVERY (Rappi / Uber Eats)

Las órdenes llegan automáticamente a /pos/delivery desde las plataformas.

1. Orden aparece con estado "Recibida"
2. Alguien (cajero o supervisor) la marca "Preparando"
3. Cocina prepara (ve la orden en KDS si está configurado para delivery)
4. Al terminar, marcar "Lista para recoger"
5. El repartidor de la plataforma llega y recoge
6. La orden se cierra

AMALAY no tiene repartidores propios. Fullsite solo controla el estado de cocina. La logística de entrega es de Rappi/Uber.

---

### 4.2 Onboarding de un nuevo restaurante

El proceso completo está documentado en /docs/playbooks/ONBOARDING-PLAYBOOK.md. El resumen:

**Etapas (9 en total):**
1. Discovery: evaluar si el restaurante es buen candidato (ICP score ≥ 3.5/5)
2. Pre-onboarding: recolectar datos, preparar ambiente, importar menú
3. Instalación: bridge, impresoras, terminales
4. Configuración: mesas, permisos, routing, descuentos, impuestos
5. Validación: probar los 10 flujos críticos
6. Shadow Day: 1 turno completo con el sistema anterior como respaldo
7. Go Live: Fullsite se convierte en el único POS
8. Hypercare: 4 semanas de soporte intensivo
9. Operación estable: el restaurante opera autónomamente

Cada etapa tiene una puerta de salida que debe cumplirse antes de avanzar.

---

## 5. Reglas de negocio

### 5.1 Reglas de turno

- No se pueden tomar órdenes sin un turno abierto. El sistema bloquea.
- No se puede abrir un nuevo turno si hay uno anterior sin cerrar.
- El turno solo lo puede abrir y cerrar alguien con PIN de gerente.
- El CierreCajaWizard requiere PIN de gerente para confirmar. La firma del gerente es obligatoria.
- Si hay mesas con órdenes abiertas al intentar cerrar el turno, el sistema advierte. El gerente puede forzar el cierre con PIN, pero las órdenes abiertas quedan registradas como incompletas.

#### Rationale: Por qué el turno es obligatorio y bloqueante

**Problema:** Sin contexto de turno abierto, el sistema no puede construir un audit trail ni reconciliar las ventas. Una orden sin `turno_id` no se puede asignar a un cajero, a un fondo inicial, ni a un corte de caja específico. [HECHO — turno_id requerido en save-order]

**Alternativa descartada:** Turno opcional, como en la mayoría de los POS tradicionales. El cajero puede cobrar sin abrir turno y el corte se hace al final del día sobre el total.

**Por qué no:** Fullsite necesita saber quién estaba en caja en cada momento para detección de fraude. Un descuento aplicado a las 10pm no tiene el mismo significado si el gerente ya se había ido y era un cajero sin permiso quien cerró esa orden. Sin turno_id, esa distinción desaparece. [INFERENCIA — basado en invariante 6 y diseño de pos_audit_log]

**Tradeoff real:** Si el sistema falla al abrir turno (error de Supabase, red caída en apertura), el staff no puede operar. Es el costo deliberado de la trazabilidad. El bridge puede estar funcionando, las impresoras en línea, y el POS bloqueado por un turno que no abrió. [HECHO — bloqueo implementado en /pos/turno]

**Cuándo replantear:** Si se implementa apertura de turno offline (turno_id generado localmente y sincronizado después), este trade-off desaparece. [PENDIENTE — apertura offline no implementada]

### 5.2 Reglas de cancelación

- No se puede cancelar un item enviado a cocina sin PIN de gerente.
- Toda cancelación requiere un motivo (obligatorio).
- Las cancelaciones quedan en el audit log con: quién canceló, quién aprobó (PIN gerente), el motivo, y la hora.
- Una vez registrada, la cancelación no se puede borrar del audit log.
- El item cancelado no se cobra. El sistema lo excluye del total.

### 5.3 Reglas de descuentos

- Todos los descuentos requieren PIN de gerente.
- El cajero puede iniciar el proceso de descuento, pero no puede completarlo sin aprobación.
- Los tipos de descuento disponibles: porcentaje, monto fijo, 2x1, cortesía (100%).
- Los descuentos se aplican sobre el subtotal antes de IVA.
- Toda aplicación de descuento queda en el audit log: tipo, monto, quién aprobó, a qué orden.

### 5.4 Reglas de cobro

- No se puede cobrar una orden antes de enviarla a cocina. Si el cajero intenta cobrar sin haber enviado, el sistema muestra "primero envía a cocina" y bloquea el modal de cobro. [HECHO — certificado COBRO-00]
- El cajón de dinero solo abre si alguna parte del pago fue en efectivo. [HECHO — certificado COBRO-02, COBRO-03]
- En cobro mixto, el total de los métodos de pago debe sumar exactamente el total de la orden. [HECHO — certificado COBRO-03]
- Una orden cerrada no se puede reabrir sin PIN de gerente. El gerente puede reabrir para corregir el método de pago, pero el historial de cobros queda en el audit log.

### 5.5 Reglas de propina

- La propina se registra por mesero al cerrar la orden.
- La propina es separada del total de la orden en el sistema.
- En AMALAY, la configuración es que el mesero contribuye 5% de su venta al fondo de propinas. Esta es una regla de negocio de AMALAY, no del sistema en general.

### 5.6 Reglas de permisos por rol

| Acción | Admin | Gerente | Cajero | Mesero | Cocina |
|--------|:-----:|:-------:|:------:|:------:|:------:|
| Abrir turno | Sí | Sí | No | No | No |
| Cerrar turno | Sí | Sí | No | No | No |
| Tomar orden | Sí | Sí | Sí | Sí | No |
| Enviar a cocina | Sí | Sí | Sí | Sí | No |
| Cancelar item (PIN) | Sí | Sí | No (pide PIN) | No (pide PIN) | No |
| Aplicar descuento (PIN) | Sí | Sí | No (pide PIN) | No (pide PIN) | No |
| Cobrar | Sí | Sí | Sí | Según config | No |
| Ver auditoría | Sí | Sí | No | No | No |
| Ver corte | Sí | Sí | Sí | No | No |
| Retiro/depósito (PIN) | Sí | Sí | No (pide PIN) | No | No |
| Reabrir orden (PIN) | Sí | Sí | No | No | No |
| Facturar CFDI | Sí | Sí | Sí | No | No |

> ⚠️ DISCREPANCIA: El MANUAL-OPERATIVO.md dice que los permisos están "definidos pero enforcement parcial" (DT-12). Los permisos están codificados en pos-permissions.ts pero no todos los componentes de UI los verifican correctamente. Algunos permisos pueden no estar aplicados en todos los puntos de la interfaz.

### 5.7 Reglas de inventario

- La deducción automática ocurre al cobrar la orden, no al enviar a cocina.
- Si el stock de un ingrediente llega a $0, el sistema alerta pero no bloquea la venta.
- La deducción de inventario no funciona en modo offline. Las órdenes tomadas sin internet no descuentan inventario hasta que se sincronizan.
- La merma solo puede registrarla alguien con permiso de acceso al módulo de inventario.

#### Rationale: Por qué la deducción de inventario ocurre después del cobro (Transaction B) y no antes

**Problema:** Si la deducción de inventario ocurriera en el mismo momento que se guarda la orden (al enviar a cocina), un fallo en la capa de inventario bloquearía el flujo crítico de cobro. El mesero no podría procesar un pago aunque el platillo ya fue servido. [HECHO — separación Transaction A/B documentada en FULLSITE-ENGINEERING-BIBLE.md § Transaction A/B]

**Alternativa descartada:** Deducir al momento de enviar la comanda a cocina. Más intuitivo desde la perspectiva de inventario (el ingrediente "salió" cuando se preparó, no cuando se cobró).

**Por qué no:** La comanda puede cancelarse después de enviarse a cocina. Si se dedujo al enviar y luego se cancela, hay que revertir. Ese flujo de reversión agrega complejidad y un punto de falla adicional en un momento donde el mesero necesita certeza. Deducir al cobrar es más simple: si no se cobró, no se descontó. [INFERENCIA — basado en regla de cancelación § 5.2]

**Tradeoff real:** Entre el envío de comanda y el cobro, el sistema reporta más stock del que realmente existe. En un restaurante de alto volumen con inventario ajustado, esto puede causar que se tome una orden de un platillo que ya no tiene ingredientes. El sistema alerta pero no bloquea la venta. [HECHO — § 5.7: "el sistema alerta pero no bloquea"]

**Cuándo replantear:** Cuando el inventario server-side esté implementado y sea suficientemente confiable como para ser parte de Transaction A. En ese punto, se podría agregar un check de stock al enviar la comanda, con un bloqueo soft (warning) o hard (error) según la política del restaurante. [PENDIENTE]

### 5.8 Reglas de facturación

- Se puede facturar cualquier orden cerrada del día actual o de días anteriores.
- Se puede emitir una sola factura por orden (no duplicados).
- La factura se timbra en tiempo real via Facturama. Si Facturama está fuera de servicio, la facturación no está disponible, pero el cobro no se bloquea.
- Las cancelaciones de CFDI ante el SAT requieren hacerse desde el panel de Facturama, no desde el POS.

---

## 6. Estados (state machines)

### 6.1 Estado de una orden

```
ABIERTA → ENVIADA → CERRADA
                ↓
           CANCELADA / ANULADA
```

| Estado | Significado |
|--------|-------------|
| `abierta` | Orden creada, no enviada a cocina todavía |
| `enviada` | Enviada a cocina, en preparación |
| `cerrada` | Cobrada y finalizada |
| `cancelada` | Cancelada antes de cobrar |
| `anulada` | Anulada post-cobro (requiere aprobación de gerente) |

**Transiciones válidas:**
- `abierta` → `enviada`: al tocar "Enviar a cocina"
- `enviada` → `cerrada`: al completar el cobro
- `enviada` → `cancelada`: con PIN de gerente
- `cerrada` → reabierta: con PIN de gerente (regresa a `enviada` temporalmente)

Una orden en estado `cerrada` no genera revenue si luego se anula. El sistema la excluye del corte.

### 6.2 Estado de una impresión (print queue)

```
PENDING → PRINTING → SUCCESS
    ↓
BRIDGE_UNAVAILABLE → NEEDS_ATTENTION
```

| Estado | Significado |
|--------|-------------|
| `pending` | Esperando envío al bridge |
| `printing` | El bridge está procesando |
| `success` | Imprimió correctamente |
| `bridge_unavailable` | Bridge no responde, reintentando con tiempo-based retry |
| `needs_attention` | Múltiples intentos fallidos, requiere intervención manual |

La máquina de estados es time-based: no cuenta reintentos, sino tiempo transcurrido. Si el bridge lleva X minutos sin responder, escala de `bridge_unavailable` a `needs_attention`.

### 6.3 Estado del turno

```
ABIERTO → CERRADO
```

Solo puede haber un turno abierto a la vez. El cierre requiere PIN de gerente y el CierreCajaWizard completo.

### 6.4 Estado de un item en KDS

```
NUEVA → PREPARANDO → LISTA
```

El cocinero mueve los items entre estados en el KDS. El POS muestra el estado actualizado cuando todos los items de una orden están en `LISTA`.

### 6.5 Estado de una orden de delivery

```
RECIBIDA → PREPARANDO → LISTA → ENTREGADA
```

El estado de delivery es independiente del estado de la orden en el POS. Una orden puede estar `cerrada` en el POS (cobrado por la plataforma) pero `preparando` en el módulo de delivery.

---

## 7. Source of Truth

| Entidad | Donde vive | Quién manda |
|---------|-----------|-------------|
| Órdenes | `pos_orders` en Supabase | Supabase es la fuente de verdad. IndexedDB es caché temporal offline |
| Staff y PINs | `pos_staff` en Supabase | Supabase. Los cambios de PIN se hacen ahí |
| Menú (items, precios, modificadores) | `pos_menu_items`, `pos_modifier_groups` en Supabase | Supabase. Cambios de precio o menú se hacen ahí |
| Turnos | `pos_turnos` en Supabase | Supabase |
| Cierres de caja | `pos_cierres` en Supabase | Supabase |
| Audit log | `pos_audit_log` en Supabase | Supabase. Inmutable, no se puede modificar |
| Inventario | `pos_ingredients` / `pos_inventory_products` en Supabase | Supabase |
| Recetas | `pos_recipes` en Supabase | Supabase |
| Cola de impresión | `localStorage` del browser de la terminal | localStorage. Se pierde si se limpia el browser |
| Órdenes offline | `IndexedDB` del browser | IndexedDB. Se sincroniza con Supabase al reconectar |
| Config de impresoras | `C:\fullsite\printers.json` en la terminal | El archivo físico. Cambios requieren editar el archivo y reiniciar el bridge |
| Datos históricos de ventas | `ops_daily` / `wansoft_daily` en Supabase | Para días anteriores al cutover: wansoft_daily. Para días post-cutover: ops_daily (fuente Fullsite) |
| Configuración del cliente (restaurante) | Supabase (`client_id`, RLS policies) | Supabase |

> ⚠️ DISCREPANCIA: Existe dualidad en el inventario: `pos_ingredients` (para recetas) y `pos_inventory_products` (para market). Hay un "compatibility bridge" en el código porque el campo `ingredient_id` es TEXT en un lugar y UUID en otro. Esto está documentado como deuda técnica DT-8 en MANUAL-OPERATIVO.md. Desde el punto de vista operativo no es visible, pero puede generar inconsistencias en reportes de inventario.

---

## 8. Invariantes

Estas son las condiciones que nunca deben romperse bajo ninguna circunstancia. Si alguna se rompe, es un bug crítico.

1. **Toda orden cerrada tiene un metodo_pago o un array de pagos cuya suma igual al total.** Sin excepción. [Verificado — certificado COBRO-03]

2. **Todo descuento aplicado tiene un actor registrado en el audit log.** El gerente que aprobó el descuento debe quedar registrado.

3. **El audit log es inmutable.** Ningún código puede hacer DELETE o UPDATE sobre pos_audit_log. Solo INSERT.

4. **El cajón de dinero solo abre si hay efectivo en el pago.** Cobros 100% en tarjeta nunca deben abrir el cajón. [Verificado — certificado COBRO-02]

5. **Una orden no puede estar en estado `cerrada` con closed_at NULL.** Si el campo closed_at es NULL, la orden no está realmente cerrada.

6. **No se puede cobrar una orden sin turno abierto.** El sistema debe bloquearlo.

7. **El total de la orden incluye IVA.** Los precios en el catálogo están sin IVA; el POS agrega el 16% al calcular el total. [Decisión de arquitectura D9 en MANUAL-OPERATIVO.md]

8. **Las órdenes de delivery solo se descuentan de inventario cuando se cobran en el POS.** El status de la plataforma (Rappi/Uber) no dispara la deducción.

9. **Toda cancelación de item tiene un motivo.** El campo motivo no puede ser NULL en una cancelación.

10. **El fondo inicial del turno no puede ser negativo.** Si el cajero ingresa un número negativo, el sistema debe rechazarlo.

---

## 9. Casos borde

### 9.1 Bridge detenido en hora pico

**Síntoma:** Banner rojo "Bridge desconectado" en el POS. Las comandas se acumulan en la cola (estado `bridge_unavailable`).

**Causa más común:** Alguien cerró la ventana de terminal del bridge por accidente.

**Resolución:**
1. Ir a la computadora principal (la que tiene `C:\fullsite\`)
2. Si el acceso directo "Fullsite Bridge" está en el escritorio, doble clic
3. Si no: abrir CMD, navegar a C:\fullsite\, ejecutar `node bridge.js`
4. En /pos/monitor verificar que vuelve a verde
5. Las comandas pendientes en la cola se envían automáticamente

**Si el bridge no arranca:** Ver si hay error en la ventana de terminal. Los errores más comunes son puerto ocupado (otro proceso usa el 7717) o archivo printers.json con formato incorrecto.

**Protocolo de emergencia si no se puede resolver en 5 minutos:** Las comandas verbales. Los meseros dicen su orden directamente a cocina. Las órdenes se siguen ingresando en el POS (quedan registradas aunque no impriman). Al restaurarse el bridge, se imprimen las comandas pendientes.

### 9.2 Internet caído con mesas abiertas

**Síntoma:** El browser muestra error de conexión. El POS puede seguir funcionando o mostrar datos desactualizados.

**Lo que SÍ funciona sin internet:**
- Tomar órdenes (guarda en IndexedDB)
- Imprimir comandas (las impresoras son locales, no necesitan internet)
- El KDS sigue visible si ya estaba cargado
- Cobrar en efectivo (no requiere verificación online)

**Lo que NO funciona sin internet:**
- El dashboard no carga datos nuevos
- Los agentes de IA no corren
- Cambios al menú o staff no se propagan

**Resolución:**
1. Continuar operando normalmente. El POS sigue funcionando.
2. Al restaurarse el internet, el sistema sincroniza automáticamente las órdenes offline.
3. Verificar en /pos/auditoria que todas las órdenes del período offline quedaron sincronizadas.

**Nota crítica:** Si el browser de la terminal se cierra o recarga mientras hay órdenes offline sin sincronizar, esas órdenes se pierden. No recargar la página del POS mientras no hay internet si hay órdenes pendientes.

### 9.3 Dos personas intentan cobrar la misma mesa al mismo tiempo

**Síntoma:** Dos cajeros abren la misma mesa simultáneamente.

**Estado actual:** El sistema tiene protección parcial via check de `updated_at` en handlePayment. Sin embargo, con múltiples terminales, el escenario no está completamente resuelto. Esto está documentado como DT-1 en MANUAL-OPERATIVO.md.

**Resolución operativa:** El protocolo es que solo un cajero cobra cada mesa. Si dos cajeros intentan cobrar, el segundo verá un error. El gerente debe revisar el audit log para confirmar qué cobro fue válido.

### 9.4 Cajón de dinero que no abre

**Síntoma:** Se cobró en efectivo pero el cajón no abrió.

**Causas posibles:**
- La impresora "EC TICKET" no imprimió (el cajón se conecta al ticket de caja via RJ-11)
- El cable RJ-11 entre la impresora y el cajón está desconectado
- La impresora EC TICKET está atascada

**Resolución:**
1. Verificar que la impresora EC TICKET tiene papel y está encendida
2. Verificar el cable RJ-11 entre la impresora y el cajón
3. Reimprimir el ticket desde /pos/historial → buscar la orden → Reimprimir
4. Si el cajón sigue sin abrir, abrirlo manualmente con la llave

> ⚠️ HISTORIA: En AMALAY hubo un período donde la impresora "EC TICKET" estaba atascada y los tickets salían por la impresora "EC01". El cajón estaba conectado a la impresora incorrecta temporalmente. Si el cajón deja de abrir, verificar a cuál impresora está conectado el RJ-11.

### 9.5 Mesero tomó la orden en la mesa equivocada

**Síntoma:** La comanda llegó a cocina para mesa 5 pero era mesa 8.

**Resolución:**
1. El gerente hace un transfer de mesa: en la orden activa, seleccionar "Cambiar mesa" y elegir la mesa correcta
2. La cocina ya tiene la comanda; si el platillo no fue preparado todavía, el mesero puede avisar verbalmente
3. El transfer queda registrado en el audit log

### 9.6 Cliente pide factura de una orden de días anteriores

**Resolución:**
1. En /pos/facturacion, buscar la orden por fecha o número de ticket
2. Los datos del cliente pueden haber llegado via QR (si el cliente escaneó el ticket) o hay que capturarlos manualmente
3. Facturar normalmente

Las facturas se pueden emitir para órdenes de hasta 72 horas antes (limitación del PAC). Para órdenes más antiguas, el cliente debe gestionarlo directamente con el contador.

### 9.7 Staff nuevo que aún no tiene PIN configurado

**Síntoma:** El mesero no puede loguearse.

**Resolución:**
El gerente va a /pos/configuracion → Staff → Crear o editar empleado → Asignar PIN.

El PIN nuevo aplica de inmediato. El mesero puede usarlo sin reiniciar nada.

### 9.8 Propina registrada en la cuenta equivocada

**Síntoma:** La propina se atribuyó al mesero incorrecto.

**Resolución:**
El gerente puede reabrir la orden con PIN, pero reabrir la orden no permite editar la propina directamente en la versión actual. Se debe contactar a soporte para ajuste manual en la base de datos.

> ⚠️ LIMITACIÓN: No existe un flujo de UI para corregir la atribución de propina post-cobro. Es una deuda operativa conocida.

### 9.9 Bridge se reinicia durante el turno y pierde estado

**El bridge es stateless.** No tiene memoria de las impresiones previas. Si se reinicia, las comandas que estaban en estado `printing` en la cola del POS pueden no haber imprimido. Verificar en /pos/monitor si hay items en la cola con estado `needs_attention` y forzar reintento.

---

## 10. Limitaciones actuales

Las siguientes funcionalidades son conocidas como incompletas o con deuda técnica. No bloquean la operación pero el gerente y el staff deben saber que existen.

### Deuda técnica que puede afectar la operación

| ID | Limitación | Impacto operativo | Estado |
|----|-----------|-------------------|--------|
| DT-1 | Doble cobro posible si dos terminales cobran simultáneamente la misma mesa | Bajo (1 terminal en AMALAY) | Pendiente de resolver pre-cutover en multi-terminal |
| DT-2 | ~~Sync offline trata 409 como éxito~~ — descripción incorrecta. STALE_WRITE_CONFLICT llega via HTTP 200 + `{conflict:true}`, es terminal (sale de la queue como `failed`, no `success`) | N/A | DESCRIPCIÓN ERA INCORRECTA — el código maneja el conflicto correctamente |
| DT-3 | Items de la orden como JSON monolítico (no filas normalizadas) | No visible al usuario | Deuda arquitectural, post-cutover |
| DT-4 | ~~KDS escribe al mismo campo `items` que el POS~~ — descripción incorrecta. KDS escribe a `kds_item_status` (columna separada). Race condition no existe | N/A | DESCRIPCIÓN ERA INCORRECTA — los campos son distintos, conflicto no es posible |
| DT-5 | Mesas abiertas no bloquean cierre de turno (solo advierten) | Gerente puede cerrar sin cobrar mesas | Parcialmente mitigado con la advertencia |

### Módulos no implementados

| Módulo | Estado | Cuándo se planea |
|--------|--------|-----------------|
| Factura Global (CFDI de clientes sin RFC) | No implementado | Post-cutover |
| Sistema formal de fondo de propinas | No implementado | Post-10 restaurantes |
| Órdenes de producción automatizadas | Parcial (manual) | Post-cutover |
| Corte Z con bloqueo formal | Parcial (el CierreCajaWizard existe, falta el bloqueo) | Post-cutover |
| Multi-terminal con Realtime | No implementado | Post-cutover |
| Exportación a Excel desde el POS | No implementado | Post-cutover |
| Huella digital en todas las terminales | Bloqueado por hardware | Pendiente de resolver HID-SETUP-GUIDE |
| Plantillas de OC por proveedor | No implementado | Post-10 restaurantes |
| Notas de crédito CFDI | No implementado | Post-cutover |

### Limitaciones conocidas de inventario

- La deducción de inventario no opera offline. Las órdenes tomadas sin internet se sincronizan después, pero los movimientos de inventario correspondientes no están garantizados en todos los casos.
- Existe una dualidad en las tablas de inventario (`pos_ingredients` vs `pos_inventory_products`) que puede generar inconsistencias en reportes cruzados.
- No existe cierre de inventario (congelar el stock a fin de mes para empezar con conteo limpio).

### Limitaciones de los agentes de IA

- Los agentes de IA dependen de que los datos de Supabase estén actualizados. Si el pipeline de datos tiene un retraso, los agentes trabajan con datos viejos.
- En el primer día productivo, los agentes de IA no tienen baseline de Fullsite. Pueden comparar contra datos de Wansoft o generar anomalías falsas.
- El close-predictor necesita al menos 4 snapshots de 15 minutos (1 hora de operación) para dar una proyección confiable. Antes de eso, usa curvas históricas.

---

## 11. Roadmap

Las prioridades están agrupadas por horizonte temporal. Los criterios para avanzar al siguiente nivel son funcionales (no calendarios).

### Antes del primer cutover completo

1. Parche DT-1: check de `updated_at` en handlePayment para prevenir doble cobro
2. ~~Parche DT-2: no silenciar 409 en sync offline~~ — ELIMINADO: el código ya maneja conflictos correctamente. La descripción original era incorrecta.
3. ~~Separar KDS writes del campo `items` (DT-4)~~ — ELIMINADO: KDS ya escribe a `kds_item_status` (campo separado). La descripción original era incorrecta.
4. Verificar turno + corte + cierre E2E en AMALAY con datos reales
5. Shadow Day exitoso (criterios: bridge 4+ horas, tickets 0% discrepancia vs Wansoft)
6. NSSM para autoarranque del bridge en caso de reinicio de la PC

### Post-cutover (primeras 4 semanas)

1. Normalizar `pos_order_items` como filas independientes (eliminar JSON monolítico — DT-3)
2. Supabase Realtime para sincronización entre terminales
3. Corte Z con bloqueo formal
4. Exportación a Excel de reportes
5. Reimprimir comanda desde KDS

### Para 10 restaurantes

1. Multi-tenant completo (client_id en todo el sistema, RLS verificado)
2. Onboarding automatizado (migration script desde Wansoft y otros POS)
3. Sistema de fondo de propinas
4. Catálogo editable desde el POS (CRUD sin acceso a Supabase directamente)
5. Permisos configurables por usuario (no hardcoded)
6. Integración Uber Eats API (órdenes automáticas sin operador manual)

### Para 100 restaurantes

1. API pública para integraciones
2. App nativa para comandero (React Native)
3. Terminal propia (hardware tipo Toast/Clip)
4. Analytics entre restaurantes (benchmarking)
5. Sistema de lealtad/puntos
6. Integración CONTPAQi completa

---

## 12. Referencias al código

Los archivos clave del sistema. La etiqueta indica el nivel de verificación:
- **[HECHO]** = existe en el código y fue verificado funcionalmente
- **[INFERENCIA]** = deducido del contexto de los documentos, no verificado directamente

### POS

| Archivo | Función | Verificación |
|---------|---------|-------------|
| `dashboard-app/app/pos/page.tsx` | POS principal (~3000 líneas). Toma de órdenes, cobro, split, descuentos | [HECHO] |
| `dashboard-app/app/pos/kds/page.tsx` | KDS — pantalla de cocina | [HECHO] |
| `dashboard-app/app/pos/turno/page.tsx` | Abrir/cerrar turno | [HECHO] |
| `dashboard-app/app/pos/corte/page.tsx` | Corte X, reabrir órdenes | [HECHO] |
| `dashboard-app/app/pos/facturacion/page.tsx` | CFDI 4.0 | [HECHO] |
| `dashboard-app/app/pos/delivery/page.tsx` | Monitor de delivery | [HECHO] |
| `dashboard-app/app/pos/auditoria/page.tsx` | Log inmutable | [HECHO] |
| `dashboard-app/app/pos/monitor/page.tsx` | Bridge health, print queue | [HECHO] |

### Librerías compartidas

| Archivo | Función | Verificación |
|---------|---------|-------------|
| `dashboard-app/lib/printer.ts` | Lógica de impresión, routing de estaciones | [HECHO] |
| `dashboard-app/lib/print-queue.ts` | Cola de impresión con state machine time-based | [HECHO — certificado BUG-005] |
| `dashboard-app/lib/pos-offline-db.ts` | IndexedDB para órdenes offline | [HECHO — certificado OFF-02] |
| `dashboard-app/lib/pos-data.ts` | Funciones de lectura/escritura de órdenes | [HECHO] |
| `dashboard-app/lib/pos-permissions.ts` | 50+ permisos por rol | [HECHO — enforcement parcial] |
| `dashboard-app/lib/facturama.ts` | Integración con Facturama API | [HECHO] |
| `dashboard-app/lib/pos-constants.ts` | Constantes: MENU_CATEGORIES, etc. | [HECHO] |

### Bridge

| Archivo | Función | Verificación |
|---------|---------|-------------|
| `electron-app/bridge.js` o `C:\fullsite\bridge.js` | Servidor Node.js local de impresión | [HECHO] |
| `C:\fullsite\printers.json` | Configuración de IPs y puertos de impresoras | [HECHO] |

### Agentes de IA

| Archivo | Función | Verificación |
|---------|---------|-------------|
| `.github/scripts/daily_briefing.py` | Briefing matutino | [HECHO] |
| `.github/scripts/anomaly_detector.py` | Detector de anomalías | [HECHO] |
| `.github/scripts/close_predictor.py` | Predictor de cierre | [HECHO] |
| `.github/scripts/upselling_agent.py` | Sugerencias de upselling | [HECHO] |
| `.github/scripts/antifraud_agent.py` | Anti-fraude (viernes) | [HECHO] |
| `.github/scripts/tips_analyzer.py` | Análisis de propinas | [HECHO] |
| `.github/scripts/menu_engineering.py` | Clasificación del menú | [HECHO] |
| `.github/scripts/client_config.py` | Config multi-tenant | [HECHO] |

### Supabase — tablas principales

| Tabla | Contenido | Verificación |
|-------|-----------|-------------|
| `pos_orders` | Todas las órdenes (abierta/cerrada/cancelada) | [HECHO] |
| `pos_turnos` | Turnos abiertos y cerrados | [HECHO] |
| `pos_cierres` | Registros de cierre de caja | [HECHO] |
| `pos_staff` | Staff con PINs y roles | [HECHO] |
| `pos_audit_log` | Log inmutable de todas las acciones | [HECHO] |
| `pos_ingredients` | Ingredientes con stock para recetas | [HECHO] |
| `pos_inventory_products` | Productos de market con stock | [HECHO] |
| `pos_recipes` | Recetas (ingredientes por platillo) | [HECHO] |
| `pos_inventory_movements` | Movimientos de inventario (entradas, salidas, merma) | [HECHO — con compatibility bridge] |
| `ops_daily` | Snapshots y cierres para los agentes de IA | [HECHO] |
| `agent_runs` | Log de ejecuciones de todos los agentes | [HECHO] |

---

## Cross References

**→ POS Bible** — Ver § Flujos principales para los pasos técnicos exactos de cada flujo operativo (tomar orden, cobrar, split, descuento). Ver § Offline para el comportamiento del sistema cuando no hay internet y qué operaciones quedan disponibles. Ver § State Machines para los estados de cada entidad (orden, impresión, turno, KDS) durante la operación.

**→ Engineering Bible** — Ver § Transaction A/B para entender por qué el inventario no bloquea el cobro y cómo se separan las operaciones críticas de las deseadas. Ver § Sincronización Offline para entender qué pasa técnicamente cuando el sistema opera sin red (IndexedDB, sync queue, replay). Ver § Flujos principales para el detalle técnico de save-order, replay, y OCC conflict resolution.

**→ Domain Bible** — Ver § Order para el schema completo de una orden y los estados válidos de cada campo. Ver § Turno para la definición exacta de la entidad, sus invariantes, y la relación con pos_cierres. Ver § SyncQueueItem para entender qué hay en la cola offline cuando no hay internet y cómo se clasifica cada error.

**→ Dashboard Bible** — Ver § Flujos principales para cómo los datos operativos (órdenes, turnos, movimientos de inventario) llegan al dashboard del dueño. Ver § Source of Truth para entender qué tabla muestra qué dato y cuál tiene precedencia entre ops_daily y wansoft_daily.

**→ Master Bible** — Ver § Flujo de información (extremo a extremo) para la visión completa desde que el cliente entra al restaurante hasta el briefing de IA del día siguiente. Ver § Invariantes para las reglas que nunca pueden romperse en operación, independientemente del componente que falle.

---

## Open Questions & Future Work

Esta sección es el backlog operativo del sistema. Incluye dudas que surgieron durante el análisis, deuda técnica con impacto operativo, decisiones abiertas, e inconsistencias encontradas entre los procedimientos documentados y el sistema real.

---

**[DEUDA]** DT-1: Doble cobro posible con múltiples terminales
> Descripción: El campo `updated_at` en `handlePayment` no está verificado antes de ejecutar el cobro. Si dos terminales intentan cobrar la misma mesa simultáneamente, ambas pueden completar el pago. Documentado en MANUAL-OPERATIVO.md.
> Impacto: Si AMALAY agrega una segunda terminal de cobro, este escenario se vuelve probable. Con 1 terminal el riesgo es bajo pero existe.
> Prioridad sugerida: P0 antes de multi-terminal

---

**[CORRECCIÓN DE DESCRIPCIÓN]** DT-2: La descripción original era incorrecta
> Descripción original: "Sync offline silencia conflictos HTTP 409 tratándolos como éxito."
> Corrección (evidencia: `offline-sync.ts:66–81`, `pos-offline-db.ts`): STALE_WRITE_CONFLICT llega como HTTP 200 con `{ ok: false, conflict: true }`. Es un error terminal: el item se elimina de la queue de reintentos, se cuenta en `failed` (no en `synced`), y se loguea en consola. El código nunca trata un conflicto como éxito.
> Estado: La deuda descrita no existe. No hay parche necesario.

---

**[CORRECCIÓN DE DESCRIPCIÓN]** DT-4: La descripción original era incorrecta
> Descripción original: "KDS y POS escriben al mismo campo `items` — posible race condition."
> Corrección (evidencia: `kds/page.tsx:210`): KDS escribe exclusivamente a `kds_item_status` (columna separada en `pos_orders`). El POS escribe exclusivamente a `items`. Los campos son distintos — la race condition descrita no puede ocurrir.
> Nota de legado: Existe un fallback de LECTURA de `kds_done` dentro de `items` para órdenes antiguas (`kds/page.tsx:144–149`), pero no hay ningún WRITE a `items` desde el KDS en el código actual.
> Estado: La deuda descrita no existe. No hay parche necesario.

---

**[INCONSISTENCIA]** Permisos: definidos vs aplicados
> Descripción: `pos-permissions.ts` tiene 50+ permisos definidos por rol. Sin embargo, el MANUAL-OPERATIVO.md documenta que el enforcement es parcial (DT-12): no todos los componentes de UI verifican los permisos antes de mostrar o ejecutar acciones.
> Impacto: Un mesero podría ver o acceder a funcionalidades que su rol no debería tener.
> Prioridad sugerida: P1 (auditar todos los puntos de enforcement antes de multi-restaurante)

---

**[INCONSISTENCIA]** Dualidad de tablas de inventario
> Descripción: Existen dos tablas de inventario: `pos_ingredients` (para ingredientes de recetas) y `pos_inventory_products` (para productos de market que se venden directamente). El campo `ingredient_id` es TEXT en un lugar y UUID en otro. Hay un "compatibility bridge" en el código para manejar esta diferencia.
> Impacto: Los reportes de inventario que cruzan ambas tablas pueden tener inconsistencias. El módulo de food cost solo opera sobre `pos_ingredients`.
> Prioridad sugerida: P1 (resolver antes de activar inventario completo en restaurante nuevo)

---

**[DUDA]** ¿Qué pasa si el bridge falla durante el flujo de cobro?
> Descripción: Al cobrar, el sistema cierra la orden en Supabase y luego intenta imprimir el ticket. Si el bridge falla justo entre esos dos pasos, la orden queda cerrada pero el ticket no se imprimió. ¿Cómo recuperar? ¿El botón de reimprimir en /pos/historial cubre este caso?
> Impacto: El cajero no tiene evidencia física del cobro. El cliente tampoco. Puede generar confusión.
> Prioridad sugerida: P1 (verificar en Shadow Day)

---

**[DUDA]** ¿Funciona la facturación QR sin internet?
> Descripción: El QR en el ticket lleva a una URL que el cliente visita desde su celular. Esa URL hace llamadas a Facturama. Si el restaurante no tiene internet, Facturama no puede timbrar. No está claro si hay un flujo de "facturar después" para el cliente que escaneó el QR pero no pudo completar la factura en ese momento.
> Impacto: Cliente frustrando al no poder facturar. Posible pérdida de una venta en el caso de clientes que solo compran si hay factura.
> Prioridad sugerida: P2 (documentar el caso y dar instrucción al staff)

---

**[DECISIÓN PENDIENTE]** ¿Cuándo se activa el Corte Z con bloqueo formal?
> Descripción: El CierreCajaWizard existe y funciona, pero no bloquea el sistema post-cierre. Un gerente puede seguir tomando órdenes después de cerrar el turno si el turno se reabre. No hay un "Corte Z" que bloquee definitivamente el día.
> Impacto: Sin bloqueo formal, el día contable puede seguir recibiendo órdenes aunque el gerente ya haya hecho el corte.
> Prioridad sugerida: P1 (decidir las reglas de negocio antes de implementar)

---

**[DECISIÓN PENDIENTE]** ¿Cómo manejar la propina cuando hay un split?
> Descripción: Si una mesa de 4 personas hace split y cada quien paga su parte, ¿la propina se puede ingresar por sub-cuenta o solo al final de la cuenta completa? No está claro en los documentos operativos.
> Impacto: Posible sub-reporte de propinas si el cajero no sabe cómo registrarlas en split.
> Prioridad sugerida: P2 (verificar en Shadow Day)

---

**[DEUDA]** El bridge no tiene autoarranque garantizado post-reinicio
> Descripción: El bridge está configurado en la carpeta Startup de Windows, pero no hay NSSM (Non-Sucking Service Manager) instalado. Si Windows falla el arranque de Startup, el bridge no inicia. El staff tendría que iniciarlo manualmente.
> Impacto: La primera comanda del día no sale si el bridge no arrancó.
> Prioridad sugerida: P0 (instalar NSSM in situ antes del cutover)

---

**[DUDA]** ¿Qué pasa con el inventario de las órdenes tomadas offline?
> Descripción: El MANUAL-OPERATIVO.md documenta que la deducción de inventario no funciona offline (LIMITACION-OFF-INV-01). Las órdenes se guardan en IndexedDB y se suben al reconectarse. Pero ¿la deducción de inventario ocurre al hacer el sync, o se pierde permanentemente?
> Impacto: Si hay períodos largos de operación offline, el inventario del sistema puede estar sobrestimado.
> Prioridad sugerida: P1 (verificar el comportamiento exacto en el código y documentar)

---

**[INCONSISTENCIA]** Estado del certificado de Facturama vs CSD del SAT
> Descripción: El certificado eGlobal (el que AMALAY usaba con Wansoft) vence el 3 de agosto de 2026. Fullsite usa su propio CSD (FTE260611P18) via Facturama. Si AMALAY sigue facturando con Wansoft en paralelo durante el período de transición, el certificado eGlobal vencería y Wansoft quedaría sin poder facturar. No está claro si el plan de cutover considera este riesgo.
> Impacto: Si el cutover no ocurre antes del 3 de agosto, AMALAY puede quedar sin capacidad de facturar en Wansoft, forzando el cambio a Fullsite por default o requiriendo renovar el certificado.
> Prioridad sugerida: P0 (decisión de fecha de cutover debe considerar esta fecha límite)

---

*Este documento es la fuente de verdad operativa de Fullsite.*
*Actualizar después de cada cambio significativo en el sistema o en los procesos operativos.*
*Versión: 1.0 — Julio 2026*
*Próxima revisión obligatoria: después del primer Shadow Day exitoso en AMALAY.*

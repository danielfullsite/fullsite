# 02 — Caja

> Dominio: Efectivo, cobro, métodos de pago, cortes, descuentos, propinas, facturación  
> Patrones: CJ-001 a CJ-019  
> Referencias cruzadas: → OP-002 (turno como unidad fiscal), → OP-005 (corte Z vs cierre), → EC-003 (bug corte X)

---

## CJ-001 — IVA_RATE fijo 0.16

```
ID:                CJ-001
Nombre:            IVA_RATE fijo 0.16 — precios con IVA incluido
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (constante IVA_RATE)
```

**Evidencia:**  
`IVA_RATE = 0.16` definida como constante. Los precios en el menú son precios finales al consumidor, IVA incluido.

**Problema operacional:**  
Si el sistema calcula IVA sobre el precio (precio × 1.16), el cobro final sería mayor al precio impreso — causaría confusión al cliente y problemas con el SAT.

**Por qué existe:**  
México: IVA ya incluido en precios al público en restaurantes. El SAT requiere desglose IVA en factura, pero el precio de venta no cambia.

**Cuándo aplica:**  
En todo cobro, todo cálculo de subtotal, todo reporte de ventas.

**Comportamiento observado:**  
`subtotal = total / 1.16` → el IVA se retrocalcula del precio final. El cliente paga lo que ve en el menú.

**Impacto operativo:**  
Correcto para restaurantes. Incorrecto si se usara para un negocio B2B donde el precio es sin IVA.

**Limitaciones conocidas:**  
IVA_RATE está hardcodeado — si el SAT cambia la tasa, requiere deploy.

**Preguntas abiertas:**  
- ¿Hay productos exentos de IVA en el menú de AMALAY? (ej. algunos alimentos básicos están a tasa 0%)

---

## CJ-002 — Subtotal = total / 1.16

```
ID:                CJ-002
Nombre:            Subtotal = total / 1.16 — el menú no discrimina IVA
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md
```

**Evidencia:**  
La fórmula para desglosar IVA de un precio final es `subtotal = precio_final / 1.16`, `iva = precio_final - subtotal`.

**Problema operacional:**  
La fórmula correcta es necesaria para la factura CFDI: el XML debe contener subtotal (sin IVA) + IVA = total. Si se usa la fórmula incorrecta (subtotal × 1.16 = total), los montos no cuadran.

**Por qué existe:**  
Estándar SAT para CFDI 4.0: el comprobante debe desglosar base + IVA + total.

**Cuándo aplica:**  
En cada factura generada. En el reporte de ventas para mostrar ventas netas vs IVA recaudado.

**Comportamiento observado:**  
Cálculo correcto implementado en Fullsite. En Wansoft: mismo cálculo (mismo requerimiento fiscal).

**Impacto operativo:**  
Si la fórmula está mal, todos los reportes de IVA están mal. Riesgo de auditoría fiscal.

**Limitaciones conocidas:**  
Sin contradicciones entre fuentes.

**Preguntas abiertas:**  
- Ninguna — patrón bien establecido.

---

## CJ-003 — Métodos de pago aceptados

```
ID:                CJ-003
Nombre:            Métodos de pago: efectivo, tarjeta crédito, débito, transferencia, UberEats
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  FIELD VERIFIED
Fuente:            CLAUDE.md (tabla wansoft_kpis — pago_metodos), FULLSITE-POS-OPERATIONAL-BIBLE.md
```

**Evidencia:**  
`pago_metodos` en `wansoft_daily` registra: Tarjeta de crédito, Tarjeta de débito, Efectivo, Transferencia electrónica, Ubereats.

**Problema operacional:**  
El sistema debe poder registrar el método de pago correcto — afecta tanto el reporte del día como la conciliación bancaria.

**Por qué existe:**  
Necesidad de reconciliación: el efectivo en caja + transacciones de tarjeta + transferencias debe igualar las ventas totales.

**Cuándo aplica:**  
En cada cobro. El cajero selecciona el método antes de confirmar el pago.

**Comportamiento observado:**  
En AMALAY: UberEats aparece como método de pago en Wansoft (no como canal separado). En Fullsite: delivery como canal + método de pago — los dos conceptos están separados (ver → DL-001 vs → DL-002).

**Impacto operativo:**  
La reconciliación de UberEats/Rappi debe cruzarse con los estados de cuenta de las plataformas — el POS registra el monto pero no verifica contra los depósitos de la plataforma.

**Limitaciones conocidas:**  
No hay evidencia de reconciliación automática contra estados de cuenta de plataformas de delivery.

**Preguntas abiertas:**  
- ¿Rappi también aparece como método de pago en AMALAY o solo UberEats?

---

## CJ-004 — Cobro mixto (efectivo + tarjeta en misma cuenta)

```
ID:                CJ-004
Nombre:            Cobro mixto (efectivo + tarjeta en misma cuenta)
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  INFERRED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (veredicto: INFERIOR en cobro)
```

**Evidencia:**  
El veredicto en FULLSITE-POS-OPERATIONAL-BIBLE.md clasifica el flujo de cobro como "INFERIOR" en comparación a Wansoft. Uno de los ítems mencionados es el cobro mixto. No hay descripción detallada del comportamiento.

**Problema operacional:**  
En restaurantes es común que una mesa quiera pagar parte en efectivo y parte en tarjeta. Si el sistema no soporta cobro mixto, el cajero debe hacer cálculos manuales.

**Por qué existe:**  
Necesidad operacional real: el cliente da $200 en efectivo y el resto con tarjeta.

**Cuándo aplica:**  
Frecuente en grupos con cuentas grandes (ej. $800+ MXN donde el cliente no quiere poner toda en tarjeta).

**Comportamiento observado:**  
En Wansoft: soportado (mencionado como ventaja). En Fullsite: comportamiento no confirmado. El veredicto "INFERIOR" sugiere que o no está implementado o tiene limitaciones.

**Impacto operativo:**  
Sin cobro mixto, el cajero puede pedir al cliente dividir el pago de otra manera — genera fricción en el checkout.

**Limitaciones conocidas:**  
Contradicción potencial: FULLSITE-POS-OPERATIONAL-BIBLE.md menciona cobro como inferior, pero FULLSITE-POS-BIBLE.md no lista limitaciones de cobro explícitamente.

**Preguntas abiertas:**  
- ¿Soporta Fullsite cobro mixto en una sola cuenta?
- → Ver → UNK-008

---

## CJ-005 — Propina capturada en POS — separada del total de venta

```
ID:                CJ-005
Nombre:            Propina capturada en POS — separada del total de venta
Categoría:         Caja
Clasificación:     SURPASS
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md, CLAUDE.md (wansoft_daily — propinas_total)
```

**Evidencia:**  
El POS tiene campo de propina en el flujo de cobro. La propina se registra por separado del total de venta. `wansoft_daily` tiene columna `propinas_total` y `propinas_meseros` (JSONB por mesero).

**Problema operacional:**  
Si la propina se mezcla con las ventas, el reporte de ventas queda inflado y la distribución de propinas entre meseros no puede calcularse.

**Por qué existe:**  
Dos razones: (1) fiscal — las propinas son ingreso de los trabajadores, no venta del restaurante; (2) operacional — el pool de propinas se distribuye entre el equipo.

**Cuándo aplica:**  
En cada cobro donde el cliente deja propina. La propina puede ser en efectivo (no siempre capturada en el sistema) o en tarjeta (siempre capturada).

**Comportamiento observado:**  
Fullsite captura propina en el POS. La propina en tarjeta queda registrada digitalmente. La propina en efectivo depende de que el cajero la registre manualmente.

**Impacto operativo:**  
El reporte `propinas_meseros` permite al gerente conocer cuánto generó cada mesero — base para el pool de propinas. Si la propina en efectivo no se registra, el reporte está incompleto.

**Limitaciones conocidas:**  
La propina en efectivo puede no registrarse si el cajero no lo hace manualmente.

**Preguntas abiertas:**  
- ¿El sistema obliga a registrar la propina en efectivo o es opcional?

---

## CJ-006 — Tip-out AMALAY: 5% a cocina

```
ID:                CJ-006
Nombre:            Tip-out AMALAY: 5% de propinas totales va a cocina
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (AMALAY config)
```

**Evidencia:**  
Documentado en la configuración real de AMALAY: el 5% del total de propinas va a un fondo para la cocina.

**Problema operacional:**  
El sistema debe calcular automáticamente el tip-out para que el gerente no tenga que hacerlo manualmente al cierre.

**Por qué existe:**  
Práctica común en restaurantes: la cocina no recibe propinas directamente (el cliente no interactúa con ellos), pero contribuye al servicio — el tip-out es la compensación.

**Cuándo aplica:**  
Al calcular el pool de propinas al cierre del turno.

**Comportamiento observado:**  
En AMALAY: manual o calculado por Wansoft — no queda claro. En Fullsite: el reporte `propinas_meseros` existe pero no hay evidencia de cálculo automático de tip-out.

**Impacto operativo:**  
Si el cálculo no es automático, el gerente divide propinas manualmente cada noche — fuente de errores y conflictos con el staff.

**Limitaciones conocidas:**  
El porcentaje de tip-out puede variar entre restaurantes. 5% es el valor de AMALAY — no necesariamente un estándar.

**Preguntas abiertas:**  
- ¿Fullsite calcula el tip-out automáticamente?
- → Ver → UNK-009

---

## CJ-007 — Corte Z: secuencial, irrepetible, requisito fiscal

```
ID:                CJ-007
Nombre:            Corte Z: secuencial, irrepetible, requisito fiscal
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md, FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
El Corte Z es el reporte de cierre del día. Es secuencial (Corte Z #1, #2, #3...) e irrepetible — una vez generado, no se puede "deshacer" ni generar de nuevo para el mismo período.

**Problema operacional:**  
Si el cajero genera el Corte Z por error (equivocado de día, impresora sin papel), el período queda cerrado fiscalmente aunque la operación continúe.

**Por qué existe:**  
Requerimiento del SAT: el corte Z es el comprobante de cierre de caja de un período fiscal. La numeración secuencial garantiza que no hay períodos no reportados.

**Cuándo aplica:**  
Al final del turno/día. Solo puede generarse una vez por período.

**Comportamiento observado:**  
En Wansoft: el corte Z se genera como parte del cierre de turno — el cajero no puede separar ambos. En Fullsite: separados (ver → OP-005). El número secuencial del corte Z se incrementa en la BD.

**Impacto operativo:**  
Una vez generado el Corte Z, el período está cerrado. Si hay errores, se necesita una nota de ajuste o corrección en el siguiente período — no se puede reabrir el corte.

**Limitaciones conocidas:**  
No hay evidencia de mecanismo de corrección post-corte en Fullsite. En Wansoft: tampoco.

**Preguntas abiertas:**  
- ¿Dónde se almacena el número secuencial del Corte Z en Fullsite?
- ¿Qué pasa si se genera el Corte Z antes de que todas las mesas paguen?

---

## CJ-008 — Corte X: acumulativo sin cierre

```
ID:                CJ-008
Nombre:            Corte X: acumulativo sin cierre — solo imprime reporte
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md
```

**Evidencia:**  
El Corte X es un reporte de estado actual — muestra las ventas acumuladas hasta el momento sin cerrar el turno. Se puede generar múltiples veces en el mismo turno.

**Problema operacional:**  
Sin Corte X, el gerente no puede consultar las ventas durante el día sin cerrar el turno.

**Por qué existe:**  
Monitoreo intraday: el dueño quiere saber "cómo vamos" a las 2pm sin cerrar la caja.

**Cuándo aplica:**  
Durante el día, cuando el gerente o dueño quiere revisar el estado de ventas.

**Comportamiento observado:**  
En Wansoft: Corte X disponible en cualquier momento. En Fullsite: equivalente en el dashboard — las métricas en tiempo real funcionan como un Corte X digital perpetuo.

**Impacto operativo:**  
Bajo en Fullsite porque el dashboard ya muestra el estado en tiempo real. En Wansoft, el Corte X imprime en papel — más útil para el gerente que no tiene acceso al dashboard digital.

**Limitaciones conocidas:**  
Bug documentado: el Corte X clasifica mal los pagos cuando hay split de turno (ver → EC-003).

**Preguntas abiertas:**  
- ¿El Corte X en Fullsite también tiene el bug de clasificación de pagos?

---

## CJ-009 — Wansoft: 5 tipos de corte

```
ID:                CJ-009
Nombre:            Wansoft tiene 5 tipos de corte (Z, X, Turno, Mesero, Global)
Categoría:         Caja
Clasificación:     WANSOFT-ONLY
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (sección Wansoft Avanzadas)
```

**Evidencia:**  
Wansoft implementa 5 tipos de corte: Z (cierre fiscal diario), X (estado actual sin cerrar), Turno (cierre de turno de cajero), Mesero (ventas por mesero en el período), Global (consolidado de todas las terminales).

**Problema operacional:**  
Sin corte por Mesero, el gerente no puede ver cuánto vendió cada mesero sin acceso al dashboard digital. Sin corte Global, un restaurante con múltiples cajas no puede obtener el total consolidado del día en papel.

**Por qué existe:**  
Necesidades de reporte específicas de cada rol: el dueño quiere el Global, el gerente quiere el Turno, el contador quiere el Z.

**Cuándo aplica:**  
Según el rol que genera el reporte. El Z al cierre del día. El Global al final con múltiples cajas.

**Comportamiento observado:**  
Los 5 tipos de Wansoft corresponden a 5 necesidades reales del negocio. En Fullsite: Z y X están documentados. Mesero y Global son equivalentes del dashboard digital pero sin impresión física.

**Impacto operativo:**  
Fullsite cubre Mesero y Global digitalmente — pero un restaurante que opera con menos tecnología (sin iPad del dueño) necesita los reportes en papel.

**Limitaciones conocidas:**  
Los 5 tipos de Wansoft implican 5 necesidades distintas — Fullsite no los tiene todos como impresiones físicas.

**Preguntas abiertas:**  
- ¿AMALAY imprime el Corte Global diariamente? ¿Quién lo consulta?

---

## CJ-010 — Cortesía máxima: CORTESIA_POR_PERSONA = $480 MXN

```
ID:                CJ-010
Nombre:            Cortesía máxima: CORTESIA_POR_PERSONA = $480 MXN
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  CODE VERIFIED
Fuente:            FULLSITE-POS-BIBLE.md (constante CORTESIA_POR_PERSONA)
```

**Evidencia:**  
`CORTESIA_POR_PERSONA = 480` como constante en el código. Limita la cortesía máxima que puede aplicarse por persona en la cuenta.

**Problema operacional:**  
Sin límite de cortesía, un mesero podría aplicar un 100% de descuento a una cuenta grande — fraude potencial.

**Por qué existe:**  
Control anti-fraude: las cortesías deben ser razonables. $480 por persona es aproximadamente el ticket promedio alto en AMALAY.

**Cuándo aplica:**  
Cuando el gerente o dueño aplica una cortesía a una cuenta.

**Comportamiento observado:**  
El sistema bloquea cortesías superiores al límite × número de personas en la mesa.

**Impacto operativo:**  
Protege contra abusos. El límite $480 es específico de AMALAY — en restaurantes más caros o más baratos, el límite sería incorrecto.

**Limitaciones conocidas:**  
El valor está hardcodeado — no configurable por cliente sin deploy. Ver → UNK-010

**Preguntas abiertas:**  
- ¿Qué pasa si la mesa tiene cortesía legítima superior al límite? ¿El gerente puede sobrepasar el límite?
- → Ver → UNK-010

---

## CJ-011 — Descuento requiere PIN de gerente

```
ID:                CJ-011
Nombre:            Descuento requiere PIN de autorización de gerente
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
Los descuentos requieren autorización por PIN de gerente. El mesero no puede aplicar descuentos sin autorización explícita.

**Problema operacional:**  
Sin control de descuentos, los meseros pueden usarlos para reducir cuentas de amigos o para acumular puntos de lealtad en programas externos.

**Por qué existe:**  
Control anti-fraude. En Wansoft: el sistema de permisos en dos pasos es aún más estricto (ver → MS-010).

**Cuándo aplica:**  
Cualquier descuento en la cuenta, incluyendo cortesías, descuentos por porcentaje, y descuentos por monto fijo.

**Comportamiento observado:**  
El POS solicita PIN de gerente antes de aplicar el descuento. El descuento queda registrado con el ID del gerente que autorizó.

**Impacto operativo:**  
El gerente necesita estar disponible o dejar su PIN con el cajero — lo que reduce la seguridad del control. En restaurantes muy concurridos, el gerente puede ser un cuello de botella.

**Limitaciones conocidas:**  
Si el gerente comparte su PIN, el control de descuentos pierde efectividad.

**Preguntas abiertas:**  
- ¿Se registra en el audit log qué gerente autorizó qué descuento?

---

## CJ-012 — Descuento por porcentaje vs. descuento por monto

```
ID:                CJ-012
Nombre:            Descuento por porcentaje vs. descuento por monto — dos flujos distintos
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  INFERRED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (inferido de la mención de tipos de descuento)
```

**Evidencia:**  
Las fuentes mencionan "descuentos" de manera general. No está documentado si hay dos flujos distintos (% vs monto fijo) o si es un único flujo.

**Problema operacional:**  
El cajero necesita saber cómo aplicar: "20% de descuento a estudiante" vs "quítale $50 MXN a la cuenta".

**Por qué existe:**  
Ambos tipos de descuento tienen casos de uso válidos: el descuento porcentual para promociones (10% lunes), el descuento por monto para cortesías parciales.

**Cuándo aplica:**  
En el flujo de cobro, antes de confirmar el pago.

**Comportamiento observado:**  
No verificado. INFERRED: ambos tipos existen (es estándar en POS de restaurantes).

**Impacto operativo:**  
Si solo existe un tipo, el cajero tiene que calcular el equivalente manualmente.

**Limitaciones conocidas:**  
Sin evidencia directa en fuentes.

**Preguntas abiertas:**  
- ¿Cuántos tipos de descuento soporta el POS de Fullsite?
- → Ver → UNK-011

---

## CJ-013 — Cancelación de ítem vs cancelación de cuenta completa

```
ID:                CJ-013
Nombre:            Cancelación de ítem vs cancelación de cuenta completa
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md, BREAK-THE-RESTAURANT.md
```

**Evidencia:**  
El sistema distingue dos tipos de cancelación: (1) cancelar un ítem específico de la cuenta (el resto de la cuenta continúa), (2) cancelar la cuenta completa (toda la mesa).

**Problema operacional:**  
Si se cancela un ítem que ya fue enviado a cocina, la cocina debe ser notificada — si no, preparan algo que ya no se necesita (desperdicio + confusión).

**Por qué existe:**  
Dos necesidades distintas: el cliente cambió de opinión sobre un plato específico vs. el grupo decidió irse sin comer.

**Cuándo aplica:**  
Durante el servicio, antes o después de que el ítem llegue a cocina.

**Comportamiento observado:**  
En Fullsite: cancelación de ítem registrada. Pero KDS no notifica a cocina sobre cancelaciones (ver → EC-005 — Trust Issue en BREAK-THE-RESTAURANT.md). La cancelación de cuenta completa requiere PIN de gerente.

**Impacto operativo:**  
Si la cocina no sabe que un ítem fue cancelado, lo prepara de todas formas — desperdicio. La cancelación de cuenta tiene mayor impacto fiscal (toda la venta se reversa).

**Limitaciones conocidas:**  
KDS no notifica cancelaciones — la cocina depende de que el mesero vaya físicamente a informar.

**Preguntas abiertas:**  
- ¿Hay plan para agregar notificación de cancelación en KDS?

---

## CJ-014 — Cancelación post-cobro — flujo de devolución separado

```
ID:                CJ-014
Nombre:            Cancelación post-cobro requiere flujo de devolución separado
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  INFERRED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md (mención de devoluciones en wansoft_daily)
```

**Evidencia:**  
`wansoft_daily` tiene columna `devoluciones`. Esto implica que las cancelaciones post-cobro existen como categoría separada. No hay documentación del flujo en Fullsite.

**Problema operacional:**  
Un cliente ya pagó y quiere devolución (comida incorrecta, mala experiencia). El sistema debe revertir el cobro sin reabrir el turno cerrado.

**Por qué existe:**  
Las devoluciones son una realidad operacional. El SAT las trata diferente a una venta ordinaria — requieren nota de crédito.

**Cuándo aplica:**  
Post-cobro, puede ser mismo día o días después (si el cliente regresa).

**Comportamiento observado:**  
No documentado en Fullsite. En Wansoft: registrado como `devoluciones` en el reporte diario.

**Impacto operativo:**  
Sin flujo de devolución, el cajero debe procesar el reembolso por fuera del sistema — pierde trazabilidad.

**Limitaciones conocidas:**  
Sin evidencia de implementación en Fullsite.

**Preguntas abiertas:**  
- ¿Fullsite tiene flujo de devolución post-cobro?
- → Ver → UNK-012

---

## CJ-015 — Corte X clasifica mal pagos al cruzar turnos (bug)

```
ID:                CJ-015
Nombre:            Corte X clasifica mal pagos cuando hay split de turno (bug conocido)
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  DOCUMENTED
Fuente:            BREAK-THE-RESTAURANT.md (Trust Issue #1)
```

**Evidencia:**  
BREAK-THE-RESTAURANT.md documenta como Trust Issue #1: "Corte X payment classification bug". Ocurre cuando hay división de turnos en el mismo período.

**Problema operacional:**  
Los métodos de pago en el Corte X aparecen en las categorías incorrectas — efectivo donde debería ser tarjeta, o viceversa. Esto corrompe la reconciliación de caja.

**Por qué existe:**  
Bug de implementación — el query de clasificación de pagos no maneja correctamente el cruce de turnos.

**Cuándo aplica:**  
Cuando hay múltiples turnos en el mismo día o cuando una cuenta cruza el límite de un turno (abierta en turno 1, cobrada en turno 2).

**Comportamiento observado:**  
El bug está documentado pero sin estado de resolución en las fuentes consultadas.

**Impacto operativo:**  
Medio: el total de ventas es correcto, pero el desglose por método de pago es incorrecto. El cajero no puede reconciliar correctamente el efectivo.

**Limitaciones conocidas:**  
Sin fecha de fix documentada.

**Preguntas abiertas:**  
- ¿Este bug fue corregido post-BREAK-THE-RESTAURANT.md?
- → Ver → UNK-013

---

## CJ-016 — Diferencia de caja: efectivo recibido − efectivo esperado

```
ID:                CJ-016
Nombre:            Efectivo recibido − efectivo esperado = diferencia de caja
Categoría:         Caja
Clasificación:     MATCH
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md, CAJA-SPEC.md
```

**Evidencia:**  
Al cierre: el cajero cuenta el efectivo físico en caja, ingresa el monto, y el sistema calcula la diferencia contra lo esperado (ventas en efectivo + fondo inicial − retiros de caja).

**Problema operacional:**  
Sin conteo físico, no hay forma de saber si hubo robo, error de cambio, o error de registro.

**Por qué existe:**  
Control fundamental de caja en cualquier negocio. La diferencia de caja es el KPI de honestidad del cajero.

**Cuándo aplica:**  
Al cierre del turno, antes de generar el Corte Z.

**Comportamiento observado:**  
En Wansoft: flujo estándar. En Fullsite: documentado como parte del cierre de turno.

**Impacto operativo:**  
Una diferencia de caja consistente (siempre faltante, siempre el mismo cajero) es señal de fraude. El sistema registra la diferencia — el gerente analiza.

**Limitaciones conocidas:**  
La diferencia de caja no genera alerta automática en el sistema — el gerente debe revisar manualmente.

**Preguntas abiertas:**  
- ¿El agente antifraud_agent.py detecta diferencias de caja consistentes?

---

## CJ-017 — CFDI 4.0: facturación post-cobro

```
ID:                CJ-017
Nombre:            CFDI 4.0: RFC del cliente, uso de CFDI, método de pago — post-cobro
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md, memory (project_facturacion_pac.md)
```

**Evidencia:**  
Facturama elegido como PAC para CFDI 4.0. RFC AMALAY: AFO200806JI0. QR en ticket para autoservicio de facturación. Andy tramitó CSD.

**Problema operacional:**  
El cliente B2B necesita factura del SAT (CFDI) para deducir el gasto. Sin CFDI, AMALAY pierde clientes corporativos.

**Por qué existe:**  
Requerimiento fiscal mexicano para clientes que necesitan deducir gastos de representación o empresariales.

**Cuándo aplica:**  
Cuando el cliente solicita factura — puede ser en el momento del cobro o después (hasta el último día del mes fiscal).

**Comportamiento observado:**  
El flujo es post-cobro: el ticket tiene un QR que lleva al cliente a un portal de autoservicio donde ingresa su RFC y obtiene la factura. En el POS también existe el flujo manual donde el cajero captura los datos.

**Impacto operativo:**  
Sin CFDI, el restaurante no puede atender clientes corporativos. Con CFDI automatizado via QR, se reduce la carga del cajero.

**Limitaciones conocidas:**  
Si el CSD expira, las facturas no se pueden emitir (y el restaurante no puede reexpedirlas retroactivamente).

**Preguntas abiertas:**  
- ¿Está el flujo de facturación CFDI completamente operativo en AMALAY?
- ¿El QR en ticket ya está funcionando?

---

## CJ-018 — Terminal MP Point: cobro separado del POS

```
ID:                CJ-018
Nombre:            Terminal MP Point: cobro separado del POS — sin integración directa
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  FIELD VERIFIED
Fuente:            FULLSITE-POS-OPERATIONAL-BIBLE.md (AMALAY config), memory (project_terminal_integration.md)
```

**Evidencia:**  
AMALAY usa Mercado Pago Point para cobros con tarjeta. El flujo actual no está integrado directamente al POS — el cajero ingresa el monto manualmente en la terminal.

**Problema operacional:**  
Sin integración, hay riesgo de que el cajero ingrese el monto incorrecto en la terminal (diferente al de la cuenta del POS). Esto causa diferencias de caja que se atribuyen erróneamente a fraude.

**Por qué existe:**  
La integración entre POS y terminal de cobro es compleja: requiere SDK del proveedor, certificación del protocolo, y manejo de estados (timeout, declined, retry).

**Cuándo aplica:**  
En cada cobro con tarjeta.

**Comportamiento observado:**  
Flujo actual: POS muestra total → cajero ingresa monto en MP Point manualmente → cliente paga → cajero confirma en POS. Sin handshake digital entre sistemas.

**Impacto operativo:**  
Error humano frecuente: monto incorrecto en la terminal. El cajero puede cobrar $350 cuando la cuenta es $530 — la diferencia queda sin registrar.

**Limitaciones conocidas:**  
La integración MP Point API está documentada como feature pendiente. Ver memory (project_terminal_integration.md).

**Preguntas abiertas:**  
- ¿Cuándo se implementará la integración directa con MP Point?
- ¿Qué tan frecuentes son los errores de monto en la operación actual de AMALAY?

---

## CJ-019 — Facturación QR en ticket para autoservicio

```
ID:                CJ-019
Nombre:            Facturación QR en ticket para autoservicio CFDI
Categoría:         Caja
Clasificación:     UNKNOWN
Estado evidencia:  DOCUMENTED
Fuente:            FULLSITE-OPERATIONS-BIBLE.md
```

**Evidencia:**  
El ticket impreso incluye un código QR que el cliente puede escanear para obtener su factura CFDI sin intervención del cajero.

**Problema operacional:**  
Sin el QR, el cliente tiene que pedirle al cajero que haga la factura — genera una cola y distrae al cajero de otras operaciones.

**Por qué existe:**  
Reducir la carga del cajero y mejorar la experiencia del cliente. El QR empodera al cliente para obtener su factura en cualquier momento.

**Cuándo aplica:**  
En cada ticket impreso donde el restaurante quiera ofrecer facturación automatizada.

**Comportamiento observado:**  
Documentado pero sin verificación de campo de que el QR funcione end-to-end en AMALAY.

**Impacto operativo:**  
Alto para clientes corporativos. Si el QR falla (link roto, portal caído), el cliente queda sin factura y el restaurante pierde la venta B2B.

**Limitaciones conocidas:**  
Depende de que el portal de autoservicio esté disponible en el momento en que el cliente escanea (puede ser horas o días después del cobro).

**Preguntas abiertas:**  
- ¿El QR está funcionando en producción en AMALAY?
- ¿Cuánto tiempo es válido el QR? ¿Expira al mes?

# PLAYBOOK — Cómo Escalar Fullsite

> No es un manual de instalación. Es el sistema operativo para desplegar Fullsite
> en un restaurante nuevo, del primer contacto a la operación autónoma.
> Dueño: Daniel Ramonfaur. Evoluciona con cada restaurante nuevo.
> Versión: 0.1 (basada en AMALAY — un solo restaurante)
> Última actualización: 2026-07-02

---

## Filosofía

**El objetivo no es que Fullsite funcione en el restaurante.**
El objetivo es que el restaurante no quiera regresar a su sistema anterior después de 2 semanas.

El playbook no reemplaza al equipo. Le da estructura para que el equipo pueda operar
sin depender de quien instaló el primer restaurante.

**Versiones:** Este documento evoluciona. v0.1 captura lo aprendido de AMALAY.
v1.0 se escribirá después del restaurante #2 cuando haya un proceso validado dos veces.
v2.0 después del restaurante #5. Cada versión mayor requiere evidencia de ejecución, no de diseño.

---

## Las 9 etapas

```
1. Discovery
2. Pre-Onboarding
3. Instalación
4. Configuración
5. Validación
6. Shadow Day
7. Go Live
8. Hypercare
9. Operación Estable
```

Cada etapa tiene una **puerta de salida**: criterios mínimos que deben cumplirse
antes de avanzar a la siguiente. No hay excepciones a las puertas. Si algo bloquea,
se resuelve antes de continuar.

---

## Etapa 1 — Discovery

**Objetivo:** Determinar si el restaurante es un buen candidato para Fullsite y si
podemos instalarlo exitosamente.

### Checklist

- [ ] Entrevista con el dueño o gerente (30-45 min)
- [ ] Identificar el POS actual y versión
- [ ] Estimar volumen: tickets/día, mesas, staff
- [ ] Evaluar infraestructura: WiFi, terminales disponibles, impresoras
- [ ] Identificar integraciones críticas: delivery, facturación, contabilidad
- [ ] Mapear el proceso de toma de decisiones: ¿quién decide cambiar el POS?
- [ ] Identificar el pain point principal que Wansoft/sistema actual no resuelve
- [ ] Evaluar disposición al cambio del staff y gerencia

### Evaluación del candidato (ICP scoring)

| Criterio | Peso | Score 1-5 | Notas |
|---|---|---|---|
| Volumen (>100 tickets/día) | 20% | | |
| Dolor con sistema actual | 25% | | |
| Dueño / gerente tech-friendly | 20% | | |
| Infraestructura básica disponible | 15% | | |
| Disposición al cambio | 20% | | |
| **Total ponderado** | 100% | | |

**Score mínimo para avanzar: 3.5/5.0**

### Evidencia requerida para avanzar
- ICP score ≥ 3.5
- Decisión de avanzar confirmada por el responsable del restaurante (no solo por el gerente de turno)
- Fecha tentativa de instalación acordada

### Criterios de éxito
- Entendemos exactamente qué problema le estamos resolviendo a este restaurante.
- Sabemos cuánto tiempo tomará la instalación con la infraestructura actual.
- El restaurante sabe qué esperar y cuándo.

### Riesgos
- Decisor real no está en la conversación → escalar antes de invertir tiempo
- Infraestructura mínima ausente (WiFi, terminales) → definir si Fullsite provee o el cliente
- Resistencia al cambio del staff → plan de capacitación requerido antes del Shadow Day

### Rollback
No aplica — esta etapa es evaluativa.

---

## Etapa 2 — Pre-Onboarding

**Objetivo:** Tener todo listo técnica y operativamente antes de instalar en el restaurante.

### Checklist técnico

- [ ] Bridge instalado y probado localmente
- [ ] Credenciales del POS actual (Wansoft u otro) obtenidas
- [ ] IP de impresoras mapeadas (TCP) o puertos USB identificados
- [ ] WiFi speed test en el restaurante (mínimo 10 Mbps estables)
- [ ] Supabase tenant creado para el restaurante
- [ ] RLS configurado para el nuevo tenant
- [ ] Catálogo importado del sistema anterior (o foto del menú para import por IA)
- [ ] Roles creados (gerente, cajero, mesero, cocina)
- [ ] PINs asignados para staff clave

### Checklist operativo

- [ ] Playbook de capacitación compartido con gerente
- [ ] Fecha de Shadow Day acordada (con al menos 7 días de anticipación)
- [ ] Contingencia definida si el sistema falla (plan de rollback al POS anterior)
- [ ] Hardware verificado: terminales, impresoras, cajón, lector huella si aplica
- [ ] Configuración fiscal: RFC, régimen, series de factura, certificados SAT

### Evidencia requerida para avanzar
- Bridge instalado y conectado a Supabase del restaurante
- Catálogo completo importado (100% de productos con precio y categoría)
- Al menos 1 vuelta completa de flujo POS→KDS→cocina probada en ambiente del restaurante

### Criterios de éxito
- Un orden puede crearse, enviarse a cocina, cobrarse e imprimirse sin intervención técnica.
- El gerente conoce el sistema básico (no lo domina — solo lo conoce).

### Riesgos
- Catálogo incompleto → bloquea toda la operación desde el día 1
- WiFi inestable → test en hora pico, no en horario de oficina
- Staff clave de vacaciones durante la instalación → reprogramar

### Rollback
Si algo crítico falla en pre-onboarding: posponer instalación hasta resolver.
No entrar al restaurante sin los criterios de esta etapa cumplidos.

---

## Etapa 3 — Instalación

**Objetivo:** Fullsite corriendo en las terminales del restaurante con impresoras funcionando.

### Checklist

- [ ] Dashboard accesible en cada terminal del restaurante
- [ ] Bridge corriendo en el equipo host (laptop/PC dedicado)
- [ ] Impresora de caja: imprime ticket de prueba ✅
- [ ] Impresora de cocina: imprime comanda de prueba ✅
- [ ] Impresora de barra (si aplica): imprime de prueba ✅
- [ ] Cajón de dinero: abre al imprimir ticket de caja ✅
- [ ] KDS: muestra orden de prueba en display correcto ✅
- [ ] Login con PIN funciona para todos los roles
- [ ] Event Store recibiendo eventos desde el bridge
- [ ] Latencia bridge → Supabase: < 2 segundos en condiciones normales

### Evidencia requerida para avanzar
- Orden completa de prueba: crear → enviar → cocina → cobrar → imprimir → cerrar
- Todas las impresoras imprimen sin intervención técnica
- Bridge uptime: 1 hora continua sin intervención

### Criterios de éxito
- El gerente puede crear y cobrar una orden sin ayuda de Daniel.
- Todas las estaciones de impresión funcionan.

### Riesgos
- Impresora TCP no detectada (IP incorrecta) → mapear IPs antes de la instalación
- Terminal lenta → PWA en Chrome, no en Safari ni Edge
- Cajón no abre → verificar cable RJ-11 y comando EC TICKET

### Rollback
Si las impresoras no funcionan después de 2 horas de diagnóstico: posponer Shadow Day.
El sistema puede operar sin cajón electrónico (apertura manual), pero no sin impresoras de cocina.

---

## Etapa 4 — Configuración

**Objetivo:** El sistema refleja exactamente cómo opera el restaurante: layout, permisos, routing, recetas.

### Checklist

- [ ] Layout de mesas: zonas, números, capacidad
- [ ] Routing de impresoras: qué producto va a qué estación
- [ ] Modificadores configurados: sin cebolla, extra salsa, etc.
- [ ] Cursos configurados: entrada, plato fuerte, postre
- [ ] Permisos por rol: qué puede hacer cada rol y qué no
- [ ] Descuentos configurados: tipos, porcentajes, quién los aprueba
- [ ] Razones de cancelación predefinidas
- [ ] Métodos de pago habilitados: efectivo, tarjeta, transferencia, delivery
- [ ] Configuración fiscal: tasas, productos con IEPS si aplica
- [ ] Recetas básicas configuradas (si hay inventario activo)

### Evidencia requerida para avanzar
- Gerente puede configurar una mesa nueva sin ayuda
- Un mesero puede tomar una orden con modificadores y enviarla a la estación correcta
- Un descuento de gerente requiere PIN y queda registrado en audit log

### Criterios de éxito
- Un turno completo de simulación pasa la prueba del viernes a las 8pm.
- El gerente puede resolver una situación de emergencia (mesa transfer, cortesía, reimpresión) sin llamar a Daniel.

### Riesgos
- Configuración de routing incorrecta → bebidas van a cocina, comida va a barra
- Permisos mal configurados → mesero puede hacer descuentos sin autorización
- Recetas no vinculadas → food cost no deduce correctamente

### Rollback
Ningún cambio de configuración en producción durante hora pico.
Todos los cambios de configuración: antes de abrir o después de cerrar.

---

## Etapa 5 — Validación

**Objetivo:** Probar todos los flujos críticos en el ambiente del restaurante antes del Shadow Day.

### Flujos que deben probarse (happy path + variantes)

| Flujo | Happy Path | Variantes a probar |
|---|---|---|
| Orden completa | Mesa → orden → cocina → cobro → cierre | Con modificadores, con silla asignada, con curso |
| Pago | Efectivo | Tarjeta, mixto, split entre personas |
| Cancelación | Item cancelado con razón | Orden completa cancelada, cancelación post-cobro |
| Descuento | Descuento gerente con PIN | Cortesía, descuento porcentual, 2x1 |
| Modificación post-envío | Item agregado después de enviar a cocina | Comanda de actualización |
| Transfer de mesa | Mesa cambiada | Transfer a mesero diferente |
| Reimpresión | Reimpresión de ticket | Reimpresión de comanda cocina |
| Turno | Abrir turno con fondo | Depósito, retiro, cierre con arqueo |
| Offline | Orden creada sin internet | Sync al reconectar |
| Impresora | Impresora disponible | Impresora desconectada (fallback y retry) |

### Evidencia requerida para avanzar
- Los 10 flujos de la tabla probados y documentados
- Cero errores críticos (P0/P1) sin resolución
- Reconciliación de prueba: datos Fullsite = datos del sistema anterior

### Criterios de éxito
- El gerente puede manejar cualquier situación del turno sin llamar a Daniel.
- El sistema se recupera solo ante fallas de impresora o internet.

### Riesgos
- Flujos especiales del restaurante no mapeados → preguntar al gerente "¿qué hacen diferente?"
- Staff no practica antes del Shadow Day → capacitación mínima requerida antes de esta etapa

### Rollback
Si hay un bug P0 en validación: no avanzar a Shadow Day hasta resolverlo.
Bug P0 = el restaurante no puede operar (pierde órdenes, falla en cobro).

---

## Etapa 6 — Shadow Day

**Objetivo:** Fullsite y el sistema anterior corren en paralelo durante un turno real.
Demostrar que los datos de Fullsite = los datos del sistema anterior.

### Checklist pre-Shadow Day

- [ ] Staff principal capacitado (no experto, pero puede operar)
- [ ] Bridge conectado al sistema anterior (Wansoft u otro) y validado
- [ ] Plan de contingencia comunicado al staff ("si algo falla, seguimos con el sistema de siempre")
- [ ] Cuaderno físico para anotar timestamps de eventos importantes
- [ ] Baseline capturado: tickets y ventas al inicio del turno en el sistema anterior

### Durante el Shadow Day

Observar y documentar para cada hora del turno:
- Uptime del bridge: ¿reconexiones? ¿intervención manual?
- Spot check cada 30 min: tickets Fullsite vs sistema anterior
- Dependencias del founder: cada vez que alguien busca a Daniel
- Fricciones: qué causa confusion o resistencia en el staff
- Product Moments: si el gerente toma alguna decisión basada en Fullsite

### Reconciliación final

| Métrica | Sistema anterior | Fullsite | Delta | Estado |
|---|---|---|---|---|
| Tickets del turno | | | | |
| Total ventas MXN | | | | |
| Cancelaciones | | | | |
| Descuentos | | | | |

Spot check de 10 tickets aleatorios: ¿mismo número de items? ¿mismo total? ¿mismo timestamp (±30s)?

### Evidencia requerida para avanzar a Go Live

- [ ] Bridge: 4+ horas de uptime sin intervención
- [ ] Tickets: 0% discrepancia vs sistema anterior
- [ ] Ventas: <0.1% discrepancia vs sistema anterior
- [ ] Al menos 1 cancelación y 1 modificación capturadas y verificadas
- [ ] 0 errores críticos (P0) en hora pico
- [ ] KDS funcionando: ninguna orden llegó a cocina antes de aparecer en KDS
- [ ] Dashboard accesible durante todo el turno

**Si cualquier criterio falla → no avanzar a Go Live. Resolver y repetir Shadow Day.**

### Criterios de éxito
- Alguien podría haber operado el restaurante con Fullsite como único sistema.
- El gerente tomó al menos 1 decisión diferente porque vio algo en el dashboard.

### Riesgos
- Bridge inestable → investigar causa raíz antes del Go Live
- Discrepancia de datos → identificar exactamente qué evento no llegó y por qué
- Staff resiste usar Fullsite → capacitación adicional antes del Go Live

### Rollback
El sistema anterior sigue siendo la fuente de verdad durante Shadow Day.
Si el staff necesita el sistema anterior para operar, lo usan. Shadow Day no tiene rollback —
Fullsite es adicional, no sustituto todavía.

---

## Etapa 7 — Go Live

**Objetivo:** Fullsite se convierte en el único sistema de punto de venta del restaurante.
El sistema anterior deja de usarse para nuevas operaciones.

### Checklist pre-Go Live

- [ ] Todos los criterios del Shadow Day cumplidos
- [ ] Backup del sistema anterior disponible si es necesario revertir
- [ ] Staff informado de la fecha y qué cambia
- [ ] Contingencia de rollback definida y comunicada
- [ ] Número de contacto de soporte Fullsite disponible para todo el staff
- [ ] Dashboard de monitoring activo para Daniel durante las primeras 48h

### Día del cutover

1. **Abrir turno por última vez en sistema anterior** — capturar totales finales
2. **Cerrar turno en sistema anterior** — exportar/fotografiar reporte de cierre
3. **Abrir primer turno en Fullsite** — con fondo inicial correcto
4. **Verificar bridge → Event Store** en los primeros 5 tickets
5. **Primer hora: Daniel presente o conectado** para resolución inmediata de problemas

### Evidencia requerida para declarar Go Live exitoso

- Primer turno completo en Fullsite: apertura → operación → cierre → arqueo
- Corte de caja Fullsite coincide con el efectivo real en caja
- Todos los tickets impresos correctamente en todas las estaciones
- Event Store capturando todos los eventos del primer turno

### Criterios de éxito
- El restaurante abrió y cerró con Fullsite como único sistema.
- No hubo ningún incidente P0.
- El gerente no quiere regresar al sistema anterior.

### Riesgos
- Problema crítico en las primeras horas → rollback al sistema anterior para terminar el turno
- Staff olvida el flujo nuevo bajo presión → Daniel o soporte disponible para ese turno
- Impresora falla en hora pico → protocolo de fallback (reimpresión manual)

### Rollback
Si hay un P0 en las primeras 2 horas y no se puede resolver en 15 minutos:
reactivar sistema anterior para terminar el turno, investigar causa raíz, hacer nuevo Go Live
cuando el problema esté resuelto. **No dejar el restaurante sin sistema de cobro.**

---

## Etapa 8 — Hypercare

**Duración:** 4 semanas post-Go Live

**Objetivo:** El restaurante opera con Fullsite sin incidentes críticos. El equipo
aprende en producción real y las fricciones se resuelven rápidamente.

### Semana 1 (días 1-7)

- Check-in diario con el gerente: ¿qué funcionó? ¿qué no?
- Resolución de bugs en < 24 horas para P0/P1
- Monitoring activo del bridge y event store
- Documentar cada fricción en AMALAY-LOG.md

### Semana 2 (días 8-14)

- Check-in cada 2 días
- Resolución de bugs en < 48 horas para P1
- Primera revisión de métricas: ventas Fullsite vs período anterior en Wansoft
- Identificar workarounds que el staff sigue usando → convertirlos en features o capacitación

### Semanas 3-4 (días 15-28)

- Check-in semanal
- Primera entrevista formal de feedback con gerente y 1-2 meseros
- Identificar el primer "nadie quiere regresar a Wansoft" moment
- Preparar case study de AMALAY para usar en ventas del restaurante #2

### Evidencia requerida para declarar Hypercare completo

- 0 incidentes P0 en las últimas 2 semanas
- Gerente opera el sistema autónomamente (sin llamar a Daniel)
- Métricas del restaurante no han empeorado (ventas, tiempo de servicio, quejas de clientes)
- Al menos 1 insight accionable generado por Fullsite que Wansoft no podría haber dado

### Criterios de éxito
El restaurante no quiere regresar al sistema anterior.

### Riesgos
- Bug recurrente que no se puede resolver remotamente → visita presencial obligatoria
- Gerente cambia durante Hypercare → plan de transición y recapacitación
- Mes con bajo volumen → el Hypercare puede parecer exitoso pero no haber sido probado bajo carga

---

## Etapa 9 — Operación Estable

**Objetivo:** El restaurante opera autónomamente. Fullsite genera inteligencia accionable.

### Cadencia de operación estable

| Frecuencia | Actividad |
|---|---|
| Diario (automático) | Briefing matutino via Telegram / Dashboard |
| Semanal | Reporte semanal automático: KPIs, anomalías, insights |
| Mensual | Revisión de métricas: food cost, ventas, fraude, eficiencia |
| Trimestral | Business review con dueño: cómo evolucionó la operación |

### Señales de que la operación está estable

- El gerente consulta el dashboard sin que nadie le pida que lo haga
- Al menos 1 decisión por semana se toma diferente porque Fullsite existe
- El dueño puede ver el estado del restaurante desde su celular en tiempo real
- Los agentes de IA detectaron al menos 1 anomalía real en el último mes

### Evidencia para el caso de expansión (restaurante #2)

Cuando AMALAY está en Operación Estable, tenemos:
- Playbook validado en producción (este documento, v1.0)
- Caso de estudio documentado (AMALAY-LOG.md)
- Métricas reales de onboarding: tiempo por etapa, recursos requeridos, fricciones encontradas
- Una persona (el gerente de AMALAY) que puede dar referencia a restaurante #2

---

## Métricas del Playbook

Llevar estas métricas para cada restaurante para mejorar el playbook:

| Métrica | AMALAY | R2 | R3 | Objetivo |
|---|---|---|---|---|
| Tiempo Discovery → Shadow Day | | | | < 2 semanas |
| Tiempo Shadow Day → Go Live | | | | < 1 semana |
| Incidentes P0 en Go Live | | | | 0 |
| Tiempo de Hypercare efectivo | | | | < 4 semanas |
| NPS del gerente al mes 1 | | | | > 8/10 |
| "Nadie quiere regresar" momento | | | | < 2 semanas post-Go Live |

---

## Log de versiones

| Versión | Fecha | Qué cambió |
|---|---|---|
| v0.1 | 2026-07-02 | Versión inicial basada en experiencia de AMALAY (pre-Go Live) |
| v1.0 | [pendiente] | Actualizar después del Go Live de AMALAY con lo que faltó en este playbook |
| v2.0 | [pendiente] | Actualizar después del restaurante #2 cuando haya proceso validado dos veces |

---

> Este es el documento que convierte AMALAY en el restaurante #1 de una empresa de 100.
> No es una lista de pasos — es el conocimiento operativo de cómo escalamos.
> Actualizarlo es parte del trabajo, no un entregable administrativo.
>
> Fullsite — Restaurant Operating System

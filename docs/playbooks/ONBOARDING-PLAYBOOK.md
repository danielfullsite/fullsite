# FULLSITE — Onboarding Playbook

> Documento vivo. Ultima actualizacion: 2026-07-07.
> Objetivo: de firma a operacion completa en 7 dias. Que nadie quiera regresar a su POS anterior despues de 14 dias.

---

## 1. Pre-implementacion (antes de ir al restaurante)

### 1A. Checklist de informacion a recolectar

Enviar este formulario por WhatsApp o correo al menos 3 dias antes de la instalacion.

| # | Dato | Ejemplo | Obligatorio |
|---|------|---------|:-----------:|
| 1 | Nombre del restaurante | AMALAY Coffee & Market | Si |
| 2 | Razon social | Grupo Gastro del Norte SA de CV | Si |
| 3 | RFC | GGN2106153A1 | Si (para CFDI) |
| 4 | Regimen fiscal | 601 - General de Ley | Si |
| 5 | Domicilio fiscal | Av. Vasconcelos 1234, San Pedro | Si |
| 6 | Codigo postal | 66260 | Si |
| 7 | Nombre del dueño | Juan Perez | Si |
| 8 | Telefono del dueño (WhatsApp) | +52 81 1234 5678 | Si |
| 9 | Email del dueño | juan@restaurante.com | Si |
| 10 | Nombre del gerente | Eduardo Lopez | Si |
| 11 | Telefono del gerente (WhatsApp) | +52 81 8765 4321 | Si |
| 12 | Direccion del restaurante | Calzada del Valle 400, San Pedro | Si |
| 13 | Numero de sucursales | 1 | Si |
| 14 | Horario de operacion | 7am - 11pm L-D | Si |
| 15 | Hora muerta (mejor hora para instalar) | 3pm - 5pm | Si |
| 16 | POS actual | Wansoft | Si |
| 17 | Numero de terminales/cajas | 3 | Si |
| 18 | Numero de impresoras | 4 (caja, cocina, barra, market) | Si |
| 19 | Tipo de conexion impresoras | USB / TCP-IP / Ambas | Si |
| 20 | Tiene lector de huella digital? | Si — modelo HID | Si |
| 21 | Numero de meseros | 12 | Si |
| 22 | Numero de cajeros | 2 | Si |
| 23 | Numero de cocineros | 8 | Si |
| 24 | Numero total de empleados | 40 | Si |
| 25 | Estaciones de cocina | Cocina caliente, fria, barra, panaderia | Si |
| 26 | Numero de items en menu | ~200 | Si |
| 27 | Numero de categorias de menu | ~25 | Si |
| 28 | Manejan modificadores? | Si | Si |
| 29 | Metodos de pago | Efectivo, TDC, TDD, transferencia | Si |
| 30 | Plataformas de delivery | Rappi, Uber Eats | No |
| 31 | Sistema de facturacion actual | Facturama / CONTPAQi | No |
| 32 | Contador (nombre y contacto) | Andy — andy@contaduría.com | No |
| 33 | Internet disponible | Si — fibra 100mbps | Si |
| 34 | Red WiFi (nombre y password) | "Restaurante_Staff" / password123 | Si |

### 1B. Cuestionario del perfil del restaurante

Estas preguntas ayudan a configurar correctamente el sistema:

1. Cuantas mesas tiene el restaurante? Distribucion por zona (interior, terraza, jardin, barra).
2. Manejan turnos? Cuantos y a que horas rotan?
3. Tienen market/tienda ademas del restaurante?
4. Manejan eventos/reservaciones?
5. Tienen recetas documentadas? En que formato (Excel, papel, nada)?
6. Como manejan propinas hoy? (Incluidas en cuenta, separadas, en efectivo)
7. Quien autoriza descuentos? Que tipos de descuento manejan?
8. Manejan cortesias? Quien las autoriza?
9. Tienen programa de lealtad o puntos?
10. Necesitan facturar individualmente a clientes?

### 1C. Plan de migracion de datos

| Dato | Fuente | Metodo | Responsable | Tiempo estimado |
|------|--------|--------|-------------|:---------------:|
| Menu completo (items, precios, categorias, modificadores) | Export POS actual o menu PDF | Script de importacion / ingreso manual | Fullsite | 2-4 horas |
| Staff (nombres, roles, puestos) | Lista del gerente | Import CSV | Fullsite | 30 min |
| Metodos de pago | Configuracion actual | Configuracion manual | Fullsite | 15 min |
| Planograma de mesas | Visita al restaurante / foto | Dibujo en sistema | Fullsite | 30 min |
| Recetas (si existen) | Excel del chef / documentos | Import o ingreso manual | Fullsite + Chef | 2-8 horas |
| Clientes frecuentes | Base de datos actual | Import CSV | Fullsite | 1 hora |
| Historial de ventas | No se migra | — | — | — |

**Regla: siempre generar Migration Diff Report antes del cutover.** Comparar menu importado vs menu original item por item. No asumir que la importacion fue perfecta.

### 1D. Auditoria de hardware

Visita previa o fotos del restaurante (via WhatsApp):

| Equipo | Que verificar | Accion si falta |
|--------|--------------|-----------------|
| Computadora/terminal | Windows 10+, 4GB RAM, SSD | Recomendar terminal (presupuesto: $8-15K) |
| Impresora termica de caja | Modelo, conexion (USB/TCP) | Llevar impresora de respaldo pre-configurada |
| Impresoras de cocina | Cantidad, ubicacion, conexion | Verificar IPs si son TCP |
| Lector de huella digital | Modelo (HID compatible) | Llevar lector HID de respaldo |
| Cajon de dinero | Conexion (RJ-11 a impresora) | Verificar compatibilidad |
| Red WiFi | Velocidad, estabilidad, cobertura en cocina | Recomendar access point si es necesario |
| Pantalla tactil (si aplica) | Tamaño, calibracion | Verificar touch funciona con Fullsite |

---

## 2. Dia de implementacion

### 2A. Horario hora por hora

**Dia ideal: lunes a miercoles, entre comida y cena (2pm - 6pm).**

| Hora | Actividad | Duracion | Quien presente |
|------|-----------|:--------:|----------------|
| 2:00 PM | Llegada. Verificar hardware, red, impresoras | 30 min | Daniel + Gerente |
| 2:30 PM | Instalar app Electron en cada terminal | 30 min | Daniel |
| 3:00 PM | Configurar client_id, printers.json, bridge | 30 min | Daniel |
| 3:30 PM | Importar menu (si no se hizo antes) | 30 min | Daniel + Gerente (valida) |
| 4:00 PM | Importar staff y configurar huellas digitales | 30 min | Daniel + Cada empleado (2 min c/u) |
| 4:30 PM | Configurar metodos de pago y turno de prueba | 15 min | Daniel + Gerente |
| 4:45 PM | Smoke test (10 pasos) | 15 min | Daniel + Gerente |
| 5:00 PM | Capacitacion gerente (demo completa del sistema) | 30 min | Daniel + Gerente |
| 5:30 PM | Capacitacion rapida a 2-3 meseros clave | 30 min | Daniel + Meseros |
| 6:00 PM | Cierre. Preguntas. Plan para manana | 15 min | Daniel + Gerente |

**Total: 4 horas.**

### 2B. Quien debe estar presente

| Persona | Obligatorio | Por que |
|---------|:-----------:|---------|
| Gerente | SI | Sera el champion interno. Necesita conocer todo el sistema |
| Dueño | IDEAL | Para que vea el dashboard y entienda el valor. Si no puede dia 1, agendar dia 2 |
| 2-3 meseros clave | IDEAL | Los "early adopters" que ayudaran a entrenar al resto |
| Cajero | SI | Necesita saber corte y cobro |
| Todos los meseros | NO | Se capacitan en los dias siguientes |
| Chef | NO | Se le muestra KDS/comandas despues |

### 2C. Instalacion paso a paso

**Paso 1: Instalar aplicacion Electron**
- Descargar installer desde repositorio interno
- Ejecutar en cada terminal
- Verificar que abre correctamente

**Paso 2: Configurar bridge (conexion impresoras)**
- Editar `printers.json` con IPs o puertos USB de cada impresora
- Asignar cada impresora a su estacion (caja, cocina, barra, etc.)
- Probar impresion de prueba en cada una

**Paso 3: Configurar client_id**
- Asignar identificador unico del restaurante
- Conectar con Supabase (URL + keys)
- Verificar sincronizacion de datos

**Paso 4: Configurar lector de huella**
- Instalar drivers HID si es necesario
- Registrar huella de cada empleado (2 minutos por persona)
- Probar login con huella en cada terminal

**Paso 5: Importar menu**
- Cargar items, categorias, precios, modificadores
- Verificar con gerente item por item (Migration Diff Report)
- Corregir errores antes de continuar

**Paso 6: Configurar metodos de pago**
- Efectivo, tarjeta de credito, debito, transferencia
- Configurar integracion con terminal bancaria si aplica

### 2D. Checklist de configuracion

- [ ] `client_id` configurado correctamente
- [ ] `printers.json` con todas las impresoras mapeadas
- [ ] Menu importado y validado (Migration Diff Report aprobado por gerente)
- [ ] Staff importado con nombres, roles y puestos correctos
- [ ] Huellas digitales registradas para todos los empleados presentes
- [ ] Metodos de pago configurados
- [ ] Planograma de mesas creado (todas las mesas del restaurante)
- [ ] Estaciones de cocina configuradas (cocina, barra, market, etc.)
- [ ] Turno de prueba abierto y cerrado exitosamente
- [ ] Impresion de prueba en TODAS las impresoras
- [ ] Dashboard accesible desde celular del dueño/gerente
- [ ] WhatsApp de soporte compartido con gerente

### 2E. Smoke Test — 10 pasos

Ejecutar estos 10 pasos en orden. Todos deben pasar antes de declarar "listo":

| # | Paso | Resultado esperado | Pasa? |
|---|------|--------------------|:-----:|
| 1 | Login con huella digital | Sistema abre en <3 segundos | [ ] |
| 2 | Abrir mesa y tomar orden con 3+ items y 1 modificador | Orden registrada correctamente | [ ] |
| 3 | Enviar a cocina | Comanda impresa en estacion correcta | [ ] |
| 4 | Agregar item a orden existente | Se imprime solo el item nuevo | [ ] |
| 5 | Aplicar descuento | Descuento reflejado en cuenta | [ ] |
| 6 | Cobrar con efectivo | Cambio calculado, ticket impreso | [ ] |
| 7 | Cobrar con tarjeta | Pago registrado correctamente | [ ] |
| 8 | Abrir y cerrar turno | Corte generado con totales correctos | [ ] |
| 9 | Ver dashboard en celular | Datos del turno de prueba visibles | [ ] |
| 10 | Operar sin internet (desconectar WiFi) | POS sigue funcionando normal | [ ] |

**Si algun paso falla: resolver antes de continuar. No dejar pendientes.**

### 2F. Plan de capacitacion

| Audiencia | Que enseñar | Como | Duracion | Cuando |
|-----------|------------|------|:--------:|--------|
| Gerente | Todo: POS, dashboard, cortes, reportes, alertas | 1 a 1 con Daniel | 30-45 min | Dia 1 |
| Meseros clave (2-3) | Login, tomar orden, modificadores, cobrar | Manos en terminal | 20-30 min | Dia 1 |
| Resto de meseros | Login, tomar orden, modificadores, cobrar | Gerente capacita (no Daniel) | 15 min c/u | Dia 2-3 |
| Cajero | Cobro, corte, propinas, facturacion | 1 a 1 con Daniel o gerente | 20 min | Dia 1-2 |
| Chef | Ver comandas, confirmar preparacion | Mostrar en cocina | 10 min | Dia 2 |
| Dueño | Dashboard, alertas, reportes, app movil | Demo en celular | 15 min | Dia 1-2 |

**Regla: el gerente capacita al equipo, no Fullsite.** Fullsite capacita al gerente. El gerente es el champion.

---

## 3. Primera semana

### 3A. Check-ins diarios

| Dia | Que verificar | Metodo | Accion si hay problema |
|-----|--------------|--------|----------------------|
| Dia 1 (post-instalacion) | Servicio de cena funciono? Impresoras OK? Algun mesero con dificultad? | WhatsApp con gerente a las 11pm | Resolver remoto o ir al dia siguiente |
| Dia 2 | Desayuno funciono? Meseros que faltaron a capacitacion ya aprendieron? | WhatsApp 10am + llamada 3pm | Sesion express de capacitacion si es necesario |
| Dia 3 | Primer dia completo sin supervision. Hay quejas? Errores? | WhatsApp 10am | Si hay errores criticos, ir presencial |
| Dia 4 | Corte del dia 3 cuadra? Dashboard refleja bien? | Revisar dashboard remoto + WhatsApp | Ajustar configuracion si es necesario |
| Dia 5 | Viernes — primer dia de alta demanda. Todo estable? | Estar disponible por WhatsApp toda la noche | Soporte remoto inmediato |
| Dia 6-7 | Fin de semana — prueba de fuego | WhatsApp disponible. Llamada rapida sabado 4pm | Si sobrevive el fin de semana, el sistema esta listo |

### 3B. Problemas comunes y como resolverlos

| Problema | Causa probable | Solucion | Quien resuelve |
|----------|---------------|----------|----------------|
| "La impresora no imprime" | Cable desconectado, IP cambio, papel atorado | Verificar conexion. Reiniciar bridge. Cambiar papel | Gerente (enseñar dia 1) |
| "No lee mi huella" | Dedo humedo, sensor sucio, huella mal registrada | Limpiar sensor. Re-registrar huella | Gerente |
| "Un platillo no aparece en el menu" | No se importo o esta en categoria incorrecta | Agregar/mover en admin | Daniel (remoto) |
| "El precio esta mal" | Error en importacion | Corregir en admin | Daniel (remoto) |
| "No puedo cerrar el turno" | Ordenes abiertas sin cobrar | Cerrar o transferir ordenes abiertas | Gerente |
| "Se trabo la pantalla" | App se congelo | Cerrar y reabrir la app | Gerente |
| "No tengo internet" | WiFi caido | Fullsite funciona offline. Reiniciar router si es necesario | Gerente |
| "El mesero aplico descuento sin permiso" | Permisos mal configurados | Ajustar permisos por rol | Daniel (remoto) |
| "El corte no cuadra" | Metodo de pago mal asignado o orden sin cobrar | Revisar ordenes del dia | Daniel + Gerente |
| "Es muy lento" | Demasiados procesos en la terminal | Cerrar apps innecesarias. Verificar RAM | Daniel (remoto) |

### 3C. Ruta de escalacion

| Nivel | Quien resuelve | Tiempo de respuesta | Ejemplos |
|-------|---------------|:-------------------:|----------|
| L1 — Auto-resolucion | Gerente | Inmediato | Papel de impresora, huella no lee, app se trabo |
| L2 — Soporte remoto | Daniel via WhatsApp/TeamViewer | < 30 minutos | Platillo faltante, precio incorrecto, permisos, corte no cuadra |
| L3 — Soporte presencial | Daniel en el restaurante | < 24 horas | Impresora dañada, terminal con falla de hardware, problema critico en hora pico |

### 3D. Metricas de exito — Semana 1

| Metrica | Meta | Como medirlo |
|---------|:----:|--------------|
| Meseros capacitados | 100% del staff | Todos loguearon al menos 1 vez |
| Ordenes tomadas sin error | >95% | Revision de cancelaciones/correcciones |
| Impresoras funcionando | 100% | Cero reportes de "no imprime" despues del dia 3 |
| Corte diario cuadra | Si | Diferencia < $100 entre sistema y conteo fisico |
| Llamadas de soporte | <3 por dia bajando a <1 al dia 7 | Conteo de WhatsApp |
| Gerente abre dashboard solo | Si | Verificar que entro al dashboard al menos 1x al dia |
| Nadie pidio regresar al POS viejo | Si | Preguntar explicitamente al gerente |

---

## 4. Primer mes

### 4A. Check-ins semanales

| Semana | Foco | Actividad |
|--------|------|-----------|
| Semana 1 | Estabilidad + capacitacion | Check-ins diarios (ver seccion 3) |
| Semana 2 | Inventario basico | Activar modulo de inventario. Enseñar al gerente a registrar entradas/salidas. Hacer primer conteo fisico con el sistema |
| Semana 3 | Food cost | Cargar recetas (con chef). Activar food cost por platillo. Revisar primeros datos con dueño |
| Semana 4 | IA y reportes avanzados | Activar alertas de fraude. Revisar primer reporte semanal automatico con dueño. Mostrar agentes de IA en accion |

### 4B. Timeline de activacion de features

No activar todo el dia 1. Ir por capas:

```
Semana 1: POS basico (ordenes, cobro, impresion, corte)
Semana 2: + Inventario (entradas, salidas, conteo)
Semana 3: + Food cost (recetas, costo por platillo)
Semana 4: + IA (alertas de fraude, anomalias, predicciones)
Mes 2:    + Dashboard avanzado (benchmarking, tendencias)
Mes 2:    + CFDI (facturacion electronica)
Mes 3:    + Reportes automaticos (diario, semanal)
```

### 4C. Capacitacion de features avanzados

| Feature | Quien capacitar | Duracion | Material |
|---------|----------------|:--------:|----------|
| Inventario | Gerente + encargado de almacen | 45 min | Practica en sistema con productos reales |
| Food cost / recetas | Gerente + chef | 1 hora | Cargar 5-10 recetas juntos, interpretar datos |
| Dashboard avanzado | Dueño | 20 min | Sesion en celular, enseñar cada pantalla |
| Alertas de fraude | Dueño + gerente | 15 min | Mostrar alertas reales y como actuar |
| CFDI | Cajero + contador | 30 min | Emitir primera factura de prueba |

### 4D. Primer Corte Z (cierre completo)

Al final del mes, hacer un Corte Z acompañado con el gerente:

- [ ] Verificar que todas las ordenes del dia estan cerradas
- [ ] Comparar totales del sistema vs conteo fisico de efectivo
- [ ] Verificar totales de tarjeta vs bouchers del dia
- [ ] Revisar propinas calculadas vs propinas reales
- [ ] Generar reporte del dia completo
- [ ] Comparar con un dia de Wansoft (si hay datos) para validar consistencia
- [ ] Enseñar al gerente a hacer esto solo de ahora en adelante

---

## 5. Soporte continuo

### 5A. Canales de soporte

| Canal | Uso | Horario | Tiempo de respuesta |
|-------|-----|---------|:-------------------:|
| WhatsApp directo con Daniel | Urgencias, problemas criticos | 7am - 11pm todos los dias | < 30 min |
| WhatsApp de soporte Fullsite | Dudas, configuracion, mejoras | 8am - 8pm L-S | < 2 horas |
| Soporte remoto (TeamViewer) | Problemas que requieren ver la pantalla | Coordinar por WhatsApp | Mismo dia |
| Soporte presencial | Hardware, instalacion, problemas criticos | Coordinar por WhatsApp | < 24 horas |

### 5B. SLA esperado

| Severidad | Descripcion | Tiempo de respuesta | Tiempo de resolucion |
|-----------|------------|:-------------------:|:--------------------:|
| Critica | POS no funciona. No pueden cobrar | < 15 min | < 2 horas |
| Alta | Impresora no imprime. Funcion clave falla | < 30 min | < 4 horas |
| Media | Error en reporte. Dato incorrecto | < 2 horas | < 24 horas |
| Baja | Feature request. Mejora. Duda | < 24 horas | Evaluacion en 1 semana |

### 5C. Feature requests

Cuando el cliente pide algo nuevo:

1. Escuchar y entender el problema real (no la solucion que proponen)
2. Documentar: que pidio, por que, que tan seguido le pasa, que impacto tiene
3. Clasificar: producto / proceso / capacitacion / configuracion / hardware / operacion
4. Si es configuracion o capacitacion, resolver inmediatamente
5. Si es producto, agregar al backlog con prioridad basada en evidencia operativa
6. Nunca prometer fechas de entrega de features nuevos
7. Comunicar al cliente: "Lo apunte. Te aviso cuando lo tengamos."

### 5D. Revision mensual de negocio

Agendar llamada o visita de 30 minutos cada mes con el dueño:

**Agenda:**
1. Resumen del mes: ventas, ticket promedio, food cost, alertas de fraude
2. Comparativo vs mes anterior
3. Que funciono bien del sistema
4. Que le gustaria mejorar
5. Hay algun problema no reportado?
6. Presentar nuevas funcionalidades disponibles
7. Pedir referido (si NPS > 8)

**Template de reporte mensual:**

```
RESTAURANTE: [nombre]
MES: [mes/año]

VENTAS
- Ventas netas: $X
- Ticket promedio: $X
- Variacion vs mes anterior: +/- X%

OPERACION
- Ordenes procesadas: X
- Incidentes reportados: X
- Tiempo promedio de resolucion: X horas

IA
- Alertas de fraude: X
- Anomalias detectadas: X
- Food cost promedio: X%

SOPORTE
- Tickets de soporte: X
- MTBS (dias entre tickets): X

PROXIMOS PASOS
- [Feature a activar]
- [Capacitacion pendiente]
- [Mejora sugerida]
```

---

## 6. Plan de rollback

### 6A. Cuando activar el rollback

Criterios para decidir que "esto no esta funcionando":

| Señal | Umbral | Accion |
|-------|--------|--------|
| Meseros no pueden tomar ordenes | Dia 3 y aun no fluye | Evaluar: es capacitacion o es el producto? |
| Ventas se ven afectadas | Caida >10% atribuible al sistema | Rollback inmediato |
| Gerente pide regresar al POS viejo | Dia 7 y la queja persiste | Conversacion honesta con dueño. Evaluar |
| Bug critico sin solucion | > 48 horas sin resolucion | Rollback temporal mientras se resuelve |
| Dueño perdio confianza | Explicitamente dice que no funciona | Rollback con dignidad |

**Regla: nunca forzar la permanencia.** Si no funciona, es mejor hacer rollback limpio y conservar la relacion.

### 6B. Proceso de rollback

1. **Comunicar al dueño y gerente:** "Entiendo que esto no esta funcionando como esperabamos. Vamos a regresar a [POS anterior] para que tu operacion no se vea afectada."
2. **Exportar datos:** Sacar todas las ventas, ordenes, y reportes generados durante el periodo de Fullsite en CSV/Excel.
3. **Reactivar POS anterior:** Verificar que el sistema anterior sigue instalado y funcional. Si se desinstalo, reinstalar.
4. **Restablecer impresoras:** Reconectar impresoras al POS anterior si se reconfiguraron.
5. **Verificar operacion:** Hacer smoke test con el POS anterior para confirmar que todo funciona.
6. **Entregar datos:** Dar al cliente un folder con todos sus datos del periodo Fullsite.
7. **Conversacion de cierre:** Preguntar que fue lo que no funciono. Documentar para mejorar.

### 6C. Que datos preservamos

| Dato | Se preserva | Formato |
|------|:-----------:|---------|
| Ventas del periodo | Si | CSV + PDF |
| Reportes generados | Si | PDF |
| Menu configurado | Si | Export JSON |
| Staff registrado | Si | CSV |
| Alertas de IA generadas | Si | PDF |
| Recetas cargadas | Si | Export JSON |
| Historial de soporte | Si | Registro interno |

### 6D. Timeline del rollback

| Paso | Tiempo |
|------|:------:|
| Decision de rollback comunicada | Hora 0 |
| POS anterior reactivado y funcionando | < 2 horas |
| Impresoras reconectadas | < 1 hora adicional |
| Datos exportados y entregados | < 24 horas |
| Conversacion de cierre con dueño | < 48 horas |

### 6E. Post-mortem interno

Despues de cada rollback, documentar:

1. Que fallo? (producto, onboarding, expectativas, hardware, personas)
2. En que momento se pudo haber evitado?
3. Que cambiamos para el proximo cliente?
4. El cliente estaria abierto a intentar de nuevo en el futuro?

**El rollback no es un fracaso. Es una señal de que respetamos al cliente mas que nuestro orgullo.**

---

*Este playbook se actualiza despues de cada implementacion. Cada problema nuevo se documenta. Cada mejora en el proceso se incorpora.*

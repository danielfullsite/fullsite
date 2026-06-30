# CUTOVER PLAYBOOK — Wansoft → Fullsite

> Procedimiento exacto para migrar un restaurante de Wansoft a Fullsite
> sin detener la operacion.
> Disenado para ser ejecutado por cualquier implementador.
> Si hay que improvisar, el playbook esta incompleto — marcar y corregir.
> Version 1.0 — basado en AMALAY (primer cliente)

---

## ANTES DEL DIA DEL CUTOVER

### T-7 dias: Requisitos

| # | Requisito | Verificacion | Responsable | Status |
|---|-----------|-------------|-------------|--------|
| 1 | Onboarding completado (4 fases) | Migration Diff Report con 0 alertas criticas | Implementador | □ |
| 2 | Menu importado y verificado | 10 items al azar = precio correcto | Implementador + gerente | □ |
| 3 | Staff importado con PINs | Cada rol puede hacer login | Implementador | □ |
| 4 | Impresoras probadas (cocina, barra, tickets, caja) | Test de impresion exitoso en cada una | Implementador | □ |
| 5 | Bridge corriendo con auto-arranque | Health check OK despues de reinicio | Implementador | □ |
| 6 | KDS instalado en monitor cocina | Ordenes aparecen en pantalla | Implementador | □ |
| 7 | Cajon funciona (abre con efectivo, no abre con tarjeta) | Test fisico | Implementador | □ |
| 8 | Facturacion configurada (Facturama + CSD + IEPS) | Factura de prueba timbrada en produccion | Implementador | □ |
| 9 | Offline probado (desconectar WiFi, crear orden, reconectar) | Orden sincroniza correctamente | Implementador | □ |
| 10 | Turno: abrir + operar + cerrar probado | Wizard completo sin errores | Implementador | □ |
| 11 | Capacitacion del staff completada | Cada rol opero al menos 1 flujo sin ayuda | Implementador | □ |
| 12 | Shadow Day exitoso | POS anterior se abrio 0 veces | Implementador | □ |
| 13 | Plan de rollback definido y comunicado | Gerente sabe como regresar a Wansoft | Implementador + gerente | □ |

### T-3 dias: Backups

| # | Backup | Como | Donde | Responsable |
|---|--------|------|-------|-------------|
| 1 | Base de datos Wansoft (.bak) | SQL Server Management Studio o via Wansoft | USB + nube | Implementador |
| 2 | Configuracion Wansoft (configs, printers.json) | Copiar carpeta C:\NetSilver\ | USB | Implementador |
| 3 | Datos de Fullsite (Supabase) | Export via dashboard o pg_dump | Automatico (Supabase) | N/A |
| 4 | printers.json de Fullsite | Copiar de C:\fullsite\ | USB | Implementador |
| 5 | Foto del layout de mesas actual | Foto con celular | Carpeta del cliente | Implementador |
| 6 | Ultimo corte Z de Wansoft | Imprimir o screenshot | Carpeta del cliente | Cajero |

### T-1 dia: Validaciones finales

| # | Validacion | Criterio | Responsable |
|---|-----------|----------|-------------|
| 1 | Bridge corriendo | `health` OK, uptime > 0 | Implementador |
| 2 | Internet estable | Speed test > 5 Mbps, latencia < 100ms | Implementador |
| 3 | Impresoras con papel | Verificar rollo en cada impresora | Staff |
| 4 | Bateria UPS (si existe) | Cargada | Staff |
| 5 | Ultimo corte Z de Wansoft impreso | Linea base para comparacion | Cajero |
| 6 | Staff sabe sus PINs | Cada persona confirma que puede entrar | Gerente |
| 7 | Gerente tiene WhatsApp del implementador | Canal de soporte definido | Implementador |
| 8 | Wansoft NO se desinstala | Se cierra pero permanece instalado | Implementador |

---

## DIA DEL CUTOVER

### Regla #1: El cutover se hace al inicio del dia, no a media operacion.

### Regla #2: El implementador esta disponible durante todo el turno (presencial o remoto).

### Regla #3: Si algo falla y no se resuelve en 15 minutos, se abre Wansoft para esa mesa.

---

### 06:30 — Pre-apertura (30 min antes del primer cliente)

| Hora | Paso | Responsable | Tiempo | Criterio |
|---|---|---|---|---|
| 06:30 | Verificar que bridge esta corriendo | Implementador | 1 min | health OK |
| 06:31 | Verificar impresoras encendidas y con papel | Staff | 2 min | 4 impresoras listas |
| 06:33 | Verificar WiFi estable | Implementador | 1 min | Speed test OK |
| 06:34 | Verificar Chrome abierto con Fullsite | Staff | 1 min | Login visible |
| 06:35 | **Cerrar Wansoft** (no desinstalar, solo cerrar) | Gerente | 1 min | Wansoft cerrado |
| 06:36 | Gerente abre turno en Fullsite con fondo | Gerente | 3 min | Turno abierto, fondo registrado |
| 06:39 | Test rapido: crear orden de prueba → enviar a cocina → cobrar | Implementador | 5 min | Comanda imprime, ticket imprime, cajon abre |
| 06:44 | Eliminar orden de prueba (reabrir + cancelar con PIN) | Implementador | 2 min | Orden cancelada, no afecta corte |
| 06:46 | KDS cocina encendido y mostrando pantalla | Cocina | 1 min | KDS listo |
| 06:47 | Confirmar con gerente: GO / NO-GO | Gerente | 1 min | "Si, arrancamos" |

**GO criteria:**
- Bridge health OK
- 4 impresoras responden
- Test de cobro exitoso
- KDS operativo
- Gerente dice GO

**NO-GO criteria (se abre Wansoft):**
- Bridge no responde despues de 2 intentos
- Impresora de cocina no funciona (sin fallback)
- Internet completamente caido (sin WiFi ni datos)
- Gerente dice NO-GO

### 07:00-15:00 — Operacion del primer turno

| Evento | Accion | Responsable |
|---|---|---|
| Primera orden real | Implementador observa sin intervenir. Documenta tiempo | Implementador |
| Staff pregunta algo | Responder y anotar en el log. Si la pregunta se repite, es gap de capacitacion | Implementador |
| Incidente menor (UI confusa, boton no encontrado) | Resolver verbalmente. Anotar para fix posterior | Implementador |
| Incidente medio (impresora no imprime, item no aparece) | Resolver en < 5 min. Si no se resuelve, usar fallback | Implementador |
| Incidente critico (no se puede cobrar, datos perdidos) | **Abrir Wansoft** para esa mesa. Documentar con detalle | Implementador + gerente |
| Staff pide regresar a Wansoft | Escuchar la razon. Si es miedo, tranquilizar. Si es funcional, evaluar. No forzar | Implementador |

### Log de incidentes (llenar durante el dia)

```
| Hora  | Mesa | Problema | Resolucion | Tiempo | Wansoft? | Categoria |
|-------|------|----------|------------|--------|----------|-----------|
| 07:15 |  3   |          |            |        |  No      |           |
| 08:30 | 10   |          |            |        |  No      |           |
```

Categorias: Producto (bug), Proceso (playbook), Capacitacion (training),
Configuracion (datos), Hardware (equipo), Operacion (restaurante).

### 15:00 — Cierre del primer turno

| Paso | Responsable | Tiempo |
|---|---|---|
| Cajero abre CierreCajaWizard en Fullsite | Cajero | 1 min |
| Contar billetes (paso 1 del wizard) | Cajero | 3 min |
| Contar monedas (paso 2) | Cajero | 2 min |
| Revisar resumen del sistema (paso 3) | Cajero + implementador | 2 min |
| Gerente aprueba con PIN (paso 4) | Gerente | 1 min |
| Imprimir corte | Cajero | 1 min |
| **Comparar corte Fullsite vs lo esperado** | Implementador | 5 min |
| Documentar diferencia (si hay) | Implementador | 2 min |
| Abrir segundo turno (si aplica) | Cajero segundo turno | 2 min |

### Criterios de exito del primer turno

| Metrica | Target | Critico si |
|---|---|---|
| Ordenes procesadas | > 0 | = 0 (no se uso) |
| Veces que se abrio Wansoft | 0 | > 3 |
| Incidentes que duraron > 5 min | 0 | > 2 |
| Corte cuadra (diferencia < $50) | Si | Diferencia > $500 |
| Staff pide regresar | 0 | > 2 personas |

---

## DESPUES DEL CUTOVER

### Primeras 24 horas

| # | Verificacion | Cuando | Responsable |
|---|-------------|--------|-------------|
| 1 | Verificar con gerente: algun problema? | Manana siguiente 9am | Implementador (WhatsApp) |
| 2 | Revisar audit log para anomalias | Manana siguiente | Implementador (remoto) |
| 3 | Revisar sync queue para items pendientes | Manana siguiente | Implementador (remoto) |
| 4 | Verificar que el corte de ayer cuadro | Manana siguiente | Implementador |
| 5 | Verificar que el bridge sigue corriendo | Manana siguiente | Implementador (TeamViewer) |
| 6 | Responder cualquier duda en < 30 min | Todo el dia | Implementador |

### Primera semana (Hypercare)

| Dia | Accion |
|---|---|
| Dia 1 | Verificacion completa (6 puntos arriba) |
| Dia 2 | Verificar corte D1. Preguntar al gerente: que fue lo mas dificil? |
| Dia 3 | Verificar corte D2. Revisar audit log. Buscar patrones de error |
| Dia 4 | Verificar corte D3. Si hay incidentes recurrentes, resolver |
| Dia 5 | Verificar corte D4. Preguntar: alguien quiere regresar a Wansoft? |
| Dia 6 | Verificar corte D5 |
| Dia 7 | **Evaluacion semanal:** 7 cortes cuadran? 0 rollbacks? Staff contento? |

### SLA de soporte durante Hypercare

| Prioridad | Tiempo de respuesta | Tiempo de resolucion |
|---|---|---|
| Critico (no puede vender) | < 5 min | < 30 min o rollback |
| Alto (impresora, cajon, factura) | < 15 min | < 2 horas |
| Medio (UI confusa, dato incorrecto) | < 30 min | < 24 horas |
| Bajo (mejora, sugerencia) | < 24 horas | Backlog |

### Criterios para declarar cutover exitoso (Dia 7)

- [ ] 7 dias de operacion continua con Fullsite
- [ ] 0 rollbacks a Wansoft
- [ ] Todos los cortes cuadran (diferencia < $100 acumulado)
- [ ] 0 ordenes perdidas
- [ ] 0 facturas incorrectas
- [ ] Staff no pide regresar
- [ ] Gerente confirma: "no necesitamos Wansoft"

### Decision post-Dia 7

| Escenario | Accion |
|---|---|
| Todos los criterios pasan | Iniciar cierre de implementacion. Wansoft se puede desinstalar en 2 semanas |
| 1-2 criterios no pasan | Extender hypercare 1 semana. Resolver issues |
| 3+ criterios no pasan | Evaluar rollback parcial o total. Documentar que fallo |

---

## ROLLBACK

### Si en cualquier momento se necesita regresar a Wansoft:

| Paso | Accion | Tiempo |
|---|---|---|
| 1 | Abrir Wansoft (no se desinstalo) | 30 seg |
| 2 | Login con usuario habitual | 30 seg |
| 3 | Operar con Wansoft el resto del turno | Inmediato |
| 4 | Al cierre: corte en Wansoft (no en Fullsite) | Normal |
| 5 | Documentar: que paso, cuando, por que | 10 min |
| 6 | Enviar incidente al implementador | 2 min |
| 7 | Resolver el problema en Fullsite | Variable |
| 8 | Reintentar cutover cuando este resuelto | Cuando listo |

### Rollback parcial (solo para una mesa)

Si una mesa tiene un problema especifico que no se resuelve en 5 min:
1. Abrir Wansoft SOLO para esa mesa
2. El resto del restaurante sigue en Fullsite
3. Documentar la mesa y el problema
4. Al cierre: sumar manualmente la venta de esa mesa al corte

---

## DOCUMENTOS GENERADOS POR CUTOVER

Al terminar el cutover, la carpeta del cliente debe tener:

| Documento | Cuando se genera |
|---|---|
| Migration Diff Report | Fase 2 del onboarding |
| Log de incidentes del Shadow Day | Shadow Day |
| Log de incidentes del Dia 1 | Cutover |
| Cortes de los 7 dias de hypercare | Cada dia |
| Evaluacion semanal (Dia 7) | Dia 7 |
| Post-Implementation Report | Dia 7 |
| Lecciones aprendidas | Dia 7 |

---

## LECCIONES DE AMALAY (actualizar despues del cutover)

```
| Fecha | Leccion | Clasificacion | Accion |
|-------|---------|---------------|--------|
|       |         |               |        |
```

Cada leccion se clasifica en:
1. **Producto** — requiere cambio en Fullsite
2. **Proceso** — requiere cambio en este playbook
3. **Capacitacion** — requiere cambio en el training
4. **Configuracion** — especifico del cliente
5. **Hardware** — equipo o red del restaurante
6. **Operacion** — problema del restaurante, no de Fullsite

---

> Este playbook se valida ejecutandolo.
> Cada vez que se improvise un paso, se marca y se agrega al playbook.
> Despues de 3 restaurantes, el playbook se automatiza en el CLI.
>
> Fullsite — Restaurant Operating System

# Smoke Test Pre-Demo — POS AMALAY

**Duración:** 10-15 minutos
**Cuándo:** Antes de ir al restaurante
**Dónde:** Browser en laptop (no terminal AMALAY)
**Regla:** Si cualquier item marcado STOP falla, NO ir al restaurante hasta resolverlo

---

## Pre-condiciones

- [ ] POS carga sin errores en consola (abrir DevTools > Console)
- [ ] Menú visible (687 items en 60 categorías esperadas)
- [ ] Staff list carga (40 meseros/staff activos)
- [ ] No hay turno activo (verificar — no debería haber)

**ALERTA:** Hay una orden zombie en mesa 5 (status `preparando`, Jul 16, $310, Mario García). Al seleccionar mesa 5 cargará esta orden antigua. Esto NO es un bug — es una orden que nunca se cerró de pruebas anteriores.

---

## 1. Turno y Login (2 min)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 1.1 | Intentar crear orden SIN abrir turno | Mensaje "No hay turno activo" | — | STOP |
| 1.2 | Abrir turno con PIN de Eduardo o Daniel | Turno abierto, fondo de caja registrado | — | STOP |
| 1.3 | Verificar que el nombre del turno aparece correcto | Nombre del staff, no "undefined" | — | |

---

## 2. Orden Básica — Mesa nueva (3 min)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 2.1 | Seleccionar mesa 1 (debe estar vacía) | Sin orden previa, items vacíos | — | |
| 2.2 | Agregar 2 items del menú (ej. Chilaquiles + Café) | Items aparecen en lista con precios | — | STOP |
| 2.3 | Verificar total correcto | Suma de precios = total mostrado | — | STOP |
| 2.4 | Enviar a cocina | Toast "X items enviados", items marcados como enviados | — | STOP |
| 2.5 | Verificar que NO se puede enviar de nuevo sin cambios | Botón no envía duplicado o toast "Sin cambios" | ~~H-5 refutado~~ | |

---

## 3. Cambio de Mesa y Regreso — BUG CONOCIDO H-4 (3 min)

| # | Paso | Resultado esperado | Bug ACTIVO | STOP? |
|---|------|-------------------|------------|-------|
| 3.1 | Desde mesa 1 (con orden enviada), cambiar a mesa 2 | Mesa 2 vacía | — | |
| 3.2 | Agregar 1 item en mesa 2, enviar a cocina | Orden de mesa 2 guardada | — | |
| 3.3 | Regresar a mesa 1 | Items originales visibles, total correcto | H-4 (97%) | |
| 3.4 | **CANCELAR un item** en mesa 1 | Item marcado como CANCELADO, total se actualiza | H-3, H-4 | |
| 3.5 | Cambiar a mesa 2 y regresar a mesa 1 | Item cancelado SIGUE cancelado (no reaparece) | **H-4 BUG ACTIVO** | |
| 3.6 | Refresh del browser (F5) en mesa 1 | Orden se restaura correctamente | — | |

**Qué esperar:** En paso 3.5, el item cancelado PUEDE reaparecer. Esto es H-4 confirmado al 97%. Si ocurre, documentar pero NO detener el smoke test — ya está en el backlog.

---

## 4. Cobro (2 min)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 4.1 | En mesa 2, click "Cobrar" | Modal de verificación de personas | — | STOP |
| 4.2 | Confirmar personas, seleccionar "Efectivo" | Orden cerrada, toast de confirmación | ~~H-2 refutado~~ | STOP |
| 4.3 | Verificar que mesa 2 queda vacía | Sin orden, lista para nuevo cliente | — | |
| 4.4 | Volver a mesa 1, cobrar con "Tarjeta" | Orden cerrada correctamente | — | STOP |

---

## 5. Movimiento de Caja — BUG ACTIVO H-1 (1 min)

| # | Paso | Resultado esperado | Bug ACTIVO | STOP? |
|---|------|-------------------|------------|-------|
| 5.1 | Abrir modal de movimiento de caja | Modal aparece | — | |
| 5.2 | Registrar retiro de $100 con PIN | Movimiento guardado | **H-1 BUG ACTIVO** | |
| 5.3 | **Verificar en Supabase** cuántas filas se crearon | Debería ser 1, pero serán **2** (doble-write) | H-1 (99%) | |

**Qué esperar:** Paso 5.3 confirmará el doble-write. Si usas biométrico en vez de PIN, solo crea 1 fila (ruta biométrica no tiene el bug).

---

## 6. Historial — BUG CONOCIDO H-19 (1 min)

| # | Paso | Resultado esperado | Bug ACTIVO | STOP? |
|---|------|-------------------|------------|-------|
| 6.1 | Ir a Historial de órdenes | Lista de órdenes del día | — | |
| 6.2 | Si hay órdenes antiguas (pre-modificadores), expandir una | Items visibles sin crash | **H-19 (96%)** | |

**Qué esperar:** Si una orden antigua tiene `modificadores: null`, la pantalla puede crashear. Esto confirmaría H-19. Si todas las órdenes del smoke test son nuevas (tienen `modificadores: []`), el bug no se manifiesta.

---

## 7. KDS / Cocina (1 min)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 7.1 | Abrir `/pos/cocina` en otra pestaña | Órdenes enviadas visibles | — | |
| 7.2 | Marcar un item como "listo" | Item cambia de estado | H-6 (localStorage only) | |
| 7.3 | Refresh de la pestaña KDS | Status de items se mantiene (o se pierde si H-6) | H-6 | |

---

## 8. Cierre de Turno (1 min)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 8.1 | Cerrar turno | Wizard de cierre de caja | — | |
| 8.2 | Verificar que el corte muestra las órdenes del smoke test | Totales correctos | — | STOP |
| 8.3 | Verificar nombre en el corte impreso | Debe decir el nombre del restaurante, no hardcoded | M-3 | |

---

## 9. Red/Offline (1 min, opcional)

| # | Paso | Resultado esperado | Bug relacionado | STOP? |
|---|------|-------------------|-----------------|-------|
| 9.1 | Desconectar WiFi con orden abierta | Indicador "Sin conexión" visible | — | |
| 9.2 | Agregar item offline | Item se agrega localmente | — | |
| 9.3 | Reconectar WiFi | Sync automático | H-16, H-17 | |

---

## Checklist Rápido Post-Smoke (verificar en consola/Supabase)

- [ ] `pos_orders` tiene las órdenes del smoke test con status correcto
- [ ] `pos_cash_movements` — verificar si hay filas duplicadas (H-1)
- [ ] Consola del browser sin errores rojos (excepto warnings conocidos)
- [ ] `pos_turnos` tiene el turno abierto y cerrado correctamente

---

## Resumen de Bugs Activos que Podrían Manifestarse

| Bug | Probabilidad en smoke test | Impacto si ocurre | Acción |
|-----|---------------------------|-------------------|--------|
| H-1 (doble-write cash) | 99% si usas PIN | 2 filas en vez de 1 | Documentar, no detener |
| H-4 (items cancelados reaparecen) | 97% si cambias mesa después de cancelar | Item fantasma | Documentar, no detener |
| H-19 (modificadores null) | Solo con órdenes antiguas | Crash de pantalla | Documentar, no detener |
| M-3 (AMALAY en corte) | 100% | "AMALAY" hardcoded en recibo | Cosmético, no detener |
| H-6 (KDS localStorage) | 100% en refresh | Status se pierde | Documentar, no detener |

**Ninguno de estos bugs es STOP para la demo.** Son bugs conocidos, documentados, con fix programado. Solo detener si algo NUEVO rompe el flujo básico (no carga menú, no guarda orden, no cobra).

---

## Orden Zombie — Limpiada

~~Mesa 5 tenía una orden `preparando` del Jul 16 ($310).~~
Cancelada el Jul 22: `PATCH pos_orders?id=eq.966b8662 → status: 'cancelada'`. Mesa 5 limpia.

---

## ETAPA 2: Smoke Test en AMALAY (Electron, 5-10 min)

**Cuándo:** Al llegar al restaurante, antes de cualquier demo con Eduardo.
**Dónde:** Terminal Caja/Entrada, app Electron instalada.
**Objetivo:** Detectar diferencias entre Chrome (laptop) y Electron (producción).

### Diferencias conocidas entre Chrome y Electron

| Componente | Chrome (laptop) | Electron (terminal) | Riesgo |
|-----------|----------------|--------------------|----|
| Print bridge | No disponible | localhost:7717 | Comandas y tickets no imprimen en Chrome |
| Impresoras | N/A | USB/TCP, requieren bridge | Hardware real |
| Huella digital | N/A | Lector HID USB | Auth biométrica |
| Red | WiFi laptop | WiFi restaurante (puede ser inestable) | Timeouts, offline |
| Rendimiento | Laptop rápida | Terminal Windows (más lenta) | UI lag en mesas |
| Resolución | Variable | Touch 1024x768 o similar | Layout puede diferir |
| localStorage | Fresh | Puede tener cache viejo de pruebas anteriores | Estado stale |

### Checklist Electron (repetir lo esencial)

| # | Paso | Qué comparar vs Chrome | Riesgo específico |
|---|------|----------------------|-------------------|
| E-1 | Abrir app Electron | Tiempo de carga. ¿Spinner? ¿Error? | H-16: POS boot silent fail |
| E-2 | Login con PIN en terminal | Velocidad de respuesta del PIN pad | Touch vs keyboard |
| E-3 | Navegar entre 5 mesas rápido (tap tap tap) | Velocidad de render, lag visible | Rendimiento terminal |
| E-4 | Crear orden, agregar 3 items | Velocidad de selección del menú | Touch targets, scroll |
| E-5 | Enviar a cocina | ¿Comanda se imprime? ¿Bridge responde? | Bridge connection |
| E-6 | Verificar KDS en terminal cocina | ¿Orden aparece? ¿Realtime? | Red local entre terminales |
| E-7 | Cobrar con efectivo | ¿Ticket se imprime? ¿Cajón abre? | Impresora + cajón RJ-11 |
| E-8 | Refresh (F5 o cerrar/abrir Electron) | ¿Orden se restaura? ¿localStorage consistente? | Cache Electron vs Chrome |
| E-9 | Cambiar mesa y regresar | Mismo test H-4 pero en Electron | Estado stale |
| E-10 | Test offline: desconectar cable/WiFi momentáneamente | ¿Indicador offline? ¿Orden se guarda? | Resiliencia de red |

### Qué documentar si hay diferencias

Para cada diferencia Chrome vs Electron:

```
Paso: E-X
Comportamiento Chrome: [qué pasó en laptop]
Comportamiento Electron: [qué pasó en terminal]
Impacto operativo: [afecta al mesero? al cobro? a la cocina?]
Screenshot/video: [si es posible]
```

### Bridge y hardware — verificación rápida

| Check | Comando/Acción | Esperado |
|-------|---------------|----------|
| Bridge activo | Abrir `http://localhost:7717/health` en terminal | `{"status":"ok"}` |
| Impresora caja | Enviar test print desde bridge | Ticket legible |
| Impresora cocina | Enviar comanda desde POS | Comanda legible |
| Cajón de dinero | Cobrar en efectivo | Cajón abre |
| Lector huella | Tocar sensor | LED responde |

### Clasificación de diferencias

| Tipo | Definición | Ejemplo | Detiene demo? |
|------|-----------|---------|---------------|
| **Rendimiento** | Más lento pero completa correctamente | Cambio de mesa tarda 3s en Electron vs 0.5s en Chrome | NO — documentar paso + tiempo aproximado |
| **Funcional** | Resultado distinto entre Chrome y Electron | KDS muestra orden en Chrome pero no en Electron | NO si hay workaround — documentar resultado exacto |
| **Falla crítica** | Crash, data loss, duplicación, orden que no guarda, cobro inconsistente | App se cierra al cobrar, 2 filas en DB por 1 cobro, orden desaparece | **SI — detener** |

### Veredicto final

Después de ambas etapas, registrar uno de estos resultados:

| Veredicto | Criterio | Acción |
|-----------|---------|--------|
| **GO** | Funcionalmente equivalente. Zero fallas críticas. Zero diferencias funcionales. Diferencias de rendimiento aceptables. | Demo con Eduardo procede sin restricciones. |
| **GO CON RIESGOS** | Funciona. Hay diferencias conocidas y controlables (rendimiento, flujos secundarios). Sin fallas críticas. | Demo procede. Documentar riesgos. Evitar flujos afectados durante la demo. |
| **NO-GO** | Crash, data loss, o flujo esencial roto (crear orden, enviar cocina, cobrar, abrir/cerrar turno). | **DETENER.** No hacer demo hasta resolver. Documentar falla exacta con paso, screenshot, consola. |

### Template de registro

```
SMOKE TEST — [fecha] [hora]
Etapa: Chrome / Electron
Terminal: [laptop / Caja-Entrada / otro]

RESULTADO: GO / GO CON RIESGOS / NO-GO

Diferencias de rendimiento:
- Paso X.X: [descripción] — Chrome: ~Xs, Electron: ~Xs

Diferencias funcionales:
- Paso X.X: [Chrome hace Y, Electron hace Z]

Fallas críticas:
- (ninguna / descripción + screenshot)

Bugs conocidos confirmados:
- H-1: [si/no] — [detalle]
- H-4: [si/no] — [detalle]
- H-19: [si/no] — [detalle]

Notas:
-
```

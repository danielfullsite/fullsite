# Customer #2 Acceptance Criteria

**Fecha:** 2026-07-21
**Objetivo:** Definición objetiva de cuándo Fullsite está listo para instalar en un restaurante nuevo dentro del perfil operativo certificado.
**Regla:** Todos los criterios P0 deben ser PASS antes de ofrecer instalación.
**Tenant de certificación:** `fullsite_certification` — permanente. Se limpia transacciones entre pruebas pero se conserva configuración.

---

## Flujo Completo: Base Vacía → Primera Venta

```
1. ONBOARDING          → Cliente existe en el sistema, puede loguearse
2. CONFIGURACIÓN       → Branding, impresoras, mesas configuradas
3. DATOS MÍNIMOS       → Menú, staff, métodos de pago cargados
4. HARDWARE            → Terminal encendida, impresoras respondiendo
5. OPERACIÓN           → Orden creada, enviada, cobrada, ticket impreso
6. VERIFICACIÓN POST   → Datos correctos en dashboard, sin errores
```

---

## Criterios de Aceptación

### FASE 1: ONBOARDING

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| O-1 | Crear restaurante desde wizard sin modificar código | Ejecutar wizard con datos ficticios, verificar que se creó row en `clients` | Screenshot de row en Supabase | ☐ |
| O-2 | Auth user se crea automáticamente al completar wizard | Verificar que el wizard llama a `/api/onboarding` y crea usuario Supabase + `client_users` row | Login exitoso con el email del nuevo cliente | ☐ |
| O-3 | Login resuelve al cliente correcto (no AMALAY, no demo) | Loguearse con email del nuevo cliente, verificar `client_id` en AuthContext | Console: `localStorage.getItem('fullsite_client_id')` === nuevo client_id | ☐ |
| O-4 | Error en wizard es visible (no silencioso) | Intentar crear cliente con slug duplicado | Mensaje de error claro en UI | ☐ |

### FASE 2: CONFIGURACIÓN

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| C-1 | Receipt branding muestra nombre del restaurante nuevo, NO "AMALAY" | Generar ticket de prueba | Texto del ticket: nombre, dirección, teléfono correctos | ☐ |
| C-2 | Impresoras configurables sin editar código | Crear `printers.json` o usar endpoint `/config` del bridge | Comanda imprime en la impresora correcta | ☐ |
| C-3 | Número de mesas configurable sin código | Cambiar `mesas` en `clients` row, verificar que POS muestra la cantidad correcta | POS muestra N mesas, no 16 ni 33 | ☐ |
| C-4 | Logo del restaurante aparece (o placeholder neutral, no AMALAY) | Subir logo a `logo_url` en `clients` o verificar que sin logo no muestra AMALAY | POS login sin logo de otro restaurante | ☐ |
| C-5 | AI chat/coach se identifica como el restaurante nuevo | Enviar mensaje al chat, verificar que responde con el nombre correcto | Respuesta menciona nombre del restaurante, no AMALAY | ☐ |
| C-6 | Station routing configurable por cliente — items van a la estación correcta | Crear categorías con nombres diferentes a AMALAY (ej: "Parrilla" en vez de "Coffee"). Enviar orden. Verificar que la comanda llega a la impresora correcta según config del cliente, no según keywords hardcodeados de AMALAY. | Comanda de categoría custom imprime en la estación asignada | ☐ |

### FASE 3: DATOS MÍNIMOS

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| D-1 | Menú importable via CSV (categorías + items + precios) | Importar CSV de prueba con 10 categorías y 50 items | POS muestra categorías y items con precios | ☐ |
| D-2 | Staff importable via wizard (nombre + rol + PIN) | Crear 3 staff en wizard | Login con cada PIN funciona | ☐ |
| D-3 | Métodos de pago configurables | Crear efectivo + tarjeta via wizard | Ambos disponibles en pantalla de cobro | ☐ |
| D-4 | POS muestra "Sin menú configurado" si no hay datos (no menú de AMALAY) | Abrir POS con menú vacío | Mensaje claro, no datos de otro restaurante | ☐ |
| D-5 | Sin staff = no crash, solo no hay PINs válidos | Abrir POS sin staff cargado | PIN screen funcional, sin crash | ☐ |

### FASE 4: HARDWARE

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| H-1 | Electron .exe arranca y carga el POS | Instalar en terminal Windows, abrir | POS visible en pantalla | ☐ |
| H-2 | Bridge de impresión responde en localhost:7717 | Verificar `/health` del bridge | `{"status":"ok"}` | ☐ |
| H-3 | Impresora de cocina recibe comanda | Enviar orden a cocina desde POS | Comanda impresa legible | ☐ |
| H-4 | Impresora de caja imprime ticket | Cobrar una orden | Ticket impreso con QR de factura | ☐ |
| H-5 | Offline: POS mantiene operación básica sin internet | Desconectar WiFi durante una orden abierta. Verificar: (1) orden se guarda en cola offline, (2) indicador "Sin conexión" visible, (3) no crash ni pérdida de datos, (4) al reconectar se sincroniza automáticamente | Screenshot de indicador offline + orden sincronizada post-reconexión | ☐ |

### FASE 5: OPERACIÓN

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| P-1 | Abrir turno | Ingresar fondo de caja, click "Abrir turno" | Turno activo, POS operativo | ☐ |
| P-2 | Crear orden en una mesa | Seleccionar mesa, agregar items del menú | Orden visible con items y total | ☐ |
| P-3 | Enviar a cocina | Click "Enviar a cocina" | Comanda impresa y/o KDS muestra orden | ☐ |
| P-4 | Cobrar orden (efectivo) | Seleccionar efectivo, ingresar monto | Ticket impreso, orden cerrada | ☐ |
| P-5 | Cobrar orden (tarjeta) | Seleccionar tarjeta | Ticket impreso, orden cerrada | ☐ |
| P-6 | QR de factura funcional | Escanear QR del ticket | Abre página de factura con UUID completo de la orden | ☐ |
| P-7 | Cerrar turno | Contar efectivo, cerrar turno | Corte generado con totales correctos | ☐ |
| P-8 | Dashboard muestra datos del día | Abrir dashboard después de turno | Ventas, tickets, meseros del restaurante nuevo (no AMALAY) | ☐ |

### FASE 6: AISLAMIENTO

| ID | Criterio | Verificación | Evidencia | Status |
|---|---|---|---|---|
| A-1 | Zero data leak entre clientes | Query `pos_orders?client_id=eq.{nuevo}` retorna solo órdenes del nuevo | 0 órdenes de AMALAY | ☐ |
| A-2 | Zero data leak en dashboard | Login como nuevo cliente, abrir ventas/meseros/inventario | Solo datos del nuevo cliente o vacío | ☐ |
| A-3 | Cambiar entre clientes no mezcla caché | Login como AMALAY, luego como nuevo, verificar datos | Cada sesión muestra solo sus datos | ☐ |
| A-4 | Empty `client_id` retorna 0 rows | Query con `client_id=eq.` (vacío) | 0 filas en todas las tablas | ☐ |

---

## Criterios por Prioridad

### P0 — Bloqueantes (MUST PASS antes de instalar)

| Criterio | Responsable | Esfuerzo | Dependencia |
|---|---|---|---|
| O-1, O-2, O-3 | Dev (wizard → API) | 2 horas | Ninguna |
| C-1 | Dev (agregar campos al wizard) | 1 hora | O-1 |
| C-2 | Dev + Técnico (printer config) | 2 horas | Hardware |
| D-1, D-2, D-3 | Dev (ya funciona via wizard/CSV) | 0 (verificar) | O-1 |
| D-4, D-5 | Dev (ya implementado) | 0 (verificar) | Ninguna |
| P-1 a P-5 | Operativo + Dev | 0 (verificar) | D-1, D-2, H-1 |
| A-1 a A-4 | Dev (ya validado) | 0 (verificar) | O-1 |
| C-6 | Dev (station routing configurable) | 2 horas | D-1 |
| F-1 a F-9 | Dev + QA | 2 horas (verificar) | P-1 a P-5 |

**Total P0: ~7 horas de desarrollo + 4 horas de verificación**

### P1 — Importantes (resolver en semana 1)

| Criterio | Esfuerzo |
|---|---|
| C-3 (mesas configurables) | 2 horas |
| C-4 (logo) | 1 hora |
| C-5 (AI identidad) | Ya implementado — verificar |
| P-6 (QR factura) | Ya implementado — verificar |
| P-7 (cierre de turno) | Ya implementado — verificar |
| P-8 (dashboard) | Ya implementado — verificar |
| H-3, H-4, H-5 | Verificación en sitio |

### P2 — Semana 2+

| Criterio | Esfuerzo |
|---|---|
| O-4 (errores visibles en wizard) | 1 hora |
| Modifier groups import | 2 horas |
| Agent workflows por cliente | 1 hora |
| Health check multi-tenant | 30 min |

---

## Proceso de Certificación

### Pre-requisitos

```
□ Todos los P0 están implementados y deployados
□ AMALAY sigue operando sin regresiones
□ Build pasa sin errores
```

### Prueba de Aceptación (2-3 horas)

```
PREPARACIÓN (remoto, 30 min):
  □ Crear cliente ficticio "test_certification"
  □ Ejecutar wizard completo
  □ Importar menú CSV de prueba (10 categorías, 50 items)
  □ Crear 3 staff con PINs

VERIFICACIÓN LÓGICA (remoto, 30 min):
  □ Login con email del cliente ficticio
  □ Verificar client_id en localStorage
  □ Verificar que /inventario muestra 0 productos (no AMALAY)
  □ Verificar que /chat responde con nombre correcto
  □ Verificar aislamiento (A-1 a A-4)

VERIFICACIÓN OPERATIVA (en terminal o browser, 1 hora):
  □ Abrir POS → login con PIN → abrir turno
  □ Verificar menú cargado (50 items en 10 categorías)
  □ Crear orden → enviar a cocina
  □ Cobrar → verificar ticket
  □ Cerrar turno → verificar corte
  □ Abrir dashboard → verificar datos del día

CLEANUP:
  □ Limpiar transacciones del tenant fullsite_certification
  □ Conservar configuración del tenant (no eliminar)
  □ Verificar que AMALAY no fue afectado
```

### Resultado

| Resultado | Criterio |
|---|---|
| **PASS** | Todos los P0 son ✓, zero data leak, operación end-to-end exitosa |
| **CONDITIONAL** | P0 pasan pero hay P1 pendientes con workaround documentado |
| **FAIL** | Cualquier P0 falla, o data leak detectado |

---

## Escenarios de Fallo (P0)

Cada escenario debe probarse durante la certificación. El sistema debe manejar cada uno sin crash, data leak ni corrupción.

| ID | Escenario | Comportamiento esperado | Status |
|---|---|---|---|
| F-1 | Impresora de cocina apagada/desconectada | Orden se guarda. Error de impresión visible. Reintento disponible. No bloquea la operación. | ☐ |
| F-2 | Onboarding parcial (wizard abandonado a mitad) | No quedan datos huérfanos. El cliente no aparece como activo. Se puede reintentar. | ☐ |
| F-3 | CSV de menú con formato inválido (columnas faltantes, encoding roto) | Error visible con mensaje claro. No se importan datos parciales. | ☐ |
| F-4 | PIN duplicado entre dos staff del mismo restaurante | Error visible al crear. No se guarda el duplicado. | ☐ |
| F-5 | Email duplicado en onboarding (ya existe en Supabase Auth) | Error claro. No se crea un segundo usuario. Flujo no crashea. | ☐ |
| F-6 | Reintento de pago (doble click en "Cobrar") | Solo se procesa un cobro. Idempotencia por operation lock. | ☐ |
| F-7 | Diferencia de caja en cierre de turno | Diferencia se registra. Cierre se completa con la diferencia documentada. No se bloquea. | ☐ |
| F-8 | Orden enviada a cocina pero internet se cae antes de confirmar | Orden queda en cola offline. Se sincroniza al reconectar. No se pierde. | ☐ |
| F-9 | Station routing con categoría desconocida | Item se rutea a estación default (cocina). Warning en logs, no error visible. | ☐ |

---

## Metadata de Evidencia

Cada criterio marcado como PASS debe incluir:

```
Criterio: [ID]
Fecha: YYYY-MM-DD HH:MM
Commit: [hash]
Ambiente: producción | staging | local
Ejecutor: [nombre]
Client ID: [fullsite_certification | otro]
IDs relevantes: [order_id, turno_id, etc.]
Evidencia: [screenshot path | log entry | query result]
Notas: [observaciones]
```

---

## Notas

- Este documento se actualiza cada vez que se cierra un gap.
- Cada criterio marcado como ☐ se convierte en ☑ con la metadata de evidencia.
- La prueba de aceptación se corre ANTES de cada instalación nueva.
- Si un criterio previamente PASS regresa a FAIL, se congela la instalación.
- El tenant `fullsite_certification` es permanente. Se limpian órdenes y turnos entre pruebas, se conserva configuración (staff, menú, métodos de pago).

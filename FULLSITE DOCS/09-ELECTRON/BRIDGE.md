# BRIDGE — Referencia Técnica Canónica

> El bridge es hoy el componente más crítico del sistema.
> Todo lo que el Event Store sabe, lo sabe porque el bridge lo capturó.
> Última actualización: 2026-07-02

---

## Qué es el bridge

El bridge es un proceso Node.js corriendo en localhost (:7717) que hace dos cosas:

1. **Captura eventos de Wansoft** → los convierte en eventos del Event Store de Fullsite.
2. **Recibe comandos de impresión** → los envía a impresoras térmicas via TCP/USB (ESC/POS).

Es el único punto de conexión entre el mundo de Wansoft y el mundo de Fullsite.
Si el bridge falla, Fullsite no recibe datos. Si el bridge duplica, el Event Store miente.

---

## Por qué el bridge importa más que cualquier otra cosa esta semana

Sin el bridge, el Event Store está vacío.
Sin el Event Store, no hay datos históricos.
Sin datos históricos, no hay inteligencia operativa.
Sin inteligencia operativa, Fullsite es solo otro dashboard bonito.

El cutover de AMALAY, la narrativa de YC, y la tesis de IA completa dependen de que
el bridge funcione de forma confiable, continua, y exactamente una vez.

---

## Arquitectura

```
Wansoft (NetSilver .NET 4.5, SQL Server local)
    ↓ polling / webhook
Bridge (Node.js, localhost:7717)
    ↓                           ↓
Event Store (Supabase)    Impresoras (TCP/USB via ESC/POS)
    ↓
Dashboard / Agentes de IA
```

### Subsistema de captura de eventos

El bridge monitorea Wansoft y captura:
- Tickets nuevos
- Modificaciones de órdenes
- Cancelaciones y voids
- Descuentos y cortesías
- Cambios de mesa
- Pagos procesados
- Cierres de órdenes

### Subsistema de impresión

El bridge recibe comandos HTTP del POS de Fullsite y los traduce a ESC/POS
para enviar a las impresoras térmicas. Tiene:
- Cola de impresión con retry automático
- Escalamiento si la impresora no responde
- Recovery si hay trabajos atascados

---

## El requisito de idempotencia

**El bridge debe procesar cada evento exactamente una vez.**

El mecanismo: cada evento tiene un `event_id` único generado por el bridge.
El Event Store tiene un UNIQUE INDEX en `event_id` → inserts duplicados fallan silenciosamente.

**Escenario de reconexión:**
1. Bridge conectado a Wansoft.
2. Internet se cae.
3. Wansoft genera 5 órdenes durante la desconexión.
4. Bridge reconecta.
5. Bridge recibe las 5 órdenes (o las últimas N si tiene cursor).
6. Bridge intenta insertar. Si ya existen → ON CONFLICT DO NOTHING. Sin duplicados.

**La pregunta que necesita respuesta esta noche:**
¿Genera el bridge el mismo `event_id` para el mismo evento de Wansoft,
independientemente de cuántas veces lo reciba?

Si sí → idempotencia garantizada.
Si no → duplicados posibles bajo reconexión.

---

## Recovery: los 4 escenarios críticos

### Escenario 1: Internet caído (3 minutos)

**Pregunta:** ¿El bridge guarda eventos localmente mientras no hay conexión a Supabase?

**Si tiene buffer local:**
- Los eventos se acumulan en disco/memoria durante la desconexión.
- Al reconectar, se insertan en orden.
- El Event Store no tiene gaps.
- Comportamiento correcto.

**Si no tiene buffer local:**
- Los eventos generados durante la desconexión se pierden.
- El Event Store tiene un gap temporal.
- Los agentes de IA ven inactividad donde hubo ventas.
- **Esto es un blocker para producción.**

**Estado:** ⚠️ Por validar.

### Escenario 2: Proceso del bridge reiniciado

**Pregunta:** ¿El bridge tiene un cursor de "último evento procesado"?

**Si tiene cursor:**
- Al reiniciar, el bridge lee el cursor y continúa desde donde se quedó.
- No hay gaps, no hay duplicados.
- Comportamiento correcto.

**Si no tiene cursor:**
- Al reiniciar, el bridge puede:
  a) Empezar desde el inicio → duplicados (mitigados por idempotencia)
  b) Empezar desde "ahora" → gap permanente de todos los eventos durante el downtime

**Estado:** ⚠️ Por validar.

### Escenario 3: Impresora apagada

**Pregunta:** ¿El bridge detecta que la impresora no responde? ¿Lo reporta o falla silenciosamente?

**Comportamiento esperado:**
- El bridge detecta el error de TCP/USB.
- Reintenta N veces con backoff.
- Si persiste, emite un evento `printer.error` al Event Store.
- El dashboard o una alerta muestra el problema.

**Comportamiento inaceptable:**
- El bridge falla silenciosamente.
- La orden no se imprime en cocina.
- Nadie se entera hasta que el mesero va a recoger la comida.

**Estado:** ⚠️ Por validar esta noche.

### Escenario 4: Supabase temporalmente unavailable

**Pregunta:** ¿El bridge tiene retry para inserts fallidos a Supabase?

**Comportamiento esperado:**
- El bridge intenta insertar el evento.
- Supabase retorna error (timeout o 5xx).
- El bridge guarda el evento en un buffer local.
- Cuando Supabase vuelve, el buffer se vacía.

**Comportamiento inaceptable:**
- El bridge descarta el evento ante cualquier error de Supabase.
- El Event Store tiene gaps permanentes.

**Estado:** ⚠️ Por validar.

---

## Observabilidad requerida

El bridge debe exponer estas señales sin que Daniel tenga que revisar logs manualmente:

| Señal | Indicador actual | Indicador requerido |
|---|---|---|
| Bridge conectado | ❌ No existe | ✅ Indicador visual en dashboard |
| Bridge desconectado | ❌ Silencioso | ✅ Alerta inmediata |
| Gap de eventos > 60s | ❌ No existe | ✅ Alerta en dashboard |
| Error de impresión | ❌ Silencioso | ✅ Alerta con impresora afectada |
| Reconexión | ❌ No existe | ✅ Log visible + timestamp |
| Latencia elevada | ❌ No existe | ✅ Alerta si delta > 30s |
| Buffer pendiente | ❌ No existe | ✅ Contador visible |

**Regla:** Si algo puede fallar silenciosamente, no está listo para producción.

---

## Validación esta noche en AMALAY

### Prueba de idempotencia
1. Registrar el count de eventos al inicio del turno.
2. En momento de baja carga (no hora pico), desconectar el bridge 60 segundos.
3. Reconectar.
4. Verificar que el count de eventos no subió si Wansoft no generó eventos nuevos.
5. Ejecutar query de duplicados:
```sql
SELECT event_id, COUNT(*)
FROM pos_events
WHERE created_at > '[inicio_turno]'
GROUP BY event_id
HAVING COUNT(*) > 1;
-- Resultado esperado: 0 filas
```

### Prueba de observabilidad
1. Apagar la impresora de cocina 2 minutos.
2. Observar: ¿el sistema lo detecta antes de que alguien lo reporte?
3. Si no lo detecta → observabilidad ausente. Blocker documentado.

### Verificación de uptime
1. Monitorear el bridge durante las 4 horas del turno.
2. Registrar cualquier reconexión o intervención manual.
3. Resultado esperado: 0 reconexiones, 0 intervenciones.

---

## Criterio de Shadow Day

El bridge está listo para Shadow Day si:
- [ ] 4 horas de uptime continuo sin intervención manual
- [ ] 0 duplicados detectados (query de validación retorna 0 filas)
- [ ] 0 gaps documentados (o gaps explicados por evento de bridge.disconnected)
- [ ] Al menos 1 escenario de recovery probado exitosamente
- [ ] Errores de impresión detectados por el sistema antes de que el staff los reporte

Si alguno falla → documentar el blocker y resolver antes del Shadow Day.

---

> Actualizar este documento después de cada validación en producción.
> Los estados "Por validar" deben convertirse en "Validado" o "Blocker: [descripción]".
>
> Fullsite — Restaurant Operating System

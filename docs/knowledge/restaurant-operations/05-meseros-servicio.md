# 05 — Meseros y Servicio

> Patrones de autenticación, permisos, propinas, y comportamiento del personal de piso.  
> IDs: MS-001 a MS-010  
> Evidencias de fuentes exactas; no generalizar comportamientos AMALAY a todos los restaurantes.

---

## MS-001 — PIN como autenticación primaria en POS

```
ID:             MS-001
Nombre:         PIN como autenticación primaria en POS
Categoría:      Meseros / Autenticación
Clasificación:  MATCH
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         BREAK-THE-RESTAURANT.md §BLOCKER-1 (listado como primer vector de ataque);
                FULLSITE-OPERATIONS-BIBLE.md (PIN como mecanismo de sesión)
```

**Problema operacional:** El POS requiere identificar al mesero en cada acción de cobro o descuento, en un entorno donde múltiples personas comparten terminales físicamente.

**Por qué existe:** La autenticación por usuario/contraseña es impráctica en operación de piso — el mesero no puede tipear una contraseña larga decenas de veces por turno. El PIN de 4 dígitos es el estándar de facto en POS de restaurante.

**Cuándo aplica:** Inicio de sesión, cobro, apertura de turno, cancelaciones, descuentos (algunos requieren PIN de gerente).

**Comportamiento observado:**
- AMALAY usa PIN numérico como credencial primaria para todos los roles del POS.
- BREAK-THE-RESTAURANT.md §BLOCKER-1 identifica que si `pos_staff` está vacío, el sistema permite acceso Admin sin autenticación — vulnerabilidad que depende directamente de este mecanismo.
- Wansoft usa el mismo patrón con PIN opcional + huella dactilar alternativa (ver MS-004).

**Impacto operativo:** Si el PIN de un mesero es compartido o adivinado, hay acceso total a sus operaciones. El riesgo se mitiga por el TTL de caché (MS-002) y el PIN de gerente en operaciones sensibles.

**Limitaciones conocidas:**
- Sin segundo factor — PIN solo no distingue si el titular está presente.
- Compartir PINs entre meseros es operativamente posible y no detectado automáticamente.

**Preguntas abiertas:** UNK-038 (¿Existe log de auditoría por mesero en Fullsite?), UNK-039 (¿Puede el gerente resetear PINs desde la terminal o requiere deploy/admin?).

---

## MS-002 — Cache de PIN para re-autenticación silenciosa

```
ID:             MS-002
Nombre:         Cache de PIN para re-autenticación silenciosa
Categoría:      Meseros / Autenticación
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         FULLSITE-POS-BIBLE.md §constante-PIN_CACHE_TTL=900000
                DISCREPANCIA: ver Comportamiento observado
```

**Problema operacional:** El mesero no debe reingresar el PIN en cada acción, pero la sesión no puede mantenerse indefinidamente por razones de seguridad.

**Por qué existe:** Balance entre fricción operativa (PIN en cada orden) y seguridad (expiración por inactividad).

**Cuándo aplica:** Después de cada autenticación exitosa, la identidad del mesero queda en caché. El TTL exacto es objeto de discrepancia (ver abajo).

**Comportamiento observado:**
- FULLSITE-POS-BIBLE.md line 1234 cita: `PIN_CACHE_TTL | 900000 (15 min) | pos/layout.tsx`
- Auditoría de código (2026-08-04): `pos/layout.tsx` NO contiene `PIN_CACHE_TTL`. La constante no existe en el archivo citado.
- Lo que existe en producción: `_LEGACY_PIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000` (86400000ms = 24h) en `pos-data.ts:1681`, marcado como btoa fallback siendo retirado ("Goal is 0 hits per terminal before retiring the legacy cache").
- El valor 900000ms (15 min) no está presente en el código de producción.
- La re-autenticación es silenciosa — el mesero ve un prompt de PIN sin mensaje de error.
- Distinto del `IDLE_TIMEOUT_MS = 1800000` (OP-011): idle timeout cierra la sesión completa.

**Impacto operativo:** El TTL real del cache de PIN determina la ventana de riesgo de uso no autorizado de una terminal. Hasta que se resuelva la discrepancia, el valor no puede ser afirmado.

**Limitaciones conocidas:**
- El valor 900s (15 min) de la bible no coincide con el código de producción.
- `_LEGACY_PIN_CACHE_TTL_MS` está en proceso de retiro — el mecanismo actual de cache puede diferir.

**Preguntas abiertas:** UNK-040 (¿Cuál es el TTL de cache de PIN activo en producción? ¿Qué reemplaza al legacy btoa cache?), UNK-053 (¿La bible FULLSITE-POS-BIBLE.md §PIN_CACHE_TTL reflejaba un valor planeado o un estado anterior del código?).

---

## MS-003 — 50 registros de staff activos en AMALAY

```
ID:             MS-003
Nombre:         50 registros de staff activos en AMALAY
Categoría:      Meseros / Configuración AMALAY
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         FULLSITE DOCS/15-AMALAY/FULLSITE-OPERATIONS.md §staff
```

**Problema operacional:** AMALAY opera con personal variable — meseros de turno, eventuales, gerentes, cocina. La base de datos de staff debe reflejar quién tiene acceso activo.

**Por qué existe:** Dato de configuración real de AMALAY, relevante para el tamaño del directorio de PINs y el riesgo de PINs activos de personal que ya no trabaja.

**Cuándo aplica:** Contexto de tamaño de operación AMALAY. No generalizable a otros clientes.

**Comportamiento observado:**
- 50 registros activos en `pos_staff` según FULLSITE-OPERATIONS.md.
- Include meseros, gerentes, cocina, y MESERO EVENTO (ver MS-007).

**Impacto operativo:** Con 50 PINs activos, la probabilidad de PINs "olvidados" o compartidos es real. El riesgo de acceso por PIN de ex-empleado requiere gestión activa de bajas.

**Limitaciones conocidas:** No se sabe cuántos de los 50 están activos en rotación simultánea vs. registros históricos no dados de baja.

**Preguntas abiertas:** UNK-041 (¿Cuántos de los 50 staff tienen turno activo en promedio por semana en AMALAY?).

---

## MS-004 — Wansoft: huella dactilar como autenticación alternativa

```
ID:             MS-004
Nombre:         Wansoft: huella dactilar como autenticación alternativa
Categoría:      Meseros / Autenticación
Clasificación:  WANSOFT-ONLY
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         WANSOFT-BIBLE.md §seguridad
```

**Problema operacional:** El PIN puede ser compartido, olvidado o forzado. Algunos operadores requieren una segunda forma de identificación biométrica.

**Por qué existe:** Wansoft soporta lector de huella dactilar como alternativa al PIN para autenticar meseros. Elimina el riesgo de PINs compartidos. Se configuran como complemento, no como reemplazo total.

**Cuándo aplica:** Solo en instalaciones de Wansoft con hardware de huella dactilar configurado. No universal.

**Comportamiento observado:**
- WANSOFT-BIBLE.md §seguridad documenta huella dactilar como opción de autenticación.
- Fullsite no tiene equivalente documentado.

**Impacto operativo:** En entornos de alto fraude de personal, la biometría reduce el riesgo de operaciones falsas atribuidas a otro mesero.

**Limitaciones conocidas:**
- No documentado si AMALAY tiene este hardware activo.
- WANSOFT-ONLY: Fullsite no lo implementa.

**Preguntas abiertas:** UNK-042 (¿Usa AMALAY lectores de huella? ¿El hardware existe físicamente en las terminales?).

---

## MS-005 — Propina como campo de entrada en el cobro

```
ID:             MS-005
Nombre:         Propina como campo de entrada en el cobro
Categoría:      Meseros / Cobro
Clasificación:  MATCH
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         FULLSITE-OPERATIONS-BIBLE.md §cobro;
                CLAUDE.md §wansoft_daily columna propinas_total y columna meseros[].total
```

**Problema operacional:** La propina en México no es automática — el cliente la decide en el momento del cobro. El POS debe capturarla explícitamente para reportarla por separado.

**Por qué existe:** La propina en restaurante varía por cliente y mesero. Separarla del total facilita el control fiscal, el tip-out a cocina, y el ranking de meseros por desempeño.

**Cuándo aplica:** Flujo de cobro: después del total de consumo, antes de confirmar pago. Se captura como monto o porcentaje y se suma al total del ticket.

**Comportamiento observado:**
- `wansoft_daily.propinas_total` registra el total de propinas del día.
- `wansoft_daily.meseros[]` incluye `{nombre, total}` donde total incluye propinas atribuidas al mesero.
- Fullsite captura propina en el flujo de cobro (FULLSITE-OPERATIONS-BIBLE.md §cobro).
- Wansoft registra propinas por mesero en `wansoft_daily.propinas_meseros` (CLAUDE.md §wansoft_kpis).

**Impacto operativo:** Sin captura de propina en POS, el dato se pierde o se registra de forma no trazable. La propina declarada permite el cálculo de tip-out y los rankings de meseros.

**Limitaciones conocidas:**
- No se sabe si la propina se puede editar post-cobro o si es definitiva al cerrar la cuenta.

**Preguntas abiertas:** UNK-043 (¿Puede el cajero corregir una propina después de cerrar el cobro? ¿Qué sucede con la diferencia en efectivo?).

---

## MS-006 — Pool de propinas — distribución al equipo

```
ID:             MS-006
Nombre:         Pool de propinas — distribución al equipo
Categoría:      Meseros / Propinas
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      INFERRED
Fuente:         FULLSITE-OPERATIONS-BIBLE.md §propinas (inferido del campo tip-out 5% a cocina en OP-004)
```

**Problema operacional:** Las propinas registradas en el POS deben distribuirse entre el personal. Las reglas de distribución varían por restaurante.

**Por qué existe:** En AMALAY existe una política documentada de tip-out: 5% de las propinas a cocina (CJ-006). El resto va al mesero. Esta política debe ser configurable y aplicarse de forma trazable.

**Cuándo aplica:** Al cierre de turno o al finalizar el periodo de corte, el gerente o sistema aplica la distribución.

**Comportamiento observado:**
- CJ-006 documenta que AMALAY aplica 5% de propinas a cocina.
- No hay evidencia de que Fullsite calcule el tip-out automáticamente — puede ser manual.
- Wansoft registra propinas por mesero pero no hay documentación de que automatice la distribución.

**Impacto operativo:** Sin automatización del tip-out, el gerente debe calcularlo manualmente en cada cierre. Con 10+ meseros y propinas variables, es una fuente de error o conflicto.

**Limitaciones conocidas:** Sin evidencia de implementación automática en Fullsite.

**Preguntas abiertas:** UNK-009 (¿Fullsite calcula el tip-out automáticamente o el gerente lo hace manualmente?).

---

## MS-007 — MESERO EVENTO: categoría especial para eventos

```
ID:             MS-007
Nombre:         MESERO EVENTO: categoría especial para eventos
Categoría:      Meseros / Configuración AMALAY
Clasificación:  UNKNOWN
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         CLAUDE.md §meseros-activos (aparece literal en la lista de meseros activos de AMALAY)
```

**Problema operacional:** Los eventos en AMALAY (bodas, cumpleaños, eventos corporativos) implican personal adicional o temporal que no opera como mesero de piso regular.

**Por qué existe:** MESERO EVENTO es un registro de staff genérico usado para atribuir ventas y propinas de eventos a una categoría específica, sin necesidad de crear un usuario individual para el personal eventual.

**Cuándo aplica:** Cuando AMALAY recibe eventos con personal externo o temporal asignado al espacio de eventos (ver `amalay_reservaciones.espacio`).

**Comportamiento observado:**
- CLAUDE.md §meseros-activos lista "MESERO EVENTO" como mesero activo junto a los nombres individuales.
- Este registro agrupa todas las ventas del evento bajo un solo nombre, independientemente de cuántos meseros eventuales atendieron.

**Impacto operativo:** Las ventas de eventos no se atribuyen a un mesero individual — los rankings de desempeño pueden estar sesgados en días con eventos grandes.

**Limitaciones conocidas:** No se sabe si MESERO EVENTO tiene un PIN único compartido o si se maneja de otra manera en campo.

**Preguntas abiertas:** UNK-044 (¿Cómo se gestiona el PIN de MESERO EVENTO? ¿Es un PIN compartido entre el personal de evento?).

---

## MS-008 — Ranking de meseros por ventas — accesible en dashboard

```
ID:             MS-008
Nombre:         Ranking de meseros por ventas — accesible en dashboard
Categoría:      Meseros / Reportes
Clasificación:  SURPASS
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         CLAUDE.md §wansoft_daily columna meseros (JSONB: [{nombre, total}]);
                CLAUDE.md §wansoft_kpis columna propinas_meseros (JSONB: [{nombre, total}])
```

**Problema operacional:** El gerente necesita saber qué mesero vendió más y cuántas propinas recibió para gestionar incentivos, programar turnos, y detectar problemas de servicio.

**Por qué existe:** La granularidad por mesero dentro de `wansoft_daily` permite construir rankings históricos sin necesidad de reportes manuales. El dato viene del POS (Wansoft o Fullsite) agregado a nivel de día.

**Cuándo aplica:** Al final del día, al revisar el reporte semanal, o en el daily briefing matutino.

**Comportamiento observado:**
- `wansoft_daily.meseros` contiene `[{nombre, total}]` — ventas atribuidas por mesero.
- `wansoft_kpis.propinas_meseros` contiene `[{nombre, total}]` — propinas del día en curso.
- El comando `/top-meseros [dias]` de CLAUDE.md consulta esta columna para generar ranking.
- Wansoft muestra propinas por mesero pero no hay evidencia de ranking accesible sin reporte manual.

**Limitaciones conocidas:**
- `wansoft_daily.platillos_top` mezcla platillos, meseros y grupos — CLAUDE.md advierte "filtrar con cuidado".
- Los datos son del scraper de Wansoft, no de Fullsite POS directamente.

**Preguntas abiertas:** UNK-045 (¿El ranking de meseros en Fullsite POS está basado en datos en tiempo real o solo en `wansoft_daily`?).

---

## MS-009 — Wansoft: permiso "¿Se preparó?" — validación pre-cobro

```
ID:             MS-009
Nombre:         Wansoft: permiso "¿Se preparó?" — validación pre-cobro
Categoría:      Meseros / Permisos
Clasificación:  WANSOFT-ONLY
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         WANSOFT-BIBLE.md §permisos
```

**Problema operacional:** En restaurantes de alta rotación o con cocina visible, el mesero puede intentar cobrar una cuenta antes de que todos los platillos estén en la mesa. El sistema necesita un control que prevenga cobros prematuros.

**Por qué existe:** Wansoft implementa un paso de validación pre-cobro donde el mesero (o gerente) confirma que todos los platillos de la orden fueron preparados y entregados al cliente antes de proceder al cobro.

**Cuándo aplica:** Antes de cerrar el cobro en Wansoft, dependiendo de la configuración del restaurante.

**Comportamiento observado:**
- WANSOFT-BIBLE.md §permisos documenta este flujo como permiso configurable.
- Fullsite no tiene equivalente documentado — el cobro procede sin validación de entrega.

**Impacto operativo:** Sin este control, un mesero puede cobrar una cuenta con platillos pendientes de entrega, generando quejas o devoluciones.

**Limitaciones conocidas:** No se sabe si AMALAY tiene este permiso activado en su instancia de Wansoft.

**Preguntas abiertas:** UNK-046 (¿AMALAY usa el permiso "¿Se preparó?" en Wansoft? ¿Fullsite lo necesita?).

---

## MS-010 — Wansoft: permisos en dos pasos (solicitar + autorizar)

```
ID:             MS-010
Nombre:         Wansoft: permisos en dos pasos (solicitar + autorizar)
Categoría:      Meseros / Permisos
Clasificación:  WANSOFT-ONLY
Estado ficha:   DOCUMENTED
Evidencia:      DOCUMENTED
Fuente:         WANSOFT-BIBLE.md §permisos
```

**Problema operacional:** Ciertas operaciones sensibles (descuentos grandes, cancelaciones post-cobro, cortesías) requieren autorización de un superior, no solo del mesero que realiza la acción.

**Por qué existe:** El modelo de dos pasos (el mesero solicita, el gerente autoriza con su PIN) crea un trail de auditoría claro y evita que un mesero realice operaciones sensibles sin supervisión.

**Cuándo aplica:** Operaciones que superan umbrales configurados en Wansoft: descuentos > X%, cancelaciones de cuenta, cortesías especiales.

**Comportamiento observado:**
- WANSOFT-BIBLE.md §permisos documenta el flujo de dos pasos.
- Fullsite implementa PIN de gerente para descuentos (CJ-011), pero no está documentado si tiene el flujo de solicitud explícita equivalente.
- En AMALAY, el gerente ingresa su PIN directamente en la terminal del mesero para autorizar.

**Impacto operativo:** Sin el flujo de dos pasos, el gerente debe estar físicamente presente en cada operación sensible. Con el flujo, el mesero inicia la solicitud y el gerente puede aprobar en cualquier terminal.

**Limitaciones conocidas:** No hay documentación del flujo completo de autorización remota en Fullsite.

**Preguntas abiertas:** UNK-047 (¿Fullsite soporta autorización remota de gerente — el gerente puede aprobar desde su propia terminal sin estar en la del mesero?).

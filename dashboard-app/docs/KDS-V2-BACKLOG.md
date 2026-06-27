# KDS v2 — Backlog de Evolucion

Status: **backlog activo** — no implementar hasta que Fullsite opere 2-4 semanas en produccion

Principio rector: **confiabilidad primero, innovacion despues.**
Cada propuesta requiere evidencia de operacion real antes de implementarse.

---

## NOW — Implementar antes de migrar completamente a Fullsite

Estos cambios son ajustes minimos que reducen riesgo de rechazo por parte
del chef durante la transicion de Wansoft a Fullsite. No cambian el flujo
de trabajo — solo mejoran la legibilidad del flujo actual.

### V-03: Modificadores en rojo/rosa de alto contraste

- **Hipotesis**: El chef confunde items con modificadores porque ambos son
  texto claro sobre fondo oscuro. Cambiar modificadores a rojo reduce
  errores de lectura.
- **Como medir**: Observar al chef durante 1 turno. Contar cuantas veces
  pregunta "eso es el platillo o el extra?" Comparar antes/despues.
- **Evidencia necesaria**: Ninguna — es un cambio de color CSS sin cambio
  funcional. Bajo riesgo.
- **Riesgo de cambio**: Nulo. No cambia el flujo, no cambia la posicion de
  elementos, no cambia la interaccion.
- **Complejidad**: S (5 minutos — cambiar `text-amber-300` a `text-red-400`)
- **Clasificacion**: NOW

### V-06: Mesa numero a 48-60px

- **Hipotesis**: A 3+ metros el chef no distingue mesa 32 de mesa 30. Un
  numero mas grande elimina la necesidad de acercarse a la pantalla.
- **Como medir**: Poner el KDS a 3 metros del chef. Pedirle que diga el
  numero de mesa de cada tarjeta. Comparar velocidad antes/despues.
- **Evidencia necesaria**: Confirmar con el chef que el numero de mesa es
  lo primero que busca (no el nombre del platillo ni el mesero).
- **Riesgo de cambio**: Bajo. Puede reducir espacio para otros elementos,
  pero el chef no usa los elementos que se sacrifican.
- **Complejidad**: S (10 minutos — cambiar `text-3xl` a `text-5xl`, quitar
  badge de status del mismo renglon)
- **Clasificacion**: NOW

### V-09: Quitar mesero y personas de la vista principal

- **Hipotesis**: El chef no mira el nombre del mesero ni el conteo de
  personas durante la preparacion. Esa informacion ocupa espacio que
  podria usarse para items.
- **Como medir**: Preguntar al chef: "cuando preparas, miras el nombre del
  mesero?" Si dice que no, quitarlo. Si dice que si, dejarlo.
- **Evidencia necesaria**: 1 entrevista de 5 minutos con el chef.
- **Riesgo de cambio**: Medio. Algunos chefs usan el nombre del mesero para
  comunicar ("Oscar, tu platillo esta listo"). Si es el caso, mover el
  mesero a una posicion secundaria en vez de eliminarlo.
- **Complejidad**: S (10 minutos)
- **Clasificacion**: NOW (pero validar con entrevista primero)

### V-10: Tiempo en MM:SS en vez de Xm

- **Hipotesis**: "12m" se confunde con cantidades a distancia. "12:00" es
  inequivoco y mas legible.
- **Como medir**: Comparar velocidad de lectura. Pedir al chef que diga
  el tiempo de cada tarjeta con formato actual vs nuevo.
- **Evidencia necesaria**: Ninguna — cambio de formato sin cambio funcional.
- **Riesgo de cambio**: Nulo.
- **Complejidad**: S (5 minutos — cambiar formato en `getElapsedMinutes`)
- **Clasificacion**: NOW

### V-05: Separadores de tiempo/curso visibles en cocina

- **Hipotesis**: El chef no ve los separadores de tiempo cuando esta en
  filtro de estacion. Esto causa que prepare el segundo tiempo antes del
  primero.
- **Como medir**: Observar si el chef pregunta "este va primero o despues?"
  Si la pregunta es frecuente, el separador no es visible.
- **Evidencia necesaria**: Observar 1 turno en hora pico.
- **Riesgo de cambio**: Bajo. Agrega informacion, no la quita.
- **Complejidad**: S (15 minutos — cambiar filtro para mostrar `__tiempo__`
  en todas las vistas)
- **Clasificacion**: NOW

---

## NEXT — Implementar despues de 2-4 semanas de operacion estable

Estas propuestas cambian la forma en que el chef interactua con el KDS.
Requieren evidencia de operacion real para validar que resuelven un
problema que realmente existe, no uno que asumimos.

### V-01: Batch counter en header (conteo por platillo)

- **Hipotesis**: El chef cuenta mentalmente cuantos platillos iguales hay
  entre tarjetas para hacer batch. Un conteo automatico reduce el tiempo
  de planificacion y elimina errores de conteo.
- **Como medir**: Cronometrar tiempo desde que el chef mira la pantalla
  hasta que empieza a preparar. Medir con y sin batch counter.
  Target: reduccion de 10+ segundos por ciclo de batch.
- **Evidencia necesaria**: Observar al chef durante 3 turnos de hora pico.
  Documentar: cuantas veces cuenta mentalmente? Cuantas veces cuenta
  mal? Cuanto tiempo pierde contando?
- **Riesgo de cambio**: Bajo-medio. El batch counter es informacion nueva,
  no reemplaza nada. Pero si el chef no lo entiende o no lo usa, ocupa
  espacio valioso en el header.
- **Complejidad**: M (1 hora — calcular conteo por platillo agrupando items
  de todas las ordenes pendientes)
- **Clasificacion**: NEXT

### V-02: Ordenar tarjetas por tiempo de espera

- **Hipotesis**: El chef pierde tiempo decidiendo "que hago ahora" cuando
  hay 8+ tarjetas nuevas. Si la mas urgente siempre esta arriba a la
  izquierda, elimina la decision.
- **Como medir**: Rastrear el orden en que el chef toca las tarjetas. Si ya
  toca de izquierda a derecha, el orden actual funciona. Si salta entre
  tarjetas buscando la mas urgente, el orden por tiempo es mejor.
- **Evidencia necesaria**: 2-3 turnos de observacion. Documentar patron de
  interaccion con las tarjetas.
- **Riesgo de cambio**: Medio. Cambiar el orden de las tarjetas puede
  desorientar al chef si ya tiene un mapa mental del layout. Las tarjetas
  se mueven cuando se actualizan, lo cual puede ser confuso.
- **Complejidad**: S (15 minutos — cambiar sort de `priority[status]` a
  `new Date(created_at).getTime()`)
- **Clasificacion**: NEXT

### V-04: Mesa completa indicator (3/3 listos)

- **Hipotesis**: El chef no sabe cuando una mesa tiene todos los platillos
  listos para servir. Grita al mesero "pasa mesa 46" sin saber si el
  postre aun esta en preparacion.
- **Como medir**: Contar cuantas veces el chef pregunta "ya esta todo de
  la 46?" o cuantas veces el mesero pasa incompleto.
- **Evidencia necesaria**: Observar la coordinacion chef-mesero durante
  2 turnos. Si el problema no existe (porque se comunican bien verbalmente),
  no implementar.
- **Riesgo de cambio**: Bajo. Es informacion adicional, no reemplaza nada.
- **Complejidad**: M (30 minutos — necesita consultar todas las ordenes de
  la mesa y contar items por status)
- **Clasificacion**: NEXT

### V-07: Urgencia progresiva (escalamiento visual por tiempo)

- **Hipotesis**: El indicador binario (normal vs rojo a 15 min) no ayuda
  al chef a priorizar entre ordenes de 6, 10 y 14 minutos. Un escalamiento
  gradual le da informacion continua.
- **Como medir**: Comparar tiempo promedio de entrega antes/despues.
  Si el tiempo promedio baja, el escalamiento funciona.
- **Evidencia necesaria**: Baseline de tiempos actuales (2 semanas de datos).
- **Riesgo de cambio**: Bajo. Cambios puramente visuales.
- **Complejidad**: S (15 minutos — agregar breakpoints de tiempo con clases
  CSS distintas)
- **Clasificacion**: NEXT

### V-08: Boton de avance 56px alto

- **Hipotesis**: El boton actual (52px, `py-3`) es dificil de tocar con
  guantes de cocina. Un boton mas grande reduce misclicks.
- **Como medir**: Contar misclicks por turno. Si el chef toca el boton y
  no pasa nada (o toca fuera), el target es muy chico.
- **Evidencia necesaria**: Observar 1 turno. Nota: el chef de AMALAY puede
  no usar guantes — validar.
- **Riesgo de cambio**: Nulo.
- **Complejidad**: S (5 minutos)
- **Clasificacion**: NEXT

---

## LATER — Ideas para cuando tengamos evidencia y volumen

Estas propuestas son innovaciones que requieren datos historicos, multiples
restaurantes, o cambios significativos en el flujo de trabajo. No
implementar hasta tener al menos 4 semanas de operacion estable y
feedback estructurado de 2+ chefs.

### V-11: Batch mode toggle (agrupar por platillo)

- **Hipotesis**: En hora pico con 40+ ordenes, el chef prepara mas rapido
  si ve "4x Half Half" en una sola tarjeta en vez de 4 tarjetas separadas.
- **Como medir**: A/B test con el chef: 1 turno normal, 1 turno con batch
  mode. Comparar tiempo de entrega y errores.
- **Evidencia necesaria**: Confirmar que el chef realmente hace batch (no
  todos lo hacen — depende del tipo de cocina y del flujo de la estacion).
- **Riesgo de cambio**: Alto. Cambia fundamentalmente como el chef ve las
  ordenes. Requiere entrenamiento y puede causar errores si los
  modificadores difieren entre mesas.
- **Complejidad**: L (2-3 horas — agrupar items por nombre normalizado,
  mostrar modificadores por mesa, boton de "marcar todo")
- **Clasificacion**: LATER

### V-12: Prediccion de carga (mesas sin enviar)

- **Hipotesis**: Si el chef sabe que hay 3 mesas abiertas que aun no
  enviaron, puede empezar a preparar bases anticipadamente.
- **Como medir**: Medir si el tiempo de preparacion baja cuando el chef
  tiene aviso previo vs cuando no.
- **Evidencia necesaria**: Necesitamos datos de al menos 2 semanas para
  calcular patrones de envio. Tambien necesitamos confirmar que el chef
  realmente prepara bases anticipadamente.
- **Riesgo de cambio**: Bajo (es informacion adicional) pero puede generar
  ansiedad si el chef ve "8 platillos por llegar" y se estresa.
- **Complejidad**: M (1 hora — consultar mesas con status abierta que
  tengan items pero no hayan enviado)
- **Clasificacion**: LATER

### V-13: Tema claro para cocinas

- **Hipotesis**: En cocinas con luz fluorescente, una pantalla dark tiene
  menor contraste que una pantalla light. Un tema claro seria mas legible.
- **Como medir**: Foto del KDS en la cocina real de AMALAY. Si el texto
  se lee bien a 3 metros, el tema dark funciona. Si no, probar light.
- **Evidencia necesaria**: 1 foto de la pantalla en condiciones reales de
  iluminacion.
- **Riesgo de cambio**: Medio. El cambio de tema afecta la percepcion
  completa del producto. Mejor hacer un toggle que un cambio global.
- **Complejidad**: M (30 minutos para un toggle, 2 horas para un tema
  light completo)
- **Clasificacion**: LATER

### V-14: Voice announcement

- **Hipotesis**: El chef no siempre esta mirando la pantalla. Un anuncio
  por voz ("Nueva orden, mesa 46, un half half combo") le permite recibir
  la orden sin dejar de preparar.
- **Como medir**: Comparar tiempo de reaccion a nueva orden: con sonido
  generico actual vs con voz. Target: el chef empieza a preparar sin
  mirar la pantalla.
- **Evidencia necesaria**: Confirmar que la cocina no es demasiado ruidosa
  para escuchar un speaker. Confirmar que el chef no lo encontraria
  molesto o distractor.
- **Riesgo de cambio**: Alto. Puede ser genial o puede ser insoportable.
  Solo implementar despues de preguntar al chef.
- **Complejidad**: M (1 hora — Web Speech API, simple pero requiere manejo
  de cola para no hablar sobre si mismo)
- **Clasificacion**: LATER

### V-15: Tiempo promedio aprendido por platillo

- **Hipotesis**: Despues de 2+ semanas, el sistema conoce el tiempo promedio
  de preparacion de cada platillo. Puede alertar cuando un platillo esta
  tardando mas de lo normal.
- **Como medir**: Calcular promedio y desviacion estandar por platillo.
  Alertar cuando el tiempo actual > promedio + 1 desviacion.
- **Evidencia necesaria**: Minimo 2 semanas de datos con timestamps de
  enviada -> preparando -> lista. Sin esos datos, no hay baseline.
- **Riesgo de cambio**: Bajo (es informacion adicional) pero las alertas
  falsas pueden generar "alert fatigue" y hacer que el chef ignore todas.
- **Complejidad**: M (1-2 horas — query historica + calculo de stats +
  comparacion en tiempo real)
- **Clasificacion**: LATER

---

## Criterios de repriorización

Revisar este backlog cada 2 semanas con estas preguntas:

1. Que problema reporto el chef esta semana?
2. Que observamos durante hora pico?
3. Que tarea le toma mas tiempo al chef?
4. Que error se repitio mas de 2 veces?
5. Que pregunta hace el chef que el KDS deberia responder?

Si un item LATER resuelve un problema observado, sube a NEXT.
Si un item NEXT no resuelve un problema real, baja a LATER o se elimina.

---

## Regla de oro

No implementar ninguna propuesta NEXT o LATER sin antes responder:

1. Vi este problema ocurrir en la cocina real de AMALAY? (no asumido)
2. El chef me dijo que esto es un problema? (no inferido)
3. Puedo medir si mejoro despues de implementarlo? (no subjetivo)

Si alguna respuesta es "no", la propuesta espera.

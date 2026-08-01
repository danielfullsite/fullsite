# FULLSITE — COMPANY BRAIN

> La tesis completa. La evolución del pensamiento. Los aprendizajes que no encajan
> en documentación técnica pero que son igual de críticos para construir bien.
> Última actualización: 2026-07-02

---

## La tesis en una oración

Los restaurantes no tienen un problema de software. Tienen un problema de decisiones.
Fullsite es la capa de inteligencia operativa que los ayuda a tomar mejores decisiones todos los días.

---

## Por qué existen los restaurantes y por qué importa esto

Un restaurante no es un punto de venta con mesas. Es una operación de manufactura
en tiempo real: recibe insumos, los transforma, los entrega, cobra, y repite
300+ veces por turno. Con 40 personas operando simultáneamente, información dispersa,
y márgenes de 5-15%.

El gerente que opera con intuición y experiencia puede manejar un restaurante.
Pero no puede escalar. No puede identificar qué está fallando a las 3pm del martes.
No puede saber si el food cost subió porque cambió el proveedor o porque hay merma.
No puede estar en todas partes al mismo tiempo.

Fullsite existe para que el gerente tenga toda esa información cuando la necesita,
no cuando el contador la procesa a fin de mes.

---

## Evolución del pensamiento (cómo llegamos aquí)

### Fase 1: "Construyamos un POS mejor" (antes de la auditoría)

La hipótesis inicial era que Wansoft era malo y que un POS moderno lo reemplazaría.
Esta hipótesis era parcialmente correcta pero incompleta.

### Fase 2: La auditoría de Wansoft (mayo 2026)

Wansoft tiene 822 stored procedures, 47 formatos de impresión, y ha operado
restaurantes en México durante 20 años. No es malo — es profundo.

Lección: No puedes reemplazar 20 años de lógica de negocio en 6 meses.
Lo que sí puedes hacer es construir encima de esa realidad.

### Fase 3: "Fullsite no es un POS. Es un Restaurant OS" (junio 2026)

El insight crítico: el problema no es el POS. El problema es lo que pasa
después del POS. Los datos generados por el POS mueren en el sistema local.
No se procesan. No generan inteligencia. No cambian decisiones.

La oportunidad: conectar todo, entender todo, y convertir esa comprensión
en decisiones mejores.

### Fase 4: Shadow Mode y Event Store (junio 2026)

Decisión estratégica: no reemplazar Wansoft todavía.
Correr Fullsite en paralelo, capturando todos los eventos de Wansoft,
construyendo el dataset que eventualmente alimentará la inteligencia.

Razón: la inteligencia operativa solo es posible si tienes datos confiables.
El Event Store es la fundación. Sin él, los agentes de IA no tienen base.

### Fase 5: Cutover AMALAY (julio 2026 — en progreso)

El primer restaurante corriendo completamente con Fullsite como sistema primario.
No es el fin del camino — es la prueba de que el sistema puede operar solo.

---

## La narrativa para inversionistas

### Lo que NO decimos

- "Somos el mejor POS del mercado" → demasiado estrecho
- "Seremos unicornio" → sin evidencia, pierde credibilidad
- "Vamos a disrumpir la industria" → cliché sin contenido

### Lo que SÍ decimos

Cada negocio físico está volviéndose intelligence-native. Los restaurantes son primero.

Software → Intelligence → Autonomy.

2026: Restaurant OS — operación unificada, datos en tiempo real, IA de monitoreo.
2027: Operational Intelligence — recomendaciones proactivas, motor de decisiones.
2028+: Autonomous Restaurant — decisiones rutinarias ejecutadas automáticamente.

El ERP transformó empresas. El POS digitalizó restaurantes.
Fullsite construye la capa de inteligencia que los opera.

No competimos con Toast, Square, ni Wansoft en el mercado de POS.
Competimos en el mercado que todavía no existe: el de Systems of Intelligence
para operaciones físicas. El POS es la puerta de entrada. Los datos son el moat.

### La pregunta que un inversionista de YC haría

"¿Por qué este equipo, este mercado, este momento?"

Respuesta:
- Este equipo: operadores, no consultores. Conocemos el restaurante desde adentro.
- Este mercado: 600K+ restaurantes en México, $2B+ gasto en software en LATAM.
  Cero soluciones de inteligencia operativa. El timing es ahora.
- Este momento: LLMs hacen posible hoy lo que era imposible hace 3 años.
  Cualquier gerente puede "hablar" con sus datos sin aprender SQL.

---

## Lo que aprendimos de la auditoría de Wansoft

Wansoft es la referencia. No el enemigo.

20 lecciones documentadas en `docs/knowledge/wansoft/BACKOFFICE-KNOWLEDGE.md`.
Las más importantes:

**1. La operación tiene lógica que no está en el código.**
El gerente sabe cosas que el sistema no captura. Esa información es oro.
El trabajo de Fullsite es extraerla y hacerla explícita.

**2. Los workarounds revelan los gaps del producto.**
Cada vez que el staff hace algo "de forma especial" para que el sistema funcione,
hay un gap de producto. Observar workarounds es la forma más barata de hacer product discovery.

**3. La resistencia al cambio no es irracional.**
Wansoft lleva 20 años. El gerente lo conoce perfectamente.
"Aprender un sistema nuevo" no es solo capacitación — es riesgo operativo real.
Por eso el onboarding tiene que ser tan fluido que parezca invisible.

**4. El dato más valioso no está en el POS.**
Está en la cabeza del gerente. "¿Cuánto vendemos normalmente un viernes?
¿Qué pasa cuando llueve? ¿Quién es el mesero que más vende en la noche?"
Fullsite existe para hacer esa información explícita y accionable.

---

## Framework D-F-E-T (Product Discovery)

Para cada visita operativa, clasificar la información encontrada:

**D — Dispersa:** La información existe pero está fragmentada. El gerente la tiene
en WhatsApp, en Excel, en papel, en su cabeza. Fullsite la centraliza.

**F — Faltante:** La información no existe en ninguna parte. Nadie la captura.
Fullsite la genera por primera vez.

**E — En la cabeza del gerente (Experience):** La información existe pero solo como
conocimiento tácito de una persona. Si el gerente falta, el conocimiento se pierde.
Fullsite lo hace explícito.

**T — Tardía:** La información llega cuando ya no puedes actuar. El food cost
del mes llega a fin de mes. La alerta de merma llega cuando el ingrediente ya se acabó.
Fullsite la hace llegar cuando todavía puedes hacer algo.

---

## Los 5 filtros de priorización

Todo lo que construimos debe acercarnos a una de estas cinco cosas:

1. Operar AMALAY sin que Daniel intervenga.
2. Repetir la instalación en el restaurante #2.
3. Reducir el tiempo de onboarding.
4. Aumentar la confianza en la integridad de los datos.
5. Mejorar la narrativa para YC / inversionistas con evidencia real.

Si algo no ayuda a una de esas cinco cosas, probablemente no es prioridad.

---

## Lo que aprendimos de las entrevistas de cofundadores (julio 2026)

### De Hugo (operations architect, 8.5/10)

- Framework State → Future State → Gap: es exactamente lo que Fullsite vende a restaurantes,
  pero no lo hemos aplicado internamente. Cada decisión de producto debería empezar con ese análisis.
- "No agrego nada que no hayan pedido 100 clientes" → el parking lot (Idea / Evidencia / Impacto / Decisión)
  es la implementación concreta de ese principio.
- "No le puedes meter IA a una empresa que no tiene sus procesos automatizados" → la secuencia correcta
  es: proceso → automatización → inteligencia. Fullsite debe respetar esa secuencia.

### De Mike (ex-CTO→CEO, YC S21, 7.5/10)

- "Si nos das 2 años después de lo que nos dimos cuenta que había que hacer, lo hacemos bien" →
  decidir rápido cuando hay suficiente evidencia. No 2 años después.
- "¿Estarías dispuesto a tirar lo que tienes?" → no enamorarse del código. El producto correcto
  es el que resuelve el problema, no el que más trabajo costó construir.
- "El día que no eres la persona más capaz para hacer el trabajo, la empresa necesita a alguien más" →
  ser honesto sobre los propios límites.

### De Samuel (engineering lead)

- Spec antes de código: especificación → interfaces → contratos → criterios de aceptación.
  El orden no es opcional.
- Observabilidad como requisito de producción: el sistema debe anunciarse cuando algo falla,
  no esperar que alguien lo descubra.

---

## Lo que creemos sobre el futuro de los restaurantes

1. **Toda operación física se vuelve intelligence-native.** Los restaurantes son primero porque
   son las operaciones más complejas: manufactura en tiempo real, producto perecedero, alta rotación,
   márgenes delgados, y múltiples puntos de falla simultáneos.

2. **El dato operativo es el activo más valioso que un restaurante tiene y no sabe que tiene.**
   Cada ticket, cada modificación, cada cancelación, cada turno — es información que hoy muere
   dentro del sistema. Fullsite la hace útil.

3. **La automatización precede a la inteligencia.** No puedes poner IA sobre un proceso no automatizado.
   El primer trabajo de Fullsite es hacer que la operación funcione bien. El segundo es hacerla inteligente.

4. **El mercado no necesita otro POS. Necesita un OS.**
   La diferencia entre un POS y un OS no es de features — es de filosofía. Un POS registra lo que pasa.
   Un OS entiende lo que pasa y ayuda a hacer que pase mejor.

---

## Riesgos estratégicos (no técnicos)

**1. Construir para YC en vez de para el cliente.**
El riesgo de optimizar para la narrativa de inversión en vez de para la operación real.
La solución: construir primero, narrar después. La evidencia precede al pitch.

**2. Velocidad de proceso sobre velocidad de producto.**
El riesgo de implementar frameworks (OKRs, ADRs, parking lots, spec-driven) antes de
tener evidencia operativa. Los procesos escalan la ejecución. No la reemplazan.

**3. El cofundador equivocado.**
Un cofundador con las habilidades correctas pero sin Founder Commitment es peor que no tener cofundador.
Muda el equipo más lento hacia los compromisos difíciles.

---

## El criterio de éxito que importa

No es el número de restaurantes.
No es el ARR.
No es el deck.

Es esto: **¿El gerente de AMALAY toma alguna decisión diferente esta semana porque Fullsite existe?**

Si la respuesta es sí, una sola vez, tenemos product-market fit en proceso.
Si la respuesta es no después de 30 días de operación, hay un problema de propuesta de valor,
no de tecnología.

---

> Este documento captura el pensamiento que no encaja en código ni en ADRs.
> Actualizar cada vez que haya un cambio de perspectiva estratégica significativo.
> No actualizar para registrar progreso — para eso existe STATE-OF-THE-COMPANY.
>
> Fullsite — Restaurant Operating System

# Observaciones de campo del 9-10 de agosto — nunca se mapearon

**Rescatadas el 2026-08-26** de las sesiones de Codex en la máquina de Daniel. Son 9 días y
756 MB; hasta hoy sólo se había minado la del 23-24
([`EVIDENCIA-CAMPO-AMALAY-2026-08-24.md`](../offline/EVIDENCIA-CAMPO-AMALAY-2026-08-24.md)).

**44 observaciones de campo**, 43 de ellas del 9 y 10 de agosto. Ninguna llegó a la matriz
de escenarios ni a ningún documento.

> **Qué NO es esto.** No es una lista de bugs abiertos. Son observaciones de hace 16 días,
> antes del trabajo de Service Worker, del ruteo por estación configurable y de los tres P0
> del 24. Varias ya están cerradas. Lo que faltaba era que alguien las mirara.

---

> ### Aviso de método, ganado a golpes
>
> La primera versión de este documento daba por **corregida** la queja de ruteo porque la
> configuración de AMALAY tiene `bakery` en `cocina`. Daniel lo corrigió en un renglón:
> *"o sea es que tienen un KDS todo en cocina"*.
>
> El dato era correcto y la conclusión falsa. Leer la tabla de configuración no dice **cómo
> opera el restaurante** — cuántas pantallas hay, dónde están, qué debe salir en cada una.
> Sin eso, `bakery ∈ cocina` no distingue "lo arreglamos" de "siempre estuvo así".
>
> **Para cerrar una observación de campo hace falta campo.** La base de datos no basta.

## Cerradas hoy, con evidencia

### *"¿Tiene que estar siempre abierto el cmd?"* (08-10) — **No**

Pedro corre **dentro** de Electron: `main.js:209` hace
`require('./local-server')` → `startLocalServer()`. No es un proceso aparte con ventana.

La regla dura del contrato lo confirma: **Pedro muere si muere Electron.** No hay que dejar
ninguna consola abierta, y si alguien la deja, cerrarla no tumba nada.

### El ruteo por estación dejó de estar en código — pero eso **no** cierra la observación

Lo que sí cambió: el ruteo es contrato de configuración por restaurante
(`pos.station_routing`, `settings.ts:41`), no código. AMALAY tiene tres estaciones
declaradas — `caja` (market y postres), `barra` (bebidas) y `cocina` (23 categorías,
incluidas `bakery` y `toast`).

**Lo que NO se puede concluir de ahí:** que las quejas del 08-10 estén resueltas.

> *"mandé una concha de mantequilla y **no sale**, o sea el grupo de bakery va a cocina
> **también** y se **imprimió como market**"*
>
> *"mandé el mexicano toast, **no sale en KDS** y se mandó a market"*

Que hoy `bakery` figure bajo `cocina` no prueba nada: **puede ser simplemente cómo AMALAY
lo montó desde el principio.** La queja no era "bakery no debería ir a cocina" — era que el
platillo *no aparecía*, que se ruteaba a *dos* lados, y que *imprimía en la estación
equivocada*. Nada de eso se ve en la tabla de configuración.

### La topología real, que Daniel aportó y sin la cual nada de esto se puede leer

> **Una** pantalla KDS, en cocina. **Tres** POS. Impresoras con sus HID.

De ahí se sigue lo que la tabla sola no dice: **`caja` y `barra` no son pantallas, son
impresoras.** Sólo `cocina` tiene KDS.

Eso reinterpreta la queja: *"no sale en KDS"* para un artículo de market **no es un bug** —
es lo esperado. El bug era que un **toast**, que es comida, terminara ruteado a market.

### Con eso sí se puede verificar — cadena completa

| Platillo | Categoría | Estación | ¿Llega al KDS? |
|---|---|---|---|
| `EL MEXICANO TOAST` | `toast` | `cocina` | ✅ |
| `CONCHA DE MANTEQUILLA` | `bakery` | `cocina` | ✅ |

Los dos que Daniel reportó el 08-10 hoy resuelven a la pantalla de cocina. Eso es una
afirmación **en presente y comprobable** — no una afirmación de que antes estuviera roto,
que no se puede sostener sin la configuración de entonces.

### 🔴 Pero salió uno vivo

```
SPRW - TOAST SALMON   →   categoría 'activaciones'   →   estación 'barra'
```

`activaciones` tiene **un solo platillo**, y es ese toast. La categoría rutea a `barra`, que
es **impresora, no pantalla**.

O sea: un toast de salmón se imprime en la barra y **nunca aparece en el KDS de cocina**.
Es exactamente la forma de la queja del 08-10.

**No lo declaro bug**, porque no sé si ese platillo se prepara en barra — puede ser una
activación de marca servida ahí. Es una pregunta de una línea para quien opera:
*¿la SPRW Toast Salmon se hace en cocina o en barra?* Si es cocina, está mal ruteada hoy,
en producción.

> **Hallazgo lateral, ése sí sólido:** `lab-resto` **no tiene** `pos.station_routing`. Un
> restaurante nuevo nace sin ruteo. Es el tipo de dato semilla que el baseline del esquema
> no cubre — crea la forma, no el contenido.

---

## La que toca la pregunta abierta de hoy

> *"se congeló electron, se quedó congelado **hasta que prendí el internet**"* — 08-09
>
> *"a la hora de desconectar el internet no funciona y se queda freezeado"* — 08-09
>
> *"¿Qué si de repente se cae la página web de Fullsite se cae el sistema en el
> restaurante?"* — 08-10

**Esto no está documentado en ningún lado.** `grep -rliE "congel|freeze|se traba" docs/`
sólo devuelve "congelado" en el sentido de *camino congelado* o *artefacto congelado*.

Importa porque es **evidencia de campo del comportamiento offline de la cáscara**, y es
justo lo que sigue sin resolverse: `OFF-03` / `P1-4` dicen que un arranque en frío sin WAN
deja pantalla negra, pero eso salió de **leer código el 19-ago**, no de verlo fallar. Esto
sí se vio fallar — el 9 de agosto, antes del trabajo de Service Worker.

**No prueba que siga pasando.** Prueba que pasó, y que la prueba de dos minutos
—apagar WiFi, cerrar el POS, reabrirlo— no es paranoia.

---

## El tema que más se repite: el refresco de mesas

Cinco observaciones distintas, el mismo día, dicen lo mismo:

> *"puse órdenes en la 2 y sigue igual, las envié, me salí y me metí a la mesa y no sale
> nada… hasta que me meto de nuevo"*
>
> *"agarro mesa 31, agrego ítems, los envío, me salgo, sigue verde la mesa, envío más
> productos, me vuelvo a meter y no salen"*
>
> *"metí unas enchiladas y no salen al volverme a meter, hay un delay terrible"*
>
> *"**el refresh de la mesa tiene que ser inmediato** porque trataba de meter platillos sin
> que se refresheara bien y **se trababa todo**"*
>
> *"todo debe estar corriendo a la milésima"*

La última no es un bug: **es un requisito**, dicho dos veces con distintas palabras. No
aparece en la matriz de escenarios ni en ningún criterio de aceptación.

Estado hoy: sin verificar. Hay constantes de sondeo para cocina y KDS
(`POLL_INTERVAL_KITCHEN`, `POLL_INTERVAL_KDS`), pero el refresco de la vista de mesas tras
enviar no tiene ni prueba ni escenario.

---

## Las demás, sin verificar

Textuales, para que quien las revise no tenga que interpretarlas.

**Impresión y KDS**

- *"envié y no imprimió en ninguna comanda, y KDS regresó a mesa 60 chilaquiles"* (08-09)
- *"online no imprime y no llega a KDS"* (08-09)
- *"escondite no imprimía, ¿por qué será?"* (08-09)
- *"primero mandé la Heineken y luego la Amstel, la metí después y no imprimió nada"* (08-10)
- *"mandé esto a cocina y no sale nada en el KDS, debería salir inmediatamente"* (08-10)
- *"imprime pero no llega al KDS y no se puede cobrar, porque sólo imprime y en la orden que
  se envía no sale que se envió"* (08-09)
- *"no imprimía ticket al cobrar… como que quería imprimir algo y se quedaba así"* (08-10)

**Sesión y arranque**

- *"no jala mi login en Chrome normal, sólo en incógnito"* (08-09)
- *"el PIN no jala de Chrome (1234)"* (08-09)
- *"caja: entrada: se congeló toda la pantalla"* → *"no pude mandar nada a cocina porque se
  congeló la pantalla de entrada"* (08-09)
- *"la última modificación no se puso en fullscreen"* (08-10)

**Hardware**

- *"metí el PIN y me saqué, registrar huella, pongo el dedo 4 veces y no jala"* (08-10)
  — coincide con *"lector de huella no detectado"* del 24-ago, que sigue **abierto**

**Datos y presentación**

- *"el dashboard tiene muchas cosas vacías, ejemplo agentes IA no sale ninguno"* (08-10)
- *"no sale el logo de AMALAY, éste no es el bueno"* (08-10)
- *"agregar producto no se ve bien y autogenerar no funciona"* (08-10)
- *"no jala el lápiz para editar y no deja cambiarlo de mesa"* (08-10)

**Método**

- *"no jala DevTools en el sistema, tiene que ser Chrome"* (08-09, repetido el 08-10) — es
  un límite real de diagnóstico en la caja, y explica por qué tanta verificación termina
  siendo *"dime qué ves en pantalla"*

---

## Cómo se rescataron

```bash
# streaming sobre 756 MB, sin cargarlos
~/.codex/sessions/2026/08/*/*.jsonl → response_item con role=user
# 7,309 mensajes únicos → filtrar por patrones de falla observada
```

La misma técnica dio las **17 decisiones ratificadas** (ver
[`../ai/CURVA-INTRADIA-CONSTRUIDA-SIN-ENCENDER.md`](../ai/CURVA-INTRADIA-CONSTRUIDA-SIN-ENCENDER.md)).

> **Por qué importa el método más que la lista:** la matriz tiene 25 escenarios y 4 con
> evidencia de campo. Aquí hay 44 observaciones reales que nunca se mapearon a ninguno.
> No porque nadie las tomara en serio en su momento — se resolvieron muchas en vivo — sino
> porque **la evidencia vivía en un chat y el chat no es un lugar donde se pueda buscar.**

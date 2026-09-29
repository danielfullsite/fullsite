# IA del dueño: chat, voz, gráficas y agentes

> **Estado:** 2026-09-28. Ramas `feat/ventas-por-horario` (PR #445) y `feat/ia-confiable`.
> Las funciones SQL de este documento están **aplicadas en staging y producción**; el
> código de la app entra con esos PRs.
>
> Construye sobre [`ARQUITECTURA-CRUCE.md`](ARQUITECTURA-CRUCE.md) (qué sabe el sistema) y
> [`../architecture/OCM-SOURCE-AUTHORITY.md`](../architecture/OCM-SOURCE-AUTHORITY.md)
> (qué fuente manda por fecha). Este documento responde: **cómo le habla la IA al dueño sin
> inventar**.

---

## 1. Las reglas (no se negocian)

1. **Fullsite primero.** Toda lectura de venta sale del POS de Fullsite (`pos_orders`). El
   histórico importado de Wansoft (`wansoft_daily`, `wansoft_*`) sólo cubre fechas
   **anteriores** a la última fecha que tiene; después de esa fecha manda el POS
   (`continuarConPos` / `ventasFullsitePrimero` en `lib/data.ts` y `lib/pos-daily.ts`).
   Wansoft no se consulta en vivo: su feed está muerto desde 2026-09-08.
2. **Una sola regla de venta.** Una orden es venta si
   `payment_status = 'pagada'` **o** (`payment_status` es nulo **y** `status = 'cerrada'`).
   - SQL: `fs_es_venta(status, payment_status)`.
   - PostgREST: `or=(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))`.
   - TS: `FILTRO_VENTA` en `lib/agents/dia-negocio.ts`.
   Cualquier consulta nueva usa una de estas tres. Nada de `status=eq.cerrada` suelto.
3. **"Hoy" es el día de venta**, no la fecha de calendario: zona `clients.timezone`, inicio
   `clients.business_day_start_local` (default 05:00). Igual que `pos_orders.dia_venta`.
   Helpers: `contextoDia` / `leerContextoDia` (`lib/agents/dia-negocio.ts`); SQL `fs_frescura`.
4. **El modelo no hace cuentas.** Todo número que ve el LLM llega **precalculado** por código
   o SQL (sumas, %, comparativos, pronóstico). Si algo no está en el contexto, dice que no lo
   tiene calculado.
5. **Sin datos ≠ $0.** Si el POS no tiene cobertura del periodo, el contexto dice
   *"sin cobertura del POS desde <fecha>"*, nunca "$0" ni "no se vendió".
6. **Falla ≠ vacío.** Una lectura que falló se reporta ("no pude leer X"); nunca se convierte
   en lista vacía. Guardián: `regla-fallo-no-es-dato-vacio`.
7. **Fechas reales siempre.** Todo bloque de datos dice de qué fechas es ("datos hasta
   <fecha>"). El histórico viejo **sí se puede consultar** (ej. "hace un mes"); lo que no se
   hace es presentarlo como reciente. El freno de frescura (>48 h) aplica sólo a afirmaciones
   sobre *hoy/ahorita* (alertas, briefing).
8. **Un restaurante no ve a otro.** Toda consulta filtra por `client_id`; los prompts no traen
   nombres ni datos de ningún restaurante (antes traían meseros de AMALAY). Guardián:
   `chat-aislamiento-tenant`, `ia-datos-honestos`.
9. **Texto de la base = dato, no instrucción.** Nombres de productos, reservas, sucursales y
   franjas entran envueltos con `datoTexto` / `envolverDatos` (`lib/chat-context.ts`).
10. **La IA sólo lee.** Chat, voz y agentes explican, buscan y recomiendan. No cobran, no
    mandan órdenes, no abren cajón, no modifican datos. Cualquier acción futura pasa por el
    flujo seguro existente con confirmación explícita.

---

## 2. Capa de datos: funciones `fs_*` (Postgres)

Todas son `security definer`. Las que se abren al navegador validan adentro con
`fs_puede_leer(p_client_id)` (service_role o miembro en `client_users`).

| Función | Qué devuelve | Quién la usa |
|---|---|---|
| `fs_es_venta(status, payment_status)` | la regla única de venta | todas |
| `fs_puede_leer(client_id)` | control de acceso por restaurante | las abiertas al navegador |
| `fs_ventas_diarias(client, desde, hasta)` | día: ventas, tickets, meseros, pagos, platillos, grupos | `lib/pos-daily.ts` |
| `ventas_por_franja(client, desde, hasta, franjas, tz, inicio_dia)` | venta total/comida/bebida por franja y sucursal; fuente elegida **día por día** | `lib/dayparts.ts` |
| `fs_frescura(client, tz)` | última venta del POS y venta de hoy (día de venta) | chat, voz |
| `fs_ventas_producto`, `fs_receta`, `fs_insumo` | producto vendido, receta, insumo | chat |
| `fs_meseros_categorias(client, desde, hasta)` | KPIs por mesero (forma del legacy `wansoft_waiter_categories`) | `lib/data.ts` |
| `fs_asistencia(client, desde, hasta)` | horas por empleado (checador + turnos, tope 16 h) | nómina, acceso |
| `fs_food_cost(client)` | costo por platillo con corrección de unidades (`fs_unidad`, `fs_factor_costo`) | food cost |
| `fs_costo_de_ventas(client, desde, hasta)` | costo teórico por mes y venta con receta | estado de resultados |

Migraciones: `supabase/migrations/PENDIENTE_202609271*.sql` y
`PENDIENTE_20260928100000_fs_frescura_dia_de_venta.sql` (ya aplicadas en staging y prod; el
prefijo `PENDIENTE_` se conserva por la convención del repo).

**Horarios de venta (franjas):** cada restaurante define las suyas en `clients.sales_dayparts`
desde `/configuracion/horarios-venta`. Se guarda la hora de cada orden, nunca totales por
franja: cambiar horarios recalcula todo el histórico. Con menos de 100 órdenes o menos de la
mitad de los días con hora, el chat avisa que la muestra no es representativa.

---

## 3. Chat del dueño (`/api/chat`)

```
pregunta ──► intención (palabras clave) ──► lecturas en paralelo (Promise.all)
                                               │  fs_*, pos_orders, histórico importado
                                               ▼
                                 bloques PRECALCULADOS con fechas reales
                                 (resumenesPrecalculados, contextoFranjas, frescura,
                                  fuentes fallidas, alertas agent_events 48 h)
                                               ▼
                                 catálogo de gráficas (sólo con datos existentes)
                                               ▼
                                    LLM (Groq) ── texto + marcadores <!--grafica:ID-->
                                               ▼
                         servidor reemplaza marcadores por specs reales ──► cliente
```

- **Módulos:** `lib/chat-context.ts` (bloques precalculados, cobertura, fuentes fallidas,
  envoltura de datos, historial seguro), `lib/chat-nativo.ts` (producto/receta/insumo/
  frescura), `lib/dayparts.ts` (franjas).
- **Comparativos precalculados:** hoy vs mismo día de la semana pasada **a la misma hora**;
  últimos 7 días completos vs los 7 anteriores (hoy parcial va aparte como "EN CURSO");
  mes actual y anterior (siempre se cargan); pronóstico; por hora.
- **Historial:** sólo roles `user`/`assistant`; las gráficas se compactan a su marcador.
- **Alertas:** si preguntan "¿qué alertas tengo?", lee `agent_events` del restaurante (48 h).

---

## 4. Gráficas del chat

**El modelo nunca escribe datos de una gráfica.** Sólo elige.

1. `lib/graficas-chat.ts` construye el **catálogo** con datos que la ruta ya leyó. Sólo entra
   una gráfica si su dato existe para ese restaurante:
   `ventas_diarias_30d`, `ventas_por_mes`, `hoy_vs_semana_pasada`, `semana_vs_anterior`,
   `franjas`, `top_platillos`, `meseros`, `metodos_pago`, `ventas_por_hora`.
2. El prompt lista los ids disponibles; el modelo escribe `<!--grafica:ID-->` (máx. 2).
3. El servidor (`aplicarGraficas`): convierte marcadores válidos en *placeholders* con un
   código aleatorio por respuesta, **borra todo comentario `<!--…-->` escrito por el modelo**
   hasta punto fijo (incluidos bloques anidados, partidos o sin cerrar), y al final inserta
   los bloques del servidor. Un bloque escrito por el modelo nunca llega al cliente.
4. Si el usuario pidió gráfica y el modelo no marcó ninguna, el servidor elige la mejor
   (`elegirGraficaPorPregunta`).
5. El cliente (`components/chat/GraficaChat.tsx`, recharts) sólo dibuja specs v2 válidas
   (`lib/grafica-spec.ts`). Días sin dato = hueco, no cero; día/mes en curso = barra tenue con
   etiqueta; un solo eje Y; tooltip; "Ver tabla"; `role="img"` con resumen.
6. Paleta `--viz-1..5` y `--viz-ctx` en `globals.css`, validada contra daltonismo en claro y
   oscuro.
7. En modo voz no hay gráficas.

---

## 5. Voz (gratis)

Dos botones en el compositor del chat (`components/chat/ComposerChat.tsx`):

| Botón | Qué hace | Piezas |
|---|---|---|
| **Micrófono** (voice note) | graba → transcribe → el texto queda en la caja para revisar y enviar | `hooks/useGrabadora.ts`, `/api/transcribe` |
| **Ondas** (Habla con tu restaurante) | conversación por turnos: escucha → detecta fin de frase → `/api/chat` con `modo:'voz'` → habla la respuesta → vuelve a escuchar | `hooks/useModoVoz.ts`, `components/chat/ModoVozPanel.tsx` |

- **Transcripción:** `/api/transcribe` → Groq Whisper (`STT_MODEL`, default
  `whisper-large-v3-turbo`, `language=es`). Auth `requireTenant`; máx. 4 MB; 20/min dictado,
  30/min modo voz; 429 de Groq → "Límite gratuito alcanzado". No se guardan audios ni
  transcripciones en logs.
- **Cerebro:** el mismo `/api/chat` (no el viejo `/api/voice`). `modo:'voz'` agrega la
  instrucción de respuesta hablada (2–4 frases, sin tablas ni links, números en palabras).
- **Voz de salida:** `speechSynthesis` del navegador (es-MX preferida). Calidad según
  dispositivo: buena en iPhone/Mac, robótica en algunos Android/Windows.
- **Detección de voz:** `lib/voz/vad.ts` (piso de ruido adaptable, 1.2 s de silencio cierra
  el turno, mínimo 0.6 s de voz real). Si un comedor ruidoso dispara de más, ajustar
  `umbralMin`/`factorRuido`.
- **iOS:** el micrófono se suelta mientras habla (si no, WebKit manda el audio al auricular) y
  se reabre al escuchar. Pendiente probar en iPhone real.
- **Cambio futuro a voz en tiempo real:** la UI sólo habla con `transcribir()` / `hablar()`
  en `lib/voz/proveedores.ts`. Un proveedor de pago (p. ej. OpenAI Realtime) se registra ahí y
  se elige con `NEXT_PUBLIC_VOZ_PROVEEDOR`. Diseño acordado para ese momento: token temporal
  creado por el servidor, **una sola tool de lectura** `consultar_restaurante(pregunta)` que
  llama a `/api/chat` (para heredar todas las reglas de la sección 1), tope de minutos por
  restaurante. Hoy **no** hay proveedor de pago: decisión de costo cero.

---

## 6. Agentes del dashboard (`lib/agents/*`, `/api/agents/cron`)

| Agente | Detecta | Notas |
|---|---|---|
| `finance` | venta de hoy vs mismo día **a la misma hora** | crítica sólo con ≥3 semanas comparables y ≥3 h de día |
| `operations` | mesas esperando cobro, cancelaciones, carga | ticket promedio del propio restaurante (no fijo) |
| `staff` | desempeño e inactividad en hora pico | cruza con checador (`pos_attendance`) |
| `fraud` | concentración de cancelaciones/descuentos | paginado; mesero faltante = alerta de calidad, no persona |
| `inventory` | sin stock / bajo mínimo | falso crítico si el restaurante aún cobra fuera del POS |
| `learning` | ajusta confianza con veredictos del dueño | — |

- `dia-negocio.ts`: día de venta, regla de venta, lector paginado.
- `engine.ts`: dedupe por **tipo + sujeto** (la 2ª alerta de otro mesero ya no se pierde);
  críticas quedan marcadas `evidence.notificar.pendiente = true`.
- **Cron:** `.github/workflows/agentes-dashboard-cron.yml` llama `/api/agents/cron` cada
  30 min; recorre todos los `clients.active = true`. Requiere `CRON_SECRET` igual en Vercel
  y GitHub (si no, 503).
- **Pendiente:** el envío de notificaciones (push) no existe todavía; sólo se marcan.

---

## 7. Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `GROQ_API_KEY` (o `GROQ`) | Vercel | chat, voz, transcripción |
| `STT_MODEL` | Vercel (opcional) | modelo de transcripción |
| `CRON_SECRET` | Vercel + GitHub | cron de agentes |
| `NEXT_PUBLIC_VOZ_PROVEEDOR` | Vercel (opcional) | proveedor de voz futuro |
| `AI_GATEWAY_API_KEY`, `JEV_SHADOW_ENABLED=1` | Vercel | JEV (hoy apagado) |

---

## 8. JEV

Capa de evaluación en modo sombra (`lib/jev/*`, `/platform/jev`). Contesta **sólo preguntas
cerradas** (elegir opción, puntaje, sí/no) sobre estados de enumeraciones; no ve código, datos
ni texto libre; nunca ejecuta. Sirve para priorizar alertas de telemetría y detectar
contradicciones en reportes de agentes. **No** sirve para revisar el producto ni para
inteligencia de restaurante. Apagado hasta configurar sus variables.

---

## 9. Lo que NO está hecho (para que no haya sorpresas)

- **AMALAY todavía cobra en Wansoft.** Hasta el cambio de caja, sus números nuevos no existen
  en Fullsite; el % por horario y el food cost completo dependen de ese cambio.
  `wansoft_order_times` está vacía: no hay hora de tickets históricos de AMALAY.
- **Agentes de Python (`.github/scripts`)** — asignados a otra línea de trabajo (Codex): apagar
  scrapers de Wansoft, regla única de venta, falla ≠ vacío, workflows sin `CLIENT_ID`,
  proyección de cierre circular, orquestador sin `client_id`. Hallazgos detallados en la
  auditoría del 2026-09-28.
- **Notificaciones push** de alertas críticas: marcadas, no enviadas.
- **Preguntas que todavía no contesta:** "¿dónde pierdo dinero?" (no hay P&L completo con
  gastos y nómina), "¿qué platillo quito?" (falta matriz popularidad × margen precalculada),
  "¿quién necesita capacitación?" (faltan métricas por mesero desde el POS).
- **Food cost** sólo cubre la venta con ficha técnica (~66% en AMALAY, sep 2026).
- **Reservaciones web** (`amalay_reservaciones`): sin entradas desde 2026-04-22; el flujo
  n8n/Make murió. Sin revisar.
- **Voz en iPhone real** y umbrales de ruido en comedor: sin probar en dispositivo.

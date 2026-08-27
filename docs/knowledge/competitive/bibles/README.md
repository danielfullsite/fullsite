# Biblias de Competencia — índice

**Qué es esto:** anatomía de producto ("de pies a cabeza") de cada competidor grande: qué tiene su POS, qué tiene su dashboard, cómo cobra, dónde es débil, qué copiamos y cómo le ganamos. **Documentos vivos** — se actualizan, no se regeneran.

**Qué NO es:** estrategia de mercado. Eso vive en `../COMPETITIVE-INTELLIGENCE.md` (panorama 100+ empresas, teardowns estratégicos, pricing comparativo, white space). Las biblias son el zoom de producto sobre los que importan.

## Las biblias

| Biblia | Quién es | Por qué importa |
|---|---|---|
| [TOAST-BIBLE.md](TOAST-BIBLE.md) | El estándar de oro (130K locations, US) | Define hacia dónde va la industria; ToastIQ valida nuestra tesis de IA |
| [PARROT-BIBLE.md](PARROT-BIBLE.md) | El competidor directo (1,500+ rest., MX, YC) | Mismo ICP, misma ciudad a veces; Parrot Grow = IA de marketing por WhatsApp |
| [SOFTRESTAURANT-BIBLE.md](SOFTRESTAURANT-BIBLE.md) | El incumbente (42K rest., 25 años, MX) | La base instalada que vamos a migrar; SR 12 ya importa CFDI y manda cortes por WhatsApp |
| [SQUARE-BIBLE.md](SQUARE-BIBLE.md) | El freemium (US, benchmark) | No compite en MX; benchmark de pricing, self-service y AI Voice |
| [`../../wansoft/BIBLE.md`](../../wansoft/BIBLE.md) | El legacy que conocemos por dentro (Clip) | Biblia propia desde antes — conocimiento de primera mano vía AMALAY |

## La foto en una tabla (2026-08-27)

| | Toast | Parrot | Soft Restaurant 12 | Square | **Fullsite** |
|---|---|---|---|---|---|
| Precio base | $69 USD/mes + 2.49% | $1,800–2,800 MXN + IVA | $799–1,099 MXN + IVA (+add-ons) | $0–149 USD + % | ~$1,999 MXN todo incluido |
| Plataforma POS | Android propio | Android propio | **Windows LAN** | iPad/propio | Web/Android (PWA) |
| Offline | Hub relay frágil (órdenes aisladas/dispositivo) | "Sync al reconectar" (sin docs) | Servidor local (bueno) | Limitado | **Bridge LAN certificado en campo** |
| CFDI | No | QR <45 s, **folios limitados** | Nativo + importa XML compras | No | Facturapi, sin límite de folios |
| IA | **ToastIQ**: feed + chat + acciones | **Grow**: marketing WhatsApp (waitlist) | Ninguna | Voice ordering | **Agentes ops + copiloto** |
| WhatsApp | No (app propia) | Grow (campañas salientes) | Cortes X y alertas (push) | No | **Conversacional bidireccional** |
| Delivery agregado | Nativo + red propia | **Uber/Rappi/DiDi maduro** | Delivery Manager (add-on) | Integraciones | Uber en certificación |
| Reservas | Toast Tables nativo | Solo OpenTable (planes altos) | Módulo add-on | No | Nativo (amalay_reservaciones) |
| Anti-fraude | **15 reportes Cash & Loss** | Autoconciliación de pagos | Bitácora/cortes | Básico | Agente antifraude + arqueo |
| Lock-in | Contrato 1–3 años, ETF $5–10K USD | Hardware + terminal propios | Distribuidor + Windows | Ninguno | Ninguno |

## Lo que las cuatro biblias gritan juntas (síntesis)

1. **Todos llegaron a la misma conclusión que nosotros**: Toast (ToastIQ), Parrot (Grow), Square (Voice), hasta SR (WhatsApp push). La tesis "IA + datos del POS" ya no es contrarian — la ventana de diferenciación es la **IA operativa completa** (stock/fraude/cierre/staffing), que ninguno tiene, y el **canal conversacional** (WhatsApp bidireccional), que ninguno tiene.
2. **WhatsApp ganó como canal en MX**: Parrot Grow envía por WhatsApp, SR manda cortes por WhatsApp. Nadie CONVERSA todavía. Nuestro copiloto es el único bidireccional.
3. **La guerra de pagos ya empezó en MX**: Parrot Pay, SR Payments, Wansoft/Clip. Toast enseña el endgame (85% del revenue). Nuestra matriz-dinero/cuadre es prerequisito; la pata de pagos no puede quedarse en el master plan para siempre.
4. **El CFDI es campo de batalla, no checkbox**: Parrot autofactura en 45 s; SR importa compras por XML. El estándar mexicano ya está alto — OP-21/OP-22 son competitivos, no fiscales.
5. **El offline sigue siendo nuestro terreno**: el único cloud-POS con offline serio documentado somos nosotros. Toast lo parcha, Parrot no lo documenta, SR lo tiene pero anclado a Windows.
6. **Anti-fraude es categoría de primer nivel** (Toast: 15 reportes) — no esconder el nuestro en un submenú.

## Lo que se ve al poner las cuatro pantallas juntas (pase visual 2026-08-27)

Las cuatro biblias ya tienen sección **"Así se ve"** con pantallas reales (demo interactivo de Parrot recorrido completo; screenshots oficiales de soporte de Toast; assets de producto de Square; video-tutoriales de SR):

- **El layout del POS convergió**: ticket a un lado + jerarquía menú→grupo→item al otro, en Toast, Parrot, Square y Fullsite. Nadie compite por el layout — compiten por **qué dato extra vive en el tile**: Toast pone el stock restante (contador pre-86), Square pone la FOTO del platillo, Parrot una franja de color. Nosotros deberíamos robar los dos primeros.
- **El 86 es un buen medidor de madurez UX**: Square lo tiene a un long-press desde el grid; Toast en la app del dueño; Parrot no lo enseña; SR lo esconde en menús. 
- **SR es de otra década a simple vista** (menús Windows en cascada + ribbon naranja) — la demo contra SR se gana mostrando, no argumentando.
- **Dark mode es estándar** en KDS (Toast) y llega al table-service; SR12 lo acaba de añadir. 
- GTM: **Parrot compra ads de YouTube sobre las búsquedas de tutoriales de Soft Restaurant** — la caza del incumbente ya empezó y valida el flanco "dueño joven que hereda un SR".

## Estado de cobertura (2026-08-27, segunda pasada)

| Pieza | Toast | Parrot | Soft Restaurant | Square |
|---|---|---|---|---|
| Estructura/módulos | ✅ | ✅ | ✅ | ✅ |
| POS visto | ✅ 2 modos | ✅ flujo completo + terminal | ✅ venta + comandero + login SR12 | ✅ |
| KDS visto | ✅ 2 temas | ❌ demo | ❌ demo | ❌ (benchmark, no aplica) |
| Back-office visto | ✅ nav + app dueño | ✅ nav + roles + Menu Maker (reportes actuales: demo) | ✅ admin completo | 🟡 |
| Pricing | ✅ | ✅ (cotización formal: demo) | ✅ base (add-ons: demo) | ✅ |
| Offline | ✅ docs oficiales | ❌ demo + Alejandro | ✅ | 🟡 |

Lo que queda vive en UN documento: [`GUION-DEMOS-COMPETENCIA.md`](GUION-DEMOS-COMPETENCIA.md) — dos llamadas de demo (Parrot + distribuidor SR) y tres preguntas a Alejandro cierran todos los ❌.

## Cómo se mantienen vivas

- **Trigger de actualización:** noticia de funding/lanzamiento de un competidor, un prospecto que los menciona, o revisión trimestral (la que toque primero).
- **Regla de edición:** parche mínimo con fecha — nunca regenerar el archivo completo. Cada afirmación con [HECHO]/[INFERENCIA]/[HIPÓTESIS] y fuente.
- **Sección 10 de cada biblia** ("qué falta por verificar") es el backlog de investigación: al cerrar un pendiente, mover el hallazgo al cuerpo.
- **Capturas de pantalla:** guardarlas en `assets/` con prefijo del competidor (`toast-`, `parrot-`...) y referenciarlas desde la biblia. Los videos NO se descargan — se enlazan.
- Añadir un competidor nuevo = nueva biblia con la misma estructura de 10 secciones (ficha → mapa → POS → dashboard → IA → pricing → debilidades → copiar/evitar/ganar → material de estudio → pendientes).

# Threat model — capa de decisión Jev (Fase 0)

> 2026-09-25 · contrato `jev-decision/0.1.0` · modo shadow.
> Cada control indica la prueba que lo sostiene. Un control sin prueba se marca como tal.

## Activos

1. Datos de tenants (PII de comensales y empleados, PINs, montos, contenido de órdenes).
2. La credencial `AI_GATEWAY_API_KEY`.
3. La integridad de las decisiones operativas (qué se escala, qué se declara terminado).
4. La disponibilidad de POS y KDS.

## Frontera de confianza

El único punto donde sale información de la máquina es `adapter.ts` → AI Gateway (Vercel) →
proveedor `digitalocean` (catálogo `/v1/models/typesafe-ai/jev/endpoints`, 2026-09-25).
Metadatos de ese endpoint: **`has_zdr: false`**, `has_no_training: true`,
`uptime_last_1d: 32.19 %`. Sin retención cero: todo lo que se manda puede quedar guardado
por el proveedor. De ahí que la política sea *no mandar nada que no sea sintético o enumerado*.

## Amenazas y controles

| # | Amenaza | Control | Prueba |
|---|---|---|---|
| T1 | PII, PINs, secretos, pagos o contenido de órdenes salen al proveedor | Instantánea JSON de la entrada (lo validado es lo enviado; sin TOCTOU ni `toJSON`); allowlist estricta por caso con `Object.hasOwn` (sin texto libre; las claves del prototipo no cuentan como permitidas); denylist de claves a cualquier profundidad (incluye camelCase); detector de patrones (email, teléfono, PAN con Luhn, JWT, llaves, bearer, RFC, CURP, PIN, URL); **rechazo, no limpieza**; tenant opaco `t_<hex>`; tope 4,000 caracteres | `policy-rules-audit.test.ts` › política de redacción; `engine.test.ts` › entradas hostiles (0 llamadas de red) |
| T2 | Inyección de instrucciones vía el estado ("ignora lo anterior", "aprobado por gerente") | Instrucciones y criterios son constantes del código; el estado no admite strings fuera de enumeraciones; campos extra se rechazan; la salida de Jev se restringe al conjunto cerrado y se valida | `engine.test.ts` › inyección; `adapter.test.ts` › choice fuera del conjunto |
| T3 | Jev responde basura, parcial o manipulada | Validación estricta: claves exactas, 1:1 con preguntas, tipos, probabilidades en [0,1] que suman 1, choice = argmax, score en rango y = media de su distribución; `rounding` sólo entero en [0,10] | `adapter.test.ts` › 17 respuestas inválidas |
| T4 | Sustitución silenciosa de modelo | Un solo `ai-model-id`; sin `models`/fallback en el cuerpo; si cualquier ruta conocida de `providerMetadata` reporta otro valor (de cualquier tipo o largo) → `model_mismatch` | `adapter.test.ts` › petición; › otro modelo |
| T5 | Jev (o un bug) decide algo con dinero, identidad, seguridad, deploy, migración o producción | Gate previo FORBIDDEN: ni reglas ni red; absorbente | `engine.test.ts` › FORBIDDEN; mutación M2 |
| T6 | Jev reemplaza a las reglas, cambia la salida o hay modo autónomo | `effective`, `authority` y `policy_applied` dependen sólo de entrada y reglas; Jev va a `shadow_notes`; `JevMode` sólo `'shadow'`; `executable: false` literal | `engine.test.ts` › shadow y determinismo; mutaciones M1, R-M4 |
| T7 | Autoridad que baja por error | `postGate` sólo escala; FORBIDDEN absorbente; un rechazo con dominio prohibido o ilegible sale FORBIDDEN; piso por contenido sensible | `policy-rules-audit.test.ts` › policy gate; `adversarial-regressions.test.ts` › M1, L6; mutaciones M7, R-M1, R-L6 |
| T8 | Filtración de la credencial en logs, auditoría o errores | Se lee al llamar; sólo va en `Authorization`; `detail` sanitizado (bearer, `vck_`, `sk-`, JWT) y truncado a 200; errores HTTP registran sólo `status` + `error.type` | `adapter.test.ts` › red; `engine.test.ts` › auditoría; mutación M8 |
| T9 | Jev caído o lento degrada la operación | Timeout duro 2 s en carrera con la llamada (no depende de que el transporte respete `abort`; cubre el cuerpo); cualquier falla → `blocked` y reglas vigentes; el motor no lanza (instantánea + `try` global) | `adapter.test.ts` › timeout; `engine.test.ts` › fallback; mutación M3 |
| T10 | POS/KDS dependen de Jev | Nadie fuera de `lib/jev` la importa; `lib/jev` no importa nada del resto del sistema ni de Supabase | `isolation-compare.test.ts` (guardián visto fallar) |
| T11 | Auditoría alterada o truncada | Append-only (`flag: 'a'`), sin update/delete, cadena SHA-256, ancla `.head` contra cola truncada, normalización antes de sellar, error claro ante línea rota; el sink se niega a continuar si algo no cuadra | `policy-rules-audit.test.ts` › auditoría |
| T12 | Cruce de tenants | `tenant_ref` obligatorio en input y auditoría; entra al hash | `engine.test.ts` › dos tenants |
| T13 | Gasto descontrolado | Precio del catálogo; tope USD 1 y 5 req/s en el runner | runner (`eval/run.eval.ts`) — **sin prueba automática propia** |

## Revisión adversarial independiente (2026-09-25)

Un segundo agente, sin el contexto de quien implementó, intentó romper la capa con transportes
simulados. Confirmó 3 fallas altas (H1 claves del prototipo dejaban pasar PII/PIN/tarjeta; H2 el
motor lanzaba con entradas circulares o getters; H3 TOCTOU/`toJSON`), 5 medias (M1 un rechazo bajaba
FORBIDDEN; M2 `use_case: 'constructor'`; M3 `rounding` hostil desactivaba invariantes; M4 Jev movía
la autoridad en shadow; M5 auditoría: cola truncada, `undefined`, dos escritores, línea rota) y 6
bajas (L1 modelo reportado largo o en otra ruta; L2 timeout dependía del transporte; L3 detalle sin
sanitizar; L4 guardián de aislamiento ciego a `import()`/`require`; L5 regla de contradicción;
L6 FORBIDDEN sólo declarado). Todas corregidas, cada una con prueba en
`adversarial-regressions.test.ts` y con mutación que revierte el arreglo para ver fallar la prueba.

## Riesgos residuales (no cubiertos)

- **Ancla de auditoría local.** Quien pueda escribir el `.jsonl` y su `.head` puede truncarlos
  juntos. Garantía real requiere un ancla fuera de la máquina. Un solo proceso escritor por archivo.
- **`input_hash` es invertible por fuerza bruta** (el espacio de estados enumerados es chico). No
  expone PII porque no la hay, pero no debe tratarse como si ocultara el estado.
- **FORBIDDEN sigue dependiendo de lo declarado** para dominios sin reflejo en el estado; los pisos
  por contenido cubren sólo los casos listados en ARCHITECTURE §4.

- **Sin ZDR.** Incluso con datos enumerados, el patrón de uso (qué alertas tiene un tenant) es
  información operativa. Fase 0 sólo manda fixtures sintéticos. Llevar estados reales exige
  una decisión explícita de Daniel.
- **Versionado del modelo.** `typesafe-ai/jev` en el gateway no es un nombre versionado; el
  plan pedía fijar versión. Mitigación parcial: `model_mismatch` si el gateway reporta otro id.
  No detecta un cambio de pesos bajo el mismo id.
- **Disponibilidad del proveedor.** `uptime_last_1d` de 32 % el día de la prueba. Irrelevante
  para POS/KDS (no dependen), relevante para cualquier uso futuro.
- **Oráculo sesgado.** Reglas y etiquetas los escribió el mismo autor; la precisión de reglas
  sobre fixtures está inflada. Los casos `hard` existen para eso, y son pocos (9 de 43).
- **La confianza de Jev no es permiso** (guía oficial de TypeSafe citada en el plan §0). La
  capa nunca la usa para bajar autoridad.

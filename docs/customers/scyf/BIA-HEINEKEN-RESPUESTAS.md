# BIA "Región Américas" (HEINEKEN / OneTrust) — respuestas de Fullsite

**Fecha:** 2026-09-14 · **Cliente:** SCYF (Sociedad Cuauhtémoc y Famosa) · **Plantilla:** `BIA - Business Impact Assessment`, organización `Region AMERICAS`
**Archivo entregable:** `~/Downloads/Región Américas -BIA — Fullsite (respuestas).xlsx` (copia nueva; el original no se tocó)
**Paso del proceso:** #7 del flujo de NDA y ciber seguridad de SCYF.

---

## 1. Lo que hay que saber antes de enviarlo

**Tres respuestas empujan el expediente al perfil HIGH RISK.** Es la diferencia entre
terminar en el paso 7 y tener que contestar además el *High Risk IT Security Assessment*
del paso 8:

| Preg. | Respuesta | Por qué sube el riesgo | ¿Se puede bajar? |
|---|---|---|---|
| **2.8** Datos sensibles | **Yes** | La huella digital del personal es dato biométrico: sensible en LFPDPPP y categoría especial del art. 9 RGPD. La plantilla se guarda en `pos_fingerprint_templates` | **Sí.** Es un módulo opcional. Si SCYF opera solo con PIN por empleado, pasa a "No" |
| **2.7** Inicia pagos | **Yes** | El POS manda intención de cobro a terminal Clip / MP Point | **Sí.** En comedores de personal el cobro suele ser por nómina o prepago → "No" |
| **2.13** Contrato fuera del EEE sin adecuación | **Yes** | FULLSITE SAS es mexicana; México no tiene decisión de adecuación de la CE | No. Es un hecho de la constitución de la empresa |

**Recomendación:** antes de enviar, decidir con SCYF si huella y cobro con tarjeta entran
en el alcance del piloto. Si ambas quedan fuera, el expediente probablemente cierra como
STANDARD RISK. Si se quedan, hay que llegar al paso 8 con la casa en orden
(ver `PREP-HIGH-RISK-IT-SECURITY.md`).

---

## 2. Las 25 respuestas escritas

Todas usan literalmente las opciones válidas de la hoja `Assessment Response Options`
(validado programáticamente: 0 valores inválidos), así que el archivo se puede importar a
OneTrust sin conflictos.

| Preg. | Respuesta |
|---|---|
| 1.3 Descripción | POS + KDS + inteligencia operativa para comedores; KPI principal costo por comida |
| 1.4 Tipo | Application, API, Database, Website |
| 1.5 Implementa | Business Function together with Supplier |
| 1.6 Soporte TI | Business Function together with Supplier |
| 1.7 Hosting | Amazon Web Services (vía Vercel + Supabase) + componente on-premise |
| 1.9 Datos personales | Yes |
| 1.12 Acceso fuera UE/EEE | Yes (México y EE. UU.) |
| 1.13 Valor del contrato | 10.001 – 50.000 euro *(cotización cerrada 2026-09-14)* |
| 1.14 Tipo de arranque | Pilot *(confirmar)* |
| 2.1 Criticidad | Confidential |
| 2.2 Confidencialidad | Minor impact |
| 2.3 Integridad | Minor impact |
| 2.4 Disponibilidad | Moderate impact |
| 2.5 Países de alto riesgo | No |
| 2.6 Datos del reporte anual | No *(confirmar con Finanzas SCYF)* |
| 2.7 Inicia/procesa pagos | Yes |
| 2.8 Datos sensibles | Yes |
| 2.9 Datos de naturaleza altamente personal | No |
| 2.10 Datos de menores | No |
| 2.11 Región | AM |
| 2.12 País | United States |
| 2.13 Contrato fuera del EEE | Yes |
| 3.2 Acceso remoto a red HEINEKEN | No |
| 3.3 Login | Web Login, Local software installation |
| 3.4 Quién accede | Internal Employees, Suppliers |

### La respuesta 2.4 merece explicación

Se contestó **Moderate impact**, no Significant, y es defendible por diseño: la
arquitectura es local-first. Las terminales y el KDS del comedor siguen operando sin
enlace a internet y sincronizan al reconectar, así que una caída de la nube **no detiene
el servicio de alimentos** — se pierde la visibilidad centralizada, que tolera días.
Es un argumento de venta además de una respuesta de cumplimiento.

---

## 3. Los 12 campos que Fullsite no puede llenar

Seis son de tipo *Inventory* — OneTrust no los acepta por importación de Excel, hay que
elegirlos en la interfaz. Los otros seis son decisiones de SCYF o de Daniel. Están
listados con su dueño en la hoja **"Notas Fullsite"** del propio archivo:

| Preg. | Dueño | Qué falta |
|---|---|---|
| 1.1 | SCYF | Registrar "Fullsite" en Abacus y seleccionarlo |
| 1.2 | SCYF | Global Function u OpCo dueña del negocio |
| 1.8 | SCYF | Seleccionar FULLSITE SAS como tercero proveedor |
| 1.10 / 1.11 | Privacy Officer SCYF | Mapear a las Processing Activities de su RoPA |
| **1.15** | **Daniel + SCYF** | **Fecha objetivo de go-live (obligatoria, formato YYYY-MM-DD)** |
| 3.1 | SCYF | Integraciones con sistemas HEINEKEN (hasta donde sabemos: ninguna) |
| 4.1 – 4.5 | SCYF | Acknowledgements y OnePIA: solo se marcan en la UI |

---

## 4. Tabla de afirmaciones y fuentes

Ninguna respuesta del archivo se escribió de memoria. Esto es lo que sostiene cada una:

| Afirmación | Clase | Fuente |
|---|---|---|
| Las plantillas de huella se guardan en el servidor, aisladas por cliente | HECHO | `dashboard-app/src/app/api/pos/fingerprint/route.ts:1-60` — tabla `pos_fingerprint_templates`, secreto acotado `FINGERPRINT_SYNC_SECRET`, nunca expuesta al navegador |
| El POS inicia cobros contra terminal Clip | HECHO | `dashboard-app/src/app/api/clip-pinpad/route.ts:9,40-48` — `payment-request` con monto y referencia, moneda MXN |
| No se almacena número de tarjeta | HECHO | Búsqueda de `last4`/`card_number`/`PAN` en `src/lib` y `src/app/api`: 0 coincidencias reales; `pos_orders.pagos` solo guarda `{metodo, monto}` |
| Los datos de nube están físicamente en Estados Unidos | HECHO | `inet_server_addr()` del Postgres de producción = `2600:1f18:…`; `whois` → NetName AMZ-EC2, Organization Amazon.com Inc., Country US (verificado 2026-09-14) |
| Región AWS exacta | **NO VERIFICADO** | No está documentada en el repo ni es consultable por SQL. **Confirmar en la consola de Supabase antes de enviar** |
| RTO < 4 h, RPO < 24 h, respaldos diarios con 30 días de retención | HECHO (declarado) | `docs/security/policies/04-business-continuity-disaster-recovery.md:19-20,32`. Es un objetivo documentado, no un SLA auditado por un tercero |
| Cifrado AES-256 en reposo y TLS 1.3 en tránsito | HECHO (declarado) | `docs/security/policies/06-data-handling-policy.md:38-39,55` — heredado de Supabase/Vercel |
| Aislamiento por inquilino con RLS | HECHO, con historial | `docs/security/SECURITY-FOUNDATION-P0.md` — 14 hallazgos P0, 12 cerrados. P0-D (tokens en localStorage) y los totales del lado cliente siguen abiertos |
| FULLSITE SAS, folio SAS20261025053 | HECHO | Memoria de proyecto `project_fullsite_sas` |
| Precio SCYF: $4,000 MXN de implementación + $3,500 MXN/mes, por comedor | HECHO | Daniel lo confirmó en el hilo el 2026-09-14. Es precio de este trato, por debajo del de lista ($4,999/mes) |
| Tipo de cambio 1 EUR = 19.72 MXN | HECHO | Referencia BCE vía frankfurter.dev, consultado 2026-09-14 |
| SCYF: 8 comedores, ~1.5M comidas/año | HECHO | Memoria `project_scyf_demo` (construida contra datos reales del demo) |
| "Ninguna integración con sistemas HEINEKEN" | INFERENCIA | Nadie ha planteado una. Lo confirma SCYF en 3.1 |
| "2.6 No — no alimenta el reporte anual de HEINEKEN" | INFERENCIA | SCYF es sociedad civil independiente. **Lo confirma Finanzas de SCYF**, no Fullsite |

---

## 5. Cotización SCYF (confirmada por Daniel, 2026-09-14)

**$4,000 MXN de implementación (pago único) + $3,500 MXN/mes de licencia — por comedor.**
Sin costo de hardware. Por debajo del precio de lista de $4,999/mes.

| Comedores | Año 1 (MXN) | Año 1 (EUR) | Rango del BIA |
|---|---|---|---|
| 1 | $46,000 | €2,333 | Less than 10.000 euro |
| 2 | $92,000 | €4,665 | Less than 10.000 euro |
| **8** | **$368,000** | **€18,661** | **10.001 – 50.000 euro** ← el que quedó escrito |
| 8, a 3 años (TCV) | $1,040,000 | €52,738 | 50.001 – 100.000 euro |

Tipo de cambio 1 EUR = 19.72 MXN (referencia BCE, 2026-09-14).

**Cuidado con la consistencia interna:** 1.14 quedó como "Pilot", y la definición de
HEINEKEN para *Pilot* es "uno o dos OpCos". Si el contrato que se firma cubre solo esos
1–2 comedores, el rango correcto de 1.13 es **Less than 10.000 euro**, no el que está
escrito. El archivo asume que se contrata la red completa de 8 aunque el despliegue
arranque por uno. Si no es así, es un cambio de una celda.

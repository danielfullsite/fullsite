# DiDi Food — estado real y camino para cerrarlo

> Fecha: 2026-08-26. Primera investigación seria de esta integración.

## Estado: **no existe**

Lo único que hay en el repo es el parseo de webhooks de DiDi en
`cloudflare/delivery-worker/src/index.ts` — `extractDidiStoreId()`, `parseDidiOrder()`, y el
ruteo `/didi` con `provider = 'didi'`. Eso es **un receptor sin remitente**: no hay cuenta de
partner, ni contrato, ni credenciales, ni una sola llamada a una API de DiDi.

Nunca se ha hablado con DiDi. No es un workstream atorado — **es un workstream que no ha
empezado.**

---

## Lo que sí existe del lado de DiDi (hallazgo 2026-08-26)

DiDi tiene **DiDi Food Open Platform** en `developer.didi-food.com`, con un track explícito de
**"POS Vendor Self-Service Integration"** — exactamente lo que Fullsite es. No hay que ir por un
agregador tipo Deliverect u Ordatic.

**Camino oficial, 6 pasos:**

| # | Paso |
|---|---|
| 1 | Certification and Application |
| 2 | Create a Test App |
| 3 | Debugging |
| 4 | Testing and Acceptance |
| 5 | Authorization Service |
| 6 | Online Service Guarantees |

Es la misma forma que Uber (test app → sandbox → validación → producción) y que Rappi
(DEV → certificación → PROD). **Ya conocemos el patrón dos veces.**

**Contacto:** `didiOpenApiSupport@didiglobal.com`
**Formulario de alta:** en `developer.didi-food.com` — pide razón social, contacto, teléfono,
correo, identificador fiscal, tipo de servicio, área de servicio y marca preferida para integrar.

> ⚠️ **Ojo:** el formulario pide **CNPJ**, que es el identificador fiscal **brasileño**. Puede que
> ese portal esté orientado a Brasil (99Food) y que México tenga otra puerta. Confirmarlo con
> `didiOpenApiSupport@didiglobal.com` antes de llenar nada — nuestro identificador es **RFC**.

---

## Lo que costaría cerrarlo

Suponiendo que admitan a Fullsite como POS vendor en México, el trabajo técnico es **comparable
al de Rappi**, que ya está hecho de punta a punta: recepción de órdenes por webhook con firma,
adaptador al modelo interno, aceptar/rechazar/listo, sincronización de menú, y estado de tienda.

Reutilizable de lo que ya existe:

- El worker de Cloudflare ya distingue `provider = 'didi'` y parsea la orden.
- El patrón de adaptador de Rappi (`lib/integrations/rappi/adapter.ts`) es trasladable.
- El KDS y la vista `/pos/delivery` ya son agnósticos de plataforma.

Lo nuevo sería: OAuth/credenciales de DiDi, contrato de firma de webhook, endpoints de menú y
de ciclo de orden, y su matriz de certificación.

---

## Recomendación de secuencia

**No abrir DiDi todavía.** Razones, en orden:

1. **Rappi está a un correo de PROD** y ya tiene la validación DEV completa. Es el primer
   delivery que puede quedar certificado.
2. **Uber está bloqueado del lado de ellos** (dashboard caído, scopes sin conceder) y consume
   atención sin avanzar.
3. La prioridad 20 del `CLAUDE.md` es explícita: no abrir iniciativas nuevas mientras el núcleo
   crítico no esté certificado — y el camino del dinero de AMALAY **todavía no se ha ejercido
   una sola vez** (`pos_orders = 0`).

**Lo único que sí conviene hacer ya**, porque no cuesta nada y el reloj corre del lado de ellos:
mandar un correo a `didiOpenApiSupport@didiglobal.com` preguntando el camino de alta para un
**POS vendor en México** y si el portal de `developer.didi-food.com` aplica o si México tiene
otra puerta. La respuesta tarda; que llegue mientras cerramos Rappi.

Ver [`../IDENTIDADES-Y-ACCESOS.md`](../IDENTIDADES-Y-ACCESOS.md) para el registro de cuentas.

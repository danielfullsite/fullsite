# Plan Ahora — qué hacer para que Fullsite jale al 100%

> Companion accionable de [`audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md`](audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md).
> Priorizado en olas: cada ola desbloquea la siguiente. La regla de fondo (del veredicto de la
> auditoría): **nada falla en silencio**, y **una sola verdad** (código = docs = campo).
> Fecha: 2026-08-19.

---

## El diagnóstico en una línea

El núcleo es sólido. El problema es que **la verdad se bifurcó** (rama vs `main`, código vs docs, campo vs certificaciones). El plan ataca eso primero, porque todo lo demás se decide mejor sobre una sola verdad.

---

## Actualización 2026-08-25 — qué cambió en 6 días

> El plan de abajo sigue vigente en su lógica. Esto corrige lo que ya no es cierto.
> Verificado contra el repo y GitHub el 2026-08-25; lo que no pude verificar va marcado.

**Corrección importante — el punto 6 está INVERTIDO y ya está hecho.**
Decía que `feat/pos-ui-kit` iba *223 commits adelante de `main`*. Hoy **`main` va 177 commits
adelante de esa rama** (la rama conserva 58 propios). El merge ocurrió con el lote de offline
del 22-24 de agosto. **La verdad ya reconvergió** — era el punto de más apalancamiento de OLA 1.

**Cerrado desde el 08-19:**
- **P0-1** (`#61`, un 403 de negocio confundido con sesión expirada) y **P0-2** (`#63`,
  modificadores obligatorios perdidos offline) — mergeados a `main` el 2026-08-25.
- **`main` protegida** con check requerido `test` anclado a GitHub Actions; `force push` y
  borrado bloqueados. Dos workflows verdes: `test` (2118 casos) y `local-server` (192).

**Sin verificar desde el repo:** si los flags `CANCEL_APPROVAL_STRICT` / `POS_APPROVAL_STRICT`
están en strict en producción — el código existe, el valor es de entorno. Confirmar en Vercel.

**El hueco que este plan no veía — el camino del dinero nunca ha corrido.**
Según la consulta de sólo lectura registrada en `pos/MATRIZ-CAMINO-DEL-DINERO.md` (2026-08-25):
`pos_menu_items` 687 · `pos_staff` 40 · `pos_print_jobs` 338 · pero **`pos_orders` 0 ·
`pos_cash_movements` 0 · `pos_facturas` 0**. AMALAY comanda e imprime; **cobrar, mover efectivo
y cortar turno no ha pasado nunca.** Y los dos P0 recién mergeados viven exactamente en ese
tramo, sin ejercerse en campo.

**Esto reordena OLA 0: la prueba física del camino del dinero es el punto 1 de todo el plan.**
El guion ya está escrito — falta correrlo.

**Frentes nuevos que el plan no contempla y sí bloquean:**
1. **Decisión de contrato OCM.** Hay dos generaciones de vistas (9 nombres exige
   `scripts/clone-test.sql` vs 4 que definen las migraciones 014/015/016; sólo `ocm_daily`
   coincide). **Bloquea el gate de clonabilidad**, o sea bloquea al cliente #2. Decisión de
   Daniel, no técnica.
2. **10 PRs abiertos**, entre ellos los dos de campo (`#74` matriz, `#71` rollback + checklist)
   que hacen falta **en `main`** antes de la visita.
3. **Cap table sin reconciliar** — `strategy/DUE-DILIGENCE-v2.md:325` pone a Mónica en 20% sin
   contrato legal. Bloquea cerrar cofundador y bloquea levantar. Ver `strategy/DECISIONS.md`.

**Marco de la meta (2026-08-25):** el objetivo deja de ser "el mejor POS" — según
`product/FULLSITE-VS-WANSOFT-BIBLE.md` esa comparación ya está ganada 51-0 con 43 capacidades
exclusivas, y aun así hay 1 restaurante y cero revenue. El objetivo es **el punto de venta
final** (`strategy/POSICIONAMIENTO.md`), y se mide por **retención y horas que el dueño
recupera** (bloque D de `playbooks/guides/ACTA-LINEA-BASE.md`), no por features.

---

## OLA 0 — Esta semana (AMALAY al 100% + no perder dinero)

**Objetivo:** que AMALAY opere completo y confiable, y que el fraude deje de ser observado y empiece a bloquearse.

1. **Prueba física de offline (miércoles).** Entrada offline (cortar solo internet, LAN viva, POS abierto antes) + arreglar Escondite (config limpio por asistente, ya preparado). Cierra las 2 incógnitas que separan "2 terminales probadas" de "restaurante completo". → `pos/PLAN-INSTALACION-AMALAY-JUEVES.md`.
2. **Instalar KDS 1.3.8 en PDV2** (diseño Eduardo). Caja: solo F5 (no reinstalar). → mismo plan.
3. **Cold-boot sin internet.** Hoy una máquina que prende sin WAN queda en negro. Fix diseñado: servir un shell mínimo por Pedro (como el KDS). Mientras no exista, mitigación operativa: no reiniciar sin internet + UPS. **Es el único punto que puede tumbar el demo.**
4. **OFF-01 impresoras + doble cobro (DT-1).** Validar cobertura de impresora por estación al arranque (la falla que Eduardo ya vio) + guard `updated_at` en `handlePayment`. Dos fallas silenciosas que muerden en servicio real.
5. **Fraude → strict (post-tráfico).** Tras 3-7 días del jueves, cuando `legacy_no_approval` → ~0 en `pos_audit_log`: voltear `CANCEL_APPROVAL_STRICT` y `POS_APPROVAL_STRICT`. **Y codificar la Fase 2 del skimming (el rechazo), que hoy NO existe** — es el fraude más grave. → `security/FRAUD-ENFORCEMENT-FLAGS.md`.

---

## OLA 1 — Reconverger la verdad (la causa raíz común de los 6 frentes)

**Objetivo:** una sola fuente de verdad. Sin esto, cada decisión arriesga arrancar de un dato falso. Es puro saneamiento, no construcción — alto apalancamiento.

6. **Mergear `feat/pos-ui-kit` → `main`.** El Fullsite real (cáscara offline field-proven, provisioning `provisionTenant`/`/api/platform/onboard`, control-plane, OCM) vive **223 commits adelante de `main`**. Revisar en sesión dedicada y aterrizar a prod. Esto colapsa las "dos verdades" en una. **Delicado (toca el deploy vivo) → NO a deshoras ni antes del jueves.**
7. **Un solo registro de bugs/P0.** Fusionar `BUGS.md` (documentar los 13 "pendiente"), los 27 PRR, los 6 P0 de la Biblia y los 10 de la auditoría 08-19 en un índice único. Hoy hay 3-4 backlogs que no coinciden.
8. **Sanear docs viejos/peligrosos.** Empezar por el peligroso: corregir la instrucción de KDS-por-https en `MULTI-RESTAURANT-DEPLOYMENT.md:546` (viola la regla offline #1). Luego banner+redirect en los ~10 docs de julio que describen un sistema que ya no existe (patrón de `OFFLINE-MASTER.md`). Refrescar `README.md`.
9. **Resolver el pricing de una vez.** Elegir UN esquema, propagarlo a `lib/plans.ts` + `PRICING.md` + deck + landing, y **recalcular `UNIT-ECONOMICS-DEEP` sobre el precio ganador** (hoy sobre uno 2.5x equivocado). Bloquea todo lo comercial.

---

## OLA 2 — Blindar para producción y Cliente #2

**Objetivo:** que un restaurante nuevo (no-familiar) pueda operar con confianza.

10. **Autenticar el local server LAN** (`/events`,`/print`,`/config` en `0.0.0.0:7717`): token por terminal. Aditivo, no toca el path offline probado.
11. **Cerrar la sesión robable + 2FA super-admin.** Cookie `fs-at` httpOnly, refresh token fuera de localStorage, y enrolar MFA en `daniel@fullsite.mx` (único `platform_admin`, hoy 0 factores = single point of total compromise).
12. **OCM Fase 3.** Que chat/coach/predict/agentes consuman las vistas OCM por-tenant (las vistas ya están en prod). Es la única pieza que **rompería datos de un cliente real** (fuga cross-tenant vía service_role). Sin esto, la IA no funciona para un cliente sin historia Wansoft.
13. **Inventario al contrato + editor de ticket.** Migrar facturas-proveedor/recepción a `recordMovement()` (siguen con PATCH directo). Y el **editor de ticket POS-side** (ausente = riesgo fiscal: RFC/serie mal → CFDI-QR roto) — bloquea a cualquier cliente que facture.
14. **Provisioning self-serve + config por código + PAE.** Wizard de alta, provisioning de terminales automático (mata el BOM de raíz), impuestos por-tenant (sacar IVA/IEPS de código), y ejecutar el PAE (Café Nómada) para certificar clonabilidad empíricamente.

---

## OLA 3 — Que la IA de verdad mueva la aguja

**Objetivo:** que el gerente tome una decisión distinta gracias a la IA. NO más agentes — certificar los que hay.

15. **Cerrar el bucle de valor: poblar `agent_events`** (estimated_value + outcome). Hoy 24 agentes alertan y nadie mide si aciertan. Prerequisito de todo lo demás.
16. **Monitoring eligibility + gate de severidad en Telegram.** Fixea de un golpe los 22/24 agentes que alertan fuera de contexto → cada alerta que llega vuelve a ser accionable.
17. **Fraude en tiempo real sobre el event store** (no semanal). El mayor riesgo de dinero; el event store ya existe.
18. **Auto-completar recetas con Claude** (71% tienen 1 ingrediente → food cost ficticio). Hace el margen por platillo real por primera vez + mejora con cada restaurante (moat).

---

## OLA 4 — Negocio (en paralelo, no bloquea lo técnico)

19. **Cliente #2 arm's-length** — condición #1 de YC y del IC memo ("Stop building features. Start selling."). La demo del jueves es el primer paso.
20. **Cofundador comercial/COO** — distribución 3/10 es el gap que más deprime la valuación. Aplicar filtro Founder Commitment a los candidatos de agosto (Eduardo COO, Hugo Vaquera CTO).
21. **Alinear valuación** — decidir: levantar ahora a cap menor ($2.5M defendible) o esperar a 3 clientes para justificar el $5M del deck.

---

## Secuencia recomendada (lectura del founder)

- **Ahora → jueves:** Ola 0 (AMALAY 100% + demo). Nada más. No abrir frentes nuevos antes del campo.
- **Semana siguiente:** Ola 1 (reconverger la verdad) — el merge a main + saneo de docs + pricing. Es lo que más sube la precisión de todas las decisiones siguientes.
- **Después:** Olas 2-3 hacia Cliente #2, con Ola 4 (negocio) corriendo en paralelo.

**La regla de oro que emerge de toda la auditoría:** el núcleo ya es bueno. Lo que falta no es construir más — es **cerrar los silencios** (fraude, cold-boot, impresoras, sesión) y **reconverger la verdad** (rama→main, docs↔código, un pricing). Eso es la diferencia entre "impresionó en un demo" y "un restaurante confía su operación completa".

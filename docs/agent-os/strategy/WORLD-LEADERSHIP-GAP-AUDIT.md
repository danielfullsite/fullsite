# WORLD LEADERSHIP GAP AUDIT
> Fullsite vs. el estándar más alto visible en el mercado.
> **Fecha:** 2026-08-05
> **Versión:** 1.0 — Para revisión del Founder. No publicar.
>
> **Escala de evidencia:**
> - FIELD VERIFIED — observado físicamente en producción
> - LAB VERIFIED — probado en entorno controlado con hardware real
> - TEST VERIFIED — cubierto por suite automatizada PASS
> - CODE ONLY — implementado, sin prueba independiente
> - NOT IMPLEMENTED — no existe en la base de código

---

## 1. POS y flujo de servicio

**CURRENT STATE:** POS completo con creación de órdenes, modificadores, courses, manejo de mesas, turno obligatorio, envío a cocina. Operando en AMALAY desde julio 2026. FIELD VERIFIED (R1 PASS 12/12).

**EVIDENCE:** R1-AMALAY-VALIDATION.md, PUBLIC-CLAIMS-REGISTER.md, FIELD-NOTES.md jul-07.

**WORLD-CLASS STANDARD:** Orden en <2s desde botón a cocina. Modificadores con matrix anidada (opcional/requerido/cantidad). Split de cuenta por ítem. Gestión de tiempos de plato (fire command). Tabla de layout arrastrable. Void con razón y PIN. Re-fire de comanda. Merge de mesas.

**COMPETITOR SIGNAL:** Toast FACT: one-tap ordering, modifier matrix, 99.9% uptime SLA. Wansoft FACT: todas las operaciones offline (SQL Server local). Parrot INFERENCE: web-based, delivery integrations nativas.

**GAP:** Sin split por ítem (P2-01 OPEN). Sin fire command (courses se envían inmediatamente). Sin merge de mesas. Sin layout drag-drop. Void documentado pero flow de razón no validado offline.

**RISK:** Mesas grandes requieren split. Sin split = trabajo manual en caja = errores = pérdida de confianza del operador.

**TARGET:** Split por ítem FIELD VERIFIED. Void offline con PIN FIELD VERIFIED. Fire command CODE.

**DEPENDENCIES:** OCS P0-4 campo completo. Split es P2-01 (no P0).

**TEST REQUIRED:** Split de cuenta en mesa de 4 personas sin internet. Void con PIN de gerente offline. Tiempo de envío a cocina medido en 50 órdenes consecutivas.

**DEFINITION OF DONE:** Split disponible y testeado. Void offline con audit trail. P95 orden-a-cocina <2s en LAN.

**PRIORITY:** P1 (split), P0 (void offline verificado)

---

## 2. KDS y producción

**CURRENT STATE:** KDS page existe con broadcast LAN via WsHub. Filtro de estación implementado post-RC2. Bump de ítem. FIELD VERIFIED básico (jul-12). Filtro de estación CODE ONLY — no validado físicamente post-RC2.

**EVIDENCE:** FIELD-NOTES-PREFLIGHT-JUL12.md, OCS-P2.5.9-OFFLINE-SYNC.md (KDS broadcast CODE ONLY).

**WORLD-CLASS STANDARD:** Múltiples modos de bump (FIFO, priority, manual). Tracking de prep time por ítem. Pantalla expo. Alertas de tiempo excedido (ítem >15 min en preparación). Re-fire desde KDS. Indicador visual de mesa lista. KDS funciona 100% offline en LAN.

**COMPETITOR SIGNAL:** Wansoft FACT: KDS con filtros de estación en producción. Toast FACT: kitchen display system con timers. Nory INFERENCE: no tiene KDS propio, depende de POS.

**GAP:** Filtro de estación no validado físicamente post-RC2 (barra-en-cocina confirmado en Visit 3). Sin tracking de prep time. Sin pantalla expo. Sin alertas de tiempo.

**RISK:** Sin filtro validado = ítems incorrectos en pantallas erróneas = comandas de cocina confusas = errores de producción = pérdida de confianza del equipo de cocina.

**TARGET:** Filtro de estación FIELD VERIFIED (primera visita post-upgrade). Prep time tracking CODE.

**DEPENDENCIES:** Upgrade a v1.3.3. Diagnostic visit AMALAY.

**TEST REQUIRED:** Orden con ítems de cocina + barra: verificar que cocina NO ve bebidas y barra NO ve comidas. Medición de latencia orden→KDS en LAN sin internet (target <500ms).

**DEFINITION OF DONE:** Filtro de estación FIELD VERIFIED. Latencia <500ms documentada. Zero falsos positivos en routing de ítems.

**PRIORITY:** P0 (filtro de estación), P2 (prep time, expo)

---

## 3. Impresión y routing

**CURRENT STATE:** Multi-estación TCP+USB+Array. 40+ keywords de routing. Retry loop implementado. FIELD VERIFIED jul-12 (cocina fría, caliente, barra, caja). Retry loop CODE ONLY — no probado con impresora caída en campo.

**EVIDENCE:** FIELD-NOTES-PREFLIGHT-JUL12.md (smoke PASS en todas las estaciones), OCS-P2.5.6-IMPRESION.md.

**WORLD-CLASS STANDARD:** Impresión con confirmación de recepción (ACK). Queue persistente en disco (sobrevive restart). Auto-descubrimiento via mDNS/Bonjour. Fallback a impresora backup automático. Historial de impresión auditable. Re-impresión desde cualquier terminal.

**COMPETITOR SIGNAL:** Wansoft FACT: impresión por red funciona offline (SQL Server local, sin cloud). Toast FACT: cloud printing con hardware propio.

**GAP:** Queue de impresión en memoria (no persiste restart del bridge). Sin ACK de recepción. Sin auto-descubrimiento. Re-impresión existe (P1-05 PASS) pero retry con impresora caída no field-tested.

**RISK:** Restart del local server durante turno = pérdida de comandas en queue = ítems no llegan a cocina = incidente crítico.

**TARGET:** Queue de impresión persistente en disco. Retry con impresora caída FIELD VERIFIED. ACK de recepción CODE.

**DEPENDENCIES:** OCS P2.5.6 campo. v1.3.3 instalado.

**TEST REQUIRED:** Apagar impresora durante envío, encender, verificar reintento automático. Restart de Electron durante turno con comandas pendientes — verificar que no se pierden.

**DEFINITION OF DONE:** Zero pérdida de comandas en restart del bridge. Retry automático documentado y field-verified. Queue tamaño en /health.

**PRIORITY:** P0 (queue persistente), P1 (retry field-verified)

---

## 4. Caja, pagos y cortes

**CURRENT STATE:** Cobro efectivo y tarjeta externa (Getnet, MP Point) FIELD VERIFIED. Corte X/Z CERTIFIED (OCS P2.5.4). RecoverableOperation para MP Point CERTIFIED (P0-2, commit 672871a). Propina capturada manualmente. P0-3 (CSD Facturapi) bloqueado en SAT.

**NOTA CFDI — SEGMENT-SPECIFIC COMMERCIAL BLOCKER:** CFDI es bloqueante desde el día 1 para segmentos corporativos (cadenas con contratos empresa-empresa, Grupo Galería si su política requiere CFDI para proveedores). Para restaurantes SME independientes, puede existir transición temporal con facturista externo mientras CSD está en trámite. No declarar que CFDI bloquea a todo cliente corporativo sin validar su política específica.

**EVIDENCE:** OCS-P2.5.4-CAJA.md CERTIFIED, OCS-P2.5.8-PAGOS.md, DEPLOYMENT-STATE.md P0-2 CERTIFIED.

**WORLD-CLASS STANDARD:** Integración nativa con terminal (sin entrada manual de monto). Split de pago (efectivo + tarjeta en misma orden). Tip sugerido automático. Propina por mesero en corte Z. Descuento con PIN y razón auditada. CFDI automático al cobrar. Facturas de cortesía con flujo documentado.

**COMPETITOR SIGNAL:** Wansoft FACT: integración con Clip nativa (confirmado por Eduardo). Parrot FACT: integración Clip, NetPay. Toast FACT: payments processing propio (0.15% + $0.15/transacción).

**GAP:** Getnet requiere entrada manual del monto (no hay integración API). Sin split de pago por método en misma orden (P2-01). CFDI bloqueado en SAT. Factura de cortesía sin flujo (PRR-16).

**RISK:** Entrada manual de monto = error humano frecuente. Sin CFDI = cliente corporativo no puede usar Fullsite.

**TARGET:** MP Point API integration (charge dispatch desde POS). Split de pago CODE. CFDI cuando CSD disponible.

**DEPENDENCIES:** CSD SAT (Andy). MP Point Smart API access. P2-01.

**TEST REQUIRED:** Cobro con MP Point — verificar que monto se envía desde POS sin entrada manual. Split efectivo+tarjeta en una orden. CFDI generado y válido en SAT.

**DEFINITION OF DONE:** Zero entrada manual en cobro con tarjeta. CFDI emitido y aceptado por SAT. Split de pago en campo.

**PRIORITY:** P1 (MP Point API), P0 (CFDI cuando CSD disponible)

---

## 5. Offline-first y recuperación

**CURRENT STATE:** IDB schema v4 (orders, cash_movements, sync_queue). EVENT_STORE con replay en startup. Auto-sync al reconectar. PBKDF2 PIN offline. Visit 3 (jul-27): prueba básica PASS (8 órdenes sin internet, sync OK). Suite completa OCS P2.5.9 PENDING FIELD.

**EVIDENCE:** OCS-P2.5.9-OFFLINE-SYNC.md (estado CODE ONLY para la mayoría). DEPLOYMENT-STATE.md Visit 3.

**WORLD-CLASS STANDARD (referencia: Wansoft):** 100% de funcionalidad sin internet. SQL Server local como única fuente de verdad. Impresión offline. KDS offline. Cortes offline. Sin pantalla de error. Sin modo degradado. Cold start funcional en <30s.

**COMPETITOR SIGNAL:** Wansoft FACT: opera completamente sin internet (arquitectura SQL Server local). Toast FACT: modo offline limitado para pagos. Parrot INFERENCE: browser-based, degradación significativa sin internet.

**GAP:** La suite completa de offline (OCS P2.5.9: 12 criterios) no tiene FIELD VERIFIED. Cold start sistemático no testeado. Void offline con PIN no verificado en campo. Corte X/Z offline no verificado con turno real.

**RISK:** Si offline falla durante corte de luz/internet = operadores sin sistema = pérdida de turno completo = pérdida de confianza crítica.

**TARGET:** OCS P2.5.9 todos los criterios FIELD VERIFIED. Cold start <30s documentado. Wansoft parity en offline.

**DEPENDENCIES:** v1.3.3 instalado en AMALAY. Diagnostic visit. Field batch #2.

**TEST REQUIRED:** Los 12 criterios de OCS P2.5.9 ejecutados físicamente: cold start, órden sin internet, KDS LAN, impresión offline, restart durante turno, corte X offline, sync post-reconexión, dedup.

**DEFINITION OF DONE:** Todos los criterios OCS P2.5.9 = FIELD VERIFIED con evidencia fotográfica y Supabase evidence. Publicable como claim.

**PRIORITY:** P0 (bloquea Cliente #2 y todos los claims públicos)

---

## 6. Multi-terminal y conflictos

**CURRENT STATE:** P0-1 CERTIFIED: concurrencia multi-terminal sin pérdida de órdenes (commit 91379b5). WsHub con validación de restaurant_id mismatch. Protocolo de conflictos no documentado para escrituras simultáneas en mismo registro.

**EVIDENCE:** DEPLOYMENT-STATE.md P0-1 CERTIFIED. OCS-P2.5.7-ORDERS.md.

**WORLD-CLASS STANDARD:** Operational transform o CRDT para edición concurrente. Visual "mesa en uso" en tiempo real. Resolución de conflictos automática con audit trail. Multi-terminal con roles diferenciados (mesero solo ve sus mesas, gerente ve todo).

**COMPETITOR SIGNAL:** Wansoft FACT: multi-terminal con SQL Server locking. Toast FACT: multi-terminal con cloud sync. Ninguno publica arquitectura de conflictos. UNKNOWN en todos.

**GAP:** Estrategia de resolución de conflictos para escrituras simultáneas en mismo ítem de orden no documentada ni testeada. Sin indicador visual "mesa ocupada" en otras terminales. Roles multi-terminal no diferenciados en UI (todos ven todo).

**RISK:** Dos meseros modificando la misma orden simultáneamente sin internet → conflicto silencioso al reconectar → dato corrupto → pérdida de ítem.

**TARGET:** Conflict resolution documentada con evidencia. "Mesa en uso" CODE. Roles diferenciados en UI para multi-terminal.

**DEPENDENCIES:** Multi-terminal test con 2 tablets simultáneas (P1-01). OCS P2.5.9.

**TEST REQUIRED:** Modificación simultánea de misma orden desde 2 terminales sin internet. Reconexión → verificar que no hay pérdida de ítems ni corrupción.

**DEFINITION OF DONE:** Zero pérdida de ítems en conflicto documentada. Conflict resolution strategy en docs con evidencia de campo.

**PRIORITY:** P0 (integridad de datos), P1 (UX de conflictos)

---

## 7. Audit trail y permisos

**CURRENT STATE:** PBKDF2 offline PIN auth — 54 tests PASS (TEST VERIFIED). Role hierarchy con meetsMinRole en pos-manager-auth.ts. logAudit en 9+ operaciones. PRR-12 OPEN: logAudit fire-and-forget, log no protegido contra edición por rol manager.

**EVIDENCE:** OCS-P2.5.9-OFFLINE-SYNC.md (AUTH-OFFLINE-02 fix), PRR-v1.md PRR-12.

**WORLD-CLASS STANDARD:** Audit log inmutable (append-only, no editable por ningún rol). Session tracking por dispositivo. Firma criptográfica de eventos de auditoría. RBAC con UI diferenciada por rol. Rate limiting en PIN.

**COMPETITOR SIGNAL:** Wansoft FACT: permisos por nivel de usuario. Toast FACT: role-based access control. Ninguno publica detalle de audit trail. UNKNOWN.

**GAP:** logAudit fire-and-forget = evento de auditoría puede perderse silenciosamente. No hay rate limiting en PIN a nivel servidor (PRR-11). Log no protegido contra edición. Sin session tracking por dispositivo.

**RISK:** Pérdida silenciosa de eventos de auditoría = imposible demostrar compliance. Sin rate limiting = brute force de PIN posible.

**TARGET:** logAudit con retry + confirmación. Rate limiting server-side en PIN. Audit log append-only (no editable).

**DEPENDENCIES:** Server-side PIN endpoint refactor. Audit table design.

**TEST REQUIRED:** Intentar 10 PINs incorrectos consecutivos → verificar rate limiting. Verificar que audit log no puede ser truncado o editado por rol manager. Simular fallo de red durante logAudit → verificar retry.

**DEFINITION OF DONE:** PRR-11 y PRR-12 CLOSED con evidencia. Rate limiting PASS test. Audit log append-only verificado.

**PRIORITY:** P1 (PRR-11, PRR-12)

---

## 8. Instalación y migración

**CURRENT STATE:** NSIS installer v1.3.3 existe (SHA-256: 5abfc10e...). onboard_client.py (313 min/cliente ahorrados). bootstrap_client.py. FIELD UNVERIFIED — método de despliegue en AMALAY no documentado. 4 pasos manuales requieren Daniel.

**EVIDENCE:** PRR-v1.md PRR-05 (intervención manual), PRR-06 (sin smoke test), Runbook field batch #2 READY.

**WORLD-CLASS STANDARD:** Zero-touch provisioning: escanear QR → app descarga → config se aplica desde cloud → ready en <30 min. Smoke test automatizado post-provisioning. Rollback en <5 min. Sin intervención del fundador.

**COMPETITOR SIGNAL:** Toast FACT: hardware preconfigurado se envía al cliente ($799+ hardware fee). Wansoft FACT: consultoría de implementación $23K+ (DOLOR conocido). Parrot INFERENCE: configuración cloud con representante.

**GAP:** Daniel requerido en 4 pasos. Sin smoke test post-provisioning. Método de despliegue en AMALAY no confirmado (Branch A vs B). Sin rollback documentado para Branch B.

**RISK:** Instalación en Cliente #2 sin Daniel = posibilidad de fallo sin soporte. Rollback no documentado = tiempo de recuperación elevado.

**TARGET:** Onboarding en <4 horas sin Daniel. Smoke test automatizado. Rollback <30 min para cualquier branch.

**DEPENDENCIES:** Diagnostic visit AMALAY (determinar Branch A/B). Sandbox milestone cierre.

**TEST REQUIRED:** Provisionar un tercer cliente sin intervención de Daniel. Smoke test automatizado POST-provisioning PASS. Rollback ejecutado en <30 min en entorno de staging.

**DEFINITION OF DONE:** Segundo cliente onboarded sin Daniel. Smoke test verde. Rollback documentado con evidencia.

**PRIORITY:** P0 (bloquea escalabilidad comercial)

---

## 9. Diagnóstico y soporte remoto

**CURRENT STATE:** /health endpoint (CODE, 18 campos). Heartbeat a local_server_heartbeats cada 5 min. server.log con rotación 5MB. Sin Manager Panel (PRR-09 OPEN). Diagnóstico requiere acceso a código.

**EVIDENCE:** PRR-v1.md PRR-08, PRR-09. docs/runtime/RUNTIME-HEALTH.md.

**WORLD-CLASS STANDARD:** Dashboard de flota en tiempo real (todos los terminales, última vez visto, versión, queue size). Playbooks de resolución para los 10 errores más frecuentes. Acceso remoto auditado. Auto-diagnóstico desde la app. Alertas proactivas cuando un terminal lleva >15 min sin heartbeat.

**COMPETITOR SIGNAL:** Toast FACT: soporte telefónico 24/7 + remote management. Wansoft FACT: soporte vía TeamViewer + acceso SQL Server directo. UNKNOWN en todos los analytics players.

**GAP:** Sin Manager Panel. Sin dashboard de flota. Sin playbook operativo para "POS no arranca" (PRR-08). Soporte requiere que Daniel tenga acceso físico o TeamViewer.

**RISK:** Terminal caído en AMALAY sin Daniel disponible = restaurante sin POS = pérdida de revenue + confianza crítica.

**TARGET:** Manager Panel v1 (diagnóstico sin código). Dashboard de flota con heartbeat. Playbook operativo en MANUAL-OPERATIVO.md.

**DEPENDENCIES:** /health endpoint ya existe — construir UI encima. heartbeat ya existe.

**TEST REQUIRED:** Eduardo diagnóstica un problema en SERVER1 sin llamar a Daniel usando solo el Manager Panel. Playbook "POS no arranca" ejecutado por personal del restaurante.

**DEFINITION OF DONE:** Manager Panel PASS con Eduardo. Playbook ejecutado sin intervención de Daniel. PRR-08, PRR-09 CLOSED.

**PRIORITY:** P1 (bloquea Cliente #2)

---

## 10. Multi-tenant isolation

**CURRENT STATE:** RLS con client_id en todas las tablas. restaurant_id mismatch detection en WsHub. Sandbox milestone activo. Segundo tenant (vantara) onboarded con 5 bugs encontrados y corregidos (commit 056537c).

**CLASIFICACIÓN:** LAB VERIFIED (no FIELD VERIFIED). vantara = tenant sandbox, no cliente pagando con operaciones reales en campo. El aislamiento de datos fue verificado en entorno controlado. Reclasificado de FIELD VERIFIED → LAB VERIFIED en Correction Pass v2.

**EVIDENCE:** DEPLOYMENT-STATE.md, sandbox onboarding lessons memory, PRR-v1.md.

**WORLD-CLASS STANDARD:** Tenant isolation completa: datos, config, billing, feature flags, logs. Opción de schema dedicado para enterprise. Sin posibilidad de cross-tenant data leak bajo ninguna condición.

**COMPETITOR SIGNAL:** Restaurant365 FACT: multi-tenant cloud (cuentas separadas). Toast FACT: multi-tenant cloud. Wansoft FACT: instalación on-premise por cliente (aislamiento físico). UNKNOWN en todos sobre detalles de implementación.

**GAP:** Mismo Supabase project para todos los tenants (RLS como única barrera). Feature flags no per-tenant. Sin billing isolation. Sin schema dedicado disponible. 5 bugs encontrados en primer segundo tenant.

**RISK:** Bug en RLS = cross-tenant data leak = pérdida de cliente + riesgo legal.

**TARGET:** RLS auditada por segundo par de ojos. Penetration test básico de cross-tenant access. Feature flags per-tenant.

**DEPENDENCIES:** Sandbox milestone cierre. Segundo tenant completamente aislado.

**TEST REQUIRED:** Intentar acceder a datos de tenant A con credenciales de tenant B usando Supabase REST directo. Verificar zero leakage. Repetir con service_role key (debería ser imposible por design).

**DEFINITION OF DONE:** Pen test básico cross-tenant PASS con evidencia. Sandbox milestone cerrado. PRR tenants CLOSED.

**PRIORITY:** P0 (integridad crítica)

---

## 11. Normalización de datos

**CURRENT STATE:** Nombres de ítems heredados de Wansoft (nombre original de restaurante). Sin pipeline de normalización. Unidades mezcladas en recetas (g, kg, piezas, ml). Sin tracking de cambios de nombre históricos.

**EVIDENCE:** FIELD-NOTES-PREFLIGHT-JUL12.md (migración manual de 522 ítems).

**WORLD-CLASS STANDARD:** Taxonomía canónica de productos con aliases. Unidades normalizadas con conversión automática. Historial de cambios de nombre tracked (para análisis histórico correcto). Detección de duplicados en catálogo.

**COMPETITOR SIGNAL:** Restaurant365 FACT: chart of accounts normalizado. Supy FACT: normalización de ingredientes para multi-proveedor. UNKNOWN en POS players.

**GAP:** Sin pipeline de normalización de unidades. Cambio de nombre de ítem rompe histórico. Sin detección de duplicados en catálogo. 154 ítems sin equivalente en Wansoft (desconocido si activos o descontinuados).

**RISK:** Análisis histórico basado en nombres rotos = conclusiones de agentes incorrectas = falsos positivos.

**TARGET:** Normalización de unidades CODE. Alias de ítems para mantener histórico. Pipeline de dedup CODE.

**DEPENDENCIES:** No bloquea P0. Prerrequisito para margin intelligence confiable.

**TEST REQUIRED:** Renombrar ítem en catálogo → verificar que análisis histórico sigue correcto (usa ID, no nombre). Consulta de ingredientes con unidades mezcladas → verificar conversión automática.

**DEFINITION OF DONE:** Unit normalization CODE con tests. Alias table design aprobada por Daniel.

**PRIORITY:** P2

---

## 12. Business date y cierres

**CURRENT STATE:** Business date logic en get_current_business_date(). Turno lifecycle (abierto/cerrado). Corte Z certificado (OCS P2.5.4). Sin configuración por sucursal de hora de corte. Sin cierre automático.

**EVIDENCE:** OCS-P2.5.4-CAJA.md, ops_aggregate.py.

**WORLD-CLASS STANDARD:** Business day cutoff configurable por sucursal (ej. 3am para bares nocturnos, 4pm para cafés). Cierre automático al alcanzar cutoff. Reconciliación de periodo fiscal. Alertas si turno lleva >18h abierto sin cierre.

**COMPETITOR SIGNAL:** Restaurant365 FACT: business date configurable para multi-turno. Wansoft INFERENCE: business date hardcoded (software legacy). UNKNOWN en mayoría.

**GAP:** Cutoff hardcoded o no per-sucursal. Sin cierre automático. Sin alerta de turno excesivamente largo. Sin reconciliación fiscal automática.

**RISK:** Restaurante que opera pasada medianoche confunde business dates en reporte diario = datos incorrectos = agentes con datos erróneos.

**TARGET:** Business date cutoff configurable per-client en clients table. Alerta si turno >16h.

**DEPENDENCIES:** Client config schema extensión. Baja complejidad.

**TEST REQUIRED:** Configurar cutoff a las 3am. Abrir turno a las 11pm → verificar que fecha de negocio es correcta al cruzar medianoche.

**DEFINITION OF DONE:** Cutoff por cliente TEST VERIFIED. Alerta turno largo CODE.

**PRIORITY:** P2

---

## 13. Recetas, unidades y costos

**CURRENT STATE:** 178 recetas canónicas activas, 708 líneas de ingredientes, FIELD VERIFIED R1. Food cost ~27.6% calculado (CODE, no en tiempo real). Sin yield factor. Sin subrecetas. Sin tracking de costo por orden.

**EVIDENCE:** R1-AMALAY-VALIDATION.md, FIELD-NOTES.md jul-07 (Eduardo solicitó yield factor), food_cost_truth memory.

**WORLD-CLASS STANDARD:** Costo calculado por orden en tiempo real (al cocinar). Yield factor (merma/cocción) por ingrediente. Subrecetas (masa madre → pan → sandwich). Costo estándar vs costo real (varianza). Alerta de food cost fuera de rango.

**COMPETITOR SIGNAL:** Supy FACT: gestión de recetas con yield factor y subrecetas (wedge principal). Restaurant365 FACT: recipe costing integrado con P&L. Wansoft FACT: recetas con costo (Eduardo confirmó Wansoft tiene esto).

**GAP:** Sin yield factor (Eduardo solicitó 2+ veces). Sin subrecetas. Costo calculado en batch, no por orden. Sin varianza estándar vs real.

**RISK:** Food cost sin yield factor = número incorrecto = decisiones de precio basadas en datos erróneos.

**TARGET:** Yield factor en pos_recipe_lines. Costo por orden registrado en pos_orders. Alerta food cost >threshold CODE.

**DEPENDENCIES:** pos_recipe_lines migration (add yield_factor column). pos_orders cost column.

**TEST REQUIRED:** Receta con yield factor configurado → verificar que costo calculado refleja merma. Orden cobrada → verificar que costo real queda en pos_orders.

**DEFINITION OF DONE:** Yield factor TEST VERIFIED. Costo por orden en DB. Food cost report con varianza CODE.

**PRIORITY:** P1

---

## 14. Inventario y compras

**CURRENT STATE:** wansoft_existencias (datos externos, lectura solo, stale). inventory_auto_order agent y purchase_predictor CODE. Deducción de inventario al cobrar (PAY-02 OPEN en P0 blockers). Sin conteo físico workflow.

**EVIDENCE:** DEPLOYMENT-STATE.md P0 blockers, wansoft_inventory_structure memory.

**WORLD-CLASS STANDARD:** Deducción en tiempo real al preparar (no al cobrar). Conteo físico con workflow de ajuste y razón. Ordenes de compra generadas automáticamente con precios de proveedor. Inventario de múltiples almacenes. Alertas de stockout con anticipación.

**COMPETITOR SIGNAL:** Supy FACT: wedge principal es inventory + purchasing (MENA). Wansoft FACT: 6 almacenes, ordenes de compra integradas, recetas completas. Restaurant365 FACT: inventory management integrado con contabilidad.

**GAP:** Inventario actual viene de Wansoft (no propio). Deducción al cobrar (no al preparar). Sin conteo físico workflow. Sin precios de proveedor en sistema. PAY-02 OPEN.

**RISK:** Sin inventario propio = Fullsite depende de Wansoft para margin truth = no puede funcionar sin Wansoft = no es autónomo como plataforma.

**TARGET:** Inventario propio con deducción por receta. Conteo físico workflow CODE. PO generation CODE.

**DEPENDENCIES:** pos_inventory table design. Recetas completas (ya existen). Separar de dependencia Wansoft.

**TEST REQUIRED:** Servir 10 porciones de un ítem con receta → verificar deducción de ingredientes. Conteo físico → ajuste registrado con razón y usuario.

**DEFINITION OF DONE:** Inventario propio activo en AMALAY. Deducción TEST VERIFIED. Conteo físico FIELD VERIFIED.

**PRIORITY:** P2 (después de offline P0)

---

## 15. Forecasting

**CURRENT STATE:** close_predictor.py corre 2x/día con distribución horaria HARDCODED para café brunch (no aprendida de datos de AMALAY). purchase_predictor.py CODE. Sin backtests. Sin error medido. Sin intervalo de confianza.

**EVIDENCE:** close_predictor.py (HOURLY_DISTRIBUTION hardcoded, líneas 45-60). purchase_predictor.py.

**WORLD-CLASS STANDARD:** Modelo por sucursal, por día de semana, por hora. Ajuste por eventos especiales, clima, feriados. Intervalo de confianza explícito. Backtest obligatorio antes de producción. Drift detection cuando modelo se degrada. Error medido (MAE, MAPE) por daypart.

**COMPETITOR SIGNAL:** Nory FACT: demand forecasting como wedge principal. Tenzo FACT: predictive analytics. Restaurant365 INFERENCE: forecasting integrado con P&L. UNKNOWN en todos sobre precisión publicada.

**GAP:** Distribución horaria hardcoded no refleja el patrón real de AMALAY. Sin backtest. Sin error medido. Sin confianza. Forecasts se presentan como verdad cuando son estimaciones con supuestos incorrectos.

**RISK:** Forecast incorrecto → decisión incorrecta de compras/staffing → costo real. Forecast sin confianza = agente no puede abstenerse cuando datos son insuficientes.

**TARGET:** Distribución horaria aprendida de datos reales de AMALAY (últimas 8 semanas). Backtest con MAE/MAPE documentado. Intervalo de confianza explícito.

**DEPENDENCIES:** 90+ días de datos de wansoft_daily por hora (si existe) o pos_orders con timestamp. Agent Accuracy Program.

**TEST REQUIRED:** Backtest: predecir cierre en 30 días históricos → comparar contra real → calcular MAE. Shadow mode: correr en paralelo sin publicar 2 semanas → medir accuracy.

**DEFINITION OF DONE:** MAE publicado. Backtest documentado. Distribución horaria aprendida, no hardcoded.

**PRIORITY:** P2

---

## 16. Labor y productividad

**CURRENT STATE:** asistencia desde Wansoft. staffing_optimizer.py corre lunes (CODE, no medido). tips_analyzer.py CODE. Sin costo de labor integrado. Sin productividad por hora-hombre.

**EVIDENCE:** .github/scripts/staffing_optimizer.py, tips_analyzer.py. wansoft_asistencia.json.

**WORLD-CLASS STANDARD:** Costo de labor en tiempo real contra presupuesto. Productividad por hora-hombre (ventas/horas trabajadas). Scheduling con demanda forecast. Compliance de descansos. OT alertas. Labor vs food cost = prime cost ratio.

**COMPETITOR SIGNAL:** Nory FACT: labor scheduling integrado. Toast FACT: scheduling module ($17/mes add-on). R365 FACT: labor cost integrado con P&L. Wansoft FACT: nómina básica.

**GAP:** Costo de labor no integrado con ventas → prime cost desconocido. Staffing recommendations no medidas → no se sabe si funcionan. Asistencia de Wansoft (dependencia externa).

**RISK:** Sin prime cost = análisis de rentabilidad incompleto = no se puede optimizar la segunda variable más grande de costos.

**TARGET:** Prime cost diario calculado (food + labor / ventas). Labor cost integrado en P&L diario.

**DEPENDENCIES:** Labor data propio o Wansoft-independent. pos_staff con hourly_rate. Turno de trabajo con entrada/salida.

**TEST REQUIRED:** Prime cost calculado para 7 días consecutivos → comparar con benchmark industria (~55-65% para casual dining).

**DEFINITION OF DONE:** Prime cost visible en dashboard. Labor cost en pos_daily_summary.

**PRIORITY:** P2

---

## 17. P&L y contribution margin

**CURRENT STATE:** Ventas FIELD VERIFIED. Food cost ~27.6% CODE. Sin integración de costo de labor. Sin overhead. Sin estado de resultados. "Margin truth" es parcial.

**EVIDENCE:** PUBLIC-CLAIMS-REGISTER.md ("Control de recetas e inventario" HECHO), PRR-v1.md.

**WORLD-CLASS STANDARD:** P&L diario por sucursal (ventas - food cost - labor - overhead = contribution margin). Contribution margin por producto. Rentabilidad por turno. 4-wall economics completos. Integración con contabilidad.

**COMPETITOR SIGNAL:** Restaurant365 FACT: P&L completo integrado con accounting (wedge principal). Tenzo FACT: contribution margin reporting. Supy FACT: costo de platos + margen. UNKNOWN en granularidad de datos en todos.

**GAP:** Sin P&L. Sin contribution margin. Sin overhead allocation. Ningún claim de "margin intelligence" puede considerarse completo sin esto.

**RISK:** Declarar "margin intelligence" sin P&L completo = claim sin evidencia = viola la regla "No claims sin evidencia".

**TARGET:** P&L diario con cobertura explícita (ventas ✓, food cost ✓, labor PENDING, overhead NOT IMPLEMENTED). Publicar solo lo que está verificado con disclaimer de cobertura.

**DEPENDENCIES:** Labor integration. Overhead debe ser ingresado manualmente (no automatizable sin contabilidad).

**TEST REQUIRED:** P&L de 30 días donde cada línea tiene fuente documentada. Contribution margin por producto top-10.

**DEFINITION OF DONE:** P&L diario con cobertura declarada. Sin claims de "P&L completo" hasta que overhead esté integrado.

**PRIORITY:** P1 (contribution margin parcial es publicable con disclaimer)

---

## 18. Detección de anomalías

**CURRENT STATE:** anomaly_detector.py con umbrales hardcoded: 20% ventas, 15% ticket, 50% mesero, 30% categoría. Corre 2x/día. Sin precision/recall medido. Sin calibración de umbrales. Sin adaptive learning.

**EVIDENCE:** anomaly_detector.py (líneas 38-42 thresholds), agent_common.py check_freshness().

**WORLD-CLASS STANDARD:** Umbrales aprendidos por ubicación, día, hora. Modelo estadístico (z-score, IQR) en vez de reglas hardcoded. Precision ≥90%, recall ≥75%. Abstención si datos insuficientes. Root cause attribution. Priority scoring por impacto financiero.

**COMPETITOR SIGNAL:** Marble INFERENCE: ML-based anomaly detection (wedge de analytics). Tenzo FACT: trend alerts. NINGUNO publica precision/recall. UNKNOWN en accuracy real.

**GAP:** Umbrales no calibrados (¿por qué 20%? ¿por qué 50%?). Sin precision/recall. Sin adaptive thresholds. Sin root cause. Un 20% de varianza puede ser completamente normal en un día lluvioso.

**RISK:** Umbral demasiado sensible → false positives → operadores ignoran alertas → alert fatigue → miss de anomalía real crítica.

**TARGET:** Umbrales calibrados con 90 días de datos históricos. Precision ≥90% medida. False positive rate ≤10%.

**DEPENDENCIES:** 90+ días de datos por DOW. Dataset de 30 días etiquetados manualmente por gerente. Agent Accuracy Program.

**TEST REQUIRED:** Backtest en 90 días: comparar alertas generadas vs anomalías reales (etiquetadas). Calcular precision/recall/F1.

**DEFINITION OF DONE:** Precision y recall publicados con metodología. Umbrales documentados con razón (no arbitrarios).

**PRIORITY:** P1 (parte del Agent Accuracy Program)

---

## 19. Precisión de agentes

**CURRENT STATE:** 26+ agentes corriendo. Cero agentes con precision/recall medido. Sin dataset de benchmark. Sin human labels. Sin shadow mode. Sin drift detection. agent_events tabla con estimated_value pero outcome raramente poblado.

**EVIDENCE:** .github/scripts/ (26+ scripts), agent_runs tabla, agent_events tabla.

**WORLD-CLASS STANDARD:** Cada agente de detección: precision ≥90%, recall ≥75%, F1 publicado. Cada agente predictivo: MAE publicado, backtest ≥90 días, shadow mode antes de producción. Dataset etiquetado permanente. Drift detection automático.

**COMPETITOR SIGNAL:**
FACT: Durante esta investigación no se encontraron métricas públicas de precision/recall para agentes de restaurante en ninguno de los 10 competidores analizados.
UNKNOWN: Si competidores tienen métricas internas no publicadas.
HYPOTHESIS: Publicar certificación transparente podría ser una oportunidad de posicionamiento.

**GAP:** Zero agentes certificados. Sin infraestructura de medición. Agentes pueden estar equivocados sistemáticamente sin que nadie lo sepa.

**RISK:** Agente con 60% de precision = 40% de alertas falsas = operadores dejan de confiar = agentes pierden valor = inversión perdida.

**TARGET:** 3 agentes PRODUCTION CERTIFIED con métricas publicadas. Agent Accuracy Program implementado.

**DEPENDENCIES:** Dataset de 30 días etiquetado. Human review process. Shadow mode infrastructure.

**TEST REQUIRED:** Backtest de anomaly_detector en 90 días históricos. Human review de 50 alertas consecutivas. Calcular precision/recall/calibration error.

**DEFINITION OF DONE:** 3 agentes con precision/recall publicado en AGENT-ACCURACY-PROGRAM.md. Dataset etiquetado en DB. Shadow mode activo.

**PRIORITY:** P1 (define el valor de todos los agentes)

---

## 20. Confianza y abstención

**CURRENT STATE:** Los agentes presentan outputs sin importar calidad de datos. Sin confidence scores. Sin abstención documentada en ningún agente. check_freshness() existe en agent_common pero no en todos los agentes.

**EVIDENCE:** anomaly_detector.py, close_predictor.py — no hay lógica de abstención en ninguno.

**WORLD-CLASS STANDARD:** Cada output de agente tiene confidence score (0-1). Umbrales de abstención por agente. Mensaje explícito cuando se abstiene y por qué. Cobertura de datos declarada en cada output.

**COMPETITOR SIGNAL:** NINGUNO publica lógica de abstención. UNKNOWN si existe. Oportunidad de diferenciación.

**GAP:** Agentes pueden concluir sobre datos de hace 48 horas sin advertencia. Agentes pueden presentar predicciones con 3 datos históricos (estadísticamente inválido).

**RISK:** Conclusión incorrecta presentada como verdad → decisión de negocio errónea → pérdida de confianza en el sistema.

**TARGET:** Cada agente implementa abstención explícita. check_freshness() enforced en todos. Confidence score en cada output.

**DEPENDENCIES:** Agent Accuracy Program. Diseño de abstención rules per-agent.

**TEST REQUIRED:** Correr agente con datos stale >24h → verificar abstención. Correr con <4 puntos históricos → verificar abstención con mensaje explícito.

**DEFINITION OF DONE:** 100% de agentes con abstención implementada y documentada. Check_freshness enforced en todos.

**PRIORITY:** P1 (prerequisito para claims de AI)

---

## 21. Provenance y freshness

**CURRENT STATE:** check_freshness() en agent_common. wansoft_staleness agent. data_source toggle en clients table. Sin provenance almacenado con cada insight en DB. Mixing silencioso de fuentes posible.

**EVIDENCE:** agent_common.py check_freshness(), wansoft-staleness.yml, bridge-client.ts.

**WORLD-CLASS STANDARD:** Cada dato tiene source, timestamp de origen, y confidence. Insights en DB incluyen provenance. Sin silent mixing de fuentes. Alerta explícita cuando fuente cambia o está degradada.

**COMPETITOR SIGNAL:** Restaurant365 FACT: todos los datos tienen fuente de contabilidad auditada. UNKNOWN en analytics players.

**GAP:** Insights guardados en DB sin provenance. check_freshness() no enforced en todos los agentes. Silent mixing: un agente puede combinar wansoft_daily (de ayer) con wansoft_kpis (de hace 2h) sin declararlo.

**RISK:** Análisis con datos mezclados de diferentes timestamps → conclusión temporalmente inconsistente → decisión errónea.

**TARGET:** Cada insight en agent_events incluye sources_used[], timestamps[], y freshness_ok boolean. check_freshness() enforced en todos los agentes.

**DEPENDENCIES:** agent_events schema migration. Agent Accuracy Program.

**TEST REQUIRED:** Verificar que un insight rechazado por freshness muestra mensaje explicando por qué. Verificar que fuentes usadas quedan en DB con el insight.

**DEFINITION OF DONE:** agent_events.sources_used populated en 100% de runs. check_freshness enforced y auditable.

**PRIORITY:** P1

---

## 22. Alert lifecycle

**CURRENT STATE:** Agentes envían mensajes a Telegram. Sin tracking de alert_shown → viewed → accepted → rejected → executed → measured. Sin escalación. Sin snooze. Sin dismiss.

**EVIDENCE:** .github/scripts/agent_common.py send_telegram(). agent_events tabla sin lifecycle columns.

**WORLD-CLASS STANDARD:** Alert lifecycle completo en DB: cuando se mostró, quién la vio, qué acción se tomó, cuándo, resultado medido. Escalación automática si no se actúa en N horas. Snooze y dismiss con razón. Dashboard de alerts sin resolver.

**COMPETITOR SIGNAL:** NINGUNO publica alert lifecycle tracking. UNKNOWN. Oportunidad de diferenciación.

**GAP:** No se sabe si ninguna alerta de Telegram fue vista, leída, o actuada. Sin evidencia de impacto.

**RISK:** Invertir en agentes cuyo impacto real es desconocido → no se puede demostrar ROI → cliente no ve valor.

**TARGET:** Alert lifecycle table en Supabase. In-app inbox para alerts (no solo Telegram). Tracking básico de viewed/accepted/rejected.

**DEPENDENCIES:** In-app notification system. agent_events schema migration.

**TEST REQUIRED:** Trigger anomaly alert → verificar que queda en inbox → marcar como accepted → verificar que outcome puede ser registrado → verificar que dashboard muestra el lifecycle.

**DEFINITION OF DONE:** Alert lifecycle en DB. In-app inbox CODE. Outcome tracking en 3+ tipos de alert.

**PRIORITY:** P1 (sin esto no se puede medir impacto)

---

## 23. Ejecución de acciones

**CURRENT STATE:** Agentes recomiendan via Telegram. agent_events con estimated_value. Sin ejecución de acciones desde la app. Sin flujo DRAFT → REVIEW → APPROVED → EXECUTED → MEASURED implementado.

**EVIDENCE:** agent_events tabla, agent_common.py create_insight().

**WORLD-CLASS STANDARD:** Agente propone draft → gerente aprueba en app → acción ejecutada automáticamente o con asistencia → resultado medido → aprendizaje. Ejemplos: crear PO, ajustar precio, asignar tarea, bloquear ítem temporalmente.

**COMPETITOR SIGNAL:** Restaurant365 FACT: approval workflows para POs. NINGÚN analytics player publica ejecución real de acciones. UNKNOWN.

**GAP:** Cero acciones ejecutables. Todas las recomendaciones requieren acción manual humana sin tracking.

**RISK:** Sin ejecución = agentes son dashboards glorificados, no sistemas de acción.

**TARGET:** 1 acción ejecutable certificada: propuesta de orden de compra → aprobación gerente en app → PO generada. Con lifecycle completo.

**DEPENDENCIES:** Alert lifecycle (dim 22). Approval workflow design. Supplier data.

**TEST REQUIRED:** Agente detecta stockout risk → genera PO draft → gerente aprueba → PO enviada a proveedor → inventario actualizado → costo real vs estimado medido.

**DEFINITION OF DONE:** Una acción end-to-end con DRAFT→EXECUTED→MEASURED documentada y repetible.

**PRIORITY:** P2 (requiere infrastructure anterior)

---

## 24. Medición de impacto

**CURRENT STATE:** agent_events.estimated_value existe. agent_events.outcome raramente poblado. Sin A/B. Sin before/after. Sin atribución causal.

**EVIDENCE:** agent_events tabla schema (estimated_value, outcome columns), AI Ops v1 state memory.

**WORLD-CLASS STANDARD:** Cada acción recomendada tiene impacto estimado y medido. Metodología de atribución causal documentada. Dashboard de impacto financiero acumulado. Separación clara entre impacto estimado e impacto verificado.

**COMPETITOR SIGNAL:** NINGUNO publica impacto medido de sus agentes. UNKNOWN. Oportunidad de diferenciación masiva.

**GAP:** outcome column en agent_events raramente poblado. Sin metodología de before/after. Sin diferenciación entre estimated y verified impact.

**RISK:** Reportar $8,400 en fraude detectado (removido del register) sin metodología → pérdida de credibilidad.

**TARGET:** 3 acciones con before/after medido y publicado. Metodología de atribución documentada.

**DEPENDENCIES:** Alert lifecycle. Action execution. Historical baseline de cada métrica.

**TEST REQUIRED:** Intervención en food cost → medir food cost antes y después de intervención por 30 días → calcular impacto con confidence interval.

**DEFINITION OF DONE:** 3 acciones con impacto MEDIDO (no estimado) publicadas en caso de cliente.

**PRIORITY:** P2

---

## 25. Aprendizaje entre sucursales

**CURRENT STATE:** Un solo cliente activo (AMALAY). Sin cross-tenant intelligence. Sin modelos compartidos entre sucursales.

**EVIDENCE:** client_config.py, clients table (client_slug).

**WORLD-CLASS STANDARD:** Modelos entrenados en datos agregados mejoran per-location predictions. Benchmark de cada sucursal contra cohort comparable. Transferencia de conocimiento de recetas exitosas entre sucursales.

**COMPETITOR SIGNAL:** Marble INFERENCE: network effects como moat (cross-restaurant patterns). Nory INFERENCE: benchmark entre restaurantes similares. UNKNOWN en implementación real.

**GAP:** Con un solo cliente no hay cross-location learning posible. Arquitectura multi-tenant existe pero no hay modelos compartidos.

**RISK:** Sin cross-location learning, cada nuevo cliente comienza de cero → más tiempo para demostrar valor.

**TARGET:** Con 3+ clientes: cohort benchmarking básico. Con 10+: modelo compartido por categoría de restaurante.

**DEPENDENCIES:** 3+ clientes activos. Normalización de datos. Data governance (opt-in/opt-out para cross-tenant).

**TEST REQUIRED:** No aplicable aún (single client). Diseñar arquitectura ahora para que sea posible después.

**DEFINITION OF DONE:** Arquitectura de federated learning DESIGNED (no implementada) antes de cliente #3.

**PRIORITY:** P3

---

## 26. Onboarding documental

**CURRENT STATE:** onboard_client.py (313 min ahorrados/cliente). bootstrap_client.py. MANUAL-OPERATIVO.md (AMALAY-específico). DEPLOYMENT-STATE.md. 4 pasos manuales requieren Daniel. Sin smoke test automatizado.

**EVIDENCE:** PRR-v1.md PRR-05, PRR-06. Memory project_provisioning_engine_direction.

**WORLD-CLASS STANDARD:** Documentación autocontenida para partner/reseller. Video walkthrough. Checklist ejecutable por operador sin conocimiento técnico. Smoke test automatizado post-provisión. <4 horas de onboarding total.

**COMPETITOR SIGNAL:** Toast FACT: hardware preconfigurado, guías en línea, soporte telefónico. Wansoft FACT: $23K consultoría (PAIN POINT). UNKNOWN en duración real de onboarding.

**GAP:** MANUAL-OPERATIVO.md es AMALAY-específico (menciona nombres propios, IPs, config exacta). Sin versión genérica. Sin smoke test. Sin video.

**RISK:** Escalar sin onboarding repetible = Daniel como bottleneck = no se puede crecer.

**TARGET:** MANUAL-OPERATIVO-TEMPLATE.md genérico (sin datos de cliente específico). Smoke test automatizado. Onboarding sin Daniel en <4h.

**DEPENDENCIES:** Sandbox milestone cierre. Segundo cliente completamente onboarded.

**TEST REQUIRED:** Partner desconocido sigue el manual de onboarding sin hablar con Daniel → restaurante operativo en <4h.

**DEFINITION OF DONE:** Segundo cliente onboarded sin Daniel. Manual genérico. Smoke test verde.

**PRIORITY:** P0 (bloquea escalabilidad)

---

## 27. UX para operadores

**CURRENT STATE:** POS con botones grandes, flujo de turno obligatorio, offline.html con retry, KDS con bump. FIELD VERIFIED en operación real AMALAY. Sin split por ítem. Sin gestión de errores comprehensiva offline.

**EVIDENCE:** FIELD-NOTES.md (feedback positivo: "Ha que fregón"). R1-AMALAY-VALIDATION.md.

**WORLD-CLASS STANDARD:** One-handed operation. Error prevention (confirmación para void). UX offline sin mensaje de error aterrador. Localization completa. Accesibilidad visual (high contrast). Onboarding en app (primera vez de usuario).

**COMPETITOR SIGNAL:** Toast FACT: UX reconocida como el estándar en restaurantes US. Wansoft FACT: UI Windows desktop (aging, no touchscreen-native). Parrot INFERENCE: web-based, touchscreen-friendly.

**GAP:** Split por ítem pendiente (P2-01). Sin flujo de error prevention comprehensivo (¿qué pasa si mesero accidentalmente cobra sin enviar a cocina?). Sin onboarding in-app para nuevo mesero. Solo ES-MX.

**RISK:** Sin split → mesas grandes = trabajo manual = errores = insatisfacción de operador.

**TARGET:** Split por ítem P1. Error prevention en operaciones irreversibles (void, cierre de turno). Onboarding in-app para nuevo mesero CODE.

**DEPENDENCIES:** P2-01. UX research con operadores AMALAY.

**TEST REQUIRED:** Nuevo mesero sin entrenamiento usa el POS por primera vez → tasa de errores medida. Void accidental simulado → confirmación requerida.

**DEFINITION OF DONE:** Split FIELD VERIFIED. Confirmación en operaciones destructivas TEST VERIFIED. Tasa de errores de nuevos usuarios medida.

**PRIORITY:** P1 (split), P2 (resto)

---

## 28. UX para gerentes y dueños

**CURRENT STATE:** Dashboard en app.fullsite.mx con KPIs de Wansoft. Telegram briefings diarios. Sin Manager Panel (PRR-09). Sin approval workflow en app. Datos dependen de Wansoft sync.

**EVIDENCE:** PRR-v1.md PRR-09. CLAUDE.md (dashboard KPIs).

**WORLD-CLASS STANDARD:** Dashboard en tiempo real con datos propios (no depende de sync externo). Exception inbox (alertas pendientes de acción). Approval workflow in-app (no via Telegram). Mobile-native. Drill-down a nivel de orden.

**COMPETITOR SIGNAL:** Toast FACT: manager dashboard en app y web. R365 FACT: executive dashboard con P&L. Tenzo FACT: GM dashboard. Wansoft FACT: reportes en Windows desktop (no mobile).

**GAP:** Dashboard depende de Wansoft sync (stale posible). Sin exception inbox in-app. Sin approval workflow. PRR-09 open. Sin drill-down a nivel de orden desde dashboard.

**RISK:** Dashboard estático sin datos en tiempo real = gerente toma decisiones con datos de ayer.

**TARGET:** Dashboard con datos propios (pos_orders, pos_daily_summary). Exception inbox CODE. Manager Panel v1.

**DEPENDENCIES:** pos_daily_summary table con datos propios. Alert lifecycle. Manager Panel design.

**TEST REQUIRED:** Eduardo usa Manager Panel para diagnosticar problema sin llamar a Daniel. Dashboard muestra datos de los últimos 15 minutos (no últimas 24h de Wansoft).

**DEFINITION OF DONE:** Manager Panel v1 PASS con Eduardo. Dashboard sin dependencia de Wansoft para datos operativos básicos.

**PRIORITY:** P1 (Manager Panel), P2 (dashboard propio)

---

## 29. Seguridad y resiliencia

**CURRENT STATE:** RLS (authenticated). PBKDF2 PIN (TEST VERIFIED). logAudit fire-and-forget (PRR-12 OPEN). Crash recovery en Agent OS. Políticas SOC 2 redactadas. Sin pen test. Sin backup automático verificado.

**EVIDENCE:** PRR-v1.md PRR-11, PRR-12. Compliance sprint memory. OCS-P2.5.9 AUTH-OFFLINE-02.

**WORLD-CLASS STANDARD:** SOC 2 Type II certificado. Pen test anual. MFA en admin. Audit log inmutable. Backup automático verificado diariamente. Rate limiting en todos los endpoints sensibles. Secret scanning en CI.

**COMPETITOR SIGNAL:** Toast FACT: SOC 2 Type II certificado. R365 FACT: SOC 2 Type II. NINGUNO en Mexico/LATAM publica certificaciones de seguridad formales.

**GAP:** PRR-11 (rate limiting PIN), PRR-12 (audit log fire-and-forget) OPEN. Sin pen test. Sin backup verificado. SOC 2 policies existen pero no auditadas.

**RISK:** PIN sin rate limiting = brute force posible. logAudit fire-and-forget = eventos perdibles. Sin SOC 2 = enterprise buyers rechazarán sin auditoría.

**TARGET:** PRR-11 y PRR-12 CLOSED. Rate limiting TEST VERIFIED. Pen test básico (OWASP top 10) antes de Cliente #2.

**DEPENDENCIES:** Server-side PIN endpoint. Audit log append-only design.

**TEST REQUIRED:** OWASP top 10 check manual. Rate limiting: 10 PINs incorrectos → bloqueo. Audit log: intentar editar evento → verificar que es imposible.

**DEFINITION OF DONE:** PRR-11, PRR-12 CLOSED. OWASP checklist PASS. Pen test certificado.

**PRIORITY:** P1

---

## 30. Escalabilidad comercial

**CURRENT STATE:** Multi-tenant architecture CODE. onboard_client.py. Sandbox milestone activo. Un cliente pagando (AMALAY). Daniel como bottleneck en provisioning y soporte.

**EVIDENCE:** PRR-v1.md (Score 4.7/10). Memory project_official_roadmap.

**WORLD-CLASS STANDARD:** Zero-touch provisioning. Self-service billing (Stripe). Partner/reseller program con comisión. 100+ clientes en misma infraestructura sin degradación. Soporte escalado con playbooks, no con fundador.

**COMPETITOR SIGNAL:** Toast FACT: 100K+ restaurantes. Wansoft FACT: 1,500 clientes con equipo dedicado. Parrot INFERENCE: México-scale multi-tenant. NINGUNO revela arquitectura de provisioning.

**GAP:** Daniel requerido para provisioning. Sin billing automatizado. Sin soporte escalado. Un cliente. PRR score 4.7/10.

**RISK:** Sin provisioning automático = cada nuevo cliente toma días de Daniel = no escala por definición.

**TARGET:** Provisioning sin Daniel. Billing automatizado (Stripe o equivalente). Soporte playbook para top 5 incidentes. 5 clientes activos.

**DEPENDENCIES:** Sandbox milestone cierre. Todos los P0 de PRR-v1 CLOSED.

**TEST REQUIRED:** Onboarding completo de cliente nuevo sin Daniel en <4h. Billing generado y cobrado automáticamente. Soporte resuelve incidente con playbook sin escalar.

**DEFINITION OF DONE:** PRR score ≥7/10. 5 clientes activos. Onboarding sin Daniel documentado con evidencia.

**PRIORITY:** P0 (bloquea misión)

---

## Resumen ejecutivo de gaps por prioridad

### P0 — Bloquea todo lo demás
| # | Dimensión | Gap crítico |
|---|---|---|
| 5 | Offline-first | OCS suite no FIELD VERIFIED |
| 8 | Instalación | 4 pasos manuales, Branch A/B desconocido |
| 10 | Multi-tenant | 5 bugs en primer segundo tenant |
| 30 | Escalabilidad | Daniel como bottleneck en provisioning |

### P1 — Debe resolverse en los próximos 60 días
| # | Dimensión | Gap crítico |
|---|---|---|
| 2 | KDS | Filtro de estación no FIELD VERIFIED |
| 3 | Impresión | Queue no persiste restart |
| 9 | Soporte remoto | Sin Manager Panel |
| 13 | Recetas/costos | Sin yield factor |
| 17 | P&L | Contribution margin parcial sin declarar |
| 19 | Precisión de agentes | Zero agentes certificados |
| 20 | Confianza/abstención | Zero agentes con abstención |
| 21 | Provenance | Mixing silencioso posible |
| 22 | Alert lifecycle | Sin tracking de impacto |
| 29 | Seguridad | PRR-11, PRR-12 OPEN |

### P2/P3 — Roadmap posterior
- Normalización de datos, forecasting con ML, labor+P&L completo, cross-location learning, acción ejecutable, UX avanzada

---

## FIELD VERIFICATION REGISTER — Correction Pass v2

**Definición de FIELD VERIFIED:** Evidencia física concreta, en ubicación real, con escenario documentado, resultado observado, testigo identificado, y reproducibilidad evaluada. NO aplica si solo existe en código, test automatizado, o uso informal.

**Reclasificaciones aplicadas en v2:**
- Dim 10 Multi-tenant: FIELD VERIFIED → **LAB VERIFIED** (vantara = sandbox, no cliente pagando)

| Dim | Capacidad | Fecha campo | Ubicación | Terminal | Escenario ejecutado | Resultado | Evidencia | Testigo | Reproducible | PASS/FAIL |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | POS flujo completo (orden → cobro → turno) | 2026-07-16 | AMALAY, Monterrey NL | CAJA + BARRA + COCINA | R1 Validation: 12 escenarios incluyendo modificadores, courses, turno | PASS 12/12 | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí — operación diaria | PASS |
| 2 | KDS básico (display + bump) | 2026-07-12 | AMALAY | KDS cocina + barra | Bump de ítem, display de orden entrante | PASS básico | FIELD-NOTES-PREFLIGHT-JUL12.md | Daniel Ramonfaur | Sí — station filter NO validado post-RC2 | PASS (básico) |
| 3 | Impresión multi-estación | 2026-07-12 | AMALAY | 4 impresoras (cocina fría, caliente, barra, caja) | Smoke test: imprimir en todas las estaciones sin error | PASS | FIELD-NOTES-PREFLIGHT-JUL12.md | Daniel Ramonfaur | Sí — retry con impresora caída NO field-tested | PASS |
| 4 | Cobro efectivo + tarjeta externa | 2026-07-16 + diario | AMALAY | CAJA | Cobro con efectivo y Getnet/MP Point manual | PASS | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí — entrada manual de monto (no API dispatch) | PASS |
| 5 | Offline básico (8 órdenes) | 2026-07-27 | AMALAY | SERVER1 + PDV | Desconectar WAN, crear 8 órdenes, reconectar, sync | PASS básico | DEPLOYMENT-STATE.md Visit 3 | Eduardo + Daniel | Parcial — OCS P2.5.9 completo PENDING FIELD | PASS (parcial) |
| 12 | Business date / turno lifecycle | 2026-07-16 + diario | AMALAY | CAJA | Eduardo abre y cierra turno diariamente, corte Z | PASS | Operación observada | Eduardo Esquivel | Sí — edge cases de turno largo no formalmente testados | PASS |
| 13 | Recetas y food cost básico | 2026-07-07 | AMALAY | app.fullsite.mx | R1: Eduardo revisa 63 recetas, verifica food cost ~27.6% | PASS | R1-AMALAY-VALIDATION.md | Eduardo Esquivel | Sí — yield factor NO implementado | PASS |
| 27 | UX operadores (operación independiente) | 2026-07-16 + diario | AMALAY | Tablets POS | Eduardo opera el sistema sin asistencia de Daniel | PASS | Operación observada, feedback positivo ("Ha que fregón") | Eduardo Esquivel | Sí — split por ítem pendiente | PASS |

**Total FIELD VERIFIED post-Correction Pass v2:** 8 dimensiones (Dim 1, 2, 3, 4, 5-parcial, 12, 13, 27).
**Reclasificada en v2:** Dim 10 → LAB VERIFIED.

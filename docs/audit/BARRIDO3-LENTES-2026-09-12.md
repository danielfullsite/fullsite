# Barrido 3, segunda vuelta — las cinco lentes que faltaban

Sobre `origin/main` `f9f8965c`. Se relanzaron las cinco lentes que el límite de
sesión había matado el 11 de septiembre. **31 hallazgos** confirmados con
confianza ≥0.7, cada uno con su cadena verificada en el código:

| Lente | P0 | P1 | P2 | Reporte |
|---|---|---|---|---|
| Permisos y roles | 2 | 2 | 1 | [permisos](barrido3/permisos.md) |
| Integraciones externas | 4 | 5 | 2 | [integraciones](barrido3/integraciones.md) |
| Multi-terminal (3 POS + KDS) | 1 | 2 | 1 | [multiterminal](barrido3/multiterminal.md) |
| Instalador y arranque | 1 | 2 | 4 | [instalador](barrido3/instalador.md) |
| Multi-tenant y clonabilidad | 0 | 2 | 2 | [multitenant](barrido3/multitenant.md) |

## Corregido (PR de esta rama)

| Sev | Hallazgo | Corrección | Prueba A/B |
|---|---|---|---|
| P0 | El hub podía mandar un DELTA **antes** del SNAPSHOT; la secundaria lo leía como «la Caja reinició su historia» y re-aplicaba todo el catch-up: cada comanda proyectada y repintada dos veces | El cliente entra marcado `listo:false` y lo que llega en la ventana se entrega en orden después del SNAPSHOT; además una secuencia menor de la **misma** caja ya no reinicia el cursor | `ningun-delta-antes-del-snapshot.test.js` (WsHub y cliente ws reales; antes llegaba `DELTA, SNAPSHOT`) |
| P0 | `DELETE` sólo estaba gateado en `pos_orders`: un mesero podía **borrar la bitácora antifraude** | Borrar exige gerente salvo lista explícita (hoy vacía): una tabla nueva nace protegida. `pos_audit_log` y `pos_save_operations` sólo admiten INSERT | `proxy-no-borra-la-evidencia.test.ts` (6 de 9 fallan antes) |
| P0 | `pos_turnos` no protegía sus columnas de dinero: un PATCH de mesero cuadraba el arqueo del turno | Candado **por nivel** (cajero sí, mesero no) para turnos, cierres y movimientos de caja. No por gerente: el Corte Z lo hace la caja como cajero y un 403 ahí es terminal en el replay | idem |
| P0 | El instalador **publicado** no llevaba `build-info.json`: sin sello verificable | Añadido a las dos configuraciones de release; prueba que compara las tres listas | `el-instalador-publicado-va-sellado.test.js` |
| P0 | MP Point: una respuesta perdida se resolvía como «cobrado», con el intent vivo en la terminal | Avisa que revise la terminal antes de volver a cobrar y abre el cobro manual, que decide una persona | fuente |
| P0 | Rappi: dos descartes sin escribir en la cola de rezagados y excepciones sólo visibles en dev, después de un `200 accepted` | Los tres caminos van a `integration_webhook_dlq` con su payload; el catch registra en producción | `rappi-nada-se-pierde.test.ts` (3 de 5 fallan antes) |

Verificación del commit: Pedro **642/642**, web **3,781/3,781**, DOM **292/292**,
TypeScript limpio.

## Abierto, por orden de riesgo

**Dinero / evidencia**
1. **La DLQ no la drena nadie** (P0). Tres escritores, cero lectores en todo el
   repositorio: ni ruta de reintento, ni pantalla, ni aviso. Una orden pagada en
   Uber que cae ahí se queda hasta que alguien consulte la tabla a mano. El
   arreglo es una pantalla de soporte, no una línea.
2. **Token de producción de Mercado Pago en el navegador** (P0). Hay que
   asumirlo expuesto y **rotarlo**; el mismo patrón está en Clip.
3. `offline_approved: true` es una afirmación del cliente, y `POS_APPROVAL_STRICT`
   **no lo cierra** (está en el `else if`: la rama offline lo esquiva por orden de
   evaluación). Un mesero reabre una cuenta pagada y cancela un platillo servido.
4. CFDI: carrera de doble timbrado y estado `procesando` del que la interfaz no
   puede salir.
5. `/api/mp-point` acepta `paymentId`/`deviceId` del cuerpo sin comprobar tenant.

**Operación**
6. `kds_item_status` es un mapa completo sin revisión: dos pantallas de cocina se
   pisan las marcas (modo legacy, el que corre AMALAY).
7. La cancelación de Uber no retracta el ticket ya inyectado al KDS de Pedro.
8. Las órdenes de delivery entran al KDS sin `turno_id`.
9. Si Pedro no arranca, una terminal `kds_only` se queda en pantalla de error a
   pantalla completa (tres fallos reales pueden causarlo).
10. El lock de mesa lo vence el reloj del cliente — y hoy **ningún cliente emite
    `MESA_LOCK`**: la exclusión mutua entre POS está construida y desconectada.

**Clonabilidad (no bloquea AMALAY)**
11. Un restaurante nuevo nace con la zona horaria, el inicio de día y el IVA de
    AMALAY, y no hay pantalla para cambiarlos.
12. Comportamiento ramificado por el nombre del tenant en tres lugares.

## Qué NO se buscó

Las integraciones contra sus servidores reales (sandbox de Uber/Rappi/MP), las
vistas `ocm_*` contra la base viva, y cualquier cosa que exija hardware. Este
barrido fue lectura del repositorio más reproducción local.

# Preparación de piloto controlado — Amalay

> Estado: **plan de preparación**. Este documento no autoriza producción,
> migraciones, enrolamiento, despliegues ni cambios de datos.
>
> Referencia de coordinación: [tracker de cierre](CLOSURE-TRACKER-2026-09-27.md).

## Propósito

Definir la evidencia mínima para realizar T-24 y, sólo después, un piloto
limitado en una Caja. Está diseñado para el candidato exacto que complete P19;
un resultado de otra rama, otro perfil o una prueba histórica no se hereda.

No registrar aquí credenciales, PINs, direcciones de red, nombres de personal,
pedidos de clientes ni valores de ventas. Los registros de prueba deben usar
identificadores opacos y hashes de los paquetes de evidencia.

## Regla de avance

```text
laboratorio P19 completo + seguridad contenida
                 +
inventario físico + paquete candidato + rollback practicable
                 ↓
              T-24 en Caja real
                 ↓
      piloto de una Caja, un turno y alcance limitado
```

Un `PASS` de contrato aislado, una recomendación de JEV o una captura de
pantalla no reemplazan ningún bloque del diagrama.

## Gate de entrada a T-24

Todos los puntos deben estar en `PASS` para el mismo identificador de
candidato:

- [ ] P19: guardar genera un recibo durable verificable dentro del límite de
  interacción, sin debilitar autenticación, ACL, fencing, CAS o P17.
- [ ] GUI sintética: `login → turno → borrador → producto → guardar →
  ORDER_SEND → KDS` pasó, incluyendo ACK incierto, replay, competencia, dos
  reinicios y recuperación abrupta.
- [ ] La matriz runtime del auxiliar nativo por operación cubre identidad,
  revocación, ACL, frame destruido, turno cerrado, CAS obsoleto, crash,
  indisponibilidad y reintento no correlacionado.
- [ ] NetLogs del candidato y auditoría del renderer están completos; no se
  atribuye un resultado de cobertura parcial como "cero red externa".
- [ ] Regresión integral, build y paquete candidato terminan correctamente.
- [ ] Revisión independiente de los cambios P19 y de seguridad está resuelta.
- [ ] La ruta de exposición de credenciales legacy está contenida antes de
  cualquier rotación. No introducir secretos en renderer, Service Worker ni
  almacenamiento local.
- [ ] Manifiesto de candidato, hash de evidencia y rollback aplicable están
  disponibles y revisados.

Si un punto es `BLOCKED`, `UNKNOWN`, `OMITTED` o sólo `tested_locally`, T-24
no se programa.

## Preparación física no destructiva

Realizar únicamente después del gate de entrada y sin cambiar la operación:

1. Inventariar la Caja candidata, estación o estaciones de cocina, impresora
   y pantalla: modelo, versión de sistema, resolución, escala, DPR, entrada
   táctil y versión de instalador. Guardar el inventario sin identificadores
   de red ni secretos.
2. Congelar el commit, hash de paquete, manifiesto de evidencia y versión de
   configuración que se probarán. Registrar la persona responsable de la
   prueba y la ventana acordada.
3. Confirmar que existe una reversión conocida para el instalador y que no
   borra journals, recibos, tombstones ni evidencia.
4. Preparar un catálogo y mesas de prueba aislados; no usar pedidos, cobros o
   datos de clientes reales.
5. Preparar una hoja de observación con hora, paso, resultado, hash de
   evidencia y clasificación `PASS`, `FAIL` o `UNKNOWN`.

## Secuencia T-24

Detener la prueba en el primer `FAIL` que afecte integridad de órdenes,
autorización, recibos, pagos, cocina o rollback.

| Fase | Ejercicio | Evidencia mínima para avanzar |
| --- | --- | --- |
| T0 | Arranque controlado y acceso autorizado | versión y hash esperados; UI no expone secretos; actor y turno correctos |
| T1 | Crear, modificar y guardar una orden de prueba | recibo durable correlacionado; revisión correcta; no duplicado |
| T2 | Enviar una orden de prueba a cocina | estado durable y recepción única en KDS; contenido y modificadores preservados |
| T3 | Simular ACK incierto y replay permitido | misma correlación; no segunda orden ni doble publicación |
| T4 | Cortar y restituir conectividad permitida | cola retenida; recuperación explícita; sin reintento de cobro inventado |
| T5 | Cerrar y reabrir la aplicación | borrador/recibos conservados; actor y frame deben revalidarse |
| T6 | Ejercitar reversión | se vuelve al paquete previo sin borrar datos durables ni evidencia |

Registrar también la ergonomía básica: controles táctiles, estados de carga,
error local en Cobro, error global sobre overlays, Modificadores y la cola de
Sincronización. Esto observa el diseño vigente; no habilita `ui_version=v2`.

## Criterio para abrir el piloto limitado

Después de T-24, se puede proponer —no activar automáticamente— un piloto si:

- todos los pasos T0–T6 del mismo candidato pasan;
- quedan documentados los límites conocidos y su responsable;
- existe una ventana de soporte y un criterio de stop-the-line;
- la Caja, turno y alcance del piloto están explícitamente delimitados;
- el plan de reversión ha sido revisado en la configuración que se usará.

La expansión a más Cajas, personal, rutas de pago o interfaz v2 requiere una
evaluación nueva. El rediseño v1.2 continúa detrás de su bandera: primero se
requiere el recorrido completo POS→KDS y después la validación física del
mismo candidato.

## Registro redactado de resultado

Usar un registro por ejecución, sin anexar datos operativos:

```text
candidate_commit: <commit>
package_sha256: <sha256>
evidence_manifest_sha256: <sha256>
test_window: <fecha y hora>
phase: <T0..T6>
result: <PASS|FAIL|UNKNOWN>
evidence_sha256: <sha256>
rollback_tested: <true|false>
notes: <sin datos sensibles>
```

## Relación con JEV

JEV puede contrastar los manifiestos redactados y señalar contradicciones de
evidencia. No opera la Caja, no aprueba un piloto, no modifica datos y no
sustituye la revisión humana ni la prueba física.

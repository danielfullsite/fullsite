# Tracker de cierre — 2026-09-27

## Propósito y reglas

Este tablero ordena el cierre hacia un piloto controlado de AMALAY. Consolida
evidencia reportada por los gates de laboratorio, pero **no convierte un
resultado local, un reporte o una recomendación de JEV en certificación de
campo, autorización de producción, merge, migración o cambio en una Caja**.

La secuencia es deliberada:

```text
P19 GUI y recuperación ─┐
seguridad de piloto ────┼─> T-24 en Caja real ─> piloto limitado AMALAY
preparación operacional ┘
                                 │
                                 └─> rollout y rediseño v1.2 por bandera
```

No mezclar cambios de P19, hardening de seguridad y presentación del rediseño
en el mismo cambio revisable. Cada gate conserva su propio rollback y
evidencia.

## Estado consolidado

| Carril | Estado | Última evidencia conocida | Siguiente condición de salida |
| --- | --- | --- | --- |
| P19 POS/KDS Windows | `HOLD` | La admisión y una acción de producto sintéticas llegaron a un recibo durable. El clic de Guardar llega a main, pero `businessSave` tarda aproximadamente 62 s y excede el límite de 45 s. | Demostrar una raíz de confianza Windows para el auxiliar DPAPI por operación; sólo después integrar y medir el guardado real. |
| Optimización nativa P19 | Revisión de protocolo bloqueada, no integrada | DPAPI real comparó 131/131 entradas; el modelo sintético pasó sus controles. Aun así, un auxiliar comprometido puede autenticar resultados falsos y la propiedad OS no está demostrada. | Gate nativo de confianza: propiedad main-side, autenticación mutua, Job Object, canal por operación y respuesta maliciosa autenticada. Mantener las 74 verificaciones que no son agrupables. |
| Seguridad del piloto | Candidata pendiente de revisión humana | Hardening y planes de rollback existen en ramas candidatas; no equivalen a activación. | Revisión independiente, entrega protegida y acciones de dueño; después rotación de credenciales/PINs conforme al plan aprobado. |
| JEV | Sombra degradada | Corrida viva sólo con 43 fixtures sintéticos: 0 decisiones; el gateway respondió `no_providers_available` y un timeout. Las 14 entradas hostiles fueron rechazadas antes de red. | Corregir capacidad/configuración del gateway en un gate separado. JEV no bloquea P19 ni toma decisiones de release. |
| Rediseño POS v1.2 | Especificación lista; código bloqueado | El artefacto visual fue comparado; existen reglas de no copiar para pagos, reintentos, modificadores, precios y autoridad durable. | E0: GUI sintética real completa hasta Guardar con recibo durable. Para activar v2 además se exige ORDER_SEND → KDS y validación física. |
| Preparación AMALAY | Preparar, no operar | Catálogo, roles, estaciones, impresión, KDS y reversión pueden inventariarse sin activar el candidato. | Perfil físico actual confirmado y checklist T-24 listo para el mismo commit candidato. |

## Ruta crítica: P19

1. **Gate de confianza DPAPI por operación.** La revisión de protocolo confirmó
   que un MAC propio no atesta ejecución honesta. Antes de integrar, Windows
   debe demostrar propiedad main-owned, identidad de proceso y cierre del
   auxiliar al cambiar actor, terminal, turno, frame, revisión, correlación o
   proceso. No se permite caché entre operaciones ni se omite una lectura de
   frontera.
2. **Integración aislada, sólo si la revisión pasa.** Comparar antes/después
   contra el mismo perfil sintético. Mantener autenticación, ACL, fencing,
   CAS, journals y timeout de 45 s.
3. **Gate GUI integral.** `login → turno → borrador → producto → Guardar con
   recibo durable → ORDER_SEND → KDS`, incluyendo ACK incierto, replay,
   competencia, dos reinicios y recuperación abrupta.
4. **Evidencia de red y renderer.** NetLogs completos y auditoría de secretos
   del renderer para el candidato exacto. Los tests externos omitidos no se
   cuentan como PASS.
5. **Regresión y paquete candidato.** Sólo tras los anteriores, antes de
   programar T-24.

## Carril de seguridad, en paralelo

1. Mantener las integraciones legacy y sus credenciales fuera de renderer,
   Service Worker, almacenamiento local y respuestas de terminal.
2. Entregar primero cambios independientes y revisados; no hacer un merge
   masivo de una candidata de seguridad.
3. Rotar credenciales o PINs sólo después de que su ruta de exposición esté
   contenida en el candidato entregado; rotar antes reutilizaría la misma ruta
   insegura.
4. Antes del piloto: terminales enroladas, roles verificables, reversión
   practicada y la configuración de telemetría validada.

## Carril de producto y rediseño, en paralelo

- Conservar el prototipo v1.2 como referencia, no como fuente de lógica.
- Mantener la bandera de interfaz desactivada y separada de main/preload y de
  contratos P17/P19.
- Preparar únicamente mapa de componentes, tokens, fuentes offline,
  accesibilidad y pruebas de las tres resoluciones. No tocar handlers de
  Cobro, Enviar, Cancelar, Deshacer o Modificadores.
- No habilitar `v2` en una Caja hasta que el gate completo POS→KDS y T-24
  hayan aprobado el mismo candidato.

## T-24 y piloto limitado

T-24 sólo se agenda cuando P19, seguridad de piloto y el manifiesto de
versiones estén cerrados para el mismo candidato. Debe ejercitar una Caja
Windows real, estaciones/impresoras, KDS, caída y retorno de red, reinicio,
operación incierta y rollback. El piloto inicia con una Caja, un turno y un
alcance explícitamente limitado; cada expansión requiere evidencia adicional.

El procedimiento redactado, sus condiciones de entrada y el formato de
evidencia están en [Preparación de piloto controlado — Amalay](AMALAY-PILOT-READINESS-2026-09-27.md).

## Definición de avance

| Estado | Significado |
| --- | --- |
| `HOLD` | La interfaz o capacidad permanece deshabilitada; no se infiere autorización. |
| `scoped pass` | Un contrato aislado pasó; sus pruebas no se heredan a un flujo mayor. |
| `laboratory pass` | El recorrido integrado y su matriz de fallos pasaron en el candidato exacto. |
| `field pass` | El mismo candidato aprobó la prueba física documentada. |
| `pilot ready` | P19, seguridad mínima, T-24, rollback y perfil operativo están cerrados para una Caja limitada. |

## Próxima acción por dueño

- **Windows / Codex:** completar la revisión del protocolo DPAPI por operación
  antes de cambiar código de producto.
- **Mac / coordinación:** mantener este tracker, preparar el manifiesto de
  candidato y separar ramas, documentación y artefactos generados.
- **Revisión humana independiente:** evaluar los cambios de seguridad y, más
  adelante, el cambio de protocolo P19 antes de entregar un candidato.
- **Operación AMALAY:** aportar inventario físico y ventana T-24 sólo cuando
  exista un candidato de laboratorio completo.

## Higiene de ramas y evidencia

- El worktree principal del usuario se conserva intacto.
- Cada cambio entra en una rama aislada y pequeña, con pruebas y rollback.
- La evidencia completa queda fuera de commits de producto; sólo manifiestos
  redactados destinados a JEV pueden versionarse.
- JEV observa y recomienda. No aprueba releases, ejecuta operaciones ni
  reemplaza una revisión humana.

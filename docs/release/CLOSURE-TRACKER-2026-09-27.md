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
| P19 POS/KDS Windows | `HOLD` | La admisión y una acción de producto sintéticas llegaron a un recibo durable. El clic de Guardar llega a main, pero `businessSave` tarda aproximadamente 62 s y excede el límite de 45 s. | Evaluar un binding Node-API dentro de Electron `main`, con plazo fail-closed; sólo después integrar y medir el guardado real. |
| Optimización nativa P19 | Broker nativo descartado, no integrado | Un proceso nativo de prueba ejecutó 131 comparaciones DPAPI en 117.7 ms sin broker, pero no fue Electron `main` ni probó cancelación real. | Evaluar un binding DPAPI auditable dentro de Electron `main`. Mantener las 74 verificaciones frescas y no agrupar las 57 candidatas sin equivalencia demostrada. |
| Seguridad del piloto | Candidata pendiente de revisión humana | Hardening y planes de rollback existen en ramas candidatas; no equivalen a activación. | Revisión independiente, entrega protegida y acciones de dueño; después rotación de credenciales/PINs conforme al plan aprobado. |
| JEV | Sombra degradada | Corrida viva sólo con 43 fixtures sintéticos: 0 decisiones; el gateway respondió `no_providers_available` y un timeout. Las 14 entradas hostiles fueron rechazadas antes de red. | Corregir capacidad/configuración del gateway en un gate separado. JEV no bloquea P19 ni toma decisiones de release. |
| Rediseño POS v1.2 | Especificación lista; código bloqueado | El artefacto visual fue comparado; existen reglas de no copiar para pagos, reintentos, modificadores, precios y autoridad durable. | E0: GUI sintética real completa hasta Guardar con recibo durable. Para activar v2 además se exige ORDER_SEND → KDS y validación física. |
| Preparación AMALAY | Preparar, no operar | Catálogo, roles, estaciones, impresión, KDS y reversión pueden inventariarse sin activar el candidato. | Perfil físico actual confirmado y checklist T-24 listo para el mismo commit candidato. |

## Actualización de evidencia — protocolo nativo y contención

- **P19 / broker DPAPI:** el gate de confianza lo descartó como arquitectura de
  producto. Con identidad, Job, SID, sesión, hash y MAC válidos, un helper pudo
  emitir una respuesta falsa; `main` la detectó sólo al repetir DPAPI por su
  cuenta. El fallo de handle de ancestro también quedó conservado. El siguiente
  gate evalúa DPAPI dentro de `main` confiable, no intenta endurecer el broker.
- **Evaluación directa, todavía aislada:** un proceso nativo principal de
  laboratorio completó 131 comparaciones DPAPI en 117.7 ms, sin auxiliar ni
  confianza en MAC compartido. Es una señal de viabilidad de rendimiento, no
  una integración: falta seleccionar y ejecutar un binding compatible con
  Electron `main` y demostrar que una operación que excede el plazo de 45 s
  termina en `UNKNOWN/HOLD`, sin publicación ni aceptación tardía.
- **Alcance de agrupación:** 74 verificaciones permanecen lecturas frescas;
  sólo 57 son candidatas a agruparse y todavía requieren equivalencia de entrada
  demostrada. No se elimina ninguna verificación por una medición sintética.
- **Contención web separada:** los PRs `#442` y `#443` están listos para
  revisión humana con CI verde.
  `#442` limita la respuesta de configuración de terminal a una allowlist y
  prueba el scope de tenant en ambos proxies; `#443` restringe el disparador y
  el camino de merge del workflow Claude. Ninguno implica merge, despliegue ni
  cambio de configuración de producción.

## Ruta crítica: P19

1. **Gate Node-API dentro de Electron `main`.** El broker queda fuera del
   candidato: evaluar un binding auditable con semántica DPAPI exacta y un
   deadline fail-closed. El proceso que conserva la autoridad debe conservar
   autenticación, ACL, fencing, CAS y todas las lecturas de frontera.
2. **Integración aislada, sólo si ese gate pasa.** Comparar antes/después
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

- **Windows / Codex:** evaluar el binding Node-API DPAPI en Electron `main` y
  su deadline fail-closed antes de cambiar código de producto.
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

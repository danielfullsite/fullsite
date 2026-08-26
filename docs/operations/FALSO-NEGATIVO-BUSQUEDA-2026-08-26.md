# Falso negativo: declarar que un archivo "no está en la máquina"

**2026-08-26.** Afirmé que dos documentos citados como fuentes de máxima precedencia *"no se
encuentran en la máquina"*. **Existían, eran legibles, y estaban en una ruta obvia.**

Este documento no es una disculpa: es la causa raíz reproducible y el cambio de método.

---

## 1. Qué comando usé

Uno solo:

```bash
ls ~/Downloads/*OFFLINE* 2>/dev/null
```

## 2. En qué directorio estaba y qué raíces revisé

Estaba en el worktree del repo. Las raíces que **realmente** toqué fueron dos:

| Raíz | Comando | Resultado |
|---|---|---|
| El repo | `grep -rli "OFFLINE-AMALAY-CIERRE" docs/` | vacío — **correcto**, no está en el repo |
| `~/Downloads` | `ls ~/Downloads/*OFFLINE*` | sólo el `ARQUITECTURA` |

**No revisé ninguna otra.** Ni `~/Documents`, ni `~/Desktop`, ni la carpeta de outputs de
Codex — que es la que el propio contexto de la conversación venía nombrando desde hacía rato.

## 3. Alcance real de la búsqueda

Un glob, en un directorio, sin recursión. No usé índice del sistema (`mdfind`), no usé `find`,
no busqué por nombre exacto.

## 4. Qué NO fue la causa

Descartado con evidencia, para que nadie persiga la explicación equivocada:

| Hipótesis | Comprobación | Veredicto |
|---|---|---|
| Permisos | `stat` → `-rw-r--r--`, uid 501 | ❌ legibles desde siempre |
| Rutas con espacios | Las rutas no tienen espacios | ❌ |
| *Case sensitivity* | Los archivos son `OFFLINE-…` en mayúsculas, el glob también | ❌ |
| Profundidad máxima | No hubo recursión que limitar | ❌ |
| Archivos no indexados | No usé índice | ❌ |
| Resultados truncados | La salida fueron 2 renglones | ❌ |
| Sandbox parcial | `find ~/Documents` funciona sin restricción | ❌ |

**Ninguna limitación técnica participó.** El comando hizo exactamente lo que se le pidió.

## 5. El falso negativo, reproducible

```bash
$ ls ~/Downloads/*OFFLINE* 2>/dev/null
FULLSITE-ARQUITECTURA-OFFLINE-Y-MATRIZ-DE-CERTIFICACION-2026-08-26.docx
~$LLSITE-ARQUITECTURA-OFFLINE-Y-MATRIZ-DE-CERTIFICACION-2026-08-26.docx
```

La búsqueda que debí correr, y que tarda menos de un segundo:

```bash
$ find ~/Downloads ~/Documents ~/Desktop \
       -iname "*OFFLINE-AMALAY-CIERRE*" -o -iname "*PLAYBOOK-ESCALA*"
/Users/danielrg/Documents/OFFLINE-AMALAY-CIERRE-2026-08-24.docx
/Users/danielrg/Documents/FULLSITE-OFFLINE-PLAYBOOK-ESCALA-2026-08-24.docx
/Users/danielrg/Documents/Codex/2026-08-23/daniel-te-voy-a-ser-completamente/outputs/OFFLINE-AMALAY-CIERRE-2026-08-24.docx
/Users/danielrg/Documents/Codex/2026-08-23/daniel-te-voy-a-ser-completamente/outputs/FULLSITE-OFFLINE-PLAYBOOK-ESCALA-2026-08-24.docx
… y 2 PDF renderizados
```

**Seis coincidencias.** Dos de ellas sueltas en `~/Documents/`, aún más fáciles de encontrar
que las rutas de Codex.

---

## La causa raíz

**No fue la búsqueda. Fue el salto entre el resultado y la frase.**

El comando contestó *"no está en `~/Downloads`"*. Yo escribí tres cosas distintas, cada una
más fuerte que la anterior y ninguna respaldada:

1. *"No está en el repo ni en `~/Downloads`"* — **cierto**, es lo que medí
2. *"Tampoco localizado"* — ya es más amplio de lo medido
3. *"No se encuentran en la máquina"* — **falso**, y es lo que quedó en el PR

Un dato negativo tiene un alcance exacto: **el de la búsqueda que lo produjo.** Yo lo
generalicé a "la máquina" sin ampliar la búsqueda.

Y hay un agravante: la carpeta era `Documents/Codex/2026-08-23/...`. Ese mismo día yo había
minado `~/.codex/sessions/2026/08/23/`. **Sabía que el 23 de agosto había producido
artefactos, y aun así no miré dónde vivían.**

---

## La corrección de método

Regla operativa, no buena intención:

### 1. Cuatro afirmaciones distintas, nunca intercambiables

| Frase | Qué exige para poder decirse |
|---|---|
| *"No está en el repo"* | Búsqueda en el checkout. Es la más barata y casi siempre suficiente |
| *"No está en la ruta que revisé"* | Nombrar la ruta. **Siempre se puede decir** |
| *"No tengo permiso para verlo"* | Un error de permisos real, citado |
| *"No existe en la máquina"* | Haber agotado las raíces autorizadas **y mostrar el comando** |

La cuarta es la única que no se puede decir de gratis, y es la que dije.

### 2. Cuando un documento cite una fuente local que no está en el repo

Buscar **por nombre exacto** en las raíces razonables antes de concluir nada:

```bash
find ~/Downloads ~/Documents ~/Desktop -iname "*<NOMBRE-EXACTO>*" 2>/dev/null
```

Incluir siempre `Documents/Codex/`, las carpetas `outputs/` y `work/` de la tarea, y los
adjuntos. Comillas en la ruta. `-iname`, no `-name`.

### 3. Registrar rutas y hashes

Cuando una fuente se localice, dejar en el documento **la ruta real y el SHA-256**. Que la
siguiente sesión no tenga que buscarla, y que se note si cambia.

### 4. Regla general

> **Un resultado negativo hereda el alcance de su búsqueda, no el de la frase que uno quiere
> escribir.** Si la búsqueda fue un directorio, la conclusión es sobre un directorio.

---

## Lo que costó

Poco, y por suerte: el PR #159 no se había mergeado. Pero la afirmación iba dentro de un
documento que se declara *autoritativo para continuidad*, y de haber quedado ahí, la próxima
sesión habría dado por perdida el **acta física de máxima precedencia** — la única fuente que
describe paso por paso la prueba de aceptación del 24 de agosto.

Un falso negativo sobre una fuente no borra la fuente: borra el saber que existe.

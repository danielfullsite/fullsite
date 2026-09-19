# Fullsite / AMALAY — Contexto para Claude Code

## Security Rules

- Nunca imprimir el contenido de `.mcp.json`, `.env`, `~/.zshrc` en el chat ni en logs.
- Nunca escribir tokens reales en diffs visibles — redactar como `***REDACTED***`.
- Al editar archivos que contienen secretos, confirmar solo con "actualizado", sin mostrar el contenido completo.
- Estos archivos nunca deben trackearse en git (ya están en `.gitignore`).

## Proyecto

Restaurante AMALAY (Monterrey, MX). Este proyecto conecta Claude Code a los datos operativos del restaurante vía MCP de Supabase en modo read-only.

- **MCP:** `supabase-amalay` (read-only)
- **Proyecto Supabase:** `qjiomlvudfmzuvqvhwpk`
- **URL:** `https://qjiomlvudfmzuvqvhwpk.supabase.co`
- **Token:** variable de entorno `SUPABASE_ACCESS_TOKEN` (en `~/.zshrc`)

## Convenciones de output

- Respuestas en **español**
- Fechas en formato **YYYY-MM-DD**
- Montos en **MXN** con símbolo `$` y dos decimales (ej. `$1,234.56`)
- Formato **markdown** para reportes
- Tablas para rankings y comparativos
- Sin emojis salvo que se pidan explícitamente

## Datos — dónde está la verdad

**La fuente viva son las vistas OCM por-tenant:** `ocm_daily`, `ocm_waiter_rankings`,
`ocm_menu_groups`, `ocm_menu_items`.

`wansoft_daily` y `ops_daily` están **muertas** (sin datos desde jul-2026). No las uses
como fuente aunque el código viejo todavía las consulte (`api/chat`, `api/coach`,
`api/predict` siguen apuntando ahí — es deuda conocida, OCM Fase 3).

Esquema de las tablas legacy: [`docs/knowledge/wansoft/TABLAS-LEGACY.md`](docs/knowledge/wansoft/TABLAS-LEGACY.md).


## Slash commands disponibles

| Comando | Descripción |
|---|---|
| `/morning-briefing [fecha]` | Briefing matutino: calendario, reservaciones, KPI Wansoft y 3 acciones del día (default: hoy) |
| `/reporte-amalay [fecha]` | KPIs del día (default: hoy) |
| `/top-meseros [dias]` | Ranking de meseros (default: 7 días) |
| `/proximas-reservas [dias]` | Próximas reservaciones (default: 14 días) |

## GitHub Actions Workflows

Workflows en `.github/workflows/`. Stack: **GitHub Actions (gratis) + Groq + Supabase REST + Telegram**.

Arquitectura completa, tentáculos, secrets y cómo agregar workflows:
[`docs/ai/WAR-ROOM.md`](docs/ai/WAR-ROOM.md).


## Cómo agregar nuevas routines

1. Crea un archivo `.md` en `.claude/commands/nombre-comando.md`
2. El archivo debe contener las instrucciones en lenguaje natural para Claude
3. Usa `$ARGUMENTS` para recibir parámetros del usuario
4. Referencia el esquema en `docs/knowledge/wansoft/TABLAS-LEGACY.md` y las vistas `ocm_*`
5. Invoca el comando con `/nombre-comando [argumentos opcionales]`

**Ejemplo mínimo:**

```markdown
Consulta la vista ocm_daily vía MCP supabase-amalay y responde: $ARGUMENTS
```

**Patrón recomendado:**

```markdown
Usando el MCP supabase-amalay, ejecuta el siguiente análisis y presenta los resultados en markdown en español:

[descripción de lo que debe hacer]

Argumentos opcionales: $ARGUMENTS
Si no se proporcionan argumentos, usa [valor default].
```

## Notas operativas

- Para datos de negocio usa las vistas `ocm_*` (ver "Datos — dónde está la verdad")
- Los JSONB de meseros usan `nombre` y `total` como keys
- `platillos_top` en la BD actual mezcla platillos, meseros y grupos — filtrar con cuidado
- El MCP es **read-only**: no hacer INSERT, UPDATE ni DELETE

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

> **Ojo con la frescura.** El grafo se construye desde el WORKING TREE, no desde `main`.
> Hoy este checkout está en `feat/pos-ui-kit`, 149 commits atrás de `main`, y el grafo es
> del 2026-08-21 — o sea que NO refleja producción (todo el lote de offline del 22-24 ago
> quedó fuera). Úsalo para orientarte, pero **verifica contra el código antes de afirmar
> nada**, y prefiere `git show origin/main:<ruta>` cuando la pregunta sea sobre producción.
> Corre `graphify update .` después de cambiar código para que al menos empate con el disco.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

# Protocolo permanente de colaboración — Fullsite

> Establecido por Daniel el 2026-08-24. Aplica a todo agente que trabaje en este repo.

## Principio rector

Eres responsable del **resultado técnico verificable**, no únicamente de producir código o
sugerir pasos. Investiga, implementa, verifica, intenta romper tu propia solución y comunica
con honestidad. No declares una capacidad terminada porque compiló, una prueba pasó, o
funcionó una vez.

## 1. Antes de cualquier acción

1. Confirmar directorio actual.
2. Leer `AGENTS.md`, `CLAUDE.md` y la documentación aplicable.
3. Ejecutar `git status --short --branch`, `git branch --show-current`, `git log -1 --oneline`,
   `git fetch origin --prune`, y la diferencia contra `origin/main`.
4. Detectar cambios locales, archivos nuevos y trabajo de otros agentes.
5. No tocar ni sobrescribir cambios que no te pertenezcan.
6. Si el checkout está sucio o divergente, **crear un worktree limpio desde `origin/main`**.
7. Confirmar el contrato del dominio antes de implementar.

Nunca empieces a editar asumiendo que el checkout representa producción o `main`.

## 2. Autonomía de ejecución

Cuando Daniel autorice una implementación: investiga, implementa, agrega pruebas, ejecuta
verificación proporcional al riesgo, commits pequeños, push y PR cuando sea la continuación
normal del trabajo, monitorea CI, y entrega resultado + evidencia + riesgos pendientes.

**No le pidas a Daniel ejecutar comandos que tú puedes ejecutar.**

No amplíes el alcance hacia producción, eliminación de datos, rotación de secretos, merges
o cambios externos irreversibles sin autorización correspondiente.

## 3. Protección absoluta del trabajo existente

Todo cambio existente pertenece a Daniel u otro agente hasta demostrar lo contrario.

**Prohibido:** `git reset --hard`; `git checkout -- archivo`; eliminar cambios ajenos;
sobrescribir archivos completos sin inspeccionarlos; `cat > archivo`; `> archivo`; heredocs
que puedan truncar; reemplazar `MEMORY.md`, `CLAUDE.md`, `AGENTS.md` o configuración completa;
borrar worktrees o ramas sin comprobar propietario y estado.

Para editar archivos existentes: confirmar que existen → leerlos completos (o la sección con
contexto suficiente) → backup recuperable si son persistentes críticos → `apply_patch` →
cambio mínimo → `git diff --check` → revisar el diff antes del commit.

> "Guarda", "recuerda" o "hazlo permanente" significa **integrar de forma aditiva**; nunca
> significa sobrescribir.

## 4. Ante una sobrescritura accidental

1. Detén inmediatamente toda escritura. 2. No "reconstruyas" sobre el archivo afectado.
3. Informa el comando exacto. 4. Identifica ruta, tamaño y timestamps. 5. Busca recuperación
**en read-only**: git, reflog, snapshots, backups, temporales, historial del editor, sesiones
anteriores, otros worktrees. 6. Guarda la reconstrucción como archivo **diferente**
(`MEMORY.recovered.md`, `archivo.restored-candidate`). 7. Compara con diff. 8. Restaura el
original sólo con evidencia y aprobación.

> Una reconstrucción plausible **no** equivale al archivo original.

## 5. Investigación y causa raíz

No cambies código antes de entender: síntoma, condiciones de reproducción, ruta exacta, capa
responsable, contrato esperado, cambio que lo introdujo, y alcance del patrón.

Herramientas: `rg`, historial git, `git blame`, pruebas existentes, logs, documentación
vigente, contratos oficiales, implementación consumidora, comportamiento físico.

Distingue explícitamente: (1) regresión real, (2) prueba obsoleta, (3) contrato cambiado,
(4) problema de configuración, (5) diferencia de entorno, (6) información que sólo se
comprueba en campo.

> No pongas CI verde cambiando expectativas a ciegas. Primero demuestra cuál contrato es correcto.

## 6. Barrido obligatorio de patrones

Al encontrar una causa raíz: corrige el caso reportado → busca el mismo patrón en todo el
repo con `rg` → clasifica cada coincidencia → corrige todos los equivalentes dentro del
alcance → agrega prueba de regresión → **documenta qué coincidencias no se cambiaron y por qué**.

> Encontrar la causa raíz y corregir una sola instancia **no cierra** el problema.

## 7. Separación del trabajo

Un P0 por rama y PR. No mezclar refactors, diseño, documentación y corrección crítica. No
modificar componentes centrales si basta extender su contrato. Evitar cambios cosméticos en
un fix. Commits pequeños, explicables y revertibles. Indicar dependencias entre PR. Antes de
abrir una rama, comprobar si otro agente ya trabaja en el mismo archivo.

## 8. Verificación obligatoria

Según el riesgo: reproducción del fallo → prueba exacta de regresión → suite del módulo →
suite completa → TypeScript → ESLint contra baseline → build de producción → verificación
visual/navegador → CI del PR → **validación física** si involucra POS, KDS, impresoras,
huellas, LAN, Service Worker, offline, caja o hardware.

Registrar números concretos: archivos aprobados, pruebas aprobadas, fallas restantes, commit,
PR, workflow, versión del instalador.

> "No arrojó error" **no** constituye evidencia suficiente.

## 9. Revisión adversarial

Antes de declarar terminado: intenta refutar la solución; prueba fuera del camino feliz;
busca concurrencia, duplicados, reinicios y estados parciales; errores de red y respuestas
HTTP no exitosas; datos vacíos, inválidos, viejos y duplicados; límites de autorización y
tenant; actualización y rollback; y el patrón corregido en otros archivos.

Para cambios críticos, **una segunda persona o agente debe intentar romperlos de forma
independiente**.

## 10. Estándar de cierre

Una capacidad sólo puede declararse **cerrada** cuando cumple las ocho:

1. Rama limpia y alineada con `main`. 2. Suite completa verde. 3. Matriz funcional aprobada.
4. Validación física sobre el mismo commit, versión e instalador. 5. Revisión adversarial
independiente. 6. CI obligatoria verde. 7. Procedimiento de rollback comprobado.
8. Documentación actualizada.

Vocabulario preciso — **implementado** (existe código) · **probado localmente** (pruebas
locales verdes) · **desplegado** (está en el entorno indicado) · **validado en campo** (se
ejecutó físicamente) · **certificado** (matriz completa y evidencia) · **cerrado** (cumple
todo lo anterior).

> "Funcionó una vez" demuestra viabilidad; no confiabilidad.

## 11. Offline

Offline es un **sistema distribuido**, no una función. Evaluar de punta a punta:
navegador/Electron, Service Worker, caché, Next.js/RSC, sesión, PIN/huella, IndexedDB,
servidor local, event store, KDS, impresión, cola de sincronización, conflictos, reconexión,
actualización y rollback.

Probar como mínimo: arranque en frío sin WAN; LAN sin internet; producto con modificadores
obligatorios; mesa nueva y existente; enviar, imprimir y cobrar; caja y corte; reiniciar POS,
KDS y servidor; WAN intermitente; `503` resuelto por Service Worker; `401/403` de
autenticación; `403` de negocio; conflicto de revisión; deduplicación; recuperación tras
reconectar; actualización durante interrupción.

> Nunca equiparar `navigator.onLine` con conectividad real.

## 12. Multi-tenant y escala

Todo acceso a datos de negocio debe resolver `client_id` desde el contrato autorizado,
filtrar explícitamente por tenant, impedir fallback a otro restaurante, fallar cerrado
cuando no haya mapping, probarse con dos tenants distintos, y verificar que lecturas y
escrituras no crucen datos.

> Prohibido hardcodear `amalay` como solución general. Una solución para AMALAY debe poder
> configurarse para otro restaurante **sin modificar código**.

## 13. Seguridad y secretos

Nunca imprimir `.env`, `.mcp.json`, tokens ni service keys; no copiarlos a documentos,
commits, logs o chats; no descargar secretos vivos si existe alternativa read-only; no usar
credenciales de producción para pruebas; **no modificar Supabase AMALAY directamente para
diagnosticar**.

Si un secreto aparece en salida visible, **considéralo expuesto y recomienda rotación**.

En logs y evidencias: sanitizar tokens, eliminar datos personales, conservar sólo
identificadores DEV necesarios, no exponer PIN, no registrar payloads completos sensibles.

## 14. Acciones destructivas

Antes de borrar, mover, sobrescribir o migrar: resolver el objetivo exacto con comprobaciones
read-only → confirmar que está dentro del alcance → respaldo u operación recuperable → evitar
globs, variables ambiguas y rutas amplias → mostrar qué será afectado → verificar después.

Nunca comandos destructivos sobre `$HOME`, `~`, `/`, la raíz del workspace, el repositorio
completo, o directorios desconocidos.

## 15. Comunicación

Español claro, directo y humano. Empezar por el hallazgo o resultado. Actualizaciones breves
con evidencia concreta. Explicar cuando exista riesgo. No dejar más de ~1 minuto sin
actualización en operaciones largas. No repetir explicaciones. **No defenderse comparándose
con otros modelos.**

Separar siempre: **Confirmado · Inferido · Pendiente · Bloqueado externamente**.

No usar "100%", "cerrado", "certificado", "ya quedó" ni "seguro funciona" sin evidencia que
corresponda.

Formato de entrega: 1) Resultado · 2) Cambios realizados · 3) Verificación · 4) Riesgos o
pendientes · 5) Siguiente paso exacto.

## 16. Honestidad técnica

Si cometes un error: dilo inmediatamente; identifica el comando o decisión exacta; detén
acciones que puedan empeorarlo; presenta recuperación basada en evidencia; no improvises una
reconstrucción; **no atribuyas el error a permisos o contexto si fue una decisión propia**.

Si falta verdad de campo, dilo explícitamente. No reemplaces una prueba física con razonamiento.

## 17. Manejo del contexto

`docs/` es fuente de verdad **sólo si está vigente** — verificar fechas, commits y
referencias; marcar o eliminar lo obsoleto. No cargar archivos enormes completos si basta una
búsqueda dirigida: usar `rg` y lecturas por secciones, y resumir con rutas y líneas.

> No tratar memorias ni documentación vieja como verdad superior al código y las pruebas actuales.

### La regla de la cita

La regla de arriba dice *no confíes*, pero no dice **cuándo dejaste de confiar** — y por eso
se incumple sin querer. Ésta es su versión operativa:

> **Antes de afirmar un número o un hecho que mueva una decisión, di de dónde salió.
> Si no puedes citar `archivo:línea`, una tabla, o el comando que corriste — no es un
> hecho, es un recuerdo. Dilo como recuerdo o ve a verificarlo.**

Se aplica igual a memorias, a `docs/`, a resúmenes de conversaciones anteriores y a lo que
uno "ya sabe" del proyecto. Un resumen de sesión es la fuente **menos** confiable de todas:
no tiene fecha visible, nadie lo revisó, y se lee igual que un hecho.

Casos reales del 2026-08-26, los tres corregidos frente a Daniel el mismo día:

| Se afirmó | La verdad al ir a ver |
|---|---|
| "17 pasos manuales de aprovisionamiento" | `provisionTenant()` existe, 303 líneas, siembra 9 tablas |
| "Las reservaciones se guardan todas como AMALAY" | `reservar/page.tsx:295` bloquea la página para otros tenants |
| "`fetchPosMesas` no funciona nunca" | `supabase-fetch-patch.ts` la intercepta y le pone credencial |

Los tres tienen la misma forma: **conclusión sobre un fragmento, sin abrir la fuente
completa.** Ninguno habría sobrevivido a citar el archivo.

**Al escribir una memoria**, ponerle la fecha en que se verificó. Una nota sin fecha se lee
como un hecho permanente. Medido ese día: 22 de 148 memorias traían marca de verificación.

### La regla del descubrimiento

> Establecida el 2026-08-26, después de declarar que dos documentos "no se encuentran en la
> máquina" cuando existían, eran legibles y estaban en `~/Documents`.

La regla de la cita dice que un hecho necesita fuente. Ésta dice lo simétrico:

> **Un resultado negativo hereda el alcance de la búsqueda que lo produjo, no el de la frase
> que uno quiere escribir.** Si se buscó en un directorio, la conclusión es sobre ese
> directorio.

**El alcance de búsqueda no está limitado al repositorio.** Buscar en toda la carpeta del
usuario cuando haga falta: `~/Documents`, `~/Downloads`, `~/Desktop`, `~/Library`,
`~/Documents/Codex`, worktrees, y los `outputs/` y `work/` de sesiones de otras herramientas.

**Antes de decir que un archivo no existe**, agotar en este orden y registrar qué se corrió:

1. Repositorio y sus worktrees · 2. Outputs y adjuntos de sesiones · 3. `~/Downloads` ·
4. `~/Documents` · 5. `~/Documents/Codex` · 6. `~/Desktop` · 7. Búsqueda global en `~` ·
8. Coincidencias parciales, insensibles a mayúsculas y variantes del nombre.

Hay un procedimiento probado que hace los ocho pasos:
[`scripts/buscar-evidencia.sh`](scripts/buscar-evidencia.sh).

**Estados permitidos.** No existen otros, y no son intercambiables:

| Estado | Qué exige para decirse |
|---|---|
| `ENCONTRADO Y LEGIBLE` | Ruta, `stat`, `file` y SHA-256 |
| `ENCONTRADO PERO NO LEGIBLE` | Ruta + el error exacto al abrirlo |
| `ACCESO BLOQUEADO` | La regla o permiso concreto que lo bloquea, **reproducido** |
| `NO BUSCADO FUERA DEL REPO` | Honesto y barato: casi siempre es el correcto |
| `NO LOCALIZADO DESPUÉS DE BÚSQUEDA GLOBAL` | Los ocho pasos, con el comando a la vista |
| `AUSENCIA CONFIRMADA` | Lo anterior más una razón positiva para creer que no existe |

*"No apareció en mi primera búsqueda"* **jamás** equivale a *"no existe"*.

**Nunca afirmar que hay una restricción sin reproducirla.** Medido el 2026-08-26: las 23
reglas `deny` del proyecto son de seguridad (`rm -rf`, `sudo`, `curl`, llaves, secretos) y
**ninguna** limita la lectura de la carpeta del usuario. Las cuatro raíces son legibles.

**Al localizar una fuente, registrar en el documento su ruta real y su SHA-256.** Si hay
copias con el mismo hash, elegir una canónica y marcar las demás como copias — no como
evidencia independiente.

## 18. Trabajo con otros agentes

Antes de comenzar: revisar ramas y worktrees, identificar archivos que otros agentes
modifican, escoger un bloque independiente, comunicar el alcance. **No pisar, revertir ni
"limpiar" trabajo ajeno.**

Para integrar dos trabajos: esperar a que ambos estén verificados → rebasar o fusionar en una
rama de integración → suite completa → resolver conflictos **por contrato**, no eligiendo
automáticamente una versión.

## 19. Definition of Done de cada PR

Debe incluir: problema · causa raíz · alcance del patrón · solución · pruebas agregadas ·
comandos ejecutados · resultado numérico · riesgos pendientes · rollback · relación con otros PR.

**No hacer merge con checks rojos.**

## 20. Prioridad actual

1. P0 activos · 2. CI completa verde · 3. Reconciliación de ramas · 4. Offline 23/23 ·
5. Rappi DEV real · 6. Uber sandbox · 7. Instalador clonable · 8. Migración Wansoft ·
9. Observabilidad y soporte para 1–1,000 restaurantes · 10. Nuevas funciones e IA.

> No abrir iniciativas nuevas mientras el núcleo crítico permanezca sin certificar.

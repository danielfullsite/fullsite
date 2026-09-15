// ATAJO — G01 de punta a punta.
//
// Todo lo que este archivo hacía vive ahora en `cert/certificar-g01.mjs`, que
// además produce el sobre (`run.json`), el `REPORT.md` y la clasificación. Se
// conserva el nombre porque ya está citado en notas y bitácoras.
//
// ── EL DEFECTO QUE TENÍA ────────────────────────────────────────────────────
// La versión anterior escribía a una ruta ABSOLUTA del scratchpad de OTRA
// sesión (`.../5da718bd-…/validacion-amalay/g01`). Es el mismo defecto de clase
// que el commit 7b94d00d arregló en el conductor —una ruta que sólo existe en
// un disco concreto— y que aquí había quedado sin arreglar. Los artefactos se
// escribían en un directorio ajeno, o en ninguno.
//
// Ahora la salida se decide en un solo lugar y por defecto es relativa al
// paquete: `e2e/paridad/artifacts/<run_id>/`. Se cambia con `CERT_OUT`.
//
//   node correr-g01.mjs          ·  equivalente a: npm run certify:g01

await import('./cert/certificar-g01.mjs')

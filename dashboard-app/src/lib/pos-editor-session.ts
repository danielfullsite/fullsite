/** A departing editor must not let an in-flight read or a final React effect
 * recreate the account cache that its confirmed move/void just removed. */
export function crearSesionEditorCaja() {
  let generation = 0
  let active = false
  return {
    iniciar() { active = true; return ++generation },
    salir() { active = false; generation++ },
    vigente(version: number) { return active && version === generation },
    puedePersistir() { return active },
  }
}

// Contrato multi-tenant — adopta el default_theme del cliente al cargar su config.
// Reglas:
// - La elección del usuario (localStorage 'theme', escrita por ThemeToggle) SIEMPRE gana.
// - Si no hay elección previa, adopta el default del tenant y lo persiste, para que:
//     (a) el script inline de <head> lo aplique sin flash en la próxima carga, y
//     (b) ThemeToggle.useTheme lo lea consistente (evita la carrera con su efecto de montaje).
// Solo VISUAL (setea data-theme en <html>), cero lógica de negocio.
// Emparejado con applyAccent(): juntos hacen que marca (acento) + tema por tenant funcionen en runtime.
export function applyTenantDefaultTheme(theme: string | null | undefined): void {
  if (typeof window === 'undefined') return
  const t = theme === 'light' || theme === 'dark' ? theme : null
  if (!t) return
  try {
    if (localStorage.getItem('theme') != null) return // el usuario ya eligió → respetar
    localStorage.setItem('theme', t)
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  } catch {
    /* SSR / storage bloqueado — no-op */
  }
}

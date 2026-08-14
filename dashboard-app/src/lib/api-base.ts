// Cuando la app corre como bundle nativo empaquetado (Capacitor offline),
// las rutas /api/* no existen localmente — viven en el deploy de Vercel.
// apiUrl() las redirige al servidor; en web (mismo origen) no cambia nada.

const REMOTE_API_BASE = 'https://app.fullsite.mx'

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

export function apiUrl(path: string): string {
  if (typeof window !== 'undefined') {
    // Las rutas /api/* no viven en el bundle offline. Se ruteran a la nube cuando:
    //  - Capacitor nativo (iOS), o
    //  - Electron Offline Shell: la UI se sirve desde el bridge local (puerto 7717).
    // Offline (sin nube) la llamada falla y el fallback local de cada flujo aplica
    // (p.ej. login por PIN cae a pos_staff_cache; ver pos/layout.tsx).
    const onLocalBridge = window.location.port === '7717'
    if (window.Capacitor?.isNativePlatform?.() || onLocalBridge) {
      return `${REMOTE_API_BASE}${path}`
    }
  }
  return path
}

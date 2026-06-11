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
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
    return `${REMOTE_API_BASE}${path}`
  }
  return path
}

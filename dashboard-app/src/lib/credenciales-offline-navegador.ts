/**
 * B-2 (bloque POS, 2026-09-24): el navegador ya no guarda verificadores de PIN.
 *
 * Estos almacenes vivían en localStorage y permitían entrar o aprobar sin red:
 *   · `pos_staff_cache`            SHA-256(pin:staffId), 8 h, una persona
 *   · `pos_manager_credentials_v2` PBKDF2(pin, sal, 10k) — con la sal en el MISMO localStorage
 *   · `pos_pin_device_salt`        esa sal
 *   · `pos_manager_pin_cache`      SHA-256('fs-pin-v2:'+pin) como índice — el índice ES el hash
 *
 * Con una copia del perfil del navegador, los 10^4 PINs de cuatro dígitos se revientan en
 * segundos, fuera de la aplicación. Un navegador no tiene protección del sistema operativo
 * para guardarlos, así que no se guardan: el modo sin conexión vive en la Caja (Electron),
 * sellado con safeStorage (electron-app/local-server/core/actor-authority.js).
 *
 * Esta función BORRA lo que haya quedado de versiones anteriores. Se llama al cargar
 * pos-data en el navegador. No toca `pos_manager_offline_log` (bitácora, sin secretos) ni
 * la sesión (`pos_shift_token`).
 */
export const ALMACENES_RETIRADOS = [
  'pos_staff_cache',
  'pos_manager_credentials_v2',
  'pos_pin_device_salt',
  'pos_manager_pin_cache',
] as const

export function purgarCredencialesOfflineDelNavegador(storage: Pick<Storage, 'removeItem'> | undefined =
  typeof localStorage !== 'undefined' ? localStorage : undefined): number {
  if (!storage) return 0
  let n = 0
  for (const k of ALMACENES_RETIRADOS) {
    try { storage.removeItem(k); n++ } catch { /* ignore */ }
  }
  return n
}

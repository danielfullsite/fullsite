import { describe, expect, it } from 'vitest'

/**
 * T-24 · candado de cableado del login offline.
 *
 * El bug no era que faltara código. `pos-manager-auth.ts` estaba completo y probado —
 * PBKDF2, salt por dispositivo, multi-credencial, revocación, bitácora — y **no lo
 * importaba nadie**. El login usaba un caché simple inline que guarda a UNA sola persona.
 *
 * Un módulo perfecto y desconectado se ve, en producción, exactamente igual que un módulo
 * que no existe. Estas guardas verifican que siga conectado.
 *
 * Convención de lectura de fuente ya usada por offline-sw.test.ts, network-timeout.test.ts
 * y pos-db-policy.test.ts.
 */

const leer = async (rel: string) => {
  const fs = await import('fs')
  const path = await import('path')
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf-8')
}

const LAYOUT = '../app/pos/layout.tsx'

describe('T-24 · el login usa el almacén multi-credencial', () => {
  it('layout.tsx importa pos-manager-auth — el módulo dejó de estar huérfano', async () => {
    const src = await leer(LAYOUT)
    expect(src, 'sin este import volvemos a una sola credencial por terminal')
      .toContain("from '@/lib/pos-manager-auth'")
  })

  it('cada login ONLINE provisiona la credencial para uso offline', async () => {
    const src = await leer(LAYOUT)
    expect(src, 'si no se provisiona, el almacén queda vacío y el fallback nunca sirve')
      .toContain('provisionManagerCredential(')
  })

  it('el camino OFFLINE consulta el almacén', async () => {
    const src = await leer(LAYOUT)
    expect(src).toContain('verifyPinOffline(')
  })

  it('provisionar va DESPUÉS de que el servidor confirmó el PIN, nunca antes', async () => {
    const src = await leer(LAYOUT)
    const okServidor = src.indexOf('if (res.ok)')
    const provision = src.indexOf('provisionManagerCredential(')
    expect(okServidor).toBeGreaterThan(-1)
    expect(provision, 'provisionar sin verificación del servidor cachearía un PIN inválido')
      .toBeGreaterThan(okServidor)
  })

  it('un PIN que no es del cacheado ya no falla de inmediato: cae al almacén', async () => {
    const src = await leer(LAYOUT)
    // Antes: si el hash no coincidía con la ÚNICA persona cacheada, se contaba intento
    // fallido y se retornaba — otro empleado nunca llegaba a la verificación multi.
    expect(src).toContain('coincideCacheSimple')
    const salto = src.indexOf('pin-no-es-de-la-persona-cacheada')
    const verify = src.indexOf('verifyPinOffline(')
    expect(salto, 'debe existir el salto al almacén').toBeGreaterThan(-1)
    expect(verify, 'y el almacén debe consultarse después del salto').toBeGreaterThan(salto)
  })

  it('provisionar no puede tumbar el login: va con catch', async () => {
    const src = await leer(LAYOUT)
    const i = src.indexOf('provisionManagerCredential(')
    const tramo = src.slice(i, i + 200)
    expect(tramo, 'el camino validado en campo no puede romperse por un fallo al cachear')
      .toMatch(/\.catch\(/)
  })
})

describe('T-24 · el TTL cubre un ciclo cierre-apertura', () => {
  const AUTH = '../lib/pos-manager-auth.ts'

  it('el default ya no es 8 h — no cubría abrir el restaurante sin internet', async () => {
    const src = await leer(AUTH)
    expect(src).not.toContain('const CREDENTIAL_TTL_MS = 8 * 60 * 60 * 1000')
    expect(src).toContain('DEFAULT_TTL_HOURS')
  })

  it('el default cubre 12 h con margen', async () => {
    const src = await leer(AUTH)
    const m = src.match(/const DEFAULT_TTL_HOURS = (\d+)/)
    expect(m, 'no se encontró el default').not.toBeNull()
    expect(Number(m![1]),
      'un cierre a la 1am y apertura a la 1pm son 12 h').toBeGreaterThanOrEqual(13)
  })

  it('es configurable sin tocar código', async () => {
    const src = await leer(AUTH)
    expect(src).toContain('NEXT_PUBLIC_POS_OFFLINE_CREDENTIAL_TTL_HOURS')
  })

  it('el compromiso de seguridad queda escrito, no escondido', async () => {
    const src = await leer(AUTH)
    expect(src, 'alargar el TTL alarga la ventana de una baja: debe estar documentado')
      .toMatch(/compromiso|revocaci[oó]n/i)
  })
})

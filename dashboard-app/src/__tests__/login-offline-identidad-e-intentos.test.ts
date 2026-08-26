// Regresión — dos defectos que entraron con #133 (mergeado el 2026-08-26 17:27).
//
// #133 arregló lo grande: el login offline dejaba entrar a UNA sola persona y el caché
// vencía antes de abrir. Pero al conectar el almacén multi-credencial dejó dos huecos,
// los dos en el camino que ese mismo PR venía a habilitar.
//
// ── Defecto 1: la identidad se perdía ────────────────────────────────────────
//
//   verifyPinOffline() devolvía { name, role } sin staff_id, aunque la credencial que
//   acababa de coincidir sí lo tiene (se usa tres renglones arriba para la bitácora).
//   layout.tsx lo reconstruía por nombre contra `pos_staff_cache`:
//
//     return e && !Array.isArray(e) && e.name === offline.name ? e.id : ''
//
//   Ese caché guarda a UNA sola persona. Para el SEGUNDO empleado que entra offline el
//   nombre no empata y el id queda en `''` — y ese id vacío viaja a la sesión y a
//   pos_attendance. O sea: el caso que #133 vino a habilitar quedaba habilitado con la
//   identidad rota.
//
// ── Defecto 2: se perdió el límite de intentos ───────────────────────────────
//
//   La rama offline terminaba en `setNetworkError(true); return`, y el contador de
//   intentos vive DESPUÉS de ese bloque. Comparado contra cd3bdb1e^, el código anterior
//   sí hacía `const na = attempts + 1` en el camino de PIN incorrecto sin red. Es
//   regresión, no deuda previa.
//
//   Resultado: sin red no había límite de PINs ni bloqueo, y el operador veía "sin
//   conexión" en vez de "PIN incorrecto". Es donde menos conviene — nadie está viendo,
//   y el PIN es de 4 dígitos.
//
// ── Por qué son TRES casos y no dos ──────────────────────────────────────────
//
//   Contar el intento siempre que haya credenciales tiene una trampa: un restaurante que
//   abre pasadas las 16 h del TTL tiene credenciales guardadas y ninguna válida. El
//   gerente teclea su PIN CORRECTO, no entra, y a los 5 intentos bloquea la terminal
//   — justo el día que abre sin internet, que es T-24 completo.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const almacen = new Map<string, string>()

// WebCrypto viene en Node 20+, pero el módulo necesita TextEncoder — mismo montaje que
// pos-manager-auth.test.ts. Sin esto, hashPin falla callado y verifyPinOffline da null.
vi.stubGlobal('TextEncoder', TextEncoder)

beforeEach(() => {
  vi.resetModules()
  almacen.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => { almacen.set(k, v) },
    removeItem: (k: string) => { almacen.delete(k) },
  })
})

const HORA = 60 * 60 * 1000

/** Escribe credenciales directamente, con control del reloj de `synced_at`. */
function sembrarCredenciales(
  creds: Array<{ staff_id: string; name: string; role?: string; pin_hash: string; horasDeAntiguedad?: number; disabled?: boolean }>,
) {
  almacen.set('pos_manager_credentials_v2', JSON.stringify(
    creds.map(c => ({
      staff_id: c.staff_id,
      name: c.name,
      role: c.role ?? 'mesero',
      pin_hash: c.pin_hash,
      synced_at: Date.now() - (c.horasDeAntiguedad ?? 0) * HORA,
      disabled: c.disabled ?? false,
    })),
  ))
}

async function mod() {
  return await import('@/lib/pos-manager-auth')
}

describe('defecto 1 — la identidad de quien entra offline', () => {
  it('EL BUG: verifyPinOffline devuelve el staff_id de la credencial que coincidió', async () => {
    const { provisionManagerCredential, verifyPinOffline } = await mod()
    await provisionManagerCredential('4321', 'staff-B', 'Berenice', 'mesero')

    const r = await verifyPinOffline('4321')

    expect(r).not.toBeNull()
    expect(r!.staff_id).toBe('staff-B')
    expect(r!.name).toBe('Berenice')
  })

  it('el SEGUNDO empleado conserva su identidad, no la del cacheado', async () => {
    const { provisionManagerCredential, verifyPinOffline } = await mod()
    await provisionManagerCredential('1111', 'staff-A', 'Ana', 'gerente')
    await provisionManagerCredential('2222', 'staff-B', 'Berenice', 'mesero')

    // `pos_staff_cache` guarda a UNA sola persona: la última que entró CON red.
    almacen.set('pos_staff_cache', JSON.stringify({ id: 'staff-A', name: 'Ana', role: 'gerente', exp: Date.now() + HORA }))

    const r = await verifyPinOffline('2222')

    expect(r!.staff_id).toBe('staff-B')   // antes: '' — no empataba por nombre
    expect(r!.staff_id).not.toBe('staff-A')
  })

  it('cada credencial trae su propio id, no se cruzan', async () => {
    const { provisionManagerCredential, verifyPinOffline } = await mod()
    await provisionManagerCredential('1111', 'staff-A', 'Ana', 'gerente')
    await provisionManagerCredential('2222', 'staff-B', 'Berenice', 'mesero')

    expect((await verifyPinOffline('1111'))!.staff_id).toBe('staff-A')
    expect((await verifyPinOffline('2222'))!.staff_id).toBe('staff-B')
  })
})

describe('defecto 2 — los tres estados del almacén offline', () => {
  it('sin credenciales → sin-credenciales (no hay con qué juzgar)', async () => {
    const { estadoCredencialesOffline } = await mod()

    expect(estadoCredencialesOffline()).toBe('sin-credenciales')
  })

  it('con una credencial fresca → utilizable', async () => {
    const { provisionManagerCredential, estadoCredencialesOffline } = await mod()
    await provisionManagerCredential('1111', 'staff-A', 'Ana', 'gerente')

    expect(estadoCredencialesOffline()).toBe('utilizable')
  })

  it('EL CASO QUE MUERDE: todas vencidas → todas-vencidas, NO "pin incorrecto"', async () => {
    // El restaurante cerró a la 1am y abre a las 6pm: 17 h, y el TTL son 16.
    sembrarCredenciales([{ staff_id: 'staff-A', name: 'Ana', pin_hash: 'x', horasDeAntiguedad: 17 }])
    const { estadoCredencialesOffline } = await mod()

    expect(estadoCredencialesOffline()).toBe('todas-vencidas')
  })

  it('justo dentro del TTL sigue siendo utilizable', async () => {
    sembrarCredenciales([{ staff_id: 'staff-A', name: 'Ana', pin_hash: 'x', horasDeAntiguedad: 15 }])
    const { estadoCredencialesOffline } = await mod()

    expect(estadoCredencialesOffline()).toBe('utilizable')
  })

  it('una revocada no cuenta como utilizable', async () => {
    sembrarCredenciales([{ staff_id: 'staff-A', name: 'Ana', pin_hash: 'x', disabled: true }])
    const { estadoCredencialesOffline } = await mod()

    expect(estadoCredencialesOffline()).toBe('todas-vencidas')
  })

  it('basta UNA utilizable entre varias vencidas', async () => {
    sembrarCredenciales([
      { staff_id: 'staff-A', name: 'Ana', pin_hash: 'x', horasDeAntiguedad: 20 },
      { staff_id: 'staff-B', name: 'Berenice', pin_hash: 'y', horasDeAntiguedad: 1 },
    ])
    const { estadoCredencialesOffline } = await mod()

    expect(estadoCredencialesOffline()).toBe('utilizable')
  })
})

describe('cableado en el login — que la decisión llegue a la pantalla', () => {
  const leer = async () => {
    const fs = await import('fs')
    const path = await import('path')
    return fs.readFileSync(path.resolve(__dirname, '../app/pos/layout.tsx'), 'utf-8')
  }

  it('el id sale de la credencial, no se reconstruye por nombre', async () => {
    const src = await leer()

    expect(src).toContain('id: offline.staff_id')
    expect(src, 'la reconstrucción por nombre era el defecto').not.toContain('e.name === offline.name')
  })

  it('el camino de falla offline consulta el estado antes de decidir', async () => {
    const src = await leer()

    expect(src).toContain('estadoCredencialesOffline()')
  })

  it('EL BUG: sólo se sale temprano cuando NO se puede juzgar el PIN', async () => {
    const src = await leer()
    // Con `utilizable` NO debe haber return: tiene que caer al contador de intentos.
    expect(src).toContain("if (estado !== 'utilizable')")
  })

  it('la sesión vencida tiene mensaje propio, distinto de "sin conexión"', async () => {
    const src = await leer()

    expect(src).toContain('setSesionVencida')
    expect(src).toMatch(/La sesión guardada en esta terminal venció/)
  })
})

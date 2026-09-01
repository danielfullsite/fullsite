// Huella para entrar al corte y para aprobar el cierre de caja.
//
// Pedido por Daniel el 2026-08-31: "para ingresar pin en corte de caja tmb deberia
// de ser con huella" / "Tambien para cierre de caja".
//
// En el cierre, la etiqueta YA decia "Huella o PIN de gerente para aprobar" desde
// antes — pero no habia boton. La interfaz prometia algo que no existia.
//
// LA REGLA QUE SE FIJA: la huella entra por el MISMO embudo que el PIN. Pide
// `min_role` al servidor (que hasta hoy la rama de huella ignoraba, ver
// huella-escalada-de-rol.test.ts) y el cierre sigue exigiendo
// `hasPermission(role, 'corte_z')`. La huella no salta ningun permiso: solo cambia
// como se identifica la persona.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const corte = sinComentarios(readFileSync(join(process.cwd(), 'src/app/pos/corte/page.tsx'), 'utf8'))
const cierre = sinComentarios(readFileSync(join(process.cwd(), 'src/components/pos/CierreCajaWizard.tsx'), 'utf8'))
const posData = sinComentarios(readFileSync(join(process.cwd(), 'src/lib/pos-data.ts'), 'utf8'))

describe('La huella pide el rol al servidor, no se lo concede sola', () => {
  it('verifyManagerHuella manda min_role y fingerprint_id a /api/pos/pin', () => {
    const fn = posData.slice(posData.indexOf('export async function verifyManagerHuella'))
    const cuerpo = fn.slice(0, fn.indexOf('\n}\n'))
    expect(cuerpo).toContain('min_role')
    expect(cuerpo).toContain('fingerprint_id')
    expect(cuerpo, 'debe pegarle al endpoint que valida rol').toContain('/api/pos/pin')
  })

  it('exige userVerification — la huella no puede saltarse con solo tener el aparato', () => {
    const fn = posData.slice(posData.indexOf('export async function verifyManagerHuella'))
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toContain("userVerification: 'required'")
  })

  it('nunca lanza: devuelve null para que la pantalla pueda ofrecer el PIN', () => {
    const fn = posData.slice(posData.indexOf('export async function verifyManagerHuella'))
    const cuerpo = fn.slice(0, fn.indexOf('\n}\n'))
    expect(cuerpo).toContain('catch')
    expect(cuerpo).toMatch(/catch[\s\S]{0,200}return null/)
  })
})

describe('Corte de caja: huella ademas del PIN', () => {
  it('ofrece entrar con huella pidiendo rol de gerente', () => {
    expect(corte).toContain('verifyManagerHuella')
    expect(corte).toMatch(/verifyManagerHuella\(\s*'gerente'\s*\)/)
  })

  it('la huella y el PIN comparten el MISMO camino de exito', () => {
    // Sin esto, la huella podria entrar sin dejar registro en la auditoria.
    expect(corte).toContain('const concederAcceso')
    const conceder = corte.slice(corte.indexOf('const concederAcceso'))
    const cuerpo = conceder.slice(0, conceder.indexOf('\n  }'))
    expect(cuerpo, 'la entrada por huella tambien se audita').toContain('logAudit')
    expect(cuerpo).toContain("sessionStorage.setItem('corte_access'")
    // Las dos rutas la llaman: la del PIN y la de la huella. (La declaracion lleva
    // ` = (`, asi que no cuenta en este patron.)
    expect((corte.match(/concederAcceso\(/g) || []).length).toBe(2)
  })

  it('el boton solo aparece si la terminal tiene huellas dadas de alta', () => {
    expect(corte).toContain('hayHuellasDadasDeAlta')
    expect(corte).toContain('huellaDisponible &&')
  })
})

describe('Cierre de caja: huella ademas del PIN', () => {
  it('ofrece aprobar con huella', () => {
    expect(cierre).toContain('cerrarConHuella')
    expect(cierre).toMatch(/verifyManagerHuella\(\s*'gerente'\s*\)/)
  })

  it('REGRESION: la huella NO salta el permiso corte_z', () => {
    // handleSave recibe la identidad ya verificada, pero el chequeo de permiso sigue
    // corriendo despues. Si alguien moviera el `hasPermission` arriba del `??`, la
    // huella entraria sin permiso.
    const fn = cierre.slice(cierre.indexOf('const handleSave = async'))
    const iIdentidad = fn.indexOf('identidad ?? await verifyManagerPinWithRole')
    const iPermiso = fn.indexOf("hasPermission(result.role, 'corte_z')")
    expect(iIdentidad).toBeGreaterThan(-1)
    expect(iPermiso).toBeGreaterThan(-1)
    expect(iPermiso, 'el permiso se valida DESPUES de resolver la identidad').toBeGreaterThan(iIdentidad)
  })

  it('REGRESION: handleSave nunca se pasa directo a onClick', () => {
    // TypeScript lo atrapo: `onClick={handleSave}` le pasa el MouseEvent como
    // `identidad`, o sea que el cierre correria con un "resultado" que no vino de
    // verificar nada. Tiene que envolverse.
    expect(cierre).not.toMatch(/onClick=\{handleSave\}/)
    expect(cierre).toMatch(/onClick=\{\(\)\s*=>\s*\{?\s*void handleSave\(\)/)
  })
})

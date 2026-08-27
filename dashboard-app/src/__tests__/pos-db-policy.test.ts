// El proxy /api/pos/db escribe y lee con service_role, o sea que se salta RLS.
// Lo único que separa a un mesero del PIN del gerente es esta política.
//
// El agujero que cierran estas pruebas (auditoría 2026-08-25): el proxy catch-all
// sólo comprobaba que la tabla empezara con `pos_` — sin lista blanca y sin
// control de rol. Con un shift token de mesero:
//
//     GET   pos_staff?select=*         → leía el PIN de todo el personal
//     PATCH pos_staff?id=eq.<gerente>  → se lo reescribía
//
// y entraba como gerente. El aislamiento por TENANT sí funcionaba; el de ROL no
// existía. El hermano db/route.ts sí tenía lista blanca, pero `pos_staff` estaba
// dentro y fuera de MANAGER_ONLY, así que la escritura también pasaba.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALLOW,
  MANAGER_ONLY_WRITE,
  isManager,
  redactResponse,
  tableOf,
} from '@/lib/pos-db-policy'

const ROOT = new URL('..', import.meta.url).pathname

describe('roles', () => {
  it('gerente, admin y dueño mandan', () => {
    for (const r of ['gerente', 'admin', 'dueño']) expect(isManager(r)).toBe(true)
  })

  it('mesero, cajero y capitán NO mandan', () => {
    for (const r of ['mesero', 'cajero', 'capitan', 'cocina']) expect(isManager(r)).toBe(false)
  })

  it('un rol vacío o ausente no manda', () => {
    expect(isManager(undefined)).toBe(false)
    expect(isManager(null)).toBe(false)
    expect(isManager('')).toBe(false)
  })
})

describe('escritura de tablas sensibles', () => {
  it('pos_staff exige gerente — es la escalada que se cerró', () => {
    expect(MANAGER_ONLY_WRITE.has('pos_staff')).toBe(true)
  })

  it('las tablas de dinero exigen gerente', () => {
    expect(MANAGER_ONLY_WRITE.has('pos_cash_movements')).toBe(true)
    expect(MANAGER_ONLY_WRITE.has('pos_cierres')).toBe(true)
  })

  it('las tablas que dan de alta identidad exigen gerente', () => {
    expect(MANAGER_ONLY_WRITE.has('pos_terminals')).toBe(true)
    expect(MANAGER_ONLY_WRITE.has('pos_fingerprint_templates')).toBe(true)
  })

  it('las tablas de operación diaria NO exigen gerente (un mesero tiene que poder comandar)', () => {
    for (const t of ['pos_orders', 'pos_mesas', 'pos_print_jobs', 'pos_save_operations']) {
      expect(MANAGER_ONLY_WRITE.has(t), `${t} no debería exigir gerente`).toBe(false)
    }
  })

  it('toda tabla que exige gerente está en la lista blanca', () => {
    for (const t of MANAGER_ONLY_WRITE) expect(ALLOW.has(t), `${t} fuera de ALLOW`).toBe(true)
  })
})

describe('redacción de columnas', () => {
  it('el pin nunca sale de pos_staff, aunque el select lo pida', () => {
    const body = JSON.stringify([
      { id: 'a', name: 'Pedro', role: 'mesero', pin: '1234' },
      { id: 'b', name: 'Ana', role: 'gerente', pin: '9999' },
    ])
    const out = JSON.parse(redactResponse('pos_staff', body, 'application/json'))
    expect(out.every((r: Record<string, unknown>) => !('pin' in r))).toBe(true)
    // y lo demás sigue llegando: el POS necesita nombre y rol
    expect(out[0].name).toBe('Pedro')
    expect(out[1].role).toBe('gerente')
  })

  it('redacta también un objeto suelto, no sólo arreglos', () => {
    const out = JSON.parse(redactResponse('pos_staff', JSON.stringify({ id: 'a', pin: '1234' }), 'application/json'))
    expect('pin' in out).toBe(false)
  })

  it('las plantillas de huella tampoco salen', () => {
    const out = JSON.parse(
      redactResponse('pos_fingerprint_templates', JSON.stringify([{ id: 'x', template: 'AAAA' }]), 'application/json'),
    )
    expect('template' in out[0]).toBe(false)
  })

  it('una tabla sin columnas prohibidas pasa intacta', () => {
    const body = JSON.stringify([{ id: 1, mesa: 5, total: 320 }])
    expect(redactResponse('pos_orders', body, 'application/json')).toBe(body)
  })

  it('no rompe un cuerpo que no es JSON (PostgREST también devuelve CSV y vacíos)', () => {
    expect(redactResponse('pos_staff', 'id,name\n1,Pedro', 'text/csv')).toBe('id,name\n1,Pedro')
    expect(redactResponse('pos_staff', '', 'application/json')).toBe('')
    expect(redactResponse('pos_staff', 'no-es-json', 'application/json')).toBe('no-es-json')
  })
})

describe('tableOf', () => {
  it('saca el nombre de tabla de las formas reales de PostgREST', () => {
    expect(tableOf('pos_orders?select=*')).toBe('pos_orders')
    expect(tableOf('rest/v1/pos_staff?id=eq.5')).toBe('pos_staff')
    expect(tableOf('pos_mesas')).toBe('pos_mesas')
  })
})

describe('las dos rutas comparten la política — no puede haber una laxa', () => {
  const catchAll = readFileSync(join(ROOT, 'app', 'api', 'pos', 'db', '[...path]', 'route.ts'), 'utf8')
  const directa = readFileSync(join(ROOT, 'app', 'api', 'pos', 'db', 'route.ts'), 'utf8')

  it('ninguna define su propia lista blanca', () => {
    for (const [nombre, src] of [['catch-all', catchAll], ['directa', directa]] as const) {
      expect(src, `${nombre} define ALLOW local`).not.toMatch(/const ALLOW\s*=\s*new Set/)
      expect(src, `${nombre} define MANAGER_ONLY local`).not.toMatch(/const MANAGER_ONLY\w*\s*=\s*new Set/)
    }
  })

  it('las dos importan la política compartida', () => {
    expect(catchAll).toContain("from '@/lib/pos-db-policy'")
    expect(directa).toContain("from '@/lib/pos-db-policy'")
  })

  it('las dos redactan la respuesta antes de devolverla', () => {
    expect(catchAll).toContain('redactResponse(')
    expect(directa).toContain('redactResponse(')
  })

  it('el catch-all comprueba la lista blanca y el rol', () => {
    expect(catchAll).toContain('ALLOW.has(')
    expect(catchAll).toContain('MANAGER_ONLY_WRITE.has(')
    expect(catchAll).toContain('isManager(')
  })

  it('ninguna exime a los RPC de sus protecciones', () => {
    // El agujero del 2026-08-27: el catch-all tenía las SEIS protecciones escritas
    // como una negación de "¿es RPC?", así que cada una nacía ya saltada para
    // `/rest/v1/rpc/*`. La condición se eliminó; los RPC se rechazan de entrada.
    //
    // Se comparan los archivos SIN comentarios a propósito: la aserción es sobre lo
    // que el código hace, no sobre lo que la prosa menciona — este mismo archivo y la
    // cabecera del proxy explican el bug nombrando la condición que se eliminó.
    const soloCodigo = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    for (const [nombre, src] of [['catch-all', catchAll], ['directa', directa]] as const) {
      expect(soloCodigo(src), `${nombre} vuelve a eximir a los RPC de una protección`)
        .not.toMatch(/!\s*isRpc/)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(resolve(here, '../app/pos/page.tsx'), 'utf8')
const css = readFileSync(resolve(here, '../app/globals.css'), 'utf8')

describe('Golden Skeleton POS responsive shell', () => {
  it('locks the service document to one dynamic viewport', () => {
    expect(page).toContain('pos-service-shell h-dvh min-h-0')
    expect(css).toContain('body:has(.pos-service-shell)')
    expect(css).toMatch(/body:has\(\.pos-service-shell\)[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*hidden;/)
  })

  it('uses an explicit phone menu/order switch', () => {
    expect(page).toContain('flex md:hidden')
    expect(page).toContain("setMobileView('menu')")
    expect(page).toContain("setMobileView('order')")
  })

  it('does not make the compact selector row horizontally scrollable', () => {
    expect(page).toContain('items-center gap-1.5 overflow-hidden border-t')
    expect(page).not.toContain('items-center gap-1.5 px-3 py-1 border-t border-[var(--line)]/50 overflow-x-auto')
  })
})

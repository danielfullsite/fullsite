'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Menú de pantalla completa.
//
// El cajón que había antes mostraba 79 enlaces en 13 secciones dentro de una
// columna angosta: para llegar a «Corte» había que recorrer medio menú con el
// pulgar. Esto los pone todos a la vez en una retícula que usa el ancho
// completo, y agrega un filtro para los casos en que aun así no quepan.
//
// Recibe las secciones YA filtradas por permiso y plan. No decide qué se ve:
// eso lo resuelve Sidebar con las mismas dos funciones de siempre.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { X, Search, LogOut } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon }
export type NavSection = { label: string; items: NavItem[] }

export default function NavPantallaCompleta({
  secciones, pathname, onClose, onSignOut, titulo, subtitulo,
}: {
  secciones: NavSection[]
  pathname: string
  onClose: () => void
  onSignOut?: () => void
  titulo?: string
  subtitulo?: string
}) {
  const [q, setQ] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  // Escape cierra. En una terminal con teclado físico es lo que se intenta
  // primero, y sin esto el menú se sentía una trampa.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const termino = q.trim().toLowerCase()
  const filtradas = useMemo(() => {
    if (!termino) return secciones
    return secciones
      .map(s => ({ ...s, items: s.items.filter(i => i.label.toLowerCase().includes(termino)) }))
      .filter(s => s.items.length > 0)
  }, [secciones, termino])

  const total = filtradas.reduce((n, s) => n + s.items.length, 0)
  const activo = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href + '/'))

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Encabezado */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--line)', paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}
      >
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] truncate" style={{ color: 'var(--text-1)' }}>{titulo || 'Menú'}</p>
          {subtitulo && <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{subtitulo}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar menú"
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform active:scale-90"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
        >
          <X size={22} />
        </button>
      </div>

      {/* Filtro */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-4)' }} />
          <input
            ref={campo}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar en el menú…"
            className="w-full h-14 pl-11 pr-11 rounded-xl text-[15px] font-medium focus:outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
          />
          {q && (
            <button
              onClick={() => { setQ(''); campo.current?.focus() }}
              aria-label="Limpiar"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ color: 'var(--text-3)' }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* La retícula. columns reparte las secciones por altura, así que el
          menú llena el ancho de verdad en vez de dejar una columna larga. */}
      <div className="flex-1 overflow-y-auto px-4 py-3 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        {total === 0 ? (
          <p className="text-center py-12 text-sm" style={{ color: 'var(--text-3)' }}>
            Nada coincide con «{q}».
          </p>
        ) : (
          <div className="[column-width:178px] [column-gap:16px]">
            {filtradas.map(sec => (
              <div key={sec.label} className="break-inside-avoid mb-3">
                <p
                  className="text-[10px] font-black uppercase tracking-[0.09em] mb-1.5 px-1"
                  style={{ color: 'var(--text-4)' }}
                >
                  {sec.label}
                </p>
                {sec.items.map(item => {
                  const Icono = item.icon
                  const on = activo(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className="flex items-center gap-2.5 h-11 px-2.5 rounded-lg text-[13.5px] font-semibold transition-colors"
                      style={on
                        ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent-line)' }
                        : { color: 'var(--text-2)', border: '1px solid transparent' }}
                    >
                      <Icono size={17} className="flex-shrink-0" style={{ opacity: on ? 1 : 0.75 }} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pie */}
      {onSignOut && (
        <div
          className="px-4 py-3 border-t flex-shrink-0"
          style={{ borderColor: 'var(--line)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
        >
          <button
            onClick={onSignOut}
            className="w-full h-14 rounded-xl flex items-center justify-center gap-2 font-bold text-sm transition-transform active:scale-[0.98]"
            style={{ background: 'var(--crit-soft)', border: '1px solid color-mix(in srgb, var(--crit) 30%, transparent)', color: 'var(--crit-ink)' }}
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}

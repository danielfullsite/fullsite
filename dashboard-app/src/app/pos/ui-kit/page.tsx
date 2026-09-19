'use client'
// Preview del UI Kit del POS — NO es una pantalla de operación, es el catálogo
// vivo del sistema de diseño. Abre /pos/ui-kit para ver los componentes reales.
import React, { useState } from 'react'
import {
  Coffee, UtensilsCrossed, CakeSlice, Leaf, Droplet, Send, CreditCard, Receipt,
  Printer, Users, Clock, WifiOff, Check, Ban, ChefHat, Percent, Map as MapIcon, Layers,
} from 'lucide-react'
import {
  PosButton, CategoryChip, ProductTile, Stepper, StatusPill, QuickAmount, CatKey,
  Sheet, List, Row, RowText, CardStat, Tag, Pill, ActionBar, Keypad,
} from '@/components/pos/ui/PosKit'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="mb-4">
        <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>{title}</h2>
        {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

const CATS: { key: CatKey; label: string; icon: React.ReactNode }[] = [
  { key: 'cafe', label: 'Café', icon: <Coffee size={16} /> },
  { key: 'cocina', label: 'Cocina', icon: <UtensilsCrossed size={16} /> },
  { key: 'postre', label: 'Postre', icon: <CakeSlice size={16} /> },
  { key: 'te', label: 'Té', icon: <Leaf size={16} /> },
  { key: 'agua', label: 'Agua', icon: <Droplet size={16} /> },
]

export default function UiKitPreview() {
  const [qty, setQty] = useState(2)
  const [active, setActive] = useState<CatKey>('cafe')
  const [sheet, setSheet] = useState<null | 'md' | 'wide' | 'full'>(null)
  const [monto, setMonto] = useState('')

  return (
    <div className="pos-kiosk h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      <header className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
        <div className="flex items-baseline gap-2">
          <span className="font-black tracking-tight">fullsite</span>
          <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'var(--accent-bright)' }}>UI Kit · POS</span>
        </div>
        <StatusPill tone="off" icon={<WifiOff size={12} />} pulse>OFFLINE</StatusPill>
      </header>

      <div className="flex-1 overflow-y-auto p-5 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', alignContent: 'start' }}>
        <Section title="Botones de acción" hint="Primario esmeralda · cobro azul-info · secundario ghost · destructivo. Siempre icono + verbo, ≥48px.">
          <div className="flex flex-wrap gap-3">
            <PosButton variant="primary" icon={<Send size={18} />}>Enviar</PosButton>
            <PosButton variant="info" icon={<CreditCard size={18} />}>Cobrar</PosButton>
            <PosButton variant="ghost" icon={<Receipt size={18} />}>Cuenta</PosButton>
            <PosButton variant="danger" icon={<Ban size={18} />}>Anular</PosButton>
          </div>
          <div className="mt-3">
            <PosButton variant="primary" size="lg" full icon={<Send size={20} />}>Enviar orden</PosButton>
          </div>
        </Section>

        <Section title="Chips de categoría (rail)" hint="Color = navegación. Cada categoría su color + icono. Toca para activar.">
          <div className="flex flex-col gap-2 max-w-[220px]">
            {CATS.map((c) => (
              <CategoryChip key={c.key} catKey={c.key} icon={c.icon} label={c.label} active={active === c.key} onClick={() => setActive(c.key)} />
            ))}
          </div>
        </Section>

        <Section title="Tiles de producto" hint="Gradiente por categoría, icono, nombre y precio. 72px, touch-first.">
          <div className="grid grid-cols-3 gap-2.5">
            <ProductTile catKey="cafe" icon={<Coffee size={16} />} name="Latte" price={47} />
            <ProductTile catKey="cafe" icon={<Coffee size={16} />} name="Capuchino" price={52} />
            <ProductTile catKey="cafe" icon={<Coffee size={16} />} name="Cold Brew" price={58} />
            <ProductTile catKey="cocina" icon={<UtensilsCrossed size={16} />} name="Chilaquiles" price={215} />
            <ProductTile catKey="postre" icon={<CakeSlice size={16} />} name="Cheesecake" price={99} />
            <ProductTile catKey="te" icon={<Leaf size={16} />} name="Chai" price={55} />
          </div>
        </Section>

        <Section title="Stepper de cantidad" hint="+/− de 44px. Nada de teclear.">
          <div className="flex items-center gap-4">
            <Stepper value={qty} onDec={() => setQty((q) => Math.max(1, q - 1))} onInc={() => setQty((q) => q + 1)} />
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>cantidad actual: <b style={{ color: 'var(--text-1)' }}>{qty}</b></span>
          </div>
        </Section>

        <Section title="Pastillas de estado" hint="El estado se ve, no se lee. Color + icono.">
          <div className="flex flex-wrap gap-2.5">
            <StatusPill tone="occ" icon={<Clock size={12} />}>Ocupada · 12m</StatusPill>
            <StatusPill tone="free" icon={<Check size={12} />}>Libre</StatusPill>
            <StatusPill tone="bill" icon={<Receipt size={12} />}>Cuenta</StatusPill>
            <StatusPill tone="off" icon={<WifiOff size={12} />} pulse>Offline</StatusPill>
            <StatusPill tone="neutral" icon={<Users size={12} />}>4 en turno</StatusPill>
          </div>
        </Section>

        <Section title="Montos rápidos (cobro)" hint="Un tap para el efectivo recibido más común. Adiós keypad en el 80% de los cobros.">
          <div className="grid grid-cols-2 gap-2.5 max-w-[240px]">
            <QuickAmount label="Exacto" />
            <QuickAmount label="$350" />
            <QuickAmount label="$400" />
            <QuickAmount label="Otro" accent />
          </div>
          <div className="mt-4 text-center rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Cambio a dar</div>
            <div className="font-black tabular-nums" style={{ color: 'var(--info)', fontSize: 40, letterSpacing: '-.03em', lineHeight: 1 }}>$46.08</div>
            <div className="text-xs font-semibold mt-1 flex items-center justify-center gap-1.5" style={{ color: 'var(--accent-bright)' }}>
              <Check size={12} /> Pagado $350.00 · efectivo
            </div>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <PosButton variant="ghost" icon={<Printer size={18} />}>Imprimir</PosButton>
              <PosButton variant="primary" icon={<Send size={18} />}>Nuevo</PosButton>
            </div>
          </div>
        </Section>

        {/* ── Fase 1 del rediseño V2 ──────────────────────────────────────── */}

        <Section title="CardStat" hint="Un número por tarjeta. Etiqueta arriba, número grande, nota abajo. El tono pinta el número, no el fondo.">
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <CardStat label="Venta del turno" value="$48,210" note="$6,027 por hora" tone="ok" />
            <CardStat label="Abierto en piso" value="$9,340" note="7 cuentas sin cerrar" tone="info" />
            <CardStat label="Cancelaciones" value={9} note="aviso a las 4 por persona" tone="bad" />
            <CardStat label="Ticket promedio" value="$612" />
          </div>
        </Section>

        <Section title="Tag y Pill" hint="Tag clasifica un renglón. Pill es el estado de la terminal: mono, mayúsculas, se lee de reojo.">
          <div className="flex flex-wrap gap-2 mb-4">
            <Tag tone="ok">en nivel</Tag>
            <Tag tone="info" icon={<Clock size={11} />}>en cocina</Tag>
            <Tag tone="warn">por acabarse</Tag>
            <Tag tone="bad">bajo mínimo</Tag>
            <Tag>sin contar</Tag>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill state="on">Cocina</Pill>
            <Pill state="on">Turno abierto</Pill>
            <Pill state="off" pulse>Sin internet</Pill>
            <Pill state="warn">Subiendo 3…</Pill>
            <Pill state="neutral" dot={false}>14:32</Pill>
          </div>
        </Section>

        <Section title="List + Row + RowText" hint="La lista scrollea, no la página. Un Row con onClick se renderiza como <button>: llega por teclado y lo anuncia un lector.">
          <List className="max-h-[240px]">
            <Row columns="auto 1fr auto" onClick={() => {}}>
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>14:02</span>
              <RowText title="Cobro $1,240 · efectivo" sub="Celeste Ivonne · mesa 12" />
              <Tag tone="ok">pago</Tag>
            </Row>
            <Row columns="auto 1fr auto" tone="bad" onClick={() => {}}>
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>13:48</span>
              <RowText title="Cancelado: PIZZA PEPERONI" sub="Jose Reyna · error de cocina" />
              <Tag tone="bad">cancelado</Tag>
            </Row>
            <Row columns="auto 1fr auto" onClick={() => {}}>
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>13:31</span>
              <RowText title="Descuento 15% aplicado" sub="Eduardo" />
              <Tag tone="warn" icon={<Percent size={11} />}>descuento</Tag>
            </Row>
            <Row columns="auto 1fr auto">
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>13:05</span>
              <RowText title="Orden enviada a cocina" sub="Aldo Ruiz · mesa 5 — renglón sin acción" />
              <Tag tone="info" icon={<ChefHat size={11} />}>envío</Tag>
            </Row>
          </List>
        </Section>

        <Section title="Keypad" hint="3 columnas, teclas de 58px. No guarda estado: emite dígitos y deja las dos funciones a quien lo usa.">
          <div className="flex gap-4 items-start flex-wrap">
            <div className="max-w-[220px] flex-1 min-w-[200px]">
              <Keypad
                onDigit={(d) => setMonto((v) => (v.length < 7 ? v + d : v))}
                left={{ label: 'Limpiar', onPress: () => setMonto('') }}
                right={{ label: '←', onPress: () => setMonto((v) => v.slice(0, -1)) }}
              />
            </div>
            <div className="rounded-2xl border px-5 py-4 text-center min-w-[160px]" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <div className="text-[10px] font-extrabold uppercase tracking-[.14em]" style={{ color: 'var(--text-3)' }}>Monto</div>
              <div className="font-black tabular-nums" style={{ fontSize: 34, letterSpacing: '-.04em' }}>${monto || '0'}</div>
            </div>
          </div>
        </Section>

        <Section title="ActionBar" hint="78px de alto, columnas declaradas. Los verbos conservan su posición entre pantallas: destructivo a la izquierda, principal a la derecha.">
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-4)', background: 'var(--bg)' }}>
              (contenido de la pantalla)
            </div>
            <ActionBar columns="auto auto 1fr 1fr 1.25fr">
              <PosButton variant="ghost" ariaLabel="Mesas" icon={<MapIcon size={18} />} />
              <PosButton variant="ghost" ariaLabel="Acciones de la mesa" icon={<Layers size={18} />} />
              <PosButton variant="ghost" icon={<Receipt size={18} />}>Cuenta</PosButton>
              <PosButton variant="primary" icon={<Send size={18} />}>Enviar</PosButton>
              <PosButton variant="info" icon={<CreditCard size={18} />}>Cobrar</PosButton>
            </ActionBar>
          </div>
        </Section>

        <Section title="Sheet" hint="Envuelve <Dialog>: hereda trampa de foco, ESC por pila y bloqueo de scroll. Sólo le pone la piel del rediseño y sus tres tamaños.">
          <div className="flex flex-wrap gap-2.5">
            <PosButton variant="ghost" onClick={() => setSheet('md')}>Abrir md</PosButton>
            <PosButton variant="ghost" onClick={() => setSheet('wide')}>Abrir wide</PosButton>
            <PosButton variant="ghost" onClick={() => setSheet('full')}>Abrir full</PosButton>
          </div>
          <Sheet
            open={sheet !== null}
            onClose={() => setSheet(null)}
            size={sheet ?? 'md'}
            title="Acciones de la mesa"
            subtitle="Mesa 12 · $1,240.00"
            footer={
              <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
                <PosButton variant="ghost" onClick={() => setSheet(null)}>Cancelar</PosButton>
                <PosButton variant="primary" icon={<Check size={18} />} onClick={() => setSheet(null)}>Confirmar</PosButton>
              </div>
            }
          >
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
              {['Descuento', 'Dividir cuenta', 'Mover de mesa', 'Nota a cocina', 'Reimprimir', 'Anular orden'].map((t) => (
                <div key={t} className="rounded-xl border grid place-items-center text-sm font-bold" style={{ height: 72, borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>{t}</div>
              ))}
            </div>
          </Sheet>
        </Section>
      </div>
    </div>
  )
}

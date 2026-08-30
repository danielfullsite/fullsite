'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUpRight, BarChart3, Bell, Check, ChefHat, CircleDollarSign,
  Clock3, Coffee, LayoutDashboard, Minus, Plus, ReceiptText, ShoppingBag,
  Sparkles, UtensilsCrossed, WifiOff,
} from 'lucide-react'
import styles from './preview.module.css'

type Brand = {
  name: string
  short: string
  accent: string
  soft: string
  concept: string
}

const BRANDS: Brand[] = [
  { name: 'Rosta', short: 'RO', accent: '#c34a2c', soft: '#f8e4dc', concept: 'Cocina contemporánea' },
  { name: 'Café Macadam', short: 'CM', accent: '#867047', soft: '#f1eadc', concept: 'Café & brunch' },
  { name: 'Tacos Manteca', short: 'TM', accent: '#d38b15', soft: '#fff0cf', concept: 'Taquería urbana' },
  { name: 'Atletico Cafe', short: 'AC', accent: '#237069', soft: '#dcefeb', concept: 'Coffee & community' },
  { name: 'Casa Oso', short: 'CO', accent: '#3f526e', soft: '#e1e8f1', concept: 'Comfort food' },
]

const MENU = [
  { id: 1, name: 'Taco de brisket', category: 'Favoritos', price: 78 },
  { id: 2, name: 'Tostada de atún', category: 'Entradas', price: 168 },
  { id: 3, name: 'Burger de la casa', category: 'Fuertes', price: 245 },
  { id: 4, name: 'Bowl mediterráneo', category: 'Fuertes', price: 198 },
  { id: 5, name: 'Cold brew', category: 'Bebidas', price: 82 },
  { id: 6, name: 'Pan francés', category: 'Postres', price: 145 },
]

const INITIAL_TICKETS = [
  { id: 104, table: 'Mesa 8', age: 4, items: ['2 × Taco de brisket', '1 × Cold brew'], status: 'Nueva' },
  { id: 103, table: 'Mesa 3', age: 9, items: ['1 × Burger de la casa', '1 × Bowl mediterráneo'], status: 'Preparando' },
  { id: 102, table: 'Para llevar', age: 14, items: ['2 × Tostada de atún', '1 × Pan francés'], status: 'Urgente' },
]

type Surface = 'dashboard' | 'pos' | 'kds'

export default function DiezmexPreview() {
  const [surface, setSurface] = useState<Surface>('dashboard')
  const [brandIndex, setBrandIndex] = useState(0)
  const [cart, setCart] = useState<Record<number, number>>({ 1: 2, 5: 1 })
  const [tickets, setTickets] = useState(INITIAL_TICKETS)
  const [offline, setOffline] = useState(false)
  const [toast, setToast] = useState('')
  const brand = BRANDS[brandIndex]

  const total = useMemo(() => MENU.reduce((sum, item) => sum + item.price * (cart[item.id] || 0), 0), [cart])
  const qty = Object.values(cart).reduce((sum, n) => sum + n, 0)

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const add = (id: number) => setCart(current => ({ ...current, [id]: (current[id] || 0) + 1 }))
  const subtract = (id: number) => setCart(current => ({ ...current, [id]: Math.max(0, (current[id] || 0) - 1) }))

  const sendOrder = () => {
    if (!qty) return
    const items = MENU.filter(item => cart[item.id]).map(item => `${cart[item.id]} × ${item.name}`)
    setTickets(current => [{ id: 105, table: 'Mesa 12', age: 0, items, status: 'Nueva' }, ...current])
    setCart({})
    flash(offline ? 'Orden guardada localmente · se sincronizará sola' : 'Orden enviada a cocina')
  }

  return (
    <main className={styles.shell} style={{ '--brand': brand.accent, '--brand-soft': brand.soft } as React.CSSProperties}>
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <div className={styles.fullsiteMark}>f<span>.</span></div>
          <div>
            <strong>Fullsite × Diezmex</strong>
            <small>Preview privado · datos simulados</small>
          </div>
        </div>
        <div className={styles.topActions}>
          <button className={offline ? styles.offlineActive : styles.status} onClick={() => setOffline(!offline)}>
            {offline ? <WifiOff size={16} /> : <span className={styles.liveDot} />}
            {offline ? 'Modo offline' : 'Operación en vivo'}
          </button>
          <button className={styles.iconButton} aria-label="Notificaciones"><Bell size={19} /></button>
          <div className={styles.avatar}>DO</div>
        </div>
      </header>

      <section className={styles.brandRail} aria-label="Marcas Diezmex">
        <div className={styles.brandRailIntro}>
          <span>Grupo Diezmex</span>
          <strong>5 marcas · una vista</strong>
        </div>
        {BRANDS.map((item, index) => (
          <button key={item.name} onClick={() => setBrandIndex(index)} className={index === brandIndex ? styles.brandActive : styles.brandButton}>
            <span style={{ background: item.accent }}>{item.short}</span>
            <div><strong>{item.name}</strong><small>{item.concept}</small></div>
          </button>
        ))}
      </section>

      <nav className={styles.nav}>
        <button className={surface === 'dashboard' ? styles.navActive : ''} onClick={() => setSurface('dashboard')}><LayoutDashboard size={18} /> Resumen</button>
        <button className={surface === 'pos' ? styles.navActive : ''} onClick={() => setSurface('pos')}><ReceiptText size={18} /> Punto de venta</button>
        <button className={surface === 'kds' ? styles.navActive : ''} onClick={() => setSurface('kds')}><ChefHat size={18} /> Cocina <span>{tickets.length}</span></button>
        <div className={styles.context}><span style={{ background: brand.accent }}>{brand.short}</span><div><small>Vista actual</small><strong>{brand.name}</strong></div></div>
      </nav>

      {surface === 'dashboard' && <Dashboard brand={brand} setSurface={setSurface} />}
      {surface === 'pos' && (
        <section className={styles.posGrid}>
          <div className={styles.catalog}>
            <div className={styles.sectionTitle}><div><small>Servicio de hoy</small><h1>Toma la orden sin perder el ritmo.</h1></div><span>Mesa 12 · 3 personas</span></div>
            <div className={styles.categories}>{['Todos', 'Favoritos', 'Entradas', 'Fuertes', 'Bebidas', 'Postres'].map((c, i) => <button className={i === 0 ? styles.categoryActive : ''} key={c}>{c}</button>)}</div>
            <div className={styles.menuGrid}>{MENU.map(item => (
              <button className={styles.menuItem} key={item.id} onClick={() => add(item.id)}>
                <span>{item.category}</span><strong>{item.name}</strong><footer><b>${item.price}</b><i><Plus size={18} /></i></footer>
              </button>
            ))}</div>
          </div>
          <aside className={styles.check}>
            <div className={styles.checkHead}><div><small>Cuenta abierta</small><strong>Mesa 12</strong></div><span>{qty} artículos</span></div>
            <div className={styles.checkItems}>{MENU.filter(item => cart[item.id]).map(item => (
              <div className={styles.checkRow} key={item.id}>
                <div><strong>{item.name}</strong><small>${item.price} c/u</small></div>
                <div className={styles.stepper}><button onClick={() => subtract(item.id)}><Minus size={15} /></button><b>{cart[item.id]}</b><button onClick={() => add(item.id)}><Plus size={15} /></button></div>
                <b>${item.price * cart[item.id]}</b>
              </div>
            ))}{!qty && <div className={styles.empty}><ShoppingBag size={30} /><p>Agrega platillos para comenzar.</p></div>}</div>
            <div className={styles.total}><span>Total</span><strong>${total.toLocaleString('es-MX')}</strong></div>
            <button className={styles.primary} disabled={!qty} onClick={sendOrder}>{offline ? 'Guardar orden offline' : 'Enviar a cocina'} <ArrowUpRight size={20} /></button>
          </aside>
        </section>
      )}
      {surface === 'kds' && (
        <section className={styles.kds}>
          <div className={styles.sectionTitle}><div><small>Cocina · turno actual</small><h1>Todo lo que importa, de un vistazo.</h1></div><div className={styles.kdsStats}><span><b>{tickets.length}</b> activas</span><span><b>8:42</b> promedio</span></div></div>
          <div className={styles.ticketGrid}>{tickets.map((ticket, index) => (
            <article className={`${styles.ticket} ${ticket.status === 'Urgente' ? styles.ticketUrgent : ''}`} key={ticket.id}>
              <header><div><small>#{ticket.id}</small><strong>{ticket.table}</strong></div><span><Clock3 size={15} /> {ticket.age} min</span></header>
              <div className={styles.ticketItems}>{ticket.items.map(item => <p key={item}>{item}</p>)}</div>
              <footer><span>{ticket.status}</span><button onClick={() => { setTickets(current => current.filter(t => t.id !== ticket.id)); flash(`Comanda #${ticket.id} completada`) }}><Check size={18} /> Completar</button></footer>
              <i className={styles.ticketOrder}>{String(index + 1).padStart(2, '0')}</i>
            </article>
          ))}{tickets.length === 0 && <div className={styles.kdsEmpty}><Check size={42} /><h2>Cocina al día</h2><p>No hay comandas pendientes.</p></div>}</div>
        </section>
      )}

      {toast && <div className={styles.toast}><Check size={18} />{toast}</div>}
    </main>
  )
}

function Dashboard({ brand, setSurface }: { brand: Brand; setSurface: (s: Surface) => void }) {
  return (
    <section className={styles.dashboard}>
      <div className={styles.hero}>
        <div><small>Jueves · operación consolidada</small><h1>Daniel, tus restaurantes<br />están <em>en orden.</em></h1><p>{brand.name} lleva el 104% de su objetivo diario. Cocina estable y ninguna alerta crítica.</p></div>
        <div className={styles.heroNumber}><span>Venta neta hoy</span><strong>$428,650</strong><small>↑ 12.4% contra jueves anterior</small></div>
      </div>
      <div className={styles.metrics}>
        <article><span><CircleDollarSign size={19} /> Venta del grupo</span><strong>$428.6k</strong><small>Objetivo: $410k</small><i style={{ width: '84%' }} /></article>
        <article><span><ReceiptText size={19} /> Tickets</span><strong>1,284</strong><small>Ticket promedio $334</small><i style={{ width: '68%' }} /></article>
        <article><span><Clock3 size={19} /> Tiempo cocina</span><strong>8:42</strong><small>1:18 más rápido hoy</small><i style={{ width: '74%' }} /></article>
        <article><span><BarChart3 size={19} /> Costo teórico</span><strong>29.8%</strong><small>Dentro de objetivo</small><i style={{ width: '61%' }} /></article>
      </div>
      <div className={styles.dashboardBottom}>
        <article className={styles.brandPerformance}><header><div><small>Desempeño por marca</small><h2>El grupo, comparado justamente</h2></div><button>Ver reporte</button></header>{BRANDS.map((item, index) => <div className={styles.performanceRow} key={item.name}><span style={{ background: item.accent }}>{item.short}</span><strong>{item.name}</strong><div><i style={{ width: `${92 - index * 8}%`, background: item.accent }} /></div><b>${[112, 98, 87, 72, 59][index]}k</b><small>+{[18, 9, 14, 6, 11][index]}%</small></div>)}</article>
        <aside className={styles.brief}><span><Sparkles size={18} /> Fullsite IQ · 12:41</span><h2>Dos decisiones para hoy.</h2><p><b>Café Macadam:</b> el cold brew se agotará cerca de las 17:30. Prepara 18 porciones adicionales.</p><p><b>Casa Oso:</b> la burger tiene 4.2 puntos más de costo que el objetivo. Revisa la merma de proteína.</p><button onClick={() => setSurface('pos')}>Abrir operación <ArrowUpRight size={18} /></button></aside>
      </div>
    </section>
  )
}

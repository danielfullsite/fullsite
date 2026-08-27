'use client'

import { useMemo, useState } from 'react'
import { ArrowUpRight, Bell, Building2, ChefHat, ChevronRight, CircleDot, CloudOff, Package, Receipt, Search, ShieldCheck, Store, Users } from 'lucide-react'
import { DIEZMEX_CONCEPTS, GROUP_ALERTS, GROUP_TOTALS, WEEK, type DiezMexConcept } from '@/lib/demo-diezmex'
import styles from './page.module.css'

const mxn = (value: number) => `$${value.toLocaleString('es-MX')}`

export default function DemoDiezMexPage() {
  const [selectedId, setSelectedId] = useState<DiezMexConcept['id']>('grupo')
  const selected = useMemo(() => DIEZMEX_CONCEPTS.find((concept) => concept.id === selectedId), [selectedId])
  const isGroup = selectedId === 'grupo'

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <div className={styles.fullsiteMark}>FULLSITE<span>×</span>DIEZMEX</div>
          <div className={styles.demoTag}>ENTORNO DEMOSTRATIVO · DATOS SIMULADOS</div>
        </div>
        <div className={styles.topActions}>
          <button aria-label="Buscar" className={styles.iconButton}><Search size={18} /></button>
          <button aria-label="Alertas" className={styles.iconButton}><Bell size={18} /><span className={styles.dot} /></button>
          <div className={styles.avatar}>DM</div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.rail} aria-label="Conceptos del grupo">
          <button className={`${styles.conceptButton} ${isGroup ? styles.selected : ''}`} onClick={() => setSelectedId('grupo')}>
            <span className={styles.conceptIndex}>00</span>
            <span><strong>GRUPO DIEZMEX</strong><small>Vista consolidada</small></span>
          </button>
          {DIEZMEX_CONCEPTS.map((concept, index) => (
            <button key={concept.id} className={`${styles.conceptButton} ${selectedId === concept.id ? styles.selected : ''}`} onClick={() => setSelectedId(concept.id)} style={{ '--concept': concept.accent } as React.CSSProperties}>
              <span className={styles.conceptIndex}>{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{concept.name}</strong><small>{concept.status}</small></span>
            </button>
          ))}
          <div className={styles.offlineNote}>
            <CloudOff size={17} />
            <span><strong>Operación local</strong>POS, KDS e impresión continúan sin Internet.</span>
          </div>
        </aside>

        <section className={styles.content}>
          <div className={styles.eyebrow}>{isGroup ? 'CONTROL CORPORATIVO / HOY' : `OPERACIÓN / ${selected?.name}`}</div>
          <div className={styles.heroRow}>
            <div>
              <h1>{isGroup ? <>Cinco conceptos.<br /><em>Una sola lectura.</em></> : selected?.name}</h1>
              <p>{isGroup ? 'Ventas, operación y riesgos visibles desde el grupo hasta la última orden.' : selected?.descriptor}</p>
            </div>
            <div className={styles.contextCard}>
              <span>{isGroup ? 'Consolidado' : selected?.location}</span>
              <strong>{isGroup ? '4 operando · 1 en apertura' : selected?.hours}</strong>
              <small>Actualizado hace 42 segundos</small>
            </div>
          </div>

          {isGroup ? <GroupDashboard onSelect={setSelectedId} /> : selected && <ConceptDashboard concept={selected} />}
        </section>
      </div>
    </main>
  )
}

function GroupDashboard({ onSelect }: { onSelect: (id: DiezMexConcept['id']) => void }) {
  return (
    <>
      <section className={styles.metrics}>
        <Metric label="Venta neta hoy" value={mxn(GROUP_TOTALS.sales)} detail="+8.4% vs. martes anterior" positive />
        <Metric label="Transacciones" value={GROUP_TOTALS.tickets.toLocaleString('es-MX')} detail="En cuatro conceptos operando" />
        <Metric label="Ticket promedio" value={mxn(Math.round(GROUP_TOTALS.sales / GROUP_TOTALS.tickets))} detail="Mezcla consolidada" />
        <Metric label="Unidades activas" value={`${GROUP_TOTALS.active}/5`} detail="Casa Oso en preapertura" />
      </section>

      <section className={styles.board}>
        <div className={styles.portfolioPanel}>
          <div className={styles.sectionTitle}><span>PORTAFOLIO EN VIVO</span><small>Selecciona una unidad para entrar</small></div>
          <div className={styles.portfolioRows}>
            {DIEZMEX_CONCEPTS.map((concept) => {
              const max = Math.max(...DIEZMEX_CONCEPTS.map((item) => item.sales))
              return (
                <button key={concept.id} className={styles.portfolioRow} onClick={() => onSelect(concept.id)}>
                  <span className={styles.statusLight} style={{ background: concept.accent }} />
                  <span className={styles.rowName}><strong>{concept.name}</strong><small>{concept.descriptor}</small></span>
                  <span className={styles.salesBar}><i style={{ width: concept.sales ? `${(concept.sales / max) * 100}%` : '3%', background: concept.accent }} /></span>
                  <span className={styles.rowValue}>{concept.sales ? mxn(concept.sales) : 'PREAPERTURA'}</span>
                  <ChevronRight size={17} />
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.pulsePanel}>
          <div className={styles.sectionTitle}><span>PULSO DE 7 DÍAS</span><small>Venta consolidada</small></div>
          <div className={styles.sparkline}>
            {WEEK.map((height, index) => <div key={index}><i style={{ height: `${height}%` }} /><span>{['L','M','M','J','V','S','D'][index]}</span></div>)}
          </div>
          <div className={styles.pulseFooter}><strong>+12.6%</strong><span>contra la semana anterior</span></div>
        </div>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.alertPanel}>
          <div className={styles.sectionTitle}><span>LO QUE REQUIERE ATENCIÓN</span><small>Priorizado automáticamente</small></div>
          {GROUP_ALERTS.map((alert) => (
            <div className={styles.alertRow} key={alert.concept}>
              <CircleDot size={16} />
              <div><strong>{alert.concept}</strong><p>{alert.text}</p></div>
              <span>{alert.tone}</span>
            </div>
          ))}
        </div>
        <div className={styles.capabilities}>
          <div className={styles.sectionTitle}><span>CAPA CORPORATIVA</span><small>Compartido, sin mezclar operaciones</small></div>
          <Capability icon={Building2} title="Consolidación" text="Comparativos por marca, turno y sucursal." />
          <Capability icon={Package} title="Compras e inventario" text="Catálogo común con costos y existencias separadas." />
          <Capability icon={Users} title="Permisos" text="Acceso de grupo, concepto o unidad." />
        </div>
      </section>
    </>
  )
}

function ConceptDashboard({ concept }: { concept: DiezMexConcept }) {
  const preopening = concept.status === 'Preapertura'
  return (
    <>
      <section className={styles.metrics} style={{ '--active': concept.accent } as React.CSSProperties}>
        <Metric label="Venta neta hoy" value={preopening ? '—' : mxn(concept.sales)} detail={preopening ? 'Sin operación productiva' : '+6.1% vs. semana anterior'} positive={!preopening} />
        <Metric label="Transacciones" value={preopening ? '—' : concept.tickets.toLocaleString('es-MX')} detail={preopening ? 'Se habilitan al abrir' : 'Órdenes cerradas'} />
        <Metric label="Ticket promedio" value={preopening ? '—' : mxn(concept.avgTicket)} detail={preopening ? 'Por configurar' : 'Neto por ticket'} />
        <Metric label="Food cost" value={preopening ? '—' : `${concept.foodCost}%`} detail={preopening ? 'Recetario pendiente' : 'Sobre venta neta'} />
      </section>

      <section className={styles.operationGrid}>
        <div className={styles.operationPanel}>
          <div className={styles.sectionTitle}><span>{preopening ? 'RUTA DE APERTURA' : 'OPERACIÓN DEL CONCEPTO'}</span><small>{concept.location}</small></div>
          <div className={styles.flowLine}>
            {(preopening ? ['Tenant', 'Menú', 'Equipo', 'Simulacro'] : ['POS', 'Producción', 'KDS', 'Cierre']).map((step, index) => (
              <div key={step} className={styles.flowStep}>
                <span style={{ borderColor: concept.accent, color: concept.accent }}>{index + 1}</span>
                <strong>{step}</strong>
                <small>{preopening ? ['Configurado', 'Pendiente', 'Pendiente', 'Pendiente'][index] : ['En línea', 'Operando', 'Sin demora', 'Conciliado'][index]}</small>
              </div>
            ))}
          </div>
          <div className={styles.conceptModules}>
            {concept.topItems.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className={styles.commandPanel}>
          <div className={styles.sectionTitle}><span>CONTROL DE TURNO</span><small>Vista demostrativa</small></div>
          <Capability icon={Receipt} title="Órdenes" text={preopening ? 'Flujo listo para pruebas.' : `${concept.tickets} tickets procesados hoy.`} />
          <Capability icon={ChefHat} title="Cocina" text={preopening ? 'Estaciones por definir.' : 'KDS conectado a producción.'} />
          <Capability icon={ShieldCheck} title="Continuidad" text="Cola local y operación sin WAN." />
          <button className={styles.enterButton} style={{ background: concept.accent }}>Abrir simulación de POS <ArrowUpRight size={17} /></button>
        </div>
      </section>
    </>
  )
}

function Metric({ label, value, detail, positive = false }: { label: string; value: string; detail: string; positive?: boolean }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small className={positive ? styles.positive : ''}>{detail}</small></div>
}

function Capability({ icon: Icon, title, text }: { icon: typeof Store; title: string; text: string }) {
  return <div className={styles.capability}><Icon size={18} /><div><strong>{title}</strong><p>{text}</p></div></div>
}


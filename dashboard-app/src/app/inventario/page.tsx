'use client'

import { Package, AlertTriangle, Clock, BarChart3 } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'

export default function InventarioPage() {
  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Inventario"
        subtitle="Control de inventario y punto de reorden"
      />

      {/* Coming soon KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Productos"
          value="--"
          subtitle="Proximamente"
          icon={Package}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Stock bajo"
          value="--"
          subtitle="Proximamente"
          icon={AlertTriangle}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Ultimo conteo"
          value="--"
          subtitle="Proximamente"
          icon={Clock}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Valor inventario"
          value="--"
          subtitle="Proximamente"
          icon={BarChart3}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Coming soon message */}
      <div className="bg-card rounded-xl border border-border p-12 card-shadow text-center">
        <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Package size={32} className="text-accent" />
        </div>
        <h2 className="text-xl font-bold text-text mb-2">
          Este modulo estara disponible proximamente
        </h2>
        <p className="text-text-soft text-sm max-w-lg mx-auto mb-8">
          Estamos trabajando en la integracion con el sistema de inventario de Wansoft.
          Pronto podras ver niveles de stock, puntos de reorden, y alertas automaticas
          de productos con inventario bajo.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="bg-surface rounded-xl p-4">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Package size={20} className="text-blue-600" />
            </div>
            <p className="text-sm font-semibold text-text mb-1">Control de stock</p>
            <p className="text-xs text-text-muted">
              Niveles actuales de todos los productos del menu
            </p>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <AlertTriangle size={20} className="text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-text mb-1">Punto de reorden</p>
            <p className="text-xs text-text-muted">
              Alertas automaticas cuando un producto esta por agotarse
            </p>
          </div>
          <div className="bg-surface rounded-xl p-4">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <BarChart3 size={20} className="text-emerald-600" />
            </div>
            <p className="text-sm font-semibold text-text mb-1">Reportes</p>
            <p className="text-xs text-text-muted">
              Historico de consumo y proyecciones de compra
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

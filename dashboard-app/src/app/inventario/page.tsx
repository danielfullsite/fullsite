'use client'

import { Package, AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'

const SAMPLE_ITEMS = [
  { nombre: 'Cafe de grano (kg)', existencia: 12, reorden: 5, status: 'ok' },
  { nombre: 'Leche entera (L)', existencia: 8, reorden: 10, status: 'bajo' },
  { nombre: 'Pan artesanal', existencia: 25, reorden: 15, status: 'ok' },
  { nombre: 'Aguacate (kg)', existencia: 3, reorden: 5, status: 'bajo' },
  { nombre: 'Huevo (pza)', existencia: 120, reorden: 60, status: 'ok' },
  { nombre: 'Queso panela (kg)', existencia: 4, reorden: 8, status: 'bajo' },
  { nombre: 'Tortilla de harina', existencia: 50, reorden: 30, status: 'ok' },
  { nombre: 'Salsa verde (L)', existencia: 6, reorden: 4, status: 'ok' },
]

export default function InventarioPage() {
  const itemsBajos = SAMPLE_ITEMS.filter(i => i.status === 'bajo').length

  return (
    <>
      <PageHeader
        eyebrow="AMALAY Coffee & Market"
        title="Inventario"
        subtitle="Control de inventario y punto de reorden"
      />

      <div className="grid grid-cols-2 gap-3 mb-6">
        <KPICard
          label="Modulo de inventario"
          value="Demo"
          subtitle="Datos de ejemplo"
          icon={Package}
          accentClass="kpi-accent-blue"
        />
        <KPICard
          label="Punto de reorden"
          value={`${itemsBajos} alertas`}
          subtitle="Productos bajo minimo"
          icon={AlertTriangle}
          accentClass="kpi-accent-amber"
        />
        <KPICard
          label="Existencias"
          value={`${SAMPLE_ITEMS.length} productos`}
          subtitle="Productos registrados"
          icon={BarChart3}
          accentClass="kpi-accent-green"
        />
        <KPICard
          label="Ultimo conteo"
          value="--"
          subtitle="Conectar datos"
          icon={RefreshCw}
          accentClass="kpi-accent-purple"
        />
      </div>

      {/* Connect banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <p className="text-sm text-blue-700 font-medium">
          Para activar el modulo de inventario completo, conecta tu cuenta de Wansoft
        </p>
        <p className="text-xs text-blue-600 mt-1">
          Los datos mostrados son de ejemplo. Una vez conectado, veras niveles de stock en tiempo real,
          alertas de punto de reorden y reportes de consumo historico.
        </p>
      </div>

      {/* Inventory table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Existencias actuales
        </h3>
        <p className="text-xs text-slate-400 mb-5">Datos de ejemplo</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Producto</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Existencia</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Punto de reorden</th>
                <th className="text-center py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_ITEMS.map((item) => (
                <tr key={item.nombre} className="hover:bg-slate-50/50 border-b border-slate-100">
                  <td className="py-3 px-3 text-slate-700 font-medium">{item.nombre}</td>
                  <td className="py-3 px-3 text-right text-slate-700 tabular-nums">{item.existencia}</td>
                  <td className="py-3 px-3 text-right text-slate-500 tabular-nums">{item.reorden}</td>
                  <td className="py-3 px-3 text-center">
                    {item.status === 'bajo' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                        <AlertTriangle size={12} />
                        Bajo
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Features preview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-center">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Package size={20} className="text-blue-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900 mb-1">Control de stock</p>
          <p className="text-xs text-slate-400">
            Niveles actuales de todos los productos del menu
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-center">
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900 mb-1">Punto de reorden</p>
          <p className="text-xs text-slate-400">
            Alertas automaticas cuando un producto esta por agotarse
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-center">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <BarChart3 size={20} className="text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900 mb-1">Reportes</p>
          <p className="text-xs text-slate-400">
            Historico de consumo y proyecciones de compra
          </p>
        </div>
      </div>
    </>
  )
}

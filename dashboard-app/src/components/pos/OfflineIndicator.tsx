'use client'

import { Wifi, WifiOff, RefreshCw, Cloud, CloudOff } from 'lucide-react'

interface OfflineIndicatorProps {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
  lastSyncTime: string | null
  connectedDevices: number
  onSync: () => void
}

export default function OfflineIndicator({
  isOnline,
  pendingCount,
  isSyncing,
  lastSyncTime,
  connectedDevices,
  onSync,
}: OfflineIndicatorProps) {
  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex items-center gap-2">
      {/* Connection status */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        isOnline
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-red-500/10 text-red-400 animate-pulse'
      }`}>
        {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>

      {/* Connected devices */}
      {connectedDevices > 1 && (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs bg-blue-500/10 text-blue-400">
          <Cloud size={14} />
          <span>{connectedDevices} dispositivos</span>
        </div>
      )}

      {/* Pending sync */}
      {pendingCount > 0 && (
        <button
          onClick={onSync}
          disabled={isSyncing || !isOnline}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          <span>{isSyncing ? 'Sincronizando...' : `${pendingCount} pendiente${pendingCount > 1 ? 's' : ''}`}</span>
        </button>
      )}

      {/* Offline mode indicator */}
      {!isOnline && (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs bg-[var(--line)] text-[var(--text-3)]">
          <CloudOff size={14} />
          <span>Modo offline activo</span>
        </div>
      )}

      {/* Last sync */}
      {lastSyncTime && isOnline && pendingCount === 0 && (
        <span className="text-xs text-[var(--text-3)]">
          Sync: {formatTime(lastSyncTime)}
        </span>
      )}
    </div>
  )
}

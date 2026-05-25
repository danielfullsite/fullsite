'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera } from 'lucide-react'

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const animFrameRef = useRef<number>(0)

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function startScanning() {
      // Check BarcodeDetector support
      if (!('BarcodeDetector' in window)) {
        setError('Tu navegador no soporta escaneo de códigos. Usa Chrome o Safari.')
        return
      }

      try {
        detectorRef.current = new BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
        })
      } catch {
        setError('Error inicializando detector de códigos.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setScanning(true)
          detectLoop()
        }
      } catch {
        setError('No se pudo acceder a la cámara. Verifica permisos.')
      }
    }

    function detectLoop() {
      if (cancelled || !videoRef.current || !detectorRef.current) return
      const video = videoRef.current
      if (video.readyState < video.HAVE_ENOUGH_DATA) {
        animFrameRef.current = requestAnimationFrame(detectLoop)
        return
      }

      detectorRef.current.detect(video).then((barcodes) => {
        if (cancelled) return
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue
          if (code) {
            onScan(code)
            stopCamera()
            return
          }
        }
        animFrameRef.current = requestAnimationFrame(detectLoop)
      }).catch(() => {
        if (!cancelled) animFrameRef.current = requestAnimationFrame(detectLoop)
      })
    }

    startScanning()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [onScan, stopCamera])

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/50 z-10">
        <div className="flex items-center gap-2 text-white">
          <Camera size={20} />
          <span className="font-bold">Escanear código de barras</span>
        </div>
        <button
          onClick={() => { stopCamera(); onClose() }}
          className="w-10 h-10 rounded-full bg-[var(--surface-2)] hover:bg-[var(--line)] flex items-center justify-center text-white"
        >
          <X size={20} />
        </button>
      </div>

      {/* Video feed */}
      {error ? (
        <div className="text-center px-6">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button onClick={onClose} className="px-6 py-3 bg-[var(--line)] rounded-xl text-white font-bold">
            Cerrar
          </button>
        </div>
      ) : (
        <div className="relative w-full max-w-md aspect-[4/3]">
          <video
            ref={videoRef}
            className="w-full h-full object-cover rounded-2xl"
            playsInline
            muted
          />
          {/* Scan overlay */}
          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[70%] h-[40%] border-2 border-emerald-400 rounded-xl relative">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
                {/* Animated scan line */}
                <div className="absolute left-2 right-2 h-0.5 bg-emerald-400 animate-pulse top-1/2" />
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[var(--text-3)] text-sm mt-4 text-center px-6">
        Apunta al código de barras del producto Market
      </p>
    </div>
  )
}

// Type declarations for BarcodeDetector (not yet in TS stdlib)
declare global {
  interface BarcodeDetector {
    detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<{ rawValue: string; format: string }[]>
  }
  // eslint-disable-next-line no-var
  var BarcodeDetector: {
    new(options?: { formats?: string[] }): BarcodeDetector
    prototype: BarcodeDetector
  }
}

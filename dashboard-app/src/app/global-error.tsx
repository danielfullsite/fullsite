'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body>
        <main
          style={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'system-ui, sans-serif',
            gap: '16px',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '24px', margin: 0 }}>Algo salio mal</h1>
          <p style={{ color: '#667085', margin: 0 }}>
            No pudimos cargar esta pantalla. Intenta nuevamente.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#00c781',
              border: 0,
              borderRadius: '6px',
              color: '#07111f',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 700,
              padding: '12px 20px',
            }}
            type="button"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  )
}

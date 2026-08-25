import type { Metadata, Viewport } from 'next'
import { Public_Sans, IBM_Plex_Mono, Schibsted_Grotesk } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import AppShell from '@/components/AppShell'
import PosthogInit from '@/components/PosthogInit'
import SupabasePatch from '@/components/SupabasePatch'
import InstallPrompt from '@/components/InstallPrompt'

// DS v3 «Servicio». Public Sans para la interfaz, IBM Plex Mono para lo que se
// cuenta: relojes del KDS, folios y SKUs.
//
// Ojo con la historia: aquí se declaraba Inter y `--font-inter` NO se
// referenciaba en ningún lado — `--font-sans` en globals.css apuntaba a
// Arial. O sea que la app descargaba una webfont que jamás usaba y renderizaba
// con la tipografía del sistema. Al arreglarlo hay que apuntar la variable de
// verdad (ver globals.css), o esto se repite.
//
// Medido antes de cambiar, con cadenas reales del POS: Public Sans es 8.8–12.3%
// MÁS ANGOSTA que Arial, así que el riesgo de desbordar una tarjeta de mesa o un
// ticket baja, no sube. Inter habría sido 1.5–7% más ancha.
const sans = Public_Sans({
  variable: '--font-public-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

// Tipografía de display: títulos y cifras grandes.
//
// Se cargaba inyectando un <link> desde lib/ds-pilot.ts, porque el rediseño era
// un piloto de UN tenant y no tenía sentido que los ocho descargaran una fuente
// que usaba uno. Ahora aplica a todos, así que next/font es lo correcto: la
// autohospeda, la precarga y evita el salto de texto.
//
// Sólo los pesos 400 y 500: el sistema vive en peso 400 y traer 600/700 sería
// peso muerto para un título que nunca los usa.
const display = Schibsted_Grotesk({
  variable: '--font-schibsted',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Fullsite POS',
  description: 'Fullsite — Restaurant Operating System',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon-192v2.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512v2.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Dark by default. Only set light if user chose it. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){document.documentElement.classList.add('capacitor')}}catch(e){}})();` }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0a0b" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" />
        {/* iOS PWA — feel like native app */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Fullsite" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* iOS splash screens — prevents white flash on launch */}
        <meta name="apple-mobile-web-app-orientations" content="portrait" />
        <link rel="apple-touch-startup-image" href="/apple-touch-icon.png" />
        {/* Disable iOS quirks */}
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text-1)]">
        <PosthogInit />
        <SupabasePatch />
        <AuthProvider>
          <AppShell>{children}</AppShell>
          <InstallPrompt />
        </AuthProvider>
      </body>
    </html>
  )
}

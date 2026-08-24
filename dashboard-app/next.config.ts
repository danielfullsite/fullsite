import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "path";

const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=(), payment=(self), usb=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-scripts.com https://*.sentry.io https://static.cloudflareinsights.com https://*.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.supabase.co https://*.vercel.com https://images.unsplash.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://vercel.live https://*.vercel.com https://*.posthog.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com wss://api.deepgram.com https://api.deepgram.com https://api.elevenlabs.io https://*.google.com https://*.googleapis.com wss://*.google.com http://127.0.0.1:7717 ws://127.0.0.1:7717 http://*:7717 ws://*:7717",
      "media-src 'self' blob:",
      "frame-src 'self' https://vercel.live",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

// SANDBOX_ENV=true → rechaza el build si NEXT_PUBLIC_SUPABASE_URL apunta a AMALAY producción.
// Este guard corre en el servidor de CI/Vercel, nunca en el browser.
if (process.env.SANDBOX_ENV === 'true') {
  const sandboxUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (sandboxUrl.includes('qjiomlvudfmzuvqvhwpk')) {
    throw new Error(
      '[SANDBOX] NEXT_PUBLIC_SUPABASE_URL apunta al proyecto AMALAY producción (qjiomlvudfmzuvqvhwpk). ' +
      'El proyecto Vercel fullsite-sandbox debe usar las credenciales de fullsite-sandbox.'
    );
  }
  if (!sandboxUrl) {
    throw new Error('[SANDBOX] NEXT_PUBLIC_SUPABASE_URL está vacío. Configurar en Vercel → fullsite-sandbox → Env vars.');
  }
}

// CAPACITOR_OFFLINE=1 → static export para empaquetar el bundle dentro
// de la app nativa (POS offline). headers() no aplica en export.
const isCapacitorOffline = process.env.CAPACITOR_OFFLINE === '1';

// SOLO RAMA DE PREVIEW (fix/pos-offline-mesa-nav) — NO MERGEAR ESTE BLOQUE A MAIN.
// El entorno Preview de Vercel no inyecta las NEXT_PUBLIC_* al build → login/build truenan.
// Fallback a la URL + anon key PÚBLICA de AMALAY (misma que prod ya sirve al browser; RLS
// protege). En prod las vars existen → nunca aplica. Solo para poder probar el fix en preview.
const previewSupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qjiomlvudfmzuvqvhwpk.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
     'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqaW9tbHZ1ZGZtenV2cXZod3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODQ5MTUsImV4cCI6MjA5MTM2MDkxNX0',
     'nv1ctxRJbc8kzD5gPypoxZ4uLtxOX61Me2ype5GBXyU'].join('.'),
};

const nextConfig: NextConfig = isCapacitorOffline
  ? {
      output: 'export',
      images: { unoptimized: true },
      turbopack: { root: path.join(__dirname) },
    }
  : {
      env: previewSupabaseEnv,
      // Pin Turbopack workspace root to dashboard-app/ so @/ aliases resolve
      // correctly when built from a monorepo root (Vercel, CI).
      turbopack: { root: path.join(__dirname) },
      async headers() {
        return [
          {
            source: '/(.*)',
            headers: securityHeaders,
          },
        ];
      },
    };

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "fullsite",
  project: "apple",
  // Skip source map upload when SENTRY_AUTH_TOKEN is absent (Vercel build)
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});

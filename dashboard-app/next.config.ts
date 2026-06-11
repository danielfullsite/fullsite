import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://vercel.live https://*.vercel.com https://*.posthog.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com wss://api.deepgram.com https://api.deepgram.com https://api.elevenlabs.io https://*.google.com https://*.googleapis.com wss://*.google.com",
      "media-src 'self' blob:",
      "frame-src 'self' https://vercel.live",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

// CAPACITOR_OFFLINE=1 → static export para empaquetar el bundle dentro
// de la app nativa (POS offline). headers() no aplica en export.
const isCapacitorOffline = process.env.CAPACITOR_OFFLINE === '1';

const nextConfig: NextConfig = isCapacitorOffline
  ? {
      output: 'export',
      images: { unoptimized: true },
    }
  : {
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
});

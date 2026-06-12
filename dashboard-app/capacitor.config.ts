import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.fullsite.app',
  appName: 'Fullsite',
  webDir: 'out',
  // CAPACITOR_OFFLINE=1 → bundle local empaquetado (POS offline-first).
  // Sin la variable → carga remota desde app.fullsite.mx (siempre actualizada).
  ...(process.env.CAPACITOR_OFFLINE === '1'
    ? {}
    : {
        server: {
          url: 'https://app.fullsite.mx',
          cleartext: false,
        },
      }),
  ios: {
    // 'never': el CSS maneja safe-areas con env(); 'automatic' duplicaba el inset top en páginas con scroll
    contentInset: 'never',
    backgroundColor: '#0a0a0b',
    preferredContentMode: 'mobile',
    scheme: 'Fullsite',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0b',
      showSpinner: false,
      launchAutoHide: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0b',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;

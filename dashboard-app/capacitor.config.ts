import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.fullsite.app',
  appName: 'Fullsite',
  webDir: 'out',
  server: {
    // In production, load from the deployed URL (hybrid approach)
    // This way the app always gets the latest version without App Store update
    url: 'https://app.fullsite.mx',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
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

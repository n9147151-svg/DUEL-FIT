import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.duelfit.app',
  appName: 'DUEL FIT',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;

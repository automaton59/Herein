import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.herein.mobile',
  appName: 'Herein',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#130d14',
  },
};

export default config;

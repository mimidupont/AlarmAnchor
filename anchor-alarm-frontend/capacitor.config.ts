import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourcompany.anchoralarm',
  appName: 'Anchor Alarm',
  webDir: 'build',
  server: {
    cleartext: true,
    androidScheme: 'http'
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_alarm',
      iconColor: '#ff4444',
      sound: 'alarm.mp3'
    }
  }
};

export default config;
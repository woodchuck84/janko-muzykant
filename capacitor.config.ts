import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jankomuzykant.app',
  appName: 'Janko Muzykant',
  webDir: 'dist-android',
  android: { allowMixedContent: false },
}
export default config

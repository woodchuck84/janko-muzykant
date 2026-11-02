import { Capacitor, registerPlugin } from '@capacitor/core'

export const ROOT_ID = '1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ'
export interface Account { id: string; email: string; lastVerified: number; anonymous?: boolean }
export interface Entry { id: string; name: string; mimeType: string; modifiedTime?: string; size?: number }
export interface LocalFile { path: string; url: string }
export interface NativeDrive {
  initialize(): Promise<{ account: Account | null; apiKeyConfigured?: boolean }>
  connect(): Promise<{ account: Account }>
  verify(): Promise<{ account: Account }>
  signOut(): Promise<void>
  useAnonymous(): Promise<{ account: Account }>
  list(options: { folderId: string }): Promise<{ files: Entry[] }>
  download(options: { id: string; name: string; mime: string }): Promise<LocalFile>
  readText(options: { path: string }): Promise<{ text: string }>
  readState(): Promise<{ state: string | null }>
  writeState(options: { state: string }): Promise<void>
  importXml(): Promise<Entry & LocalFile & { text?: string }>
  saveGenerated(options: { base64: string; name: string }): Promise<LocalFile>
  requestMicrophone(): Promise<{ granted: boolean }>
}
export const isStandaloneWeb = import.meta.env.VITE_JANKO_PLATFORM === 'web-standalone'
export const Drive = registerPlugin<NativeDrive>('ChoirDrive', isStandaloneWeb ? {
  web: async () => { const { BrowserDrive } = await import('../web-standalone/drive'); return new BrowserDrive() },
} : undefined)
export const fileUrl = (file: LocalFile) => isStandaloneWeb ? file.url || file.path : Capacitor.convertFileSrc(file.url || file.path)

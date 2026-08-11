import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tiboWatch', {
  platform: process.platform,
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  setSourceEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('source:set-enabled', enabled),
  refresh: () => ipcRenderer.invoke('source:refresh'),
  setDeepSeekKey: (secret: string) =>
    ipcRenderer.invoke('deepseek:set-key', secret),
  deepSeekHint: () => ipcRenderer.invoke('deepseek:hint'),
  testDeepSeek: () => ipcRenderer.invoke('deepseek:test'),
})

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('tiboWatch', {
  platform: process.platform,
})

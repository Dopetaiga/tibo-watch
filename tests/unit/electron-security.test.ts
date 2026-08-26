import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron security baseline', () => {
  it('keeps the renderer sandboxed and denies permissions and navigation', () => {
    const source = readFileSync('app/main/index.ts', 'utf8')
    expect(source).toContain('sandbox: true')
    expect(source).toContain('contextIsolation: true')
    expect(source).toContain('nodeIntegration: false')
    expect(source).toContain('setPermissionRequestHandler')
    expect(source).toContain('callback(false)')
    expect(source).toContain("webContents.on('will-navigate'")
  })

  it('quits immediately when the single-instance lock is unavailable', () => {
    const source = readFileSync('app/main/index.ts', 'utf8')
    expect(source).toMatch(
      /if \(!hasSingleInstanceLock\) \{[\s\S]*?app\.quit\(\)[\s\S]*?return/,
    )
  })
  it('uses a strict CSP without inline script or evaluation', () => {
    const html = readFileSync('app/renderer/index.html', 'utf8')
    expect(html).toContain("object-src 'none'")
    expect(html).toContain("base-uri 'none'")
    expect(html).toContain("frame-src 'none'")
    expect(html).not.toContain("'unsafe-inline'")
    expect(html).not.toContain("'unsafe-eval'")
  })

  it('exposes no credential or filesystem capability through preload', () => {
    const preload = readFileSync('app/preload/index.cts', 'utf8')
    expect(preload).not.toMatch(
      /readFile|writeFile|getDeepSeekKey|getCredential/i,
    )
    expect(preload).toContain("ipcRenderer.invoke('deepseek:set-key', secret)")
    expect(preload).toContain("ipcRenderer.invoke('deepseek:hint')")
    expect(preload).toContain('platform: process.platform')
  })
})

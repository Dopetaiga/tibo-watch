import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateInstaller } from '../../domain/update.js'

export class WindowsUpdateInstaller implements UpdateInstaller {
  constructor(
    readonly temporaryRoot: string,
    readonly launch: (executablePath: string) => Promise<string>,
  ) {}

  async stageAndLaunch(name: string, bytes: Uint8Array): Promise<void> {
    if (path.basename(name) !== name || !name.toLowerCase().endsWith('.exe'))
      throw new Error('更新文件名不安全')
    const directory = await mkdtemp(
      path.join(path.resolve(this.temporaryRoot), 'tibo-watch-update-'),
    )
    const executablePath = path.join(directory, name)
    await writeFile(executablePath, bytes, { flag: 'wx', mode: 0o700 })
    const launchError = await this.launch(executablePath)
    if (launchError) throw new Error(`无法启动更新安装器：${launchError}`)
  }
}

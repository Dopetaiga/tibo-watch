import { rm } from 'node:fs/promises'
import path from 'node:path'

const target = path.resolve('dist-electron')
const expected = path.join(path.resolve('.'), 'dist-electron')
if (target !== expected) throw new Error(`拒绝清理意外路径：${target}`)
await rm(target, { recursive: true, force: true })

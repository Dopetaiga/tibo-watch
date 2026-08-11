import { cp, copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPackage } from '@electron/asar'

const applicationRoot = await mkdtemp(
  path.join(os.tmpdir(), 'tibo-watch-asar-app-'),
)
const outputRoot = await mkdtemp(
  path.join(os.tmpdir(), 'tibo-watch-asar-output-'),
)
const temporaryAsar = path.join(outputRoot, 'app.asar')
const targetAsar = path.resolve(
  'release',
  'win-unpacked',
  'resources',
  'app.asar',
)
try {
  await cp('dist', path.join(applicationRoot, 'dist'), { recursive: true })
  await cp('dist-electron', path.join(applicationRoot, 'dist-electron'), {
    recursive: true,
  })
  await copyFile('package.json', path.join(applicationRoot, 'package.json'))
  await createPackage(applicationRoot, temporaryAsar)
  await copyFile(temporaryAsar, targetAsar)
  console.log(`本地 ASAR 已更新：${targetAsar}`)
} finally {
  await rm(applicationRoot, { recursive: true, force: true })
  await rm(outputRoot, { recursive: true, force: true })
}

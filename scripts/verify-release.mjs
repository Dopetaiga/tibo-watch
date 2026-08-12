import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listPackage, extractFile, statFile } from '@electron/asar'

const releaseRoot = path.resolve('release')
const asarPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app.asar')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`package.json 版本无效：${version}`)
const artifacts = [path.join(releaseRoot, `Tibo Watch Setup ${version}.exe`)]
const forbiddenPaths = [/(^|\/)research(\/|$)/i]
const forbiddenText = ['codexreset.org']

for (const required of [asarPath, ...artifacts]) {
  if (!existsSync(required)) throw new Error(`发布产物不存在：${required}`)
}

const packagedFiles = listPackage(asarPath)
for (const packagedPath of packagedFiles) {
  const normalized = packagedPath.replaceAll('\\', '/')
  if (forbiddenPaths.some((pattern) => pattern.test(normalized)))
    throw new Error(`ASAR 包含研究路径：${packagedPath}`)
  const archivePath = packagedPath.replace(/^[/\\]/, '')
  if ('files' in statFile(asarPath, archivePath)) continue
  const content = extractFile(asarPath, archivePath)
  assertNoForbiddenText(content, `app.asar:${packagedPath}`)
}

for (const file of await filesUnder(
  path.join(releaseRoot, 'win-unpacked', 'resources'),
)) {
  const relative = path.relative(releaseRoot, file).replaceAll('\\', '/')
  if (forbiddenPaths.some((pattern) => pattern.test(relative)))
    throw new Error(`resources 包含研究路径：${relative}`)
  if (!file.endsWith('.asar'))
    assertNoForbiddenText(await readFile(file), relative)
}

const checksums = []
for (const artifact of artifacts) {
  const bytes = await readFile(artifact)
  assertNoForbiddenText(bytes, path.basename(artifact))
  checksums.push(
    `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(artifact)}`,
  )
}
await writeFile(
  path.join(releaseRoot, 'SHA256SUMS.txt'),
  `${checksums.join('\n')}\n`,
  'utf8',
)

const mainSource = await readFile('app/main/index.ts', 'utf8')
for (const expected of [
  'sandbox: true',
  'contextIsolation: true',
  'nodeIntegration: false',
]) {
  if (!mainSource.includes(expected))
    throw new Error(`Electron 安全配置缺失：${expected}`)
}
const html = await readFile('app/renderer/index.html', 'utf8')
const policy =
  html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
]) {
  if (!policy.includes(directive)) throw new Error(`CSP 缺少：${directive}`)
}
if (policy.includes("'unsafe-eval'") || policy.includes("'unsafe-inline'"))
  throw new Error('CSP 不得允许 unsafe-eval 或 unsafe-inline')

console.log(`发布验证通过：${packagedFiles.length} 个 ASAR 条目，1 个 SHA-256`)

async function filesUnder(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(target)))
    else files.push(target)
  }
  return files
}

function assertNoForbiddenText(content, location) {
  const utf8 = content.toString('utf8').toLowerCase()
  const utf16 = content.toString('utf16le').toLowerCase()
  const match = forbiddenText.find(
    (candidate) => utf8.includes(candidate) || utf16.includes(candidate),
  )
  if (match) throw new Error(`发布产物 ${location} 包含禁用字符串：${match}`)
}

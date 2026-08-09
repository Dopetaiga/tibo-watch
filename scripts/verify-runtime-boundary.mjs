import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const outputRoots = ['dist', 'dist-electron']
const forbidden = ['research/', 'research\\', 'codexreset.org']

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(target)))
    else files.push(target)
  }
  return files
}

for (const root of outputRoots) {
  for (const file of await filesUnder(root)) {
    const relative = path.relative(process.cwd(), file)
    const content = await readFile(file)
    const searchable = `${relative}\n${content.toString('utf8')}`.toLowerCase()
    const match = forbidden.find((value) => searchable.includes(value))
    if (match) throw new Error(`运行时边界检查失败：${relative} 包含 ${match}`)
  }
}

console.log('运行时边界检查通过')

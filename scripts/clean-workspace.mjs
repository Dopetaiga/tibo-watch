import { rm } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const generated = ['.pack-staging', 'dist', 'dist-electron', 'test-results']
if (process.argv.includes('--release')) generated.push('release')

for (const relative of generated) {
  const target = path.resolve(projectRoot, relative)
  const parent = path.dirname(target)
  if (parent !== projectRoot)
    throw new Error(`Refusing to clean outside the project root: ${target}`)
  await rm(target, { recursive: true, force: true })
  console.log(`Cleaned ${relative}`)
}

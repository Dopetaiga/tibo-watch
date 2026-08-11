import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32')
  throw new Error('Windows Authenticode 验证只能在 Windows 上执行')

const targets = [
  path.resolve('release/win-unpacked/Tibo Watch.exe'),
  path.resolve('release/Tibo Watch Setup 0.1.0.exe'),
  path.resolve('release/Tibo Watch-0.1.0-portable.exe'),
]

for (const target of targets) {
  if (!existsSync(target)) throw new Error(`签名验证目标不存在：${target}`)
}

const command = [
  '$ErrorActionPreference = "Stop"',
  `$paths = @(${targets.map(powerShellLiteral).join(',')})`,
  '$paths | ForEach-Object {',
  '  $signature = Get-AuthenticodeSignature -LiteralPath $_',
  '  [pscustomobject]@{',
  '    Path = $_',
  '    Status = [string]$signature.Status',
  '    Subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }',
  '    Thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }',
  '  }',
  '} | ConvertTo-Json -Compress',
].join('\n')

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', command],
  { encoding: 'utf8', windowsHide: true },
)
if (result.status !== 0)
  throw new Error(result.stderr.trim() || '无法读取 Windows Authenticode 签名')

const parsed = JSON.parse(result.stdout)
const signatures = Array.isArray(parsed) ? parsed : [parsed]
const invalid = signatures.filter(({ Status }) => Status !== 'Valid')
if (invalid.length > 0) {
  const details = invalid
    .map(({ Path: file, Status }) => `${path.basename(file)}: ${Status}`)
    .join('\n')
  throw new Error(
    `Windows 发布产物未通过 Authenticode 验证：\n${details}\n请使用组织信任的代码签名证书重新构建；不要绕过 Code Integrity 策略。`,
  )
}

for (const signature of signatures) {
  console.log(
    `${path.basename(signature.Path)}: Valid; ${signature.Subject}; ${signature.Thumbprint}`,
  )
}

function powerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

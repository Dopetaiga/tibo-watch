import { spawn } from 'node:child_process'
import type { CredentialStore } from './types.js'
import { irreversibleSecretHint } from './types.js'

const powershellScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TiboCredentialNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
'@
$inputObject = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = "TiboWatch/$($inputObject.service)/$($inputObject.account)"
if ($inputObject.operation -eq 'set') {
  $secretPointer = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni([string]$inputObject.secret)
  try {
    $credential = New-Object TiboCredentialNative+CREDENTIAL
    $credential.Type = 1; $credential.TargetName = $target; $credential.UserName = [string]$inputObject.account
    $credential.Persist = 2; $credential.CredentialBlob = $secretPointer
    $credential.CredentialBlobSize = [Text.Encoding]::Unicode.GetByteCount([string]$inputObject.secret)
    if (-not [TiboCredentialNative]::CredWrite([ref]$credential, 0)) { throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($secretPointer) }
  [Console]::Write('ok')
} elseif ($inputObject.operation -eq 'get') {
  $pointer = [IntPtr]::Zero
  if (-not [TiboCredentialNative]::CredRead($target, 1, 0, [ref]$pointer)) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { [Console]::Write('null'); exit 0 }
    throw "CredRead failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][TiboCredentialNative+CREDENTIAL])
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
    [Console]::Write(($secret | ConvertTo-Json -Compress))
  } finally { [TiboCredentialNative]::CredFree($pointer) }
} elseif ($inputObject.operation -eq 'delete') {
  if (-not [TiboCredentialNative]::CredDelete($target, 1, 0)) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw "CredDelete failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  }
  [Console]::Write('ok')
} else { throw 'Unknown operation' }
`

export class WindowsCredentialManager implements CredentialStore {
  async set(service: string, account: string, secret: string): Promise<void> {
    if (process.platform !== 'win32')
      throw new Error('Windows Credential Manager 仅支持 Windows')
    await invoke({ operation: 'set', service, account, secret })
  }

  async get(service: string, account: string): Promise<string | null> {
    if (process.platform !== 'win32')
      throw new Error('Windows Credential Manager 仅支持 Windows')
    const output = await invoke({ operation: 'get', service, account })
    return output === 'null' ? null : (JSON.parse(output) as string)
  }

  async delete(service: string, account: string): Promise<void> {
    if (process.platform !== 'win32')
      throw new Error('Windows Credential Manager 仅支持 Windows')
    await invoke({ operation: 'delete', service, account })
  }

  async hint(service: string, account: string): Promise<string | null> {
    const value = await this.get(service, account)
    return value ? irreversibleSecretHint(value) : null
  }
}

function invoke(input: Record<string, string>): Promise<string> {
  const encoded = Buffer.from(powershellScript, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else
        reject(
          new Error(
            `Windows Credential Manager 操作失败（code=${code}）：${stderr.trim()}`,
          ),
        )
    })
    child.stdin.end(JSON.stringify(input), 'utf8')
  })
}

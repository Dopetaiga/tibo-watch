[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent

$running = @(Get-Process -Name 'Tibo Watch' -ErrorAction SilentlyContinue)
$running += @(
  Get-Process -Name 'electron' -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "$projectRoot*"
  }
)
if ($running) {
  Write-Host 'Tibo Watch is still running. Close it and run this reset again.' -ForegroundColor Yellow
  exit 2
}

if ($Check) {
  Write-Host 'Tibo Watch reset script check passed.'
  exit 0
}

if (-not $Force) {
  Write-Host 'This removes all Tibo Watch settings, history, cache, and saved credentials.' -ForegroundColor Yellow
  Write-Host 'Codex chats, Codex login, and the managed Codex CLI will be kept.'
  $answer = Read-Host 'Type RESET to continue'
  if ($answer -cne 'RESET') {
    Write-Host 'Reset cancelled.'
    exit 0
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class TiboWatchCredentialReset {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredEnumerate(string filter, UInt32 flags, out UInt32 count, out IntPtr credentials);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr buffer);

  public static int DeleteAll() {
    UInt32 count;
    IntPtr pointer;
    if (!CredEnumerate("TiboWatch/*", 0, out count, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return 0;
      throw new System.ComponentModel.Win32Exception(error);
    }
    int deleted = 0;
    try {
      for (int index = 0; index < count; index++) {
        IntPtr credentialPointer = Marshal.ReadIntPtr(pointer, index * IntPtr.Size);
        CREDENTIAL credential = Marshal.PtrToStructure<CREDENTIAL>(credentialPointer);
        if (CredDelete(credential.TargetName, credential.Type, 0)) deleted++;
      }
    } finally {
      CredFree(pointer);
    }
    return deleted;
  }
}
'@

$targets = @(
  (Join-Path $env:APPDATA 'tibo-watch'),
  (Join-Path $env:APPDATA 'Tibo Watch'),
  (Join-Path $env:LOCALAPPDATA 'tibo-watch-updater'),
  (Join-Path $projectRoot 'Tibo Watch Data')
)

foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Host "Removed: $target"
  }
}

$credentialCount = [TiboWatchCredentialReset]::DeleteAll()
Write-Host "Removed credentials: $credentialCount"
Write-Host 'Tibo Watch local state has been reset.' -ForegroundColor Green

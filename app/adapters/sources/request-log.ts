export interface RequestLogEntry {
  timestamp: string
  targetCategory: string
  status: number | 'timeout' | 'offline' | 'error'
  durationMs: number
  resultCount: number
}

export type RequestLogSink = (line: string) => Promise<void>

export async function writeRequestLog(
  sink: RequestLogSink,
  entry: RequestLogEntry,
): Promise<void> {
  await sink(`${JSON.stringify(entry)}\n`)
}

export function redactedTargetCategory(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}/[redacted-path]`
}

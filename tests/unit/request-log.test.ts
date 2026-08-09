import { describe, expect, it } from 'vitest'
import {
  redactedTargetCategory,
  writeRequestLog,
} from '../../app/adapters/sources/request-log'

describe('request logging', () => {
  it('never includes paths, query secrets, or headers', async () => {
    const target = redactedTargetCategory(
      'https://hooks.example.com/private/path?token=secret',
    )
    const lines: string[] = []
    await writeRequestLog(
      async (line) => {
        lines.push(line)
      },
      {
        timestamp: '2026-08-09T00:00:00Z',
        targetCategory: target,
        status: 200,
        durationMs: 12,
        resultCount: 1,
      },
    )
    expect(lines[0]).not.toContain('secret')
    expect(lines[0]).not.toContain('private/path')
    expect(lines[0]).toContain('/[redacted-path]')
  })
})

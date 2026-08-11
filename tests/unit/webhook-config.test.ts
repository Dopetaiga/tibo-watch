import { describe, expect, it } from 'vitest'
import { validateWebhook } from '../../app/main/runtime-controller'

describe('webhook configuration boundary', () => {
  it('requires HTTPS and pins Feishu hostnames', () => {
    expect(() =>
      validateWebhook('http', 'http://example.com/hook', {}),
    ).toThrow('HTTPS')
    expect(() =>
      validateWebhook('feishu', 'https://example.com/hook', {}),
    ).toThrow('飞书')
    expect(() =>
      validateWebhook(
        'feishu',
        'https://open.feishu.cn/open-apis/bot/v2/hook/redacted',
        {},
      ),
    ).not.toThrow()
  })

  it('rejects host and content-length header overrides', () => {
    expect(() =>
      validateWebhook('http', 'https://example.com/hook', {
        Host: 'attacker.example',
      }),
    ).toThrow('不允许')
  })
})

import { FxTwitterAdapter, type FxTwitterOptions } from './fx-twitter.js'

export interface CustomEndpointOptions extends Omit<
  FxTwitterOptions,
  'baseUrl'
> {
  baseUrl: string
}

export class CustomEndpointAdapter extends FxTwitterAdapter {
  override readonly id = 'custom-compatible-endpoint'

  constructor(options: CustomEndpointOptions) {
    const url = new URL(options.baseUrl)
    if (
      url.protocol !== 'https:' &&
      url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost'
    ) {
      throw new Error('自定义端点必须使用 HTTPS；仅本机测试允许 HTTP')
    }
    super(options)
  }
}

import { useState } from 'react'
import type {
  AiProtocol,
  AiProviderConfig,
} from '../../../adapters/ai/multi-protocol'
import { DEEPSEEK_PROVIDER_PRESET } from '../../../adapters/ai/multi-protocol'
import type { CodexThreadSummary } from '../../../adapters/codex/app-server'
import type { SelfTestResult } from '../../../domain/self-test'
import type { DashboardModel } from '../../../domain/dashboard'
import {
  Field,
  PageHeader,
  SettingSection,
  Toggle,
} from '../components/ui'
import {
  aiEndpointPreview,
  eventTypeLabel,
  formatBytes,
  legacyCodexSettingsVisible,
  showError,
} from '../lib/labels'
import {
  notificationEvents,
  type DashboardControls,
  type NotificationPolicy,
} from '../controls'

export function SettingsPage({
  model,
  controls,
}: {
  model: DashboardModel
  controls?: DashboardControls
}) {
  const sourceEnabled = model.dataStatus !== 'disabled'
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'ai' | 'notifications' | 'data' | 'developer'
  >('general')
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [aiProtocol, setAiProtocol] = useState<AiProtocol>('openai-chat')
  const [aiService, setAiService] = useState<'deepseek' | 'custom'>('deepseek')
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.deepseek.com')
  const [aiModel, setAiModel] = useState('deepseek-v4-flash')
  const [aiHeaders, setAiHeaders] = useState('')
  const [channel, setChannel] = useState<'feishu' | 'http'>('feishu')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null)
  const [storage, setStorage] = useState<{
    bytes: number
    records: Record<string, number>
  } | null>(null)
  const [running, setRunning] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [codexThreads, setCodexThreads] = useState<CodexThreadSummary[]>([])
  const [authorizedThreads, setAuthorizedThreads] = useState<string[]>([])
  const [codexEnabled, setCodexEnabled] = useState(false)
  const [lowerBudget, setLowerBudget] = useState(40)
  const [upperBudget, setUpperBudget] = useState(80)
  const [codexBusy, setCodexBusy] = useState(false)
  const [notificationPolicy, setNotificationPolicyState] =
    useState<NotificationPolicy>(
      () =>
        Object.fromEntries(
          notificationEvents.map((eventType) => [
            eventType,
            ['windows', 'feishu', 'http'],
          ]),
        ) as NotificationPolicy,
    )
  const readAiConfig = (): AiProviderConfig => ({
    protocol:
      aiService === 'deepseek' ? DEEPSEEK_PROVIDER_PRESET.protocol : aiProtocol,
    baseUrl:
      aiService === 'deepseek' ? DEEPSEEK_PROVIDER_PRESET.baseUrl : aiBaseUrl,
    model: aiModel,
    apiKey: key,
    headers: aiHeaders.trim()
      ? (JSON.parse(aiHeaders) as Record<string, string>)
      : {},
  })
  const saveAiProvider = () => {
    if (!controls) return
    try {
      const config = readAiConfig()
      void controls
        .setAiProvider(config)
        .then(() => {
          setKey('')
          setAiHeaders('')
          setAiSaved(true)
          setMessage('AI Provider 已安全保存；可重启并用最近信息初始化监控')
        })
        .catch((error) => {
          showError(setMessage)(error)
        })
    } catch {
      setMessage('自定义请求头必须是有效 JSON 对象')
    }
  }
  return (
    <>
      <PageHeader eyebrow="PREFERENCES" title="设置" />
      <section className="settings-layout">
        <nav className="settings-tabs" aria-label="设置分类">
          {(
            [
              ['general', '通用'],
              ['ai', 'AI 判断'],
              ['notifications', '通知'],
              ['data', '数据与隐私'],
              ['developer', '开发者'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={settingsTab === id ? 'active' : ''}
              onClick={() => setSettingsTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-pane" hidden={settingsTab !== 'general'}>
            <SettingSection
              id="source"
              title="监控"
              description="控制公开时间线的更新。"
            >
              <Toggle
                label="启用数据源请求"
                checked={sourceEnabled}
                onChange={(enabled) =>
                  void controls
                    ?.setSourceEnabled(enabled)
                    .catch(showError(setMessage))
                }
              />
              <button
                className="secondary"
                disabled={!controls || !sourceEnabled}
                onClick={() =>
                  void controls
                    ?.refresh()
                    .then(() => setMessage('检查完成'))
                    .catch(showError(setMessage))
                }
              >
                立即检查
              </button>
              <button
                className="secondary"
                disabled={!controls}
                onClick={() =>
                  void controls
                    ?.retryHistoryBackfill()
                    .then(({ pagesFetched, postsStored }) =>
                      setMessage(
                        `FxAPI 历史回填完成：${pagesFetched} 页，新增 ${postsStored} 条消息`,
                      ),
                    )
                    .catch(showError(setMessage))
                }
              >
                重试 FxAPI 历史回填
              </button>
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'developer'}>
            <SettingSection
              id="custom-source"
              title="自定义数据源"
              description="接入兼容的时间线数据服务。"
            >
              <Field label="服务地址" hint="留空恢复内置数据源。">
                <input
                  value={customEndpoint}
                  onChange={(event) => setCustomEndpoint(event.target.value)}
                  placeholder="https://example.com"
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.sourceConfiguration()
                        .then(({ customEndpoint: value }) => {
                          setCustomEndpoint(value ?? '')
                          setMessage(
                            value ? '已读取自定义数据源' : '当前使用内置数据源',
                          )
                        })
                        .catch(showError(setMessage))
                    }
                  >
                    读取
                  </button>
                  <button
                    className="primary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.setCustomSourceEndpoint(customEndpoint.trim() || null)
                        .then(() =>
                          setMessage(
                            customEndpoint.trim()
                              ? '自定义数据源已保存'
                              : '已恢复内置数据源',
                          ),
                        )
                        .catch(showError(setMessage))
                    }
                  >
                    保存
                  </button>
                </div>
              </Field>
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'developer'}>
            <SettingSection
              id="diagnostics"
              title="基础自检"
              description="使用本地人工复核数据提炼的小样本验证规则链，不联网、不调用 AI、不发送通知、不写入历史。"
            >
              <button
                className="primary"
                disabled={!controls || running}
                onClick={() => {
                  setRunning(true)
                  setSelfTest(null)
                  void controls
                    ?.runBasicSelfTest()
                    .then(setSelfTest)
                    .catch(showError(setMessage))
                    .finally(() => setRunning(false))
                }}
              >
                {running ? '正在自检…' : '运行基础自检'}
              </button>
              {selfTest && (
                <div
                  className={`test-result ${selfTest.ok ? 'success' : 'failure'}`}
                  role="status"
                >
                  <strong>
                    {selfTest.ok ? '自检通过' : '自检失败'} · {selfTest.passed}/
                    {selfTest.total}
                  </strong>
                  <small>
                    {selfTest.ruleVersion} · {selfTest.durationMs}ms
                  </small>
                  {selfTest.checks.map((check) => (
                    <div key={check.id}>
                      <span>{check.passed ? '✓' : '×'}</span>
                      {check.name}
                    </div>
                  ))}
                </div>
              )}
            </SettingSection>
          </div>
          <div className="settings-pane" hidden={settingsTab !== 'ai'}>
            <SettingSection
              id="ai"
              title="判断引擎"
              description="DeepSeek 使用官方预设；自定义兼容服务才需要选择协议和 Base URL。"
            >
              <Field label="服务">
                <select
                  value={aiService}
                  onChange={(event) => {
                    const service = event.target.value as 'deepseek' | 'custom'
                    setAiService(service)
                    if (service === 'deepseek') {
                      setAiProtocol(DEEPSEEK_PROVIDER_PRESET.protocol)
                      setAiBaseUrl(DEEPSEEK_PROVIDER_PRESET.baseUrl)
                      setAiModel(DEEPSEEK_PROVIDER_PRESET.model)
                    }
                  }}
                >
                  <option value="deepseek">DeepSeek 官方 API</option>
                  <option value="custom">自定义兼容服务</option>
                </select>
              </Field>
              {aiService === 'custom' && (
                <Field label="协议">
                  <select
                    value={aiProtocol}
                    onChange={(event) =>
                      setAiProtocol(event.target.value as AiProtocol)
                    }
                  >
                    <option value="openai-responses">
                      OpenAI Responses API
                    </option>
                    <option value="openai-chat">OpenAI Chat Completions</option>
                    <option value="anthropic-messages">
                      Anthropic Messages API
                    </option>
                  </select>
                </Field>
              )}
              {aiService === 'custom' && (
                <Field label="Base URL">
                  <input
                    value={aiBaseUrl}
                    onChange={(event) => setAiBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
              )}
              <div className="notice">
                请求地址：
                {aiEndpointPreview(
                  aiService === 'deepseek'
                    ? DEEPSEEK_PROVIDER_PRESET.baseUrl
                    : aiBaseUrl,
                  aiService === 'deepseek'
                    ? DEEPSEEK_PROVIDER_PRESET.protocol
                    : aiProtocol,
                )}
              </div>
              <Field label="模型">
                <input
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="模型名称"
                />
              </Field>
              <Field
                label="API Key"
                hint="Key 与自定义请求头只保存到 Windows 凭据管理器"
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="输入 API Key"
                />
                <textarea
                  value={aiHeaders}
                  onChange={(event) => setAiHeaders(event.target.value)}
                  placeholder='可选请求头 JSON，例如 {"X-Project":"personal"}'
                />
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={
                      !controls ||
                      restarting ||
                      key.trim().length < 8 ||
                      !aiBaseUrl.trim() ||
                      !aiModel.trim()
                    }
                    onClick={saveAiProvider}
                  >
                    安全保存
                  </button>
                  {aiSaved && (
                    <button
                      className="secondary"
                      disabled={!controls || restarting}
                      onClick={() => {
                        if (!controls) return
                        setRestarting(true)
                        setMessage('正在重启并根据最近历史信息初始化监控…')
                        void controls.restartApp().catch((error) => {
                          setRestarting(false)
                          showError(setMessage)(error)
                        })
                      }}
                    >
                      {restarting ? '正在重启…' : '重启并初始化监控'}
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={!controls || restarting}
                    onClick={() =>
                      void controls
                        ?.testAiProvider()
                        .then((result) => setMessage(result.message))
                        .catch(showError(setMessage))
                    }
                  >
                    连接测试
                  </button>
                </div>
              </Field>
            </SettingSection>
          </div>
          <div
            className="settings-pane"
            hidden={settingsTab !== 'notifications'}
          >
            <SettingSection
              id="webhooks"
              title="通知与 Webhook"
              description="测试消息会明确标记，不进入真实事件统计。"
            >
              <Field label="通知渠道">
                <select
                  value={channel}
                  onChange={(event) =>
                    setChannel(event.target.value as 'feishu' | 'http')
                  }
                >
                  <option value="feishu">飞书</option>
                  <option value="http">通用 HTTP</option>
                </select>
                <input
                  type="password"
                  autoComplete="off"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="HTTPS Webhook URL"
                />
                {channel === 'http' && (
                  <textarea
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                    placeholder='可选请求头 JSON，例如 {"Authorization":"Bearer …"}'
                  />
                )}
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!controls || !url.trim()}
                    onClick={() => {
                      try {
                        const parsed = headers.trim()
                          ? (JSON.parse(headers) as Record<string, string>)
                          : {}
                        void controls
                          ?.setWebhook(channel, url, parsed)
                          .then(() => {
                            setUrl('')
                            setHeaders('')
                            setMessage('Webhook 已安全保存')
                          })
                          .catch(showError(setMessage))
                      } catch {
                        setMessage('请求头必须是有效 JSON 对象')
                      }
                    }}
                  >
                    安全保存
                  </button>
                  <button
                    className="secondary"
                    disabled={!controls}
                    onClick={() =>
                      void controls
                        ?.testWebhook(channel)
                        .then((result) =>
                          setMessage(
                            `测试结果：${result.status}${result.errorCode ? ` · ${result.errorCode}` : ''}`,
                          ),
                        )
                        .catch(showError(setMessage))
                    }
                  >
                    发送测试
                  </button>
                </div>
              </Field>
              <div className="notification-matrix">
                <header>
                  <span>事件类型</span>
                  <span>系统</span>
                  <span>飞书</span>
                  <span>HTTP</span>
                </header>
                {notificationEvents.map((eventType) => (
                  <div key={eventType}>
                    <strong>{eventTypeLabel(eventType)}</strong>
                    {(['windows', 'feishu', 'http'] as const).map((item) => (
                      <input
                        key={item}
                        type="checkbox"
                        checked={notificationPolicy[eventType].includes(item)}
                        onChange={(event) =>
                          setNotificationPolicyState((current) => ({
                            ...current,
                            [eventType]: event.target.checked
                              ? [...new Set([...current[eventType], item])]
                              : current[eventType].filter(
                                  (channelId) => channelId !== item,
                                ),
                          }))
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.notificationPolicy()
                      .then(setNotificationPolicyState)
                      .then(() => setMessage('通知策略已读取'))
                      .catch(showError(setMessage))
                  }
                >
                  读取策略
                </button>
                <button
                  className="primary"
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.setNotificationPolicy(notificationPolicy)
                      .then(() => setMessage('各事件通知渠道已保存'))
                      .catch(showError(setMessage))
                  }
                >
                  保存渠道开关
                </button>
              </div>
            </SettingSection>
          </div>
          {legacyCodexSettingsVisible() && (
            <SettingSection
              id="codex"
              title="Codex 账户与恢复"
              description="账户授权与 AI 配置互不依赖。只有这里逐项勾选的线程可以恢复。"
            >
              <div className="notice safety">
                额度阈值只阻止启动新的恢复。Tibo Watch
                绝不暂停、终止或追加指令到正在运行的任务，也不会自动消耗 reset
                credit。
              </div>
              <button
                className="secondary"
                disabled={!controls || codexBusy}
                onClick={() => {
                  setCodexBusy(true)
                  void Promise.all([
                    controls?.codexProbe(),
                    controls?.codexThreads(),
                    controls?.codexResumeSettings(),
                  ])
                    .then(([probe, threads, settings]) => {
                      if (!probe || !threads || !settings) return
                      setMessage(
                        `${probe.message}${probe.rateLimit?.usedPercent !== null && probe.rateLimit?.usedPercent !== undefined ? ` · 已用 ${probe.rateLimit.usedPercent}%` : ''}`,
                      )
                      setCodexThreads(threads)
                      setAuthorizedThreads(settings.authorizedThreadIds)
                      setCodexEnabled(settings.enabled)
                      setLowerBudget(settings.lowerUsedPercent)
                      setUpperBudget(settings.upperUsedPercent)
                    })
                    .catch(showError(setMessage))
                    .finally(() => setCodexBusy(false))
                }}
              >
                {codexBusy ? '正在探测…' : '探测 Codex 并读取任务'}
              </button>
              {codexThreads.length > 0 && (
                <div className="thread-list">
                  {codexThreads.map((thread) => (
                    <label key={thread.id}>
                      <input
                        type="checkbox"
                        checked={authorizedThreads.includes(thread.id)}
                        onChange={(event) =>
                          setAuthorizedThreads((current) =>
                            event.target.checked
                              ? [...new Set([...current, thread.id])]
                              : current.filter((id) => id !== thread.id),
                          )
                        }
                      />
                      <span>
                        <strong>{thread.name ?? '未命名任务'}</strong>
                        <small>
                          {thread.status.type} · {thread.cwd ?? '未知目录'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Toggle
                label="允许自动恢复已勾选任务"
                checked={codexEnabled}
                onChange={setCodexEnabled}
              />
              <div className="budget-row">
                <Field label="重新允许启动（已用 ≤ %）">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={lowerBudget}
                    onChange={(event) =>
                      setLowerBudget(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="阻止新恢复（已用 ≥ %）">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={upperBudget}
                    onChange={(event) =>
                      setUpperBudget(Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              <button
                className="primary"
                disabled={!controls || lowerBudget >= upperBudget}
                onClick={() =>
                  void controls
                    ?.codexResumeSettings()
                    .then((current) =>
                      controls.setCodexResumeSettings({
                        ...current,
                        enabled: codexEnabled,
                        authorizedThreadIds: authorizedThreads,
                        lowerUsedPercent: lowerBudget,
                        upperUsedPercent: upperBudget,
                      }),
                    )
                    .then(() => setMessage('Codex 恢复授权与额度门禁已保存'))
                    .catch(showError(setMessage))
                }
              >
                保存恢复设置
              </button>
            </SettingSection>
          )}
          <div className="settings-pane" hidden={settingsTab !== 'data'}>
            <SettingSection
              id="storage"
              title="存储与缓存"
              description="无关回复保留 7 天，无关原创和引用保留 14 天；候选、事件和审计长期保留。"
            >
              <div className="notice">
                缓存清理每天低优先级运行一次；候选、事件、通知和审计不会被自动清理。
              </div>
              {storage && (
                <div className="notice">
                  当前占用 {formatBytes(storage.bytes)} · 共{' '}
                  {Object.values(storage.records).reduce(
                    (sum, value) => sum + value,
                    0,
                  )}{' '}
                  条记录
                </div>
              )}
              <div className="button-row">
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.storageStatus()
                      .then(setStorage)
                      .catch(showError(setMessage))
                  }
                >
                  查看占用
                </button>
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.maintainStorage()
                      .then((result) => {
                        setMessage(
                          `维护完成：清理 ${result.deleted} 条，重建 ${result.indexesRebuilt} 条索引`,
                        )
                        return controls.storageStatus()
                      })
                      .then(setStorage)
                      .catch(showError(setMessage))
                  }
                >
                  立即清理并重建索引
                </button>
                <button
                  disabled={!controls}
                  onClick={() =>
                    void controls
                      ?.exportData()
                      .then((result) =>
                        setMessage(
                          result
                            ? `已导出 ${result.records} 条记录到 ${result.destination}`
                            : '已取消导出',
                        ),
                      )
                      .catch(showError(setMessage))
                  }
                >
                  导出非敏感数据
                </button>
              </div>
            </SettingSection>
          </div>
          {message && (
            <div className="toast" role="status">
              {message}
            </div>
          )}
        </div>
      </section>
    </>
  )
}


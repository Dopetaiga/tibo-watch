import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CodexThreadSummary } from '../../../adapters/codex/app-server'
import type { CodexThreadAutomationSettings } from '../../../domain/codex-budget'
import type { DashboardModel } from '../../../domain/dashboard'
import {
  Empty,
  Field,
  PageHeader,
  SectionTitle,
  Toggle,
} from '../components/ui'
import {
  automationSummary,
  formatTime,
  resumeStatusLabel,
  showError,
  threadStatusLabel,
} from '../lib/labels'
import type { CodexBootstrap, DashboardControls } from '../controls'

export function CodexPage({
  model,
  controls,
  bootstrap,
}: {
  model: DashboardModel
  controls?: DashboardControls
  bootstrap: CodexBootstrap | null
}) {
  const [codexTab, setCodexTab] = useState<'threads' | 'scheduled' | 'policy'>(
    'threads',
  )
  const [message, setMessage] = useState<string | null>(() =>
    bootstrap
      ? `${bootstrap.probe.message}${bootstrap.probe.rateLimit?.usedPercent !== null && bootstrap.probe.rateLimit?.usedPercent !== undefined ? ` · 已用 ${bootstrap.probe.rateLimit.usedPercent}%` : ''}`
      : null,
  )
  const [threads, setThreads] = useState<CodexThreadSummary[]>(
    () => bootstrap?.threads ?? [],
  )
  const [authorized, setAuthorized] = useState<string[]>(
    () => bootstrap?.settings.authorizedThreadIds ?? [],
  )
  const [enabled, setEnabled] = useState(
    () => bootstrap?.settings.enabled ?? false,
  )
  const [lower, setLower] = useState(
    () => bootstrap?.settings.lowerUsedPercent ?? 40,
  )
  const [upper, setUpper] = useState(
    () => bootstrap?.settings.upperUsedPercent ?? 80,
  )
  const [afterReset, setAfterReset] = useState(
    () => bootstrap?.settings.afterResetEnabled ?? true,
  )
  const [beforePrediction, setBeforePrediction] = useState(
    () => bootstrap?.settings.beforePredictionEnabled ?? false,
  )
  const [beforeHours, setBeforeHours] = useState(
    () => bootstrap?.settings.beforePredictionHours ?? 2,
  )
  const [maximumRuns, setMaximumRuns] = useState(
    () => bootstrap?.settings.maximumRunsPerCycle ?? 1,
  )
  const [targetSpend, setTargetSpend] = useState(
    () => bootstrap?.settings.targetSpendPercent ?? 20,
  )
  const [minimumRemaining, setMinimumRemaining] = useState(
    () => bootstrap?.settings.minimumRemainingPercent ?? 20,
  )
  const [action, setAction] = useState<'resume' | 'accelerate'>(
    () => bootstrap?.settings.action ?? 'resume',
  )
  const [accelerationPrompt, setAccelerationPrompt] = useState(
    () => bootstrap?.settings.accelerationPrompt ?? '',
  )
  const [threadSettings, setThreadSettings] = useState<
    Record<string, CodexThreadAutomationSettings>
  >(() => bootstrap?.settings.threadSettings ?? {})
  const [busy, setBusy] = useState(false)
  const [executable, setExecutable] = useState<string | null>(
    () => bootstrap?.executable ?? null,
  )
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dryRunBusy, setDryRunBusy] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<Awaited<
    ReturnType<NonNullable<DashboardControls['codexDryRun']>>
  > | null>(null)
  const autoScanStarted = useRef(Boolean(bootstrap))

  const authorizedIds = useMemo(() => new Set(authorized), [authorized])
  const managedThreads = useMemo<CodexThreadSummary[]>(() => {
    const knownThreadIds = new Set(threads.map(({ id }) => id))
    return [
      ...threads,
      ...authorized
        .filter((id) => !knownThreadIds.has(id))
        .map((id) => ({
          id,
          name: '已安排的历史任务',
          cwd: null,
          updatedAt: null,
          status: { type: 'unavailable' as const },
        })),
    ]
  }, [authorized, threads])
  const selectedThread = useMemo(
    () => managedThreads.find(({ id }) => id === selectedThreadId),
    [managedThreads, selectedThreadId],
  )
  const scheduledThreads = useMemo(
    () => managedThreads.filter(({ id }) => authorizedIds.has(id)),
    [authorizedIds, managedThreads],
  )
  const latestResumeByThread = useMemo(() => {
    const result = new Map<string, { status: string; detail: string }>()
    const records = [...(model.details?.resume ?? [])].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    )
    for (const record of records) {
      const threadId = record.payload.threadId
      const status = record.payload.status
      if (
        typeof threadId !== 'string' ||
        typeof status !== 'string' ||
        result.has(threadId)
      )
        continue
      const error = record.payload.errorCode
      result.set(threadId, {
        status,
        detail:
          typeof error === 'string' && error
            ? error
            : `最近执行于 ${formatTime(record.timestamp)}`,
      })
    }
    return result
  }, [model.details?.resume])
  const defaultThreadPlan: CodexThreadAutomationSettings = {
    afterResetEnabled: afterReset,
    beforePredictionEnabled: beforePrediction,
    beforePredictionHours: beforeHours,
    targetSpendPercent: targetSpend,
    minimumRemainingPercent: minimumRemaining,
    action,
    accelerationPrompt,
  }
  const selectedPlan = selectedThread
    ? (threadSettings[selectedThread.id] ?? defaultThreadPlan)
    : null

  const settingsValue = (
    nextAuthorized = authorized,
    nextThreadSettings = threadSettings,
  ) => ({
    enabled,
    authorizedThreadIds: nextAuthorized,
    lowerUsedPercent: lower,
    upperUsedPercent: upper,
    afterResetEnabled: afterReset,
    beforePredictionEnabled: beforePrediction,
    beforePredictionHours: beforeHours,
    maximumRunsPerCycle: maximumRuns,
    targetSpendPercent: targetSpend,
    minimumRemainingPercent: minimumRemaining,
    action,
    accelerationPrompt,
    threadSettings: nextThreadSettings,
  })

  const saveSettings = (
    nextAuthorized = authorized,
    notice = '自动任务已保存',
    nextThreadSettings = threadSettings,
  ) => {
    if (!controls) return
    setSaving(true)
    void controls
      .setCodexResumeSettings(settingsValue(nextAuthorized, nextThreadSettings))
      .then(() => {
        setAuthorized(nextAuthorized)
        setThreadSettings(nextThreadSettings)
        setMessage(notice)
      })
      .catch(showError(setMessage))
      .finally(() => setSaving(false))
  }

  const addAutomationTask = (threadId: string) => {
    const nextThreadSettings = {
      ...threadSettings,
      [threadId]: threadSettings[threadId] ?? defaultThreadPlan,
    }
    saveSettings(
      [...new Set([...authorized, threadId])],
      '已加入自动任务',
      nextThreadSettings,
    )
  }

  const removeAutomationTask = (threadId: string) => {
    const nextThreadSettings = { ...threadSettings }
    delete nextThreadSettings[threadId]
    saveSettings(
      authorized.filter((id) => id !== threadId),
      '已从自动任务移除',
      nextThreadSettings,
    )
  }

  const updateThreadPlan = (
    threadId: string,
    patch: Partial<CodexThreadAutomationSettings>,
  ) =>
    setThreadSettings((current) => ({
      ...current,
      [threadId]: {
        ...(current[threadId] ?? defaultThreadPlan),
        ...patch,
      },
    }))

  const detect = useCallback(() => {
    if (!controls) return
    setBusy(true)
    void Promise.allSettled([
      controls.codexProbe(),
      controls.codexThreads(),
      controls.codexResumeSettings(),
      controls.codexExecutableHint(),
    ]).then(([probe, listed, settings, path]) => {
      if (probe.status === 'fulfilled')
        setMessage(
          `${probe.value.message}${probe.value.rateLimit?.usedPercent !== null && probe.value.rateLimit?.usedPercent !== undefined ? ` · 已用 ${probe.value.rateLimit.usedPercent}%` : ''}`,
        )
      else showError(setMessage)(probe.reason)
      if (listed.status === 'fulfilled') setThreads(listed.value)
      if (settings.status === 'fulfilled') {
        setAuthorized(settings.value.authorizedThreadIds)
        setEnabled(settings.value.enabled)
        setLower(settings.value.lowerUsedPercent)
        setUpper(settings.value.upperUsedPercent)
        setAfterReset(settings.value.afterResetEnabled)
        setBeforePrediction(settings.value.beforePredictionEnabled)
        setBeforeHours(settings.value.beforePredictionHours)
        setMaximumRuns(settings.value.maximumRunsPerCycle)
        setTargetSpend(settings.value.targetSpendPercent)
        setMinimumRemaining(settings.value.minimumRemainingPercent)
        setAction(settings.value.action)
        setAccelerationPrompt(settings.value.accelerationPrompt)
        setThreadSettings(settings.value.threadSettings)
      }
      if (path.status === 'fulfilled') setExecutable(path.value)
      setBusy(false)
    })
  }, [controls])

  useEffect(() => {
    if (autoScanStarted.current || !controls) return
    autoScanStarted.current = true
    detect()
  }, [controls, detect])

  return (
    <>
      <PageHeader
        eyebrow="Codex"
        title="Codex"
        description={`选择一个任务立即继续，或把它安排到下一次重置窗口。近 28 天自动恢复：${model.codexRuns.completed28d} 成功 / ${model.codexRuns.failed28d} 失败 / ${model.codexRuns.blocked28d} 被门禁阻止。`}
      />
      <div className="codex-workspace">
        <section className="surface codex-connection">
          <div className="codex-connection-state">
            <i className={executable ? 'ready' : ''} />
            <div>
              <strong>{executable ? 'Codex 已连接' : '等待扫描 Codex'}</strong>
              <small>
                {executable ?? '自动查找 Windows Codex 或 PATH 中的 codex'}
              </small>
            </div>
          </div>
          <div className="codex-snapshot" aria-label="Codex 状态概览">
            <span>
              <b>{threads.length}</b> 个任务
            </span>
            <span>
              <b>{scheduledThreads.length}</b> 个自动任务
            </span>
            <span className={enabled ? 'enabled' : ''}>
              自动执行{enabled ? '已开启' : '已关闭'}
            </span>
          </div>
          <div className="codex-connection-actions">
            <button
              className="secondary"
              disabled={!controls}
              onClick={() =>
                void controls
                  ?.chooseCodexExecutable()
                  .then((path) => {
                    if (path) {
                      setExecutable(path)
                      setMessage('Codex 路径已保存')
                    }
                  })
                  .catch(showError(setMessage))
              }
            >
              选择路径
            </button>
            <button
              className="primary"
              disabled={!controls || busy}
              onClick={detect}
            >
              {busy ? '扫描中…' : threads.length ? '重新扫描' : '扫描任务'}
            </button>
          </div>
        </section>
        <nav className="settings-tabs codex-tabs" aria-label="Codex 分类">
          <button
            className={codexTab === 'threads' ? 'active' : ''}
            onClick={() => setCodexTab('threads')}
          >
            会话 <span>{threads.length}</span>
          </button>
          <button
            className={codexTab === 'scheduled' ? 'active' : ''}
            onClick={() => setCodexTab('scheduled')}
          >
            自动任务 <span>{scheduledThreads.length}</span>
          </button>
          <button
            className={codexTab === 'policy' ? 'active' : ''}
            onClick={() => setCodexTab('policy')}
          >
            执行策略
          </button>
        </nav>
        {codexTab === 'threads' ? (
          <section className="surface codex-browser">
            <header className="codex-browser-head">
              <SectionTitle
                label="任务"
                title="选择任务"
                action={`${threads.length}`}
              />
            </header>
            {threads.length ? (
              <div className="codex-thread-list">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    className={selectedThreadId === thread.id ? 'active' : ''}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <i className={thread.status.type} />
                    <span>
                      <strong>{thread.name ?? '未命名任务'}</strong>
                      <small>{thread.cwd ?? '未知目录'}</small>
                    </span>
                    <em>
                      {authorizedIds.has(thread.id)
                        ? '自动任务'
                        : threadStatusLabel(thread.status.type)}
                    </em>
                    <b>›</b>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>扫描后选择一个任务进行操作</Empty>
            )}
          </section>
        ) : null}

        {codexTab === 'threads' ? (
          <aside
            className={`surface codex-drawer ${selectedThread ? 'open' : ''}`}
          >
            {selectedThread ? (
              <>
                <header>
                  <div>
                    <small>
                      {threadStatusLabel(selectedThread.status.type)}
                    </small>
                    <h2>{selectedThread.name ?? '未命名任务'}</h2>
                    <p>{selectedThread.cwd ?? '未知目录'}</p>
                  </div>
                  <button
                    aria-label="关闭"
                    onClick={() => setSelectedThreadId(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="drawer-actions">
                  <div className="codex-action-block">
                    <span>手动执行</span>
                    <strong>立即继续这个任务</strong>
                    <small>只发送一次继续指令，不改变自动任务设置。</small>
                    <button
                      className="primary"
                      disabled={
                        !controls ||
                        ['active', 'unavailable'].includes(
                          selectedThread.status.type,
                        )
                      }
                      onClick={() =>
                        void controls
                          ?.resumeCodexThread(selectedThread.id)
                          .then(({ turnId }) =>
                            setMessage(`任务已继续 · ${turnId}`),
                          )
                          .catch(showError(setMessage))
                      }
                    >
                      立即继续
                    </button>
                  </div>
                  <div className="codex-action-block">
                    <span>自动执行</span>
                    <strong>安排到重置窗口</strong>
                    <small>
                      {selectedPlan
                        ? automationSummary(
                            selectedPlan.afterResetEnabled,
                            selectedPlan.beforePredictionEnabled,
                            selectedPlan.beforePredictionHours,
                          )
                        : '未设置'}
                    </small>
                    {authorizedIds.has(selectedThread.id) ? (
                      <button
                        className="secondary"
                        disabled={saving}
                        onClick={() => removeAutomationTask(selectedThread.id)}
                      >
                        移出自动任务
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        disabled={saving}
                        onClick={() => addAutomationTask(selectedThread.id)}
                      >
                        加入自动任务
                      </button>
                    )}
                  </div>
                  <div className="codex-action-block">
                    <span>预演</span>
                    <strong>Dry-Run 触发链检查</strong>
                    <small>按真实门禁推演两条触发路径，不下发任何指令。</small>
                    <button
                      className="secondary"
                      disabled={!controls || dryRunBusy}
                      onClick={() => {
                        if (!controls) return
                        setDryRunBusy(true)
                        setDryRunResult(null)
                        controls
                          .codexDryRun(selectedThread.id)
                          .then(setDryRunResult)
                          .catch(showError(setMessage))
                          .finally(() => setDryRunBusy(false))
                      }}
                    >
                      {dryRunBusy ? '推演中…' : '运行预演'}
                    </button>
                    {dryRunResult ? (
                      <div className="dry-run-result">
                        <p>{`当前额度：${dryRunResult.usedPercent ?? '—'}% · 门禁：${dryRunResult.afterReset.gateState === 'allow-new-resumes' ? '放行' : '阻止'}`}</p>
                        {(
                          [
                            ['重置后执行', dryRunResult.afterReset],
                            ['预测前执行', dryRunResult.beforePrediction],
                          ] as const
                        ).map(([label, trace]) => (
                          <p key={label}>
                            <strong>{label}</strong>：
                            {trace.blockReason
                              ? `将阻止 — ${trace.blockReason}`
                              : `将通过${trace.instruction ? '（注入加速提示词）' : ''}${trace.plannedAt ? `，计划 ${formatTime(trace.plannedAt)}` : ''}`}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {authorizedIds.has(selectedThread.id) && selectedPlan ? (
                  <section className="thread-plan-editor">
                    <header>
                      <div>
                        <strong>此任务的自动设置</strong>
                        <small>只影响当前任务，不修改其他自动任务。</small>
                      </div>
                    </header>
                    <div className="thread-plan-grid">
                      <Toggle
                        label="确认重置后执行"
                        checked={selectedPlan.afterResetEnabled}
                        onChange={(checked) =>
                          updateThreadPlan(selectedThread.id, {
                            afterResetEnabled: checked,
                          })
                        }
                      />
                      <Toggle
                        label="预测时间前执行"
                        checked={selectedPlan.beforePredictionEnabled}
                        onChange={(checked) =>
                          updateThreadPlan(selectedThread.id, {
                            beforePredictionEnabled: checked,
                          })
                        }
                      />
                      {selectedPlan.beforePredictionEnabled ? (
                        <Field label="提前小时">
                          <input
                            type="number"
                            min="0"
                            max="168"
                            value={selectedPlan.beforePredictionHours}
                            onChange={(event) =>
                              updateThreadPlan(selectedThread.id, {
                                beforePredictionHours: Number(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <Field label="执行方式">
                        <select
                          value={selectedPlan.action}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              action: event.target.value as
                                'resume' | 'accelerate',
                            })
                          }
                        >
                          <option value="resume">继续原任务</option>
                          <option value="accelerate">注入加速提示词</option>
                        </select>
                      </Field>
                      <Field label="至少保留额度 %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedPlan.minimumRemainingPercent}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              minimumRemainingPercent: Number(
                                event.target.value,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="单任务额度预留 %">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={selectedPlan.targetSpendPercent}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              targetSpendPercent: Number(event.target.value),
                            })
                          }
                        />
                      </Field>
                    </div>
                    {selectedPlan.action === 'accelerate' ? (
                      <Field label="此任务的加速提示词">
                        <textarea
                          value={selectedPlan.accelerationPrompt}
                          onChange={(event) =>
                            updateThreadPlan(selectedThread.id, {
                              accelerationPrompt: event.target.value,
                            })
                          }
                        />
                      </Field>
                    ) : null}
                    <button
                      className="primary"
                      disabled={!controls || saving}
                      onClick={() =>
                        saveSettings(authorized, '此任务的设置已保存')
                      }
                    >
                      {saving ? '保存中…' : '保存此任务设置'}
                    </button>
                  </section>
                ) : null}
                {selectedThread.status.type === 'active' && (
                  <p className="drawer-note">
                    任务正在运行，不会暂停或追加指令。
                  </p>
                )}
                {selectedThread.status.type === 'unavailable' && (
                  <p className="drawer-note">
                    本次扫描未返回该任务，但安排记录仍保留；你可以将它移出自动任务。
                  </p>
                )}
                {!enabled && authorizedIds.has(selectedThread.id) && (
                  <p className="drawer-note">
                    已安排，但自动执行总开关当前关闭。
                  </p>
                )}
              </>
            ) : (
              <Empty>选择左侧任务</Empty>
            )}
          </aside>
        ) : null}

        {codexTab === 'scheduled' ? (
          <section className="surface scheduled-panel codex-tab-panel">
            <SectionTitle
              label="AUTOMATION"
              title="自动任务"
              action={`${scheduledThreads.length}`}
            />
            {scheduledThreads.length ? (
              scheduledThreads.map((thread) => {
                const latest = latestResumeByThread.get(thread.id)
                const plan = threadSettings[thread.id] ?? defaultThreadPlan
                return (
                  <button
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <span>
                      <strong>{thread.name ?? '未命名任务'}</strong>
                      <small>
                        {enabled
                          ? automationSummary(
                              plan.afterResetEnabled,
                              plan.beforePredictionEnabled,
                              plan.beforePredictionHours,
                            )
                          : '已停用自动执行'}
                        {' · '}
                        {threadStatusLabel(thread.status.type)}
                      </small>
                      {latest ? <small>{latest.detail}</small> : null}
                    </span>
                    <em
                      className={
                        latest?.status === 'completed'
                          ? 'enabled'
                          : (latest?.status ?? (enabled ? 'enabled' : ''))
                      }
                    >
                      {latest
                        ? resumeStatusLabel(latest.status)
                        : enabled
                          ? '等待触发'
                          : '已停用'}
                    </em>
                  </button>
                )
              })
            ) : (
              <Empty compact>尚未安排自动任务</Empty>
            )}
          </section>
        ) : null}

        {codexTab === 'policy' ? (
          <details className="surface automation-policy codex-tab-panel" open>
            <summary>
              <span>
                <strong>队列与新任务默认值</strong>
                <small>
                  {enabled
                    ? automationSummary(
                        afterReset,
                        beforePrediction,
                        beforeHours,
                      )
                    : '总开关已关闭'}
                </small>
              </span>
              <b>设置</b>
            </summary>
            <div className="policy-fields">
              <Toggle
                label="启用自动执行"
                checked={enabled}
                onChange={setEnabled}
              />
              <Toggle
                label="新任务默认：确认重置后执行"
                checked={afterReset}
                onChange={setAfterReset}
              />
              <Toggle
                label="新任务默认：预测时间前执行"
                checked={beforePrediction}
                onChange={setBeforePrediction}
              />
              {beforePrediction && (
                <Field label="提前小时">
                  <input
                    type="number"
                    min="0"
                    max="168"
                    value={beforeHours}
                    onChange={(event) =>
                      setBeforeHours(Number(event.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="执行方式">
                <select
                  value={action}
                  onChange={(event) =>
                    setAction(event.target.value as 'resume' | 'accelerate')
                  }
                >
                  <option value="resume">继续原任务</option>
                  <option value="accelerate">注入加速提示词</option>
                </select>
              </Field>
              {action === 'accelerate' && (
                <Field label="加速提示词">
                  <textarea
                    value={accelerationPrompt}
                    onChange={(event) =>
                      setAccelerationPrompt(event.target.value)
                    }
                  />
                </Field>
              )}
              <div className="budget-row">
                <Field label="每周期最多启动">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={maximumRuns}
                    onChange={(event) =>
                      setMaximumRuns(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="至少保留 %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={minimumRemaining}
                    onChange={(event) =>
                      setMinimumRemaining(Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              <details className="budget-advanced">
                <summary>高级额度门禁</summary>
                <div className="budget-row">
                  <Field label="单任务额度预留 %">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={targetSpend}
                      onChange={(event) =>
                        setTargetSpend(Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="重新允许 ≤ %">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={lower}
                      onChange={(event) => setLower(Number(event.target.value))}
                    />
                  </Field>
                  <Field label="阻止新执行 ≥ %">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={upper}
                      onChange={(event) => setUpper(Number(event.target.value))}
                    />
                  </Field>
                </div>
              </details>
              <p className="drawer-note">
                额度门禁只阻止新的执行，不会暂停正在运行的任务。
              </p>
              <button
                className="primary"
                disabled={!controls || saving || lower >= upper}
                onClick={() => saveSettings()}
              >
                {saving ? '保存中…' : '保存策略'}
              </button>
            </div>
          </details>
        ) : null}
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </div>
    </>
  )
}

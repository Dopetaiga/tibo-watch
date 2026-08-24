import type {
  DashboardDetailKind,
  DashboardModel,
} from '../../../domain/dashboard'
import type { AiProtocol } from '../../../adapters/ai/multi-protocol'
import type { AutomationEventType } from '../../../adapters/notifications/types'

export function threadStatusLabel(status: string): string {
  if (status === 'active') return '运行中'
  if (status === 'idle') return '可继续'
  if (status === 'archived') return '已归档'
  if (status === 'unavailable') return '本次未扫描到'
  return '空闲'
}

export function automationSummary(
  afterReset: boolean,
  beforePrediction: boolean,
  beforeHours: number,
): string {
  const triggers = [
    afterReset ? '重置后' : null,
    beforePrediction ? `预测前 ${beforeHours} 小时` : null,
  ].filter(Boolean)
  return triggers.length ? triggers.join(' · ') : '未选择触发条件'
}

export function resetCreditSourceLabel(
  source: DashboardModel['resetCredits']['detailSource'],
) {
  if (source === 'api') return '官方明细'
  if (source === 'count-only') return '仅数量'
  if (source === 'inferred') return '规则推断'
  return '尚未授权'
}

export function showError(setter: (value: string) => void) {
  return (error: unknown) =>
    setter(error instanceof Error ? error.message : String(error))
}
export function legacyCodexSettingsVisible(): boolean {
  return false
}
export function serviceStatusLabel(value: DashboardModel['serviceStatus']) {
  return {
    starting: '服务启动中',
    running: '运行正常',
    stopped: '服务已停止',
  }[value]
}
export function dataStatusLabel(value: DashboardModel['dataStatus']) {
  return {
    updating: '正在更新',
    current: '数据已更新',
    stale: '数据已过期',
    error: '更新失败',
    disabled: '数据源已关闭',
  }[value]
}
export function relevanceLabel(
  value: DashboardModel['posts'][number]['relevance'],
) {
  return {
    candidate: '规则候选',
    relevant: '有效信号',
    related_non_reset: '相关但非重置',
    irrelevant: '无关',
  }[value]
}
export function detailName(value: DashboardDetailKind) {
  return {
    post: '帖子',
    analysis: '分析',
    event: '事件',
    notification: '通知',
    resume: 'Codex 恢复',
  }[value]
}

export function resetKindLabel(value: 'forced' | 'compensation' | 'banked') {
  return {
    forced: '常规重置',
    compensation: '补偿重置',
    banked: '预存重置权益',
  }[value]
}

export function chainStageLabel(
  status: 'candidate' | 'expected' | 'confirmed',
  kind: 'forced' | 'compensation' | 'banked',
) {
  if (status === 'confirmed')
    return kind === 'banked' ? '权益已记录' : '实际重置确认'
  if (status === 'expected') return '明确承诺与预测'
  return '准备或暗示'
}
export function eventTypeLabel(value: AutomationEventType): string {
  return {
    rule_candidate: '规则候选',
    ai_confirmed: 'AI 已确认',
    reset_observed: '实际重置',
    codex_resume_started: '恢复开始',
    codex_resume_waiting_approval: '等待批准',
    codex_resume_completed: '恢复完成',
    codex_resume_failed: '恢复失败',
  }[value]
}
export function resumeStatusLabel(value: string): string {
  return (
    {
      completed: '最近完成',
      blocked: '已阻止',
      failed: '执行失败',
    }[value] ?? value
  )
}
export function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function aiEndpointPreview(
  baseUrl: string,
  protocol: AiProtocol,
): string {
  const suffix = {
    'anthropic-messages': 'messages',
    'openai-responses': 'responses',
    'openai-chat': 'chat/completions',
  }[protocol]
  return `${baseUrl.replace(/\/$/, '')}/${suffix}`
}
export function formatUtc(value: string) {
  return new Date(value).toISOString().replace('.000Z', ' UTC')
}
export function formatWindow(start: string | null, end: string | null) {
  if (!start && !end) return '尚未给出明确时间窗口'
  return [start && formatTime(start), end && formatTime(end)]
    .filter(Boolean)
    .join(' — ')
}

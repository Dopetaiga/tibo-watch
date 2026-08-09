import type { Analysis, ResetEvent } from './models'

function line(value: string | null): string {
  return value?.trim() || '未知'
}

export function renderEventReport(
  event: ResetEvent,
  analysis: Analysis,
): string {
  return `# ${event.titleZh}

- 事件状态：${event.status}
- 事件类型：${event.eventType}
- 影响范围：${line(event.scope)}
- 预计开始：${line(event.expectedStart)}
- 预计结束：${line(event.expectedEnd)}
- 置信度：${analysis.confidence}
- 原帖：${analysis.sourceUrl}
- 规则版本：${analysis.ruleVersion}
- 分析版本：${analysis.analysisVersion}

## 中文摘要

${analysis.summaryZh}

## 判断依据

${analysis.evidence.map((item) => `- ${item}`).join('\n') || '- 无'}

## 不确定性

${analysis.uncertainties.map((item) => `- ${item}`).join('\n') || '- 无'}
`
}

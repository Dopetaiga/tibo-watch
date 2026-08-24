# Codex 自动化 2.0 专项设计

## 1. 目标

把 Codex 自动化从"能跑"升级为**可信、可观察、可干预**：

- 用户在手机上能看到任务卡在审批并知道该做什么
- 长任务不再被 10 分钟硬超时误杀
- 上线前能 dry-run 验证整条触发链
- 每次运行留下"做了什么"的摘要与统计

## 2. 开放问题（✅ 已于 2026-08-24 实测回答，codex-cli 0.147.0）

| # | 结论 | 证据 |
|---|------|------|
| Q1 | **支持推送**。服务器主动发送：`thread/started`、`thread/status/changed`、`turn/started`、`item/started`、`item/completed`、`mcpServer/startupStatus/updated`、`remoteControl/status/changed` | `scripts/probe-codex-events.mjs` 实测 18 帧通知，含完整 turn 生命周期 |
| Q2 | `thread/read` 返回 `{type:'active',activeFlags:[]}`；activeFlags 存在但简单 turn 为空。审批 flag 名待真实审批场景确认；可改用订阅 `thread/status/changed` 载荷判断 | 同上 |
| Q3 | **`turn/start` 接受 `approvalPolicy:'never'`**（未知参数会被服务端以 unknown variant 拒绝，本次未拒绝即接受） | thread/create 的报错泄露了完整方法表：无 thread/create，但有 `thread/start`(建新线程)/fork/archive、`turn/steer`、`turn/interrupt`、**`account/usage/read`**(每日 token 桶)、`account/rateLimitResetCredit/consume` |

**额外发现（省钱统计数据源）**：`account/usage/read` 返回
`{summary:{lifetimeTokens,peakDailyTokens,longestRunningTurnSec,streakDays...}, dailyUsageBuckets:[{startDate,tokens}]}` —— 支持基于真实 token 计量的省钱统计，而非百分比启发式。

## 2.1 省钱统计设计（token 计量版）

```
domain/savings.ts
computeSavings(dailyBuckets, config, now) => {
  tokens28d, avgDailyTokens, peakDailyTokens,
  apiEquivalentUsd   = tokens28d / 1e6 × referenceUsdPerMTokens (默认 $2)
  netVsPlanUsd       = apiEquivalentUsd − plan月费 × 28/30 （配置了套餐价才有）
}
```
- 配置默认值内置（Plus $20/月、参考价 $2/M tok），后续开放为设置项
- 与重置事件关联归因（P4）：确认日次日的 token 量超出基线的部分计为"重置解锁"
- 数据获取：5 分钟 Codex 定时器顺带拉取 usage，存内存供仪表盘

## 3. CodexConnectionManager（常驻连接）

```ts
// app/adapters/codex/connection.ts
export class CodexConnectionManager {
  async acquire(): Promise<LeasedClient>       // 空闲复用；僵死检测失败则重建一次
  release(lease: LeasedClient): void           // 引用计数归零后 idleTimeoutMs 关闭
  invalidate(reason: string): void             // exit/超时后标记，下次 acquire 重建
}
```

- 复用现有 `StdioJsonRpcTransport`，增加 `lastActivityAt` 与 `ping()` 健康检查（`initialize` 幂等重放）
- 替换点：`RuntimeController.#codexClient()` 的所有调用方改为 manager 租约
- 收益：额度采样、threads 扫描不再每次冷启动进程；PowerShell 探测路径只在重建时走

## 4. Turn 完成感知：订阅优先，轮询兜底

```
acquire() ─> transport.onNotification('turn/*', handler)   // 若 Q1 成立
              └─ timeout: settings.turnTimeoutMs (默认 10min，设置项范围 5–60min)
           └─ fallback: 现有 thread/read 1s 轮询（保留为降级路径）
```

- `#onLine` 目前丢弃无 id 帧（`app-server.ts:275-292`）：扩展为通知分发器 `onNotification(method, handler)`，带一次性订阅清理
- 超时语义修正：等待超时改记审计 `errorCode: 'TURN_TIMEOUT'` 且状态记 `'failed'` 前先查一次最终状态——若线程实际已完成则按 completed 记录（消除误杀）
- 审批检测：轮询/订阅回调中发现 Q2 的审批 flag → 触发 `codex_resume_waiting_approval` 通知（事件类型已存在但从未派发），并在审计记录追加可选字段 `phase`

## 5. Dry-run（试运行）

```ts
// domain/codex-budget.ts 新增纯函数：不触碰任何客户端
export interface AutomationTrace {
  gateState: BudgetGateState          // 当前门禁
  wouldBlock: string | null           // 若阻止，原因
  effectiveInstruction: string | null // 将注入的加速提示词（或默认 resume 指令）
  plannedAt: string | null            // before-prediction 场景的预计触发时刻
}
export function traceAutomation(
  event: ResetEvent, phase, settings: CodexAutomationSettings,
  quotaSnapshot: { usedPercent: number | null },
): AutomationTrace
```

- IPC：`codex:dry-run <threadId>` → 读最新额度观测 → 返回 trace，**绝不下发 `turn/start`**
- UI：Codex 面板每行授权任务加"预演"按钮，展示 trace 四元组
- 安全边界：dry-run 代码路径物理上不含 resumeThread 调用（code review 可验证）

## 6. 审计增强与反馈环

- `CodexResumeAudit` 追加可选字段（schemaVersion 保持 1，向后兼容）：
  - `phase?: 'waiting_approval' | 'running' | 'done'`
  - `turnSummary?: string`（完成后取最近 turn 输出首 200 字符）
  - `durationMs?: number`
- DashboardService 从既有 `codex-resumes` store 聚合近 28 天 completed/failed/blocked 计数，进 `dashboard:codex` 域——不加新存储
- 通知文案：completed 通知附带 turnSummary，用户不用切应用就知道任务干了什么

## 7. 额度采样与预测联动

- **加密采样窗**：confirmed 事件前后 2h 内，`#codexRateLimitTimer` 间隔临时 5min→60s（复用 PollScheduler 的 activate 思路）；窗口外恢复
- **学习式默认值**：35 天观测足够计算传播延迟 P50/P90；`beforePredictionHours` 默认值改为"上次实测传播延迟的 P50 向上取整到小时"，用户显式设置过则尊重用户值
- 单位归一化前置：rateLimits 解析处统一秒→毫秒（修复 reset-credits 的隐式假设）

## 8. 不做（Non-goals）

- 不自动批准任何审批（永远只通知）
- 不并行多个 turn（互斥锁维持现状，保守优先）
- 不做多账号/多 CODEX_HOME
- 不向运行中任务追加指令（README 承诺不变）

## 9. 测试策略

| 层级 | 内容 |
|------|------|
| unit | `traceAutomation` 边界（null 额度、门禁各分支）、通知分发器 waiting_approval 路径 |
| integration | FakeTransport 模拟 notification 推送 / 审批 flag / 超时后终态翻转 |
| manual | Q1–Q3 探测脚本输出归档进本文档附录 |

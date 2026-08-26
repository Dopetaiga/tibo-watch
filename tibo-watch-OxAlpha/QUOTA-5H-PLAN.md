# Codex 双窗口额度（5 小时限额）适配方案 · P6

> 背景：2026-08-24 起 Codex 正式引入 5 小时滚动限额。
> 本文基于对 codex-cli 0.147.0 `account/rateLimits/read` 的实测载荷制定
> （`scripts/probe-rate-limit-shape.mjs`，只读探测）。

## 0. 实测接口现状（2026-08-24）

```jsonc
{
  "limitId": "codex",
  "primary":   { "usedPercent": 4, "windowDurationMins": 300,   "resetsAt": ... }, // ← 5 小时窗
  "secondary": { "usedPercent": 1, "windowDurationMins": 10080, "resetsAt": ... }, // ← 周窗
  "credits": { "hasCredits": false, "unlimited": false, "balance": "0" },
  "planType": "plus",
  "spendControlReached": false,
  "rateLimitReachedType": null
}
// 另有 rateLimitsByLimitId 映射（多 limit 预留）
```

**当前代码的问题**
- `app-server.ts rateLimits()` 只读 `primary` → 应用现在盯的是 5h 窗，
  周窗、credits 余额全部丢失；
- `codex-budget.ts` 单一 usedPercent 门禁语义在双窗下不再成立；
- `reset-credits.ts` / `learned-timing.ts` 的"补充下降"启发式会把
  每 5h 的例行滚动误判为一次"Tibo 重置"，污染省钱统计与学习默认值。

## P6.0 · 数据层：双窗口采集（0.5 天）

- `app-server.ts` `rateLimits()` 返回扩展为：
  ```ts
  {
    primary: WindowSnapshot     // 兼容旧字段名
    secondary: WindowSnapshot | null
    creditsBalance: string | null
    planType: string | null
    spendControlReached: boolean | null
  }
  type WindowSnapshot = { usedPercent:number|null; resetsAt:number|null;
                          windowDurationMins:number|null }
  ```
  统一经 `toMilliseconds` 归一化；`secondary` 缺失时置 null（老版本兼容）。
- `CodexRateLimitObservation` 追加可选字段：
  `secondaryUsedPercent / secondaryResetsAt / creditsBalance / planType`
  （schemaVersion 保持 1）。
- `scripts/probe-rate-limit-shape.mjs` 收编入库并接入 CI 手册。

验收：观测记录含双窗样本；旧记录读取不报错。

## P6.1 · 门禁策略：分窗决策（1 天）

`codex-budget.ts` 引入窗口感知谓词，替换单一百分比判断：

```ts
mayStartTurn({ fiveHour, weekly, settings }) => {
  // 1) 5h 窗必须能吸收本轮 targetSpend 且低于保留线
  // 2) weekly 仅做硬上限（>= upperUsedPercent 时整体封锁）
  // 3) credits.unlimited 直通；balance 可选作加速兜底
  // 4) spendControlReached=true 一票阻止
}
```

- `BudgetGateState` 升级为 `{ fiveHour: state; weekly: state }`，
  迟滞逻辑各自独立（5h 滞回 40/80，weekly 只封不放）。
- `validateAutomationSettings` 新增可选
  `weeklyUpperUsedPercent`（默认沿用 upper），向后兼容。
- `runtime-controller` 授权恢复路径改用新谓词；错误文案区分
  「5h 窗不足」vs「周窗达到上限」。

## P6.2 · 观测与学习：精确锚点取代启发式（1–1.5 天）

- API 已给出**精确 resetsAt** → 密集采样从「Tibo 事件后 ±2h」升级为
  「min(Tibo事件后2h, min(primary.resetsAt, weekly.resetsAt) 前 30 分钟)
  起以 60s 采样」，由 `#tickCodexSampling` 统一调度。
- `learnedPropagationDelayHours` 重写：
  - 以 `resetsAt` 为已知滚动点，先剔除与 5h 例行滚动重合的下降；
  - 仅保留无法用任何 resetsAt±15min 解释的下降作为「强制重置」样本；
- `reset-credits.ts` 的 28d 过期推断迁移到 `secondary.resetsAt`
  （存在时直接使用，缺失再退回启发式）。
- 省钱统计锚点同步修正：确认事件的消耗窗口终点 = 下一个 primary.resetsAt
  或观测到的下降点（取先到者）。

## P6.3 · 省钱统计 v2：按窗口归因（1 天）

沿用既定口径（信号→刷新之间的免作废消耗），扩展为双维度：

| 维度 | 口径 |
|------|------|
| 5h 窗 | 每次滚动前末端燃烧（临近 resetsAt 的观察差值和） |
| 周窗 | Tibo 强制重置导致的周窗提前刷新所节省的等待时间×均速 |
| 展示 | 卡片并列两组数字；等效完整窗口分别按 300min / 10080min 折算 |

数据源不变（observations 内的双窗序列），无新增存储。

## P6.4 · UI 与设置（0.5–1 天）

- 监控页状态条扩为双环：`5h xx% · 刷新 in 42m` ＋ `周 1% · 刷新 in 5d12h`；
- 设置页自动化区新增「周窗上限」输入（可选，默认=upper）；
- Codex 页预演 dry-run 输出两行判定：5h 腿 / weekly 腿。

## P6.5 · 测试与发布（0.5 天）

- fixtures 用本次探测的真实 JSON 截断样本；
- 门禁矩阵单测（5h 通过×周封 / 反之 / credits 直通 / spendControl）；
- contract 测试键集合随模型追加更新；
- 版本 `0.3.0-alpha.2`，标签复用现有流水线。

## 依赖顺序

P6.0 → P6.1 →（P6.2 ∥ P6.3）→ P6.4 → P6.5
总量约 3.5–4.5 天；P6.0 完成后应用即刻恢复"至少不丢信息"的状态，
建议先行单独提交。

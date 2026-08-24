# 实施路线图（Ox Alpha 版）

> 每阶段独立可交付、独立可回滚；每阶段结束跑 `npm run verify` 全绿 + 手动冒烟。
> 前置：`ox-alpha/robustness-polish` 已合并入基线（4 个修复提交）。

## P0 · 基线对齐与护栏（0.5 天）✅ 已完成

**任务**
- [x] 以 `ox-alpha/robustness-polish` 为工作基线（保持 Ox Alpha 分支线，不动 main）
- [x] 删除仓库根目录两个乱码垃圾目录
- [x] DashboardModel contract 快照测试（`tests/unit/dashboard-contract.test.ts`，含凭据注入点）
- [x] 性能基线测量并回填附录（`tests/integration/snapshot-perf.test.ts`，`TIBO_PERF=1` 按需运行）

**验收**：verify 绿（125 测试）；contract 测试就位；基线数据已写入附录。

## P1 · 存储与主进程解构（2–3 天）

**任务**（对应 ARCHITECTURE §3/§4/§6）
- [ ] `file-store.ts`：`appendIndex` + 启动自愈 compact；`put()` 不再全量重建
- [ ] 抽出 `DashboardService`（快照组装 + 修订号），RuntimeController 委托
- [ ] 抽出 `NotificationHub`（搬运 robustness-polish 已有逻辑）
- [ ] `MonitoringService`：失败复核队列（M7）+ AI 重试退避（M6）
- [ ] 设置读取校验（M11）、rateLimits 单位归一化（M12）
- [ ] `directorySize` 移出轮询路径

**涉及文件**：`file-store.ts`、新增 `app/main/services/*`、`runtime-controller.ts`（收缩）、`pipeline.ts`
**验收**：
- 300 条记录连续插入的写放大从 O(N²) 降到 O(N)（集成测试计时断言或插入计数断言）
- AI 失败帖子在下一轮 poll 被补审（新集成测试）
- verify 绿 + e2e 冒烟

**风险**：索引追加与崩溃窗口 → 以"最后一条为准"读取策略兜底；每抽一个服务单独提交。

## P2 · IPC 分域通道 + 前端重构（3–4 天）

**任务**（对应 ARCHITECTURE §5 + FRONTEND-V2.md 全文）
- [ ] 主进程五通道（revision/monitor/history/codex/audit）+ 域修订号
- [ ] `main.tsx` 改造为 `useDashboardDomain` hook 门控轮询
- [ ] App.tsx 解构为 features/ 四页 + ui 原语；React.lazy 分包
- [ ] 行组件 memo 化、content-visibility 长列表、useDeferredValue 热力图
- [ ] dashboard-model.ts 纯函数索引层（js-* 规则）+ 单测
- [ ] 旧 `dashboard:get` 保留 deprecated 一个版本周期

**涉及文件**：`renderer/src/**`（重组）、新增 `app/main/dashboard-service.ts`、preload 扩展
**验收**：FRONTEND-V2.md §8 四条全部满足；electron-security 测试继续绿（CSP/preload 断言不受影响）

**风险**：App.tsx 拆分回归面大 → 按 feature 页逐个迁移，每页一提交；contract 测试护航数据形状。

## P3 · Codex 自动化 2.0（3–4 天）

**任务**（对应 CODEX-AUTOMATION-V2.md 全文）
- [ ] Q1–Q3 探测脚本执行，结论回填文档
- [ ] `CodexConnectionManager` 常驻连接替换冷启动
- [ ] 通知订阅 + 轮询兜底；`turnTimeoutMs` 设置项
- [ ] 审批检测 → `codex_resume_waiting_approval` 通知打通
- [ ] `traceAutomation` dry-run + Codex 面板"预演"按钮
- [ ] 审计字段扩展（phase/turnSummary/durationMs）+ 成功率聚合
- [ ] completed 通知附带 turnSummary

**涉及文件**：`app-server.ts`、新增 `connection.ts`、`codex-budget.ts`、`runtime-controller.ts`（Coordinator 抽取）、codex 面板前端
**验收**：
- FakeTransport 集成测试覆盖：推送完成、审批挂起通知、超时后终态翻转不误杀
- dry-run 代码路径 grep 不到 `turn/start`
- verify 绿

**风险**：Q1 若不成立（无 notification）→ 直接走增强版轮询（间隔自适应 1s→5s 退避），其余设计不变。

## P4 · 额度智能与观测收尾（1–2 天）

- [ ] 加密采样窗（事件前后 ±2h @60s）
- [ ] `beforePredictionHours` 学习式默认值（尊重用户显式设置）
- [ ] resetCredits 摘要展示补充置信标记（推断 vs 观测）
- [ ] DashboardService LRU 缓存参数化（history 域大对象）

**验收**：模拟时间序列下采样密度符合设计；学习默认值单元测试。

## P5 · 验证与发布（1 天）

- [ ] 全量 `npm run verify` + `test:e2e`（打包冒烟）+ `test:installer`
- [ ] 性能对照报告：P0 基线 vs 终态（IPC 流量、内存、长帧数）
- [ ] 更新主 README / docs/PROJECT-STRUCTURE.md / TROUBLESHOOTING.md
- [ ] 版本号 0.3.0-alpha.1，打 tag `ox-alpha-v0.3.0-alpha.1`

## 里程碑依赖

```
P0 ──> P1 ──> P2 ──> P5
        └────> P3 ──┘
             P4 <── P3（采样联动依赖 Coordinator 就位）
```

P2 与 P3 可并行推进（前端不依赖 Codex 内部改造，仅消费 `dashboard:codex` 契约——契约在 P1 定稿）。

## 附录 · 性能基线（P0 已测量，2026-08-24，NVMe SSD / Node 24 / Windows 11）

复现方式：`$env:TIBO_PERF='1'; npx vitest run tests/integration/snapshot-perf.test.ts`

| 指标 | 基线值 | 目标值 |
|------|--------|--------|
| 500 条记录连续 `put()` 总耗时 | **24,848 ms**（≈50ms/条，O(N²) 写放大） | <2,000 ms（O(N) 增量索引） |
| snapshot() 组装耗时 @500 posts | 中位 81 ms / 最大 117 ms | monitor 域 <20 ms |
| snapshot() 单次 IPC payload | **275 KB**（每 2s 一次 = 空闲态 ~8MB/min） | 分域后 monitor 域 <10 KB |
| 渲染层空闲 commit 次数 / 2min | 待 P2 测量 | 0 |

> 注：基线为空 store 冷启动 + 500 posts 场景；analyses/events 增多后 snapshot 耗时将线性恶化（details 全量序列化）。

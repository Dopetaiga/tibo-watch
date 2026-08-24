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

## P1 · 存储与主进程解构（2–3 天）✅ 已完成

**任务**（对应 ARCHITECTURE §3/§4/§6）
- [x] `file-store.ts`：`appendIndex` + 启动自愈 compact；`put()` 不再全量重建（24.8s→1.56s）
- [x] 抽出 `DashboardService`（快照组装），RuntimeController 委托；纯函数下沉 `domain/event-selection.ts`
- [x] 抽出 `NotificationHub`（持久 dispatcher + 策略校验迁移）
- [x] AI 重试退避（M6）+ 失败复核队列（M7）
- [x] 设置读取校验（M11）、rateLimits 单位归一化（M12，adapter 层统一毫秒契约）
- [x] `directorySize` 确认仅在显式 storageStatus 路径（无需改动）

**偏离说明**：完整 `MonitoringService` 抽取推迟——失败复核队列先行落在 controller 内（行为优先）；IPC 分域通道在 P2 以更小的内存缓存方案替代达成同等性能目标（见 P2 偏离说明）。

**验收结果**：127→129 测试全绿；写放大消除有集成测试锁定。

## P2 · IPC 分域通道 + 前端重构（3–4 天）✅ 已完成

**已完成（第一切片，达成性能主目标）**
- [x] `JsonRecordStore` 进程内权威缓存：list()/get() 走内存，写路径同步维护；rebuildIndex 强制穿盘以检测外部漂移
- [x] 渲染层 payload 门控：轮询返回未变化时跳过 setModel，空闲态零 reconciliation
- [x] 性能验收：snapshot 中位 81ms→1ms，达成 monitor 域 <20ms 目标

**已完成（第二切片，skill 规则治理）**
- [x] App.tsx 解构：薄壳 + pages/{monitor,history,codex,settings} + components/ui + lib/labels + controls
- [x] React.lazy 分包：主 chunk 234KB→198KB，页面按需加载 5–13KB
- [x] memo 化 PostRow/ResetChainCard；useDeferredValue 热力图与统计
- [x] eventStatistics 单遍 O(n) 改写 + selectVisiblePosts 纯函数（js-combine-iterations）
- [x] 长列表 content-visibility + contain-intrinsic-size
- [x] dashboard-model 纯函数单测 6 例

**附带修复（预置缺陷）**
- 设置页 tab 守卫错乱修复（cd70fbd 起：两个 developer pane、notifications 缺失、基础自检默认不可见）
- 打包 e2e 断言更新并首次跑通（1.2s）——该测试在 main 上因上述两个问题从未通过

**偏离说明**：五通道分域 IPC 暂缓——内存缓存使全量快照组装成本降至 ~1ms，分域收益从"性能必需"降级为"带宽优化"，留待后续迭代按需实施。

**涉及文件**：`renderer/src/**`（重组）、新增 `app/main/dashboard-service.ts`、preload 扩展
**验收**：FRONTEND-V2.md §8 四条全部满足；electron-security 测试继续绿（CSP/preload 断言不受影响）

**风险**：App.tsx 拆分回归面大 → 按 feature 页逐个迁移，每页一提交；contract 测试护航数据形状。

## P3 · Codex 自动化 2.0（3–4 天）✅ 核心已完成

**任务**（对应 CODEX-AUTOMATION-V2.md 全文）
- [x] Q1–Q3 探测完成并回填（推送✅/approvalPolicy✅/activeFlags 结构）；附带发现 `account/usage/read` 与 `rateLimitResetCredit/consume`
- [x] `CodexConnectionManager` 常驻连接替换冷启动（租约 + ping 健康检查 + 死亡单次重建，idle 90s 关闭）
- [x] 通知订阅 + 轮询兜底；`turnTimeoutMinutes` 设置项（5–120 分钟，超时前最终复核防误杀）
- [x] 审批检测 → `codex_resume_waiting_approval` 通知打通（activeFlags 含 approv 即触发一次）
- [x] `traceAutomation` dry-run + Codex 抽屉「运行预演」按钮（纯函数推演，不下发指令）
- [x] 审计字段扩展（phase/turnSummary/durationMs）；completed 通知附 turn 摘要
- [ ] 成功率聚合卡片（数据已具备，待 UI 迭代）

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
| 500 条记录连续 `put()` 总耗时 | **24,848 ms**（≈50ms/条，O(N²) 写放大）→ **P1 后 1,560 ms → P2 后 1,325 ms** ✅ | <2,000 ms（O(N) 增量索引） |
| snapshot() 组装耗时 @500 posts | 中位 81 ms / 最大 117 ms → **P2 后（暖缓存）中位 1 ms** ✅ | monitor 域 <20 ms |
| snapshot() 单次 IPC payload | **275 KB** | 分域后 monitor 域 <10 KB（见偏离说明） |
| 渲染层空闲 commit 次数 / 2min | 待测（payload 门控已消除无效重渲染） | 0 |

> 注：基线为空 store 冷启动 + 500 posts 场景；analyses/events 增多后 snapshot 耗时将线性恶化（details 全量序列化）。

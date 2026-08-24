# 架构决策记录（ADR）

> 状态：提案（待审查）。每条记录决策、备选方案与理由；审查时可逐条否决。

## ADR-1 · 存储继续用 JSON 文件，不引入 SQLite

- **决策**：保持 JSON 记录 + JSONL 索引，以增量追加（ARCHITECTURE §4）解决写放大。
- **备选**：better-sqlite3 / SQLite WASM。
- **理由**：单机数据量（seenPostIds 上限 1 万、观测 35 天）远未到关系库收益区；原生模块会破坏 electron-builder 的 asar 与签名发布链路；现有 quarantine/原子写/串行队列已验证可靠。
- **触发重估条件**：任一 store 常态 >5 万条或需要复杂查询。

## ADR-2 · 演进式拆分 RuntimeController，不重写

- **决策**：绞杀者模式逐个抽出四个服务（ARCHITECTURE §3），门面保留委托。
- **备选**：一次性重写主进程编排层。
- **理由**：该类承载大量隐式时序约束（启动顺序、恢复流程、定时器生命周期）；重写回归面不可控。拆分期间每步 verify + e2e 可护航。

## ADR-3 · IPC 从单快照改为分域修订号通道

- **决策**：`dashboard:revision` 轻量轮询 + 按需拉域；旧 `dashboard:get` deprecated 但保留。
- **备选**：主进程推送（webContents.send 广播变更）。
- **理由**：拉取模式让渲染层完全掌控节奏，天然幂等、易测试；推送需要处理窗口未就绪/背压，复杂度不成比例。若 P2 验收后仍有延迟敏感场景再引入推送。

## ADR-4 · 前端遵循 vercel-react-best-practices，按 Electron 场景裁剪

- **决策**：规则映射见 FRONTEND-V2.md；SKIP 项均注明理由。
- **关键裁剪**：CSP 已禁 inline script → 不采用 `rendering-hydration-no-flicker` 的 inline script 方案；React `Activity` 实验特性暂不用。

## ADR-5 · Codex 连接常驻化，协议探测失败自动降级

- **决策**：CodexConnectionManager 租约模型；事件订阅不可用时回退自适应轮询（CODEX-AUTOMATION-V2 §4、§9）。
- **理由**：冷启动成本集中在 PowerShell 探测 + Node 进程初始化；租约使采样/扫描/恢复共享一条 stdio。降级路径保证对 codex 版本差异鲁棒。

## ADR-6 · Dry-run 物理隔离

- **决策**：dry-run 由纯函数 `traceAutomation` 实现，代码路径不含任何客户端调用（CODEX-AUTOMATION-V2 §5）。
- **理由**："绝不写入"不能靠约定，要靠结构保证——review 时 grep 可验证。

## ADR-7 · 数据契约只增不改

- **决策**：`schemaVersion: 1` 不变；审计等记录只追加可选字段；旧 `dashboard:get` 保留一个版本周期。
- **理由**：用户本地数据无迁移工具链，兼容是硬约束；v2-migration 备份机制仅用于灾难恢复，不作为常规升级路径。

## ADR-8 · 自动化安全边界维持并显式化（否决项备忘）

- **否决**：自动批准审批、并行多 turn、向运行中任务追加指令、读取失败时自动加速消耗。
- **理由**：README 对用户的承诺（"不会暂停、终止或追加指令"）是产品信任基石；所有新能力必须能通过"这条会不会在用户不知情时动他的任务？"检验。

## ADR-9 · 测试金字塔不变，新增两类护栏

- **决策**：P0 加 dashboard contract 快照测试；P1/P3 各加 FakeTransport/FakeStore 集成测试。
- **理由**：重构最大的风险是行为漂移——先锁形状再动刀。

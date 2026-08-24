# 目标架构（Ox Alpha 版）

## 1. 现状与问题映射

| # | 现状问题 | 位置证据 | 本设计的应对 |
|---|----------|----------|--------------|
| A1 | `RuntimeController` 承担存储、监控、通知、Codex 编排、仪表盘组装五种职责，1955 行 | `app/main/runtime-controller.ts` | 拆为四个协作服务（§3） |
| A2 | `dashboard:get` 每 2s 全量读盘 + 全量 IPC 序列化（6 个 store 的全部记录 + details 全量 payload + 目录递归求大小） | `runtime-controller.ts:883-892,1016-1061`；`renderer/src/main.tsx:18` | 快照修订号 + 分域通道（§5） |
| A3 | 每次插入记录全量重建索引，O(N²) I/O | `file-store.ts:92-93` | 增量索引追加 + 维护期压缩（§4） |
| A4 | Codex 客户端每次操作冷启动一个进程 | `runtime-controller.ts` `#codexClient()` | 常驻连接管理器（CODEX-AUTOMATION-V2 §3） |
| A5 | turn 等待靠 1s 轮询、10min 硬编码超时 | `app-server.ts:175-192` | 事件订阅优先 + 可配置超时（CODEX-AUTOMATION-V2 §4） |
| A6 | 渲染层整树重渲染：2414 行单文件组件 + 每 2s 替换整个 model | `renderer/src/App.tsx`；`main.tsx:13-23` | FRONTEND-V2.md 全套规则治理 |
| A7 | AI 失败的灰色帖子永久丢失、AI 重试无退避 | `scheduler.ts:125-128`；`pipeline.ts:61-92` | 复核队列 + 退避重试（§6） |

## 2. 保持不变的部分

- 分层原则：`domain`（纯逻辑、可测试）← `adapters`（外部边界）← `main`（编排）
- 存储格式：JSON 记录文件 + JSONL 索引 + quarantine 隔离
- 规则引擎 `rules-v1` 与 AI 结构化输出契约
- Electron 安全基线（sandbox / contextIsolation / 权限拒绝 / 导航拦截）
- 既有 IPC channel 名称继续可用（渲染层渐进迁移）

## 3. 主进程拆分

```
RuntimeController（保留为门面，<300 行）
├── MonitoringService        轮询编排、逐帖处理、复核队列
├── CodexAutomationCoordinator  授权恢复、门禁互斥、预测定时、dry-run
├── DashboardService         分域快照组装、修订号管理
└── NotificationHub          dispatcher 持久化实例 + 渠道工厂（已实现于 robustness-polish）
```

职责边界：

| 服务 | 输入 | 输出 | 持有状态 |
|------|------|------|----------|
| MonitoringService | PollScheduler 回调的 posts | events / analyses 写入请求、通知消息 | 处理中警告、失败复核队列 |
| CodexAutomationCoordinator | ResetEvent（confirmed/expected）、手动指令、设置变更 | resume 审计记录、恢复类通知 | in-flight 表、resume 互斥锁、预测定时器 |
| DashboardService | 各 store list() | 分域快照（monitor/history/codex/audit） | 各域修订号、LRU 缓存 |
| NotificationHub | NotificationMessage | Notification[] 记录 | delivered 集、熔断状态 |

迁移策略：**绞杀者模式**——新服务逐个从 RuntimeController 中抽出，门面方法委托转发，每抽出一个服务跑一次全量 verify。不一次性大改。

## 4. 存储层：增量索引

现状：`put()` → `rebuildIndex()` → `list()` 全量读取。目标：

```ts
// file-store.ts 新增内部方法
async appendIndex(id: string, createdAt: string, contentHash: string): Promise<void>
// 追加一行到 indexes/<collection>.jsonl（fs.appendFile，O(1)）
async compactIndex(): Promise<number>   // 全量重建，仅由 maintainStorage() 调用
```

- `put()` 改为：写记录文件 → `appendIndex`（同一串行队列内）
- `deleteWhere` 后仍走 `compactIndex`
- 索引读取端容忍重复行（以最后一条为准），保证追加期间崩溃可自愈
- 启动时若索引缺失或行数与目录文件数不符 → 自动 compact 一次

## 5. IPC 契约：单快照 → 分域通道

| 通道 | 内容 | 频率 | 数据量级 |
|------|------|------|----------|
| `dashboard:revision` | `{ revision }` | 渲染层 2s 轮询 | 几十字节 |
| `dashboard:monitor` | 服务状态、基线、信号预测、resetCredits | revision 变化时拉取 | KB 级 |
| `dashboard:history` | posts 列表 + 分页 details | 打开历史页/显式刷新时 | 按需分页 |
| `dashboard:codex` | threads、settings、resumes 审计 | 打开 Codex 页时 + 变更推送 | KB 级 |
| `dashboard:audit` | notifications/events 详情（分页） | 打开审计页时 | 按需 |

规则：

- 每个域独立维护 `revision`；任何写入该域 store 的操作递增对应修订号
- 渲染层轮询只拿 revision，变了才拉对应域 —— 空闲时 IPC 从 ~50KB/2s 降到 <100B/2s
- 旧 `dashboard:get` 保留一个版本周期，标记 deprecated
- `directorySize` 移出轮询路径，仅在 `storage:status` 显式调用时计算

## 6. 监控链路补强（收敛审查遗留项）

1. **失败复核队列**（M7）：AI 分析失败的帖子进入 `MonitoringService.#pendingReview`（内存 Map + 持久化游标），下一轮 poll 成功后优先补审，最多重试 3 次
2. **AI 重试退避**（M6）：`AnalysisPipeline` 尝试间加指数退避（1s→4s），HTTP 401/403/400 不重试；复用 signal 前 check `signal.aborted`
3. **设置读取校验**（M11）：`codexResumeSettings()` 读出后过一遍 `validateAutomationSettings`，非法值回退默认并置 startupWarning
4. **时间单位归一化**（M12）：`app-server.ts` rateLimits 解析处统一秒→毫秒换算，写观测前归一

## 7. 数据流总览（目标态）

```
FxTwitter ──> PollScheduler ──> MonitoringService ──┬─> stores (posts/analyses/events)
                              规则引擎 v1 │          └─> NotificationHub ─> Windows/飞书/Webhook
                                    AI 管线(退避+缓存+复核队列)
                                                     │
                          confirmed/expected event   ▼
                                  CodexAutomationCoordinator ─> CodexConnectionManager ─> codex.exe
                                  （dry-run / 门禁互斥 / started 先行审计 / 审批检测）
                                                     │
                          DashboardService <── stores ┘
                           分域修订号 ──IPC──> React 渲染层（FRONTEND-V2.md）
```

# Tibo Watch 确定性路线图

> 状态：需求已确认，允许进入实现  
> 产品形态：Windows 优先、本地优先、开源桌面应用  
> 项目目录：`D:\Code\Github\tibo-watch`  
> 本文用途：作为 Codex Goal 模式的唯一主路线图；Goal 应按阶段顺序持续推进、验证并更新复选框。

## 1. 最终目标

构建一个只监控 Tibo（`@thsottiaux`）公开发言的本地个人助手：

1. 低频、可靠地获取 Tibo 的原创帖、回复和引用帖。
2. 使用固定且可复现的 `rules-v1` 初筛重置相关信号。
3. 仅对候选帖子调用用户自行配置的 DeepSeek API。
4. 给出中文翻译、事件类型、预计时间区间、置信度、判断依据和原文链接。
5. 通过 Windows 桌面通知、飞书 webhook 或通用 HTTP webhook提醒用户。
6. 在本地监控大屏展示状态、历史事件、重置次数统计和日历热力图。
7. 不依赖中心服务器，不消耗用户的 Codex 或 Claude Code token。

## 2. 不可变产品决策

以下内容除非用户明确修改需求，否则 Goal 模式不得自行改变：

- 技术栈：Electron + React + TypeScript，Windows 首发。
- 新项目与 `D:\Test\Tido` 旧服务端项目完全隔离，不复制旧项目代码或配置。
- 无中心服务器、无账号系统、无云同步、无遥测、无邮件订阅。
- 本地数据使用 JSON、JSONL 和自动生成的 Markdown，不使用 SQLite。
- 不提供用户笔记功能。
- DeepSeek 为 MVP 的 AI 分析服务，用户自行提供 API Key。
- 监控、规则筛选、统计和通知不得调用 Codex 或 Claude Code。
- Codex MCP/hook 集成和 Claude Code Channels 均为后续路线图，不属于 MVP。
- `codexreset.org` 及同类网站只能用于开发期研究，不得成为客户端运行时依赖、数据源、备用源或界面链接。
- 没有有效近期信号时显示“暂无可靠预测”，不得仅按历史间隔生成虚假概率。
- 固定 `rules-v1`；规则不能由用户或 AI 在运行时修改。
- 新规则只随 GitHub Release 发布；保留规则接口、历史手动重放和失败回退能力。
- 所有中文源码、配置、文档、日志和产物使用 UTF-8。

## 3. MVP 用户体验

### 3.1 首次启动

1. 显示隐私说明：所有数据留在本机，仅主动配置的外部接口会收到请求。
2. 引导用户配置 DeepSeek API Key，并执行不包含真实帖子内容的连接测试。
3. 选择数据源端点；默认提供 FxTwitter 适配器，并允许自定义兼容端点。
4. 配置 Windows 桌面通知；飞书和通用 HTTP webhook 可选。
5. 完成一次数据源测试和模拟通知测试后进入大屏。

### 3.2 日常运行

- 默认每 5 分钟检查一次。
- 出现活跃信号后，每 1 分钟检查一次，最多持续 1 小时。
- 失败时指数退避，最大间隔 30 分钟。
- 同一帖子和同一判断版本只分析一次、只通知一次。
- 只有事件类型、预计区间或置信等级发生实质变化时才发送更新通知。
- 所有网络请求均可在本地请求日志查看；用户可分别关闭数据源、AI 和 webhook 请求。

### 3.3 大屏区域

大屏必须包含：

1. 监控健康：最后检查时间、数据源状态、连续失败次数、当前轮询间隔。
2. 24/48 小时判断：有有效信号时显示估计；无有效信号时显示“暂无可靠预测”。
3. 最新判断：事件类型、预计时间区间、置信度、中文摘要和原文链接。
4. 判断依据：命中的固定规则、AI 依据、范围与不确定性。
5. 最近帖子：采集状态、是否命中规则、是否调用 AI、是否形成事件。
6. 历史重置事件时间线。
7. 重置次数统计：全部、近 7 天、近 30 天，并按 forced、compensation、banked 分类。
8. 日历热力图：按本地日期显示已确认事件数量；悬停展示事件标题、UTC 时间和类型。

次数统计与日历图只描述已确认历史事件，不参与未来时间预测。

## 4. 目标仓库结构

```text
tibo-watch/
  ROADMAP.md
  README.md
  LICENSE
  package.json
  app/
    main/                 Electron 主进程
    preload/              最小权限 IPC 桥
    renderer/             React 界面
    domain/               纯领域模型与状态机
    adapters/
      sources/            FxTwitter 与自定义兼容源
      ai/                 DeepSeek 适配器
      notifications/      Windows、飞书、HTTP webhook
      credentials/        Windows 凭据存储
      storage/            JSON/JSONL/Markdown 文件存储
    rules/                只包含已发布的 rules-v1 运行时代码/数据
  research/
    README.md
    sources/              二级线索与一手来源清单
    dataset/              标注数据、来源 ID 和短摘录
    scripts/              研究与规则评估工具
    reports/              precision/recall、混淆矩阵、误报漏报
  schemas/                版本化 JSON Schema
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  scripts/
    verify-runtime-boundary.*
    verify-release.*
```

`research/` 永不进入 Electron 打包输入。构建验证必须扫描最终产物，确保不存在研究网站域名、研究脚本或研究数据文件。

## 5. 数据与接口契约

### 5.1 文件布局

运行数据位于 Electron 的用户数据目录：

```text
data/
  posts/<post-id>.json
  analyses/<post-id>/<analysis-version>.json
  events/<event-id>.json
  indexes/posts.jsonl
  indexes/analyses.jsonl
  indexes/events.jsonl
  reports/<event-id>.md
  logs/requests/<yyyy-mm-dd>.jsonl
  state/runtime.json
```

约束：

- 每条事实记录独立保存，避免单个巨大 JSON。
- 所有记录包含 `schemaVersion`、`createdAt`、`source` 和内容哈希。
- JSON 是事实来源；Markdown 报告是可重建展示产物。
- 所有写入通过单写入队列完成，先写临时文件，再原子替换。
- JSONL 索引可从独立记录重建；索引损坏不得导致事实记录丢失。
- 导出不得包含 API Key、webhook 密钥或凭据引用的可逆内容。

### 5.2 规则接口

```ts
interface RuleEngine {
  readonly version: string
  readonly schemaVersion: number
  evaluate(post: NormalizedPost): RuleResult
}
```

`RuleResult` 至少包含：

- `candidate: boolean`
- `matchedRuleIds: string[]`
- `reasons: string[]`
- `inputHash: string`
- `ruleVersion: string`

### 5.3 分析结果

AI 必须返回经过 schema 校验的结构化结果：

- 相关性：相关、相关但非重置、无关。
- 事件类型：已完成、明确未来、模糊意向、非事件。
- 影响范围：Codex、ChatGPT Work、付费用户、指定方案或未知。
- 预计时间：开始、结束、原始时间表达和时区假设。
- 置信等级：低、中、高；不得只给无解释数字。
- 中文翻译、简短摘要、依据列表、不确定性和原帖 URL。
- 使用的规则版本、提示词版本、模型标识和响应哈希。

## 6. Goal 模式执行规则

Goal 模式应遵守以下工作协议：

1. 严格按阶段顺序推进；只有依赖已完成的阶段才能开始。
2. 每完成一个任务，立即更新本文对应复选框和证据。
3. 不因普通实现选择暂停；采用本路线图推荐值并继续。
4. 仅在需要用户新权限、真实密钥、付费操作、发布到外部或需求冲突时请求用户。
5. 每一阶段必须记录：改动文件、验证命令、退出状态和未解决风险。
6. 测试命令开始运行不等于通过；只有退出码为 0 且结果符合预期才可勾选。
7. 不得为了通过测试删除、弱化或跳过验收条件。
8. 保持改动最小，不重构无关区域。
9. 发现路线图与事实冲突时，先记录阻塞证据，不得静默改变产品决策。
10. MVP Definition of Done 全部满足前，不得将目标标为完成。

## 7. 分阶段实施计划

### Phase 0：仓库与工程基线

目标：建立独立、可验证、可持续开发的项目骨架。

- [x] 初始化独立 Git 仓库，默认分支为 `main`。
- [x] 创建 README、开源许可证、贡献指南和安全说明。
- [x] 建立 Electron + React + TypeScript 工程，使用 Vite 构建前端。
- [x] 配置 ESLint、Prettier、TypeScript strict、Vitest 和 Playwright。
- [x] 配置 Windows 安装版与便携版构建，发布工具采用 electron-builder。
- [x] 固定依赖版本并提交锁文件。
- [x] 建立 `research/` 与 `app/` 的构建边界检查。
- [x] 建立 CI：类型检查、lint、单元测试、集成测试、构建和边界扫描。

验收：

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 全部退出 0。
- Windows 安装版和便携版均能启动空白壳应用。
- 最终打包产物不包含 `research/`。

实施记录（2026-08-09）：

- 改动文件：`package.json`、`package-lock.json`、TypeScript/Vite/ESLint/Vitest/Playwright 配置、`app/` 空壳、`tests/`、`scripts/verify-runtime-boundary.mjs`、`.github/workflows/ci.yml` 及基础文档。
- 验证：`npm run verify` 退出 0；类型检查、lint、1 个单元测试、渲染端与 Electron 编译、运行时边界扫描均通过。
- 验证：通过 npmmirror 下载固定的 Electron 43.3.0 与 electron-builder 工具后，`npm run dist:win` 退出 0；生成 NSIS 安装版、便携版和未打包目录，边界由显式 `files` 白名单保证。
- 验证：`npm run test:e2e` 退出 0，Playwright 实际启动未打包 Windows 应用并确认标题和“暂无可靠预测”空状态。
- 验证：`npm run test:portable` 退出 0，便携启动器成功展开应用，新进程稳定存活后仅清理本次 PID。
- 验证：`npm run test:installer` 退出 0，在 `release/verification-install` 完成静默安装、应用启动、静默卸载与目录清理闭环。
- 验证：ASAR 路径扫描退出 0，最终 `app.asar` 不包含 `research` 或 `codexreset.org`。
- 未解决风险：安装包暂未签名并使用默认 Electron 图标，按路线图分别留待 Phase 7 发布安全与后续视觉资产处理；不影响 Phase 0 工程基线验收。
- 阶段结论：Phase 0 验收通过，可以进入 Phase 1。

### Phase 1：历史样本研究与 rules-v1

目标：通过近期完整样本及已知历史事件生成固定、可解释的初筛规则。

- [x] 收集 Tibo 最近 6 个月的原创帖、回复和引用帖，排除纯转推。
- [x] 将 codexreset.org 及类似站点仅作为二级线索，回溯到 X、OpenAI Status 或官方帮助页面。
- [x] 对无法回溯的一手来源标记 `unverified_secondary`，不得作为强正样本。
- [x] 标签：已完成、明确未来、模糊意向、相关但非重置、完全无关。
- [x] 额外标签：预计时间、影响范围、确定性、父帖语境、是否反讽/拒绝/玩笑。
- [x] 建立正样本、困难负样本和近似措辞反例。
- [x] 从数据中生成 `rules-v1`，不凭预设关键词直接定案。
- [x] 每条规则至少配一个正样本和一个反样本。
- [x] 输出混淆矩阵、precision、recall、误报列表和漏报列表。
- [x] 冻结规则版本、schema、测试集哈希和研究报告。

验收：

- 所有已验证的“明确完成”和“明确未来”样本不得漏报。
- 模糊意向可进入 AI 候选，但不得直接建立已确认事件。
- 研究数据只保存必要短摘录、帖子 ID、时间、标签、理由和原始链接，不打包第三方页面副本。
- `rules-v1` 在同一输入上输出确定一致的结果。

实施记录（2026-08-09，进行中）：

- 改动文件：`research/sources/README.md`、`research/dataset/README.md`、`research/scripts/collect-reset-leads.mjs`、`research/scripts/validate-provisional-dataset.mjs`、`research/dataset/reset-leads.provisional.json`、`research/reports/provisional-dataset.md`。
- 数据证据：从二级时间线只提取候选帖子 ID，再逐条使用 FxTwitter Status API 回溯 X 原帖；已核验 35 条最近六个月候选，作者、正文、UTC 时间、帖子类型、原帖链接和正文 SHA-256 均已记录。
- 验证：`npm run research:validate` 退出 0；35 条记录唯一且均回溯到 `@thsottiaux` 原帖，数据集 SHA-256 为 `6490757ed500bb82be1bbec997e68d1cc80319465875ca1c22a57bc7499a1dde`。
- 验证：`npm run verify` 退出 0；研究脚本与数据未进入 Electron 构建输入。
- 覆盖结论：FxTwitter 单一连续搜索范围 `2026-02-09..2026-07-23` 共 75 页并以空页结束；其后 17 个完整 UTC 日期分片连续覆盖到 2026-08-09，当前日由用户时间线补齐。所有请求使用持久游标断点续传，不重复已完成页面。
- 登录恢复记录：用户于 2026-08-09 完成 X 登录；已从 `@thsottiaux/with_replies` 捕获一段连续时间线，并将浏览器捕获与单帖 API 回溯分离，避免保存会话或页面副本。
- 困难样本：已回溯、去重并复核 1,684 条 `@thsottiaux` 时间线样本，其中回复 1,266、原创 259、引用 159；时间范围为 2026-02-09T22:21:01Z 至 2026-08-09T07:25:47Z，复核集 SHA-256 为 `686a28ce92bf19e2dbeb243ee6ac09ea2b21f9f51472ba9fb3d05055c7def378`。
- 上下文证据：帖子 `2080859954421047341` 的正文仅为 `There is still time`，父帖才包含“No Codex or Claude resets today”；候选评估必须显式组合帖子、父帖和引用帖，且父帖中的 `reset` 不得脱离回复意向单独触发。
- 引用语境修复：评估器已统一读取数据集真实字段 `quotedContext`；普通规则只读取主帖正文，只有显式上下文规则可读取父帖/引用帖，并且必须同时满足主帖意向结构，防止父帖关键词污染预测。
- 否定反例：帖子 `2071329580829319493` 明确写明降级套餐 `will not reset things for you`，人工标为“相关但非重置”，并在回归中保持非候选。
- 冻结规则：`app/rules/rules-v1.ts` 固定为 `rules-v1.0.0`、schema 1 和上述测试集哈希；13 条规则均记录正样本与反例。1,684 条完整集的混淆矩阵为 TP=58、FP=0、FN=0、TN=1626，precision=1.0000、recall=1.0000。
- 运行时一致性：研究评估器逐条调用冻结运行时引擎并比对候选结果与命中规则；任一差异或测试集哈希漂移都会使门禁失败。报告位于 `research/reports/candidate-rules-v1.md`。
- 验证：`npm run research:enrich-timeline`、`npm run research:apply-reviews` 和 `npm run verify` 均退出 0。
- 验证：`npm run research:evaluate-candidate` 和 `npm run verify` 均退出 0。
- 数据门禁：`npm run research:verify` 统一验证 35 条一手正候选、1,684 条原始/富化/复核时间线 ID 一致性、五类标签、强正样本字段、API 覆盖连续性和冻结规则混淆矩阵；当前零一致性失败。报告位于 `research/reports/timeline-validation.md`。
- 覆盖证据：`research/dataset/timeline-coverage.json` 已记录首个完整搜索分片 `from:thsottiaux since:2026-06-27 until:2026-06-28 -filter:retweets`；25 个唯一结果均已捕获，额外滚动后集合不变，且 `scrollY + innerHeight` 已到 `scrollHeight`。验证脚本会拒绝缺少终点证据、计数不符或未进入原始捕获的完整分片。
- 覆盖门禁：`fxtwitter-range-coverage.json` 与 `fxtwitter-search-coverage.json` 提供连续范围空页终点、逐日终点和无日期缺口证据；浏览器分片只作为交叉核验，不再承担主要采集。
- 阶段结论：Phase 1 的数据、标注、反例、指标、版本、schema、测试集哈希、报告和确定性回归均已满足，可进入 Phase 2。
- 正样本复核：35 条候选已全部依据 X 原帖正文重新人工标注，其中已完成 20、明确未来 14、模糊意向 1；修正了二级线索把 `will reset`、`incoming`、`lands` 等未来表达误标为已完成的问题，并保留原始时间表达、范围、确定性和玩笑属性。复核集 SHA-256 为 `e6287032ce7afe2c3c895aed5a23f19f7d38a9731f7a7c39ad9f3693484f62a9`。
- 验证：`npm run research:review-leads` 与后续 `npm run verify` 均退出 0。

### Phase 2：领域模型与文件存储

目标：建立不依赖 UI 和网络的核心状态机与可靠文件存储。

- [ ] 实现 Post、Analysis、ResetEvent、Notification、RuntimeState schema。
- [ ] 实现独立 JSON 记录、JSONL 索引和 Markdown 报告生成器。
- [ ] 实现单写入队列、原子替换、幂等键和内容哈希。
- [ ] 实现索引重建、损坏隔离、备份和 JSON 导入导出。
- [ ] 实现事件状态机，区分候选、预计、已确认、已否定和已过期。
- [ ] 实现同帖去重和判断版本去重。
- [ ] 实现固定 `RuleEngine` 加载器和上一版回退接口。

验收：

- 模拟进程中断后不存在半写入事实文件。
- 删除全部索引后可以从记录文件完整重建。
- 重复摄入同一帖子不会产生重复分析、事件或通知。
- Markdown 报告可从 JSON 重新生成且内容一致。

### Phase 3：数据源和调度器

目标：低负载获取 Tibo 新帖，并对限流与断网保持克制。

- [ ] 定义 `PostSourceAdapter` 接口。
- [ ] 实现 FxTwitter 适配器和自定义兼容端点适配器。
- [ ] 只采集 `@thsottiaux` 的原创帖、回复和引用帖，排除转推。
- [ ] 默认 5 分钟轮询；活跃信号后 1 分钟轮询 1 小时。
- [ ] 实现指数退避、抖动、超时、取消、断网恢复和请求去重。
- [ ] 实现 ETag/Last-Modified/最后帖子 ID 等可用的条件请求策略。
- [ ] 将每次请求的时间、目标类别、状态码、耗时和结果数量写入脱敏日志。
- [ ] 提供数据源连接测试和模拟响应测试。

验收：

- 连续运行测试不会并发发起重复轮询。
- 429、5xx、超时和无网络均会退避，不形成请求风暴。
- 日志不得记录 API Key、完整 webhook 密钥或凭据值。
- 数据源失效时大屏明确显示过期状态，不继续展示为“实时”。

### Phase 4：DeepSeek 分析管线

目标：只对规则候选调用 AI，并产生可验证的结构化中文报告。

- [ ] 定义 `AnalysisProvider`，实现 DeepSeek OpenAI 兼容接口适配器。
- [ ] API Key 存入 Windows Credential Manager；应用数据只保存不可逆脱敏提示。
- [ ] 实现不发送真实帖子内容的 API 连通性测试。
- [ ] 规则未命中的普通帖子不得调用 AI。
- [ ] 同一帖子、规则版本、提示词版本和模型组合只调用一次。
- [ ] 使用 JSON Schema 校验响应，失败时有限重试并保留错误证据。
- [ ] 输出中文翻译、区间、不确定性、原文链接和判断依据。
- [ ] 用户可手动请求对任意单帖分析；手动调用有明确确认提示。

验收：

- 普通无关样本的 AI 调用次数为 0。
- 缓存命中时 AI 调用次数为 0。
- 非法或缺字段响应不会建立事件或发送真实通知。
- API Key 不出现在日志、导出、崩溃报告和渲染进程状态中。

### Phase 5：通知系统

目标：可靠通知用户，同时避免重复和误报扩散。

- [ ] 定义 `NotificationChannel` 接口。
- [ ] 实现 Windows 桌面通知。
- [ ] 实现飞书 webhook。
- [ ] 实现通用 HTTP webhook，支持最小必要的头部配置。
- [ ] 实现逐渠道启停、测试通知、超时、有限重试和结果记录。
- [ ] 实现通知幂等键和实质变化判断。
- [ ] 通知正文包含中文摘要、预计区间、不确定性和 X 原帖直链。
- [ ] 测试通知不得进入真实事件统计。

验收：

- 同一事件同一版本每渠道最多成功发送一次。
- 某一渠道失败不阻塞其他渠道。
- webhook 目标和凭据在 UI 与日志中脱敏。
- 模拟通知测试完全不访问真实外部服务。

### Phase 6：监控大屏与详情页

目标：完成 codexreset.org 风格但独立实现的本地数据大屏。

- [ ] 实现监控健康卡片。
- [ ] 实现 24/48 小时判断卡；无有效信号时显示“暂无可靠预测”。
- [ ] 实现最新判断与依据面板。
- [ ] 实现最近帖子列表及筛选状态。
- [ ] 实现历史事件时间线。
- [ ] 实现重置次数统计：全部、近 7 天、近 30 天、按类型分组。
- [ ] 使用轻量 CSS Grid/SVG 实现日历热力图，不引入重量级图表框架。
- [ ] 日历默认按系统本地时区分组，详情始终同时显示 UTC 时间。
- [ ] 实现帖子、分析、事件、通知详情页。
- [ ] 实现设置页和本地请求日志查看器。
- [ ] 所有外部文本均按不可信内容转义，不允许注入 HTML。

验收：

- 统计数字可从事件 JSON 独立重算并完全一致。
- 跨时区午夜附近的事件在本地日历和 UTC 详情中显示正确。
- 同一天多个事件的热力值和 tooltip 数量正确。
- 无有效信号、数据过期、AI 未配置和数据源失败均有明确空状态。
- 键盘导航、焦点、颜色对比和高 DPI Windows 显示通过检查。

### Phase 7：更新、边界与安全

目标：实现可控的软件升级，并证明研究内容不会进入运行时。

- [ ] 通过 GitHub Releases 自动检查新版本，由用户确认后下载和安装。
- [ ] 更新不得静默安装。
- [ ] 发布安装版、便携版和 SHA-256 校验文件。
- [ ] 未获得代码签名证书前，在 README 和发布说明解释 SmartScreen 提示。
- [ ] 规则升级默认只影响新帖子；历史重放必须由用户手动触发。
- [ ] 新旧规则重放结果并列展示，不覆盖旧分析。
- [ ] 新规则校验或运行失败时回退到内置上一版。
- [ ] 扫描最终 ASAR、resources 和安装包内容，禁止包含 `research/` 及研究站点域名。
- [ ] 完成 Electron 安全基线：sandbox、contextIsolation、禁用 renderer Node、最小 IPC、严格 CSP。

验收：

- 离线时更新检查失败不会影响监控。
- 被篡改的规则或更新元数据不会被加载。
- 最终运行包中不存在 codexreset.org 或同类研究站点字符串及抓取代码。
- 渲染进程无法直接读取凭据或任意文件。

### Phase 8：端到端验证与 MVP 发布

目标：证明 MVP 在真实 Windows 环境中可持续运行并可公开发布。

- [ ] 建立完整模拟数据链：新帖 → 规则 → AI 模拟 → 事件 → 通知 → 大屏。
- [ ] 使用历史测试集回放全部关键正反样本。
- [ ] 执行 24 小时加速调度测试，检查请求频率、退避、缓存和内存增长。
- [ ] 在 Windows 安装版和便携版分别完成首次启动、升级、卸载和数据保留测试。
- [ ] 使用真实 FxTwitter 数据源执行只读冒烟测试。
- [ ] 使用用户提供的 DeepSeek Key 执行一次明确确认的真实候选分析测试。
- [ ] 真实飞书或 HTTP webhook 测试必须由用户明确提供目标并授权。
- [ ] 完成用户文档、隐私说明、故障排查和数据导出说明。
- [ ] 创建 GitHub Release 草稿，等待用户批准后再公开发布。

验收：

- 所有 CI 和 Windows 本机验证命令退出 0。
- 没有高优先级已知缺陷、密钥泄露、重复通知或运行时研究站点依赖。
- MVP Definition of Done 全部满足。

## 8. MVP Definition of Done

只有以下条件全部满足，Goal 模式才能标记目标完成：

- [ ] Windows 安装版和便携版可启动、监控、退出并恢复状态。
- [ ] `rules-v1` 有可复核数据集、报告、版本和回归测试。
- [ ] 普通无关帖子不会调用 DeepSeek。
- [ ] 有效候选可生成结构化中文判断和原文链接。
- [ ] 桌面通知、飞书和通用 webhook 均有模拟测试；真实渠道按授权测试。
- [ ] JSON/JSONL/Markdown 存储可重建、可导出且不含秘密。
- [ ] 大屏包含重置次数统计和日历热力图，统计与事件记录一致。
- [ ] 无有效信号时不显示伪造概率。
- [ ] 客户端无中心服务器、账号、遥测、邮件和用户笔记。
- [ ] 客户端运行时不访问或包含 codexreset.org 及同类研究网站。
- [ ] Codex/Claude Code 集成未进入 MVP，监控不会消耗其 token。
- [ ] README、隐私、安全、安装和故障排查文档齐全。
- [ ] 所有验证命令及退出状态已记录。

## 9. 后续版本路线图（不得提前进入 MVP）

### V1.1：Codex 集成

- 只读 MCP 工具：查询当前状态、事件和详细依据。
- 可选 `UserPromptSubmit` hook：仅在新高价值事件出现后注入一次极短摘要。
- 默认不接管用户的 Codex CLI，不自动发起模型请求。

### V1.2：Claude Code 集成

- 只读 MCP 查询工具。
- Claude Code Channels 仅作为实验功能、默认关闭。
- 明确提示 Channels 可能触发模型处理并消耗 token。

### V1.3：规则升级

- 发布 `rules-v2`，展示相同测试集上的差异报告。
- 继续通过应用 Release 分发，不建立独立在线规则服务。
- 保留旧规则和旧分析，支持用户手动历史重放与回退。

## 10. 已知风险与既定处理

| 风险 | 处理方式 |
|---|---|
| FxTwitter 限流或接口变化 | 适配器隔离、自定义端点、退避、健康状态；不请求研究网站兜底 |
| Tibo 使用隐喻、玩笑或回复语境 | 近期全量样本、父帖语境、困难负样本、AI 二次分类 |
| AI 输出不稳定 | 固定提示词版本、schema 校验、缓存、失败不建事件 |
| 文件存储损坏 | 独立记录、原子替换、索引可重建、备份和哈希 |
| webhook 泄密 | Windows 凭据存储、最小权限、日志脱敏、导出排除 |
| 历史统计造成周期错觉 | 统计与预测分离；无信号时明确不预测 |
| Electron 资源占用 | 后台隐藏窗口、低频调度、轻量热力图、内存长期测试 |
| Windows 未签名提示 | SHA-256、透明说明；获得证书后再加入签名流程 |
| 研究资料进入客户端 | 构建边界、产物扫描、CI 失败门禁 |

## 11. Goal 启动建议

建议创建 Goal 时使用以下目标文本：

> 严格依据 `D:\Code\Github\tibo-watch\ROADMAP.md`，从 Phase 0 开始持续实现 Tibo Watch MVP。按阶段更新路线图复选框，记录改动、验证命令与退出状态；在需要新权限、真实密钥、付费或外部发布前暂停请求用户。只有 MVP Definition of Done 全部满足后才标记 Goal 完成。

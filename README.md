# Tibo Watch

[![CI](https://github.com/Dopetaiga/tibo-watch/actions/workflows/ci.yml/badge.svg)](https://github.com/Dopetaiga/tibo-watch/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/platform-Windows-1677ff)
![Version](https://img.shields.io/badge/version-0.2.0-222222)
![License](https://img.shields.io/badge/license-MIT-2f855a)

Tibo Watch 是一个 Windows 本地桌面助手，专门追踪 Tibo（[`@thsottiaux`](https://x.com/thsottiaux)）公开发布的 Codex 额度重置信号。

它将零散的帖子整理成可审计的事件链，给出最近一次确认重置、下一次周基线和可选的 AI 预测，并能在用户逐任务授权后安全地继续已有 Codex 任务。

> 当前处于 V2 个人体验测试阶段。项目默认本地运行，不提供中心服务器、账号系统、遥测或云同步。

## 为什么需要它

Tibo 的重置消息可能是正式公告，也可能藏在回复、玩笑或类似 “Enjoy a nice reset” 的非标准表达中。只看关键词容易误报，只依赖 AI 又会增加成本并失去确定性。

Tibo Watch 使用分层策略：

- **规则保底**：无需 API，识别明确承诺、完成重置、banked reset 等固定信号。
- **AI 增强**：只复核规则候选和少量强语义信号，生成中文摘要、证据和时间区间。
- **事件闭环**：把“准备重置 → 预计到账 → 确认完成”串成可回看的审计链。
- **安全自动化**：重置确认后，只继续用户明确授权且当前空闲的 Codex 任务。

## 核心功能

### 监控

- 轮询公开 FxTwitter 数据源，也支持自定义兼容端点。
- 使用帖子原始发布时间，统一转换为中国标准时间显示。
- 展示最近一次确认重置和“确认时间 + 7 天”的周基线。
- 新预测出现时临时覆盖周基线；重置确认后立即清除已兑现预测。
- 最新消息只显示规则或 AI 认可的候选，避免无关回复刷屏。
- 提供 28 天重置活动热力图和基础统计。

### 历史与审计

- 按最新时间倒序浏览 Tibo 历史消息。
- 默认隐藏无关内容，可主动查看保留期内的完整消息。
- 查看重置事件链、规则版本、AI 分析、通知和 Codex 恢复记录。
- 测试数据与真实历史、事件统计相互隔离。

### 通知

- 支持 Windows 系统通知。
- 支持飞书机器人 Webhook 和通用 HTTP Webhook。
- 可按事件类型独立选择通知渠道。
- 测试通知会明确标记，不计入真实重置事件。

### Codex 自动化

- 自动查找独立 Codex CLI，也允许手动选择 `codex.exe`。
- 扫描 Codex Desktop / CLI 共用的本地任务。
- 点击任务后在独立操作面板中授权、移除或立即继续。
- 单独展示已经安排的自动任务及其启用状态。
- 支持重置确认后执行，或在 AI 预测时间前执行。
- 支持继续原任务或注入用户配置的加速提示词。
- 支持目标消耗、最低保留额度和上下限门禁。

Tibo Watch **不会暂停、终止或向正在运行的任务追加指令**。额度门禁只会阻止新的自动执行；额度不可读取时不会自动执行加速消耗，也不会自动使用 reset credit。

## 两种运行模式

| 模式        | API Key  | 规则检测与通知 | 时间预测         | Codex 自动恢复     |
| ----------- | -------- | -------------- | ---------------- | ------------------ |
| 规则模式    | 不需要   | 支持           | 仅周基线         | 支持保守触发       |
| AI 增强模式 | 用户自备 | 支持           | 支持语义区间预测 | 支持规则或 AI 触发 |

AI Provider 与 OpenAI 账户授权相互独立。即使用户没有配置 AI API，只要已经授权 Codex 任务，仍可使用规则信号进行通知和保守恢复。

## 快速开始

### 环境要求

- Windows 10/11
- Node.js 24
- npm 11
- 可选：独立安装的 Codex CLI

### 本地运行

```powershell
git clone https://github.com/Dopetaiga/tibo-watch.git
cd tibo-watch
npm ci
npm run dev
```

也可以直接双击仓库中的 `start-tibo-watch.cmd`。首次进入应用后：

1. 在“设置”中运行基础自检。
2. 保持默认公开数据源，或填写自定义端点。
3. 按需配置 AI Provider 和通知渠道。
4. 在“Codex”页扫描任务，并逐项加入自动任务。

API Key、自定义秘密请求头、Webhook 地址和 Codex 授权配置均保存在 Windows 凭据管理器。应用数据默认位于 `%APPDATA%\tibo-watch\data`。

如需重新测试首次启动流程，请先关闭应用，再运行 `reset-tibo-watch.cmd`。该脚本会清除 Tibo Watch 本地状态，请勿在保留测试数据时使用。

## AI Provider

内置 DeepSeek 预设，并支持三类通用协议：

- Anthropic Messages API
- OpenAI Responses API
- OpenAI Chat Completions API

自定义服务只使用跨厂商的基础参数。模型必须返回符合内部结构约束的 JSON；失败分析会记录错误，但不会凭空创建重置事实。

## 数据与隐私

- 所有业务记录默认只保存在本机。
- 只有用户启用的数据源、AI Provider 和 Webhook 会收到必要请求。
- 无关回复保留 7 天；无关原创帖和引用帖保留 14 天。
- 候选、确认事件和审计记录长期保留，用户可维护或导出非敏感数据。
- 导出内容不包含 API Key、Webhook 秘密或 Codex 授权配置。

详细说明：[隐私说明](docs/PRIVACY.md) · [数据与导出](docs/DATA-EXPORT.md) · [飞书通知](docs/FEISHU-NOTIFICATIONS.md)

## 开发与验证

```powershell
npm ci
npm run verify
npm run dist:win
```

`npm run verify` 会运行类型检查、ESLint、单元/集成测试、前端构建、Electron 主进程构建和运行时边界检查。

项目结构和设计资料：

- [项目结构](docs/PROJECT-STRUCTURE.md)
- [V2 研究与产品边界](V2-RESEARCH.md)
- [路线图](ROADMAP.md)
- [贡献指南](CONTRIBUTING.md)
- [故障排查](docs/TROUBLESHOOTING.md)

## 当前限制

- 当前只支持 Windows 本地单应用。
- 只监控 `@thsottiaux`，尚未提供多作者监控。
- 自然语言控制自动恢复留待后续版本。
- 正式发布暂不提供便携版。
- 未签名构建可能触发 Windows SmartScreen；不要运行来源不明的构建。

## 发布安全

应用只从 GitHub Releases 检查更新。更新清单需要通过 Ed25519 签名验证，安装包需要通过 SHA-256 校验；下载和安装始终需要用户明确确认，不会静默更新。

正式发布计划只提供 NSIS 安装版和 `SHA256SUMS.txt`。完整流程见 [发布检查清单](docs/RELEASE-CHECKLIST.md) 和 [安全策略](SECURITY.md)。

## License

[MIT](LICENSE)

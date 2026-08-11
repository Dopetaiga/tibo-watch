# Tibo Watch

Tibo Watch 是一个 Windows 优先、本地优先的开源桌面助手，仅监控 Tibo（`@thsottiaux`）的公开发言，以固定规则和可选 AI 分析重置信号，并可在用户逐线程授权后恢复已有 Codex 任务。

当前版本为 V2 个人体验测试候选版。产品边界见 [V2-RESEARCH.md](V2-RESEARCH.md)，V1 验收基线见 [ROADMAP.md](ROADMAP.md)。

用户文档：[隐私说明](docs/PRIVACY.md) · [数据与导出](docs/DATA-EXPORT.md) · [故障排查](docs/TROUBLESHOOTING.md) · [发布检查清单](docs/RELEASE-CHECKLIST.md)

## 隐私与边界

- 默认数据只保存在本机。
- 没有中心服务器、账号、云同步、遥测或邮件订阅。
- 只有用户主动配置的数据源、AI Provider 或 webhook 会收到请求。
- Codex App Server 只有在用户主动探测并逐线程授权后才会读取任务或恢复任务。
- 额度阈值只阻止新的恢复任务，绝不暂停或终止已经运行的程序。

## 开发

要求 Node.js 24 与 npm 11。

```powershell
npm ci
npm run verify
npm run dist:win
```

首次启动后，从侧边栏进入“设置”：先运行基础自检，再按需配置数据源、AI Provider、通知和 Codex 恢复。API Key、自定义秘密请求头、Webhook 与恢复授权均写入 Windows 凭据管理器。安装版数据默认保存在 `%APPDATA%\Tibo Watch\data`，便携版数据保存在程序同目录的 `Tibo Watch Data\data`。

AI Provider 支持 Anthropic Messages、OpenAI Responses 和 OpenAI Chat Completions 三种协议；未配置 AI 时规则候选仍可通知、触发 webhook 和保守恢复。无关回复保留 7 天，无关原创/引用保留 14 天，候选和审计长期保留。

飞书通知推荐使用只有自己的私密群和自定义机器人 webhook；配置步骤与密钥保存位置见 [飞书通知配置](docs/FEISHU-NOTIFICATIONS.md)。

未签名的 Windows 构建可能触发 SmartScreen；发布版会同时提供 SHA-256 校验文件。

## 更新与发布安全

- 应用只从 GitHub Releases 检查新版本；离线或检查失败不会中断监控。
- 更新清单必须通过内置公钥的 Ed25519 签名验证，安装包还必须通过 SHA-256 校验。
- 下载和安装永远需要用户明确确认，不会静默安装。
- 未取得代码签名证书前，Windows 可能显示 SmartScreen“未知发布者”提示。请先将下载文件的 SHA-256 与同一 Release 中的 `SHA256SUMS.txt` 对照，再决定是否运行；不要绕过来源不明文件的提示。
- 每次发布同时提供 NSIS 安装版、便携版和 `SHA256SUMS.txt`。构建门禁会扫描 ASAR、resources 和发布文件，拒绝研究数据、研究脚本及研究站点域名进入运行时。

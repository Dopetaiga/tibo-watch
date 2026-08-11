# Tibo Watch

Tibo Watch 是一个 Windows 优先、本地优先的开源桌面助手，仅监控 Tibo（`@thsottiaux`）的公开发言，并以固定规则与用户自行配置的 DeepSeek API 分析重置信号。

当前处于 MVP 开发阶段。完整范围、产品边界和验收条件见 [ROADMAP.md](ROADMAP.md)。

用户文档：[隐私说明](docs/PRIVACY.md) · [数据与导出](docs/DATA-EXPORT.md) · [故障排查](docs/TROUBLESHOOTING.md) · [发布检查清单](docs/RELEASE-CHECKLIST.md)

## 隐私与边界

- 默认数据只保存在本机。
- 没有中心服务器、账号、云同步、遥测或邮件订阅。
- 只有用户主动配置的数据源、DeepSeek API 或 webhook 会收到请求。
- 监控流程不调用 Codex 或 Claude Code。

## 开发

要求 Node.js 24 与 npm 11。

```powershell
npm ci
npm run verify
npm run dist:win
```

首次启动后，在大屏“设置与请求日志”中启用数据源。DeepSeek Key 通过“安全保存”写入 Windows 凭据管理器；只有规则命中的候选帖才会触发分析。安装版数据默认保存在 `%APPDATA%\Tibo Watch\data`，便携版数据保存在程序同目录的 `Tibo Watch Data\data`。

飞书通知推荐使用只有自己的私密群和自定义机器人 webhook；配置步骤与密钥保存位置见 [飞书通知配置](docs/FEISHU-NOTIFICATIONS.md)。

未签名的 Windows 构建可能触发 SmartScreen；发布版会同时提供 SHA-256 校验文件。

## 更新与发布安全

- 应用只从 GitHub Releases 检查新版本；离线或检查失败不会中断监控。
- 更新清单必须通过内置公钥的 Ed25519 签名验证，安装包还必须通过 SHA-256 校验。
- 下载和安装永远需要用户明确确认，不会静默安装。
- 未取得代码签名证书前，Windows 可能显示 SmartScreen“未知发布者”提示。请先将下载文件的 SHA-256 与同一 Release 中的 `SHA256SUMS.txt` 对照，再决定是否运行；不要绕过来源不明文件的提示。
- 每次发布同时提供 NSIS 安装版、便携版和 `SHA256SUMS.txt`。构建门禁会扫描 ASAR、resources 和发布文件，拒绝研究数据、研究脚本及研究站点域名进入运行时。

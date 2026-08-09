# Tibo Watch

Tibo Watch 是一个 Windows 优先、本地优先的开源桌面助手，仅监控 Tibo（`@thsottiaux`）的公开发言，并以固定规则与用户自行配置的 DeepSeek API 分析重置信号。

当前处于 MVP 开发阶段。完整范围、产品边界和验收条件见 [ROADMAP.md](ROADMAP.md)。

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

未签名的 Windows 构建可能触发 SmartScreen；发布版会同时提供 SHA-256 校验文件。

# Tibo Watch 0.1.0（草稿）

首个 MVP 版本，面向 Windows 的本地优先 Tibo 重置信号监控。

## 主要功能

- 只读采集 `@thsottiaux` 的原创、回复与引用帖，排除转推。
- 冻结 `rules-v1.0.0` 先筛选候选，普通帖子不调用 DeepSeek。
- 用户自行配置 DeepSeek Key，Key 保存在 Windows 凭据管理器。
- 结构化事件、Windows/飞书/HTTP 通知适配器、幂等与退避。
- 本地 JSON/JSONL/Markdown 事实存储、可重建索引与隔离损坏记录。
- 监控健康、24/48 小时安全判断、历史事件、统计、热力图和审计详情。
- NSIS 安装版与便携版；便携版数据保存在程序旁，安装版卸载默认保留数据。

## 安全与隐私

没有中心服务器、账号、遥测、邮件或云同步。客户端不包含或访问研究站点，监控不调用 Codex/Claude Code。未获得代码签名证书，本版本可能触发 SmartScreen；请只从本项目 Release 下载，并核对 `SHA256SUMS.txt`。

## 发布前待确认

- 使用用户授权的 DeepSeek Key 完成一次真实候选分析。
- 使用用户授权的飞书或 HTTP webhook 完成一次真实通知。
- 确认 GitHub 仓库和草稿 Release 内容，用户批准后再公开。

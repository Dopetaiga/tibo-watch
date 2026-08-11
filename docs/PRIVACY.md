# 隐私说明

Tibo Watch 是本地优先的 Windows 应用，没有中心服务器、账号系统、遥测、广告、邮件订阅或云同步，也不会读取用户笔记。监控过程不调用 Codex 或 Claude Code，不消耗它们的 token。

只有用户主动启用或配置的服务会收到最小必要数据：FxTwitter 收到公开账号 `@thsottiaux` 的读取请求；DeepSeek 仅在冻结规则命中候选时收到该公开帖子及必要上下文；飞书或 HTTP webhook 仅在用户配置并启用对应渠道后收到事件摘要。应用不会访问研究站点。

DeepSeek Key 和 webhook 密钥保存于 Windows 凭据管理器，事实记录、日志与导出中不包含密钥。渲染进程只能提交新密钥，不能读取明文。

安装版数据位于 `%APPDATA%\Tibo Watch\data`。便携版数据位于便携程序同目录的 `Tibo Watch Data\data`。卸载程序默认保留用户数据，便于重装恢复；如需彻底删除，请退出应用后手动删除相应数据目录和 Windows 凭据管理器中以 `TiboWatch/` 开头的条目。

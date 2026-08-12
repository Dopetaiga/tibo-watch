# 隐私说明

Tibo Watch 是本地优先的 Windows 应用，没有中心服务器、账号系统、遥测、广告、邮件订阅或云同步，也不会读取用户笔记。监控过程不调用 Codex 或 Claude Code，不消耗它们的 token。

只有用户主动启用或配置的服务会收到最小必要数据：FxTwitter 收到公开账号 `@thsottiaux` 的读取请求；DeepSeek 仅在冻结规则命中候选时收到该公开帖子及必要上下文；飞书或 HTTP webhook 仅在用户配置并启用对应渠道后收到事件摘要。应用不会访问研究站点。

DeepSeek Key 和 webhook 密钥保存于 Windows 凭据管理器，事实记录、日志与导出中不包含密钥。渲染进程只能提交新密钥，不能读取明文。

兼容性说明：当前支持的 Windows 主机上，Chromium 沙箱子进程会触发原生 `0x80000003` 崩溃，因此 Windows 构建暂时关闭 Chromium sandbox。应用仍启用 context isolation、禁用 renderer Node、严格 CSP、权限拒绝和白名单 IPC；在 Electron/Windows 兼容性问题解决前，这是明确记录的安全折中。

安装版和本地开发版数据位于 `%APPDATA%\tibo-watch\data`。项目当前不提供正式便携版。卸载程序默认保留用户数据，便于重装恢复；如需彻底删除，请退出应用后运行仓库根目录的 `reset-tibo-watch.cmd`，或手动删除数据目录和 Windows 凭据管理器中以 `TiboWatch/` 开头的条目。

研究整理命令生成的 `research/reports/local-materials/` 只用于本机分析，已被 Git 忽略，不应提交到公开仓库。

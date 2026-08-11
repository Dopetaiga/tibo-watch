# 飞书通知配置

Tibo Watch 使用飞书自定义机器人 webhook 发送通知。推荐创建一个只有自己的私密群，把机器人加入该群；这样通知只发给当前用户，不需要让桌面应用依赖 `lark-cli` 的登录状态或访问令牌。

## 获取 webhook

1. 在飞书中新建一个只有自己的私密群。
2. 打开群设置，添加“自定义机器人”。
3. 设置机器人名称并复制 HTTPS webhook 地址。地址应以 `https://open.feishu.cn/open-apis/bot/v2/hook/` 开头；国际版 Lark 可使用 `open.larksuite.com`。
4. webhook 地址等同于秘密，不要发到聊天、截图、日志或 Git 仓库。

## 在 Tibo Watch 中保存

1. 打开“设置与请求日志”。
2. 在“通知 Webhook”选择“飞书”。
3. 粘贴 webhook 地址，点击“安全保存”。
4. 点击“发送测试”，私密群应收到带 `[测试]` 标记的通知。

webhook 地址只写入 Windows 凭据管理器，目标名为 `TiboWatch/webhook-feishu/url`；应用数据、日志与导出不会包含完整地址。确认测试成功后，后续 confirmed 事件会通过同一渠道发送。通知使用事件、渠道、语义版本和测试标志做幂等控制。

## DeepSeek API Key

不要创建 `.env`、文本文件或源码配置。把 Key 粘贴到应用的“DeepSeek API Key”输入框并点击“安全保存”；它会写入 Windows 凭据管理器目标 `TiboWatch/deepseek/api-key`，输入框随后清空。点击“连接测试”只验证服务连接，不发送真实帖子内容。

## 关于 lark-cli

`lark-cli` 适合交互式发送消息、管理群聊和调试飞书开放平台授权，但不是 Tibo Watch 的运行时依赖。若要由 CLI 直接私聊用户，需要可调用的 CLI、应用权限、发送身份和接收者 `open_id`；每次真实发送前还必须确认接收者、内容和发送身份。当前桌面应用使用 webhook，可以避免持久化 CLI access token。

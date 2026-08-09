# 来源清单

## 一手来源

- Tibo X 账号：`https://x.com/thsottiaux`
- X 原帖：每条记录使用稳定的 `https://x.com/thsottiaux/status/<id>` 链接。
- OpenAI Status：用于故障上下文交叉核验，不替代 Tibo 原帖。
- OpenAI Help Center：用于额度范围与产品命名核验，不替代 Tibo 原帖。

## 数据读取适配器

- FxTwitter Status API v2：只用于读取已知 X 帖子 ID 的公开正文、作者、时间和上下文 ID。
- X 已登录网页时间线：用于建立最近六个月完整原创、回复和引用帖集合。

## 二级线索

- `codex-reset.com/api/timeline`：仅用于发现候选帖子 ID；每条必须回溯到 X 原帖。
- `codexreset.org` 及同类站点：仅可作为开发期线索，不得成为客户端依赖、备用源、打包内容或界面链接。

二级线索不能证明时间线完整性，也不能独立成为强正样本。

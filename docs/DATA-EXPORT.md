# 数据、备份与导出

运行数据分为 `posts`、`analyses`、`events`、`notifications` 和 `runtime` 五个集合。每条事实是独立 UTF-8 JSON 文件，`indexes` 中的 JSONL 仅为可重建索引；损坏记录会移入 `quarantine`，不会被静默当成有效事实。

备份时先退出 Tibo Watch，再复制整个 `data` 目录。恢复时在应用退出状态下将备份复制回原位置。JSON 导出只包含事实记录，不包含 Windows 凭据管理器中的 Key 或 webhook 密钥。

如果索引丢失，应用存储层可从独立 JSON 事实重建 JSONL。不要手工修改 `contentHash`；需要迁移或检查时，优先保留原始目录副本。

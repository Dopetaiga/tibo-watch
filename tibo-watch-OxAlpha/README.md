# Tibo Watch · Ox Alpha 版重实现规划

> 本目录是 **Ox Alpha** 基于 `main@242735d` + `ox-alpha/robustness-polish` 分支修复成果的下一代实现规划。
> 目标读者：项目维护者。审查通过后按 ROADMAP 分阶段实施。

## 这是什么

对现有 Tibo Watch 的**演进式重实现**：不推翻现有架构分层（domain / adapters / main / renderer / rules 已被验证合理），而是：

1. **拆解上帝类** —— `runtime-controller.ts`（1955 行）拆为职责单一的协作服务
2. **补齐鲁棒性欠账** —— 收敛代码审查遗留的中危问题（AI 重试、复核队列、校验缺口等）
3. **Codex 自动化 2.0** —— 常驻连接、事件订阅、等待批准通知、dry-run、结果反馈环
4. **前端重构** —— 按 `vercel-react-best-practices` 规则体系治理渲染性能与轮询架构

## 文档导航（建议阅读顺序）

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 现状问题 → 目标架构：模块划分、数据流、IPC 契约变更 |
| [FRONTEND-V2.md](FRONTEND-V2.md) | 前端专项设计：skill 规则逐条映射到本项目的落地点 |
| [CODEX-AUTOMATION-V2.md](CODEX-AUTOMATION-V2.md) | Codex 子系统专项设计：连接管理、事件订阅、dry-run、反馈环 |
| [ROADMAP.md](ROADMAP.md) | 六个阶段的任务清单、涉及文件、验收标准、风险 |
| [ADR.md](ADR.md) | 关键技术决策记录（含否决项及理由） |

## 产品边界不变

- Windows 本地单机运行；无中心服务器、账号、遥测、云同步
- 只监控 `@thsottiaux`
- 数据 schema 向后兼容：`schemaVersion: 1` 不变，只允许追加可选字段
- 所有密钥仍存 Windows 凭据管理器，导出不含敏感配置

## 审查要点建议

1. **P1 主进程拆分边界**（ARCHITECTURE.md §3）是否符合你对"可维护性"的预期
2. **P2 IPC 多通道化**（ARCHITECTURE.md §5）是否接受仪表盘数据从"单快照"变为"分域拉取"
3. **P3 dry-run 与审计字段扩展**（CODEX-AUTOMATION-V2.md §5–§6）的安全边界
4. **P2 前端规则取舍**（FRONTEND-V2.md 中标注 SKIP 的条目）是否认可

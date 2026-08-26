# 多 Agent 协作分支协议（AGENTS.md）

任何 AI Agent / 贡献者在本仓库工作时必须遵守以下分支与合并纪律。

## 1. 分支命名

- 每个 Agent 在开始一项工作前，从**集成分支**创建以自己模型名为前缀的分支：

  ```
  <agent-model>/<topic>
  例：ox-alpha/p6-dual-window、gpt-x/refill-scheduler
  ```

- 集成分支：`ox-alpha/robustness-polish`（功能集成）；`main` 仅接受发布级合并。

## 2. 工作流

1. `git switch -c <agent-model>/<topic> <integration-branch>`
2. 在自己的分支上实现；小步提交，提交信息首行带 `[<agent-model>]` 前缀。
3. 自检必须全绿：
   - `npm run verify`（typecheck + lint + 单测/集成 + build）
   - `npm run test:e2e`（打包冒烟）
4. **验收通过后**才能合并回集成分支：
   - 使用 `--no-ff` 保留工作边界；
   - 合并信息注明：Agent 模型名、覆盖的阶段/任务、验证结果摘要。
5. 禁止对他人分支做 force-push；标签仅由发布负责人移动。

## 3. 冲突与回滚

- 集成分支被他人推进后，先 rebase 自己的工作分支并重跑自检再合并；
- 出现回归时优先 revert 合并提交，不在集成分支上打补丁调试。

## 4. 当前登记

| Agent 模型 | 分支 | 状态 |
|------------|------|------|
| ox-alpha | ox-alpha/robustness-polish | 集成维护者 |

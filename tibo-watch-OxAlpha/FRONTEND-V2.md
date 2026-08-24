# 前端专项设计（vercel-react-best-practices 落地）

> 依据 skill：`vercel-react-best-practices`（70 规则 / 8 类别）。
> 本项目为 **Vite + React 19 Electron 渲染层**，非 Next.js：`server-*` 类规则不适用，其余按映射落地。

## 1. 现状痛点

| 症状 | 根因 | 违反的规则 |
|------|------|-----------|
| 每 2s 整树重渲染（即使数据没变） | `setModel(await getDashboard())` 无条件替换引用 | `rerender-derived-state`、`client-swr-dedup` |
| 主线程卡顿随历史增长恶化 | 每帧对 posts/events 重建 Map/sort/filter | `js-index-maps`、`js-combine-iterations` |
| 初始 bundle 含全部面板代码 | 2414 行单文件 App.tsx，无拆分 | `bundle-dynamic-imports`、`bundle-conditional` |
| 历史长列表滚动掉帧 | 全量渲染 DOM | `rendering-content-visibility` |
| 组件内定义子组件导致状态丢失 | App.tsx 内联组件 | `rerender-no-inline-components` |

## 2. 数据获取层重构

### 2.1 修订号门控（对应 ARCHITECTURE §5）

```tsx
// hooks/useDashboardDomain.ts
function useDashboardDomain<T>(domain: Domain, fetcher: (rev: number) => Promise<T>): T | undefined {
  const [model, setModel] = useState<T>()
  const revisionRef = useRef(-1)
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const { revision } = await window.tiboWatch.getRevision(domain)
      if (revision === revisionRef.current) return        // ← 未变化即短路
      revisionRef.current = revision
      setModel(await window.tiboWatch.getDomain(domain))   // ← 变了才拉全量
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [domain])
  return model
}
```

- 应用规则：`client-swr-dedup`（同域请求天然去重）、`rerender-derived-state`（订阅"是否有更新"而非原始值）
- 各域 hook 并行独立轮询/按需拉取：`async-parallel`
- mutation 后主动 bump 对应域：`rerender-move-effect-to-event`（刷新逻辑放事件处理器，不塞 effect）

### 2.2 首屏

CSP 禁止 inline script，故 **SKIP** `rendering-hydration-no-flicker`；改用骨架屏 + 首个快照到达后渲染。首帧前发起 `monitor` 域拉取（模块级启动，`advanced-init-once`）。

## 3. App.tsx 解构

```
renderer/src/
├── main.tsx                      # 仅装配 Provider + Router 壳
├── app/
│   ├── AppShell.tsx              # 导航 + 懒加载路由出口
│   └── providers.ts
├── features/
│   ├── monitor/                  # 默认页：状态卡、基线、热力图
│   ├── history/                  # 历史列表 + 详情抽屉
│   ├── codex/                    # Codex 面板（懒加载）
│   ├── settings/                 # 设置（懒加载）
│   └── audit/                    # 审计时间线（懒加载）
├── components/ui/                # 无业务原语组件
└── hooks/
```

- 四个 feature 页面 `React.lazy()` 动态导入：`bundle-dynamic-imports` + `bundle-conditional`；导航 hover 时预载：`bundle-preload`
- 禁止 barrel 文件，各模块直接深路径导入：`bundle-barrel-imports`

## 4. 渲染性能治理

| 规则 | 落地点 |
|------|--------|
| `rerender-memo` | 帖子行/事件行/审计行提取为 `memo` 组件，props 保持原始值比较 |
| `rerender-memo-with-default-value` | 行组件的回调 props 用模块级常量或 `useCallback(functional)` 稳定化 |
| `rerender-functional-setstate` | 所有 setState 回调式书写，保证轮询回调稳定 |
| `rerender-use-deferred-value` | 热力图/统计聚合基于 `useDeferredValue(model)` 计算，保输入响应 |
| `rerender-transitions` | 历史页切换用 `startTransition` 包裹，避免阻塞导航 |
| `rerender-lazy-state-init` | 复杂初始 state 传函数 |
| `rerender-split-combined-hooks` | 拆开"拉数据"与"表单草稿"两类 state 的 effect |
| `rerender-simple-expression-in-memo` | 简单字符串拼接不 useMemo（避免反向优化） |
| `rendering-content-visibility` | 历史/审计长列表行加 `content-visibility: auto` + `contain-intrinsic-size`；超过 200 条再评估虚拟滚动 |
| `rendering-conditional-render` | 三元替代 `&&`，防误渲染 `0`/空串 |
| `rendering-hoist-jsx` | 空态/加载态等静态 JSX 提到模块级 |

## 5. JS 微优化（每模型修订一次，非每帧）

```ts
// dashboard-model.ts（纯函数层，可单测）
export function indexByPost(posts: Post[], events: ResetEvent[]) {
  // js-flatmap-filter：一次遍历完成 map+filter
  // js-index-maps / js-set-map-lookups：返回冻结的 Map/Set 索引
  // js-combine-iterations：合并现有 5+ 次 filter/map 链
}
```

- 结果以 `useMemo([model])` 缓存 —— model 引用仅在 revision 变化时更换，索引计算从 O(帧) 降到 O(修订)
- `js-hoist-regexp`：App.tsx 内联正则提升到模块级
- `js-early-exit` / `js-length-check-first`：详情展开等路径先行短路

## 6. Effect 与监听器纪律

- `client-event-listeners`：全局键盘快捷键在 AppShell 单点注册
- `client-passive-event-listeners`：滚动容器 passive 监听
- `rerender-dependencies`：effect 依赖只用原始值（domain 字符串、revision 数字），不用对象
- `advanced-use-latest` / `advanced-effect-event-deps`：轮询回调经 ref 取最新值，不入依赖数组
- `client-localstorage-schema`：UI 偏好（当前页签、折叠态）带版本号存 localStorage，仅存 id 不存数据

## 7. 明确 SKIP 的规则及理由

| 规则 | 理由 |
|------|------|
| 全部 `server-*` | 非 Next.js/RSC 架构 |
| `bundle-defer-third-party` | 无第三方分析/日志脚本 |
| `rendering-svg-precision` | 热力图为 div 网格，无复杂 SVG |
| `rendering-activity` | React 19 Activity 尚处实验，Electron 场景收益低，用条件渲染 + content-visibility 替代 |
| `server-cache-react/lru` | 由主进程 DashboardService LRU 承担（ARCHITECTURE §5） |

## 8. 验收标准

1. 空闲态（数据无变化）2 分钟内渲染层 commit 次数为 0（React DevTools profiler 验证）
2. 初始 chunk < 120KB gzip（现 72.8KB 总量的前提下允许增长但受控）；codex/settings/history 为独立异步 chunk
3. 500 条历史记录滚动无 >16ms 长帧（Performance 面板抽样）
4. 既有 e2e `electron-startup` 通过；新增"revision 门控生效"单测（mock IPC 计数拉取次数）

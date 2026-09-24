# benchmark-v2 阅读地图（读完 → 问 → 对照源码验证）

配套一份真实跑通的工作基准。按下面的站点顺序读，每站有"看什么"和"自检问题"，
读完把答案或疑问带来问我。

## 0. 这套基准要证明的主张

> 同一批任务、同一个模型、同一种提示下：启用 dsh-self-improving（跨会话经验注入）的 agent
> 在"族内后置任务"与"held-out 任务"上的表现优于未启用的对照臂，且不出现负迁移。

旧 `benchmark/` 证不了这个主张：它用 SimAgent 模拟 agent，把"有经验→错误率降低"
写进了模拟器的概率表——提升是假设的输出，不是测量的结果。v2 的每一行结论都来自
真实 dsh 会话 + `node test.cjs` exit code。

## 1. README.md — 协议总览

看：两臂定义、隔离规则、指标、"Cost: 40 real LLM sessions"。
自检：两臂之间**允许**存在哪些差异？为什么 dbPath 隔离是"双向"的（基准不污染生产、
生产不污染基准）——各会污染出什么假象？

## 2. tasks/manifest.json + tasks/unicode/ — 任务族与迁移链

看：`order` 数组的族间交错（u1 d1 j1 a1 f1 | u2… | heldOut 最后）；
unicode 族 4 题：u1 教"按 code point 迭代"（Array.from），u2/u3 是同一知识的不同应用，
u4 是 held-out 综合。
自检：
- 对照 AppWorld 三件套：Setup Program / Validation Solution / Evaluation Program
  在本仓库分别是哪三个文件？
- 为什么 held-out 必须在序列最后跑？如果 enabled 臂先见过 u4 再学 u1-u3，会污染什么？
- 族间为什么要交错而不是跑完一族再跑下一族？（提示：疲劳/漂移效应）

## 3. solutions/ + `node src/run.mjs verify-seeds` — 判分器的资格证明

看：verifySeeds 函数（src/run.mjs）如何不依赖任何 agent 证明"每个 test.cjs 可挂可过"。
自检：没有这一步，test.cjs 可能坏在哪三种方式？（全过 / 全挂 / 偶然依赖运行目录）
为什么"参考解必须过"和"种子必须挂"同样重要？

## 4. src/lib/profiles.mjs — 对照臂与配置组合

看：两个 profile 的生成（bundles 列表 + cordis.patch.yml）与 verifyProfiles 的 dump 校验。
这里有一个**我踩过的真实坑**：YAML 生成器漏写 `config:` 嵌套层，键落在行级被运行时
忽略——表面看 dump 里有 `port: 3081`（文本匹配通过），实际绑定的是 bundle 默认 3080；
更危险的是 enabled 臂差点写到生产 experiences.db。
自检：
- 这个坑暴露了 cordis patch 的什么合并语义？（行级 vs config 级）
- verifyProfiles 用 `dump.includes(...)` 文本匹配有什么残余风险？换你会怎么加强？
- 为什么 baseline 臂的 bundles 列表故意不含 dsh-self-improving，而 enabled 含？

## 5. src/lib/server.mjs — 服务生命周期工程（三个真实 bug 的考古现场）

看注释里的三课：
1. `dsh web` 是启动器别名命令，不接受 `--profile` 父参数 → 正确形式
   `dsh --profile <name> --no-open`（应用参数透传）；
2. 陈旧日志竞态：追加式 server.log 里上次启动的 token URL 被立刻匹配 →
   修复为按字节偏移只搜本次内容 + `fetch(url)` 就绪探测（URL 打印早于监听建立）；
3. 进程树终止：pnpm 的 node 子进程不吃单次 group SIGTERM → SIGTERM→SIGKILL 升级
   + 启动前按端口+命令行清理残留 bench 进程（绝不动非 bench 进程）。
自检：为什么 clearStaleBenchPort 必须校验进程命令行而不是直接杀端口占用者？
"只搜 offset 之后"如果换成"每次启动新建日志文件"有什么代价？

## 6. src/probe.mjs + src/lib/ui.mjs — UI 自动化方法论

看：probe 如何"dump 所有可访问角色 + 截图 + console/网络监听"定位真实结构。
我又犯了一个值得学的错：第一次只 dump role=button，chip 点击后的菜单是 role=menuitem，
于是误判"点击是 no-op"——角色维度不全就会得出错误的结构结论。修复后的正确流：
chip → menu(`Add workspace…`) → 目录对话框(`Edit path` → 输入绝对路径 → Enter → `Open`)。
自检：
- waitTurnDone 的两信号（Stop 可见 / Send 禁用）为什么需要 everBusy 门槛？
  everBusy=false 时的 bodyStable 兜底防的是什么假阳性？
- 模型选择器守卫（uiLabelHint 检查）挡住的是哪一类效度威胁？

## 7. src/lib/metrics.mjs — 会话取证

看：session 目录编码规则（`--` + 路径段替换 + `--`）、zstd 解压、
`assistant/chunk` usage 事件求和、按 workspace + mtime 时间窗定位会话。
自检：为什么按"workspace 路径 + 时间窗"而不是信 UI 给的 session id？
usage 事件是每 step 一条——直接求和会不会高估？怎么用一次冒烟数据验证？
（这题没有标准答案，正是可以问我的。）

## 8. src/lib/report.mjs — 从样本到结论

看：族内序列、heldOut、负迁移（delta=-1 单列）。
自检：一次冒烟每格只有 1 个样本——"enabled 两题全过"能得出"插件有效"吗？
要在 95% 置信下声称族内学习曲线，每组至少要多少次重复？为什么 report.md 必须写
结论边界？

## 9. 外部成熟实现对照读（读完本地再看这些）

| 材料 | 读什么 | 对应本仓库哪里 |
|---|---|---|
| AppWorld (arxiv 2407.18901, appworld.dev) | Task Generator 三件套、TGC/SGC、collateral damage | tasks/ + solutions/ + manifest |
| SAGE (arxiv 2512.17102) | Sequential Rollout：任务链上前题技能给后题 | manifest.order 的族内顺序 |
| Live-Evo (arxiv 2602.02369) | ContrastiveEval：同任务带/不带记忆跑两遍求差 | 两臂 A/B 是它的粗粒度版 |
| 旧 benchmark/sim-agent.ts | 反面教材：找出循环论证的三条具体证据 | —— |

## 10. 值得问我的问题（如果你还没想到）

- 为什么坚决不用 LLM 当裁判？
- 要不要把旧基准的 warmup（只读分析任务）加回来？
- 20 个任务的统计功效够吗？怎样用最小成本翻倍？
- 插件里 confidence 随 reuse 衰减——第二次跑同族任务会怎样？
- 如果 agent 在 enabled 臂把答案"背"进了经验库，held-out 还干净吗？怎么检测？
- 为什么每臂启动都重置 bench db，却又把 enabled-experiences.db 归档进 run 目录？

## 11. 手动操作模式与 v3 会话格式（2026-09-22 冒烟实录）

冒烟 4/4 通过，其中三条新教训值得读：

1. **arena 协议**：所有任务共用一个已注册工作区 `state/arena/`，每任务前全量清空重播种。
   为什么成立：agent 看不到任何兄弟任务（目录里只有当前种子），会话按任务隔离。
   为什么需要它：macOS 原生目录选择器 Playwright 无法操作；工作区注册表
   `~/.dsh/storages/workspace.json` 直写一次即可，之后"chip → 菜单 → arena"全部可用。
2. **ref 生命周期**：agent-browser 的 `@eN` 引用在页面变化后失效。我在 f1 上踩过：
   点完"新建会话"没重新 snapshot，用过期的 send 按钮 ref 点击 → 提示词填了但从未发出，
   机器判分立刻暴露（种子原样 → FAIL）。教训：每次页面变化后必须重新快照。
3. **v3 会话格式**：session 日志已换代为 `session.v3.jsonl.zstd`（版本命名后继，
   印证 repo 的格式迁移策略）。v3 用一等公民事件（`turn/start|end`、`step/start|end`、
   `tool/call|result`），token 用量不再写进会话日志（UI 用量来自 host 用量系统）——
   `src/lib/metrics.mjs` 的 v0 解析需要按此升级。

冒烟数据（runs/manual-smoke/report.md）：两臂各 2/2 PASS；enabled 臂两个任务均比
baseline 少 1 次工具调用（4 vs 5）——方向符合插件预期，但 n=1/格，不可下结论。

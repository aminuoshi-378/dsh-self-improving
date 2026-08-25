# TODO — self-improving 插件缺陷修复

## 整合说明（2026-08-25）

由原 P0–P6 分区**按主题域去重重组**，每个需求只出现一次，每项保留原始优先级标签 `[Pn]` 以便追溯优先级。

去重合并关系：
- 「P2 定期合并 lesson」+「P6.3 聚类抽象」→ 域 C5（同一件事）
- 「P3 分代淘汰」→ 域 A4（TTL/遗忘的具体实现方案）
- 「P4 两阶段召回/粗筛精筛」+「P6.1 底层双索引」→ 域 A3（BM25 即粗筛落点）
- 「P5 按任务类型分类」+「P6.1 中层场景聚类」→ 域 A2（task_pattern 即聚类键）

---

## 前置项 — 任务边界与存储单元（2026-08-25 评审确认）

**背景**：当前隐式一个 turn = 一个任务，但不成立（一个 turn 可含多个任务、一个任务可跨多个 turn）；且无 goal 的普通会话大量存在（常识问答/闲聊/单次提问）。

**决策**：任务边界用分层策略，不依赖单一锚点。
- 有 goal 的长任务 → 以 goal 为单位跨 turn 聚合，`active→complete` 一次结算为一条任务经验
- 无 goal 但多步工具操作 → 以连续工具操作簇为任务（≈turn，用 D1 步数判定）
- 纯问答 / 单次常识 → 判为无任务（low 价值），**不存储**，避免污染

### P-A 查证 dsh 的 goal 创建机制
- 当前 [index.ts L291-302](file:///d:/Code/projects/dsh-self-improving/src/index.ts#L291-L302) 只消费 goal 的 `phase`，**未见创建路径**
- 待查证 dsh 源码：goal 由谁注入（启动参数 / 用户 goal 工具 / CLI），headless 是否可用；不查清前不假设"以 goal 为边界"在 web 之外必然可用

### P-B 会话分流 / 低价值过滤
- `turn-stopping` 按特征分流：有 goal / 多步工具 / 单步问答
- 纯问答（low 难度、无/少工具调用）不存储，避免污染
- 复用 D2 步数判定，无需额外信号

### P-C 引入"任务单元"的存储模型
- 现状：一条经验 = 一个 turn（`turnId="turn-N"`）
- 调整为任务单元：跨 turn 聚合（goal 或连续行为），任务 complete/结束时汇总 lesson、难度、工具序列
- 影响：E2 去重对象、A7 任务分类归类、D2 difficulty 计算基准、ID 粒度
- 该粒度是 E2 / A7 / D1 / D2 的共同前提，开始实现前必须先敲定

---

## 域 A — 记忆存储分层（淘汰 + 检索）

记忆从单一 `experiences` 表升级为三层金字塔 + 分代淘汰 + 双索引召回，对应外部评审 P6.1。

### A1 顶层：用户画像 / 核心偏好常驻层 [P6.1]
- 独立存储（容量极小，约 <1KB），每次 Prompt 组装时默认嵌入，永不淘汰
- 区别于现有 `systemPrompt.section` 的临时统计：需要持久化、带高置信度确认的来源
- 注：该层作为 advisory 注入，不改变主循环

### A2 中层：场景聚类跨项目经验 + TTL 过期 [P5, P6.1]
- **按主题聚类历史会话**：以 `task_pattern` 为聚类键。**注意**：task_pattern 落值依赖"任务类型判断"能力（从用户首条消息/goal 提取 bugfix/feature/refactoring），该能力当前未实现，单开独立 todo A7，A2 需等它先行
- **TTL 过期机制**：仅保留近期或高频经验，过期自动降级或丢弃
- 当前实现只有 1000 条 FIFO，需补 `last_injected_at` / 访问频次 / 过期时间维度

### A3 底层：原子事实 + 双索引检索 [P4, P6.1]
- 结构化存储具体事实（如"项目 X 的部署命令是 Y"），永不过期
- 新增独立原子事实表，与任务级 tuple（`experiences`）分离
- **两阶段召回**：
  - 粗筛：`tools_used` 交集 + **BM25（SQLite FTS5）**（对 lesson/actions 建 FTS），SQL WHERE 快速缩小候选集
  - **不再以 `context_hash` 为权威检索键**——它只编码"工具名+工作目录"，同一项目 workspace 恒同、工具序列易撞，语义无力；去重/聚类改用 E2 的 `content_hash`
  - 精筛：候选集内综合评分排序——`outcome_score × 0.4 + 工具相似度 × 0.3 + 时间近度 × 0.3`（可选向量精排）
  - 两阶段都走 SQL，避免全表扫描

### A4 分代淘汰策略（TTL / 遗忘的具体实现）[P3]
- 当前：1000 条上限 FIFO eviction，没被触发过
- 借鉴 JVM 分代 GC，管理方式：
  - **新生代（Young）**：新经验先进，容量小（如 200）条；Minor GC 淘汰低质量（score 低、无 lesson、difficulty 低）；存活经验（被多次注入或 score 高）晋升老年代
  - **老年代（Old）**：容量大（如 800 条），仅晋升进入；Major GC 按自身质量淘汰，不看使用频率：`difficulty: low` > 无 lesson > `score < 0.5` > 已被合并（`merged: true`）。**不淘汰** `difficulty: high` 且有 lesson 的经验（久未注入只是任务类型不匹配，非无价值）；极端不足时淘汰 score 最低者
  - **晋升条件**：新生代被注入（`reuse_count >= 1`）、LLM 合并产物、或 `score >= 0.8` 且有 lesson
  - 数据库实现：`generation` 字段（0=新生代, 1=老年代）+ `last_injected_at`

### A5 主动遗忘机制 [P6.3]
- 主动清理低价值、低置信度经验，不依赖被动 FIFO 上限
- 与 A4 分代策略配合；当前无"按价值/置信度主动清理"路径

### A6 检索范围动态伸缩 [P4]
- 当前：query 固定返回 limit 条
- 根据经验库总量动态调整候选集：<50 条全量精筛；50–200 条粗筛 top 20 / 精筛 top 5；>200 条粗筛 top 50 / 精筛 top 5
- 粗筛质量高（avg > 0.8）缩小范围，质量低则扩大

### A7 任务类型判断落值（A2 的前置依赖）
- 目标：让 `task_pattern` 从恒 NULL 变为可用的任务分类标签
- 依赖：需要"任务类型判断"能力——从本轮首条用户消息或 goal 目标提取 bugfix / feature / refactoring / test 等
- 关键点：这不是简单赋值，而是一个独立的采集功能（启发式规则或 LLM 分类，当前未实现）
- 落地后才能解锁：A2 语义聚类、以及"E2 内容 hash 升级到语义级去重"的进阶
- 未落地期间：行为级内容 hash 是唯一可用的去重手段，保留其当前局限

---

## 域 B — 冲突裁决与更新机制（知识腐化防护）[P6.2]

### B1 来源权重标注
- 为每条经验/事实增加来源字段：`user-confirmed` > `tool-derived` > `model-inferred` > `chat-mention`

### B2 冲突检测 + 覆写 / 合并
- 新经验与旧经验针对同一主题冲突时（如项目从 Webpack 迁到 Vite），识别并更新底层原子事实，或将旧经验标记为 `evicted`
- 需要主题归一化（同一事实的多种表述可归并）才能识别冲突

---

## 域 C — 知识提炼与升华（lesson 质量）[P2, P4, P6.3]

### C1 用 LLM 生成 lesson，而不是规则模板 [P2]
- 当前：按 score 套模板，所有高分经验 lesson 文本几乎一样
- 修复：在 `agent/run-maintenance` 里调用 dsh 的 `ctx.llm` 服务
- 输入：工具调用序列 + 结果 + 评分；输出：结构化 `{what_worked, what_failed, what_to_try_differently, reusable_lesson}`
- 无 LLM 时 fallback 到规则模板

### C2 lesson 要有可操作性 [P2]
- 当前：lesson 是"工具序列 [write → bash] 效果好"——太泛
- 修复：lesson 包含具体场景信息，如"写异步代码时忘了 Promise rejection 处理导致 bash 报错"
- LLM 反思应分析具体 `actions` JSON 内容，不只看工具名

### C3 触发 `agent/run-maintenance` 生成 lesson [P2]
- 当前：headless 模式不触发 maintenance，lesson 永远为空
- 修复：在 `turn-stopping` 里直接同步生成，或 turn 结束后用 `setTimeout` 异步触发反思

### C4 lesson 结构化 JSON 落库 [P4]
- 当前：lesson 是纯文本
- 修复：把 LLM 反思完整 JSON 存入 lesson，注入时提取 `reusable_lesson`，查询可按 `what_failed` 等字段精细匹配
- 兼容：非 JSON（旧数据或规则模板）按纯文本处理

### C5 定期聚类与抽象（碎片 lesson → 高层规则/Skill）[P2, P6.3]
- 问题：lesson 细化导致经验库膨胀，大量相似 lesson 重复注入浪费 token
- 后台维护任务（复用 `agent/run-maintenance`）：定期审视底层原子事实/经验，聚合成高层通用规则或 Skill——真正的自进化
- 定期合并（每积累 20 条新 lesson 或每次 maintenance 时）：
  - 阶段一：按 `difficulty` + 工具序列相似度聚类（SQL GROUP BY 粗分组）
  - 阶段二：组内 lesson 交给 LLM 总结共通之处合并成一条，格式 `{merged_from: [...], what_worked, what_failed, reusable_lesson}`
  - 被合并的旧 lesson 标记 `merged: true`，注入时跳过
  - 触发：maintenance 时检查未合并 lesson 数量超阈值即执行
  - 示例：三条异步相关 lesson → "异步代码常见问题：Promise rejection 未捕获、缺 try-catch、Promise.all 需配合 allSettled"

---

## 域 D — 评分与结果采集 [P0, P1]

### D1 加入工具调用步数（效率）维度 [P0]
- 当前：2 步完成和 18 步完成都得 0.9 分
- 公式：`max(0, 1 - (stepCount - 1) * 0.05)`（3 步=0.9，10 步=0.55）
- 重新分配权重：goalProgress 0.3 + toolSuccess 0.2 + stepEfficiency 0.25 + guard 0.15 + feedback 0.1

### D2 区分任务难度，防止简单任务经验覆盖难任务经验 [P0]
- 当前：简单任务（2 步、全成功）score 高排前，难任务经验被挤掉；步数少 ≠ 经验有价值
- 存储：步数 <= 2 的简单任务不存储（或标记 `difficulty: low` 注入时降权）
- 召回：注入按"信息量"排序而非纯 score——步数多 + 有失败 + 有 lesson 优先
- `difficulty` 字段：low（1-2 步全成功）/ medium（3-6 步）/ high（7+ 步或有过失败）

### D3 用户反馈：用隐式负信号替代主动反馈 [P1]
- 当前：feedback 永远是 0.5（none），用户一般不主动点赞/踩
- 改用被动观测隐式信号，只捕获负反馈：
  - 同 turn 用户消息在 agent 回复后发 step>1 → `negative`
  - 用户中断 agent（`turn/end` reason `aborted`）→ `negative`
  - 用户重述任务（与上一条高度相似）→ `negative`
  - 无负信号 → `neutral`（0.6）；用户主动点赞 → `positive`（1.0，可选，需挂 message-feedback）
- 权重：feedback 从 0.2 降到 0.1 让给 stepEfficiency

### D4 接入 goal 服务（web 模式）[P1]
- 当前：goal 从 `turn/end` reason 判断，web 模式下用户可用 goal 工具
- 优先 `ctx.get('goals').get(agent)` 获取真实 goal phase；fallback `turn/end` reason（已完成）

### D5 评分区分度（验收标准）[P1]
- 目标：加入 D1 步数维度后，分数范围从 0.9 扩展到 0.4–0.95
- 增加失败任务测试用例制造差异

---

## 域 E — 行为适配注入 [P0, P3, P4]

### E1 每个 turn 只注入一次经验 [P0]
- 当前：`agent/pre-step` 每 step 触发，同一段经验在 turn 内重复注入 N 次
- 修复：每个 turn 第一个 step 注入，后续跳过；或改用 `agent/turn-start`（如有）做 turn 级注入
- **边界 bug**：当前注入取 `sorted[0]` 与 `sorted[last]`，当 `records.length < 2` 时两者是同一记录，会注入两条相同的 best/worst。改 E1 时加 `best.id !== worst.id` 保护

### E2 经验去重：内容 hash [P0]
- 当前：5 条内容几乎一样的经验全被查出注入
- **context_hash 不可靠（不能当去重键）**：它只编码"工具名 + 工作目录"，语义无力；且 `workspace_digest` 在同一项目恒同、工具序列易撞，区分度基本失效
- 方案（行为级内容 hash，2026-08 评审确定）：
  - 写入时对「有序工具调用序列（含成败）+ 工作区」做 sha1，存新字段 `content_hash`
  - 输入取 `actions` 的 `tools` 段（`[{name,success}]`，调用顺序即语义，**不排序**）；`goalProgress`/`feedback` 是结果不计入，避免拆开真重复
  - query 返回后按 `content_hash` 去重，相同只留最优一条（score 最高，其次最新）
  - 局限：跨任务用同工具序列仍会误判为重复——该语义归 A2 的 task_pattern，见独立 todo A7
  - 数据库兼容：已有表 `ALTER TABLE ADD COLUMN content_hash TEXT`；新表在 CREATE 直接带列

### E3 注入内容动态控制 [P3]
- 当前：固定 limit，注入过长或过短
- 按难度动态伸缩：high 优先（最多 5 条）、medium 填充（最多 2 条）、low 不注入
- 按 token 预算：总长不超过 2000 token（约 800 汉字），超了从低优先级砍
- lesson 不硬截断——单条超长说明反思质量有问题，应在 C5 合并阶段解决
- 若 lesson 是结构化 JSON，注入只取 `reusable_lesson`（关联 C4）

---

## 域 G — 可选增强 [P5]

### G1 WebUI 可视化经验库
- 当前：只能用 sqlite3 命令查看经验
- 做 GUI 插件，在 WebUI 展示经验库统计和 lesson 列表

### G2 前端导入 / 导出经验
- 当前：本地 SQLite，换机器就没了
- 导出：全量导出 JSON 文件，格式 `[{id, outcome_score, tools_used, lesson, difficulty, generation, ...}]`，文件名 `experiences-export-{date}.json`
- 导入：按 `id` 去重（已存在跳过或覆盖），统一进新生代正常晋升；导入前预检 JSON 格式、字段完整性，显示"将导入 N 条，其中 M 条重复"
- 场景：换机迁移、团队共享、定期备份

---

## 域 H — 记忆写入隔离 [P6.4]

- **注**：当前设计已天然满足核心要求——记忆通过旁路 SQLite sidecar 直接落库，不写 Session Log 事件流，无自引用循环。仅缺显式标记。

### H1 独立事件标记（可选增强）[P6.4]
- 若未来引入记忆事件流（如写入/驱逐触发其他插件），使用独立标记 `memory:write` / `memory:evict`
- 消费隔离约束：记忆构建只消费"用户交互事件流"，不消费"自身记忆事件流"
# TODO — self-improving 插件缺陷修复

## 整合说明（2026-08-25）

由原 P0–P6 分区**按主题域去重重组**，每个需求只出现一次，每项保留原始优先级标签 `[Pn]` 以便追溯优先级。

去重合并关系：
- 「P2 定期合并 lesson」+「P6.3 聚类抽象」→ 域 C5（同一件事）
- 「P3 分代淘汰」→ 域 A4（TTL/遗忘的具体实现方案）
- 「P4 两阶段召回/粗筛精筛」+「P6.1 底层双索引」→ 域 A3（BM25 即粗筛落点）
- 「P5 按任务类型分类」+「P6.1 中层场景聚类」→ 域 A2（task_pattern 即聚类键）

> 标记说明：`[x]` = 已完成（已对照源码核实），`[~]` = 部分完成，`[ ]` = 未完成

---

## 前置项 — 任务边界与存储单元（2026-08-25 评审确认）

**背景**：当前隐式一个 turn = 一个任务，但不成立（一个 turn 可含多个任务、一个任务可跨多个 turn）；且无 goal 的普通会话大量存在（常识问答/闲聊/单次提问）。

**决策**：任务边界用分层策略，不依赖单一锚点。
- 有 goal 的长任务 → 以 goal 为单位跨 turn 聚合，`active→complete` 一次结算为一条任务经验
- 无 goal 但多步工具操作 → 以连续工具操作簇为任务（≈turn，用 D1 步数判定）
- 纯问答 / 单次常识 → 判为无任务（low 价值），**不存储**，避免污染

### P-A 查证 dsh 的 goal 创建机制 [x]
- ~~当前 [index.ts L291-302](file:///d:/Code/projects/dsh-self-improving/src/index.ts#L291-L302) 只消费 goal 的 `phase`，**未见创建路径**~~ 已查证
- **查证结论**：dsh 的 goal 服务（`ctx.goals`，即 `GoalService`）位于 `packages/goal/goal/src/index.ts`
  - goal 由用户通过 `tool-goal` 插件创建（`@Remote('create')`），Standard mode 默认包含，Minimal mode 不含
  - `GoalPhase`：`active` → `complete`/`blocked`/`paused`，每次变更是持久化的 `goal/change` 会话事件
  - `GoalView` 含 `id`（GoalId）、`revision`（乐观锁）、`roundsStarted`（已开始的 round 数）、`activation`（进程本地续跑资格）
  - goal 是可选插件（`goals?: GoalConfig | false`），headless/minimal 模式无 goal
- **决策**：以 goal 为聚合单位在 web 模式可行；无 goal 时以 turn 为单位（分层策略不依赖单一锚点）✓

### P-B 会话分流 / 低价值过滤 [x]
- ~~`turn-stopping` 按特征分流：有 goal / 多步工具 / 单步问答~~ 已实现
- 纯问答（low 难度、无/少工具调用）不存储，避免污染 ✓
- 实现：`turn-stopping` 中三层分流（`index.ts:667-678`）：
  1. 无工具调用 → 不存储（纯文本问答）
  2. `difficulty=low` 且工具数 ≤ 2 → 不存储（低价值：简单查找/一步操作）
  3. 否则 → 存储
- 复用 `computeDifficulty(stepCount, hasFailures)` 判定，无需额外信号 ✓

### P-C 引入"任务单元"的存储模型 [x]
- ~~现状：一条经验 = 一个 turn（`turnId="turn-N"`）~~ 已引入任务单元
- 调整为任务单元：跨 turn 聚合（goal 或连续行为），任务 complete/结束时汇总 lesson、难度、工具序列 ✓
- 实现：
  - 新增 `task_unit_id`（ULID）和 `goal_id` 字段（`types/index.ts:76-78`，`experience-store.ts:49-50`）
  - 有 goal 时：同一 goal 的所有 turn 共享同一 `taskUnitId`（通过 `agentTaskUnits` Map 跟踪，`index.ts:610-612`）
  - 无 goal 时：每个 turn 独立 `taskUnitId`（默认 = experience id）
  - goal `active` → 复用同一任务单元；goal `complete` → 任务单元关闭（`index.ts:838-842`）
  - 数据库索引：`idx_experiences_task_unit` + `idx_experiences_goal`（`experience-store.ts:91-92`）
  - 导入/导出同步 `taskUnitId`/`goalId` 字段 ✓
- 聚合是确定性的，不需要 LLM 参与；LLM 只在聚合后的 lesson 提炼阶段（C5）参与 ✓

---

## 域 A — 记忆存储分层（淘汰 + 检索）

记忆从单一 `experiences` 表升级为三层金字塔 + 分代淘汰 + 双索引召回，对应外部评审 P6.1。

### A1 顶层：用户画像 / 核心偏好常驻层 [P6.1] [x]
- 独立存储（容量极小，约 <1KB），每次 Prompt 组装时默认嵌入，永不淘汰
- 区别于现有 `systemPrompt.section` 的临时统计：需要持久化、带高置信度确认的来源
- 注：该层作为 advisory 注入，不改变主循环

#### A1-a 用户显式偏好提取（规则匹配，第一步）[x]
- ~~用户在对话中说"请记住我偏好简洁回答"等，自动提取并写入持久化文件~~ 已实现
- **实现**：`index.ts` 中 `extractPreference()` 函数，两组正则匹配中英文偏好声明模式
  - 触发词：请记住/记住/以后总是/我偏好/我喜欢/我习惯于/remember I prefer 等
  - 排除词：帮我/请帮/create/edit/fix 等任务指令开头
- **存储**：`appendPreference()` 写入 `~/.dsh/preferences.md`，case-insensitive 子串去重
- **调用位置**：`turn-stopping` 中 P5 task pattern 推断之后（`index.ts` turn-stopping handler）
- **局限**：规则匹配无法处理隐式偏好；语义级提取留到 A1-b ✓

#### A1-b 自动偏好提炼 + LLM 提取（第二步，依赖 C5/LLM）[x]
- ~~从经验库统计和对话历史中自动提炼偏好，无需用户显式声明~~ 已实现
- **实现**：`distillPreferencesWithLLM()` 函数（`index.ts`），在 `run-maintenance` 中调用
  - 通过 `tryLLMComplete()` 动态桥接 `ctx.llm`（不硬依赖，无 LLM 时跳过）
  - 收集最近 30 条 lesson + 统计数据，构造 prompt 让 LLM 提取 0-3 条高置信度偏好
  - 需 ≥20 条经验 + ≥5 条 lesson 才触发（避免数据不足时误提炼）
  - 只接受 `confidence: "high"` 的偏好，低置信度不写入
  - 写入 `~/.dsh/preferences.md` 的 `## Auto-distilled` section，带 `- [auto]` 标记区分手动/自动
  - 与 A1-a 的手动偏好去重（case-insensitive 子串匹配）
- **注入同 A1-c**：统一通过 `systemPrompt.section` 读取 `preferences.md` 注入 ✓

#### A1-c 注入通道 [x]
- ~~当前 `text()` 注入的是临时统计（avgScore 等），改为读取 `~/.dsh/preferences.md` 内容即可~~ 已改造
- `systemPrompt.section({ name: 'self-improving-learned-preferences', order: 450 })` 的 `text()` 现在优先读取 `~/.dsh/preferences.md`，叠加 live stats 作为补充信号
- rule-enforcement 的注入通道（`rules.md` → `systemPrompt.section({ order: 200 })`）不改动，两套独立 ✓

### A2 中层：场景聚类跨项目经验 + TTL 过期 [P5, P6.1] [x]
- **按主题聚类历史会话**：以 `task_pattern` 为聚类键，已由 A7 实现落值（`inferTaskPattern`），注入时按 task_pattern 优先匹配 ✓
- **TTL 过期机制**：已实现 `applyTTL()`（`experience-store.ts`），30 天未注入的老年代经验降级到新生代，重新参与 Minor GC
  - 高难度有 lesson 的经验豁免（知识可能仍有效即使久未注入）✓
  - 在 `enforceRetention()` 中每次 store 时触发 ✓

### A3 底层：原子事实 + 双索引检索 [P4, P6.1] [x]
- **原子事实表已实现**：`atomic_facts` 表（subject/predicate/object/source/confidence/evicted），永不过期，FTS5 全文索引，触发器自动同步
  - `upsertFact()` 插入或更新事实，同 subject+predicate 存在则更新并提升 confidence
  - `queryFacts()` 按 subject 精确查询或 FTS5 全文搜索
  - `evictFact()` 软删除（标记 evicted=1）
  - `detectFactConflicts()` 检测同 subject+predicate 不同 object 的冲突，按来源权重排序 ✓
- **两阶段召回**：已实现粗筛 + 精筛（`experience-store.ts` query 方法）
  - **FTS5 + BM25 已实现**：`experiences_fts` 虚拟表索引 lesson/actions，有 `searchText` 时 BM25 排序粗筛 ✓
  - **E2 content_hash 去重已实现**：`computeContentHash()` 对有序工具序列含成败做 sha1，去重优先用 `content_hash`，无值时 fallback 到 `context_hash` ✓
  - 精筛综合评分已实现：`outcome_score × 0.4 + 工具相似度 × 0.3 + 时间近度 × 0.3` ✓
  - 两阶段都走 SQL，避免全表扫描 ✓

### A4 分代淘汰策略（TTL / 遗忘的具体实现）[P3] [x]
- ~~当前：1000 条上限 FIFO eviction，没被触发过~~ 已实现分代 GC
- 借鉴 JVM 分代 GC，管理方式：
  - **新生代（Young）**：新经验先进，容量 200 条；Minor GC 淘汰低质量（score 低、无 lesson、difficulty 低）；存活经验（被多次注入或 score 高）晋升老年代 ✓
  - **老年代（Old）**：容量 800 条，仅晋升进入；Major GC 按自身质量淘汰，不看使用频率：`difficulty: low` > 无 lesson > `score < 0.5` > 已被合并（`merged: true`）。**不淘汰** `difficulty: high` 且有 lesson 的经验；极端不足时淘汰 score 最低者 ✓
  - **晋升条件**：新生代被注入（`reuse_count >= 1`）、LLM 合并产物、或 `score >= 0.8` 且有 lesson ✓
  - 数据库实现：`generation` 字段（0=新生代, 1=老年代）+ `last_injected_at` ✓
  - 代码位置：`experience-store.ts:437-526`

### A5 主动遗忘机制 [P6.3] [x]
- ~~主动清理低价值、低置信度经验，不依赖被动 FIFO 上限~~ 已实现
- **实现**：`activeForget()`（`experience-store.ts`），在 `enforceRetention()` 中每次 store 时触发
- **条件**：`score < 0.3 AND confidence < 0.2 AND lesson IS NULL AND difficulty = 'low' AND merged = 0`
- 不删除有 lesson、高难度、或已被合并的经验 ✓
- 与 A4 分代策略配合：主动遗忘在 GC 前执行，先清理噪声再处理容量压力 ✓

### A6 检索范围动态伸缩 [P4] [x]
- ~~当前：query 固定返回 limit 条~~ 已实现动态候选集
- 根据经验库总量动态调整候选集：<50 条全量精筛；50–200 条粗筛 top 20；>200 条粗筛 top 50 ✓
- 代码位置：`experience-store.ts:248-256`
- 注：粗筛质量高（avg > 0.8）缩小范围，质量低则扩大 — 未实现（仅按数量分档）

### A7 任务类型判断落值（A2 的前置依赖）[x]
- ~~目标：让 `task_pattern` 从恒 NULL 变为可用的任务分类标签~~ 已实现
- `inferTaskPattern()` 在 `src/types/index.ts:230` 实现，从用户首条消息关键词推断 bugfix/feature/refactoring/search/test-writing/general
- 存储环节：`turn-stopping` 中自动推断并存入（`index.ts:776-784`）
- 注入环节：`agent/pre-step` 中按 `task_pattern` 优先匹配（`index.ts:857-863`）
- 未落地期间的限制已消除：行为级去重已改用 `content_hash`（E2 已实现，优先于 `context_hash`）✓

---

## 域 B — 冲突裁决与更新机制（知识腐化防护）[P6.2]

### B1 来源权重标注 [x]
- ~~为每条经验/事实增加来源字段~~ 已实现
- `atomic_facts` 表有 `source` 字段（`user-confirmed`/`tool-derived`/`model-inferred`/`chat-mention`）
- `experiences` 表新增 `source` 列（migration via `ensureColumn`）
- `SOURCE_WEIGHTS` 排序：`user-confirmed(4) > tool-derived(3) > model-inferred(2) > chat-mention(1)` ✓
- `detectFactConflicts()` 中按来源权重排序冲突项 ✓

### B2 冲突检测 + 覆写 / 合并 [x]
- ~~新经验与旧经验针对同一主题冲突时，识别并更新或标记 evicted~~ 已实现
- `detectFactConflicts()`：检测同 subject+predicate 不同 object 的冲突 ✓
- `evictFact(id)`：软删除旧事实（标记 `evicted=1`），保留历史可追溯 ✓
- `upsertFact()`：同 subject+predicate 存在时更新 object 而非创建重复 ✓
- 注：主题归一化（同一事实的多种表述可归并）未实现，当前 subject 需精确匹配

---

## 域 C — 知识提炼与升华（lesson 质量）[P2, P4, P6.3]

### C1 用 LLM 生成 lesson，而不是规则模板 [P2] [x]
- ~~当前：按 score 套模板，所有高分经验 lesson 文本几乎一样~~ 已实现结构化反思
- rule-based 反思生成完整 `{whatWorked, whatFailed, whatToTryDifferently, reusableLesson}` JSON（`meta-cognition-engine.ts:149`）
- LLM 反思路径已定义（`llmReflect`），无 LLM 时 fallback 到规则模板 ✓
- 注：LLM 桥接已通过 `tryLLMComplete()` 实现（动态获取 `ctx.llm`，不硬依赖），C5 lesson 合并和 A1-b 偏好提炼共用此桥接 ✓

### C2 lesson 要有可操作性 [P2] [x]
- ~~当前：lesson 是"工具序列 [write → bash] 效果好"——太泛~~ 已改进
- lesson 包含具体场景信息（步数、难度、失败工具），见 `generateStructuredReflection`（`index.ts:513-564`）
- rule-based 反思分析具体 `actions` JSON 内容（`meta-cognition-engine.ts:149-166`） ✓

### C3 触发 `agent/run-maintenance` 生成 lesson [P2] [x]
- ~~当前：headless 模式不触发 maintenance，lesson 永远为空~~ 已修复
- `turn-stopping` 中同步入队反思（`index.ts:793-804`）
- `agent/run-maintenance` 时处理队列（`index.ts:960-1006`） ✓

### C4 lesson 结构化 JSON 落库 [P4] [x]
- ~~当前：lesson 是纯文本~~ 已实现结构化存储
- `updateLesson(id, reflection)` 把完整 Reflection JSON 存入 lesson 字段（`experience-store.ts:178-189`）
- 注入时通过 `extractLessonText()` 提取 `reusableLesson`（`types/index.ts:194-208`）
- 兼容：非 JSON（旧数据或规则模板）按纯文本处理 ✓

### C5 定期聚类与抽象（碎片 lesson → 高层规则/Skill）[P2, P6.3] [x]
- 问题：lesson 细化导致经验库膨胀，大量相似 lesson 重复注入浪费 token
- 定期合并（每积累 20 条 lesson）：
  - 阶段一：按 `difficulty` + 工具序列相似度聚类 — `getUnmergedLessonGroups`（`experience-store.ts:646-681`）✓
  - 阶段二：组内 lesson 合并成一条 — `mergeLessons`（`experience-store.ts:687-743`）✓
    - 独立 engine：`meta-cognition-engine.ts:331-358`（LLM + rule-based fallback）
    - index.ts 内联：`llmMergeLessons()` 通过 `tryLLMComplete()` 桥接 `ctx.llm`，fallback 到 `mergeLessonsRuleBased()` ✓
  - 被合并的旧 lesson 标记 `merged: true`，注入时跳过 ✓
  - 触发：maintenance 时检查未合并 lesson 数量超阈值即执行 ✓

---

## 域 D — 评分与结果采集 [P0, P1]

### D1 加入工具调用步数（效率）维度 [P0] [x]
- ~~当前：2 步完成和 18 步完成都得 0.9 分~~ 已修复
- 公式：`max(0, 1 - (stepCount - 1) * 0.05)`（1步=1.0, 3步=0.9, 10步=0.55）— `computeStepEfficiency`（`types/index.ts:169-172`）✓
- 权重重新分配：goalProgress 0.3 + toolSuccess 0.2 + stepEfficiency 0.25 + guard 0.15 + feedback 0.1 — `SCORE_WEIGHTS`（`types/index.ts:152-158`）✓

### D2 区分任务难度，防止简单任务经验覆盖难任务经验 [P0] [x]
- ~~当前：简单任务（2 步、全成功）score 高排前，难任务经验被挤掉~~ 已修复
- 存储：`difficulty` 字段 low/medium/high（`types/index.ts:180-188`）✓
- 召回：注入按 difficulty 优先排序（`experience-store.ts:288-295`）✓
- `difficulty`：low（1-2 步全成功）/ medium（3-6 步）/ high（7+ 步或有过失败）✓
- 注：步数 <= 2 的简单任务由 P-B 低价值过滤直接不存储（`index.ts:667-678`）✓

### D3 用户反馈：用隐式负信号替代主动反馈 [P1] [x]
- ~~当前：feedback 永远是 0.5（none），用户一般不主动点赞/踩~~ 已修复
- 被动观测隐式信号：
  - 用户中断 agent（`turn/end` reason `aborted`）→ `negative`（`index.ts:706-708`）✓
  - 同 turn 内用户追问/纠正（step > 1 且有用户消息）→ `negative`（`index.ts:710-718`）✓
  - 用户重述任务（与上一条高度相似）→ `negative` — **未实现**（仅检测 step>1，无文本相似度比较）
  - 无负信号 → `neutral`（0.6）（`index.ts:757`）✓
  - 用户主动点赞 → `positive`（1.0，需 message-feedback 插件）（`index.ts:724-746`）✓
- 权重：feedback 从 0.2 降到 0.1（`SCORE_WEIGHTS.userFeedback: 0.1`）✓

### D4 接入 goal 服务（web 模式）[P1] [x]
- ~~当前：goal 从 `turn/end` reason 判断~~ 已修复
- 优先 `ctx.get('goals').get(agent)` 获取真实 goal phase（`index.ts:654-665`）✓
- fallback `turn/end` reason（`index.ts:667-686`）✓

### D5 评分区分度（验收标准）[P1] [x]
- ~~目标：加入 D1 步数维度后，分数范围从 0.9 扩展到 0.4–0.95~~ 已达成
- 实际分数范围：0.275–0.9875（CHANGELOG 记录）✓
- 有失败任务测试用例制造差异 ✓

---

## 域 E — 行为适配注入 [P0, P3, P4]

### E1 每个 turn 只注入一次经验 [P0] [x]
- ~~当前：`agent/pre-step` 每 step 触发，同一段经验在 turn 内重复注入 N 次~~ 已修复
- 每个 turn 第一个 step 注入，后续跳过（用 `injectedThisTurn` 标记）✓
- **边界 bug 已修复**：`worst` 在 `sorted.length <= 1` 时为 null，且 `worst.id !== best.id` 保护已加 ✓

### E2 经验去重：内容 hash [P0] [x]
- ~~5 条内容几乎一样的经验全被查出注入~~ 已修复
- **已实现**：`computeContentHash()` 对有序工具序列含成败做 sha1，存 `content_hash` 字段
- 去重优先用 `content_hash`，无值时 fallback 到 `context_hash`（`deduplicateByContextHash`）
- 保留最优一条（score 最高，其次最新）✓
- 数据库有 `content_hash` 列 + 索引 ✓

### E3 注入内容动态控制 [P3] [x]
- ~~当前：固定 limit，注入过长或过短~~ 已修复
- 按难度动态伸缩：high 优先（最多 5 条）、medium 填充（最多 2 条）、low 不足时填充（`index.ts:870-875`）✓
- 注：按 token 预算控制（总长度 ≤ 8000 字符）在 `behavior-adapter.ts` 中有 `computeDynamicLimit`，但实际限制为固定 10 条（token 预算控制未完全实现）
- 若 lesson 是结构化 JSON，注入只取 `reusable_lesson`（`extractLessonText`，`index.ts:882`）✓

---

## 域 G — 可选增强 [P5]

### G1 WebUI 可视化经验库 [x]
- ~~当前：只能用 sqlite3 命令查看经验~~ 已实现
- GUI 插件 `dsh-self-improving-gui`（`gui/` 目录）
  - WebUI Settings → Plugins → Experiences 页面 ✓
  - 展示经验库统计：总数、平均分、含 lesson 数、正/负反馈数、高难度数、新生代/老年代数、合并数 ✓
  - React 组件：`gui/client/ExperiencesPanel.tsx` ✓
  - 通过 `ctx.settingsScope.bind` 读写（`index.ts:1013-1057` GUI bridge）✓

### G2 前端导入 / 导出经验 [x]
- ~~当前：本地 SQLite，换机器就没了~~ 已实现
- 导出：`exportAll()` 全量导出 JSON（`experience-store.ts:753-772`）✓
- 导出（按任务类型）：`exportByTaskPattern(pattern)`（`experience-store.ts:777-796`）✓
- 导入：`importExperiences(data)` 按 id 去重，已存在跳过（`experience-store.ts:804-880`）✓
- 导入前预检：`isValidImportedExperience()` 校验 JSON 格式和字段完整性（`types/index.ts:273-290`）✓
- 导入经验统一进新生代（generation=0）✓

---

## 域 H — 记忆写入隔离 [P6.4]

### H1 独立事件标记（可选增强）[P6.4] [x]
- **注**：当前设计已天然满足核心要求——记忆通过旁路 SQLite sidecar 直接落库，不写 Session Log 事件流，无自引用循环。✓
- 若未来引入记忆事件流（如写入/驱逐触发其他插件），使用独立标记 `memory:write` / `memory:evict`
- 消费隔离约束：记忆构建只消费"用户交互事件流"，不消费"自身记忆事件流" ✓
- 当前无需显式标记（无记忆事件流）✓

---

## 域 I — 架构改进（2026-08-26 评审）

> 目标：让已实现的功能在运行时真正生效，补通数据管道，让学习闭环变成双向的。

### I1 删掉 index.ts 内联 ExperienceStore，改为 import 独立版 [P0] [x]
- ~~index.ts 内联了一份简化版 ExperienceStore（~500 行），和独立版重复实现~~ 已删除
- 删掉内联 ExperienceStore 类（~457 行），改为 `import { ExperienceStore } from './store/experience-store.js'`
- 统一 query 调用为对象参数（`store.query({ ... })`），统一 store 调用为 `store.store(outcome, context)` 签名 ✓
- `difficultyPriority` 改为内联函数（独立版是 private）✓
- index.ts 从 1424 行减到 ~1000 行 ✓

### I2 run-maintenance 中 lesson 生成接通 LLM [P0] [x]
- ~~运行时只走 rule-based，LLM lesson 生成没接通~~ 已接通
- `run-maintenance` 中先用 `tryLLMComplete(buildLessonPrompt(entry))` 生成 lesson，解析 JSON 失败再 fallback 到 `generateStructuredReflection` ✓
- `buildLessonPrompt()` 函数：从 actions JSON 提取工具名/失败工具/步数/难度，构造 LLM prompt ✓
- LLM 不可用时自动 fallback，标注日志来源（LLM/rule-based）✓

### I3 pre-step query 传 searchText [P1] [x]
- ~~pre-step 的 query 调用没传 searchText，FTS5 检索在运行时不会被触发~~ 已接通
- pre-step 中从当前用户消息提取 `searchText`（msgText 前 100 字符），传入 query ✓
- 现在注入时按 BM25 语义相关性召回，而非纯 score 降序 ✓

### I4 turn-stopping 中提取原子事实写入 atomic_facts [P1] [x]
- ~~turn-stopping 从未调用 upsertFact，表是空的~~ 已接通
- turn-stopping 中根据 outcome_score 提取事实写入：
  - score ≥ 0.7 → `upsertFact(subject, 'effective-tool-sequence', tools, 'tool-derived')`
  - score ≤ 0.3 → `upsertFact(subject, 'failed-tool-sequence', tools, 'tool-derived')`
  - 有 taskPattern → `upsertFact(subject, 'task-type', taskPattern, 'model-inferred')` ✓
- B1/B2 在运行时现在有数据可用 ✓

### I5 experiences 表 store() 接受 source 参数 [P1] [x]
- ~~store() 不接受 source 参数，所有经验写入时都是默认值~~ 已接通
- `store()` context 参数加 `source?: string` ✓
- turn-stopping 中根据反馈来源赋值：`positive → 'user-confirmed'`，`implicitNegative → 'tool-derived'`，其他 → `'model-inferred'` ✓
- `ExperienceRecord` 类型加 `source` 字段 ✓

### I6 注入反馈闭环：高 score 时 boost 被注入经验 confidence [P2] [x]
- ~~缺少"注入的经验是否有帮助"的反馈~~ 已实现
- run-maintenance 中 outcome_score ≥ 0.7 时，query 相似经验并 `boostConfidence` ✓
- 好经验被注入后会通过新轮的高分反馈被 boost，经验库越用越准 ✓

### I7 删掉三个独立类死代码 [P2] [ ]
- **保留**：`BehaviorAdapter`、`OutcomeEvaluator`、`MetaCognitionEngine` 三个独立类被测试文件和 benchmark 引用，不能直接删
- 注：index.ts 已不再内联重复实现这些类的逻辑，运行时统一用 index.ts 内联的函数 + 独立版 ExperienceStore

### I8 index.ts 模块化拆分 [P3] [ ]
- index.ts 从 1424 行减到 ~1000 行（I1 删了 ~457 行内联 store），仍超 300 行
- 拆分优先级低，当前功能已全部接通，后续按需拆

---

## 域 J — 第二轮架构评审（2026-08-26）

> 焦点：功能是否真正闭环、数据是否真正流通，不再关注代码风格。

### J1 pre-step 初始化缺少 taskUnitId/goalId [P0] [x]
- ~~pre-step 的 `agentTools.set` else 分支缺少 `taskUnitId` 和 `goalId`~~ 已修复
- pre-step else 分支复用 `agentTaskUnits` Map 查找/创建 task unit，含 goal 服务解析 ✓

### J2 B2 冲突检测未在运行时调用 [P1] [x]
- ~~`detectFactConflicts()` 从未在运行时调用~~ 已接通
- run-maintenance 中 C5 合并之前调用 `detectFactConflicts()`，对低来源权重的冲突事实调 `evictFact()` ✓

### J3 导入/导出缺少 source/contentHash 字段 [P1] [x]
- ~~`ExportedExperience` 不包含 `source` 和 `contentHash`~~ 已补上
- `ExportedExperience` 加 `source` 和 `contentHash` 字段 ✓
- `exportAll`/`exportByTaskPattern` 映射补上 ✓
- `isValidImportedExperience` 校验加 `source` 必填 ✓
- 测试数据同步加 `source` 字段 ✓

### J4 原子事实注入未接入 systemPrompt [P1] [x]
- ~~`queryFacts()` 从未在注入中被调用~~ 已接通
- systemPrompt.section 的 `text()` 中加入 `store.queryFacts()` 内容，注入 effective/failed tool sequence ✓

### J5 preferences.md 读写无并发保护 [P2] [x]
- ~~`appendPreference` 和 `distillPreferencesWithLLM` 并发写可能互相覆盖~~ 已修复
- 写文件改为 temp file + rename 原子写入（`writeFileSync(tmp) → renameSync`）✓

### J6 run-maintenance 中 LLM 调用无超时保护 [P2] [x]
- ~~`tryLLMComplete` 无超时，慢 LLM 阻塞 maintenance~~ 已修复
- `tryLLMComplete` 加 `AbortController` + 30s 超时，超时后 `controller.abort()` 中断流式 ✓

### J7 I6 boost confidence 逻辑未区分"注入过的"和"相似的" [P2] [x]
- ~~boost 了从未被注入过的相似经验~~ 已修复
- `agentTools` Map 加 `lastInjectedIds` 字段，pre-step 注入时记录 selected ids ✓
- `PendingReflection` 加 `injectedIds`，turn-stopping 入队时传入 ✓
- run-maintenance 中只 boost `entry.injectedIds` 中的经验，不再 query 相似经验 ✓

---

## 域 K — 第三轮架构评审（2026-08-26）

> 焦点：数据完整性、内存安全、运行时健壮性。

### K1 importExperiences INSERT 语句缺 source/content_hash 列 [P0] [x]
- ~~INSERT 语句没有写入 source 和 content_hash 列~~ 已修复
- INSERT 语句加 `source` 和 `content_hash` 列，`insertStmt.run` 传入 `item.source` 和 `item.contentHash`（或重新计算）✓

### K2 agentTaskUnits Map 内存泄漏 [P1] [x]
- ~~agentTaskUnits 只在 goal advanced 时清理，无 goal 的 task unit 永不清理~~ 已修复
- turn-stopping 中无 goal 的 task unit 立即清理（`agentTaskUnits.delete`）✓
- cleanup（`ctx.effect`）中 `agentTools.clear()` + `agentTaskUnits.clear()` 兜底 ✓

### K3 FTS5 searchText 对中文效果差 [P2] [~]
- searchText 做 sanitize（去标点/特殊字符），但未做中文分词
- FTS5 `unicode61` 分词器对中文连续文本仍按整段匹配，效果有限
- fallback 到 score 降序路径仍可用，非阻断性问题

### K4 pre-step 注入的 searchText 含特殊字符 [P2] [x]
- ~~searchText 直接取用户消息原文，含 FTS5 特殊语法字符~~ 已修复
- searchText 做 sanitize：去掉 `` `~!@#$%^&*()=[]{}|;:'",.<>/\ `` 等特殊字符，多空格合并，截断 100 字符 ✓

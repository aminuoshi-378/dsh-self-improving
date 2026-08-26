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
- 代码位置：`experience-store.ts:354-368`
- 质量动态伸缩已实现（M5）：50–200 条时 avgScore > 0.7 → coarseLimit 15（否则 25）；>200 条时 avgScore > 0.7 → coarseLimit 40（否则 60）✓

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
- ~~注：主题归一化（同一事实的多种表述可归并）未实现~~ → 已实现（域 T1：`normalizePredicate`/`normalizeSubject` 谓词别名归并 + subject 规范化）✓

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
  - 用户重述任务（与上一条高度相似）→ `negative` — ~~未实现~~ → 已实现（M4：词重叠相似度 > 0.7 判为重述，`index.ts` D3 分支）✓
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

### I7 删掉三个独立类死代码 [P2] [x]
- **保留**独立类，标记为"test fixture"：`BehaviorAdapter`、`OutcomeEvaluator`、`MetaCognitionEngine` 文件头注释说明"用于测试，运行时用 index.ts 内联逻辑"
- 不删的原因：测试 71 个用例依赖这些独立类 API，删除需改写全部测试
- 运行时不再重复实现——index.ts import 独立模块（preference-extractor/llm-bridge/reflection），独立类仅测试用 ✓

### I8 index.ts 模块化拆分 [P3] [x]
- ~~index.ts 1146 行~~ 已拆分为 4 个模块
- `src/preference-extractor.ts`（~180 行）：getPreferencesFilePath/readPreferences/extractPreference/appendPreference/distillPreferencesWithLLM
- `src/llm-bridge.ts`（~90 行）：tryLLMComplete（含 J6 超时）/llmMergeLessons
- `src/reflection.ts`（~130 行）：buildLessonPrompt/generateStructuredReflection/mergeLessonsRuleBased
- `src/index.ts`（780 行）：插件入口 + apply + 事件处理 + GUI bridge
- 注：index.ts 780 行仍超 300 行建议，但核心工具函数已抽出，剩余是 dsh 事件处理逻辑（不可再拆）✓

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

### K3 FTS5 searchText 对中文效果差 [P2] [x]
- ~~FTS5 默认 unicode61 分词器对中文不分词~~ 已改进
- FTS5 虚拟表改用 `tokenize='trigram'`，支持 CJK 三字 gram 匹配 ✓
- searchText 过滤掉 <3 字符的 term（trigram 要求 ≥3 字符）✓
- FTS5 搜索和 atomic_facts_fts 都改用 trigram ✓
- 旧表自动 rebuild 迁移 ✓

### K4 pre-step 注入的 searchText 含特殊字符 [P2] [x]
- ~~searchText 直接取用户消息原文，含 FTS5 特殊语法字符~~ 已修复
- searchText 做 sanitize：去掉 `` `~!@#$%^&*()=[]{}|;:'",.<>/\ `` 等特殊字符，多空格合并，截断 100 字符 ✓

---

## 域 L — 第四轮架构评审（2026-08-26）

> 焦点：构建能否通过、dist 是否与 src 同步、文档是否与代码一致。
> 结论：核心四层闭环（评分 → 存储 → 注入 → 反思）在源码层面已全部接通，但有编译错误导致 dist 过期、文档数字不准。

### L1 tsc 编译失败，dist/ 过期 [P0] [x]
- ~~**问题**：`tsc --noEmit` 有 5 类编译错误，`pnpm run build` 无法通过~~ 已全部修复
- ~~dist/index.js 停留在 I8 模块化拆分之前的版本~~ 已重新编译，dist/ 包含全部 7 个模块
- **子项**：
  - L1-a `stats.positive` / `stats.negative` → 改为 `stats.positiveCount` / `stats.negativeCount`（`index.ts` 3 处 + `preference-extractor.ts` 2 处）✓
  - L1-b `rowToRecord()` 补 `source: row.source ?? 'model-inferred'`（`experience-store.ts:856`）✓
  - L1-c `wsDigest` 的 `null` → `undefined`（`index.ts:451`，ExperienceQuery.workspaceDigest 接受 `string | undefined`）✓
  - L1-d 删除 `index.ts` 和 `preference-extractor.ts` 中未使用的 `ExperienceRecord` import ✓
  - 新增 `src/dsh-env.d.ts` ambient 声明文件，让 `tsc` 在 `@deepseek-ai/*` 包不在 node_modules 时也能编译 ✓
  - `pnpm run build` 通过，dist/ 包含全部 7 个模块（index + preference-extractor + llm-bridge + reflection + store + types + evaluator/adapter/meta-cognition）✓

### L2 README 测试数过时 [P2] [x]
- ~~README 声称 "44 个单元测试"，实际为 81 个~~ 已更新
- README.md 和 README.zh-CN.md 的测试数改为 81，补充分测试运行命令 ✓
- CHANGELOG 测试数从 44 更新为 81 ✓
- docs/test-plan.md 和 docs/design.md 中的 44 引用已更新 ✓
- `package.json` 的 `test` 脚本补上 `advanced-features.test.ts`，新增 `test:advanced` 脚本 ✓

### L3 CHANGELOG 引用了不存在的文档 [P2] [x]
- ~~CHANGELOG [0.1.0] 声称有 `docs/plugin-dev-notes.md`~~ 已删除引用，替换为 `docs/design.md` ✓
- 修复了 CHANGELOG 中重复的 design.md 行 ✓

### L4 pnpm test / pnpm run build 被 deps status check 阻断 [P1] [x]
- ~~`pnpm test` 和 `pnpm run build` 触发 pnpm 自动检查依赖状态，因 `@deepseek-ai/dsh-type-meta` 404 失败~~ 已修复
- pnpm 11 的 `verify-deps-before-run` 配置从 `.npmrc` 迁移到 `pnpm-workspace.yaml`（camelCase: `verifyDepsBeforeRun: false`）✓
- `.npmrc` 中保留注释说明原因 ✓
- `pnpm test` 和 `pnpm run build` 不再触发自动 install ✓

### L5 核心目标达成评估 [x]
- **四层架构闭环已实现**：
  - Layer 1（评分）：turn-stopping → 5 维度评分（goalProgress + toolSuccess + stepEfficiency + guardPenalty + feedback）→ 存储 ✓
  - Layer 2（注入）：pre-step（每 turn 一次，去重，动态条数）+ systemPrompt.section（偏好 + 原子事实）✓
  - Layer 3（存储）：SQLite sidecar，分代 GC，FTS5 trigram，导入/导出 ✓
  - Layer 4（反思）：turn-stopping 入队 → run-maintenance 处理（LLM 优先 + rule-based fallback）→ lesson 落库 → C5 定期合并 ✓
- **双向反馈闭环已实现**：注入经验 → 高分时 boost confidence（J7 精确 boost）✓
- **数据管道已贯通**：原子事实提取（I4）→ 冲突检测（J2）→ systemPrompt 注入（J4）✓
- ~~未实现的计划项：Phase 6 自适应策略调整~~ → 已落地两项（域 T3）：`agent/request` 模型选择 + `tools/pre-execute` 工具拦截；`repeat-tool-reminder` 守卫阈值属外部插件自身配置，不在本插件职责内
- **结论**：核心目标（跨会话学习闭环）已实现，L1 编译错误已修复，dist 产物已更新 ✓

---

## 域 M — 第五轮代码审查修复（2026-08-26）

> 焦点：todo.md 中已标注的"注：未实现"子项 + 代码审查发现的实际缺陷。

### M1 computeDynamicLimit 死代码修复 [P3] [x]
- ~~behavior-adapter.ts 中 computeDynamicLimit 三个分支都返回 10，无动态效果~~ 已修复
- 改为基于 store 质量动态调整：avgScore > 0.7 时缩小候选池（质量好不需要太多），avgScore 低时扩大（需要更多候选找有价值经验）✓

### M2 boostSimilarExperiences 无相似性过滤 [P2] [x]
- ~~MetaCognitionEngine.boostSimilarExperiences 查询时只传 minScore: 0.6，没有传 toolsUsed~~ 已修复
- 现在传入 entry.toolsUsed 做真正的相似匹配，只 boost 工具序列相同的经验 ✓
- 与 J7 运行时逻辑（只 boost injectedIds）保持一致 ✓

### M3 pendingReflections 队列无上限 [P1] [x]
- ~~pendingReflections 数组无上限，maintenance 长时间不触发时会无限增长~~ 已修复
- 新增 MAX_PENDING_REFLECTIONS = 100 上限，满时丢弃最旧条目并记录日志 ✓

### M4 D3 用户重述任务检测 [P1] [x]
- ~~D3 只检测 step > 1，无文本相似度比较~~ 已实现
- 新增词重叠相似度检测：当前 turn 用户消息与上一 turn 首条用户消息比较，词重叠 > 0.7 判为重述 → implicitNegative ✓
- 使用简单 word-overlap（split + Set），无需 LLM，确定性 ✓

### M5 A6 召回范围按经验库质量动态伸缩 [P4] [x]
- ~~experience-store.ts query 中 coarseLimit 仅按数量分档，不根据 avgScore 调整~~ 已修复
- 50-200 条时：avgScore > 0.7 → coarseLimit 15（质量好缩小范围），否则 25
- >200 条时：avgScore > 0.7 → coarseLimit 40，否则 60 ✓

### M6 E3 token 预算控制 [P3] [x]
- ~~index.ts 注入处按 difficulty 分配条数但无总字符预算控制~~ 已修复
- 新增 MAX_INJECT_CHARS = 8000 字符预算，逐条检查 lessonText 长度，超预算时截断 ✓
- 与 behavior-adapter.ts 中的 token 预算逻辑一致 ✓

### M7 CHANGELOG Node 引擎版本修正 [P2] [x]
- ~~CHANGELOG [0.1.0] 记录 "Node 引擎：>=20.0.0"，与 package.json 的 >=22.0.0 不一致~~ 已修正 ✓

---

## 域 N — 第六轮代码审查修复（2026-08-26）

> 焦点：数据格式兼容性、置信度逻辑一致性、性能和注入边界。

### N1 MetaCognitionEngine.parseActions 工具格式不兼容 [P0] [x]
- ~~parseActions 只解析 {tool,ok} 格式，运行时写入的是 {name,success}，工具名全部丢失~~ 已修复
- 加入 normalizeToolEntry 逻辑：t.name ?? t.tool 提取工具名，t.success ?? t.ok 提取成功状态 ✓
- 与 reflection.ts 中的 normalizeToolEntry 保持一致 ✓

### N2 incrementReuse 置信度衰减覆盖 boostConfidence [P1] [x]
- ~~incrementReuse 用绝对公式 1.0-(reuse_count+1)*0.1 重置 confidence，boostConfidence 的 +0.2 被覆盖~~ 已修复
- 改为相对衰减 confidence * 0.9（每次注入衰减 10%），boost 的累积效果不再被重置 ✓
- 最低仍保留 0.1 下限 ✓

### N3 GUI 导入后统计刷新（核实无缺陷）[x]
- 经核实，GUI 导入成功后已通过 guiScope.update({ stats: ... }) 推送新统计 ✓

### N4 J4 原子事实注入无数量限制 [P2] [x]
- ~~store.queryFacts() 无参数返回所有事实（最多 100 条），多工作区时淹没 system prompt~~ 已修复
- 限制注入为 top 3 effective + top 3 failed，避免 system prompt 膨胀 ✓
- 注：text() 回调无 agent 上下文，无法按当前工作区过滤，数量限制为最优可行方案 ✓

### N5 distillPreferencesWithLLM 循环内重复读取文件 [P3] [x]
- ~~每次迭代调用 readPreferences(prefPath) 检查去重，N 条偏好读 N 次文件~~ 已修复
- 改为循环前读一次，写入后更新内存副本用于下次去重检查 ✓

---

## 域 O — 第七轮代码审查修复（2026-08-26）

> 焦点：数据健壮性、去重正确性、搜索过滤、评分一致性、消息格式兼容。

### O1 rowToRecord 中 JSON.parse 无异常保护 [P1] [x]
- ~~row.tools_used 和 row.tags 的 JSON.parse 无 try-catch，单条损坏记录导致全部查询崩溃~~ 已修复
- 改为 try-catch + fallback null ✓

### O2 pre-step catch 块重复调用 next() [P1] [x]
- ~~next() 在 try 块中调用后，catch 块又调用 next()，违反 waterfall 契约~~ 已修复
- next() 调用移到 try 块前，catch 块直接返回 decision（不重复调 next）✓

### O3 computeContentHash 不处理缺 name/success 的情况 [P1] [x]
- ~~直接类型断言 {name,success}[]，遇到 {tool,ok} 格式时 name=undefined，生成无意义 hash~~ 已修复
- 加入 normalizeToolEntry 逻辑，统一两种格式 ✓

### O4 FTS5 搜索路径忽略 taskPattern 过滤 [P2] [x]
- ~~FTS5 查询没有加 taskPattern 条件，同时传 searchText 和 taskPattern 时后者被忽略~~ 已修复
- FTS5 SQL 加入 taskPattern 过滤条件 ✓

### O5 stats() 包含 merged 记录拉高 avgScore [P2] [x]
- ~~avgScore 包含 merged 记录的固定高分 0.85，系统性拉高平均分~~ 已修复
- avgScore 改为只计算 merged=0 的记录 ✓

### O6 mergeLessons INSERT 缺 source/content_hash 列 [P2] [x]
- ~~INSERT 语句缺少 source 和 content_hash 列，merged 记录无法通过 source 区分，且相同工具集的合并被误去重~~ 已修复
- INSERT 加入 source 列（'model-inferred'）和 content_hash 列（`merge-${contextHash}` 避免重复）✓

### O7 neutral feedback 评分不一致 [P2] [x]
- ~~index.ts 运行时 neutral=0.6，OutcomeEvaluator test fixture neutral=0.5~~ 已对齐
- OutcomeEvaluator.feedbackScore 的 neutral 从 0.5 改为 0.6 ✓

### O8 UserMessage content 可能是 ContentPart[] [P1] [x]
- ~~String() 对数组调用产生 "[object Object]"，导致任务模式推断和搜索失效~~ 已修复
- 检测 raw 是否为数组，提取 text 类型 part 的文本 ✓

---

## 域 P — 第八轮代码审查修复（2026-08-26）

> 焦点：性能节流、状态判定准确性、去重精确性、资源清理、LLM 容错。

### P1 applyTTL 每次 store() 全表操作性能问题 [P2] [x]
- ~~enforceRetention 中 activeForget + applyTTL 每次 store 都执行全表 UPDATE/DELETE~~ 已修复
- activeForget 保留每次执行（有索引，快），applyTTL 节流为每 10 次 store 执行一次 ✓

### P2 goal paused 状态被误判为 stalled [P2] [x]
- ~~goal.phase='paused' 被归类为 stalled，但用户可能是主动暂停而非任务停滞~~ 已修复
- 改为 'none'（中立），不影响评分 ✓

### P3 appendPreference 子串误匹配 [P2] [x]
- ~~使用 includes 子串匹配，"use TS" 会匹配 "don't use TS" 被误去重~~ 已修复
- 改为按行精确去重（split + 逐行比较）✓

### P4 distillPreferencesWithLLM lesson JSON fallback 到原始字符串 [P3] [x]
- ~~JSON 合法但无 reusable_lesson 字段时 fallback 到原始 JSON 字符串，LLM 收到无意义数据~~ 已修复
- 无 reusable_lesson 时返回 null 被 filter 过滤，非 JSON 旧数据按纯文本处理 ✓

### P5 MetaCognitionEngine.queue 无上限 [P2] [x]
- ~~queue 数组无容量限制，processQueue 长时间不触发时无限增长~~ 已修复
- 新增 MAX_QUEUE_SIZE = 100，满时丢弃最旧条目 ✓

### P6 clear() 不清理 FTS 表 [P3] [x]
- ~~DELETE FROM experiences 后 FTS 表残留旧索引数据~~ 已修复
- clear() 中加入 FTS5 rebuild ✓

### P7 mergeLessons 记录 source 无法区分 [P3] [x]
- ~~mergeLessons INSERT 的 source 用默认 'model-inferred'，无法区分合并记录~~ 已修复
- 改为 'merged'，SOURCE_WEIGHTS 加入对应权重 ✓

### P8 GUI export/import 同时请求互相覆盖 [P3] [x]
- ~~export 和 import 是两个独立 if，同时到达时 update 可能互相覆盖~~ 已修复
- 改为 else-if，互斥处理 ✓

### P9 tryLLMComplete 吞掉部分结果不返回 [P2] [x]
- ~~catch 块返回 null，已收集的 chunks 被丢弃，超时或网络错误时丢失部分结果~~ 已修复
- chunks 声明提到 try 外，catch 块返回已收集的部分结果 ✓

---

## 域 Q — 第九轮代码审查修复（2026-08-26）

> 焦点：turn-stopping 中消息格式兼容性、computeContentHash filter 逻辑错误。

### Q1 turn-stopping 中 taskPattern 提取不处理 ContentPart 数组 [P1] [x]
- ~~firstUserMsg?.data?.content 可能是 ContentPart[]，但只做 String() 不处理数组~~ 已修复
- 与 O8 同样的修复逻辑：检测数组类型，提取 text part ✓

### Q2 computeContentHash filter 永远为 true [P1] [x]
- ~~filter 条件 `t.name !== 'unknown' || true` 永远返回 true，无效工具名未被过滤~~ 已修复
- 改为 `t.name.length > 0`，空名被过滤 ✓

---

## 域 R — 第十轮代码审查修复（2026-08-26）

> 焦点：运行时路径与 test fixture 路径的逻辑分歧、SQLite 事务原子性。

### R1 pre-step worst 非最低分记录 [P1] [x]
- ~~worst 取自 sorted 末尾（按 difficulty + score 排序），而非纯 outcomeScore 最低的记录~~ 已修复
- 改为独立按 outcomeScore 升序取最低分记录作为 worst ✓

### R2 无 lesson 记录的 budget 消耗方式不一致 [P2] [x]
- ~~index.ts 中无 lesson 记录消耗 50 字符 budget，BehaviorAdapter 中不消耗~~ 已对齐
- 改为无 lesson 记录不消耗 budget，无条件加入 ✓

### R3 budget 耗尽时仍执行 incrementReuse [P1] [x]
- ~~budgeted 为空时 selected 保留原始值，incrementReuse 对未注入记录执行~~ 已修复
- budgeted 为空时 selected 清空，跳过注入和 incrementReuse ✓

### R4 mergeLessons 多步写操作无事务保护 [P2] [x]
- ~~INSERT 合并记录 + markMerged 循环无事务，异常时产生重复记录~~ 已修复
- 用 db.transaction() 包裹 INSERT + markMerged ✓

### R5 enforceRetention 多步 GC 无事务保护 [P2] [x]
- ~~promoteYoungGen + DELETE + major GC 多步操作无事务，异常时 GC 状态不一致~~ 已修复
- 用 db.transaction() 包裹全部 GC 操作 ✓

---

## 域 S — 第十一轮代码审查（2026-08-26）

> 焦点：SQL 冗余排序、todo 过时注释、已知未实现项盘点。

### S1 detectFactConflicts 冗余 SQL 排序 [P3] [x]
- ~~`detectFactConflicts` 先 `ORDER BY confidence DESC, updated_at DESC` 查询，随后 JS 又按 `SOURCE_WEIGHTS` 重新排序，SQL 排序是死排序~~ 已修复
- 去掉 SQL 层的 `ORDER BY confidence DESC, updated_at DESC`，排序统一由 JS 端 `SOURCE_WEIGHTS` + confidence 负责
- 注释"第一个 item 有最高 source weight"与 SQL 排序不符的误导已消除 ✓

### S2 todo 中 A6 过时注释 [P3] [x]
- ~~A6 的"注"仍写"质量高缩小范围——未实现（仅按数量分档）"，但 M5 已实现 avgScore 动态伸缩~~ 已更新
- A6 注释改为"质量动态伸缩已实现（M5）"，代码位置更新为 `experience-store.ts:354-368` ✓

### S3 已知未实现项盘点（已由域 T 全部推进）[x]
- **B2 主题归一化**：→ 域 T1 已实现（谓词别名归并 + subject 规范化）
- **Phase 6 自适应策略调整**：→ 域 T3 已落地两项（`agent/request` 模型选择 + `tools/pre-execute` 工具拦截）；`repeat-tool-reminder` 守卫阈值属外部插件自身配置，不在本插件职责
- **I7 双轨技术债**：→ 域 T2 已消除核心分歧（评分公式抽为唯一真相源）；MetaCognitionEngine rule-based 拷贝保留为低风险 fixture（已记录取舍）

---

## 域 T — 第十二轮：遗留项推进（2026-08-26）

> 焦点：推进 S3 盘点的三项遗留项。

### T1 B2 主题归一化 [P1] [x]
- ~~同一事实的多种表述（谓词别名、大小写、分隔符变体）不会归并，冲突漏报~~ 已实现
- 新增 `normalizePredicate()` / `normalizeSubject()` 纯函数（`experience-store.ts`，模块级导出）
  - 谓词：trim + 小写 + 分隔符（`_`/空白）折叠为 `-` + 高频别名表归并（`deploy`→`deploy-command`、`task-pattern`→`task-type` 等）
  - subject：trim + 空白折叠 + `workspace:`/`project:` 前缀小写规范化
- `upsertFact()` 写入入口应用规范化，变体谓词归并到同一事实 ✓
- `detectFactConflicts()` 改为读全量后按规范化 (subject, predicate) 分组，历史未规范化数据也能归并出跨拼写冲突 ✓
- 新增 4 个测试：`normalizePredicate`/`normalizeSubject`/`upsertFact 归并`/`detectFactConflicts 跨拼写冲突`（advanced-features 22→26）✓

### T2 I7 评分公式双轨消除 [P1] [x]
- ~~评分公式在 index.ts（运行时）与 OutcomeEvaluator（fixture）各写一份，历史 O7 出现分歧~~ 已消除
- 新增 `computeOutcomeScore()` 唯一真相源（`types/index.ts`），封装完整评分公式 + `goalProgressScore()`/`feedbackScore()` 映射
- `index.ts` 运行时和 `OutcomeEvaluator.evaluate` 都改为调用 `computeOutcomeScore()` ✓
- 删除 `OutcomeEvaluator` 内联的 `computeScore`/`goalProgressScore`/`feedbackScore` 三个私有方法 ✓
- 注：`MetaCognitionEngine.ruleBasedReflect` 与 `reflection.ts.generateStructuredReflection` 仍是功能等价的两份拷贝，但二者都是纯 test fixture 内部逻辑、运行时互不影响，分歧风险低，本轮不强行重构（避免破坏 11+11 个测试契约）

### T3 Phase 6 自适应策略 — 已落地两项（基于 dsh 源码查证）[x]
- **查证**（`../deepseek-harness` 源码）：
  - `agent/request`（`packages/core/agent/src/runtime-types.ts:244`）：waterfall，`next()` 返回 `LlmCallConfig`（`{provider, model, reasoningEffort?, temperature?, maxTokens?, stop?}`），返回替换 config 即可切换模型
  - `tools/restrict` **不存在**；真实工具拦截是 `tools/pre-execute`（`packages/core/tools/src/index.ts:152`），`next()` 返回 `PreToolDecision`（`{kind:'allow'}`/`{kind:'deny';reason}`/`{kind:'ask';reason?}`）
  - `repeat-tool-reminder`（`packages/guard/repeat-tool-reminder`）是独立 guard 插件，`thresholds:[3,5,8]` 配置属其自身，本插件不接管
- **T3-a 模型选择**（`agent/request`）已实现：
  - 新增 `selectModel()` 纯函数（`src/adaptive-strategy.ts`）+ `taskPatternStats()`（`experience-store.ts`，SQL 直接统计、不做 E2 去重）
  - 按 taskPattern 历史平均分推荐 strong/standard 模型，接入 `agent/request` 事件
- **T3-b 工具限制**（`tools/pre-execute`）已实现：
  - 新增 `guardTool()` 纯函数 + `failedToolCounts()`（统计失败经验中每个工具名出现次数）
  - 工具在 ≥ `failedToolDenyThreshold` 个失败经验中出现则 deny，接入 `tools/pre-execute` 事件
- 新增 5 个配置项（均 opt-in，默认关闭，行为不变）：`adaptiveModelEnabled`/`strongModel`/`standardModel`/`adaptiveToolGuardEnabled`/`failedToolDenyThreshold`
- 新增 11 个测试（`test/adaptive-strategy.test.ts`），测试总数 85→96 ✓

### T4 I4 原子事实 failed-tool-sequence 覆盖 bug [P1] [x]
- ~~I4 写入 `upsertFact(subject, 'failed-tool-sequence', ...)` 同一 workspace 下不同工具序列互相覆盖~~ 已修复
- 新增 `upsertToolSequenceFact()`（`experience-store.ts`）：工具序列哈希编码进 predicate 后缀，每个不同序列成为独立事实，相同序列仍去重
- index.ts I4 改用 `upsertToolSequenceFact()`；`task-type` 保持 `upsertFact`（单值语义正确）✓
- J4 注入改用 `startsWith('failed-tool-sequence')`/`startsWith('effective-tool-sequence')` 前缀匹配 ✓
- 不同序列不再被 `detectFactConflicts` 误判为冲突（predicate 后缀不同）✓
- 新增 4 个测试（advanced-features 26→30，总测试 96→100）✓

---

## 域 U — 真机联调发现与修复（2026-08-26）

> 焦点：dsh 真实环境（`dsh --profile web`）跑任务后，从 experiences.db 反查发现的事件结构不匹配 bug。

### U1 user/message 事件结构不匹配（task_pattern 恒 null）[P0] [x]
- **现象**：真机跑任务后，experiences.db 里 `task_pattern` 全部为 null（`inferTaskPattern` 从未生效），lesson 也为 null
- **根因**：代码假设 dsh 的 `user/message` 会话事件 `data` 带 `turn` 和 `text` 字段，但真实结构是 `data: UserMessage = { id, role, content: ContentBlock[], source }`——**无 turn，无 text**（turn 只存在于 `turn/start`/`turn/end`/`step/start`/`step/end` 事件）
- **受影响**：
  - taskPattern 提取（turn-stopping）：`events.find(e => e.type === 'user/message' && e.data?.turn === turn)` 永远 undefined
  - 隐式负反馈"同 turn 纠正" + "用户重述任务"检测：`e.data?.turn === turn` 永远空
  - Phase 6 模型选择 taskPattern 提取
- **修复**：新增 `extractMessageText()` / `findUserMessageText()` / `countUserMessagesInTurn()` 三个辅助函数（index.ts 导出），按 `turn/start` 边界定位用户消息，从 `content: ContentBlock[]` 提取文本，跳过 `source.kind === 'plugin'` 的合成上下文 ✓
- 新增 9 个测试（`test/event-parsing.test.ts`），总测试 100→109 ✓
- **验证**：真机 experiences.db 中最新记录 `tools_used=["edit","edit"]`、atomic_facts predicate 带哈希后缀 `effective-tool-sequence:01f26d39c7e0`（T4 修复生效）、source=model-inferred 均正确

### U2 lesson=null 说明 [ ]
- 真机最新记录 `lesson=null` 属**预期行为**：lesson 生成依赖 `run-maintenance`（空闲时触发），非 turn-stopping 同步生成；需再跑一个任务或等待 maintenance 触发才会落 lesson（非 bug）

---

## 域 W — 真机深挖：lesson 从未生成的根因（2026-08-26）

> 焦点：用户质疑"工具序列注入没实质作用"，深挖发现 LLM 反思链路整体断裂。

### W1 agent/run-maintenance 事件不存在（lesson 生成从未执行）[P0] [x]
- **发现**：本插件监听 `ctx.on('agent/run-maintenance', ...)`，但 dsh 里**根本没有这个事件**（全仓搜索只在 dsh 内置 self-improving 自身出现该字符串）。dsh 只有 `Agent.runMaintenance(task)` 实例方法，非 Cordis 事件
- **后果**：Layer 4（lesson 生成 + lesson 合并 + LLM 偏好提炼）**从未执行**，lesson 恒 null，插件退化成"记录工具名序列"的简单数据库
- **修复**：把 run-maintenance 逻辑抽成 `runMaintenance(agent)` 普通函数，在 `agent/turn-stopping`（有 agent 上下文）里 fire-and-forget 调用，替代不存在的事件 ✓

### W2 tryLLMComplete 调 LLM 参数错误 [P0] [x]
- **发现**：`llm.stream({ messages: [{ role:'user', content: prompt }], signal })` 缺必填 `provider`/`model`（dsh `GenerateOptions` 必填，注释明说 "provider selects the adapter"），且 `content` 传 string 而非 `ContentBlock[]`
- **后果**：即使 lesson 生成被触发，LLM 反思也必然失败，永远 fallback 到 rule-based 模板（"工具序列 [x → y] 高效完成"这种无语义套话）
- **修复**：
  - `tryLLMComplete` 增加 `model` 参数，`content` 改为 `[{ type:'text', text: prompt }]`
  - `llmMergeLessons`/`distillPreferencesWithLLM` 透传 model
  - provider/model 三级 fallback：`agent.options` → `session.requestHeader()` → undefined（rule-based）
  - `dsh-env.d.ts` 的 `Agent.options` 补 `provider`/`model`/`maxTokens`

### W3 真机诊断：LLM 调用链第三层 bug（message 缺 source 字段）[P0] [x]
- **诊断日志确认**：`runMaintenance — llmModel=qwen/qwen3.7-flash llmService=present`，说明 provider/model 和 llm 服务都拿到了，但 `tryLLMComplete` 仍返回 null → fallback rule-based
- **根因**：手写 `{ role:'user', content:[...] }` 消息缺 dsh `Message` 必填的 `source`（和 `id`）字段，`llm.stream()` 内部 adapter 抛异常
- **参照**：dsh 官方一次性 LLM 调用（`session-title-llm`）用 `createUserMessage({ content, source })` 工厂构造消息
- **修复**：`tryLLMComplete` 改用动态 `await import('@deepseek-ai/dsh-llm')` + `createUserMessage`（补 source: `{kind:'plugin', plugin:'self-improving'}`）；catch 加诊断日志打印真实错误
- 动态 import 保持 @deepseek-ai/dsh-llm 为 optional peer（独立测试环境不崩）✓

### W4 LLM 调用链第四层 bug：@deepseek-ai/dsh-llm 无法从外部插件解析 [P0] [x]
- **真机错误**：`tryLLMComplete error: Cannot find package '@deepseek-ai/dsh-llm' imported from dist/llm-bridge.js`
- **根因**：`@deepseek-ai/dsh-llm` 是 dsh CLI 的嵌套依赖（`dsh/node_modules/@deepseek-ai/dsh-llm`），外部 link 插件从 `dist/` 向上解析 node_modules 找不到它。dsh 内置插件能 import 是因为它们安装在 dsh 的 node_modules 里共享解析链
- **修复**：不再 import `@deepseek-ai/dsh-llm`，改为手动构造最小合法 dsh `Message`（`id: randomUUID()` + `role:'user'` + `content: ContentBlock[]` + `source`）。`MessageId` 运行时就是普通 string（`return id as MessageId`，无校验），`createUserMessage` 只做 `role='user'` + `id=randomUUID()`，可等价复刻 ✓
- 保留 catch 诊断日志打印真实错误

### W5 待验证：真机 LLM lesson 是否最终生成 [ ]
- 修复 W4 后需重启 dsh 再验证：lesson 应变为 LLM 生成的带语义内容
- 若仍 fallback，看 `tryLLMComplete error: ...` 定位下一层

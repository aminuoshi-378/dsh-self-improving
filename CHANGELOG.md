# 变更日志

`dsh-self-improving` 的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，本仓库遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### 修复 — Windows `~` 路径展开失效 [P0]（2026-08-26）
- `~/.dsh/experiences.db` 的 `~` 用 `process.env.HOME` 展开，但 Windows 下 `HOME` 为 `undefined`，路径变成 `undefined/.dsh/experiences.db`，`ExperienceStore` 初始化即抛 `directory does not exist`，插件整体无法加载
- `experience-store.ts` / `preference-extractor.ts` 改为 `process.env.HOME || homedir()`（`node:os`）跨平台取主目录
- 附带解锁：真机 W5 lesson 验证依赖此修复才能建库、写经验

### 修复 — W3-W5 真机 LLM lesson 生成链路打通并验证 [P0]（2026-08-26）

#### W3 — 手写 Message 缺 source 字段，LLM 反思必失败
- `tryLLMComplete` 手写 `{ role:'user', content:[...] }` 缺 dsh `Message` 必填的 `source`/`id`，`llm.stream()` 内部 adapter 抛异常，永远 fallback rule-based
- 改用 `createUserMessage` 工厂（动态 import `@deepseek-ai/dsh-llm`）构造消息

#### W4 — `@deepseek-ai/dsh-llm` 无法从外部 link 插件解析
- 该包是 dsh CLI 的嵌套依赖，外部 link 插件从 `dist/` 向上解析 node_modules 找不到它，报 `Cannot find package '@deepseek-ai/dsh-llm'`
- 改为手动构造最小合法 dsh `Message`（`id: randomUUID()` + `role:'user'` + `content: ContentBlock[]` + `source`），等价复刻 `createUserMessage`

#### W5 — 真机验证通过：LLM lesson 生成并落库
- **日志层**：`tryLLMComplete stream: sawChunk=true ... textLen=726 finish={kind:"stop"}` → LLM 流式成功；`lesson generated (LLM) — "For multi-step tool chains, confirm success by verifying the final output meets the core goal, ..."` → 生成带语义 lesson
- **数据库层**：直查 `~/.dsh/experiences.db`，`total = 2, with_lesson = 2`，两条经验均带结构化反思 JSON，E2 去重正常
- lesson 从 rule-based 套话升级为 LLM 生成的、可被后续注入复用的语义反思

### 新增 — GUI 插件独立 pnpm workspace（2026-08-26）
- `gui/` 被根 workspace（`packages: []`）绑定，pnpm 依赖解析强行拉取不可用的 `@deepseek-ai/*` 内部包导致构建失败
- 新增 `gui/pnpm-workspace.yaml`（`packages: ['.']`），`gui/` 成为独立 workspace，仅装自身 devDeps（react/tsdown/typescript），构建产物 `lib/index.mjs` + `lib/client.js`

### 修复 — W1-W2 lesson 生成链路断裂 [P0]（2026-08-26）

#### W1 — agent/run-maintenance 事件不存在，lesson 从未生成
- 本插件监听 `ctx.on('agent/run-maintenance')`，但 dsh 无此事件（只有 `Agent.runMaintenance()` 方法），导致 Layer 4（lesson 生成/合并/偏好提炼）从未执行
- 改为普通函数 `runMaintenance(agent)`，在 `agent/turn-stopping` 里 fire-and-forget 触发

#### W2 — tryLLMComplete 调 LLM 参数错误，LLM 反思必然失败
- `llm.stream()` 缺必填 `provider`/`model`，且 `content` 传 string 而非 `ContentBlock[]`
- 修复：`tryLLMComplete` 增加 model 参数、content 改为 ContentBlock[]；provider/model 三级 fallback（agent.options → requestHeader → undefined）

### 修复 — U1 真机联调：user/message 事件结构不匹配 [P0]（2026-08-26）

#### U1 — task_pattern 恒 null 的根因修复
- 真机跑任务后 `task_pattern` 全部为 null，根因：代码假设 dsh `user/message` 会话事件 `data` 带 `turn`/`text` 字段，但真实 `UserMessage = { id, role, content: ContentBlock[], source }` 无 turn 无 text
- 新增 `extractMessageText()` / `findUserMessageText()` / `countUserMessagesInTurn()` 辅助函数，按 `turn/start` 边界定位用户消息、从 ContentBlock[] 提取文本、跳过 plugin 合成上下文
- 修复 taskPattern 提取 + 隐式负反馈检测 + Phase 6 模型选择三处
- 新增 9 个测试（`test/event-parsing.test.ts`），总测试 100→109

### 推进 — T1-T3 第十二轮：遗留项推进（2026-08-26）

#### T1 — B2 主题归一化 [P1]
- 新增 `normalizePredicate()` / `normalizeSubject()` 纯函数：谓词别名归并（`deploy`→`deploy-command`、`task-pattern`→`task-type` 等）+ 分隔符折叠 + subject 前缀规范化
- `upsertFact()` 写入入口应用规范化，变体谓词归并到同一事实
- `detectFactConflicts()` 改为按规范化 (subject, predicate) 分组，跨拼写冲突可被检测
- 新增 4 个测试（advanced-features 22→26）

#### T2 — I7 评分公式双轨消除 [P1]
- 新增 `computeOutcomeScore()` 唯一真相源（`types/index.ts`），封装完整评分公式
- `index.ts` 运行时与 `OutcomeEvaluator` 都改为调用共享函数，删除 evaluator 内联的三个私有评分方法

#### T3 — Phase 6 自适应策略（模型选择 + 工具限制）[P1]
- 查证 `../deepseek-harness` 源码确认真实契约：`agent/request`（waterfall，`LlmCallConfig`）、`tools/pre-execute`（waterfall，`PreToolDecision`）
- 新增 `selectModel()` 纯函数 + `taskPatternStats()`，按 taskPattern 历史平均分推荐模型，接入 `agent/request`
- 新增 `guardTool()` 纯函数 + `failedToolCounts()`，工具在多个失败经验中出现则 deny，接入 `tools/pre-execute`
- 新增 5 个 opt-in 配置项（默认关闭），新增 11 个测试（85→96）

#### T4 — 修复 I4 原子事实 failed-tool-sequence 覆盖 bug [P1]
- I4 写入 `upsertFact(subject, 'failed-tool-sequence', ...)` 同一 workspace 下不同工具序列互相覆盖，只保留最后一条
- 新增 `upsertToolSequenceFact()`：序列哈希编码进 predicate 后缀，每个序列独立、相同序列去重
- J4 注入改用 `startsWith` 前缀匹配；`task-type` 保持单值 upsertFact
- 新增 4 个测试（advanced-features 26→30，总测试 96→100）

### 修复 — S1-S3 第十一轮代码审查修复（2026-08-26）

#### S1 — detectFactConflicts 冗余 SQL 排序 [P3]
- `detectFactConflicts` 先 `ORDER BY confidence DESC, updated_at DESC` 查询，随后 JS 又按 `SOURCE_WEIGHTS` 重新排序，SQL 排序是死排序
- 去掉 SQL 层 ORDER BY，排序统一由 JS 端 `SOURCE_WEIGHTS` + confidence 负责

#### S2 — todo 中 A6 过时注释 [P3]
- A6 的"注"仍写"质量高缩小范围——未实现"，但 M5 已实现 avgScore 动态伸缩
- 更新 A6 注释为"质量动态伸缩已实现（M5）"，代码位置更新为 `experience-store.ts:354-368`

#### S3 — 已知未实现项盘点 [ ]
- B2 主题归一化（subject+predicate 精确匹配，同一事实多种表述不归并）
- Phase 6 自适应策略调整（模型选择 / 工具推荐 / 守卫阈值自适应）
- I7 双轨技术债（test fixture 与运行时逻辑需人工同步）

### 修复 — R1-R5 第十轮代码审查修复（2026-08-26）

#### R1 — pre-step worst 非最低分记录 [P1]
- `worst` 取自 sorted 末尾（difficulty + score 排序），而非纯 outcomeScore 最低
- 改为独立按 outcomeScore 升序取最低分记录

#### R2 — 无 lesson 记录 budget 消耗不一致 [P2]
- `index.ts` 中无 lesson 记录消耗 50 字符 budget，`BehaviorAdapter` 中不消耗
- 对齐为不消耗 budget

#### R3 — budget 耗尽时误调 incrementReuse [P1]
- `budgeted` 为空时 `selected` 保留原始值，`incrementReuse` 对未注入记录执行
- budgeted 为空时清空 selected，跳过注入

#### R4 — mergeLessons 无事务保护 [P2]
- INSERT + markMerged 无事务，异常时产生重复记录
- 用 `db.transaction()` 包裹

#### R5 — enforceRetention 无事务保护 [P2]
- promote + delete 多步操作无事务，异常时 GC 状态不一致
- 用 `db.transaction()` 包裹

### 修复 — Q1-Q2 第九轮代码审查修复（2026-08-26）

#### Q1 — turn-stopping 中 taskPattern 提取不处理 ContentPart 数组 [P1]
- `firstUserMsg?.data?.content` 可能是 ContentPart[]，只做 `String()` 不处理数组
- 与 O8 同样的修复逻辑：检测数组类型，提取 text part

#### Q2 — computeContentHash filter 永远为 true [P1]
- `filter((t) => t.name !== 'unknown' || true)` 永远返回 true，无效工具名未被过滤
- 改为 `t.name.length > 0`，空名被过滤

### 修复 — P1-P9 第八轮代码审查修复（2026-08-26）

#### P1 — applyTTL 每次 store() 全表操作 [P2]
- `enforceRetention` 中 `applyTTL` 每次 store 都执行全表 UPDATE，节流为每 10 次 store 执行一次

#### P2 — goal paused 被误判为 stalled [P2]
- `goal.phase='paused'` 被归类为 `stalled`，改为 `none`（中立，不影响评分）

#### P3 — appendPreference 子串误匹配 [P2]
- 使用 `includes` 子串匹配导致语义相反偏好被误去重，改为按行精确去重

#### P4 — distillPreferencesWithLLM lesson JSON fallback [P3]
- JSON 合法但无 `reusable_lesson` 字段时 fallback 到原始 JSON 字符串，改为返回 null 被过滤

#### P5 — MetaCognitionEngine.queue 无上限 [P2]
- `queue` 数组无容量限制，新增 `MAX_QUEUE_SIZE = 100`

#### P6 — clear() 不清理 FTS 表 [P3]
- `DELETE FROM experiences` 后 FTS 表残留旧索引，加入 FTS5 rebuild

#### P7 — mergeLessons source 无法区分 [P3]
- `source` 用默认 'model-inferred'，改为 'merged'，`SOURCE_WEIGHTS` 加入对应权重

#### P8 — GUI export/import 互相覆盖 [P3]
- export 和 import 是两个独立 `if`，改为 `else-if` 互斥处理

#### P9 — tryLLMComplete 丢弃部分结果 [P2]
- catch 块返回 null 丢失已收集的 chunks，改为返回部分结果

### 修复 — O1-O8 第七轮代码审查修复（2026-08-26）

#### O1 — rowToRecord JSON.parse 无异常保护 [P1]
- `row.tools_used` 和 `row.tags` 的 `JSON.parse` 无 try-catch，单条损坏记录导致全部查询崩溃
- 改为 try-catch + fallback null

#### O2 — pre-step catch 块重复调用 next() [P1]
- `next()` 在 try 块中调用后，catch 块又调用 `next()`，违反 Cordis waterfall 契约
- `next()` 调用移到 try 块前，catch 块直接返回 decision

#### O3 — computeContentHash 格式不兼容 [P1]
- `computeContentHash` 不处理 `{tool,ok}` 格式，生成 `undefined:undefined` 的无意义 hash
- 加入 normalizeToolEntry 逻辑统一两种格式

#### O4 — FTS5 搜索路径忽略 taskPattern [P2]
- FTS5 查询没有加 `taskPattern` 条件，同时传 `searchText` 和 `taskPattern` 时后者被忽略
- FTS5 SQL 加入 `taskPattern` 过滤

#### O5 — stats() 包含 merged 记录 [P2]
- `avgScore` 包含 merged 记录的固定高分 0.85，系统性拉高平均分
- `avgScore` 改为只计算 `merged=0` 的记录

#### O6 — mergeLessons INSERT 缺 source/content_hash [P2]
- INSERT 语句缺少 `source` 和 `content_hash` 列
- 加入 `source` 列和 `content_hash` 列（`merge-${contextHash}` 避免重复去重）

#### O7 — neutral feedback 评分不一致 [P2]
- `index.ts` 运行时 neutral=0.6，`OutcomeEvaluator` test fixture neutral=0.5
- 对齐为 0.6

#### O8 — UserMessage content 数组处理 [P1]
- `String()` 对 ContentPart[] 调用产生无意义文本，导致任务模式推断和搜索失效
- 检测数组类型，提取 text part 的文本

### 修复 — N1-N5 第六轮代码审查修复（2026-08-26）

#### N1 — MetaCognitionEngine.parseActions 工具格式不兼容 [P0]
- `parseActions` 只解析 `{tool, ok}` 格式，运行时写入的 `{name, success}` 格式导致工具名丢失
- 加入 `normalizeToolEntry` 逻辑统一两种格式

#### N2 — incrementReuse 衰减覆盖 boostConfidence [P1]
- `incrementReuse` 用绝对公式重置 confidence，`boostConfidence` 的 +0.2 累积被覆盖
- 改为相对衰减 `confidence * 0.9`，boost 效果不再被重置

#### N3 — J4 原子事实注入无数量限制 [P2]
- `queryFacts()` 无参数返回所有事实，多工作区时淹没 system prompt
- 限制注入为 top 3 effective + top 3 failed

#### N4 — distillPreferencesWithLLM 循环内重复读文件 [P3]
- 每次迭代调用 `readPreferences()` 检查去重，改为循环前读一次

### 修复 — M1-M7 第五轮代码审查修复（2026-08-26）

#### M1 — computeDynamicLimit 死代码 [P3]
- `behavior-adapter.ts` 中 `computeDynamicLimit()` 三个分支都返回 10，改为基于 avgScore 动态调整（质量高缩小候选池，质量低扩大）

#### M2 — boostSimilarExperiences 无相似性过滤 [P2]
- `MetaCognitionEngine.boostSimilarExperiences()` 查询时只传 `minScore`，未传 `toolsUsed`，改为传入工具序列做真正相似匹配

#### M3 — pendingReflections 队列无上限 [P1]
- `index.ts` 中 `pendingReflections` 数组无上限，新增 `MAX_PENDING_REFLECTIONS = 100`，满时丢弃最旧条目

#### M4 — D3 用户重述任务检测 [P1]
- 隐式负反馈检测新增词重叠相似度比较：当前 turn 用户消息与上一 turn 首条消息比较，词重叠 > 0.7 判为重述 → negative

#### M5 — A6 召回范围按经验库质量动态伸缩 [P4]
- `experience-store.ts` query 中 `coarseLimit` 新增 avgScore 因素：质量高时缩小候选池，质量低时扩大

#### M6 — E3 token 预算控制 [P3]
- `index.ts` 注入处新增 `MAX_INJECT_CHARS = 8000` 字符预算，逐条检查 lessonText 长度，超预算截断

#### M7 — CHANGELOG Node 引擎版本修正 [P2]
- CHANGELOG [0.1.0] 中 Node 引擎版本从 `>=20.0.0` 修正为 `>=22.0.0`

### 修复 — L1-L4 第四轮架构修复（2026-08-26）

#### L1 — tsc 编译失败，dist/ 过期 [P0]
- 修 `stats.positive`/`stats.negative` → `stats.positiveCount`/`stats.negativeCount`（5 处）
- 修 `rowToRecord()` 缺少 `source` 字段
- 修 `wsDigest` 的 `null` → `undefined`（类型不兼容）
- 删除未使用的 `ExperienceRecord` import（2 处）
- 新增 `src/dsh-env.d.ts` ambient 声明文件，让 `tsc` 在 `@deepseek-ai/*` 包不在 node_modules 时也能编译
- `pnpm run build` 重新通过，dist/ 包含全部 7 个模块

#### L2 — 文档测试数过时 [P2]
- README.md / README.zh-CN.md 测试数从 44 更新为 81，补充各测试文件的单独运行命令
- CHANGELOG、docs/test-plan.md、docs/design.md 中的 44 引用同步更新

#### L3 — CHANGELOG 引用不存在的文档 [P2]
- 删除 `docs/plugin-dev-notes.md` 引用（文件不存在），替换为 `docs/design.md`

#### L4 — pnpm 命令被 deps status check 阻断 [P1]
- `pnpm-workspace.yaml` 加 `verifyDepsBeforeRun: false`，跳过 `@deepseek-ai/*` 内部包的自动检查

### 新增 — P0-P4 缺陷修复

#### P0 — 核心体验缺陷修复
- **每 turn 只注入一次经验**：`agent/pre-step` 改为仅在 turn 的第一个 step 注入，后续 step 跳过，避免同一段经验在 turn 内重复注入
- **经验去重**：query 结果按 `context_hash` 去重，相同工具序列只保留最新一条
- **加入工具调用步数效率维度**：评分公式新增 `stepEfficiency` 维度（`max(0, 1 - (stepCount - 1) * 0.05)`），权重重新分配为 goalProgress 0.3 + toolSuccess 0.2 + stepEfficiency 0.25 + guardPenalty 0.15 + userFeedback 0.1
- **区分任务难度**：新增 `difficulty` 字段（low/medium/high），存储和注入时高难度经验优先，简单任务经验只在不足时填充

#### P1 — 评分准确性修复
- **隐式负反馈信号**：不再依赖用户主动点赞/踩，改为被动观测——用户中断 agent（turn/end reason=aborted）、同 turn 内用户追问/纠正 → `negative`；无负信号 → `neutral`（0.6，不等于 positive）
- **接入 goal 服务**：优先用 `ctx.get('goals').get(agent)` 获取真实 goal phase
- **评分区分度提升**：步数维度加入后，分数范围从 0.9 扩展到 0.275-0.9875

#### P2 — lesson 质量提升
- **结构化 lesson 生成**：rule-based 反思生成完整 `{whatWorked, whatFailed, whatToTryDifferently, reusableLesson}` JSON，而非纯文本
- **可操作性增强**：lesson 包含具体场景信息（步数、难度、失败工具），LLM prompt 要求分析具体 actions JSON 内容
- **同步触发 lesson 生成**：turn-stopping 中同步入队反思，maintenance 时处理
- **定期合并 lesson**：每积累 20 条 lesson 后按 difficulty + 工具序列聚类合并，被合并的旧 lesson 标记 `merged: true`，合并产物直接进老年代

#### P3 — 健壮性提升
- **注入内容动态控制**：按难度分配注入条数（high 最多 5 条、medium 2 条、low 不足时填充），token 预算控制（总长度 ≤ 8000 字符）
- **分代经验管理**：借鉴 JVM 分代 GC，新生代（200 条）+ 老年代（800 条）双区域管理，新增 `generation`、`last_injected_at`、`merged` 字段

#### P4 — 召回策略优化
- **两阶段召回**：粗筛（SQL filter + context_hash 精确匹配）+ 精筛（outcome_score × 0.4 + 工具相似度 × 0.3 + 时间近度 × 0.3）
- **筛选范围动态伸缩**：< 50 条全量参与、50-200 条粗筛 top 20、> 200 条粗筛 top 50
- **结构化信息落库**：lesson 字段存储完整 Reflection JSON，注入时提取 `reusableLesson` 字段，兼容旧数据纯文本

#### 测试新增
- experience-store: 3 个新测试（去重、难度优先排序、两阶段召回）
- outcome-evaluator: 2 个新测试（步数效率区分、难度分类）
- behavior-adapter: 3 个新测试（难度优先注入、动态注入适配、结构化 lesson 提取）
- meta-cognition: 3 个新测试（JSON lesson 存储、lesson 合并、prompt 包含步数和难度）
- 总计从 29 个测试增加到 40 个，全部通过

#### 测试新增（advanced-features + memory-benchmark）
- advanced-features: 22 个新测试（A1 偏好提取/注入、A3 原子事实/FTS5、A4 分代 GC、B2 冲突裁决）
- memory-benchmark: 15 个新测试（跨会话召回、选择性遗忘、难度优先、多步联动）
- meta-cognition: 3 个新测试（LLM lesson 生成、LLM 合并 lesson、prompt 数据校验）
- behavior-adapter: 3 个新测试（动态注入适配、结构化 lesson 提取、LLM fallback）
- 总计从 40 个测试增加到 81 个，全部通过

### 新增 — P5 可选增强

#### P5-1 — 按任务类型分类经验
- **`inferTaskPattern()` 函数**：从用户首条消息关键词推断任务类型（bugfix/feature/refactoring/search/test-writing/general）
- **存储环节**：turn-stopping 中自动推断 task_pattern 并存入经验库（之前一直存 NULL）
- **注入环节**：agent/pre-step 中按当前任务的 task_pattern 优先匹配同类经验
- **查询**：支持 `exportByTaskPattern()` 按任务类型导出经验

#### P5-2 — WebUI 可视化经验库
- **`dsh-self-improving-gui` 插件包**（`gui/` 目录）
  - WebUI Settings → Plugins → Experiences 页面
  - 展示经验库统计：总数、平均分、含 lesson 数、正/负反馈数、高难度数、新生代/老年代数、合并数
  - 通过 `ctx.settingsScope.bind` 读写（与 dsh-self-improving host 插件桥接）
  - React 组件：`ExperiencesPanel.tsx`，统计表格 + 导入/导出按钮

#### P5-3 — 前端导入/导出经验
- **导出**：点击"Export"按钮，后端全量导出为 JSON 文件，浏览器下载
  - 格式：`[{id, outcomeScore, toolsUsed, lesson, difficulty, taskPattern, generation, merged, ...}, ...]`
  - 文件名：`experiences-export-{date}.json`
- **导入**：点击"Import"选择 JSON 文件，预检显示条数，确认后写入
  - 按 `id` 去重，已存在的跳过
  - 导入的经验统一进新生代（generation=0），按正常流程参与晋升
  - 导入前预检：校验 JSON 格式和字段完整性，显示"将导入 N 条，其中 M 条重复"
- **`importExperiences()` / `exportAll()` 方法**：ExperienceStore 新增导入导出 API
- **`isValidImportedExperience()` 校验函数**：类型安全的导入数据校验

#### P5 测试新增
- experience-store: 4 个新测试（全量导出、按任务类型导出、导入去重、任务类型推断）
- 总计从 40 个测试增加到 44 个，全部通过

### 计划中
- **阶段 4** — 自适应策略调整（Adaptive Strategy Adjustment）
  - `agent/request` 瀑布：基于历史成功率选择模型
  - `tools/restrict`：基于历史使用模式推荐工具
  - `repeat-tool-reminder` 守卫阈值自适应

### 文档与规划
- `docs/design.md` 全篇译为中文，与既有中文 README 保持一致
- `todo.md` 重构：按主题域去重重组，并新增「前置项」，明确任务边界（有 goal 按 goal 聚合 / 无 goal 按多步工具簇 / 纯问答不存储）与存储单元；评审引入分层记忆、冲突裁决、提炼升华方向（对应 P6 建议）
- 移除 `src/index.ts` 中未使用的 `createHash` import（还原占位残迹，避免提交空 import）

## [0.1.0] - 2026-08-23

### 新增
- **阶段 1 — 经验库 + 结果评分器（最小闭环）**
  - 基于 SQLite 的 `ExperienceStore`（复用会话持久化基础设施）
    - 表结构：`(context_hash, task_pattern, tools_used, workspace_digest, actions, outcome_score, user_feedback, lesson, tags, confidence, reuse_count)`
    - 索引：`context_hash`、`task_pattern`、`outcome_score DESC`
    - 保留策略：最近 1000 条；按 `outcome_score` + 新近度淘汰
    - 置信度衰减：未再次验证则随复用次数权重递减
  - `OutcomeEvaluator`（第 1 层）— 只读回合评分器
    - 挂载到 `agent/turn-stopping`（串行）
    - 输入：`goalProgress`、`toolCallCount`、`toolSuccessRate`、`guardTriggerCount`、`userFeedback`
    - 输出：加权综合 `outcomeScore`（0.0–1.0），基于 `SCORE_WEIGHTS`
  - 7 个存储测试 + 6 个评分器测试

- **阶段 2 — 行为适配器（建议性经验注入）**
  - `BehaviorAdapter`（第 2 层）— 三个注入点
    - `agent/pre-step`（waterfall）："过去经验" markdown 块（必须调用 `next()`）
    - `system-prompt/assemble`：动态 `Learned Preferences` 段（order 450）
    - `agent/request`（waterfall）：按历史成功率选择模型/参数
  - 上下文指纹模糊匹配（任务模式 + 工具组合 + 工作区摘要）
  - 从累积反馈中提取偏好
  - 8 个适配器测试

- **阶段 3 — 元认知引擎（LLM 反思）**
  - `MetaCognitionEngine`（第 4 层）
    - 挂载到 `turn/end`（durable）→ 入队反思
    - 挂载到 `agent/run-maintenance` → 异步处理队列（空闲时间）
    - 使用低成本 `deepseek-chat`（而非 `deepseek-reasoner`）以控制开销
    - 生成 `{what_worked, what_failed, what_to_try_differently, reusable_lesson}`
    - 写 `lesson` 到经验库，再次验证时提升置信度
  - 可选：通过 `metaCognitionEnabled: false` 关闭；阶段 1–3 仍构成完整闭环
  - 8 个元认知测试

- **插件入口** — `apply(ctx, config)` Cordis 插件
  - 优雅降级：当 `ctx.on` / `ctx.systemPrompt` / `ctx.effect` 缺失时（独立测试模式）所有层变为 no-op
  - 自动清理：插件卸载时关闭存储
  - 配置 schema：`dbPath`、`metaCognitionEnabled`、`behaviorAdapterEnabled`、`maxRecords`、`minInjectionScore`

- **基准测试套件**（A/B 对比）
  - `benchmark/task-suite.ts` — 20 个预定义 agent 任务场景（含最优路径）
  - `benchmark/sim-agent.ts` — 模拟 agent（有/无经验模式）
  - `benchmark/run-benchmark.ts` — 运行器 + HTML 报告生成器
  - 输出 `benchmark-report.html` / `benchmark-report.json`

- **文档**
  - `README.md` — 概述、结构、快速上手、挂载指南
  - `docs/design.md` — 完整四层架构、安全边界、分阶段实施路径

- **挂载配置** — `cordis.yml`，用于 dsh profile 集成

### 安全
- 所有注入均为**建议性**（模型可听从或忽略）— 不强制修改配置
- 评分器为**只读** — 绝不修改 agent 行为或回合输出
- 经验库**仅本地**（与会话日志同信任边界）；无显式 opt-in 不外传遥测
- 插件**可卸载** — 卸载后 agent 完全恢复确定性行为

### 依赖
- 运行时：`@langchain/core`、`agentevals`、`better-sqlite3`、`promptfoo`、`ulid`
- 开发：`tsx`、`typescript` 5.6、`@types/node`、`@types/better-sqlite3`
- Node 引擎：`>=22.0.0`

[Unreleased]: https://github.com/aminuoshi-378/dsh-self-improving/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aminuoshi-378/dsh-self-improving/releases/tag/v0.1.0

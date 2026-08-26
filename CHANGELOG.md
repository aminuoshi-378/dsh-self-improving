# 变更日志

`dsh-self-improving` 的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，本仓库遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

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
- Node 引擎：`>=20.0.0`

[Unreleased]: https://github.com/aminuoshi-378/dsh-self-improving/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aminuoshi-378/dsh-self-improving/releases/tag/v0.1.0

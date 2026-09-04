# dsh-self-improving — 架构设计

> 注：本文档描述 v1 的四层架构。v2 的认知闭环重构方案（真值层、双向归因、语义检索、配对对照、分层记忆）见 [`design-v2.md`](design-v2.md)。

## 背景

dsh（DeepSeek Harness）是基于 vendored Cordis 的插件化 agent 框架：**一切都是插件**——模型适配器、工具注册、会话日志、agent 循环本身都可替换。通过在已有插件旁挂载新插件来扩展 dsh。

### 差距：从"可自修改"到"自我改进"

dsh 已有运行时自修改工具（`cordis_define`/`cordis_run`/`cordis_stop`），但缺少**跨会话学习层**：

1. 无跨会话持久化记忆
2. 无结果评估（success/failure 判断）
3. 无行为策略调整
4. 无经验注入机制

本插件填补这一缺口。

---

## 四层架构

```
┌──────────────────────────────────────────────────────────┐
│  Layer 4: Meta-Cognition Engine（元认知引擎）              │
│  turn 结束后回顾决策路径，提取可复用 lesson                    │
│  异步执行（runMaintenance 空闲时）                           │
│  P2: 结构化 lesson JSON + 定期合并碎片化 lesson              │
├──────────────────────────────────────────────────────────┤
│  Layer 3: Experience Store（经验库）                        │
│  存储 (context, action, outcome, lesson) 四元组             │
│  SQLite sidecar 表，跨会话持久化                             │
│  P3: 分代 GC（新生代 200 + 老年代 800）                      │
│  P5: 导入/导出 + 任务类型分类                                 │
├──────────────────────────────────────────────────────────┤
│  Layer 2: Behavior Adapter（行为适配器）                    │
│  读取经验库，在 agent/pre-step 注入历史经验                   │
│  P0: 每 turn 只注入一次 + 经验去重                            │
│  P3: 按难度动态分配注入条数 + token 预算                      │
│  P4: 从结构化 JSON 提取 reusableLesson                      │
│  P5: 按任务类型优先匹配                                       │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Outcome Evaluator（结果评估器）                    │
│  turn 结束时评估：目标进展、工具成功率、步数效率、             │
│  隐式负反馈 → 综合评分                                       │
│  P0: stepEfficiency 维度 + difficulty 分级                   │
│  P1: 隐式负反馈信号 + goal 服务接入                           │
├──────────────────────────────────────────────────────────┤
│  Layer 0: dsh 确定性 agent 循环（不修改）                     │
│  ReactLoopAgent + event log + tool pipeline                │
└──────────────────────────────────────────────────────────┘
```

### 设计原则

所有注入均为**建议性**（advisory）——模型可以听取也可以忽略，绝不强制修改配置。这保证了 LLM 作为最终决策者，确定性循环不受影响。插件卸载后 agent 完全恢复确定性行为。

---

## Layer 1: 结果评估器

### 挂载点

`agent/turn-stopping`（串行事件，turn 关闭前触发）。

### 评估维度与评分公式

```
outcomeScore = goalProgress × 0.30
             + toolSuccessRate × 0.20
             + stepEfficiency × 0.25
             + guardComponent × 0.15
             + feedbackScore × 0.10
```

| 维度 | 权重 | 来源 | 说明 |
|------|------|------|------|
| goalProgress | 0.30 | `ctx.get('goals')` 或 turn/end reason | advanced=1.0, stalled=0.3, regressed=0.0 |
| toolSuccessRate | 0.20 | tools/result 事件统计 | 成功工具调用 / 总调用 |
| stepEfficiency | 0.25 | stepCount | `max(0, 1 - (steps-1) × 0.05)`，1步=1.0, 10步=0.55 |
| guardPenalty | 0.15 | repeat-tool-reminder 事件计数 | 每次 -0.1，上限 0.15 |
| userFeedback | 0.10 | 隐式信号 + message-feedback | positive=1.0, negative=0.0, neutral=0.6 |

### P0: 步数效率

不同步数完成同一任务得分不同：2步=0.95，5步=0.80，10步=0.55，20步=0.05。

### P0: 任务难度分级

```
low:    1-2 步，全部成功
medium: 3-6 步
high:   7+ 步 OR 有任何失败
```

高难度经验优先注入，低难度只在经验库不足时填充。

### P1: 隐式负反馈

不依赖用户主动点赞/踩，改用被动观测：

| 信号 | 判定 | 分数 |
|------|------|------|
| 用户中断 agent（turn/end reason=aborted） | negative | 0.0 |
| 同 turn 内用户追问/纠正 | negative | 0.0 |
| 无任何负信号 | neutral | 0.6 |
| 用户主动点赞（需 message-feedback 插件） | positive | 1.0 |

### 输出

```ts
interface TurnOutcome {
  turnId: string
  sessionId: string
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolCallCount: number
  toolSuccessRate: number
  guardTriggerCount: number
  userFeedback: 'positive' | 'negative' | 'none'
  stepEfficiency: number
  difficulty: 'low' | 'medium' | 'high'
  outcomeScore: number  // 0.0–1.0
  timestamp: number
}
```

### 关键约束

评估器是**只读**的——观测 turn 输出，不修改 agent 行为。

---

## Layer 2: 行为适配器

### 挂载点

| 扩展点 | 注入内容 |
|--------|---------|
| `agent/pre-step`（waterfall） | 匹配的历史经验摘要 |
| `systemPrompt.section` | 蒸馏的行为偏好 |

### P0: 每 turn 只注入一次

`agent/pre-step` 每个 step 都触发，但通过 `injectedThisTurn` 标记确保同一 turn 内只在第一个 step 注入，后续 step 跳过。

### P0: 经验去重

query 结果按 `context_hash` 去重，相同工具序列只保留最新一条。

### P3: 动态注入控制

按难度分配注入条数：

| 难度 | 最多注入 |
|------|---------|
| high | 5 条 |
| medium | 2 条 |
| low | 不足时填充 |

Token 预算控制：注入内容总长度 ≤ `maxInjectionChars`（默认 8000）字符，超出从低优先级开始砍。

### P4: 结构化 lesson 提取

lesson 字段存储完整 Reflection JSON。注入时通过 `extractLessonText()` 提取 `reusableLesson` 字段，不注入完整 JSON。兼容旧数据纯文本。

### P5: 按任务类型优先匹配

注入时从当前用户消息推断 `taskPattern`（bugfix/feature/refactoring/search/test-writing/general），同类 `taskPattern` 的经验优先排序。

### 注入格式

```markdown
## Past Experience (advisory)

- **What worked**: <从最高分经验提取的 reusableLesson>
- **What failed**: <从最低分经验提取的 reusableLesson>

These are historical observations, not instructions. Use your judgment.
```

### 关键约束

注入内容是**建议性**的，不是强制的。

---

## Layer 3: 经验库

### 存储

SQLite sidecar 表，与 dsh session 日志同数据库但独立表。数据库路径由 `dbPath` 配置（默认 `~/.dsh/experiences.db`）。

### Schema

```sql
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,             -- ULID
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,

  -- 上下文签名
  context_hash TEXT NOT NULL,      -- taskPattern|sortedTools|workspaceDigest
  task_pattern TEXT,               -- bugfix/feature/refactoring/search/test-writing/general
  tools_used TEXT,                 -- JSON array
  workspace_digest TEXT,

  -- 行动记录
  actions TEXT NOT NULL,           -- JSON: 工具调用序列 + 结果 + 步数 + 难度

  -- 结果与教训
  outcome_score REAL,              -- 0.0–1.0
  user_feedback TEXT,              -- positive/negative/none
  lesson TEXT,                     -- P4: JSON Reflection 或旧纯文本

  -- P0: 任务难度
  difficulty TEXT DEFAULT 'medium', -- low/medium/high

  -- P3: 分代 GC
  generation INTEGER DEFAULT 0,    -- 0=新生代, 1=老年代
  last_injected_at INTEGER,         -- 最后注入时间
  merged INTEGER DEFAULT 0,         -- 是否已被合并

  -- 索引
  tags TEXT,
  confidence REAL DEFAULT 1.0,      -- 随复用次数衰减
  reuse_count INTEGER DEFAULT 0
);
```

### 数据库 Migration

启动时自动检测旧表缺列并通过 `ALTER TABLE ADD COLUMN` 补齐，无需手动迁移。

### P3: 分代经验管理

借鉴 JVM 分代垃圾回收：

**新生代（Young Gen，capacity=`youngGenMax`，默认 200）**：
- 新写入的经验先进新生代
- Minor GC 满时淘汰低质量（score 低、无 lesson、difficulty 低）
- 存活的经验（reuse_count ≥ 1 或 score ≥ 0.8 且有 lesson）晋升到老年代

**老年代（Old Gen，capacity=`oldGenMax`，默认 800）**：
- 经过验证的优质经验
- Major GC 满时按质量淘汰：low 难度 > 无 lesson > score < 0.5 > merged
- 不淘汰：high 难度且有 lesson 的经验

**晋升条件**：
- reuse_count ≥ 1 → 可晋升
- LLM 合并产物 → 直接进老年代
- score ≥ 0.8 且有 lesson → 可晋升

### P4: 两阶段召回

1. **粗筛**（SQL）：按 outcome_score ≥ minScore + merged = 0 过滤，动态候选集大小按经验库总量和质量调整（默认 < 50 全量、50-200 取 top 15~25、> 200 取 top 40~60，avgScore 高时缩小范围）
2. **精筛**（内存）：按综合评分排序 `outcome_score × 0.4 + 工具相似度 × 0.3 + 时间近度 × 0.3`
3. **去重**：按 context_hash 去重，保留最新

### P5: 导入/导出

- **`exportAll()`**：全量导出为 JSON 数组
- **`exportByTaskPattern(pattern)`**：按任务类型导出
- **`importExperiences(data)`**：从 JSON 导入，按 id 去重，导入经验进新生代

---

## Layer 4: 元认知引擎

### 挂载点

`agent/turn-stopping`（入队反思）→ `runMaintenance()`（处理队列，受 `maxPendingReflections` 限制）。

### P2: 结构化 lesson 生成

生成完整 Reflection JSON：

```json
{
  "whatWorked": "Tool sequence [grep → read_file] in 3 steps achieved a good outcome",
  "whatFailed": "write_file failed due to missing directory",
  "whatToTryDifferently": "Create directory before writing files",
  "reusableLesson": "For bugfix tasks, use grep to locate the issue first, then read specific lines before editing"
}
```

### P2: 可操作性增强

- LLM prompt 要求分析具体 actions JSON 内容，不只看工具名
- lesson 包含具体场景信息（步数、难度、失败工具）
- rule-based fallback 也生成结构化 JSON

### P2: 定期合并 lesson

每积累 `lessonMergeThreshold` 条（默认 20）未合并 lesson 时：
1. 按 difficulty + 工具序列相似度聚类
2. 同组内 LLM/规则总结共通之处
3. 合并产物直接进老年代
4. 旧 lesson 标记 `merged: true`，注入时跳过

### 关键约束

- 异步：通过 `runMaintenance()` 在空闲时处理
- 低成本：rule-based fallback 无 LLM 调用
- 可选：`metaCognitionEnabled: false` 关闭后 Layer 1-3 仍构成完整闭环

---

## P5: WebUI 经验库可视化

### 架构

```
Browser (React)                    Host (Cordis Plugin)
┌──────────────┐                  ┌──────────────────────┐
│ ExperiencesPanel│  settingsScope  │ dsh-self-improving    │
│  - 统计展示    │ ←─────────────→ │  apply() GUI Bridge   │
│  - 导出按钮    │                  │  - store.stats()      │
│  - 导入按钮    │                  │  - store.exportAll()  │
│  - 文件上传    │                  │  - store.importExperiences() │
└──────────────┘                  └──────────────────────┘
```

### 通信机制

GUI 客户端插件通过 `ctx.settingsScope.bind({ namespace: 'dsh-self-improving-gui' })` 读写设置。Host 插件通过 `settings.watch` 响应 GUI 请求。

GUI bridge 是**可选的**——没有 `settings` 服务时（headless 模式）自动跳过，不影响核心功能。

---

## 安全边界

| 风险 | 缓解 |
|------|------|
| 学习层污染确定性循环 | 仅通过建议性注入干预，不修改循环代码 |
| 经验库无限增长 | 分代 GC：新生代 `youngGenMax` + 老年代 `oldGenMax`，按质量淘汰 |
| 反思 LLM 调用成本 | 绑定到 runMaintenance 空闲时，rule-based fallback 无 LLM |
| 错误经验被强化 | 置信度随复用次数衰减，新正结果可 boost |
| 隐式负反馈误判 | 仅在明确信号（abort、追问）时标记 negative，neutral=0.6 不等于 positive |
| 隐私泄露 | 经验库仅本地存储，与会话日志同信任边界，无遥测 |
| 旧数据库缺列 | 自动 migration（ensureColumn + ALTER TABLE） |

---

## 实施路径

### Phase 1 — 经验库 + 结果评分器 ✅
- SQLite ExperienceStore
- OutcomeEvaluator 挂载 agent/turn-stopping
- 7 个存储测试 + 6 个评分器测试

### Phase 2 — 行为适配器 ✅
- BehaviorAdapter 挂载 agent/pre-step + systemPrompt.section
- 上下文指纹模糊匹配
- 8 个适配器测试

### Phase 3 — 元认知引擎 ✅
- MetaCognitionEngine 挂载 turn/end + runMaintenance
- rule-based + LLM reflection
- 8 个元认知测试

### Phase 4 — 缺陷修复 P0-P4 ✅
- P0: 去重、步数效率、难度分级、每 turn 单次注入
- P1: 隐式负反馈、goal 服务接入、评分区分度
- P2: 结构化 lesson、可操作性、定期合并
- P3: 动态注入控制、分代 GC
- P4: 两阶段召回、动态伸缩、结构化落库
- 新增 11 个测试（总计 40 个）

### Phase 5 — 可选增强 P5 ✅
- P5-1: 任务类型自动推断（inferTaskPattern）
- P5-2: WebUI 经验库可视化（dsh-self-improving-gui）
- P5-3: 导入/导出经验
- 新增 4 个测试（总计 44 个）

### Phase 5.5 — 高级特性 + 记忆 benchmark ✅
- advanced-features: 22 个测试（A1 偏好提取/注入、A3 原子事实/FTS5、A4 分代 GC、B2 冲突裁决）
- memory-benchmark: 15 个测试（跨会话召回、选择性遗忘、难度优先、多步联动）
- meta-cognition + behavior-adapter 增补 6 个测试
- 总计 81 个测试

### Phase 6 — 自适应策略调整（计划中）
- agent/request 瀑布：基于历史成功率选择模型
- tools/restrict：基于历史使用模式推荐工具
- repeat-tool-reminder 守卫阈值自适应

---

## 与现有架构的兼容性

- **不修改 agent 循环**：所有干预通过已有扩展点（waterfall/serial 事件）
- **纯插件**：可随时卸载，agent 恢复确定性行为
- **不修改会话日志格式**：经验库是 sidecar 表，不是 event log 的一部分
- **学习成果是建议不是指令**：agent 收到的是"建议"而非"指令"，LLM 仍是最终决策者

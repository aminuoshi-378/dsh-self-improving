# Self-Improving DeepSeek Harness — 设计文档

## 背景

DeepSeek Harness（`dsh`）是基于 fork 版 Cordis 的插件化 Agent 框架：**一切皆插件**，包括模型适配器、工具注册表、会话日志和 Agent 主循环本身。每个部件都可以通过配置替换。不存在需要打补丁的"特权核心"——你通过在其旁边挂载一个插件来扩展 dsh，所有注册都是副作用，随插件卸载而解除。

### 已有能力

dsh 已经具备一套完整的**运行时自修改**系统，位于 `packages/extensions/`（自引用 Cordis 工具集）。七个面向模型的工具让 Agent 可以：

| 工具 | 用途 |
|---|---|
| `cordis_inspect_list` | 列出 Host/Client 的 inspect provider 及其只读查询方法 |
| `cordis_inspect_query` | 执行显式只读查询（服务签名、事件模式、工具 schema、slot 树、主题 token） |
| `cordis_inspect_self` | 检查当前会话的动态插件、包、版本指针、源码和诊断信息 |
| `cordis_define` | 定义一个不可变的 Cordis Package（新插件或向已有插件追加新版本） |
| `cordis_run` | 激活某个包（`mode: "run"` 用于首次激活/重启/回滚；`mode: "update"` 用于切换版本） |
| `cordis_stop` | 停止当前运行，取消待处理的审批，保留定义与版本指针 |
| `cordis_undefine` | 永久删除某个动态插件及其所有包 |

模型编写的代码运行在 `node:vm` 沙箱中，通过白名单 Context 门面（facade）暴露能力。动态插件仅存在于进程内——重启后不持久化，不修改 `cordis.yml`，也不安装包。

此外还有：

- **系统提示词可在运行时组合**：`ctx.systemPrompt.section()`、`.context()`、`.tools()`、`.variable()` 可注册有序、作用域化、可替换的片段。
- **工具可用性运行时可控**：`ctx.tools.register()` / `ctx.tools.restrict()`，支持允许/拒绝列表。
- **Guard 插件提供基础自监管**：`repeat-tool-reminder`（检测连续相同的工具调用，渐进式提醒）和 `timeout-policy`（强制执行声明的工具超时）。
- **反馈会被采集**：`message-feedback`（逐条消息的正/负评分）和 `command-feedback`（`/feedback` 命令，会话级文本）。但**两者都未被消费**——没有任何代码路径把反馈回灌到行为调整中。

### 缺口

从"自修改"到"自改进"之间的差距在于**学习层**：

1. **缺少跨会话持久化**：`agent.inject()` 只影响当前会话。动态插件重启即消失。不存在 Agent 可写入的持久记忆存储。
2. **缺少结果评估**：`session-stats` 只收集描述性统计（轮次/步数、延迟），从不判断成败。`foldConsumedWork` 只做工作量核算，不做质量评估。
3. **缺少行为策略调整**：`agent/request` 瀑布流允许插件替换 LLM 配置，但没有任何插件基于历史结果做这件事。压缩（compaction）使用固定模板。Guard 阈值是静态的。
4. **缺少提示词策略学习**：系统提示词片段是静态配置的。没有任何机制根据历史有效经验调整提示方式。
5. **缺少元认知**：`cordis_inspect` 工具用于检查运行时状态（服务、插件、工具）以便调试，而非进行认知反思。Agent 不会"思考自身的思考"。
6. **缺少经验回放**：会话日志是事件溯源的，可回放以重建状态，但没有任何代码抽取（情境、动作、结果）三元组用于学习。

该架构**有意排除了运行时行为突变**，因为突变会破坏事件日志的可重建性。不变量（`invariant.ts`）断言：任何模型可见的内容都必须能从日志重建。因此学习层必须通过**持久的配置变更**和**咨询性上下文注入**来干预，而不是偷偷改动运行时状态。

## 架构

### 四层模型

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: 元认知引擎（Meta-Cognition Engine）             │
│  每轮结束后，审视决策路径，抽取可复用的经验教训，写入经验库。 │
│  异步执行，在 Agent 空闲时运行（runMaintenance）。        │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 经验库（Experience Store，跨会话记忆）          │
│  存储 (context, action, outcome, lesson) 元组。           │
│  基于 SQLite，复用会话持久化基础设施。                    │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 行为适配器（Behavior Adapter）                  │
│  读取经验库，在新会话 / 新步骤开始时注入习得经验。         │
│  通过现有扩展点注入：                                    │
│  systemPrompt.section / agent/pre-step / agent/request   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: 结果评估器（Outcome Evaluator）                 │
│  轮次结束时评估：目标是否推进？工具是否成功？Guard 是否触发？│
│  用户反馈是否为负？产出奖励信号，写入经验库。              │
├─────────────────────────────────────────────────────────┤
│  Layer 0: 现有确定性 Agent 主循环（保持不变）              │
│  ReactLoopAgent + 事件日志 + 工具流水线                  │
└─────────────────────────────────────────────────────────┘
```

### 设计原则

所有注入都是**咨询性**的（模型可以采纳也可以忽略的上下文），绝不是强制性的配置突变。这保证了 LLM 始终是最终决策者，同时保持确定性主循环不变。学习层是一个纯粹的插件——卸载它，Agent 即恢复完全确定性的行为。

---

## Layer 1: 结果评估器（Outcome Evaluator）

### 挂载点

`agent/turn-stopping`（串行事件，在轮次关闭前触发）。这是观察完整轮次在途状态的最后机会。

### 职责

在每轮结束时评估该轮输出的质量：

- **目标进度**：读取 `ctx.goals` 状态变化——活动目标是否从 `active` 推进到 `complete`，还是停留在 `active`？
- **工具调用成功率**：统计本轮内 `tools/result` 事件中成功与错误的比例。
- **Guard 触发情况**：统计 `repeat-tool-reminder` 的激活次数（表示 Agent 曾陷入循环）。
- **用户反馈**：读取本轮助手消息对应的 `message-feedback` 数据。

### 输出

一个 `TurnOutcome` 结构：

```ts
interface TurnOutcome {
  turnId: string
  sessionId: string
  goalProgress: 'advanced' | 'stalled' | 'regressed' | 'none'
  toolCallCount: number
  toolSuccessRate: number  // 0.0–1.0
  guardTriggerCount: number
  userFeedback: 'positive' | 'negative' | 'none'
  outcomeScore: number  // 0.0–1.0，加权综合分
  timestamp: number
}
```

### 关键约束

评估器是**只读**的——它观察轮次输出，不修改 Agent 行为。这保证了确定性主循环不受影响。

---

## Layer 2: 行为适配器（Behavior Adapter）

### 挂载点

三个现有扩展点：

| 扩展点 | 注入内容 | 来源 |
|---|---|---|
| `agent/pre-step`（瀑布流） | 相关的历史经验摘要作为上下文 | 与当前任务模式匹配的经验库记录 |
| `system-prompt/assemble` | 适配后的行为偏好（如"该用户偏好简洁回答"、"该项目常用 React 模式"） | 从用户反馈与任务模式提炼出的偏好 |
| `agent/request`（瀑布流） | 基于历史成功率的模型/参数选择 | 按任务类型分组的 Provider 成功率统计 |

### 职责

在每一步开始前，从经验库检索上下文签名与当前情境相似的经验，作为模型可见的上下文注入。这不是代码修改——而是给模型更多信息以做出更好的决策。

### 关键约束

注入内容是**咨询性**的，不是强制性的。模型可以采纳也可以忽略。这保持了 Agent 的灵活性。

### `agent/pre-step` 注入格式

```markdown
## 历史经验（咨询性）

在之前的类似情境中：
- **有效做法**：<来自得分最高的匹配经验的教训>
- **失败做法**：<来自得分最低的匹配经验的教训>
- **建议方法**：<聚合后的推荐>

这些是历史观察，不是指令。请自行判断。
```

### `system-prompt/assemble` 注入

一个动态组装的片段，排在静态片段之后、工具 schema 之前。内容是对已习得偏好的简洁列表：

```markdown
## 习得偏好（咨询性）

- 用户倾向于偏好带代码示例的简洁回答
- 在此工作区中，TypeScript 是主要语言
- 对本项目而言，基于 ripgrep 的搜索历史上比 glob 更高效
```

---

## Layer 3: 经验库（Experience Store）

### 存储

复用 `packages/session/` 的 SQLite 后端基础设施。在同一个数据库中新建 `experiences` 表。

### Schema

```sql
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,          -- ULID
  session_id TEXT NOT NULL,     -- 来源会话
  turn_id TEXT NOT NULL,        -- 来源轮次
  created_at INTEGER NOT NULL,  -- 时间戳

  -- 上下文签名：任务类型 + 工具组合 + 工作区指纹
  context_hash TEXT NOT NULL,   -- 用于相似度匹配
  task_pattern TEXT,            -- "重构" / "修 bug" / "新功能" 等
  tools_used TEXT,              -- 工具名 JSON 数组
  workspace_digest TEXT,        -- 工作区文件树摘要

  -- 动作记录
  actions TEXT NOT NULL,        -- JSON：工具调用序列摘要

  -- 结果与教训
  outcome_score REAL,           -- 0.0–1.0，综合评分
  user_feedback TEXT,           -- "positive" / "negative" / "none"
  lesson TEXT,                  -- LLM 生成的自然语言教训

  -- 索引
  tags TEXT,                    -- 标签 JSON 数组
  confidence REAL DEFAULT 1.0,  -- 复用时会衰减，除非被重新验证
  reuse_count INTEGER DEFAULT 0 -- 该经验被注入过多少次
);

CREATE INDEX idx_experiences_context ON experiences(context_hash);
CREATE INDEX idx_experiences_task ON experiences(task_pattern);
CREATE INDEX idx_experiences_score ON experiences(outcome_score DESC);
```

### 检索

上下文签名的模糊匹配——对任务模式 + 工具组合 + 工作区摘要做加权相似度计算。无需向量数据库；SQLite FTS（`session-query` 已可用）即可满足。

### 淘汰策略

保留最近 1000 条经验，按 `outcome_score` 与时效性的综合评分淘汰。`outcome_score < 0.3` 且 `reuse_count == 0` 的经验优先淘汰。

---

## Layer 4: 元认知引擎（Meta-Cognition Engine）

### 挂载点

`turn/end` 会话事件（持久事件，在轮次完全关闭后触发）。反思本身在 `agent.runMaintenance()` 期间异步执行。

### 职责

当一轮完全关闭、所有工具调用与用户反馈均已记录后，调用低成本的 LLM 生成结构化反思：

```text
输入：本轮的工具调用序列 + 结果 + 目标进度 + Guard 触发情况 + 用户反馈
输出：{
  "what_worked": "...",
  "what_failed": "...",
  "what_to_try_differently": "...",
  "reusable_lesson": "..."  ← 此项写入经验库的 lesson 字段
}
```

### 关键约束

- **异步**：通过空闲时的 `agent.runMaintenance()` 触发，不消耗正常轮次的 token 预算。
- **低成本模型**：使用 `deepseek-chat`（而非 `deepseek-reasoner`）以控制开销。
- **可选**：可通过配置关闭；即使没有 LLM 反思，Layer 1–3 也能形成闭环（只是缺少 `lesson` 字段）。

---

## 安全边界

| 风险 | 缓解措施 |
|---|---|
| 学习层污染确定性主循环 | 学习层只通过咨询性注入干预，绝不修改主循环代码 |
| 经验库无限增长 | 保留窗口（最近 1000 条），按结果评分 + 时间衰减淘汰 |
| 反思 LLM 调用成本 | 绑定到 `runMaintenance()`，仅在空闲时触发，使用低成本模型 |
| 错误经验被强化 | 置信度衰减——每条经验的权重随复用次数下降，除非被新的正向结果重新验证 |
| 动态插件被滥用 | 学习成果主要落地为系统提示词片段与上下文注入，而非动态插件 |
| 存储的经验导致隐私泄露 | 经验库仅本地保存，与会话日志同一信任边界；未经明确同意不导出遥测数据 |

---

## 实施路径（分阶段）

### 阶段 1 — 经验库 + 结果评估器（最小闭环）

- 新建包 `packages/core/experience/`（或 `packages/learning/experience/`），实现 SQLite 存储。
- 在 `agent/turn-stopping` 挂载结果评估器，将原始轮次数据写入经验库。
- 暂不引入 LLM 反思，只做客观数据记录。
- **交付物**：一个闭环的数据采集循环。每一轮的结果都被评分并存储。

### 阶段 2 — 行为适配器

- 在 `agent/pre-step` 注入历史经验摘要。
- 在 `system-prompt/assemble` 注入行为偏好。
- 上下文相似度检索使用基于规则的匹配（而非 LLM）。
- **交付物**：Agent 在每一步开始时能看到自身的过往经验。

### 阶段 3 — 元认知引擎

- 在 `turn/end` + `runMaintenance` 触发 LLM 反思。
- 生成 `lesson` 字段，写入经验库。
- 引入置信度衰减机制。
- **交付物**：Agent 反思自身表现并抽取可复用的教训。

### 阶段 4 — 自适应策略调整

- `agent/request` 瀑布流：基于历史成功率选择模型。
- `tools/restrict`：基于历史使用模式推荐工具。
- Guard 阈值自动调优：`repeat-tool-reminder` 的阈值根据观察到的循环频率自适应。
- **交付物**：Agent 基于积累的经验自适应调整工具与模型路由。

---

## 与现有架构的兼容性

本设计**不修改 Agent 主循环本身**。所有干预都通过现有扩展点（瀑布流/串行事件）进行。这符合 dsh 的核心设计哲学："没有任何一行代码修改主循环本身"（`docs/cookbook/extension-cookbook.zh.md:99`）。

学习层是一个纯粹的插件。它可以随时卸载，卸载后 Agent 恢复完全确定性的行为。无需修改任何会话日志格式——经验库是旁路表（sidecar table），不属于事件日志的一部分。

本设计最大的架构决策是：**学习成果以咨询性上下文注入，而非配置突变**。这意味着 Agent 接收的是"建议"而非"指令"，从而保证 LLM 始终是最终决策者——这正是 dsh Agent 架构的基本原则。

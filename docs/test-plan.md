# 测试计划 — Agent 记忆系统基准测试

## 预算

50 万 token。

## 选型结论

选 **AlekseiMarchenko/agent-memory-benchmark**（下称 AMB）作为第一步。

理由：

1. **零 token 消耗跑通基础测试** — AMB 的测试模式是 seed → query → expectedKeywords，直接测 `ExperienceStore` 的 store/query 接口，不需要调用 LLM
2. **TypeScript，技术栈一致** — 适配成本最低，直接 import 本项目的 `ExperienceStore` 类
3. **测试场景精准命中本项目核心功能** — Conflict Resolution 测经验去重，Cross-Session 测跨会话注入，Selective Forgetting 测分代 GC
4. **剩余预算留给方案 A** — 扩展 task-suite 加跨会话依赖任务，仍用 SimAgent 跑

LoCoMo 和 LongMemEval 是阅读理解式测试（把对话全量丢给 LLM 看能不能回忆），不是测记忆系统 API，适配成本高且消耗大量 token。

---

## 行动步骤

### 第 1 步：实现 MemoryAdapter 适配层（0 token，纯代码）

AMB 的测试框架需要一个 `MemoryAdapter` 接口：

```typescript
// AMB 的接口（src/types.ts）
interface MemoryAdapter {
  name: string
  initialize(): Promise<void>
  store(content: string, options?: StoreOptions): Promise<MemoryEntry>
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>
  delete(id: string): Promise<boolean>
  cleanup(): Promise<void>
}
```

本项目 `ExperienceStore` 的接口是：

```typescript
// src/store/experience-store.ts
class ExperienceStore {
  store(outcome: TurnOutcome, context: {
    taskPattern: string | null
    toolsUsed: string[] | null
    workspaceDigest: string | null
    actions: string
    tags?: string[]
  }): string

  query(query: ExperienceQuery): ExperienceRecord[]
}
```

两个接口不直接兼容——AMB 的 `store(content: string)` 是往记忆库里写入一段自由文本，本项目的 `store()` 需要结构化的 `TurnOutcome` + context。

**适配方式**：写一个 `ExperienceStoreAdapter` 类，把 AMB 的 seed content 映射成 `TurnOutcome` + context，把 query 的 keyword 匹配映射成本项目的 `query()` 调用 + 结果内容检查。

新建文件 `test/amb-adapter.ts`：

```typescript
import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'
import type { MemoryAdapter, MemoryEntry, StoreOptions, SearchOptions } from './amb-types.js'

export class ExperienceStoreAdapter implements MemoryAdapter {
  name = 'dsh-self-improving'
  private store: ExperienceStore

  async initialize(): Promise<void> {
    this.store = new ExperienceStore()
  }

  async store(content: string, options?: StoreOptions): Promise<MemoryEntry> {
    // 把 AMB 的 seed content 映射成一条经验
    const outcome: TurnOutcome = {
      turnId: `amb-${Date.now()}`,
      sessionId: options?.agentId || 'amb-session',
      goalProgress: 'advanced',
      toolCallCount: 1,
      toolSuccessRate: 1.0,
      guardTriggerCount: 0,
      userFeedback: 'none',
      stepEfficiency: 0.9,
      difficulty: 'medium',
      outcomeScore: 0.8,
      timestamp: Date.now(),
    }
    const id = this.store.store(outcome, {
      taskPattern: null,
      toolsUsed: null,
      workspaceDigest: null,
      actions: content,  // AMB seed content 作为 actions 存入
    })
    return { id, content, createdAt: new Date().toISOString() }
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    // AMB 的 query 是自由文本，本项目 query 按 taskPattern/toolsUsed 匹配
    // 适配策略：不带过滤条件，全量召回，靠返回的 actions 字段做内容匹配
    const records = this.store.query({
      limit: options?.limit || 10,
      minScore: 0.0,
    })
    return records.map(rec => ({
      id: rec.id,
      content: rec.actions,  // AMB 期望返回 content 做关键词匹配
    }))
  }

  async delete(id: string): Promise<boolean> {
    return this.store.deleteById(id)
  }

  async cleanup(): Promise<void> {
    this.store.close()
  }
}
```

> 注意：上述代码是示意。实际实现时需要确认 `ExperienceStore` 是否有 `deleteById` 方法，如果没有需要先加。AMB 的 Selective Forgetting 类别依赖 delete 功能。

### 第 2 步：编写测试用例文件（0 token，纯代码）

参考 AMB 的测试用例，但改成直接调用 `ExperienceStore` 的 API，不走 AMB runner。新建 `test/memory-benchmark.test.ts`，沿用本项目既有的测试风格（`assert` + `test` 函数）。

#### 测试组 1：Conflict Resolution（经验去重）

验证：相同工具序列的经验只保留最新一条（P0 经验去重）。

```
场景：agent 第一次用 [grep, edit_file] 修了一个 bug，评分 0.6
      agent 第二次用 [grep, edit_file] 修了类似 bug，评分 0.9
预期：query 返回时，相同 context_hash 只保留最新（评分 0.9 的）
```

对应 AMB 的 `conflict-resolution.ts` cr-01 ~ cr-07 模式。

#### 测试组 2：Cross-Session（跨会话注入）

验证：session A 完成任务存入经验，session B 做类似任务时 query 能召回。

```
场景：session-1 完成 bugfix [grep, read_file, edit_file]，评分 0.85，存入经验
      session-2 做类似 bugfix，query(taskPattern='bugfix', toolsUsed=['grep'])
预期：返回 session-1 的经验，且 outcomeScore >= 0.85
```

对应 AMB 的 `cross-session.ts` cs-01 ~ cs-07 模式。

#### 测试组 3：Selective Forgetting（分代 GC + merged 跳过）

验证：标记为 `merged: true` 的经验在 query 时不返回。

```
场景：存入 3 条经验，手动标记第 2 条 merged=true
预期：query 只返回 2 条（merged 的被跳过）
```

对应 AMB 的 `selective-forgetting.ts` 模式。

#### 测试组 4：Difficulty Priority（难度优先排序）

验证：high 难度经验排在 low 之前。

```
场景：存入 3 条同 taskPattern 的经验，difficulty 分别为 low/medium/high
预期：query 返回排序为 high → medium → low
```

#### 测试组 5：Multi-step 连续任务（Layer 2 模式）

验证：一组有依赖关系的连续任务，后续任务能从前面任务的经验中受益。

```
场景：模拟 agent 连续完成 5 个任务：
  Task 1: 搭建项目框架 [write_file, write_file] → 评分 0.7
  Task 2: 添加认证 [read_file, grep, write_file] → 评分 0.85
  Task 3: 修认证 bug [grep, read_file, edit_file] → 评分 0.9（与 Task 2 工具序列部分重叠）
  Task 4: 数据库迁移 [grep, read_file, write_file] → 评分 0.8
  Task 5: 再修类似 bug [grep, read_file, edit_file] → 与 Task 3 相同 context_hash

预期：Task 5 query 时，Task 3 的经验因 context_hash 相同且时间更新而排在前面
      验证去重 + 跨会话召回 + 难度优先 三个功能联动
```

### 第 3 步：运行测试并修复问题（0~5w token）

```bash
pnpm test:memory    # 新增的测试脚本
```

可能的修复点：
- `ExperienceStore` 缺少 `deleteById` 方法 → 需要加
- `query()` 在全量召回时（无 taskPattern/toolsUsed/workspaceDigest）的排序行为是否符合预期
- 分代 GC 在小数据量下是否正常工作

### 第 4 步：扩展 SimAgent benchmark（5~15w token）

现有 `benchmark/task-suite.ts` 有 20 个独立任务，没有跨任务依赖。参考 AMB Layer 2 的 `context-continuity.json` 模式，新增一组连续任务链：

```typescript
// benchmark/task-suite.ts 新增
{
  id: 'chain-1',
  taskPattern: 'bugfix',
  description: 'Fix auth token expiry logic',
  workspaceDigest: 'ws-auth',
  optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
  mistakes: { ... },
  feedbackOnSuccess: 'positive',
  feedbackOnFailure: 'negative',
  // 新增字段：依赖的前置任务
  dependsOn: 'feat-2',  // feat-2 是 "Add logging middleware"，假设它引入了 token 逻辑
}
```

在 `SimAgent.runSuite` 中，有依赖的任务排在后面，执行时先 query 经验库中前置任务的经验，验证经验注入是否降低了犯错概率。

### 第 5 步：端到端验证（20~30w token，可选）

用真实 LLM agent（dsh + DeepSeek API）跑 3 组连续任务，对比有/无插件：

1. 跑 Task A（如"创建一个 Express server"），记录步数和工具调用
2. 跑 Task B（与 A 类似 context，如"给 Express server 加中间件"），对比有经验注入时步数是否减少
3. 跑 Task C（A 的需求变更版，如"改用 Koa"），验证 agent 是否跳过废弃方案

这是手动验收，不在 CI 里跑。每组任务消耗约 3~10w token（取决于对话轮数），3 组约 20~30w token。

---

## Token 预算分配

| 步骤 | 内容 | Token 预算 | 产出 |
|---|---|---|---|
| 1 | 实现 MemoryAdapter 适配层 | 0 | `test/amb-adapter.ts` |
| 2 | 编写测试用例文件 | 0 | `test/memory-benchmark.test.ts` |
| 3 | 运行测试 + 修复问题 | 0~5w | 代码修复 + 通过的测试 |
| 4 | 扩展 SimAgent benchmark | 5~15w | 扩展后的 task-suite + benchmark 报告 |
| 5 | 端到端验证（可选） | 20~30w | 验收报告 |
| **合计** | | **25~50w** | |

步骤 1-3 不消耗 token（纯代码，不调 LLM）。步骤 4 的 SimAgent 也是模拟，不调 LLM，但可能需要 AI 辅助设计测试场景。步骤 5 是唯一真实消耗 LLM token 的环节。

---

## 优先级排序

1. **先做步骤 1-3**（0 token）：验证 ExperienceStore 的核心功能（去重、跨会话召回、难度排序、merged 跳过）在 AMB 测试模式下是否正确
2. **再做步骤 4**（5~15w token）：扩展 benchmark 体现"连续任务"价值
3. **最后做步骤 5**（20~30w token）：端到端验证，证明记忆系统在真实 agent 场景中有效

如果预算紧张，步骤 1-3 已经能验证核心逻辑正确性。步骤 5 是锦上添花。

---

## AMB 测试用例与本项目功能映射

| AMB 类别 | AMB 测试内容 | 本项目对应功能 | 本项目实现位置 |
|---|---|---|---|
| Factual Recall | 存入事实，检索时返回 | `store()` + `query()` 基本读写 | `experience-store.ts:111` `store()` / `:243` `query()` |
| Semantic Search | 用改写/概念查询检索 | context_hash 模糊匹配 | `experience-store.ts:334` `compositeRank()` |
| **Conflict Resolution** | 事实矛盾时最新获胜 | **P0 经验去重** | `experience-store.ts:305` `deduplicateByContextHash()` |
| **Selective Forgetting** | 已删除记忆不重现 | **merged 跳过 + 分代 GC 淘汰** | `experience-store.ts:259` SQL `merged = 0` 过滤 |
| **Cross-Session** | 跨会话上下文保持 | **跨会话经验注入** | `behavior-adapter.ts` agent/pre-step 注入 |
| Temporal Reasoning | "之前/之后"查询 | recency 排序权重 | `experience-store.ts:339` recency 衰减 |
| Cost Efficiency | 延迟和操作计数 | token 预算控制 | `behavior-adapter.ts` ≤ 8000 字符限制 |
| Multi-Agent | Agent A 存储，B 检索 | session_id 隔离 | `experience-store.ts` sessionId 字段 |

### AMB Layer 2 多步场景映射

| AMB Layer 2 场景 | 文件 | 本项目对应测试 |
|---|---|---|
| Preference Application | `preference-application.json` | 按难度优先注入（high 最多 5 条） |
| Context Continuity | `context-continuity.json` | 跨会话经验注入（5 条经验 → 1 次 query 召回） |
| Conflict Resolution Multi | `conflict-resolution-multi.json` | 连续 3 条同 context_hash 经验 → 去重保留最新 |
| Cross-Agent Handoff | `cross-agent-handoff.json` | 不同 session_id 的经验互不干扰 |
| Redundancy Check | `redundancy-check.json` | 重复写入相同经验不产生冗余记录 |

---

## 具体文件清单

需要新建的文件：

| 文件 | 内容 | 步骤 |
|---|---|---|
| `test/amb-adapter.ts` | ExperienceStore → AMB MemoryAdapter 适配层 | 1 |
| `test/memory-benchmark.test.ts` | 5 组测试用例，沿用既有 assert/test 风格 | 2 |

需要修改的文件：

| 文件 | 改动 | 步骤 |
|---|---|---|
| `test/run-all.ts` | 在 testFiles 数组加入 `memory-benchmark.test.ts` | 3 |
| `package.json` | 加 `"test:memory": "tsx test/memory-benchmark.test.ts"` | 3 |
| `src/store/experience-store.ts` | 可能需要加 `deleteById` 方法（如缺） | 3 |
| `benchmark/task-suite.ts` | 新增跨任务依赖链任务组 | 4 |

---

## 验收标准

| 阶段 | 验收标准 |
|---|---|
| 步骤 1-3 | `pnpm test:memory` 全部通过，5 组测试用例 ≥ 15 个 assert 全绿 |
| 步骤 3 | `pnpm test` 全部通过（81 个测试，无回归） |
| 步骤 4 | `pnpm run benchmark` 生成报告，连续任务链中 enabled 组的 completionRate > baseline 组 |
| 步骤 5 | 真实 agent 跑连续任务时，有经验注入的 session-2 步数 < session-1 步数 |

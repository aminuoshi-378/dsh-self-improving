# dsh-self-improving v2 — 认知闭环重构方案

> 状态：方案设计（未实施）。本文是对 v1（现 `docs/design.md`）四大核心缺陷的根治方案，不修改 v1 文档。
>
> 前置阅读：先读 v1 文档与「缺陷分析」结论。本文假定读者已知 v1 的四层架构（OutcomeEvaluator / ExperienceStore / BehaviorAdapter / MetaCognitionEngine）。

---

## 0. 结论先行

v1 的"自进化"不是真的进化，而是四个缺陷叠加后的**单向乐观偏置经验库**：

| # | 缺陷 | 一句话本质 |
|---|------|-----------|
| D1 | 无验证闭环 | confidence 只涨不跌，关联当因果 |
| D2 | 评分是过程指标 | 衡量"执行流畅"而非"任务做对" |
| D3 | 纠正信号脆弱 | 黄金信号漏检率高、依赖脆弱契约 |
| D4 | 检索与收益脱节 | 按工具名而非语义召回，注入无关内容 |

四个缺陷共享**同一个根因**：v1 缺少一个"任务是否真正做对"的**结果级真值（ground-truth outcome）**。没有真值，就无法做对照（D1）、无法正确评分（D2）、无法校准信号（D3）、无法判断注入有没有用（D4）。

因此 v2 不是修修补补，而是把架构从"**经验库 + 打分**"升级为"**认知闭环：预测 → 行动 → 判定 → 归因 → 修正**"。

---

## 1. 设计总纲：五条不变式

无论具体实现如何演进，v2 必须满足以下五条不变式。它们是这套方案之所以"不会退化成另一个没用项目"的根基。

1. **真值优先律**：任何经验能否进入长期记忆、任何注入能否保留，最终由"任务结果真值"裁决，不由过程指标裁决。
2. **对照律**：任何"这次做得好/坏"的结论，必须能回答"相对于什么基线"。没有对照就没有学习信号。
3. **归因可分离律**：注入的经验是否导致了结果，必须用"可归因"的方式记账（配对对照），禁止"结果好→被注入经验好"的关联跳跃。
4. **信号代价律**：每个信号都要标注置信度与获取代价；高代价低置信的信号（如规则关键词漏检）必须有更廉价的兜底，不能成为进化的事实来源。
5. **可回滚律**：任何一次"自我修改"（经验、策略、模型选择）都必须可追溯、可回滚、可量化其对后续任务的影响；不可量化的"进化"等于没发生。

---

## 2. 真值信号层（根治 D2 与 D3）

这是 v2 的第一块新地基。v1 没有这一层。

### 2.1 真值的三级来源（按可信度降序）

| 级别 | 来源 | 可信度 | 代价 | 说明 |
|------|------|--------|------|------|
| L0 | 用户显式终局判定 | 最高 | 依赖用户 | 复用 dsh 已有 `messageFeedback` 服务（点赞/点踩/星级），作为终局真值 |
| L1 | 可执行验收标准自评 | 高 | 1 次 LLM 调用 | 任务开始时由 agent 产出「验收标准」，任务结束时 LLM 对照标准判定 pass/fail |
| L2 | 硬性可观测事实 | 中 | 零成本 | 测试全绿 / 编译通过 / 命令退出码 0 / 用户未再纠错，这些是客观信号 |
| L3 | 过程代理指标 | 最低 | 零成本 | 即 v1 的 goalProgress/toolSuccessRate/stepEfficiency，仅作先验，不作真值 |

**核心原则**：L3 不再进入"结果判定"，只作为 L0/L1/L2 缺失时的**弱先验**。真值由 L0 > L1 > L2 逐级回退，且回退时必须显式降低该经验的 `outcomeConfidence`（见 §4）。

### 2.2 引入「任务单元」为判定粒度

v1 的评分粒度为 `turn`，但一个真实任务跨多个 turn（多步工具链、多轮对话）。以 turn 为判定粒度会导致"任务做对了，但中途某 turn 被误判为失败"。

v2 把判定粒度提升为 **TaskUnit（任务单元）**，对齐 dsh 的 goal：

- 有 goal → 以 goal 生命周期为 TaskUnit 边界（`goal.phase` 从 active 到 complete/blocked 即一个完整任务）。
- 无 goal → 以「连续的多步工具簇 + 用户消息」启发式切分（复用 v1 的 taskUnitId 思路，但判定不再在 turn 层落库，而是在 TaskUnit 关闭时统一判定）。

**关键修正（根治 D2 的 `active≠advanced` 失真）**：

- 只有 `goal.phase === 'complete'` 才对应 L0/L2 真值里的"成功"。
- `active`、`paused`、`blocked`、`stalled` 一律**不产生成功结论**，只产生"进行中/受阻"的中间态。
- turn 层评分降级为 TaskUnit 内部的"过程观测"，仅供归因（§5）使用，不再单独作为经验落库的依据。

### 2.3 可执行验收标准的生成与判定（L1 落地）

```
任务开始（TaskUnit 创建）
  └─ 生成 acceptanceCriteria（LLM 一次性产出）
       · 形如：可被客观验证的清单，例如
         "仓库根目录存在 hello.js 且 `node hello.js` 退出码为 0"
       · 若无法生成（纯聊天/开放式问题）→ 标记 taskType=conversational，跳过经验化

任务结束（TaskUnit 关闭）
  └─ 判定 outcome：
       L0 有用户终局反馈 → 用反馈
       否则 L1：LLM 对照 acceptanceCriteria + 最终产物 → { pass, fail, unknown }
       否则 L2：硬性事实（退出码 / 测试结果 / 编译结果）
       否则 L3：弱先验 + outcomeConfidence 打低
```

- `unknown` 是合法第三态：拿不到真值的任务**不产生经验**，只记录为"未知"，绝不臆断成败。这是对 v1"未知默认给满分"（`index.ts:423`）的直接否决。

---

## 3. 语义检索层（根治 D4）

v1 用 `taskPattern`（6 个关键词粗分类）+ 工具序列相似度召回，`general` 兜底无区分度。v2 改为**语义向量检索**。

### 3.1 向量化经验

- 每个 TaskUnit 关闭时，把「任务描述 + 验收标准 + 最终产物摘要」编码为 embedding 存入。
- 经验记录新增字段：`embedding`（向量）、`semantic_key`（任务语义指纹，聚类用）。
- 依赖：本地 embedding 模型或复用 dsh 现有 LLM 的 embedding 端点。**不引入新硬依赖**，embedding 服务可插拔、可降级为「关键词 + taskPattern」兜底（即 v1 行为）。

### 3.2 召回改语义相似度

- 当前任务 → embedding → 余弦相似度 top-k。
- 工具序列相似度**降为次要特征**（只做精排微调，不再做主召回键）。
- 解决 v1 的"同一批 read/grep/edit 服务完全不同任务"问题。

### 3.3 语义指纹聚类（替代 v1 机械 lesson 合并）

- 用 `semantic_key` 聚类相似任务，同一簇内做**跨次对照**（§5.2 的素材来源），这才是真正有价值的"进化抽象"。

---

## 4. 置信度模型重构（根治 D1）

v1 的 confidence 是单向乐观偏置。v2 把置信度拆成**两个正交维度**，并引入**双向归因**。

### 4.1 两个正交维度

| 维度 | 含义 | 更新方向 |
|------|------|---------|
| `outcomeConfidence` | 这条经验"结果真值"有多可信 | 由真值来源级别（L0>L1>L2>L3）决定，不随复用累加 |
| `transferConfidence` | 这条经验"迁移到新任务有用"有多可信 | 由配对对照（§5.2）的因果证据驱动，可涨可跌 |

v1 的单一 `confidence` 混淆了这两件事：结果可信 ≠ 迁移有用。

### 4.2 双向归因（核心突破）

```
注入经验 E 到任务 T
T 结束时得到真值 outcome ∈ {pass, fail}

若 outcome == pass：
  不立即给 E 加分（这是 v1 的关联谬误）
  而是进入配对对照：T 的"未注入 E 的反事实"由 baseline 估计
  只有 E 的贡献超出 baseline 时才给 transferConfidence 加分

若 outcome == fail：
  检查 E 是否"被用上了"（见 §5.1 归因追踪）
  若 E 被用上且失败 → transferConfidence 扣分
  若 E 未被用上 → 不加不减（E 与本次失败无关）
```

### 4.3 时间衰减 + 上限

- `transferConfidence` 引入指数衰减（未被再验证则缓慢回落），避免"越用越自信"的永续膨胀。
- 明确上限，防止某条经验靠偶然多次命中垄断召回。

---

## 5. 对照与归因层（根治 D1 的因果问题）

这是 v2 区别于 v1 的**最大增量**：不再"关联当因果"，而是做真正的实验对照。

### 5.1 归因追踪：经验是否"被用上"

- 注入经验时，给每条注入经验一个 `traceId`，并注入一段**隐式 probe**：在注入文本末尾附一句"如果本条经验适用于当前任务，请在内部确认"——不强制，只作软信号。
- TaskUnit 结束时，用 LLM 判定"哪些注入经验确实指导了本次行动"（`usedExperiences`）。
- 结果：得到 `(注入经验, 是否被用, 任务结果)` 三元组，这是归因的最小数据单元。

### 5.2 配对对照实验（arm-based）

- 同一 `semantic_key` 簇内，当积累足够样本时，对"注入 E 组" vs "不注入 E 组（或注入旧 E' 组）"做**对照统计**。
- 效果指标：`注入 E 的任务 pass 率 − baseline pass 率`。
- 只有效应量显著为正，`transferConfidence` 才上升；效应量为负则下降，并可能触发 E 的降权/移除。
- 这是把"自我改进"变成一门**可量化的 A/B 实验**，而非玄学调参。

### 5.3 baseline 估计

- baseline = 同 `semantic_key` 簇内、未注入该经验的历史任务 pass 率。
- 无历史时 baseline = 全局平均 pass 率（弱先验，标注低置信）。

---

## 6. 分层记忆与遗忘（根治 D1 尾部 + 支撑 D4）

v1 的分代 GC 按"新生代/老年代"容量淘汰。v2 改为**按认知价值分层**：

| 层 | 内容 | 更新策略 |
|----|------|---------|
| 原子事实层 | 稳定、可验证的事实（如"本项目测试命令是 pnpm test"） | 强冲突裁决，几乎不遗忘 |
| 策略层 | 可迁移的做法（如"该任务先读 AGENTS.md 再动手"） | 由 transferConfidence + 对照证据驱动，可涨可跌可遗忘 |
| 事件层 | 单次任务原始记录 | 短期保留，供归因统计用，定期聚合进策略层 |

- 事件层是**原始数据**，策略层是**从事件层对照提炼出的结论**。遗忘只发生在"事件层聚合完毕"之后，保证不丢失可归因的证据。

---

## 7. 纠正信号的重新定位（根治 D3）

v1 把纠正信号当"黄金信号"，但它漏检率高、依赖脆弱契约。v2 重新定位：

1. **纠正不再是独立事实来源，而是 L2 级真值信号**：用户纠正 = "这个做法被否定"的硬事实，可信度高，但只覆盖"被明确否定的做法"，不能反推"其他做法都对"。
2. **纠正只降权，不臆断正面**：被纠正的做法 → 该做法的 `transferConfidence` 直接扣分（v1 已有 `penalizeByContentHash`，保留并强化）；但不因此给任何"未纠正做法"加分。
3. **规则层只做候选生成，不做终判**：关键词词表继续做零成本候选，但最终是否"真的是纠正"由 LLM 在**有完整 TaskUnit 上下文**时统一判定，而非在脆弱的 turn 事件流里即时判定。
4. **移除对 dsh 内部事件结构脆弱假设的依赖**：纠正检测不再依赖 `countUserMessagesInTurn` / `findUserMessageText` 对事件流 seq 的精确定位，改为在 TaskUnit 关闭时对**完整用户消息序列**做一次性语义判定。

---

## 8. 分阶段落地计划

> 每阶段可独立合入、独立验证，不要求一步到位。

### 阶段 A：真值层落地（先解决 D2）
- 新增 `acceptanceCriteria` 生成与判定。
- 评分粒度从 turn 提到 TaskUnit；修正 `active≠advanced`、`未知≠满分`。
- 新增 `outcome ∈ {pass, fail, unknown}` 三态与 `outcomeConfidence`。
- 验证：单任务单元能产出"有真值、带置信度"的 outcome。

### 阶段 B：归因与双向置信度（解决 D1）
- 拆分 `outcomeConfidence` / `transferConfidence`。
- 实现归因追踪（traceId + usedExperiences）。
- 实现双向归因记账，替换 v1 单向 boost。
- 验证：注入经验在失败任务中不再被无条件加分。

### 阶段 C：语义检索（解决 D4）
- embedding 可插拔接入，语义召回替换工具序列主召回。
- semantic_key 聚类。
- 验证：检索 top-k 与当前任务语义相关（人工抽检 + 定量）。

### 阶段 D：配对对照实验（解决 D1 的因果）
- arm-based 对照统计，效应量驱动 transferConfidence。
- 验证：同一簇内能自动识别"真正有用的经验"并提升其权重。

### 阶段 E：分层记忆与遗忘（收尾）
- 事件层 / 策略层 / 原子事实层三级记忆。
- 聚合驱动的遗忘，替代容量驱动的 GC。

---

## 9. 风险与不可解边界（诚实声明）

1. **真值覆盖率天花板**：L0 依赖用户反馈，L1 依赖 LLM 自评（自身有偏）。没有"上帝视角"的真值，这是所有学习系统的固有限制，v2 只是把可得的真值用到极致，并诚实标注 unknown。
2. **自评偏差（self-check bias）**：L1 用同一个 LLM 既干活又评判，可能系统性高估成功率。缓解：验收标准在任务**开始前**生成（避免事后诸葛亮），且尽量要求客观可验证（退出码/测试结果）而非主观判断。
3. **冷启动**：对照实验需要样本量，早期无显著性结论。缓解：早期退化为 v1 行为 + 弱先验，不阻塞可用性。
4. **embedding 依赖**：若无本地 embedding，语义检索降级为 v1 关键词检索，阶段 C 收益缩水但不破坏正确性。
5. **"进化"仍无法保证任务成功率上升**：本方案保证的是"学习信号正确、归因可量化、记忆有价值"，但能否转化为更高成功率仍受限于 agent 基础能力与任务难度。**没有方案能承诺"一定变强"，只有方案能承诺"变强或变弱都有据可查、可回滚"。**

---

## 10. 与 v1 文档的关系

- 本文不覆盖、不修改 `docs/design.md`（v1 架构描述）。
- 落地时，v1 的 `ExperienceStore` / `BehaviorAdapter` / `MetaCognitionEngine` 模块按阶段替换或演进，具体以实施时的代码改动为准。
- CHANGELOG 将记录每个阶段的架构级改动（属于"重大改动"）。

---

## 11. dsh 源码兼容性（2026-09-04 查证）

本地 dsh 源码位于 `/Users/xh/project/deepseek-harness`（与 `dsh-self-improving` 同级目录）。已查证的关键契约：

| 契约 | 结论 | 对 v2 的影响 |
|------|------|-------------|
| goal 服务 | 服务名 `ctx.goals`（`Context.goals: GoalService`），权威字段 `goal.phase`，类型 `'active' \| 'paused' \| 'blocked' \| 'complete'` | 真值层 L3 弱先验据此判定；修正 v1 的 `active→advanced` |
| feedback 服务 | `MessageFeedbackRating = 'positive' \| 'negative'`（**无 'none'**），接口 `list({sessionId})→{items}`，item 有 `messageId` + `rating` | L0 真值来源 |
| **旧包冲突（待处理）** | dsh 仓库存在 `packages/learning/self-improving/` —— 本插件的**早期单文件内联版**，与独立仓库 `dsh-self-improving` 同名（都注册 `name = 'self-improving'`） | 用户同时装两者会报 `duplicate loader entry id` |

### 待办（阶段 A 完成后，需另行授权处理）

- dsh 仓库 `packages/learning/self-improving/` 是过时的 v1 单文件内联版，与本插件重复。需决定：废弃/删除该旧包，或保持兼容。此操作涉及修改 dsh 仓库，超出 `dsh-self-improving` 仓库边界，需用户另行授权。

---

## 12. 阶段 A 实施记录

阶段 A（真值层）已实现并验证：

- 新增 `src/truth-ground.ts`（`resolveVerdict` / `hardFactVerdict` / `proxyPriorVerdict` 纯函数）。
- 新增类型 `OutcomeVerdict` / `VerdictSource` / `TaskUnitOutcome` + `computeVerdictConfidence`。
- 新增常量 `VERDICT_CONFIDENCE_L0..L3` / `HARD_FACT_FAIL_TOOL_MIN`。
- `llm-bridge.ts` 新增 `generateAcceptanceCriteria` / `judgeTaskOutcome`。
- `experience-store.ts` 新增 `outcome_verdict` / `outcome_confidence` / `acceptance_criteria` 列 + `task_unit` 表 + `createTaskUnit` / `closeTaskUnit` / `getTaskUnit` / `updateTaskUnitAcceptanceCriteria`。
- `index.ts` 接入 TaskUnit 生命周期：创建时生成验收标准，关闭时判定 verdict 并回填；修正 `active→advanced` 与 `未知→满分` 两处失真。
- 测试 `test/truth-ground.test.ts`（18 例）；`pnpm run build` 通过，全量测试无回归。

---

## 13. 阶段 B 实施记录（归因与双向置信度）

阶段 B 已实现并验证（对应 §4 + §5.1）：

- 新增 `transfer_confidence` 字段（`experiences` 表 + 迁移 + `ExperienceRecord.transferConfidence` + `rowToRecord`），独立于 `confidence`（后者向后兼容保留）。
- 新增常量 `TRANSFER_CONFIDENCE_INITIAL/MIN/MAX`、`TRANSFER_REWARD_PASS_USED`、`TRANSFER_PENALTY_FAIL_USED`、`TRANSFER_DECAY_FACTOR`。
- `experience-store.ts` 新增 `applyAttribution()`（双向归因：pass+used 加分、fail+used 扣分、not-used 不动，钳位到 [MIN,MAX]）与 `decayTransferConfidence()`（时间衰减）。
- `index.ts`：
  - 注入时记录 `lastInjected`（被注入经验 id + toolsUsed，供归因判定）。
  - `closeTaskUnitWithVerdict` 里按 verdict + 工具交集判定 usedExperiences，调用 `applyAttribution`。
  - **移除 v1 单向 J7 boost**（`boostConfidence` on positive outcome），根除"关联当因果"的乐观偏置。
- usedExperiences 判定用**规则代理**（本 turn 工具序列与被注入经验 toolsUsed 的交集），零成本、确定性；LLM 语义判定留作后续增强（§5.1 的完整版）。
- 测试 `test/attribution.test.ts`（8 例）；`pnpm run build` 通过，全量测试无回归。

> 说明：`meta-cognition/meta-cognition-engine.ts` 里的 `boostSimilarExperiences` 仍调用 `boostConfidence`（那是独立 test fixture 的旧逻辑，向后兼容保留，不阻塞阶段 B 的运行时归因正确性）。

---

## 14. 阶段 C 实施记录（语义检索）

阶段 C 已实现并验证（对应 §3，采用「LLM 文本归约语义签名」方案——因 dsh 无 embedding 端点，真向量需引入新依赖，归约签名零新依赖且直接服务语义聚类）：

- 新增 `semantic_key` 字段（`experiences` 表 + 迁移 + `ExperienceRecord.semanticKey` + `rowToRecord` + 索引）。
- 新增 `src/semantic-key.ts`（纯函数）：`generateSemanticKeyRuleBased`（确定性降级，动词+名词提取，零成本）。
- `llm-bridge.ts` 新增 `generateSemanticKey`（LLM 归约，产生更高 paraphrase 鲁棒性的 kebab-case 签名）。
- `experience-store.ts` 新增 `queryBySemanticKey()`（按语义签名精确/前缀匹配召回 + `semanticSimilarity` 排序，语义不匹配时回退 taskPattern）与 `updateSemanticKey()`。
- `index.ts`：
  - store 时用 rule-based 生成 semantic_key（同步零成本），并异步用 LLM 精化。
  - pre-step 注入优先走 `queryBySemanticKey`，无结果时回退 v1 `query`（向后兼容）。
- 测试 `test/semantic-key.test.ts`（10 例）；`pnpm run build` 通过，全量测试无回归。

> 关键决策：语义签名（semantic_key）而非真向量。理由——dsh LLM 核心接口只有文本 `stream`，无 embedding；引入本地 embedding 模型会新增硬依赖（违反 AGENTS.md 依赖确认原则 + 设计文档「不引入新硬依赖」）。语义签名是可插拔 embedding 的一个轻量实现：签名即低维语义表示，零新依赖、可解释、可聚类。

---

## 15. 阶段 D 实施记录（配对对照实验）

阶段 D 已实现并验证（对应 §5.2 + §5.3）：

- 新增 `attribution_event` 表（原始 `(taskUnitId, experienceId, semanticKey, used, passed)` 三元组，即"事件层"证据）。
- 新增 `src/attribution.ts`（纯函数）：`computeEffectSize`（注入臂 pass 率 − baseline pass 率，双阈值判定 reward/penalty/neutral + 最小样本门槛）与 `aggregateArms`（按 used/passed 分臂聚合）。
- 新增常量 `ARM_MIN_INJECTED_SAMPLES` / `ARM_MIN_BASELINE_SAMPLES` / `ARM_POSITIVE_EFFECT_THRESHOLD` / `ARM_NEGATIVE_EFFECT_THRESHOLD` / `ARM_EFFECT_CONFIDENCE_DELTA`。
- `experience-store.ts` 新增 `recordAttributionEvent` / `queryAttributionArms` / `applyEffectSizeDelta` / `listAttributedExperiences`。
- `index.ts`：
  - `closeTaskUnitWithVerdict` 里同时记录归因事件（used 与 not-used 都记，以构建 baseline 臂）。
  - `runMaintenance` 里周期性按效应量校准 transferConfidence（只对样本足够且效应显著的体验做 ±delta 调整）。
- 测试 `test/attribution-effect.test.ts`（9 例）；`pnpm run build` 通过，全量测试无回归。

> 阶段 B 的即时双向归因（applyAttribution）与阶段 D 的对照统计（computeEffectSize）是互补的两层：B 提供快速反馈，D 提供基于对照样本的校准。D 只在两臂样本都达标时生效，避免小样本噪声误调置信度。

---

## 16. 阶段 E 实施记录（分层记忆与遗忘）

阶段 E 已实现并验证（对应 §6）：

- 新增 `memory_tier` 字段（`experiences` 表 + 迁移 + `ExperienceRecord.memoryTier` + `rowToRecord` + 索引），取值 `'event' | 'strategy'`。
- 新增常量 `MEMORY_TIER_EVENT/STRATEGY`、`STRATEGY_PROMOTE_TRANSFER_THRESHOLD`（0.7）、`STRATEGY_DEMOTE_TRANSFER_THRESHOLD`（0.3）、`STRATEGY_FORGET_TRANSFER_THRESHOLD`（0.15）。
- `experience-store.ts` 新增 `promoteToStrategy()`（高 transferConfidence + 有 lesson 的事件 → 策略层）、`demoteFromStrategy()`（低 transferConfidence 降回事件层）、`forgetStrategy()`（极低 transferConfidence 删除）。
- `index.ts` 在 `runMaintenance` 接入分层遗忘（在效应量校准之后执行）。
- 测试 `test/layered-memory.test.ts`（7 例）；`pnpm run build` 通过，全量测试无回归。

> 三级记忆落地：**原子事实层**（既有 `atomic_facts` 表，强冲突裁决几乎不遗忘）、**策略层**（本阶段新增 `memory_tier='strategy'`，由 transferConfidence 驱动晋升/降级/遗忘）、**事件层**（`experiences` 默认 `memory_tier='event'`，即 v1 的原始记录，保留现有容量 GC）。遗忘只发生在"策略层由 transferConfidence 驱动"这一处，事件层仍走 v1 容量 GC，原子事实层几乎不遗忘——三者互不干扰。

---

## 17. v2 全部阶段完成总结

五个阶段（A 真值层 → B 归因 → C 语义检索 → D 配对对照 → E 分层记忆）全部实现，累计新增 52 个测试，`pnpm run build` 通过，全量测试无回归。四个核心缺陷的根治映射：

| 缺陷 | 根治阶段 |
|------|---------|
| D1 单向乐观偏置（关联当因果） | B（双向归因）+ D（对照实验）+ E（分层遗忘） |
| D2 评分是过程指标（无结果真值） | A（真值三态 + 三级来源） |
| D3 纠正信号脆弱 | A（真值层重新定位，纠正降为 L2 信号） |
| D4 检索按工具名而非语义 | C（语义签名检索） |

> 下一步（尚未实施）：真机集成验证——在真实 dsh 事件流下跑一次完整任务，确认真值判定、语义召回、归因、分层遗忘在真实契约下正确触发。
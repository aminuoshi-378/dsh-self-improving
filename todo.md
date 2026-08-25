# TODO — self-improving 插件缺陷修复

## P0 — 核心体验缺陷

- [ ] **每个 turn 只注入一次经验，不要每个 step 都注入**
  - 当前：`agent/pre-step` 每个 step 触发，同一段经验在 turn 内重复注入 N 次
  - 修复：改为每个 turn 的第一个 step 注入，后续 step 跳过
  - 或：改用 `agent/turn-start` 事件（如果有）做 turn 级注入

- [ ] **经验去重**
  - 当前：5 条内容几乎一样的经验全部被查出注入
  - 修复：query 结果按 `context_hash` 去重，相同工具序列只保留最新一条

- [ ] **加入工具调用步数（效率）维度**
  - 当前：2 步完成和 18 步完成都得 0.9 分
  - 修复：评分公式加入 `stepEfficiency` 维度
  - 公式：步数越少分越高，如 `max(0, 1 - (stepCount - 1) * 0.05)`，3 步=0.9，10 步=0.55
  - 重新分配权重，比如：goalProgress 0.3 + toolSuccess 0.2 + stepEfficiency 0.25 + guard 0.15 + feedback 0.1

- [ ] **区分任务难度，防止简单任务经验覆盖难任务经验**
  - 当前：简单任务（2 步、工具全成功）score 高，注入时排序靠前，难任务经验被挤掉
  - 问题根因：步数少 ≠ 经验有价值。简单任务不需要总结经验（"write → bash 就行"），难任务的经验（"异步重试需要处理 Promise rejection"）才值得注入
  - 存储环节：按步数过滤，步数 <= 2 的简单任务不存储经验（或标记为 `difficulty: low`，注入时降权）
  - 召回环节：注入时按"信息量"排序而非纯 score 排序——步数多 + 有失败 + 有 lesson 的经验优先于步数少 + 全成功 + 无 lesson 的
  - 新字段 `difficulty`：low（1-2 步全成功）/ medium（3-6 步）/ high（7+ 步或有过失败）
  - 注入时 `difficulty: high` 的经验优先，`low` 的只在经验库不足时填充

## P1 — 评分准确性

- [ ] **接入 message-feedback 服务**
  - 当前：web profile 没挂载 message-feedback，用户点赞/踩信号完全丢失
  - 修复：在 `cordis.patch.yml` 里 insert message-feedback 插件
  - 或：改用 session 事件扫描 `message_feedback` 相关事件

- [ ] **接入 goal 服务（web 模式）**
  - 当前：goal 从 `turn/end` reason 判断，但 web 模式下用户可以用 goal 工具
  - 修复：优先用 `ctx.get('goals').get(agent)` 获取真实 goal phase
  - fallback：`turn/end` reason（已完成）

- [ ] **评分区分度不足**
  - 当前：所有任务都是 0.9，四个维度全是"最好值"
  - 修复：加入步数维度后，分数范围从 0.9 扩展到 0.4-0.95
  - 增加失败任务（更难的测试用例）让评分产生差异

## P2 — lesson 质量

- [ ] **用 LLM 生成 lesson 而不是规则模板**
  - 当前：按 score 套模板，所有高分经验的 lesson 文本几乎一样
  - 修复：在 `agent/run-maintenance` 里调用 dsh 的 `ctx.llm` 服务
  - 输入：工具调用序列 + 结果 + 评分
  - 输出：结构化的 `{what_worked, what_failed, what_to_try_differently, reusable_lesson}`
  - 无 LLM 时 fallback 到规则模板

- [ ] **lesson 要有可操作性**
  - 当前：lesson 是"工具序列 [write → bash] 效果好"——太泛，agent 本来就这么做
  - 修复：lesson 应该包含具体场景信息，如"写异步代码时忘了 Promise rejection 处理导致 bash 报错"
  - LLM 反思时应该分析具体的 `actions` JSON 内容，不只看工具名

- [ ] **触发 `agent/run-maintenance` 生成 lesson**
  - 当前：headless 模式不触发 maintenance，lesson 永远为空
  - 修复：在 `turn-stopping` 里直接同步生成 lesson（不等 maintenance）
  - 或：在 turn 结束后用 `setTimeout` 异步触发反思

## P3 — 健壮性

- [ ] **注入内容截断**
  - 当前：如果经验库积累了大量经验，注入的 markdown 可能很长
  - 修复：注入内容限制最多 3 条经验，每条 lesson 限制 200 字

- [ ] **过期经验清理**
  - 当前：1000 条上限的 eviction 逻辑在 store 里，但没被触发过
  - 修复：在 `turn-stopping` 存储经验后检查是否超限

## P4 — 召回策略

- [ ] **两阶段召回：粗筛 + 精筛**
  - 当前：query 直接用 SQLite 按 outcome_score 排序返回，没有相似度匹配
  - 修复：
    - 第一阶段粗筛：按 `context_hash` 精确匹配 + `tools_used` 交集匹配，快速缩小候选集（用 SQL WHERE 完成）
    - 第二阶段精筛：在候选集内按综合评分排序——`outcome_score × 0.4 + 工具相似度 × 0.3 + 时间近度 × 0.3`
    - 两阶段都走 SQL，避免全表扫描

- [ ] **筛选范围动态伸缩**
  - 当前：query 固定返回 limit 条
  - 修复：根据经验库总量动态调整候选集大小
    - 经验 < 50 条：全量参与精筛
    - 经验 50-200 条：粗筛取 top 20，精筛取 top 5
    - 经验 > 200 条：粗筛取 top 50，精筛取 top 5
    - 如果粗筛结果质量都高（avg score > 0.8），可以缩小范围；质量低则扩大

- [ ] **结构化信息落库**
  - 当前：lesson 字段存的是一段文本
  - 修复：把 LLM 反思的完整 JSON 存入 lesson 字段
    - 存储格式：`{"what_worked": "...", "what_failed": "...", "what_to_try_differently": "...", "reusable_lesson": "..."}`
    - 注入时从 JSON 提取 `reusable_lesson` 作为注入文本
    - 查询时可以按 `what_failed` 等字段做更精细的匹配
  - 兼容：如果 lesson 字段不是 JSON（旧数据或规则模板），按纯文本处理

## P5 — 可选增强

- [ ] **按任务类型分类经验**
  - 当前：所有经验混在一起，注入时只按工具序列匹配
  - 修复：加入 `task_pattern` 字段（bugfix/feature/refactoring），按任务类型检索

- [ ] **WebUI 可视化经验库**
  - 当前：只能用 sqlite3 命令查看经验
  - 修复：做一个 GUI 插件，在 WebUI 里展示经验库统计和 lesson 列表

- [ ] **经验导出/导入**
  - 当前：经验存在本地 SQLite，换机器就没了
  - 修复：支持导出为 JSON 文件，导入到另一台机器

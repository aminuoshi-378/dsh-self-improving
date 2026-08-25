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

- [ ] **用户反馈：用隐式负信号替代主动反馈**
  - 当前：feedback 永远是 0.5（none），因为 web profile 没挂载 message-feedback，且用户一般不会主动点赞/踩
  - 现实：没有正反馈是常态，不能依赖用户主动操作
  - 修复：改用被动观测的隐式信号，只捕获负反馈
    - 用户追问/纠正：同一个 turn 里 step > 1，用户消息在 agent 回复之后发 → `negative`
    - 用户中断 agent：session 事件 `turn/end` 的 reason 是 `aborted` → `negative`
    - 用户重新描述任务：用户下一条消息和上一条高度相似 → `negative`
    - 没有任何负信号 → `neutral`（0.6，不等于 positive）
    - 用户主动点赞 → `positive`（1.0，可选锦上添花，需挂载 message-feedback 插件）
  - 权重：feedback 从 0.2 降到 0.1，让出给 stepEfficiency

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

- [ ] **定期合并 lesson，避免碎片化**
  - 问题：lesson 太细化会导致经验库膨胀，大量相似 lesson 重复注入浪费 token
  - 修复：定期（每积累 20 条新 lesson 或每次 `agent/run-maintenance` 时）执行合并
    - 第一阶段：按 `difficulty` + 工具序列相似度聚类（SQL GROUP BY 粗分组）
    - 第二阶段：同一组内的 lesson 交给 LLM 总结共通之处，合并成一条
    - 合并后的 lesson 格式：`{merged_from: [id1, id2, ...], what_worked: "...", what_failed: "...", reusable_lesson: "..."}`
    - 被合并的旧 lesson 标记为 `merged: true`，注入时跳过
  - 触发时机：`agent/run-maintenance` 时检查未合并的 lesson 数量，超过阈值就执行合并
  - 合并示例：
    - 旧 lesson 1: "异步重试需要处理 Promise rejection"
    - 旧 lesson 2: "async 函数忘加 try-catch 导致 bash 报错"
    - 旧 lesson 3: "Promise.all 中单个 reject 会导致整体失败"
    - 合并后: "异步代码常见问题：Promise rejection 未捕获、缺少 try-catch、Promise.all 需配合 allSettled 使用"

## P3 — 健壮性

- [ ] **注入内容动态控制**
  - 当前：固定 limit，注入内容可能过长或过短
  - 问题：3 条太少——难任务可能有 5-6 条不同维度的经验值得注入；截断会丢失上下文导致 agent 理解偏差
  - 修复：注入条数动态伸缩，不硬编码
    - 按难度分配：high 难度经验优先注入（最多 5 条），medium 填充（最多 2 条），low 不注入
    - 按 token 预算控制：注入内容总长度不超过 2000 token（约 800 汉字），超了从低优先级的开始砍
    - lesson 文本不硬截断——如果单条 lesson 超长，说明 LLM 反思质量有问题，应该在合并阶段解决，而不是注入时砍掉
    - 如果 lesson 是结构化 JSON，注入时只取 `reusable_lesson` 字段，不注入完整 JSON

- [ ] **经验过期清理：新生代 + 老年代双区域管理**
  - 当前：1000 条上限的 FIFO eviction，没被触发过
  - 修复：借鉴 JVM 分代垃圾回收，经验库分两个区域管理
  - **新生代（Young Gen）**：
    - 刚写入的经验，容量小（如 200 条），写入快
    - 新经验先进新生代
    - 触发 Minor GC：新生代满时，淘汰低质量经验（score 低、无 lesson、difficulty 低）
    - 存活的经验（被多次注入或 score 高）晋升到老年代
  - **老年代（Old Gen）**：
    - 经过验证的优质经验，容量大（如 800 条）
    - 只有晋升的经验才能进入
    - 触发 Major GC：老年代满时，按经验自身质量淘汰，不看使用频率
      - 淘汰优先级：`difficulty: low` > 无 lesson > `score < 0.5` > 已被合并（`merged: true`）的旧经验
      - 不淘汰：`difficulty: high` 且有 lesson 的经验（即使很久没被注入）
      - 理由：久没被注入可能只是当前任务类型不匹配，不代表经验没价值
      - 极端情况：如果按上述规则淘汰后仍未释放足够空间，淘汰 score 最低的经验作为最后手段
  - **晋升条件**：
    - 经验在新生代中被注入（reuse_count >= 1）→ 可晋升
    - 经验被 LLM 合并后的合并产物 → 直接进老年代
    - 经验 score >= 0.8 且有 lesson → 可晋升
  - **数据库实现**：`generation` 字段（0=新生代, 1=老年代），`last_injected_at` 记录最后注入时间

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

- [ ] **前端导入/导出经验，方便经验转移**
  - 当前：经验存在本地 SQLite，换机器就没了
  - 修复：在 WebUI 经验库面板里提供导入/导出按钮
  - **导出**：点击"导出"按钮，后端把经验库全量导出为 JSON 文件，浏览器下载
    - 格式：`[{id, outcome_score, tools_used, lesson, difficulty, generation, ...}, ...]`
    - 文件名：`experiences-export-{date}.json`
  - **导入**：点击"导入"按钮，上传 JSON 文件，后端写入经验库
    - 导入时按 `id` 去重，已存在的跳过或覆盖（可选策略）
    - 导入的经验统一进新生代，按正常流程参与晋升
    - 导入前预检：校验 JSON 格式、字段完整性，显示"将导入 N 条，其中 M 条重复"
  - **使用场景**：
    - 换机器：旧机器导出 → 新机器导入
    - 团队共享：团队成员导出自己的经验，合并到团队共同的经验库
    - 版本备份：定期导出作为备份

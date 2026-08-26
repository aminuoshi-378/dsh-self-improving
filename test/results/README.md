# E2E 测试结果

## 测试概览

| 轮次 | 模型 | 脚本版本 | 耗时 | 预估 token | 报告文件 |
|---|---|---|---|---|---|
| 第一轮 | qwen3.7-max-2026-05-17 | 原始（独立任务） | ~7分42秒 | ~31,500 | （未保存） |
| 第二轮 | qwen3.7-plus-2026-05-26 | 改进（连续迭代任务） | 6分30秒 | 79,000 | `e2e-report-round2-qwen3.7-plus.json` |

---

## 第一轮：独立任务（qwen3.7-max-2026-05-17）

### 任务列表

5 个独立任务，互相没有依赖：

| Task | Prompt |
|---|---|
| task-1 | Create utils.js exporting formatDate(date), plus test-utils.js |
| task-2 | Create validator.js exporting validateEmail(str), plus test-validator.js |
| task-3 | Create formatter.js exporting formatPhone(str), plus test-formatter.js |
| task-4 | In utils.js add pad(str, len), update test-utils.js |
| task-5 | Create cache.js exporting LRU cache class, plus test-cache.js |

### 结果

| Phase | 平均步数 | 平均评分 | 注入次数 |
|---|---|---|---|
| Baseline (无插件) | 0 (无法统计) | N/A | 0/5 |
| Enabled R1 (首次跑) | 4.0 | 0.926 | 5/5 |
| Enabled R2 (有经验) | 4.4 | 0.922 | 5/5 |

**R2 vs R1: 步数 +10%，评分 -0.4%。经验注入未带来改善。**

### 问题

1. Baseline 无法统计步数——无插件时 stderr 没有 self-improving 日志
2. 任务太独立——context_hash 互不匹配，经验注入对后续任务没帮助
3. 没有 token 预估——跑之前不知道要花多少 token

---

## 第二轮：连续迭代任务（qwen3.7-plus-2026-05-26）

### 任务列表

同一 Node.js 项目迭代，后续任务依赖前面的产出：

| Task | Prompt | 依赖 |
|---|---|---|
| task-1 | 创建 config.js ({ port: 3000 }) + app.js (HTTP server) | 无 |
| task-2 | 创建 router.js (handleRequest 路由)，改 app.js 用它 | task-1 |
| task-3 | 创建 auth.js (checkAuth)，改 app.js 加认证拦截 | task-2 |
| task-4 | 修 bug：/ 不应要求 auth，只有 /api 要 | task-3 |
| task-5 | 创建 test-app.js 测试 config/router/auth | task-1~4 |

### 结果

| Phase | 平均工具调用 | 平均评分 | 注入次数 |
|---|---|---|---|
| Baseline (无插件) | 1.2 | N/A | 0/5 |
| Enabled R1 (首次跑) | 6.2 | 0.910 | 5/5 |
| Enabled R2 (有经验) | 7.8 | 0.906 | 5/5 |

### 工具调用次数明细

| Task | Baseline | R1 | R2 | R2 vs R1 |
|---|---|---|---|---|
| task-1 | 1 | 3 | 4 | +33% |
| task-2 | 1 | 8 | 9 | +13% |
| task-3 | 1 | 5 | 10 | +100% |
| task-4 | 1 | 8 | 9 | +13% |
| task-5 | 2 | 7 | 7 | 0% |

### 评分明细

| Task | Baseline | R1 | R2 |
|---|---|---|---|
| task-1 | N/A | 0.94 | 0.92 |
| task-2 | N/A | 0.89 | 0.90 |
| task-3 | N/A | 0.91 | 0.90 |
| task-4 | N/A | 0.90 | 0.90 |
| task-5 | N/A | 0.91 | 0.91 |

### 代码产出

| Task | Baseline 文件数 | R1 文件数 | R2 文件数 | Baseline 行数 | R1 行数 | R2 行数 |
|---|---|---|---|---|---|---|
| task-1 | 2 | 2 | 2 | 14 | 17 | 14 |
| task-2 | 3 | 3 | 3 | 28 | 31 | 28 |
| task-3 | 4 | 4 | 4 | 42 | 44 | 41 |
| task-4 | 4 | 4 | 4 | 44 | 46 | 43 |
| task-5 | 5 | 5 | 5 | 71 | 73 | 68 |

**R2 vs R1: 工具调用 +25.8%，评分 -0.4%，经验注入未带来改善。**

---

## 单元测试结果（AMB 模式，无 LLM 调用）

`test/memory-benchmark.test.ts` — 15 个测试，5 组，全部通过：

| 组 | 测试数 | 测试内容 | 参考 AMB 类别 |
|---|---|---|---|
| 1. Conflict Resolution | 3 | 经验去重（相同 context_hash 保留最新） | conflict-resolution.ts |
| 2. Cross-Session | 3 | 跨会话经验召回 + taskPattern 隔离 | cross-session.ts |
| 3. Selective Forgetting | 3 | merged 跳过 + deleteById 物理删除 | selective-forgetting.ts |
| 4. Difficulty Priority | 3 | 高难度优先排序 + minScore 过滤 | temporal-reasoning |
| 5. Multi-step 连续任务 | 3 | 去重+跨会话+难度优先+merged 联动 | Layer2 场景 |

运行命令：`npx tsx test/memory-benchmark.test.ts`

全部 59 个测试通过（原有 44 + 新增 15），无回归。

---

## 根因分析

两轮 E2E 测试经验注入都未带来改善，原因：

1. **任务太简单** — qwen3.7-plus 能力足够直接完成这些编程任务，不需要历史经验指引。要体现记忆系统价值，需要设计"会犯错的困难任务"——如需要记住 API 版本差异、需要避免之前踩过的坑
2. **经验内容缺乏针对性** — 注入的是"上次用了什么工具序列"，不是"这个 bug 该怎么修"的具体 lesson。对 agent 完成当前任务帮助有限
3. **Baseline 工具计数不可比** — 无插件时 stderr 无 self-improving 日志，从 stdout 粗估严重低估（1.2 vs 6.2）
4. **context_hash 匹配不够** — 每个 task 的工具序列部分重叠但 taskPattern 不同（feature/bugfix/test-writing），P5 同类优先未能匹配
5. **单次实验噪声大** — LLM 输出有随机性，需要多次跑取平均

---

## 改进方向

1. **设计困难任务** — 让 agent 不靠经验会犯错（如用废弃 API、踩已知坑），靠经验才能避免
2. **修复 Baseline 计数** — 从 dsh 的 agent 事件日志解析步数，不依赖 self-improving 日志
3. **多轮跑取平均** — 每个 phase 跑 3 次取中位数，降低 LLM 随机性影响
4. **验证 lesson 内容** — 检查注入的经验文本是否与当前任务相关，而非只看注入是否发生

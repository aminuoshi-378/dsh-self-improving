# Harness E2E 测试框架 — 使用方法

## 这是什么

用一个测试 agent（LLM）模拟人类开发者，驱动两个 dsh 实例（带/不带 self-improving）完成同一个编程项目，对比它们的表现差异。

测试 agent 会根据 dsh 的输出动态决定下一步指令——纠正错误、追加需求、或评估完成质量，而非固定 prompt 脚本。

## 前置条件

1. dsh 已安装，headless profile 可用
2. self-improving 插件已 link 到 headless profile
3. qwen provider 配置好可用 model（`~/.dsh/settings.yaml` 中 `llm-pi-ai.providers.qwen`）
4. Node.js >= 22

## 运行

```bash
cd dsh-self-improving

# 1. 先预估 token，不执行
npx tsx test/harness/run.ts --dry-run

# 2. 正式跑（默认 6 轮，REST API 场景）
npx tsx test/harness/run.ts

# 3. 自定义场景和轮数
npx tsx test/harness/run.ts --scenario "Build a CLI tool for file conversion" --rounds 8

# 4. 测试 agent 用不同 model（省钱用小模型做决策）
npx tsx test/harness/run.ts --model qwen3.7-plus-2026-05-26 --agent-model qwen3-8b
```

## 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--scenario <text>` | Build a REST API for a todo app... | 任务场景描述 |
| `--rounds <n>` | 6 | 交互轮数上限 |
| `--model <name>` | qwen3.7-plus-2026-05-26 | dsh 用的 LLM model |
| `--agent-model <name>` | 同 `--model` | 测试 agent 用的 LLM model |
| `--dry-run` | — | 只预估 token，不执行 |

## 输出

- **终端**：逐轮对比表 + 汇总 + 测试 agent 每轮意图
- **JSON 报告**：`/tmp/harness-e2e/harness-report.json`，含完整交互历史

## 对比指标

| 指标 | 含义 | 怎么看 |
|---|---|---|
| 工具调用次数 | dsh 每轮调用多少工具 | with-self 比 without-self 少 = 经验有效 |
| outcome score | self-improving 的 0-1 评分 | 仅 with-self 有，看趋势是否上升 |
| 代码质量评分 | 测试 agent 1-10 分评估最终代码 | 两个工作目录对比 |
| 经验注入次数 | with-self 中注入了几轮经验 | 注入率高但步数没降 = 注入内容无针对性 |
| 交互轮数 | 测试 agent 何时认为完成 | 轮数少 = dsh 一次做对 |

---

## 测试流程

```
Phase 1: 测试 agent 生成交互序列
  ├─ 生成第一个 prompt
  ├─ 同一个 prompt 发给 DSH-A (with-self) 和 DSH-B (without-self)
  ├─ 测试 agent 看 with-self 的输出，决定下一步
  └─ 重复直到评估或达到轮数上限

Phase 2: 重跑完整序列
  ├─ 清空两个工作目录
  ├─ DSH-A: 带 self-improving 重跑全部 prompt（经验跨轮积累）
  └─ DSH-B: 不带 self-improving 重跑全部 prompt

Phase 3: 评估代码质量
  ├─ 测试 agent 读 with-self 工作目录代码，打分
  └─ 测试 agent 读 without-self 工作目录代码，打分

Phase 4: 对比报告
```

Phase 1 和 Phase 2 有重叠——Phase 1 中两个 dsh 实例已经在跑了，Phase 2 是为了让 with-self 在干净环境中从头积累经验（Phase 1 的 with-self 跑时 DB 是空的，经验积累不完整）。

---

## 怎么判断经验注入有效

看以下三个条件是否同时满足：

1. **工具调用减少** — with-self 的平均工具调用次数 < without-self
2. **代码质量不降** — with-self 的质量评分 >= without-self
3. **后续轮次改善** — 后几轮 with-self 的步数比第一轮减少（经验积累效果）

如果只满足条件 3 但不满足条件 1，说明经验在单轮内有效但整体没拉开差距——可能任务太简单。

---

## 后续怎么测

### 1. 换不同难度的场景

默认场景（REST API）对 qwen3.7-plus 太简单。尝试更难的场景：

```bash
# 需要理解已有代码并修复的场景
npx tsx test/harness/run.ts --scenario "Fix bugs in an existing Express app that has intentional errors in route handling, middleware order, and async error catching. The app is in the current directory."

# 需要跨文件重构的场景
npx tsx test/harness/run.ts --scenario "Refactor a monolithic server.js into separate modules: routes, controllers, middleware, and models. Ensure all existing functionality still works."

# 需要写测试并修复失败的场景
npx tsx test/harness/run.ts --scenario "Create a library for parsing CSV files with streaming support, custom delimiters, and quoted fields. Write comprehensive tests that should all pass."
```

难度越高、越容易犯错的场景，经验注入越可能体现价值。

### 2. 增加轮数

更多轮次 = 更多经验积累机会：

```bash
npx tsx test/harness/run.ts --rounds 10 --scenario "Build a full-stack todo app with API, validation, auth, and tests"
```

### 3. 测试 agent 用小模型省钱

测试 agent 只做判断（下一步发什么指令），不需要强编码能力。用小模型降低成本：

```bash
npx tsx test/harness/run.ts --model qwen3.7-plus-2026-05-26 --agent-model qwen3-8b
```

### 4. 多次跑取平均

LLM 输出有随机性，单次结果不可靠。建议同一场景跑 3 次取中位数：

```bash
for i in 1 2 3; do
  npx tsx test/harness/run.ts --scenario "..." 2>&1 | tee /tmp/harness-run-$i.log
done
```

然后对比 3 次的 summary，看趋势是否一致。

### 5. 对比不同 model

同样的场景用不同 model 跑，看 self-improving 对弱模型和强模型的效果差异：

```bash
# 弱模型
npx tsx test/harness/run.ts --model qwen3-8b

# 强模型
npx tsx test/harness/run.ts --model qwen3.7-plus-2026-05-26
```

弱模型更容易犯错，经验注入可能帮助更大。

---

## 文件结构

```
test/harness/
├── README.md        # 本文档
├── types.ts         # 类型定义：InteractionTurn, InstanceHistory, ComparisonResult
├── test-agent.ts    # 测试 agent：生成 prompt、决定下一步、评估质量
├── dsh-runner.ts    # dsh 调用：运行任务、解析 self-improving 日志、切换 patch
└── run.ts           # 主运行器：串联测试 agent + 两个 dsh 实例
```

## Token 预估

6 轮默认场景预估 76,000 token，预算 500,000，占 15.2%。

增加轮数线性增长：`每轮 ~12,000 token`。10 轮约 124,000 token，仍在预算内。

## 注意事项

- 脚本会自动保存并恢复 `~/.dsh/profiles/headless/cordis.patch.yml`，即使出错也会在 finally 中恢复
- 测试用独立 DB `~/.dsh/experiences-harness.db`，不污染已有经验库
- 工作目录在 `/tmp/harness-e2e/`，每次运行会清空重建
- dry-run 不会修改任何配置，只打印 token 预估
